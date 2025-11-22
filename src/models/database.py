"""
SQLAlchemy database models for local SQLite storage
Mirrors the Supabase printers table structure for local caching
"""

from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, Date, Text, Float,
    CheckConstraint, UniqueConstraint, Index, ForeignKey, create_engine
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

Base = declarative_base()

class Printer(Base):
    """
    Local SQLite model for printers table
    Mirrors the Supabase printers table structure
    """
    __tablename__ = 'printers'
    
    # Primary key
    id = Column(String(36), primary_key=True)  # UUID as string in SQLite
    
    # Foreign key reference (stored but not enforced in SQLite)
    tenant_id = Column(String(36), nullable=False)
    
    # Basic printer information
    name = Column(Text, nullable=False)
    model = Column(Text, nullable=False)
    manufacturer = Column(Text)
    firmware_version = Column(Text)
    
    # Usage and maintenance
    total_print_time = Column(Integer, default=0)
    last_maintenance_date = Column(Date)
    
    # Status information
    status = Column(Text, default='idle')
    current_color = Column(Text)
    current_color_hex = Column(Text)
    current_filament_type = Column(Text)
    current_build_plate = Column(Text)
    filament_level = Column(Integer, default=0)  # Filament amount in grams
    nozzle_size = Column(Float)  # Nozzle size in mm (0.2, 0.4, 0.6, 0.8)
    location = Column(Text)
    
    # Connection details
    connection_type = Column(Text, default='bambu')
    ip_address = Column(Text)
    serial_number = Column(Text)
    access_code = Column(Text)
    
    # Connection status
    is_connected = Column(Boolean, default=False)
    last_connection_attempt = Column(DateTime)
    connection_error = Column(Text)

    # Management fields
    is_active = Column(Boolean, default=True)
    cleared = Column(Boolean, default=True)  # Track if print bed has been cleared
    sort_order = Column(Integer, default=0)
    printer_id = Column(Integer)

    # Maintenance tracking
    in_maintenance = Column(Boolean, default=False)
    maintenance_type = Column(Text)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Table constraints
    __table_args__ = (
        UniqueConstraint('tenant_id', 'name', name='unique_tenant_name'),
        UniqueConstraint('tenant_id', 'printer_id', name='unique_tenant_printer_id'),
        CheckConstraint(
            "connection_type IN ('bambu', 'prusa', 'ender', 'other')",
            name='check_connection_type'
        ),
        CheckConstraint(
            "status IN ('idle', 'printing', 'maintenance', 'offline')",
            name='check_status'
        ),
        Index('idx_printers_sort_order', 'tenant_id', 'sort_order'),
        Index('idx_printers_connection', 'tenant_id', 'is_connected'),
        Index('idx_printers_ip_address', 'ip_address'),
    )
    
    # Relationships
    print_jobs = relationship("PrintJob", back_populates="printer")
    
    def to_dict(self):
        """Convert model to dictionary for API responses"""
        def safe_isoformat(dt):
            """Safely convert datetime to ISO format string"""
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt  # Already a string
            return dt.isoformat()
            
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'name': self.name,
            'model': self.model,
            'manufacturer': self.manufacturer,
            'firmware_version': self.firmware_version,
            'total_print_time': self.total_print_time,
            'last_maintenance_date': safe_isoformat(self.last_maintenance_date),
            'status': self.status,
            'current_color': self.current_color,
            'current_color_hex': self.current_color_hex,
            'current_filament_type': self.current_filament_type,
            'current_build_plate': self.current_build_plate,
            'filament_level': self.filament_level,
            'nozzle_size': self.nozzle_size,
            'location': self.location,
            'connection_type': self.connection_type,
            'ip_address': self.ip_address,
            'serial_number': self.serial_number,
            'access_code': self.access_code,
            'is_connected': self.is_connected,
            'last_connection_attempt': safe_isoformat(self.last_connection_attempt),
            'connection_error': self.connection_error,
            'is_active': self.is_active,
            'cleared': self.cleared,
            'sort_order': self.sort_order,
            'printer_id': self.printer_id,
            'in_maintenance': self.in_maintenance,
            'maintenance_type': self.maintenance_type,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
        }
    
    @classmethod
    def from_dict(cls, data: dict):
        """Create model instance from dictionary data"""
        # Convert datetime strings to datetime objects
        created_at = data.get('created_at')
        if created_at and isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        updated_at = data.get('updated_at')
        if updated_at and isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        last_connection = data.get('last_connection_attempt')
        if last_connection and isinstance(last_connection, str):
            last_connection = datetime.fromisoformat(last_connection.replace('Z', '+00:00').replace('+00:00', ''))
        
        last_maintenance = data.get('last_maintenance_date')
        if last_maintenance and isinstance(last_maintenance, str):
            # Parse date only (YYYY-MM-DD format)
            from datetime import date
            last_maintenance = date.fromisoformat(last_maintenance)
        
        return cls(
            id=data.get('id'),
            tenant_id=data.get('tenant_id'),
            name=data.get('name'),
            model=data.get('model'),
            manufacturer=data.get('manufacturer'),
            firmware_version=data.get('firmware_version'),
            total_print_time=data.get('total_print_time', 0),
            last_maintenance_date=last_maintenance,
            status=data.get('status', 'idle'),
            current_color=data.get('current_color'),
            current_color_hex=data.get('current_color_hex'),
            current_filament_type=data.get('current_filament_type'),
            current_build_plate=data.get('current_build_plate'),
            nozzle_size=data.get('nozzle_size'),
            location=data.get('location'),
            connection_type=data.get('connection_type', 'bambu'),
            ip_address=data.get('ip_address'),
            serial_number=data.get('serial_number'),
            access_code=data.get('access_code'),
            is_connected=data.get('is_connected', False),
            last_connection_attempt=last_connection,
            connection_error=data.get('connection_error'),
            is_active=data.get('is_active', True),
            cleared=data.get('cleared', True),
            sort_order=data.get('sort_order', 0),
            printer_id=data.get('printer_id'),
            in_maintenance=data.get('in_maintenance', False),
            maintenance_type=data.get('maintenance_type'),
            created_at=created_at,
            updated_at=updated_at,
        )


