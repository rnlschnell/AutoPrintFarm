"""
Service for synchronizing live printer status with print job database
"""

import asyncio
import logging
from typing import Dict, List, Optional, Set
from datetime import datetime, timezone
from dataclasses import dataclass

from src.core.printer_client import printer_manager
from src.services.database_service import get_database_service

logger = logging.getLogger(__name__)


@dataclass
class LiveJobInfo:
    """Information about a currently active print job"""
    printer_id: str
    filename: str
    status: str
    progress_percentage: float
    current_layer: Optional[int] = None
    total_layers: Optional[int] = None
    remaining_time: Optional[int] = None
    print_id: Optional[str] = None


class LiveJobSyncService:
    """Service to sync live printer jobs with database"""
    
    def __init__(self):
        self.running = False
        self.sync_task: Optional[asyncio.Task] = None
        self.sync_interval = 10  # Sync every 10 seconds
        self.tracked_jobs: Dict[str, LiveJobInfo] = {}  # printer_id -> job_info
        
    async def start(self):
        """Start the live job synchronization service"""
        if self.running:
            logger.warning("Live job sync service is already running")
            return
            
        self.running = True
        self.sync_task = asyncio.create_task(self._sync_loop())
        logger.info("Live job sync service started")
    
    async def stop(self):
        """Stop the live job synchronization service"""
        self.running = False
        if self.sync_task:
            self.sync_task.cancel()
            try:
                await self.sync_task
            except asyncio.CancelledError:
                pass
        logger.info("Live job sync service stopped")
    
    async def _sync_loop(self):
        """Main synchronization loop"""
        while self.running:
            try:
                await self._sync_live_jobs()
                await asyncio.sleep(self.sync_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in live job sync loop: {e}")
                await asyncio.sleep(self.sync_interval)
    
    async def _sync_live_jobs(self):
        """Sync current printer jobs with database"""
        try:
            # Get live status from all printers
            all_live_status = await printer_manager.get_all_live_status()
            
            current_jobs: Dict[str, LiveJobInfo] = {}
            
            for status_data in all_live_status:
                printer_id = status_data.get("printer_id")
                if not printer_id:
                    continue
                
                job_status = status_data.get("status", "idle")
                current_job = status_data.get("current_job")
                progress_data = status_data.get("progress")
                
                # Only track active printing jobs
                if job_status in ["printing", "paused"] and current_job:
                    filename = current_job.get("filename", "")
                    if filename:
                        progress_percentage = 0.0
                        current_layer = None
                        total_layers = None
                        remaining_time = None
                        
                        if progress_data:
                            progress_percentage = progress_data.get("percentage", 0.0)
                            current_layer = progress_data.get("current_layer")
                            total_layers = progress_data.get("total_layers")
                            remaining_time = progress_data.get("remaining_time")
                        
                        job_info = LiveJobInfo(
                            printer_id=printer_id,
                            filename=filename,
                            status=job_status,
                            progress_percentage=progress_percentage,
                            current_layer=current_layer,
                            total_layers=total_layers,
                            remaining_time=remaining_time,
                            print_id=current_job.get("print_id", "")
                        )
                        
                        current_jobs[printer_id] = job_info
            
            # Process job changes
            await self._process_job_changes(current_jobs)
            
            # Update tracked jobs
            self.tracked_jobs = current_jobs
            
        except Exception as e:
            logger.error(f"Failed to sync live jobs: {e}")
    
    async def _process_job_changes(self, current_jobs: Dict[str, LiveJobInfo]):
        """Process changes in active jobs"""
        # Find new jobs (started printing)
        for printer_id, job_info in current_jobs.items():
            if printer_id not in self.tracked_jobs:
                await self._handle_new_job(job_info)
            else:
                await self._handle_job_update(job_info)
        
        # Find completed/stopped jobs
        for printer_id in self.tracked_jobs:
            if printer_id not in current_jobs:
                await self._handle_job_completed(self.tracked_jobs[printer_id])
    
    async def _handle_new_job(self, job_info: LiveJobInfo):
        """Handle a new print job that started"""
        logger.info(f"New live print job detected: {job_info.filename} on printer {job_info.printer_id}")
        
        try:
            # Check if this job already exists in database (manually started)
            existing_job = await self._find_existing_job(job_info)
            
            if existing_job:
                # Update existing job to printing status
                await self._update_job_status(
                    existing_job['id'], 
                    'printing', 
                    job_info.progress_percentage
                )
                logger.info(f"Updated existing job {existing_job['id']} to printing status")
            else:
                # Create new database entry for externally started job
                await self._create_external_job(job_info)
                logger.info(f"Created new database entry for external job: {job_info.filename}")
        
        except Exception as e:
            logger.error(f"Failed to handle new job {job_info.filename}: {e}")
    
    async def _handle_job_update(self, job_info: LiveJobInfo):
        """Handle updates to an existing job"""
        try:
            # Find corresponding database job
            existing_job = await self._find_existing_job(job_info)
            
            if existing_job:
                # Update progress
                await self._update_job_status(
                    existing_job['id'],
                    job_info.status,
                    job_info.progress_percentage
                )
        
        except Exception as e:
            logger.error(f"Failed to update job {job_info.filename}: {e}")
    
    async def _handle_job_completed(self, job_info: LiveJobInfo):
        """Handle a job that completed or was cancelled"""
        logger.info(f"Print job completed/stopped: {job_info.filename} on printer {job_info.printer_id}")
        
        try:
            # Find corresponding database job and mark as completed
            existing_job = await self._find_existing_job(job_info)
            
            if existing_job:
                # Mark as completed (we'll determine success/failure from printer status later)
                await self._update_job_status(
                    existing_job['id'],
                    'completed',
                    100.0
                )
                logger.info(f"Marked job {existing_job['id']} as completed")
        
        except Exception as e:
            logger.error(f"Failed to handle job completion {job_info.filename}: {e}")
    
    async def _find_existing_job(self, job_info: LiveJobInfo) -> Optional[Dict]:
        """Find existing database job that matches the live job"""
        try:
            from sqlalchemy import text
            
            # Look for jobs with matching filename and printer that are active
            query = text("""
            SELECT id, status, progress_percentage 
            FROM print_jobs 
            WHERE file_name = :filename 
            AND printer_id = :printer_id
            AND status IN ('queued', 'processing', 'uploaded', 'printing')
            ORDER BY time_submitted DESC
            LIMIT 1
            """)
            
            db_service = await get_database_service()
            async with db_service.get_session() as session:
                result = await session.execute(
                    query, 
                    {"filename": job_info.filename, "printer_id": job_info.printer_id}
                )
                row = result.fetchone()
                
                if row:
                    return {
                        'id': row[0],
                        'status': row[1],
                        'progress_percentage': row[2]
                    }
                return None
        
        except Exception as e:
            logger.error(f"Failed to find existing job: {e}")
            return None
    
    async def _create_external_job(self, job_info: LiveJobInfo):
        """Create database entry for externally started job"""
        try:
            from sqlalchemy import text
            import uuid
            
            insert_query = text("""
            INSERT INTO print_jobs (
                id, printer_id, file_name, status, progress_percentage,
                time_submitted, time_started, color, filament_type,
                material_type, number_of_units, priority, tenant_id
            ) VALUES (
                :id, :printer_id, :file_name, :status, :progress_percentage,
                :time_submitted, :time_started, :color, :filament_type,
                :material_type, :number_of_units, :priority, :tenant_id
            )
            """)
            
            now = datetime.now(timezone.utc)
            
            db_service = await get_database_service()
            async with db_service.get_session() as session:
                await session.execute(insert_query, {
                    'id': str(uuid.uuid4()),
                    'printer_id': int(job_info.printer_id),
                    'file_name': job_info.filename,
                    'status': 'printing',
                    'progress_percentage': job_info.progress_percentage,
                    'time_submitted': now,
                    'time_started': now,
                    'color': 'Unknown|#808080',
                    'filament_type': 'PLA',
                    'material_type': 'PLA', 
                    'number_of_units': 1,
                    'priority': 0,
                    'tenant_id': ''  # Empty tenant for now
                })
                await session.commit()
            
        except Exception as e:
            logger.error(f"Failed to create external job: {e}")
    
    async def _update_job_status(self, job_id: str, status: str, progress: float):
        """Update job status and progress in database"""
        try:
            from sqlalchemy import text
            
            update_query = text("""
            UPDATE print_jobs 
            SET status = :status, progress_percentage = :progress, time_started = :time_started
            WHERE id = :job_id
            """)
            
            time_started = datetime.now(timezone.utc)
            
            db_service = await get_database_service()
            async with db_service.get_session() as session:
                await session.execute(update_query, {
                    'status': status,
                    'progress': progress,
                    'time_started': time_started,
                    'job_id': job_id
                })
                await session.commit()
            
        except Exception as e:
            logger.error(f"Failed to update job status: {e}")


# Global service instance
live_job_sync_service = LiveJobSyncService()