"""
File Association Service for matching uploaded files with realtime sync records
Handles robust ID-based matching with intelligent fallbacks
"""

import os
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from pathlib import Path
import asyncio

from ..models.database import PrintFile
from .database_service import get_database_service
from .config_service import get_config_service

logger = logging.getLogger(__name__)

class FileAssociationService:
    """
    Service for associating uploaded files with realtime sync records
    Uses primary ID matching with intelligent fallbacks
    """
    
    def __init__(self):
        self.base_file_path = Path("/home/pi/PrintFarmSoftware/files/print_files")
        self.unmatched_path = Path("/home/pi/PrintFarmSoftware/files/unmatched")
        self.time_window_minutes = 5  # Match files uploaded within last 5 minutes
        
        # Ensure directories exist
        self.base_file_path.mkdir(parents=True, exist_ok=True)
        self.unmatched_path.mkdir(parents=True, exist_ok=True)
    
    async def associate_synced_record(self, record: PrintFile) -> bool:
        """
        Associate a synced record with a local file
        
        Args:
            record: PrintFile record from realtime sync
            
        Returns:
            bool: True if successfully associated, False otherwise
        """
        try:
            # Primary matching: by record ID
            if await self._match_by_id(record):
                logger.info(f"Successfully matched file by ID for record {record.id}")
                return True
            
            # Fallback matching: by name, size, and time window
            if await self._fallback_match(record):
                logger.info(f"Successfully matched file using fallback for record {record.id}")
                return True
            
            logger.warning(f"Could not associate file for record {record.id} - {record.name}")
            return False
            
        except Exception as e:
            logger.error(f"Error associating file for record {record.id}: {e}")
            return False
    
    async def _match_by_id(self, record: PrintFile) -> bool:
        """
        Primary matching strategy: look for file with record ID as filename
        
        Args:
            record: PrintFile record
            
        Returns:
            bool: True if matched and associated
        """
        tenant_dir = self.base_file_path / record.tenant_id
        
        # Check for all supported file extensions
        supported_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        
        for ext in supported_extensions:
            expected_path = tenant_dir / f"{record.id}{ext}"
            
            if expected_path.exists():
                # File found, associate with record
                await self._update_record_with_path(record.id, str(expected_path))
                return True
        
        # Also check unmatched directory with all extensions
        for ext in supported_extensions:
            unmatched_path = self.unmatched_path / f"{record.id}{ext}"
            if unmatched_path.exists():
                # Move file to proper location and associate
                tenant_dir.mkdir(parents=True, exist_ok=True)
                final_path = tenant_dir / f"{record.id}{ext}"
                unmatched_path.rename(final_path)
                await self._update_record_with_path(record.id, str(final_path))
                logger.info(f"Moved file from unmatched to proper location: {final_path}")
                return True
        
        return False
    
    async def _fallback_match(self, record: PrintFile) -> bool:
        """
        Fallback matching strategy: match by name, size, and time window
        
        Args:
            record: PrintFile record
            
        Returns:
            bool: True if matched and associated
        """
        if not record.name or not record.file_size_bytes:
            logger.warning(f"Record {record.id} missing name or size for fallback matching")
            return False
        
        # Find recent unmatched files
        recent_files = await self._find_recent_unmatched_files()
        
        for file_path in recent_files:
            if await self._matches_name_size_time(file_path, record):
                # Move to proper location and associate
                tenant_dir = self.base_file_path / record.tenant_id
                tenant_dir.mkdir(parents=True, exist_ok=True)
                
                # Preserve the original file extension
                file_ext = Path(file_path).suffix
                final_path = tenant_dir / f"{record.id}{file_ext}"
                
                Path(file_path).rename(final_path)
                await self._update_record_with_path(record.id, str(final_path))
                logger.info(f"Fallback match successful: {file_path} -> {final_path}")
                return True
        
        return False
    
    async def _find_recent_unmatched_files(self) -> List[str]:
        """
        Find files uploaded recently that haven't been matched yet
        
        Returns:
            List[str]: List of file paths
        """
        recent_files = []
        cutoff_time = datetime.now() - timedelta(minutes=self.time_window_minutes)
        
        try:
            # Supported file extensions
            supported_extensions = ['*.3mf', '*.stl', '*.gcode', '*.obj', '*.amf']
            
            # Check unmatched directory for all supported extensions
            for pattern in supported_extensions:
                for file_path in self.unmatched_path.glob(pattern):
                    file_stat = file_path.stat()
                    file_time = datetime.fromtimestamp(file_stat.st_mtime)
                    
                    if file_time > cutoff_time:
                        recent_files.append(str(file_path))
            
            # Also check tenant directories for unassociated files
            for tenant_dir in self.base_file_path.glob("*"):
                if tenant_dir.is_dir():
                    for pattern in supported_extensions:
                        for file_path in tenant_dir.glob(pattern):
                            # Check if this file is already associated
                            if not await self._is_file_associated(str(file_path)):
                                file_stat = file_path.stat()
                                file_time = datetime.fromtimestamp(file_stat.st_mtime)
                                
                                if file_time > cutoff_time:
                                    recent_files.append(str(file_path))
            
            logger.debug(f"Found {len(recent_files)} recent unmatched files")
            return recent_files
            
        except Exception as e:
            logger.error(f"Error finding recent unmatched files: {e}")
            return []
    
    async def _matches_name_size_time(self, file_path: str, record: PrintFile) -> bool:
        """
        Check if file matches record by name, size, and time window
        
        Args:
            file_path: Path to file
            record: PrintFile record
            
        Returns:
            bool: True if matches
        """
        try:
            file_path_obj = Path(file_path)
            
            # Check name (allow some flexibility in naming)
            file_name = file_path_obj.name
            expected_name = record.name
            
            # Remove .3mf extension for comparison
            if file_name.endswith('.3mf'):
                file_name = file_name[:-4]
            if expected_name.endswith('.3mf'):
                expected_name = expected_name[:-4]
            
            name_matches = (file_name == expected_name or 
                          file_name.startswith(record.id[:8]) or  # UUID prefix
                          expected_name in file_name)
            
            if not name_matches:
                return False
            
            # Check size (allow 1% variance for encoding differences)
            file_size = file_path_obj.stat().st_size
            expected_size = record.file_size_bytes
            
            if expected_size > 0:
                size_variance = abs(file_size - expected_size) / expected_size
                size_matches = size_variance <= 0.01  # 1% tolerance
            else:
                size_matches = True  # If no expected size, skip size check
            
            if not size_matches:
                logger.debug(f"Size mismatch: file={file_size}, expected={expected_size}")
                return False
            
            # Check time window
            file_stat = file_path_obj.stat()
            file_time = datetime.fromtimestamp(file_stat.st_mtime)
            cutoff_time = datetime.now() - timedelta(minutes=self.time_window_minutes)
            
            time_matches = file_time > cutoff_time
            
            logger.debug(f"Match check for {file_path}: name={name_matches}, size={size_matches}, time={time_matches}")
            return name_matches and size_matches and time_matches
            
        except Exception as e:
            logger.error(f"Error checking file match for {file_path}: {e}")
            return False
    
    async def _is_file_associated(self, file_path: str) -> bool:
        """
        Check if a file is already associated with a database record
        
        Args:
            file_path: Path to file
            
        Returns:
            bool: True if already associated
        """
        try:
            db_service = await get_database_service()
            
            # Query for any record with this local_file_path
            async with db_service.get_session() as session:
                from sqlalchemy import text
                result = await session.execute(
                    text("SELECT COUNT(*) FROM print_files WHERE local_file_path = :file_path"),
                    {"file_path": file_path}
                )
                count = result.scalar()
                return count > 0
                
        except Exception as e:
            logger.error(f"Error checking if file is associated: {e}")
            return False
    
    async def _update_record_with_path(self, record_id: str, file_path: str) -> bool:
        """
        Update database record with local file path
        
        Args:
            record_id: ID of the print file record
            file_path: Local file path
            
        Returns:
            bool: True if successful
        """
        try:
            db_service = await get_database_service()
            
            async with db_service.get_session() as session:
                from sqlalchemy import text
                await session.execute(
                    text("UPDATE print_files SET local_file_path = :file_path WHERE id = :record_id"),
                    {"file_path": file_path, "record_id": record_id}
                )
                await session.commit()
                
            logger.info(f"Updated record {record_id} with local path: {file_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error updating record {record_id} with path {file_path}: {e}")
            return False
    
    async def cleanup_orphaned_files(self) -> int:
        """
        Clean up orphaned files that haven't been matched after the time window
        
        Returns:
            int: Number of files cleaned up
        """
        cleaned_count = 0
        cutoff_time = datetime.now() - timedelta(minutes=self.time_window_minutes * 2)  # Double the window for cleanup
        
        try:
            # Check unmatched directory
            for file_path in self.unmatched_path.glob("*.3mf"):
                file_stat = file_path.stat()
                file_time = datetime.fromtimestamp(file_stat.st_mtime)
                
                if file_time < cutoff_time:
                    file_path.unlink()
                    cleaned_count += 1
                    logger.info(f"Cleaned up orphaned file: {file_path}")
            
            return cleaned_count
            
        except Exception as e:
            logger.error(f"Error cleaning up orphaned files: {e}")
            return 0
    
    def get_file_path_for_record(self, tenant_id: str, record_id: str) -> str:
        """
        Get the expected file path for a record
        
        Args:
            tenant_id: Tenant ID
            record_id: Record ID
            
        Returns:
            str: Expected file path
        """
        return str(self.base_file_path / tenant_id / f"{record_id}.3mf")

# Global service instance
_file_association_service = None

async def get_file_association_service() -> FileAssociationService:
    """Get the global file association service instance"""
    global _file_association_service
    if _file_association_service is None:
        _file_association_service = FileAssociationService()
    return _file_association_service