class ColorPreset(Base):
    """
    Local SQLite model for color_presets table
    Mirrors the Supabase color_presets table structure
    """
    __tablename__ = 'color_presets'
    
    # Primary key
    id = Column(String(36), primary_key=True)  # UUID as string in SQLite
    
    # Foreign key reference (stored but not enforced in SQLite)
    tenant_id = Column(String(36), nullable=False)
    
    # Color preset information
    color_name = Column(Text, nullable=False)
    hex_code = Column(Text, nullable=False)
    filament_type = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Table constraints
    __table_args__ = (
        UniqueConstraint('tenant_id', 'color_name', 'filament_type', name='unique_tenant_color_filament'),
        Index('idx_color_presets_tenant', 'tenant_id'),
        Index('idx_color_presets_filament_type', 'filament_type'),
    )
    
    def to_dict(self):
        """Convert model to dictionary for API responses"""
        def safe_isoformat(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt
            return dt.isoformat()
            
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'color_name': self.color_name,
            'hex_code': self.hex_code,
            'filament_type': self.filament_type,
            'is_active': self.is_active,
            'created_at': safe_isoformat(self.created_at),
        }
    
    @classmethod
    def from_dict(cls, data: dict):
        """Create model instance from dictionary data"""
        # Convert datetime strings to datetime objects
        created_at = data.get('created_at')
        if created_at and isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        return cls(
            id=data.get('id'),
            tenant_id=data.get('tenant_id'),
            color_name=data.get('color_name'),
            hex_code=data.get('hex_code'),
            filament_type=data.get('filament_type'),
            is_active=data.get('is_active', True),
            created_at=created_at,
        )


class BuildPlateType(Base):
    """
    Local SQLite model for build_plate_types table
    Stores build plate type presets for printers
    """
    __tablename__ = 'build_plate_types'

    # Primary key
    id = Column(String(36), primary_key=True)  # UUID as string in SQLite

    # Foreign key reference (stored but not enforced in SQLite)
    tenant_id = Column(String(36), nullable=False)

    # Build plate information
    name = Column(Text, nullable=False)
    description = Column(Text)
    is_active = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Table constraints
    __table_args__ = (
        UniqueConstraint('tenant_id', 'name', name='unique_tenant_build_plate_name'),
        Index('idx_build_plate_types_tenant', 'tenant_id'),
    )

    def to_dict(self):
        """Convert model to dictionary for API responses"""
        def safe_isoformat(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt
            return dt.isoformat()

        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'name': self.name,
            'description': self.description,
            'is_active': self.is_active,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
        }

    @classmethod
    def from_dict(cls, data: dict):
        """Create model instance from dictionary data"""
        # Convert datetime strings to datetime objects
        created_at = data.get('created_at')
        if created_at and isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00').replace('+00:00', ''))

        updated_at = data.get('updated_at')
        if updated_at and isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00').replace('+00:00', ''))

        return cls(
            id=data.get('id'),
            tenant_id=data.get('tenant_id'),
            name=data.get('name'),
            description=data.get('description'),
            is_active=data.get('is_active', True),
            created_at=created_at,
            updated_at=updated_at,
        )


