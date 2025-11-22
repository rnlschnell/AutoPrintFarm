"""
Database service for managing local SQLite database operations
"""

import os
import asyncio
import logging
import uuid
from pathlib import Path
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone

from sqlalchemy import create_engine, text, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import sessionmaker, selectinload
from sqlalchemy.exc import SQLAlchemyError

from ..models.database import Base, Printer, ColorPreset, BuildPlateType, SyncLog, Product, ProductSku, PrintFile, PrintJob, FinishedGoods, AssemblyTask, WorklistTask
from .config_service import get_config_service

# Import for Supabase client configuration
try:
    from supabase.client import ClientOptions
except ImportError:
    # Fallback for older versions
    ClientOptions = None

logger = logging.getLogger(__name__)


class DatabaseService:
    """
    Service for managing local SQLite database operations
    """
    
    def __init__(self, database_path: str = None):
        """
        Initialize database service
        
        Args:
            database_path: Optional custom path for database file
        """
        if database_path is None:
            # Default to data directory in project root
            project_root = Path(__file__).parent.parent.parent
            data_dir = project_root / "data"
            data_dir.mkdir(exist_ok=True)
            database_path = str(data_dir / "tenant.db")
        
        self.database_path = database_path
        self.database_url = f"sqlite+aiosqlite:///{database_path}"
        
        # Create async engine with foreign key enforcement
        self.engine = create_async_engine(
            self.database_url,
            echo=False,  # Set to True for SQL debugging
            future=True,
            pool_pre_ping=True,
            connect_args={
                "check_same_thread": False,
                "timeout": 30,  # 30 second timeout prevents infinite waits on database locks
            },
        )
        
        # Create async session factory
        self.async_session = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
        
        # Set up event listener to enable foreign keys for all connections
        from sqlalchemy import event
        
        @event.listens_for(self.engine.sync_engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            """Enable foreign key constraints for SQLite connections"""
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
        
        logger.info(f"Database service initialized with path: {database_path}")
        logger.info("Foreign key constraints will be enabled for all database connections")
    
    async def initialize_database(self):
        """
        Create database tables if they don't exist
        """
        try:
            async with self.engine.begin() as conn:
                # Enable foreign key constraints for SQLite
                await conn.execute(text("PRAGMA foreign_keys = ON"))
                await conn.run_sync(Base.metadata.create_all)
            logger.info("Database tables initialized successfully with foreign key constraints enabled")

            # Run migrations
            await self.migrate_add_filament_level()
            await self.migrate_add_print_file_unique_constraint()
            await self.migrate_remove_backup_queue()
            await self.migrate_add_maintenance_columns()

            # Log initialization
            await self.log_sync_operation(
                operation_type="INIT",
                table_name="system",
                record_id="database",
                status="SUCCESS"
            )
            
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            raise
    
    async def close(self):
        """
        Close database connections
        """
        if hasattr(self, 'engine'):
            await self.engine.dispose()
            logger.info("Database connections closed")
    
    @asynccontextmanager
    async def get_session(self):
        """
        Get async database session with automatic cleanup
        """
        async with self.async_session() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()
    
    # Printer operations
    
    async def get_printer_by_id(self, printer_id: str) -> Optional[Printer]:
        """
        Get printer by ID
        """
        try:
            async with self.get_session() as session:
                result = await session.get(Printer, printer_id)
                return result
        except Exception as e:
            logger.error(f"Failed to get printer {printer_id}: {e}")
            return None
    
    async def get_printers_by_tenant(self, tenant_id: str) -> List[Printer]:
        """
        Get all active printers for a tenant
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("SELECT * FROM printers WHERE tenant_id = :tenant_id AND is_active = 1 ORDER BY sort_order"),
                    {"tenant_id": tenant_id}
                )
                rows = result.fetchall()

                printers = []
                for row in rows:
                    printer = Printer()
                    for column in row._fields:
                        setattr(printer, column, getattr(row, column))
                    printers.append(printer)

                return printers
        except Exception as e:
            logger.error(f"Failed to get printers for tenant {tenant_id}: {e}")
            return []

    async def get_all_printers_by_tenant(self, tenant_id: str) -> List[Printer]:
        """
        Get ALL printers for a tenant (including inactive ones)
        Used for calculating next printer_id to avoid UNIQUE constraint violations
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("SELECT * FROM printers WHERE tenant_id = :tenant_id ORDER BY sort_order"),
                    {"tenant_id": tenant_id}
                )
                rows = result.fetchall()

                printers = []
                for row in rows:
                    printer = Printer()
                    for column in row._fields:
                        setattr(printer, column, getattr(row, column))
                    printers.append(printer)

                return printers
        except Exception as e:
            logger.error(f"Failed to get all printers for tenant {tenant_id}: {e}")
            return []

    async def upsert_printer(self, printer_data: Dict[str, Any]) -> bool:
        """
        Insert or update printer data (LOCAL-ONLY, no Supabase backup)

        Args:
            printer_data: Dictionary containing printer data

        Returns:
            True if successful, False otherwise
        """
        # Initialize operation_type to avoid UnboundLocalError in exception handler
        operation_type = "UNKNOWN"

        try:
            async with self.get_session() as session:
                # Check if printer exists
                existing = await session.get(Printer, printer_data.get('id'))
                
                if existing:
                    # Update existing printer - properly convert datetime strings
                    for key, value in printer_data.items():
                        if hasattr(existing, key):
                            # Convert datetime strings to datetime objects for timestamp fields
                            if key in ['created_at', 'updated_at', 'last_connection_attempt'] and isinstance(value, str):
                                try:
                                    value = datetime.fromisoformat(value.replace('Z', '+00:00').replace('+00:00', ''))
                                except (ValueError, AttributeError):
                                    # If parsing fails, skip this field to avoid corruption
                                    logger.warning(f"Failed to parse datetime field {key}: {value}")
                                    continue
                            elif key == 'last_maintenance_date' and isinstance(value, str):
                                try:
                                    from datetime import date
                                    value = date.fromisoformat(value)
                                except (ValueError, AttributeError):
                                    logger.warning(f"Failed to parse date field {key}: {value}")
                                    continue
                            
                            setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                    operation_type = "UPDATE"
                else:
                    # Create new printer from dict data
                    printer = Printer.from_dict(printer_data)
                    session.add(printer)
                    operation_type = "INSERT"
                
                await session.commit()

                # NOTE: Printers are LOCAL-ONLY and NOT backed up to Supabase

                # Log the operation
                await self.log_sync_operation(
                    operation_type=operation_type,
                    table_name="printers",
                    record_id=printer_data.get('id'),
                    tenant_id=printer_data.get('tenant_id'),
                    status="SUCCESS"
                )
                
                logger.info(f"Successfully upserted printer {printer_data.get('id')}")
                return True
                
        except Exception as e:
            logger.error(f"Failed to upsert printer: {e}")
            await self.log_sync_operation(
                operation_type=operation_type,
                table_name="printers",
                record_id=printer_data.get('id'),
                tenant_id=printer_data.get('tenant_id'),
                status="FAILED",
                error_message=str(e)
            )
            return False
    
    async def delete_printer(self, printer_id: str, tenant_id: str) -> bool:
        """
        Delete printer (hard delete - permanently remove from database)
        
        Args:
            printer_id: ID of printer to delete
            tenant_id: Tenant ID for logging
            
        Returns:
            True if successful, False otherwise
        """
        # Use hard delete to prevent UNIQUE constraint conflicts when printer IDs are reused
        return await self.hard_delete_printer(printer_id, tenant_id)
    
    async def hard_delete_printer(self, printer_id: str, tenant_id: str) -> bool:
        """
        Permanently delete printer from database
        """
        try:
            async with self.get_session() as session:
                printer = await session.get(Printer, printer_id)
                if printer:
                    await session.delete(printer)
                    await session.commit()
                    
                    await self.log_sync_operation(
                        operation_type="HARD_DELETE",
                        table_name="printers",
                        record_id=printer_id,
                        tenant_id=tenant_id,
                        status="SUCCESS"
                    )
                    
                    logger.info(f"Successfully hard deleted printer {printer_id}")
                    return True
                else:
                    logger.warning(f"Printer {printer_id} not found for hard deletion")
                    return False
                    
        except Exception as e:
            logger.error(f"Failed to hard delete printer {printer_id}: {e}")
            await self.log_sync_operation(
                operation_type="HARD_DELETE",
                table_name="printers",
                record_id=printer_id,
                tenant_id=tenant_id,
                status="FAILED",
                error_message=str(e)
            )
            return False
    
    # Color Preset operations
    
    async def get_color_preset_by_id(self, preset_id: str) -> Optional[ColorPreset]:
        """
        Get color preset by ID
        """
        try:
            async with self.get_session() as session:
                result = await session.get(ColorPreset, preset_id)
                return result
        except Exception as e:
            logger.error(f"Failed to get color preset {preset_id}: {e}")
            return None
    
    async def get_color_presets_by_tenant(self, tenant_id: str) -> List[ColorPreset]:
        """
        Get all color presets for a tenant
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("SELECT * FROM color_presets WHERE tenant_id = :tenant_id ORDER BY color_name"),
                    {"tenant_id": tenant_id}
                )
                rows = result.fetchall()
                
                presets = []
                for row in rows:
                    preset = ColorPreset()
                    for column in row._fields:
                        setattr(preset, column, getattr(row, column))
                    presets.append(preset)
                
                return presets
        except Exception as e:
            logger.error(f"Failed to get color presets for tenant {tenant_id}: {e}")
            return []
    
    async def upsert_color_preset(self, preset_data: Dict[str, Any]) -> bool:
        """
        Insert or update color preset data
        
        Args:
            preset_data: Dictionary containing color preset data
            
        Returns:
            True if successful, False otherwise
        """
        try:
            async with self.get_session() as session:
                # Check if color preset exists
                existing = await session.get(ColorPreset, preset_data.get('id'))
                
                if existing:
                    # Update existing preset
                    for key, value in preset_data.items():
                        if hasattr(existing, key):
                            # Convert datetime strings to datetime objects for timestamp fields
                            if key in ['created_at', 'updated_at'] and isinstance(value, str):
                                try:
                                    value = datetime.fromisoformat(value.replace('Z', '+00:00').replace('+00:00', ''))
                                except (ValueError, AttributeError):
                                    logger.warning(f"Failed to parse datetime field {key}: {value}")
                                    continue
                            
                            setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                    operation_type = "UPDATE"
                else:
                    # Create new color preset from Supabase data
                    preset = ColorPreset.from_dict(preset_data)
                    session.add(preset)
                    operation_type = "INSERT"
                
                await session.commit()

                # Log the operation
                await self.log_sync_operation(
                    operation_type=operation_type,
                    table_name="color_presets",
                    record_id=preset_data.get('id'),
                    tenant_id=preset_data.get('tenant_id'),
                    status="SUCCESS"
                )
                
                logger.info(f"Successfully upserted color preset {preset_data.get('id')} - {preset_data.get('color_name')}")
                return True
                
        except Exception as e:
            logger.error(f"Failed to upsert color preset: {e}")
            await self.log_sync_operation(
                operation_type=operation_type if 'operation_type' in locals() else "UPSERT",
                table_name="color_presets",
                record_id=preset_data.get('id'),
                tenant_id=preset_data.get('tenant_id'),
                status="FAILED",
                error_message=str(e)
            )
            return False
    
    async def delete_color_preset(self, preset_id: str, tenant_id: str) -> bool:
        """
        Delete color preset (hard delete)
        
        Args:
            preset_id: ID of color preset to delete
            tenant_id: Tenant ID for logging
            
        Returns:
            True if successful, False otherwise
        """
        try:
            async with self.get_session() as session:
                preset = await session.get(ColorPreset, preset_id)
                if preset:
                    await session.delete(preset)
                    await session.commit()
                    
                    await self.log_sync_operation(
                        operation_type="DELETE",
                        table_name="color_presets",
                        record_id=preset_id,
                        tenant_id=tenant_id,
                        status="SUCCESS"
                    )
                    
                    logger.info(f"Successfully deleted color preset {preset_id}")
                    return True
                else:
                    logger.warning(f"Color preset {preset_id} not found for deletion")
                    return False
                    
        except Exception as e:
            logger.error(f"Failed to delete color preset {preset_id}: {e}")
            await self.log_sync_operation(
                operation_type="DELETE",
                table_name="color_presets",
                record_id=preset_id,
                tenant_id=tenant_id,
                status="FAILED",
                error_message=str(e)
            )
            return False

    # Build Plate Type operations

    async def get_build_plate_type_by_id(self, build_plate_id: str) -> Optional[BuildPlateType]:
        """
        Get build plate type by ID
        """
        try:
            async with self.get_session() as session:
                result = await session.get(BuildPlateType, build_plate_id)
                return result
        except Exception as e:
            logger.error(f"Failed to get build plate type {build_plate_id}: {e}")
            return None

    async def get_build_plate_types_by_tenant(self, tenant_id: str) -> List[BuildPlateType]:
        """
        Get all build plate types for a tenant
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("SELECT * FROM build_plate_types WHERE tenant_id = :tenant_id ORDER BY name"),
                    {"tenant_id": tenant_id}
                )
                rows = result.fetchall()

                build_plates = []
                for row in rows:
                    build_plate = BuildPlateType()
                    for column in row._fields:
                        setattr(build_plate, column, getattr(row, column))
                    build_plates.append(build_plate)

                return build_plates
        except Exception as e:
            logger.error(f"Failed to get build plate types for tenant {tenant_id}: {e}")
            return []

    async def upsert_build_plate_type(self, build_plate_data: Dict[str, Any]) -> bool:
        """
        Insert or update build plate type data (local-first only)

        Args:
            build_plate_data: Dictionary containing build plate type data

        Returns:
            True if successful, False otherwise
        """
        try:
            async with self.get_session() as session:
                # Check if build plate type exists
                existing = await session.get(BuildPlateType, build_plate_data.get('id'))

                if existing:
                    # Update existing build plate type
                    for key, value in build_plate_data.items():
                        if hasattr(existing, key):
                            # Convert datetime strings to datetime objects for timestamp fields
                            if key in ['created_at', 'updated_at'] and isinstance(value, str):
                                try:
                                    value = datetime.fromisoformat(value.replace('Z', '+00:00').replace('+00:00', ''))
                                except (ValueError, AttributeError):
                                    logger.warning(f"Failed to parse datetime field {key}: {value}")
                                    continue

                            setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                    operation_type = "UPDATE"
                else:
                    # Create new build plate type
                    build_plate = BuildPlateType.from_dict(build_plate_data)
                    session.add(build_plate)
                    operation_type = "INSERT"

                await session.commit()

                # Log the operation
                await self.log_sync_operation(
                    operation_type=operation_type,
                    table_name="build_plate_types",
                    record_id=build_plate_data.get('id'),
                    tenant_id=build_plate_data.get('tenant_id'),
                    status="SUCCESS"
                )

                logger.info(f"Successfully upserted build plate type {build_plate_data.get('id')} - {build_plate_data.get('name')}")
                return True

        except Exception as e:
            logger.error(f"Failed to upsert build plate type: {e}")
            await self.log_sync_operation(
                operation_type=operation_type if 'operation_type' in locals() else "UPSERT",
                table_name="build_plate_types",
                record_id=build_plate_data.get('id'),
                tenant_id=build_plate_data.get('tenant_id'),
                status="FAILED",
                error_message=str(e)
            )
            return False

    async def delete_build_plate_type(self, build_plate_id: str, tenant_id: str) -> bool:
        """
        Delete build plate type (hard delete)

        Args:
            build_plate_id: ID of build plate type to delete
            tenant_id: Tenant ID for logging

        Returns:
            True if successful, False otherwise
        """
        try:
            async with self.get_session() as session:
                build_plate = await session.get(BuildPlateType, build_plate_id)
                if build_plate:
                    await session.delete(build_plate)
                    await session.commit()

                    await self.log_sync_operation(
                        operation_type="DELETE",
                        table_name="build_plate_types",
                        record_id=build_plate_id,
                        tenant_id=tenant_id,
                        status="SUCCESS"
                    )

                    logger.info(f"Successfully deleted build plate type {build_plate_id}")
                    return True
                else:
                    logger.warning(f"Build plate type {build_plate_id} not found for deletion")
                    return False

        except Exception as e:
            logger.error(f"Failed to delete build plate type {build_plate_id}: {e}")
            await self.log_sync_operation(
                operation_type="DELETE",
                table_name="build_plate_types",
                record_id=build_plate_id,
                tenant_id=tenant_id,
                status="FAILED",
                error_message=str(e)
            )
            return False

    # Product operations
    
    async def get_product_by_id(self, product_id: str) -> Optional[Product]:
        """
        Get product by ID with print_files relationship loaded
        """
        try:
            async with self.get_session() as session:
                stmt = (
                    select(Product)
                    .options(selectinload(Product.print_files))
                    .where(Product.id == product_id)
                )
                result = await session.execute(stmt)
                product = result.scalar_one_or_none()
                return product
        except Exception as e:
            logger.error(f"Failed to get product {product_id}: {e}")
            return None
    
    async def get_products_by_tenant(self, tenant_id: str) -> List[Product]:
        """
        Get all active products for a tenant with print_files relationship loaded
        """
        try:
            async with self.get_session() as session:
                stmt = (
                    select(Product)
                    .options(selectinload(Product.print_files))
                    .where(Product.tenant_id == tenant_id)
                    .where(Product.is_active == True)
                    .order_by(Product.name)
                )
                result = await session.execute(stmt)
                products = result.scalars().all()
                return list(products)
        except Exception as e:
            logger.error(f"Failed to get products for tenant {tenant_id}: {e}")
            return []
    
    async def upsert_product(self, product_data: Dict[str, Any]) -> bool:
        """
        Insert or update product data
        """
        try:
            async with self.get_session() as session:
                existing = await session.get(Product, product_data.get('id'))
                
                if existing:
                    # Update existing product
                    for key, value in product_data.items():
                        if hasattr(existing, key):
                            # Convert datetime strings
                            if key in ['created_at', 'updated_at'] and isinstance(value, str):
                                try:
                                    value = datetime.fromisoformat(value.replace('Z', '+00:00').replace('+00:00', ''))
                                except (ValueError, AttributeError):
                                    logger.warning(f"Failed to parse datetime field {key}: {value}")
                                    continue
                            
                            setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                    operation_type = "UPDATE"
                else:
                    # Create new product
                    product = Product.from_dict(product_data)
                    session.add(product)
                    operation_type = "INSERT"
                
                await session.commit()

                await self.log_sync_operation(
                    operation_type=operation_type,
                    table_name="products",
                    record_id=product_data.get('id'),
                    tenant_id=product_data.get('tenant_id'),
                    status="SUCCESS"
                )
                
                logger.info(f"Successfully upserted product {product_data.get('id')}")
                return True
                
        except Exception as e:
            logger.error(f"Failed to upsert product: {e}")
            await self.log_sync_operation(
                operation_type="UPSERT",
                table_name="products",
                record_id=product_data.get('id'),
                tenant_id=product_data.get('tenant_id'),
                status="FAILED",
                error_message=str(e)
            )
            return False
    
    async def delete_product(self, product_id: str, tenant_id: str) -> bool:
        """
        Delete product (hard delete) - matches Supabase CASCADE behavior
        Manually cascades to related records since foreign keys may not be enforced
        """
        try:
            async with self.get_session() as session:
                product = await session.get(Product, product_id)
                if product:
                    # Manually cascade delete related records (since FK enforcement may be disabled)

                    # 1. Get all product SKUs for this product
                    sku_result = await session.execute(
                        text("SELECT id FROM product_skus WHERE product_id = :product_id"),
                        {"product_id": product_id}
                    )
                    sku_ids = [row.id for row in sku_result.fetchall()]

                    # 2. Delete finished_goods for each SKU
                    if sku_ids:
                        for sku_id in sku_ids:
                            await session.execute(
                                text("DELETE FROM finished_goods WHERE product_sku_id = :sku_id"),
                                {"sku_id": sku_id}
                            )
                        logger.info(f"Deleted finished_goods for {len(sku_ids)} SKUs")

                    # 3. Delete all product SKUs
                    if sku_ids:
                        await session.execute(
                            text("DELETE FROM product_skus WHERE product_id = :product_id"),
                            {"product_id": product_id}
                        )
                        logger.info(f"Deleted {len(sku_ids)} SKUs for product {product_id}")

                    # 4. Finally delete the product itself
                    await session.delete(product)
                    await session.commit()

                    await self.log_sync_operation(
                        operation_type="DELETE",
                        table_name="products",
                        record_id=product_id,
                        tenant_id=tenant_id,
                        status="SUCCESS"
                    )

                    logger.info(f"Successfully hard deleted product {product_id} and all related records")
                    return True
                else:
                    logger.warning(f"Product {product_id} not found for deletion (already deleted)")
                    # Return True for idempotent deletes - if already gone, that's fine
                    return True

        except Exception as e:
            logger.error(f"Failed to delete product {product_id}: {e}")
            return False
    
    # Product SKU operations
    
    async def get_product_sku_by_id(self, sku_id: str) -> Optional[ProductSku]:
        """
        Get product SKU by ID
        """
        try:
            async with self.get_session() as session:
                result = await session.get(ProductSku, sku_id)
                return result
        except Exception as e:
            logger.error(f"Failed to get product SKU {sku_id}: {e}")
            return None
    
    async def get_product_skus_by_tenant(self, tenant_id: str) -> List[ProductSku]:
        """
        Get all active product SKUs for a tenant
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("SELECT * FROM product_skus WHERE tenant_id = :tenant_id AND is_active = 1 ORDER BY sku"),
                    {"tenant_id": tenant_id}
                )
                rows = result.fetchall()
                
                skus = []
                for row in rows:
                    sku = ProductSku()
                    for column in row._fields:
                        setattr(sku, column, getattr(row, column))
                    skus.append(sku)
                
                return skus
        except Exception as e:
            logger.error(f"Failed to get product SKUs for tenant {tenant_id}: {e}")
            return []
    
    async def get_product_skus_by_product(self, product_id: str) -> List[ProductSku]:
        """
        Get all active SKUs for a specific product
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("SELECT * FROM product_skus WHERE product_id = :product_id AND is_active = 1 ORDER BY sku"),
                    {"product_id": product_id}
                )
                rows = result.fetchall()
                
                skus = []
                for row in rows:
                    sku = ProductSku()
                    for column in row._fields:
                        setattr(sku, column, getattr(row, column))
                    skus.append(sku)
                
                return skus
        except Exception as e:
            logger.error(f"Failed to get SKUs for product {product_id}: {e}")
            return []
    
    async def upsert_product_sku(self, sku_data: Dict[str, Any]) -> bool:
        """
        Insert or update product SKU data
        """
        try:
            async with self.get_session() as session:
                existing = await session.get(ProductSku, sku_data.get('id'))
                
                if existing:
                    # Update existing SKU
                    for key, value in sku_data.items():
                        if hasattr(existing, key):
                            # Convert datetime strings
                            if key in ['created_at', 'updated_at'] and isinstance(value, str):
                                try:
                                    value = datetime.fromisoformat(value.replace('Z', '+00:00').replace('+00:00', ''))
                                except (ValueError, AttributeError):
                                    logger.warning(f"Failed to parse datetime field {key}: {value}")
                                    continue
                            
                            setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                    operation_type = "UPDATE"
                else:
                    # Create new SKU directly from dict (price already in cents from API)
                    # NOTE: Do NOT use from_supabase_dict here - that method converts dollars to cents,
                    # but sku_data already has price in cents from the API endpoint
                    sku = ProductSku(**sku_data)
                    session.add(sku)
                    operation_type = "INSERT"
                
                await session.commit()

                await self.log_sync_operation(
                    operation_type=operation_type,
                    table_name="product_skus",
                    record_id=sku_data.get('id'),
                    tenant_id=sku_data.get('tenant_id'),
                    status="SUCCESS"
                )
                
                logger.info(f"Successfully upserted product SKU {sku_data.get('id')}")
                return True
                
        except Exception as e:
            logger.error(f"Failed to upsert product SKU: {e}")
            return False
    
    async def delete_product_sku(self, sku_id: str, tenant_id: str) -> bool:
        """
        Delete product SKU (hard delete) - matches Supabase CASCADE behavior
        Manually cascades to finished_goods records since foreign keys may not be enforced
        """
        try:
            async with self.get_session() as session:
                sku = await session.get(ProductSku, sku_id)
                if sku:
                    # Manually cascade delete finished_goods for this SKU first
                    await session.execute(
                        text("DELETE FROM finished_goods WHERE product_sku_id = :sku_id"),
                        {"sku_id": sku_id}
                    )
                    logger.info(f"Deleted finished_goods for SKU {sku_id}")

                    # Now delete the SKU itself
                    await session.delete(sku)
                    await session.commit()

                    await self.log_sync_operation(
                        operation_type="DELETE",
                        table_name="product_skus",
                        record_id=sku_id,
                        tenant_id=tenant_id,
                        status="SUCCESS"
                    )

                    logger.info(f"Successfully hard deleted product SKU {sku_id}")
                    return True
                else:
                    logger.warning(f"Product SKU {sku_id} not found for deletion (already deleted)")
                    # Return True for idempotent deletes - if already gone, that's fine
                    return True

        except Exception as e:
            logger.error(f"Failed to delete product SKU {sku_id}: {e}")
            return False
    
    # Print File operations
    
    async def get_print_file_by_id(self, file_id: str) -> Optional[PrintFile]:
        """
        Get print file by ID
        """
        try:
            async with self.get_session() as session:
                result = await session.get(PrintFile, file_id)
                return result
        except Exception as e:
            logger.error(f"Failed to get print file {file_id}: {e}")
            return None
    
    async def get_print_files_by_tenant(self, tenant_id: str) -> List[PrintFile]:
        """
        Get all print files for a tenant
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("SELECT * FROM print_files WHERE tenant_id = :tenant_id ORDER BY name"),
                    {"tenant_id": tenant_id}
                )
                rows = result.fetchall()

                files = []
                for row in rows:
                    file = PrintFile()
                    for column in row._fields:
                        setattr(file, column, getattr(row, column))
                    files.append(file)

                return files
        except Exception as e:
            logger.error(f"Failed to get print files for tenant {tenant_id}: {e}")
            return []

    async def get_print_files_by_product(self, product_id: str) -> List[PrintFile]:
        """
        Get all print files for a product (supports multiple files per product)
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("SELECT * FROM print_files WHERE product_id = :product_id ORDER BY printer_model_id"),
                    {"product_id": product_id}
                )
                rows = result.fetchall()

                files = []
                for row in rows:
                    file = PrintFile()
                    for column in row._fields:
                        setattr(file, column, getattr(row, column))
                    files.append(file)

                return files
        except Exception as e:
            logger.error(f"Failed to get print files for product {product_id}: {e}")
            return []

    async def get_print_file_by_product_and_model(self, product_id: str, printer_model_id: str) -> Optional[PrintFile]:
        """
        Get a specific print file for a product and printer model

        Args:
            product_id: The product ID
            printer_model_id: The printer model ID (N1, N2S, P1P, P1S, X1, X1C, X1E, etc.)

        Returns:
            PrintFile if found, None otherwise
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("""
                        SELECT * FROM print_files
                        WHERE product_id = :product_id
                        AND printer_model_id = :printer_model_id
                        LIMIT 1
                    """),
                    {"product_id": product_id, "printer_model_id": printer_model_id}
                )
                row = result.fetchone()

                if row:
                    file = PrintFile()
                    for column in row._fields:
                        setattr(file, column, getattr(row, column))
                    return file
                return None
        except Exception as e:
            logger.error(f"Failed to get print file for product {product_id} and model {printer_model_id}: {e}")
            return None

    async def get_default_print_file_by_product(self, product_id: str) -> Optional[PrintFile]:
        """
        Get the default print file for a product (printer_model_id IS NULL)

        Args:
            product_id: The product ID

        Returns:
            PrintFile with NULL printer_model_id if found, None otherwise
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("""
                        SELECT * FROM print_files
                        WHERE product_id = :product_id
                        AND printer_model_id IS NULL
                        LIMIT 1
                    """),
                    {"product_id": product_id}
                )
                row = result.fetchone()

                if row:
                    file = PrintFile()
                    for column in row._fields:
                        setattr(file, column, getattr(row, column))
                    return file
                return None
        except Exception as e:
            logger.error(f"Failed to get default print file for product {product_id}: {e}")
            return None
    
    async def create_print_file(self, file_data: dict) -> Optional[PrintFile]:
        """Create a new print file in the local database"""
        try:
            # Generate UUID for the file if not provided
            if 'id' not in file_data or not file_data['id']:
                file_data['id'] = str(uuid.uuid4())
            
            # Set default values
            if 'created_at' not in file_data:
                file_data['created_at'] = datetime.utcnow()
            if 'updated_at' not in file_data:
                file_data['updated_at'] = datetime.utcnow()
                
            # Use async session context manager
            async with self.get_session() as session:
                # Create PrintFile object
                new_file = PrintFile(**file_data)
                
                # Add to session and commit
                session.add(new_file)
                await session.commit()
                
                logger.info(f"Created print file {new_file.id} for tenant {file_data.get('tenant_id')}")
                return new_file
            
        except Exception as e:
            logger.error(f"Failed to create print file: {e}")
            return None
    
    async def upsert_print_file(self, file_data: Dict[str, Any]) -> bool:
        """
        Insert or update print file data
        """
        try:
            async with self.get_session() as session:
                existing = await session.get(PrintFile, file_data.get('id'))
                
                if existing:
                    # Update existing file
                    for key, value in file_data.items():
                        if hasattr(existing, key):
                            # Convert datetime strings
                            if key in ['created_at', 'updated_at'] and isinstance(value, str):
                                try:
                                    value = datetime.fromisoformat(value.replace('Z', '+00:00').replace('+00:00', ''))
                                except (ValueError, AttributeError):
                                    logger.warning(f"Failed to parse datetime field {key}: {value}")
                                    continue
                            
                            setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                    operation_type = "UPDATE"
                else:
                    # Create new file
                    file = PrintFile.from_dict(file_data)
                    session.add(file)
                    operation_type = "INSERT"
                
                await session.commit()

                await self.log_sync_operation(
                    operation_type=operation_type,
                    table_name="print_files",
                    record_id=file_data.get('id'),
                    tenant_id=file_data.get('tenant_id'),
                    status="SUCCESS"
                )
                
                logger.info(f"Successfully upserted print file {file_data.get('id')}")
                return True
                
        except Exception as e:
            logger.error(f"Failed to upsert print file: {e}")
            return False
    
    async def delete_print_file(self, file_id: str, tenant_id: str) -> bool:
        """
        Delete print file (hard delete)
        IMPORTANT: Checks for print job references before deletion to prevent integrity errors
        """
        try:
            async with self.get_session() as session:
                # CRITICAL FIX: Check if any print jobs reference this file before attempting delete
                # This prevents foreign key constraint violations that can freeze the application
                print_jobs_result = await session.execute(
                    text("SELECT COUNT(*) as count FROM print_jobs WHERE print_file_id = :file_id"),
                    {"file_id": file_id}
                )
                print_jobs_count = print_jobs_result.scalar()

                if print_jobs_count > 0:
                    logger.warning(
                        f"Cannot delete print file {file_id}: Still referenced by {print_jobs_count} print job(s). "
                        f"Print jobs must be deleted first or print_file_id must be updated."
                    )
                    return False

                file = await session.get(PrintFile, file_id)
                if file:
                    await session.delete(file)
                    await session.commit()

                    await self.log_sync_operation(
                        operation_type="DELETE",
                        table_name="print_files",
                        record_id=file_id,
                        tenant_id=tenant_id,
                        status="SUCCESS"
                    )

                    logger.info(f"Successfully deleted print file {file_id}")
                    return True
                else:
                    logger.warning(f"Print file {file_id} not found for deletion")
                    return False

        except Exception as e:
            logger.error(f"Failed to delete print file {file_id}: {e}")
            # Explicit rollback is handled by context manager, but log the failure
            return False
    
    # Print Job operations
    
    async def get_print_job_by_id(self, job_id: str) -> Optional[PrintJob]:
        """
        Get print job by ID
        """
        try:
            async with self.get_session() as session:
                result = await session.get(PrintJob, job_id)
                return result
        except Exception as e:
            logger.error(f"Failed to get print job {job_id}: {e}")
            return None
    
    async def get_print_jobs_by_tenant(self, tenant_id: str) -> List[PrintJob]:
        """
        Get all print jobs for a tenant
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("SELECT * FROM print_jobs WHERE tenant_id = :tenant_id ORDER BY time_submitted DESC"),
                    {"tenant_id": tenant_id}
                )
                rows = result.fetchall()
                
                jobs = []
                for row in rows:
                    job = PrintJob()
                    for column in row._fields:
                        setattr(job, column, getattr(row, column))
                    jobs.append(job)
                
                return jobs
        except Exception as e:
            logger.error(f"Failed to get print jobs for tenant {tenant_id}: {e}")
            return []
    
    async def create_print_job(self, job_data: dict) -> Optional[PrintJob]:
        """Create a new print job in the local database"""
        try:
            # Generate UUID for the job
            job_id = str(uuid.uuid4())
            
            # Ensure required fields
            job_data['id'] = job_id
            if 'time_submitted' not in job_data:
                job_data['time_submitted'] = datetime.now(timezone.utc)
            if 'status' not in job_data:
                job_data['status'] = 'queued'
            if 'progress_percentage' not in job_data:
                job_data['progress_percentage'] = 0
                
            # Use async session context manager
            async with self.get_session() as session:
                # Create PrintJob object
                new_job = PrintJob(**job_data)
                
                # Add to session and commit
                session.add(new_job)
                await session.commit()
                
                logger.info(f"Created print job {job_id} for tenant {job_data.get('tenant_id')}")
                return new_job
            
        except Exception as e:
            logger.error(f"Failed to create print job: {e}")
            return None

    async def get_print_jobs_by_status(self, tenant_id: str, status: str) -> List[PrintJob]:
        """
        Get print jobs by status
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text("SELECT * FROM print_jobs WHERE tenant_id = :tenant_id AND status = :status ORDER BY priority DESC, time_submitted"),
                    {"tenant_id": tenant_id, "status": status}
                )
                rows = result.fetchall()
                
                jobs = []
                for row in rows:
                    job = PrintJob()
                    for column in row._fields:
                        setattr(job, column, getattr(row, column))
                    jobs.append(job)
                
                return jobs
        except Exception as e:
            logger.error(f"Failed to get print jobs by status {status}: {e}")
            return []
    
    async def upsert_print_job(self, job_data: Dict[str, Any]) -> Optional[PrintJob]:
        """
        Insert or update print job data
        Returns the created/updated PrintJob object
        """
        try:
            async with self.get_session() as session:
                existing = await session.get(PrintJob, job_data.get('id'))
                
                if existing:
                    # Update existing job
                    for key, value in job_data.items():
                        if hasattr(existing, key):
                            # Convert datetime strings
                            if key in ['created_at', 'updated_at', 'time_submitted', 'time_started', 'time_completed'] and isinstance(value, str):
                                try:
                                    value = datetime.fromisoformat(value.replace('Z', '+00:00').replace('+00:00', ''))
                                except (ValueError, AttributeError):
                                    logger.warning(f"Failed to parse datetime field {key}: {value}")
                                    continue
                            
                            setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                    operation_type = "UPDATE"
                    job_obj = existing
                else:
                    # Create new job - generate UUID if not provided
                    import uuid
                    if not job_data.get('id'):
                        job_data['id'] = str(uuid.uuid4())
                    
                    job = PrintJob.from_dict(job_data)
                    session.add(job)
                    operation_type = "INSERT"
                    job_obj = job
                
                await session.commit()
                
                # Refresh the object to get the latest state from DB
                await session.refresh(job_obj)

                await self.log_sync_operation(
                    operation_type=operation_type,
                    table_name="print_jobs",
                    record_id=job_obj.id,
                    tenant_id=job_obj.tenant_id,
                    status="SUCCESS"
                )
                
                logger.info(f"Successfully upserted print job {job_obj.id}")
                return job_obj
                
        except Exception as e:
            logger.error(f"Failed to upsert print job: {e}")
            return None
    
    async def update_print_job(self, job_id: str, updates: Dict[str, Any], tenant_id: str) -> bool:
        """
        Update a specific print job by ID and tenant
        Returns True if successful, False otherwise
        """
        try:
            async with self.get_session() as session:
                # Get the existing job
                result = await session.execute(
                    text("""
                        SELECT * FROM print_jobs 
                        WHERE id = :job_id AND tenant_id = :tenant_id
                    """),
                    {"job_id": job_id, "tenant_id": tenant_id}
                )
                job_row = result.fetchone()
                
                if not job_row:
                    logger.warning(f"Print job {job_id} not found for tenant {tenant_id}")
                    return False
                
                # Build update query
                set_clauses = []
                params = {"job_id": job_id, "tenant_id": tenant_id}
                
                for key, value in updates.items():
                    if key not in ['id', 'tenant_id']:  # Don't allow updating these fields
                        set_clauses.append(f"{key} = :{key}")
                        params[key] = value
                
                if not set_clauses:
                    logger.warning(f"No valid updates provided for job {job_id}")
                    return True
                
                # Add updated_at timestamp
                set_clauses.append("updated_at = :updated_at")
                params["updated_at"] = datetime.now(timezone.utc)
                
                update_query = f"""
                    UPDATE print_jobs 
                    SET {', '.join(set_clauses)}
                    WHERE id = :job_id AND tenant_id = :tenant_id
                """
                
                await session.execute(text(update_query), params)
                await session.commit()
                
                logger.info(f"Updated print job {job_id} for tenant {tenant_id}")
                return True
                
        except Exception as e:
            logger.error(f"Error updating print job {job_id}: {e}")
            return False

    async def delete_print_job(self, job_id: str, tenant_id: str) -> bool:
        """
        Delete print job (hard delete)
        """
        try:
            async with self.get_session() as session:
                job = await session.get(PrintJob, job_id)
                if job:
                    await session.delete(job)
                    await session.commit()
                    
                    await self.log_sync_operation(
                        operation_type="DELETE",
                        table_name="print_jobs",
                        record_id=job_id,
                        tenant_id=tenant_id,
                        status="SUCCESS"
                    )
                    
                    logger.info(f"Successfully deleted print job {job_id}")
                    return True
                else:
                    logger.warning(f"Print job {job_id} not found for deletion")
                    return False
                    
        except Exception as e:
            logger.error(f"Failed to delete print job {job_id}: {e}")
            return False
    
    async def delete_print_job_simple(self, job_id: str) -> bool:
        """
        Delete print job - simplified version without complex validation
        Just deletes the job if it exists, no tenant checks
        """
        try:
            async with self.get_session() as session:
                job = await session.get(PrintJob, job_id)
                if job:
                    tenant_id = job.tenant_id  # Get tenant_id before deletion
                    await session.delete(job)
                    await session.commit()
                    
                    # Still log the operation for sync purposes
                    try:
                        await self.log_sync_operation(
                            operation_type="DELETE",
                            table_name="print_jobs",
                            record_id=job_id,
                            tenant_id=tenant_id,
                            status="SUCCESS"
                        )
                    except Exception as log_error:
                        # Don't fail the deletion if logging fails
                        logger.warning(f"Failed to log sync operation for deleted job {job_id}: {log_error}")
                    
                    logger.info(f"Successfully deleted print job {job_id}")
                    return True
                else:
                    logger.info(f"Print job {job_id} not found - treating as success (already deleted)")
                    return True  # If it's not there, mission accomplished
                    
        except Exception as e:
            logger.error(f"Failed to delete print job {job_id}: {e}", exc_info=True)
            return False
    
    # Sync logging operations
    
    async def log_sync_operation(
        self, 
        operation_type: str, 
        table_name: str, 
        record_id: str = None,
        tenant_id: str = None,
        status: str = "SUCCESS", 
        error_message: str = None
    ):
        """
        Log sync operation for monitoring and debugging
        """
        try:
            async with self.get_session() as session:
                sync_log = SyncLog(
                    operation_type=operation_type,
                    table_name=table_name,
                    record_id=record_id,
                    tenant_id=tenant_id,
                    status=status,
                    error_message=error_message
                )
                session.add(sync_log)
                await session.commit()
        except Exception as e:
            # Don't let logging failures break the main operation
            logger.error(f"Failed to log sync operation: {e}")
    
    async def get_sync_stats(self) -> Dict[str, Any]:
        """
        Get synchronization statistics
        """
        try:
            async with self.get_session() as session:
                # Get recent sync activity
                recent_logs = await session.execute(
                    text("""
                        SELECT operation_type, status, COUNT(*) as count
                        FROM sync_logs 
                        WHERE created_at >= datetime('now', '-1 hour')
                        GROUP BY operation_type, status
                        ORDER BY count DESC
                    """)
                )
                
                # Get total printer count
                printer_count = await session.execute(
                    text("SELECT COUNT(*) FROM printers WHERE is_active = 1")
                )
                
                # Get last sync time
                last_sync = await session.execute(
                    text("SELECT MAX(created_at) FROM sync_logs WHERE status = 'SUCCESS'")
                )
                
                return {
                    'total_printers': printer_count.scalar() or 0,
                    'last_sync': last_sync.scalar(),
                    'recent_activity': [
                        {
                            'operation': row[0],
                            'status': row[1],
                            'count': row[2]
                        } 
                        for row in recent_logs.fetchall()
                    ]
                }
        except Exception as e:
            logger.error(f"Failed to get sync stats: {e}")
            return {
                'total_printers': 0,
                'last_sync': None,
                'recent_activity': []
            }
    
    async def migrate_add_filament_level(self):
        """
        Add filament_level column to printers table if it doesn't exist
        """
        try:
            async with self.get_session() as session:
                # Check if column already exists
                result = await session.execute(
                    text("PRAGMA table_info(printers)")
                )
                columns = result.fetchall()
                column_names = [col[1] for col in columns]

                if 'filament_level' not in column_names:
                    # Add the column
                    await session.execute(
                        text("ALTER TABLE printers ADD COLUMN filament_level INTEGER DEFAULT 0")
                    )
                    await session.commit()
                    logger.info("Successfully added filament_level column to printers table")
                else:
                    logger.info("filament_level column already exists in printers table")
                return True
        except Exception as e:
            logger.error(f"Failed to migrate printers table: {e}")
            return False

    async def migrate_add_print_file_unique_constraint(self):
        """
        Add unique constraint on print_files (product_id, printer_model_id) to prevent duplicate models per product
        This migration recreates the table with the constraint since SQLite doesn't support ADD CONSTRAINT
        """
        try:
            async with self.get_session() as session:
                # Check if constraint already exists by checking indexes
                result = await session.execute(
                    text("PRAGMA index_list('print_files')")
                )
                indexes = result.fetchall()
                constraint_exists = any('idx_print_files_product_model' in str(idx) for idx in indexes)

                if not constraint_exists:
                    logger.info("Adding unique constraint on print_files (product_id, printer_model_id)")

                    # Create unique index on (product_id, printer_model_id)
                    # NULL values in printer_model_id are allowed (for "default" files)
                    # SQLite treats NULL values as distinct, so multiple NULLs are allowed
                    await session.execute(
                        text("""
                            CREATE UNIQUE INDEX idx_print_files_product_model
                            ON print_files (product_id, printer_model_id)
                            WHERE product_id IS NOT NULL AND printer_model_id IS NOT NULL
                        """)
                    )
                    await session.commit()
                    logger.info("Successfully added unique constraint on print_files (product_id, printer_model_id)")
                else:
                    logger.info("Unique constraint on print_files (product_id, printer_model_id) already exists")
                return True
        except Exception as e:
            logger.error(f"Failed to add unique constraint to print_files table: {e}")
            return False

    async def migrate_remove_backup_queue(self):
        """
        Remove backup_queue table as backup functionality is removed
        """
        try:
            async with self.get_session() as session:
                # Check if backup_queue table exists
                result = await session.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_queue'")
                )
                table_exists = result.fetchone() is not None

                if table_exists:
                    await session.execute(text("DROP TABLE backup_queue"))
                    await session.commit()
                    logger.info("Successfully removed backup_queue table")
                else:
                    logger.info("backup_queue table does not exist, skipping migration")
                return True
        except Exception as e:
            logger.error(f"Failed to remove backup_queue table: {e}")
            return False

    async def migrate_add_maintenance_columns(self):
        """
        Add in_maintenance and maintenance_type columns to printers table if they don't exist
        """
        try:
            async with self.get_session() as session:
                # Check if columns already exist
                result = await session.execute(
                    text("PRAGMA table_info(printers)")
                )
                columns = result.fetchall()
                column_names = [col[1] for col in columns]

                # Add in_maintenance column if missing
                if 'in_maintenance' not in column_names:
                    await session.execute(
                        text("ALTER TABLE printers ADD COLUMN in_maintenance BOOLEAN DEFAULT 0")
                    )
                    logger.info("Successfully added in_maintenance column to printers table")
                else:
                    logger.info("in_maintenance column already exists in printers table")

                # Add maintenance_type column if missing
                if 'maintenance_type' not in column_names:
                    await session.execute(
                        text("ALTER TABLE printers ADD COLUMN maintenance_type TEXT")
                    )
                    logger.info("Successfully added maintenance_type column to printers table")
                else:
                    logger.info("maintenance_type column already exists in printers table")

                await session.commit()
                return True
        except Exception as e:
            logger.error(f"Failed to add maintenance columns to printers table: {e}")
            return False

    async def get_finished_goods_by_tenant(self, tenant_id: str) -> List[FinishedGoods]:
        """
        Get all finished goods for a tenant
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    select(FinishedGoods)
                    .filter(FinishedGoods.tenant_id == tenant_id)
                    .filter(FinishedGoods.is_active == True)
                    .order_by(FinishedGoods.created_at.desc())
                )
                return list(result.scalars().all())
        except Exception as e:
            logger.error(f"Failed to get finished goods for tenant {tenant_id}: {e}")
            return []

    async def get_finished_good_by_id(self, finished_good_id: str) -> Optional[FinishedGoods]:
        """
        Get a specific finished good by ID
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    select(FinishedGoods).filter(FinishedGoods.id == finished_good_id)
                )
                return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Failed to get finished good {finished_good_id}: {e}")
            return None

    async def get_finished_good_by_sku_id(self, product_sku_id: str) -> Optional[FinishedGoods]:
        """
        Get a finished good by product SKU ID
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    select(FinishedGoods)
                    .filter(FinishedGoods.product_sku_id == product_sku_id)
                    .filter(FinishedGoods.is_active == True)
                )
                return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Failed to get finished good for SKU {product_sku_id}: {e}")
            return None

    async def create_finished_good(self, finished_good: FinishedGoods) -> Optional[FinishedGoods]:
        """
        Create a new finished good
        """
        try:
            async with self.get_session() as session:
                session.add(finished_good)
                await session.commit()
                await session.refresh(finished_good)

                logger.info(f"Created finished good: {finished_good.id} for SKU: {finished_good.product_sku_id}")
                return finished_good
        except Exception as e:
            logger.error(f"Failed to create finished good: {e}")
            return None

    async def update_finished_good(self, finished_good_id: str, update_data: dict) -> Optional[FinishedGoods]:
        """
        Update a finished good
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    select(FinishedGoods).filter(FinishedGoods.id == finished_good_id)
                )
                finished_good = result.scalar_one_or_none()

                if not finished_good:
                    return None

                # Update fields
                for key, value in update_data.items():
                    if hasattr(finished_good, key):
                        # Convert dollar values to cents if needed
                        if key in ['unit_price', 'extra_cost'] and value is not None:
                            value = int(float(value) * 100)
                        elif key == 'profit_margin' and value is not None:
                            value = int(float(value) * 100)
                        setattr(finished_good, key, value)

                finished_good.updated_at = datetime.utcnow()

                await session.commit()
                await session.refresh(finished_good)

                logger.info(f"Updated finished good: {finished_good_id}")
                return finished_good
        except Exception as e:
            logger.error(f"Failed to update finished good {finished_good_id}: {e}")
            return None

    async def update_finished_good_stock(self, finished_good_id: str, new_stock: int) -> Optional[FinishedGoods]:
        """
        Update stock level for a finished good
        """
        try:
            # Determine status based on stock level
            if new_stock == 0:
                status = 'out_of_stock'
            elif new_stock < 5:
                status = 'low_stock'
            else:
                status = 'in_stock'

            return await self.update_finished_good(
                finished_good_id,
                {
                    'current_stock': new_stock,
                    'status': status
                }
            )
        except Exception as e:
            logger.error(f"Failed to update stock for finished good {finished_good_id}: {e}")
            return None


    async def update_finished_goods_from_completed_job(self, product_sku_id: str, requires_assembly: bool, quantity_per_print: int) -> bool:
        """
        Update finished goods inventory when a print job completes.
        Increments either quantity_assembled or quantity_needs_assembly based on requires_assembly flag.

        Args:
            product_sku_id: The product SKU ID from the completed print job
            requires_assembly: Whether the items require assembly
            quantity_per_print: Number of units produced by the print job

        Returns:
            True if update was successful, False otherwise
        """
        try:
            if not product_sku_id:
                logger.warning("No product_sku_id provided for finished goods update")
                return False

            async with self.get_session() as session:
                # Find the finished goods record for this SKU
                result = await session.execute(
                    select(FinishedGoods).filter(FinishedGoods.product_sku_id == product_sku_id)
                )
                finished_good = result.scalar_one_or_none()

                if not finished_good:
                    logger.warning(f"No finished goods record found for product_sku_id: {product_sku_id}")
                    return False

                # Update the appropriate quantity field
                if requires_assembly:
                    finished_good.quantity_needs_assembly = (finished_good.quantity_needs_assembly or 0) + quantity_per_print
                    logger.info(f"Updated finished goods for SKU {product_sku_id}: added {quantity_per_print} units to quantity_needs_assembly (new total: {finished_good.quantity_needs_assembly})")
                else:
                    finished_good.quantity_assembled = (finished_good.quantity_assembled or 0) + quantity_per_print
                    logger.info(f"Updated finished goods for SKU {product_sku_id}: added {quantity_per_print} units to quantity_assembled (new total: {finished_good.quantity_assembled})")

                # Update the total current_stock as well
                finished_good.current_stock = (finished_good.current_stock or 0) + quantity_per_print

                # Update status based on new stock level
                if finished_good.current_stock == 0:
                    finished_good.status = 'out_of_stock'
                elif finished_good.current_stock < (finished_good.low_stock_threshold or 5):
                    finished_good.status = 'low_stock'
                else:
                    finished_good.status = 'in_stock'

                finished_good.updated_at = datetime.utcnow()

                # Create assembly task if items require assembly
                if requires_assembly:
                    await self._create_assembly_task(session, finished_good, quantity_per_print)

                await session.commit()
                logger.info(f"Successfully updated finished goods inventory for product_sku_id: {product_sku_id}")
                return True

        except Exception as e:
            logger.error(f"Failed to update finished goods from completed job: {e}")
            return False

    async def _create_assembly_task(self, session: AsyncSession, finished_good: FinishedGoods, quantity: int):
        """
        Create an assembly task in both local SQLite and Supabase
        """
        try:
            # Get product name from product_sku relationship
            product_name = finished_good.sku  # Default to SKU if no product name available

            # Get related product_sku to find product name
            if finished_good.product_sku_id:
                sku_result = await session.execute(
                    select(ProductSku).filter(ProductSku.id == finished_good.product_sku_id)
                )
                product_sku = sku_result.scalar_one_or_none()
                if product_sku and product_sku.product_id:
                    product_result = await session.execute(
                        select(Product).filter(Product.id == product_sku.product_id)
                    )
                    product = product_result.scalar_one_or_none()
                    if product:
                        product_name = product.name

            # Create assembly task
            task_id = str(uuid.uuid4())
            assembly_task = AssemblyTask(
                id=task_id,
                tenant_id=finished_good.tenant_id,
                finished_good_id=finished_good.id,
                product_name=product_name,
                sku=finished_good.sku,
                quantity=quantity,
                status='pending',
                notes=f"Auto-created from print completion for {quantity} units"
            )

            # Add to local database session
            session.add(assembly_task)

            # Also add to Supabase
            try:
                from supabase import create_client

                config_service = get_config_service()
                supabase_config = config_service.get_supabase_config()
                tenant_id = config_service.get_tenant_id()

                if supabase_config.get('url') and supabase_config.get('anon_key'):
                    # Create Supabase client with tenant context in headers for RLS policies
                    if ClientOptions and tenant_id:
                        supabase = create_client(
                            supabase_config['url'],
                            supabase_config['anon_key'],
                            options=ClientOptions(
                                headers={
                                    "x-tenant-id": tenant_id
                                }
                            )
                        )
                    else:
                        # Fallback to simple client creation
                        supabase = create_client(
                            supabase_config['url'],
                            supabase_config['anon_key']
                        )

                    supabase_data = {
                        'id': task_id,
                        'tenant_id': finished_good.tenant_id,
                        'finished_good_id': finished_good.id,
                        'product_name': product_name,
                        'sku': finished_good.sku,
                        'quantity': quantity,
                        'status': 'pending',
                        'notes': f"Auto-created from print completion for {quantity} units"
                    }

                    result = supabase.table('assembly_tasks').insert(supabase_data).execute()
                    logger.info(f"Created assembly task in Supabase: {task_id}")
                else:
                    logger.warning("Supabase not configured, assembly task created locally only")

            except Exception as supabase_error:
                logger.error(f"Failed to create assembly task in Supabase: {supabase_error}")
                # Continue with local creation only

            # Create corresponding worklist task
            await self._create_worklist_task_for_assembly(
                session,
                supabase if 'supabase' in locals() else None,
                task_id,
                finished_good.tenant_id,
                product_name,
                finished_good.sku,
                quantity
            )

            logger.info(f"Created assembly task {task_id} for {quantity} units of {finished_good.sku}")

        except Exception as e:
            logger.error(f"Failed to create assembly task: {e}")
            # Don't raise exception to avoid breaking the finished goods update

    async def _create_worklist_task_for_assembly(self, session: AsyncSession, supabase, assembly_task_id: str, tenant_id: str, product_name: str, sku: str, quantity: int):
        """
        Create a worklist task in local SQLite for an assembly task
        Uses the provided session to avoid database locks
        """
        try:
            logger.info(f"Creating worklist task for assembly {assembly_task_id}")

            worklist_task_id = str(uuid.uuid4())

            # Handle metadata JSON serialization
            import json
            task_metadata_str = json.dumps({
                'sku': sku,
                'quantity': quantity,
                'product_name': product_name
            })

            # Create worklist task using the same session to avoid database locks
            worklist_task = WorklistTask(
                id=worklist_task_id,
                tenant_id=tenant_id,
                title=f"Assembly: {product_name}",
                subtitle=f"SKU: {sku}",
                description=f"Assemble {quantity} unit(s) of {product_name} ({sku})",
                task_type='assembly',
                priority='medium',
                status='pending',
                estimated_time_minutes=30,  # Default estimate for assembly
                assembly_task_id=assembly_task_id,
                task_metadata=task_metadata_str
            )

            # Add to the same session (will be committed with assembly task)
            session.add(worklist_task)
            logger.info(f"✅ Created worklist task {worklist_task_id} for assembly task {assembly_task_id}")

        except Exception as e:
            logger.error(f"❌ Failed to create worklist task for assembly: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            # Don't raise exception to avoid breaking the assembly task creation

    async def _sync_assembly_status_to_worklist(self, supabase, assembly_task_id: str, assembly_status: str):
        """
        Sync assembly task status changes to corresponding worklist task in local SQLite
        """
        try:
            # Map assembly status to worklist status
            status_mapping = {
                'pending': 'pending',
                'in_progress': 'in_progress',
                'completed': 'completed'
            }

            worklist_status = status_mapping.get(assembly_status, 'pending')

            # Find and update the worklist task
            update_data = {'status': worklist_status}

            # Add completion timestamp if completed
            if assembly_status == 'completed':
                update_data['completed_at'] = datetime.utcnow()

            # Find worklist task by assembly_task_id
            tasks = await self.get_worklist_tasks_by_filters({'assembly_task_id': assembly_task_id})

            if tasks:
                # Update the first matching task (there should only be one)
                await self.update_worklist_task(tasks[0].id, update_data)
                logger.info(f"Synced assembly task {assembly_task_id} status '{assembly_status}' to worklist task")
            else:
                logger.warning(f"No worklist task found for assembly task {assembly_task_id}")

        except Exception as e:
            logger.error(f"Failed to sync assembly status to worklist: {e}")
            # Don't raise exception to avoid breaking the assembly task update

    async def get_assembly_tasks_by_filters(self, filters: Dict[str, Any]) -> List[AssemblyTask]:
        """Get assembly tasks by filters"""
        try:
            async with self.get_session() as session:
                query = select(AssemblyTask)

                # Apply filters
                for key, value in filters.items():
                    if hasattr(AssemblyTask, key):
                        query = query.filter(getattr(AssemblyTask, key) == value)

                # Order by created_at desc
                query = query.order_by(AssemblyTask.created_at.desc())

                result = await session.execute(query)
                return result.scalars().all()

        except Exception as e:
            logger.error(f"Failed to get assembly tasks by filters: {e}")
            return []

    async def get_assembly_task_by_id(self, task_id: str) -> Optional[AssemblyTask]:
        """Get assembly task by ID"""
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    select(AssemblyTask).filter(AssemblyTask.id == task_id)
                )
                return result.scalar_one_or_none()

        except Exception as e:
            logger.error(f"Failed to get assembly task {task_id}: {e}")
            return None

    async def create_assembly_task(self, task_data: Dict[str, Any]) -> AssemblyTask:
        """Create a new assembly task"""
        try:
            async with self.get_session() as session:
                task = AssemblyTask(**task_data)
                session.add(task)
                await session.commit()
                await session.refresh(task)

                # Also create in Supabase
                try:
                    from supabase import create_client
                    config_service = get_config_service()
                    supabase_config = config_service.get_supabase_config()
                    tenant_id = config_service.get_tenant_id()

                    if supabase_config.get('url') and supabase_config.get('anon_key'):
                        # Create Supabase client with tenant context in headers for RLS policies
                        if ClientOptions and tenant_id:
                            supabase = create_client(
                                supabase_config['url'],
                                supabase_config['anon_key'],
                                options=ClientOptions(
                                    headers={
                                        "x-tenant-id": tenant_id
                                    }
                                )
                            )
                        else:
                            # Fallback to simple client creation
                            supabase = create_client(
                                supabase_config['url'],
                                supabase_config['anon_key']
                            )
                        supabase_data = {k: v for k, v in task_data.items() if v is not None}
                        result = supabase.table('assembly_tasks').insert(supabase_data).execute()
                        logger.info(f"Created assembly task in Supabase: {task.id}")

                        # Create corresponding worklist task
                        await self._create_worklist_task_for_assembly(
                            supabase,
                            task.id,
                            task.tenant_id,
                            task.product_name,
                            task.sku,
                            task.quantity
                        )

                except Exception as supabase_error:
                    logger.error(f"Failed to create assembly task in Supabase: {supabase_error}")

                return task

        except Exception as e:
            logger.error(f"Failed to create assembly task: {e}")
            raise

    async def update_assembly_task(self, task_id: str, update_data: Dict[str, Any]) -> Optional[AssemblyTask]:
        """Update an assembly task"""
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    select(AssemblyTask).filter(AssemblyTask.id == task_id)
                )
                task = result.scalar_one_or_none()

                if not task:
                    return None

                # Update fields
                for key, value in update_data.items():
                    if hasattr(task, key):
                        setattr(task, key, value)

                task.updated_at = datetime.utcnow()

                # When assembly task is completed, update finished goods stock levels
                if 'status' in update_data and update_data['status'] == 'completed':
                    try:
                        # Get the finished good associated with this assembly task
                        fg_result = await session.execute(
                            select(FinishedGoods).filter(FinishedGoods.id == task.finished_good_id)
                        )
                        finished_good = fg_result.scalar_one_or_none()

                        if finished_good:
                            # Always add the full task quantity to quantity_assembled
                            finished_good.quantity_assembled = (finished_good.quantity_assembled or 0) + task.quantity

                            # Safely subtract from quantity_needs_assembly (prevent negative values)
                            current_needs_assembly = finished_good.quantity_needs_assembly or 0
                            finished_good.quantity_needs_assembly = max(0, current_needs_assembly - task.quantity)

                            finished_good.updated_at = datetime.utcnow()

                            logger.info(f"Assembly task {task_id} completed: Added {task.quantity} units to quantity_assembled "
                                      f"for finished good {finished_good.id} (SKU: {finished_good.sku}). "
                                      f"New assembled: {finished_good.quantity_assembled}, "
                                      f"New needs assembly: {finished_good.quantity_needs_assembly}")
                        else:
                            logger.warning(f"No finished good found for assembly task {task_id} with finished_good_id {task.finished_good_id}")

                    except Exception as stock_error:
                        logger.error(f"Failed to update stock levels for assembly task {task_id}: {stock_error}")
                        # Don't raise - allow the assembly task update to complete even if stock update fails

                await session.commit()
                await session.refresh(task)

                # Also update in Supabase
                try:
                    from supabase import create_client
                    config_service = get_config_service()
                    supabase_config = config_service.get_supabase_config()
                    tenant_id = config_service.get_tenant_id()

                    if supabase_config.get('url') and supabase_config.get('anon_key'):
                        # Create Supabase client with tenant context in headers for RLS policies
                        if ClientOptions and tenant_id:
                            supabase = create_client(
                                supabase_config['url'],
                                supabase_config['anon_key'],
                                options=ClientOptions(
                                    headers={
                                        "x-tenant-id": tenant_id
                                    }
                                )
                            )
                        else:
                            # Fallback to simple client creation
                            supabase = create_client(
                                supabase_config['url'],
                                supabase_config['anon_key']
                            )
                        supabase_update = {k: v for k, v in update_data.items() if v is not None}
                        if 'completed_at' in supabase_update and isinstance(supabase_update['completed_at'], datetime):
                            supabase_update['completed_at'] = supabase_update['completed_at'].isoformat()
                        supabase_update['updated_at'] = datetime.utcnow().isoformat()

                        result = supabase.table('assembly_tasks').update(supabase_update).eq('id', task_id).execute()
                        logger.info(f"Updated assembly task in Supabase: {task_id}")

                        # Sync status to worklist task if status changed
                        if 'status' in update_data:
                            await self._sync_assembly_status_to_worklist(supabase, task_id, update_data['status'])

                except Exception as supabase_error:
                    logger.error(f"Failed to update assembly task in Supabase: {supabase_error}")

                return task

        except Exception as e:
            logger.error(f"Failed to update assembly task {task_id}: {e}")
            raise

    async def delete_assembly_task(self, task_id: str) -> bool:
        """Delete an assembly task"""
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    select(AssemblyTask).filter(AssemblyTask.id == task_id)
                )
                task = result.scalar_one_or_none()

                if not task:
                    return False

                await session.delete(task)
                await session.commit()

                # Also delete from Supabase
                try:
                    from supabase import create_client
                    config_service = get_config_service()
                    supabase_config = config_service.get_supabase_config()
                    tenant_id = config_service.get_tenant_id()

                    if supabase_config.get('url') and supabase_config.get('anon_key'):
                        # Create Supabase client with tenant context in headers for RLS policies
                        if ClientOptions and tenant_id:
                            supabase = create_client(
                                supabase_config['url'],
                                supabase_config['anon_key'],
                                options=ClientOptions(
                                    headers={
                                        "x-tenant-id": tenant_id
                                    }
                                )
                            )
                        else:
                            # Fallback to simple client creation
                            supabase = create_client(
                                supabase_config['url'],
                                supabase_config['anon_key']
                            )
                        result = supabase.table('assembly_tasks').delete().eq('id', task_id).execute()
                        logger.info(f"Deleted assembly task from Supabase: {task_id}")

                except Exception as supabase_error:
                    logger.error(f"Failed to delete assembly task from Supabase: {supabase_error}")

                return True

        except Exception as e:
            logger.error(f"Failed to delete assembly task {task_id}: {e}")
            return False

    # ============ Worklist Tasks CRUD Operations ============

    async def get_worklist_tasks_by_filters(self, filters: Dict[str, Any]) -> List[WorklistTask]:
        """Get worklist tasks by filters"""
        try:
            async with self.get_session() as session:
                query = select(WorklistTask)

                # Apply filters
                for key, value in filters.items():
                    if hasattr(WorklistTask, key):
                        query = query.filter(getattr(WorklistTask, key) == value)

                # Order by created_at desc
                query = query.order_by(WorklistTask.created_at.desc())

                result = await session.execute(query)
                return result.scalars().all()

        except Exception as e:
            logger.error(f"Failed to get worklist tasks by filters: {e}")
            return []

    async def get_worklist_task_by_id(self, task_id: str) -> Optional[WorklistTask]:
        """Get worklist task by ID"""
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    select(WorklistTask).filter(WorklistTask.id == task_id)
                )
                return result.scalar_one_or_none()

        except Exception as e:
            logger.error(f"Failed to get worklist task {task_id}: {e}")
            return None

    async def create_worklist_task(self, task_data: Dict[str, Any]) -> WorklistTask:
        """Create a new worklist task"""
        try:
            async with self.get_session() as session:
                # Handle metadata JSON serialization
                if 'task_metadata' in task_data and task_data['task_metadata'] is not None:
                    import json
                    if not isinstance(task_data['task_metadata'], str):
                        task_data['task_metadata'] = json.dumps(task_data['task_metadata'])

                task = WorklistTask(**task_data)
                session.add(task)
                await session.commit()
                await session.refresh(task)

                logger.info(f"Created worklist task in local DB: {task.id}")
                return task

        except Exception as e:
            logger.error(f"Failed to create worklist task: {e}")
            raise

    async def update_worklist_task(self, task_id: str, update_data: Dict[str, Any]) -> Optional[WorklistTask]:
        """Update a worklist task"""
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    select(WorklistTask).filter(WorklistTask.id == task_id)
                )
                task = result.scalar_one_or_none()

                if not task:
                    return None

                # Update fields
                for key, value in update_data.items():
                    if hasattr(task, key):
                        # Handle metadata JSON serialization
                        if key == 'task_metadata' and value is not None:
                            import json
                            if not isinstance(value, str):
                                value = json.dumps(value)
                        setattr(task, key, value)

                task.updated_at = datetime.utcnow()
                await session.commit()
                await session.refresh(task)

                logger.info(f"Updated worklist task in local DB: {task_id}")
                return task

        except Exception as e:
            logger.error(f"Failed to update worklist task {task_id}: {e}")
            raise

    async def delete_worklist_task(self, task_id: str) -> bool:
        """Delete a worklist task"""
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    select(WorklistTask).filter(WorklistTask.id == task_id)
                )
                task = result.scalar_one_or_none()

                if not task:
                    return False

                await session.delete(task)
                await session.commit()

                logger.info(f"Deleted worklist task from local DB: {task_id}")
                return True

        except Exception as e:
            logger.error(f"Failed to delete worklist task {task_id}: {e}")
            return False

    async def cleanup_old_logs(self, days_to_keep: int = 7):
        """
        Clean up old sync logs to prevent database bloat
        """
        try:
            async with self.get_session() as session:
                result = await session.execute(
                    text(f"DELETE FROM sync_logs WHERE created_at < datetime('now', '-{days_to_keep} days')")
                )
                await session.commit()
                logger.info(f"Cleaned up {result.rowcount} old sync logs")
        except Exception as e:
            logger.error(f"Failed to cleanup old logs: {e}")


# Global database service instance
db_service: Optional[DatabaseService] = None

async def get_database_service() -> DatabaseService:
    """
    Get or create global database service instance
    """
    global db_service
    if db_service is None:
        db_service = DatabaseService()
        await db_service.initialize_database()
    return db_service

async def close_database_service():
    """
    Close the global database service
    """
    global db_service
    if db_service is not None:
        await db_service.close()
        db_service = None