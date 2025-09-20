"""
SQLAlchemy database models for local SQLite storage
Mirrors the Supabase printers table structure for local caching
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, Date, Text, 
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
    sort_order = Column(Integer, default=0)
    printer_id = Column(Integer)
    
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
            'location': self.location,
            'connection_type': self.connection_type,
            'ip_address': self.ip_address,
            'serial_number': self.serial_number,
            'access_code': self.access_code,
            'is_connected': self.is_connected,
            'last_connection_attempt': safe_isoformat(self.last_connection_attempt),
            'connection_error': self.connection_error,
            'is_active': self.is_active,
            'sort_order': self.sort_order,
            'printer_id': self.printer_id,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
        }
    
    @classmethod
    def from_supabase_dict(cls, data: dict):
        """Create model instance from Supabase data"""
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
            location=data.get('location'),
            connection_type=data.get('connection_type', 'bambu'),
            ip_address=data.get('ip_address'),
            serial_number=data.get('serial_number'),
            access_code=data.get('access_code'),
            is_connected=data.get('is_connected', False),
            last_connection_attempt=last_connection,
            connection_error=data.get('connection_error'),
            is_active=data.get('is_active', True),
            sort_order=data.get('sort_order', 0),
            printer_id=data.get('printer_id'),
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
        UniqueConstraint('tenant_id', 'color_name', name='unique_tenant_color_name'),
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
    def from_supabase_dict(cls, data: dict):
        """Create model instance from Supabase data"""
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
    image_url = Column(Text)
    is_active = Column(Boolean, default=True)
    
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
            
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'name': self.name,
            'description': self.description,
            'category': self.category,
            'print_file_id': self.print_file_id,
            'file_name': self.file_name,
            'requires_assembly': self.requires_assembly,
            'image_url': self.image_url,
            'is_active': self.is_active,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
        }
    
    @classmethod
    def from_supabase_dict(cls, data: dict):
        """Create model instance from Supabase data"""
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
            image_url=data.get('image_url'),
            is_active=data.get('is_active', True),
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
            'is_active': self.is_active,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
        }
    
    @classmethod
    def from_supabase_dict(cls, data: dict):
        """Create model instance from Supabase data"""
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
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Table constraints
    __table_args__ = (
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
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
        }
    
    @classmethod
    def from_supabase_dict(cls, data: dict):
        """Create model instance from Supabase data"""
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
    
    # Queue management
    priority = Column(Integer, default=0)
    failure_reason = Column(Text)
    
    # Timestamps
    time_submitted = Column(DateTime, default=datetime.utcnow)
    time_started = Column(DateTime)
    time_completed = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
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
            'priority': self.priority,
            'failure_reason': self.failure_reason,
            'time_submitted': safe_isoformat(self.time_submitted),
            'time_started': safe_isoformat(self.time_started),
            'time_completed': safe_isoformat(self.time_completed),
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at),
        }
    
    @classmethod
    def from_supabase_dict(cls, data: dict):
        """Create model instance from Supabase data"""
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
            priority=data.get('priority', 0),
            failure_reason=data.get('failure_reason'),
            time_submitted=time_submitted,
            time_started=time_started,
            time_completed=time_completed,
            created_at=created_at,
            updated_at=updated_at,
        )


class BackupQueue(Base):
    """
    Local SQLite model for backup_queue table
    Tracks changes that need to be backed up to Supabase
    """
    __tablename__ = 'backup_queue'
    
    # Primary key
    id = Column(Integer, primary_key=True, autoincrement=True)
    
    # Backup information
    table_name = Column(Text, nullable=False)
    operation = Column(Text, nullable=False)  # insert, update, delete, backup
    record_id = Column(Text, nullable=False)
    record_data = Column(Text, nullable=False)  # JSON string
    
    # Processing status
    created_at = Column(DateTime, default=datetime.utcnow)
    processed = Column(Boolean, default=False)
    processed_at = Column(DateTime)
    error = Column(Text)
    retry_count = Column(Integer, default=0)
    
    # Table constraints
    __table_args__ = (
        Index('idx_backup_queue_processed', 'processed'),
        Index('idx_backup_queue_table_operation', 'table_name', 'operation'),
    )
    
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
            'table_name': self.table_name,
            'operation': self.operation,
            'record_id': self.record_id,
            'record_data': self.record_data,
            'created_at': safe_isoformat(self.created_at),
            'processed': self.processed,
            'processed_at': safe_isoformat(self.processed_at),
            'error': self.error,
            'retry_count': self.retry_count
        }

class FinishedGoods(Base):
    """
    Local SQLite model for finished_goods table
    Tracks finished goods inventory linked to product SKUs
    """
    __tablename__ = 'finished_goods'
    
    # Primary key
    id = Column(String(36), primary_key=True)  # UUID as string in SQLite
    
    # Foreign key references
    product_sku_id = Column(String(36), ForeignKey('product_skus.id', ondelete='CASCADE'), nullable=False)
    tenant_id = Column(String(36), nullable=False)
    print_job_id = Column(String(36))  # Optional link to print job that created it
    
    # Item information
    sku = Column(Text, nullable=False)
    color = Column(Text, nullable=False)
    material = Column(Text, nullable=False, default='PLA')
    
    # Stock management
    current_stock = Column(Integer, nullable=False, default=0)
    low_stock_threshold = Column(Integer, default=5)
    quantity_per_sku = Column(Integer, default=1)  # How many units per SKU
    
    # Financial information
    unit_price = Column(Integer, nullable=False, default=0)  # Store in cents for precision
    extra_cost = Column(Integer, default=0)  # Additional costs in cents
    profit_margin = Column(Integer, default=0)  # Percentage * 100 (e.g., 2500 = 25%)
    
    # Status tracking
    assembly_status = Column(Text, default='printed')  # printed, needs_assembly, assembled
    status = Column(Text, default='out_of_stock')  # out_of_stock, low_stock, in_stock
    
    # Metadata
    image_url = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    product_sku = relationship('ProductSku', backref='finished_goods')
    
    # Table constraints
    __table_args__ = (
        Index('idx_finished_goods_tenant', 'tenant_id'),
        Index('idx_finished_goods_product_sku', 'product_sku_id'),
        Index('idx_finished_goods_status', 'status'),
        Index('idx_finished_goods_assembly_status', 'assembly_status'),
    )
    
    def to_dict(self):
        """Convert model to dictionary"""
        def safe_isoformat(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt
            return dt.isoformat()
        
        # Convert cents back to dollars for API response
        unit_price_dollars = self.unit_price / 100.0 if self.unit_price else 0
        extra_cost_dollars = self.extra_cost / 100.0 if self.extra_cost else 0
        profit_margin_percent = self.profit_margin / 100.0 if self.profit_margin else 0
            
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
            'unit_price': unit_price_dollars,
            'extra_cost': extra_cost_dollars,
            'profit_margin': profit_margin_percent,
            'assembly_status': self.assembly_status,
            'status': self.status,
            'image_url': self.image_url,
            'is_active': self.is_active,
            'created_at': safe_isoformat(self.created_at),
            'updated_at': safe_isoformat(self.updated_at)
        }
    
    @classmethod
    def from_supabase(cls, data):
        """Create instance from Supabase data"""
        # Parse datetime strings
        created_at = data.get('created_at')
        if created_at and isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        updated_at = data.get('updated_at')
        if updated_at and isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00').replace('+00:00', ''))
        
        # Convert dollar amounts to cents
        unit_price = data.get('unit_price', 0)
        if unit_price is not None:
            unit_price = int(float(unit_price) * 100)
        
        extra_cost = data.get('extra_cost', 0)
        if extra_cost is not None:
            extra_cost = int(float(extra_cost) * 100)
        
        profit_margin = data.get('profit_margin', 0)
        if profit_margin is not None:
            profit_margin = int(float(profit_margin) * 100)
        
        return cls(
            id=data.get('id'),
            product_sku_id=data.get('product_sku_id'),
            tenant_id=data.get('tenant_id'),
            print_job_id=data.get('print_job_id'),
            sku=data.get('sku'),
            color=data.get('color'),
            material=data.get('material', 'PLA'),
            current_stock=data.get('current_stock', 0),
            low_stock_threshold=data.get('low_stock_threshold', 5),
            quantity_per_sku=data.get('quantity_per_sku', 1),
            unit_price=unit_price,
            extra_cost=extra_cost,
            profit_margin=profit_margin,
            assembly_status=data.get('assembly_status', 'printed'),
            status=data.get('status', 'out_of_stock'),
            image_url=data.get('image_url'),
            is_active=data.get('is_active', True),
            created_at=created_at,
            updated_at=updated_at,
        )