class SyncLog(Base):
    """
    Track synchronization operations for debugging and monitoring
    """
    __tablename__ = 'sync_logs'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    operation_type = Column(String(10))  # INSERT, UPDATE, DELETE, ERROR
    table_name = Column(String(50))
    record_id = Column(String(36))
    tenant_id = Column(String(36))
    status = Column(String(20))  # SUCCESS, FAILED, PENDING
    error_message = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        Index('idx_sync_logs_status', 'status'),
        Index('idx_sync_logs_tenant', 'tenant_id'),
        Index('idx_sync_logs_created', 'created_at'),
    )


class Product(Base):
    """
    Local SQLite model for products table
    Mirrors the Supabase products table structure
    """
    __tablename__ = 'products'
    
    # Primary key
    id = Column(String(36), primary_key=True)  # UUID as string in SQLite
    
    # Foreign key reference (stored but not enforced in SQLite)
    tenant_id = Column(String(36), nullable=False)
    
    # Product information
    name = Column(Text, nullable=False)
    description = Column(Text)
    category = Column(Text)
    print_file_id = Column(String(36))
    file_name = Column(Text)
    requires_assembly = Column(Boolean, default=False)
    requires_post_processing = Column(Boolean, default=False)
    printer_priority = Column(Text, default=None)
    image_url = Column(Text)
    is_active = Column(Boolean, default=True)
    wiki_id = Column(String(36), nullable=True)  # Link to product_wikis in Supabase
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Table constraints
    __table_args__ = (
        UniqueConstraint('tenant_id', 'name', name='unique_tenant_product_name'),
        Index('idx_products_tenant', 'tenant_id'),
        Index('idx_products_category', 'category'),
        Index('idx_products_active', 'is_active'),
    )
    
    # Relationships
    skus = relationship("ProductSku", back_populates="product")
    print_files = relationship("PrintFile", back_populates="product")
    
    def to_dict(self):
        """Convert model to dictionary for API responses"""
        def safe_isoformat(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt
            return dt.isoformat()

        result = {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'name': self.name,
            'description': self.description,
            'category': self.category,
            'print_file_id': self.print_file_id,
            'file_name': self.file_name,
            'requires_assembly': self.requires_assembly,
            'requires_post_processing': self.requires_post_processing,
            'printer_priority': self.printer_priority,
            'image_url': self.image_url,
            'is_active': self.is_active,
            'wiki_id': self.wiki_id,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
        }

        # Include print_files relationship if loaded
        if hasattr(self, 'print_files') and self.print_files:
            result['print_files'] = [
                {
                    'id': pf.id,
                    'name': pf.name,
                    'printer_model_id': pf.printer_model_id,
                    'file_name': pf.name  # Use name as file_name for consistency
                }
                for pf in self.print_files
            ]

        return result
    
    @classmethod
    def from_dict(cls, data: dict):
        """Create model instance from dictionary data"""
        # Convert datetime strings to datetime objects
        created_at = data.get('created_at')
        if created_at and isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        updated_at = data.get('updated_at')
        if updated_at and isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        return cls(
            id=data.get('id'),
            tenant_id=data.get('tenant_id'),
            name=data.get('name'),
            description=data.get('description'),
            category=data.get('category'),
            print_file_id=data.get('print_file_id'),
            file_name=data.get('file_name'),
            requires_assembly=data.get('requires_assembly', False),
            requires_post_processing=data.get('requires_post_processing', False),
            image_url=data.get('image_url'),
            is_active=data.get('is_active', True),
            wiki_id=data.get('wiki_id'),
            created_at=created_at,
            updated_at=updated_at,
        )


class ProductSku(Base):
    """
    Local SQLite model for product_skus table
    Mirrors the Supabase product_skus table structure
    """
    __tablename__ = 'product_skus'
    
    # Primary key
    id = Column(String(36), primary_key=True)  # UUID as string in SQLite
    
    # Foreign key references with constraints
    product_id = Column(String(36), ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
    tenant_id = Column(String(36), nullable=False)
    
    # SKU information
    sku = Column(Text, nullable=False)
    color = Column(Text, nullable=False)
    filament_type = Column(Text)
    hex_code = Column(Text)
    quantity = Column(Integer, nullable=False, default=1)
    stock_level = Column(Integer, nullable=False, default=0)
    price = Column(Integer)  # Store as cents/pennies to avoid float issues
    low_stock_threshold = Column(Integer, nullable=True, default=0)
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Table constraints
    __table_args__ = (
        Index('idx_product_skus_tenant', 'tenant_id'),
        Index('idx_product_skus_product', 'product_id'),
        Index('idx_product_skus_tenant_product', 'tenant_id', 'product_id'),
        Index('idx_product_skus_sku', 'sku'),
        # Note: unique_active_sku_per_tenant constraint from Supabase handled in application logic
    )
    
    # Relationships
    product = relationship("Product", back_populates="skus")
    print_jobs = relationship("PrintJob", back_populates="product_sku")
    
    def to_dict(self):
        """Convert model to dictionary for API responses"""
        def safe_isoformat(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt
            return dt.isoformat()
            
        return {
            'id': self.id,
            'product_id': self.product_id,
            'tenant_id': self.tenant_id,
            'sku': self.sku,
            'color': self.color,
            'filament_type': self.filament_type,
            'hex_code': self.hex_code,
            'quantity': self.quantity,
            'stock_level': self.stock_level,
            'price': self.price / 100.0 if self.price else None,  # Convert cents to dollars
            'low_stock_threshold': self.low_stock_threshold,
            'is_active': self.is_active,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
        }
    
    @classmethod
    def from_dict(cls, data: dict):
        """Create model instance from dictionary data"""
        # Convert datetime strings to datetime objects
        created_at = data.get('created_at')
        if created_at and isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        updated_at = data.get('updated_at')
        if updated_at and isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        # Convert price from decimal to cents
        price = data.get('price')
        if price is not None:
            price = int(float(price) * 100)
        
        return cls(
            id=data.get('id'),
            product_id=data.get('product_id'),
            tenant_id=data.get('tenant_id'),
            sku=data.get('sku'),
            color=data.get('color'),
            filament_type=data.get('filament_type'),
            hex_code=data.get('hex_code'),
            quantity=data.get('quantity', 1),
            stock_level=data.get('stock_level', 0),
            price=price,
            low_stock_threshold=data.get('low_stock_threshold', 0),
            is_active=data.get('is_active', True),
            created_at=created_at,
            updated_at=updated_at,
        )


class PrintFile(Base):
    """
    Local SQLite model for print_files table
    Mirrors the Supabase print_files table structure
    """
    __tablename__ = 'print_files'
    
    # Primary key
    id = Column(String(36), primary_key=True)  # UUID as string in SQLite
    
    # Foreign key references with constraints
    tenant_id = Column(String(36), nullable=False)
    product_id = Column(String(36), ForeignKey('products.id'))
    
    # File information
    name = Column(Text, nullable=False)
    file_size_bytes = Column(Integer)
    number_of_units = Column(Integer, default=1)
    local_file_path = Column(Text)  # Path to file on Pi filesystem

    # 3MF Metadata (extracted from file)
    print_time_seconds = Column(Integer)  # Print duration estimate in seconds
    filament_weight_grams = Column(Float)  # Total filament weight in grams
    filament_length_meters = Column(Float)  # Total filament length in meters
    filament_type = Column(Text)  # Material type (PLA, PETG, ABS, etc.)
    printer_model_id = Column(Text)  # Bambu printer model code (N1, N2S, P1P, X1, etc.)
    nozzle_diameter = Column(Float)  # Nozzle size in millimeters
    layer_count = Column(Integer)  # Total number of layers
    curr_bed_type = Column(Text)  # Bed/plate type (e.g., "Textured PEI Plate")
    default_print_profile = Column(Text)  # Print profile used (e.g., "0.20mm Standard @BBL A1")
    object_count = Column(Integer, default=1)  # Number of objects/instances in the print file

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Table constraints
    __table_args__ = (
        UniqueConstraint('tenant_id', 'name', name='unique_tenant_file_name'),
        Index('idx_print_files_tenant', 'tenant_id'),
        Index('idx_print_files_product', 'product_id'),
    )
    
    # Relationships
    product = relationship("Product", back_populates="print_files")
    print_jobs = relationship("PrintJob", back_populates="print_file")
    
    def to_dict(self):
        """Convert model to dictionary for API responses"""
        def safe_isoformat(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt
            return dt.isoformat()
            
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'product_id': self.product_id,
            'name': self.name,
            'file_size_bytes': self.file_size_bytes,
            'number_of_units': self.number_of_units,
            'local_file_path': self.local_file_path,
            'print_time_seconds': self.print_time_seconds,
            'filament_weight_grams': self.filament_weight_grams,
            'filament_length_meters': self.filament_length_meters,
            'filament_type': self.filament_type,
            'printer_model_id': self.printer_model_id,
            'nozzle_diameter': self.nozzle_diameter,
            'layer_count': self.layer_count,
            'curr_bed_type': self.curr_bed_type,
            'default_print_profile': self.default_print_profile,
            'object_count': self.object_count,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
        }
    
    @classmethod
    def from_dict(cls, data: dict):
        """Create model instance from dictionary data"""
        # Convert datetime strings to datetime objects
        created_at = data.get('created_at')
        if created_at and isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        updated_at = data.get('updated_at')
        if updated_at and isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        return cls(
            id=data.get('id'),
            tenant_id=data.get('tenant_id'),
            product_id=data.get('product_id'),
            name=data.get('name'),
            file_size_bytes=data.get('file_size_bytes'),
            number_of_units=data.get('number_of_units', 1),
            local_file_path=data.get('local_file_path'),
            print_time_seconds=data.get('print_time_seconds'),
            filament_weight_grams=data.get('filament_weight_grams'),
            filament_length_meters=data.get('filament_length_meters'),
            filament_type=data.get('filament_type'),
            printer_model_id=data.get('printer_model_id'),
            nozzle_diameter=data.get('nozzle_diameter'),
            layer_count=data.get('layer_count'),
            curr_bed_type=data.get('curr_bed_type'),
            default_print_profile=data.get('default_print_profile'),
            object_count=data.get('object_count'),
            created_at=created_at,
            updated_at=updated_at,
        )


class PrintJob(Base):
    """
    Local SQLite model for print_jobs table
    Mirrors the Supabase print_jobs table structure
    """
    __tablename__ = 'print_jobs'
    
    # Primary key
    id = Column(String(36), primary_key=True)  # UUID as string in SQLite
    
    # Foreign key references with constraints
    tenant_id = Column(String(36), nullable=False)
    printer_id = Column(String(36), ForeignKey('printers.id'))
    print_file_id = Column(String(36), ForeignKey('print_files.id'), nullable=False)
    product_sku_id = Column(String(36), ForeignKey('product_skus.id'))
    submitted_by = Column(String(36))
    
    # Job information
    file_name = Column(Text, nullable=False)
    status = Column(Text, default='queued')  # queued, printing, completed, failed, cancelled
    color = Column(Text, nullable=False)
    filament_type = Column(Text, nullable=False)
    material_type = Column(Text, nullable=False)
    number_of_units = Column(Integer, nullable=False, default=1)
    
    # Print metrics
    filament_needed_grams = Column(Integer)  # Store as integer grams
    estimated_print_time_minutes = Column(Integer)
    actual_print_time_minutes = Column(Integer)
    progress_percentage = Column(Integer, default=0)

    # Printer tracking
    bambu_job_id = Column(Text)  # Bambu printer's job ID for tracking
    printer_numeric_id = Column(Integer)  # Simple printer ID (4, 7) for printer manager
    last_sync_time = Column(DateTime)  # Last time job was synced with printer

    # Queue management
    priority = Column(Integer, default=0)
    failure_reason = Column(Text)
    
    # Timestamps
    time_submitted = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    time_started = Column(DateTime)
    time_completed = Column(DateTime)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # SKU-related fields
    requires_assembly = Column(Boolean, default=False)
    quantity_per_print = Column(Integer, default=1)

    # Denormalized fields for reporting and display
    product_id = Column(String(36))  # FK to products table
    product_name = Column(Text)  # Denormalized product name
    sku_name = Column(Text)  # Denormalized SKU code (e.g., "BAGCLIP-RED-001")
    printer_model = Column(Text)  # Denormalized printer model (e.g., "A1", "A1 Mini")
    printer_name = Column(Text)  # Denormalized printer name (e.g., "Nates A1", "A1 Minii")

    # Table constraints
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'processing', 'uploaded', 'printing', 'completed', 'failed', 'cancelled')",
            name='check_print_job_status'
        ),
        Index('idx_print_jobs_tenant', 'tenant_id'),
        Index('idx_print_jobs_printer', 'printer_id'),
        Index('idx_print_jobs_status', 'status'),
        Index('idx_print_jobs_priority', 'priority'),
        Index('idx_print_jobs_submitted', 'time_submitted'),
    )
    
    # Relationships
    printer = relationship("Printer", back_populates="print_jobs")
    print_file = relationship("PrintFile", back_populates="print_jobs")
    product_sku = relationship("ProductSku", back_populates="print_jobs")
    
    def to_dict(self):
        """Convert model to dictionary for API responses"""
        def safe_isoformat(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt
            return dt.isoformat()
            
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'printer_id': self.printer_id,
            'print_file_id': self.print_file_id,
            'product_sku_id': self.product_sku_id,
            'submitted_by': self.submitted_by,
            'file_name': self.file_name,
            'status': self.status,
            'color': self.color,
            'filament_type': self.filament_type,
            'material_type': self.material_type,
            'number_of_units': self.number_of_units,
            'filament_needed_grams': self.filament_needed_grams / 100.0 if self.filament_needed_grams else None,  # Convert to decimal
            'estimated_print_time_minutes': self.estimated_print_time_minutes,
            'actual_print_time_minutes': self.actual_print_time_minutes,
            'progress_percentage': self.progress_percentage,
            'bambu_job_id': self.bambu_job_id,
            'printer_numeric_id': self.printer_numeric_id,
            'last_sync_time': safe_isoformat(self.last_sync_time),
            'priority': self.priority,
            'failure_reason': self.failure_reason,
            'time_submitted': safe_isoformat(self.time_submitted),
            'time_started': safe_isoformat(self.time_started),
            'time_completed': safe_isoformat(self.time_completed),
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
            'requires_assembly': self.requires_assembly,
            'quantity_per_print': self.quantity_per_print,
            'product_id': self.product_id,
            'product_name': self.product_name,
            'sku_name': self.sku_name,
            'printer_model': self.printer_model,
            'printer_name': self.printer_name,
        }
    
    @classmethod
    def from_dict(cls, data: dict):
        """Create model instance from dictionary data"""
        # Convert datetime strings to datetime objects
        created_at = data.get('created_at')
        if created_at and isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        updated_at = data.get('updated_at')
        if updated_at and isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        time_submitted = data.get('time_submitted')
        if time_submitted and isinstance(time_submitted, str):
            time_submitted = datetime.fromisoformat(time_submitted.replace('Z', '+00:00').replace('+00:00', ''))
        
        time_started = data.get('time_started')
        if time_started and isinstance(time_started, str):
            time_started = datetime.fromisoformat(time_started.replace('Z', '+00:00').replace('+00:00', ''))
        
        time_completed = data.get('time_completed')
        if time_completed and isinstance(time_completed, str):
            time_completed = datetime.fromisoformat(time_completed.replace('Z', '+00:00').replace('+00:00', ''))
        
        # Convert filament_needed_grams from decimal to integer (store as centrigrams for precision)
        filament_needed = data.get('filament_needed_grams')
        if filament_needed is not None:
            filament_needed = int(float(filament_needed) * 100)

        # Parse last_sync_time if present
        last_sync_time = data.get('last_sync_time')
        if last_sync_time and isinstance(last_sync_time, str):
            last_sync_time = datetime.fromisoformat(last_sync_time.replace('Z', '+00:00').replace('+00:00', ''))

        return cls(
            id=data.get('id'),
            tenant_id=data.get('tenant_id'),
            printer_id=data.get('printer_id'),
            print_file_id=data.get('print_file_id'),
            product_sku_id=data.get('product_sku_id'),
            submitted_by=data.get('submitted_by'),
            file_name=data.get('file_name'),
            status=data.get('status', 'queued'),
            color=data.get('color'),
            filament_type=data.get('filament_type'),
            material_type=data.get('material_type'),
            number_of_units=data.get('number_of_units', 1),
            filament_needed_grams=filament_needed,
            estimated_print_time_minutes=data.get('estimated_print_time_minutes'),
            actual_print_time_minutes=data.get('actual_print_time_minutes'),
            progress_percentage=data.get('progress_percentage', 0),
            bambu_job_id=data.get('bambu_job_id'),
            printer_numeric_id=data.get('printer_numeric_id'),
            last_sync_time=last_sync_time,
            priority=data.get('priority', 0),
            failure_reason=data.get('failure_reason'),
            time_submitted=time_submitted,
            time_started=time_started,
            time_completed=time_completed,
            created_at=created_at,
            updated_at=updated_at,
        )


