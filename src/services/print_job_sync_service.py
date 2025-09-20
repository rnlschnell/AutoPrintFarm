"""
Print Job Status Synchronizer Service

This service monitors live printer data and updates corresponding print job records
in the database to keep status and progress in sync with actual printer state.

Key Features:
- Monitors live printer status via WebSocket/MQTT
- Matches database print jobs with current printer jobs
- Updates progress, status, and completion timestamps
- Handles job completion and error states
"""

import asyncio
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
from dataclasses import dataclass

from ..core.printer_client import printer_manager
from ..services.database_service import get_database_service
from ..services.config_service import get_config_service

logger = logging.getLogger(__name__)

@dataclass
class JobMatch:
    """Represents a matched job between database and live printer data"""
    db_job_id: str
    printer_id: str
    filename: str
    live_status: Dict[str, Any]
    db_status: str
    needs_update: bool = False

class PrintJobSyncService:
    """
    Service to synchronize print job database records with live printer status
    """
    
    def __init__(self):
        self.is_running = False
        self.sync_task: Optional[asyncio.Task] = None
        self.sync_interval = 10  # seconds between sync checks
        self.tenant_id: Optional[str] = None
        
    async def start(self):
        """Start the print job sync service"""
        if self.is_running:
            logger.warning("Print job sync service is already running")
            return
            
        # Get tenant ID from config
        try:
            config_service = get_config_service()
            tenant_config = config_service.get_tenant_config()
            self.tenant_id = tenant_config.get('id', '').strip()
            
            if not self.tenant_id:
                logger.error("Print job sync service: Tenant not configured, cannot start")
                return
                
        except Exception as e:
            logger.error(f"Print job sync service: Failed to get tenant config: {e}")
            return
        
        self.is_running = True
        self.sync_task = asyncio.create_task(self._sync_loop())
        logger.info(f"Print job sync service started for tenant {self.tenant_id}")
        
    async def stop(self):
        """Stop the print job sync service"""
        if not self.is_running:
            return
            
        self.is_running = False
        if self.sync_task:
            self.sync_task.cancel()
            try:
                await self.sync_task
            except asyncio.CancelledError:
                pass
        logger.info("Print job sync service stopped")
        
    async def _sync_loop(self):
        """Main synchronization loop"""
        logger.info("Print job sync loop started")
        
        while self.is_running:
            try:
                await self._sync_print_jobs()
                await asyncio.sleep(self.sync_interval)
                
            except asyncio.CancelledError:
                logger.info("Print job sync loop cancelled")
                break
            except Exception as e:
                logger.error(f"Error in print job sync loop: {e}")
                # Continue running even if one sync fails
                await asyncio.sleep(self.sync_interval)
                
    async def _sync_print_jobs(self):
        """Perform one sync cycle of print job status updates"""
        try:
            logger.debug("Starting print job sync cycle")

            # Get database service
            db_service = await get_database_service()
            if not db_service:
                logger.warning("Database service not available, skipping sync")
                return

            # Get all active print jobs (printing or uploaded status)
            active_jobs = await self._get_active_print_jobs(db_service)
            if not active_jobs:
                logger.debug("No active print jobs to sync")
                return

            logger.debug(f"Processing {len(active_jobs)} active database jobs")

            # Get live printer data
            live_printer_data = await self._get_live_printer_data()
            if not live_printer_data:
                logger.debug("No live printer data available")
                return

            logger.debug(f"Retrieved live data from {len(live_printer_data)} printers")

            # Match jobs and determine updates
            job_matches = await self._match_jobs_with_live_data(active_jobs, live_printer_data)
            logger.debug(f"Found {len(job_matches)} job matches")

            # Process updates
            updates_made = 0
            for match in job_matches:
                if match.needs_update:
                    logger.debug(f"Updating job {match.db_job_id} from live data")
                    await self._update_job_from_live_data(match, db_service)
                    updates_made += 1

            logger.debug(f"Print job sync cycle completed: {updates_made} updates made")

        except Exception as e:
            logger.error(f"Error during print job sync: {e}", exc_info=True)
            
    async def _get_active_print_jobs(self, db_service) -> List[Any]:
        """Get print jobs that are currently active (queued, printing, or uploaded)"""
        try:
            # Get jobs with status 'queued', 'printing' or 'uploaded'
            queued_jobs = await db_service.get_print_jobs_by_status(self.tenant_id, 'queued')
            printing_jobs = await db_service.get_print_jobs_by_status(self.tenant_id, 'printing')
            uploaded_jobs = await db_service.get_print_jobs_by_status(self.tenant_id, 'uploaded')
            
            active_jobs = queued_jobs + printing_jobs + uploaded_jobs
            logger.debug(f"Found {len(active_jobs)} active print jobs ({len(queued_jobs)} queued, {len(printing_jobs)} printing, {len(uploaded_jobs)} uploaded)")
            return active_jobs
            
        except Exception as e:
            logger.error(f"Error getting active print jobs: {e}")
            return []
            
    async def _get_live_printer_data(self) -> List[Dict[str, Any]]:
        """Get live status data from all printers"""
        try:
            live_data = await printer_manager.get_all_live_status()
            logger.debug(f"Retrieved live data from {len(live_data)} printers")
            return live_data
            
        except Exception as e:
            logger.error(f"Error getting live printer data: {e}")
            return []
            
    async def _match_jobs_with_live_data(self, active_jobs: List[Any], live_data: List[Dict[str, Any]]) -> List[JobMatch]:
        """Match database jobs with live printer data"""
        matches = []

        logger.debug("Matching database jobs with live printer data")

        for job in active_jobs:
            logger.debug(f"Attempting to match job {job.id} ({job.file_name}) from printer {getattr(job, 'printer_id', 'unknown')}")

            # Find matching live printer data
            live_match = await self._find_matching_live_data(job, live_data)

            if live_match:
                match = JobMatch(
                    db_job_id=job.id,
                    printer_id=str(job.printer_id) if hasattr(job, 'printer_id') else 'unknown',
                    filename=job.file_name,
                    live_status=live_match,
                    db_status=job.status
                )

                # Determine if update is needed
                match.needs_update = self._should_update_job(job, live_match)
                matches.append(match)

                logger.debug(f"✓ Matched job {job.id} ({job.file_name}) with printer {live_match.get('printer_id', 'unknown')}, needs_update: {match.needs_update}")
            else:
                logger.debug(f"✗ No live data match found for job {job.id} ({job.file_name})")

        return matches
        
    async def _find_matching_live_data(self, job, live_data: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Find live printer data that matches a database job"""

        # Try to resolve the actual printer_id from the job's printer UUID
        job_printer_id = await self._resolve_job_printer_id(job)
        logger.debug(f"  Job printer UUID {getattr(job, 'printer_id', 'unknown')} resolved to printer_id: {job_printer_id}")

        for live in live_data:
            live_printer_id = str(live.get('printer_id', ''))
            logger.debug(f"  Checking live printer {live_printer_id}")

            # First check: printer ID must match
            if job_printer_id and live_printer_id != job_printer_id:
                logger.debug(f"  ✗ Printer ID mismatch: {job_printer_id} != {live_printer_id}")
                continue

            # Second check: must have current job info
            current_job = live.get('current_job')
            if not current_job:
                logger.debug(f"  ✗ Printer {live_printer_id} has no current_job")
                continue

            live_filename = current_job.get('filename', '')
            logger.debug(f"  Live filename: '{live_filename}', job filename: '{job.file_name}'")

            # Third check: filename matching (with some flexibility)
            if self._filenames_match(job.file_name, live_filename):
                logger.debug(f"  ✓ Filename match found!")
                return live
            else:
                logger.debug(f"  ✗ Filename mismatch")

        logger.debug(f"  No matching live data found for job {job.id}")
        return None
        
    async def _resolve_job_printer_id(self, job) -> Optional[str]:
        """Resolve the actual printer ID from job's printer UUID reference"""
        try:
            if not hasattr(job, 'printer_id') or not job.printer_id:
                return None
                
            # Get database service to look up the printer
            db_service = await get_database_service()
            if not db_service:
                return None
                
            # Get all printers for this tenant
            printers = await db_service.get_printers_by_tenant(self.tenant_id)
            
            # Find the printer record by UUID
            for printer in printers:
                if printer.id == job.printer_id:
                    # Return the actual printer_id (like "4", "7")
                    return str(printer.printer_id) if printer.printer_id else None
                    
        except Exception as e:
            logger.debug(f"Could not resolve printer ID for job {job.id}: {e}")
            
        return None
        
    def _filenames_match(self, db_filename: str, live_filename: str) -> bool:
        """Check if database filename matches live filename with some flexibility"""
        if not db_filename or not live_filename:
            return False
            
        # Exact match
        if db_filename == live_filename:
            return True
            
        # Case insensitive match
        if db_filename.lower() == live_filename.lower():
            return True
            
        # Base filename match (without extensions)
        import os
        db_base = os.path.splitext(db_filename)[0].lower()
        live_base = os.path.splitext(live_filename)[0].lower()
        
        if db_base == live_base:
            return True
            
        # Check if one filename contains the other (for timestamp variations)
        if db_base in live_base or live_base in db_base:
            return True
            
        return False
        
    def _should_update_job(self, job, live_data: Dict[str, Any]) -> bool:
        """Determine if a job needs to be updated based on live data"""
        
        # Get live status and progress
        live_status = live_data.get('status', 'idle').lower()
        live_progress = live_data.get('progress') or {}
        live_progress_percent = live_progress.get('percentage', 0)
        
        current_status = job.status.lower()
        current_progress = getattr(job, 'progress_percentage', 0) or 0
        
        # Check if status changed
        status_map = {
            'printing': 'printing',
            'paused': 'printing',  # Keep as printing for paused
            'stopped': 'failed',
            'finished': 'completed',
            'failed': 'failed',
            'idle': 'uploaded'  # If idle but job was printing, mark as uploaded
        }
        
        expected_status = status_map.get(live_status, current_status)
        
        # Update needed if:
        # 1. Status changed
        # 2. Progress changed significantly (>1%)
        # 3. Job completed (status changed to completed/failed)
        
        if expected_status != current_status:
            logger.debug(f"Job {job.id} status change: {current_status} -> {expected_status}")
            return True
            
        if live_status == 'printing' and abs(live_progress_percent - current_progress) > 1:
            logger.debug(f"Job {job.id} progress change: {current_progress}% -> {live_progress_percent}%")
            return True
            
        return False
        
    async def _update_job_from_live_data(self, match: JobMatch, db_service):
        """Update a job in the database based on live printer data"""
        try:
            live_data = match.live_status
            live_status = live_data.get('status', 'idle').lower()
            live_progress = live_data.get('progress') or {}
            live_progress_percent = live_progress.get('percentage', 0)
            
            # Map live status to database status
            status_map = {
                'printing': 'printing',
                'paused': 'printing',
                'stopped': 'failed', 
                'finished': 'completed',
                'failed': 'failed',
                'idle': 'uploaded'
            }
            
            new_status = status_map.get(live_status, match.db_status)
            
            # Prepare update data
            update_data = {
                'status': new_status,
                'progress_percentage': round(live_progress_percent, 1)
            }
            
            # Add timestamps for completion
            if new_status in ['completed', 'failed'] and match.db_status not in ['completed', 'failed']:
                update_data['time_completed'] = datetime.now(timezone.utc)
                logger.info(f"Job {match.db_job_id} completed with status: {new_status}")
                
            # Add start timestamp if transitioning to printing
            if new_status == 'printing' and match.db_status != 'printing':
                update_data['time_started'] = datetime.now(timezone.utc)
                logger.info(f"Job {match.db_job_id} started printing")
                
            # Update the job in the database
            success = await db_service.update_print_job(match.db_job_id, update_data, self.tenant_id)
            
            if success:
                logger.info(f"Updated job {match.db_job_id}: {match.db_status} -> {new_status}, progress: {live_progress_percent}%")
            else:
                logger.error(f"Failed to update job {match.db_job_id} in database")
                
        except Exception as e:
            logger.error(f"Error updating job {match.db_job_id}: {e}")

# Global service instance
print_job_sync_service = PrintJobSyncService()