class FinishedGoods(Base):
    """
    Local SQLite model for finished_goods table
    Mirrors the Supabase finished_goods table structure
    """
    __tablename__ = 'finished_goods'

    # Primary key
    id = Column(String(36), primary_key=True)  # UUID as string in SQLite

    # Foreign key references
    product_sku_id = Column(String(36), ForeignKey('product_skus.id', ondelete='CASCADE'), nullable=False)
    tenant_id = Column(String(36), nullable=False)
    print_job_id = Column(String(36), ForeignKey('print_jobs.id'))

    # Product information
    sku = Column(Text, nullable=False)
    color = Column(Text, nullable=False)
    material = Column(Text, nullable=False)

    # Stock and pricing
    current_stock = Column(Integer, nullable=False, default=0)
    low_stock_threshold = Column(Integer, default=5)
    quantity_per_sku = Column(Integer, default=1)
    unit_price = Column(Integer, nullable=False, default=0)  # Store as cents
    extra_cost = Column(Integer, default=0)  # Store as cents
    profit_margin = Column(Integer, default=0)  # Store as percentage * 100

    # Assembly tracking
    requires_assembly = Column(Boolean, default=False)
    quantity_assembled = Column(Integer, default=0)
    quantity_needs_assembly = Column(Integer, default=0)

    # Status
    status = Column(Text, default='active')
    image_url = Column(Text)
    is_active = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    product_sku = relationship("ProductSku", backref="finished_goods_items")
    print_job = relationship("PrintJob", backref="finished_goods_items")

    def to_dict(self):
        """Convert model to dictionary"""
        def safe_isoformat(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt
            return dt.isoformat()

        return {
            'id': self.id,
            'product_sku_id': self.product_sku_id,
            'tenant_id': self.tenant_id,
            'print_job_id': self.print_job_id,
            'sku': self.sku,
            'color': self.color,
            'material': self.material,
            'current_stock': self.current_stock,
            'low_stock_threshold': self.low_stock_threshold,
            'quantity_per_sku': self.quantity_per_sku,
            'unit_price': self.unit_price,
            'extra_cost': self.extra_cost,
            'profit_margin': self.profit_margin,
            'requires_assembly': self.requires_assembly,
            'quantity_assembled': self.quantity_assembled,
            'quantity_needs_assembly': self.quantity_needs_assembly,
            'status': self.status,
            'image_url': self.image_url,
            'is_active': self.is_active,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at)
        }

    @classmethod
    def from_dict(cls, data: dict):
        """Create model instance from dictionary data"""
        # Convert datetime strings to datetime objects
        created_at = data.get('created_at')
        if created_at and isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00').replace('+00:00', ''))

        updated_at = data.get('updated_at')
        if updated_at and isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00').replace('+00:00', ''))

        return cls(
            id=data.get('id'),
            product_sku_id=data.get('product_sku_id'),
            tenant_id=data.get('tenant_id'),
            print_job_id=data.get('print_job_id'),
            sku=data.get('sku'),
            color=data.get('color'),
            material=data.get('material'),
            current_stock=data.get('current_stock', 0),
            low_stock_threshold=data.get('low_stock_threshold', 5),
            quantity_per_sku=data.get('quantity_per_sku', 1),
            unit_price=data.get('unit_price', 0),
            extra_cost=data.get('extra_cost', 0),
            profit_margin=data.get('profit_margin', 0),
            requires_assembly=data.get('requires_assembly', False),
            quantity_assembled=data.get('quantity_assembled', 0),
            quantity_needs_assembly=data.get('quantity_needs_assembly', 0),
            status=data.get('status', 'active'),
            image_url=data.get('image_url'),
            is_active=data.get('is_active', True),
            created_at=created_at,
            updated_at=updated_at,
        )


class AssemblyTask(Base):
    """
    Local SQLite model for assembly_tasks table
    Mirrors the Supabase assembly_tasks table structure
    """
    __tablename__ = 'assembly_tasks'

    # Primary key
    id = Column(String(36), primary_key=True)  # UUID as string in SQLite

    # Foreign key references
    tenant_id = Column(String(36), nullable=False)
    finished_good_id = Column(String(36), ForeignKey('finished_goods.id'), nullable=False)
    assigned_to = Column(String(36))  # References profiles table (not enforced in SQLite)

    # Task information
    product_name = Column(Text, nullable=False)
    sku = Column(Text, nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    status = Column(Text, default='pending')  # pending, in_progress, completed
    notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime)

    # Table constraints
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed')",
            name='check_assembly_task_status'
        ),
        Index('idx_assembly_tasks_tenant', 'tenant_id'),
        Index('idx_assembly_tasks_status', 'status'),
        Index('idx_assembly_tasks_finished_good', 'finished_good_id'),
        Index('idx_assembly_tasks_assigned', 'assigned_to'),
    )

    # Relationships
    finished_good = relationship("FinishedGoods", backref="assembly_tasks")

    def to_dict(self):
        """Convert model to dictionary for API responses"""
        def safe_isoformat(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt
            return dt.isoformat()

        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'finished_good_id': self.finished_good_id,
            'assigned_to': self.assigned_to,
            'product_name': self.product_name,
            'sku': self.sku,
            'quantity': self.quantity,
            'status': self.status,
            'notes': self.notes,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
            'completed_at': safe_isoformat(self.completed_at),
        }

    @classmethod
    def from_dict(cls, data: dict):
        """Create model instance from dictionary data"""
        # Convert datetime strings to datetime objects
        created_at = data.get('created_at')
        if created_at and isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00').replace('+00:00', ''))

        updated_at = data.get('updated_at')
        if updated_at and isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00').replace('+00:00', ''))

        completed_at = data.get('completed_at')
        if completed_at and isinstance(completed_at, str):
            completed_at = datetime.fromisoformat(completed_at.replace('Z', '+00:00').replace('+00:00', ''))

        return cls(
            id=data.get('id'),
            tenant_id=data.get('tenant_id'),
            finished_good_id=data.get('finished_good_id'),
            assigned_to=data.get('assigned_to'),
            product_name=data.get('product_name'),
            sku=data.get('sku'),
            quantity=data.get('quantity', 1),
            status=data.get('status', 'pending'),
            notes=data.get('notes'),
            created_at=created_at,
            updated_at=updated_at,
            completed_at=completed_at,
        )


class WorklistTask(Base):
    """
    Local SQLite model for worklist_tasks table
    Mirrors the Supabase worklist_tasks table structure
    """
    __tablename__ = 'worklist_tasks'

    # Primary key
    id = Column(String(36), primary_key=True)  # UUID as string in SQLite

    # Foreign key references
    tenant_id = Column(String(36), nullable=False)
    assembly_task_id = Column(String(36), ForeignKey('assembly_tasks.id'))
    printer_id = Column(String(36))  # References printers table (not enforced)
    assigned_to = Column(String(36))  # References profiles table (not enforced)

    # Task information
    title = Column(Text, nullable=False)
    subtitle = Column(Text)
    description = Column(Text)
    task_type = Column(Text, nullable=False)  # assembly, filament_change, collection, maintenance, quality_check
    priority = Column(Text, default='medium')  # low, medium, high
    status = Column(Text, default='pending')  # pending, in_progress, completed, cancelled
    order_number = Column(Text)

    # Time tracking
    estimated_time_minutes = Column(Integer)
    actual_time_minutes = Column(Integer)
    started_at = Column(DateTime)
    completed_at = Column(DateTime)
    due_date = Column(DateTime)

    # Task metadata (JSON stored as Text in SQLite)
    task_metadata = Column('metadata', Text)  # JSON string - using 'metadata' as DB column name, task_metadata as attribute

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Table constraints
    __table_args__ = (
        CheckConstraint(
            "task_type IN ('assembly', 'filament_change', 'collection', 'maintenance', 'quality_check')",
            name='check_worklist_task_type'
        ),
        CheckConstraint(
            "priority IN ('low', 'medium', 'high')",
            name='check_worklist_priority'
        ),
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', 'cancelled')",
            name='check_worklist_status'
        ),
        Index('idx_worklist_tasks_tenant', 'tenant_id'),
        Index('idx_worklist_tasks_status', 'status'),
        Index('idx_worklist_tasks_task_type', 'task_type'),
        Index('idx_worklist_tasks_priority', 'priority'),
        Index('idx_worklist_tasks_assigned', 'assigned_to'),
        Index('idx_worklist_tasks_assembly', 'assembly_task_id'),
    )

    # Relationships
    assembly_task = relationship("AssemblyTask", backref="worklist_tasks")

    def to_dict(self):
        """Convert model to dictionary for API responses"""
        def safe_isoformat(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt
            return dt.isoformat()

        # Parse metadata JSON if present
        import json
        metadata_dict = None
        if self.task_metadata:
            try:
                metadata_dict = json.loads(self.task_metadata)
            except:
                metadata_dict = None

        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'assembly_task_id': self.assembly_task_id,
            'printer_id': self.printer_id,
            'assigned_to': self.assigned_to,
            'title': self.title,
            'subtitle': self.subtitle,
            'description': self.description,
            'task_type': self.task_type,
            'priority': self.priority,
            'status': self.status,
            'order_number': self.order_number,
            'estimated_time_minutes': self.estimated_time_minutes,
            'actual_time_minutes': self.actual_time_minutes,
            'started_at': safe_isoformat(self.started_at),
            'completed_at': safe_isoformat(self.completed_at),
            'due_date': safe_isoformat(self.due_date),
            'metadata': metadata_dict,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
        }

    @classmethod
    def from_dict(cls, data: dict):
        """Create model instance from dictionary data"""
        # Convert datetime strings to datetime objects
        created_at = data.get('created_at')
        if created_at and isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00').replace('+00:00', ''))

        updated_at = data.get('updated_at')
        if updated_at and isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00').replace('+00:00', ''))

        started_at = data.get('started_at')
        if started_at and isinstance(started_at, str):
            started_at = datetime.fromisoformat(started_at.replace('Z', '+00:00').replace('+00:00', ''))

        completed_at = data.get('completed_at')
        if completed_at and isinstance(completed_at, str):
            completed_at = datetime.fromisoformat(completed_at.replace('Z', '+00:00').replace('+00:00', ''))

        due_date = data.get('due_date')
        if due_date and isinstance(due_date, str):
            due_date = datetime.fromisoformat(due_date.replace('Z', '+00:00').replace('+00:00', ''))

        # Handle metadata as JSON
        import json
        metadata_str = None
        if data.get('metadata'):
            metadata_str = json.dumps(data.get('metadata'))

        return cls(
            id=data.get('id'),
            tenant_id=data.get('tenant_id'),
            assembly_task_id=data.get('assembly_task_id'),
            printer_id=data.get('printer_id'),
            assigned_to=data.get('assigned_to'),
            title=data.get('title'),
            subtitle=data.get('subtitle'),
            description=data.get('description'),
            task_type=data.get('task_type'),
            priority=data.get('priority', 'medium'),
            status=data.get('status', 'pending'),
            order_number=data.get('order_number'),
            estimated_time_minutes=data.get('estimated_time_minutes'),
            actual_time_minutes=data.get('actual_time_minutes'),
            started_at=started_at,
            completed_at=completed_at,
            due_date=due_date,
            task_metadata=metadata_str,
            created_at=created_at,
            updated_at=updated_at,
        )