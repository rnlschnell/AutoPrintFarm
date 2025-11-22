"""
Service for synchronizing live printer status with print job database
"""

import asyncio
import logging
import math
from typing import Dict, List, Optional, Set, Any
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
            logger.debug("Starting live job sync cycle")

            # Get live status from all printers
            all_live_status = await printer_manager.get_all_live_status()
            logger.debug(f"Retrieved live status from {len(all_live_status)} printers")

            current_jobs: Dict[str, LiveJobInfo] = {}

            for status_data in all_live_status:
                printer_id = status_data.get("printer_id")
                if not printer_id:
                    logger.debug("Skipping status data without printer_id")
                    continue

                job_status = status_data.get("status", "idle")
                current_job = status_data.get("current_job")
                progress_data = status_data.get("progress")

                logger.debug(f"Printer {printer_id} status: {job_status}, has_current_job: {bool(current_job)}")

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
                        logger.debug(f"Tracking job on printer {printer_id}: {filename} at {progress_percentage}%")
                    else:
                        logger.debug(f"Printer {printer_id} has current_job but no filename")
                else:
                    logger.debug(f"Printer {printer_id} not printing or no current_job (status: {job_status})")

            logger.debug(f"Found {len(current_jobs)} active print jobs")

            # Process job changes
            await self._process_job_changes(current_jobs, all_live_status)

            # Update tracked jobs
            self.tracked_jobs = current_jobs
            logger.debug("Live job sync cycle completed successfully")

        except Exception as e:
            logger.error(f"Failed to sync live jobs: {e}", exc_info=True)
    
    async def _process_job_changes(self, current_jobs: Dict[str, LiveJobInfo], all_live_status: List[Dict[str, Any]]):
        """Process changes in active jobs"""
        # Find new jobs (started printing)
        for printer_id, job_info in current_jobs.items():
            if printer_id not in self.tracked_jobs:
                await self._handle_new_job(job_info)
            else:
                await self._handle_job_update(job_info)

        # Find completed/stopped/paused jobs
        for printer_id in self.tracked_jobs:
            if printer_id not in current_jobs:
                old_job = self.tracked_jobs[printer_id]

                # Find current printer status from all_live_status
                current_printer_status = "idle"
                printer_state_data = None
                for status_data in all_live_status:
                    if status_data.get("printer_id") == printer_id:
                        current_printer_status = status_data.get("status", "idle")
                        printer_state_data = status_data  # Pass full state data
                        break

                # If printer is paused, mark job as paused (not completed!)
                if current_printer_status == "paused":
                    await self._handle_job_paused(old_job)
                else:
                    # Printer is idle/stopped, pass state data to determine final status
                    await self._handle_job_completed(old_job, printer_state_data)

        # Also check for jobs that were at high progress and printer went idle
        # This handles the case where websocket doesn't reach 100% but printer finished
        for printer_id in self.tracked_jobs:
            if printer_id not in current_jobs:
                old_job = self.tracked_jobs[printer_id]

                # Find current printer status from all_live_status
                current_printer_status = None
                for status_data in all_live_status:
                    if status_data.get("printer_id") == printer_id:
                        current_printer_status = status_data.get("status", "idle")
                        break

                # If printer went to idle and job was at high progress, this confirms completion
                if (old_job.status in ["printing", "paused"] and
                    current_printer_status == "idle" and
                    old_job.progress_percentage >= 95.0):
                    logger.info(f"Confirming completion: Printer {printer_id} went idle with job at {old_job.progress_percentage}%")
                    # Job completion is already handled above, but this log helps with debugging
    
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
    
    async def _handle_job_completed(self, job_info: LiveJobInfo, printer_state_data: Optional[Dict[str, Any]] = None):
        """Handle a job that completed, failed, or was cancelled"""
        logger.info(f"Print job stopped: {job_info.filename} on printer {job_info.printer_id} (final progress: {job_info.progress_percentage}%)")

        try:
            # Find corresponding database job
            existing_job = await self._find_existing_job(job_info)

            if existing_job:
                # Determine final status based on printer state
                final_status = 'completed'  # Default assumption
                final_progress = job_info.progress_percentage

                # Check raw printer state to distinguish between completed/failed/cancelled
                if printer_state_data:
                    raw_gcode_state = printer_state_data.get('raw_gcode_state', '').upper()
                    error_code = printer_state_data.get('error_code', 0)

                    if raw_gcode_state == 'FAILED':
                        # Printer reported FAILED state
                        if error_code and error_code > 0:
                            # Has error code = actual failure
                            final_status = 'failed'
                            logger.warning(f"Print failed with error code {error_code}")
                        else:
                            # No error code = user cancelled
                            final_status = 'cancelled'
                            logger.info(f"Print was cancelled by user")
                    elif job_info.progress_percentage >= 95.0:
                        # High progress and not FAILED = successful completion
                        final_status = 'completed'
                        final_progress = 100.0  # Force 100% for near-complete jobs
                    else:
                        # Low progress, not explicitly FAILED, but stopped = likely failed
                        final_status = 'failed'
                        logger.warning(f"Print stopped at low progress ({job_info.progress_percentage}%), marking as failed")
                else:
                    # No printer state data - fall back to progress-based logic
                    if job_info.progress_percentage >= 95.0:
                        final_status = 'completed'
                        final_progress = 100.0
                    else:
                        final_status = 'failed'

                await self._update_job_status(
                    existing_job['id'],
                    final_status,
                    final_progress,
                    set_completed_time=True
                )
                logger.info(f"Marked job {existing_job['id']} as {final_status} with {final_progress}% progress")

                # Only update finished goods inventory for successful completions
                if final_status == 'completed':
                    await self._update_finished_goods_inventory(existing_job["id"])
                    # Deduct filament from printer
                    await self._deduct_filament_from_printer(existing_job["id"], job_info.printer_id)
                else:
                    logger.info(f"Skipping worklist generation for {final_status} job")

        except Exception as e:
            logger.error(f"Failed to handle job completion {job_info.filename}: {e}")

    async def _handle_job_paused(self, job_info: LiveJobInfo):
        """Handle a job that was paused"""
        logger.info(f"Print job paused: {job_info.filename} on printer {job_info.printer_id} at {job_info.progress_percentage}%")

        try:
            # Find corresponding database job and mark as paused
            existing_job = await self._find_existing_job(job_info)

            if existing_job:
                await self._update_job_status(
                    existing_job['id'],
                    'paused',
                    job_info.progress_percentage
                )
                logger.info(f"Marked job {existing_job['id']} as paused at {job_info.progress_percentage}% progress")

        except Exception as e:
            logger.error(f"Failed to handle job pause {job_info.filename}: {e}")

    async def _find_existing_job(self, job_info: LiveJobInfo) -> Optional[Dict]:
        """Find existing database job that matches the live job"""
        try:
            from sqlalchemy import text

            # The printer_id from live status is numeric, but jobs use UUID
            # First, try to find the printer UUID from the numeric ID
            printer_uuid_query = text("""
            SELECT id FROM printers
            WHERE printer_id = :numeric_id
            LIMIT 1
            """)

            db_service = await get_database_service()
            async with db_service.get_session() as session:
                # Get printer UUID from numeric ID
                printer_result = await session.execute(
                    printer_uuid_query,
                    {"numeric_id": int(job_info.printer_id) if job_info.printer_id.isdigit() else None}
                )
                printer_row = printer_result.fetchone()

                if not printer_row:
                    logger.warning(f"Could not find printer UUID for numeric ID: {job_info.printer_id}")
                    # Fall back to using the ID as-is (in case it's already a UUID)
                    printer_uuid = job_info.printer_id
                else:
                    printer_uuid = printer_row[0]
                    logger.debug(f"Mapped printer numeric ID {job_info.printer_id} to UUID {printer_uuid}")

                # Now find the job using the printer UUID
                job_query = text("""
                SELECT id, status, progress_percentage
                FROM print_jobs
                WHERE file_name = :filename
                AND printer_id = :printer_id
                AND status IN ('queued', 'processing', 'uploaded', 'printing', 'paused')
                ORDER BY time_submitted DESC
                LIMIT 1
                """)

                result = await session.execute(
                    job_query,
                    {"filename": job_info.filename, "printer_id": printer_uuid}
                )
                row = result.fetchone()

                if row:
                    logger.debug(f"Found existing job {row[0]} for {job_info.filename} on printer {printer_uuid}")
                    return {
                        'id': row[0],
                        'status': row[1],
                        'progress_percentage': row[2]
                    }
                else:
                    logger.debug(f"No existing job found for {job_info.filename} on printer {printer_uuid}")
                return None

        except Exception as e:
            logger.error(f"Failed to find existing job: {e}")
            return None
    
    async def _create_external_job(self, job_info: LiveJobInfo):
        """Create database entry for externally started job"""
        try:
            from sqlalchemy import text
            import uuid

            # First get the printer UUID from numeric ID
            printer_uuid_query = text("""
            SELECT id, tenant_id FROM printers
            WHERE printer_id = :numeric_id
            LIMIT 1
            """)

            db_service = await get_database_service()
            async with db_service.get_session() as session:
                # Get printer UUID and tenant_id from numeric ID
                printer_result = await session.execute(
                    printer_uuid_query,
                    {"numeric_id": int(job_info.printer_id) if job_info.printer_id.isdigit() else None}
                )
                printer_row = printer_result.fetchone()

                if not printer_row:
                    logger.error(f"Cannot create external job: printer with numeric ID {job_info.printer_id} not found")
                    return

                printer_uuid = printer_row[0]
                tenant_id = printer_row[1] if printer_row[1] else ''

                # Now create the job with the correct printer UUID
                insert_query = text("""
                INSERT INTO print_jobs (
                    id, printer_id, print_file_id, file_name, status, progress_percentage,
                    time_submitted, time_started, color, filament_type,
                    material_type, number_of_units, priority, tenant_id
                ) VALUES (
                    :id, :printer_id, :print_file_id, :file_name, :status, :progress_percentage,
                    :time_submitted, :time_started, :color, :filament_type,
                    :material_type, :number_of_units, :priority, :tenant_id
                )
                """)

                now = datetime.now(timezone.utc)
                job_id = str(uuid.uuid4())
                # Create a dummy print_file_id since it's required
                print_file_id = str(uuid.uuid4())

                await session.execute(insert_query, {
                    'id': job_id,
                    'printer_id': printer_uuid,
                    'print_file_id': print_file_id,  # Required field
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
                    'tenant_id': tenant_id
                })
                await session.commit()
                logger.info(f"Created external job {job_id} for {job_info.filename} on printer {printer_uuid}")

        except Exception as e:
            logger.error(f"Failed to create external job: {e}")
    
    async def _update_job_status(self, job_id: str, status: str, progress: float, set_completed_time: bool = False):
        """Update job status and progress in database"""
        try:
            from sqlalchemy import text

            now = datetime.now(timezone.utc)

            if set_completed_time and status == 'completed':
                # When completing a job, set time_completed
                update_query = text("""
                UPDATE print_jobs
                SET status = :status, progress_percentage = :progress, time_completed = :time_completed
                WHERE id = :job_id
                """)

                db_service = await get_database_service()
                async with db_service.get_session() as session:
                    await session.execute(update_query, {
                        'status': status,
                        'progress': progress,
                        'time_completed': now,
                        'job_id': job_id
                    })
                    await session.commit()
            else:
                # Regular status update
                update_query = text("""
                UPDATE print_jobs
                SET status = :status, progress_percentage = :progress, time_started = :time_started
                WHERE id = :job_id
                """)

                db_service = await get_database_service()
                async with db_service.get_session() as session:
                    await session.execute(update_query, {
                        'status': status,
                        'progress': progress,
                        'time_started': now,
                        'job_id': job_id
                    })
                    await session.commit()

        except Exception as e:
            logger.error(f"Failed to update job status: {e}")


    async def _update_finished_goods_inventory(self, job_id: str):
        """Update finished goods inventory when a print job completes"""
        try:
            from sqlalchemy import text

            # Fetch the job details to get product_sku_id, requires_assembly, and quantity_per_print
            query = text("""
            SELECT product_sku_id, requires_assembly, quantity_per_print
            FROM print_jobs
            WHERE id = :job_id
            """)

            db_service = await get_database_service()
            async with db_service.get_session() as session:
                result = await session.execute(query, {"job_id": job_id})
                row = result.fetchone()

                if not row:
                    logger.warning(f"Could not find job details for {job_id} to update inventory")
                    return

                product_sku_id = row[0]
                requires_assembly = row[1] if row[1] is not None else False
                quantity_per_print = row[2] if row[2] is not None else 1

                if product_sku_id:
                    # Call the database service method to update finished goods
                    success = await db_service.update_finished_goods_from_completed_job(
                        product_sku_id,
                        requires_assembly,
                        quantity_per_print
                    )

                    if success:
                        logger.info(f"Successfully updated finished goods inventory for job {job_id}")
                    else:
                        logger.warning(f"Failed to update finished goods inventory for job {job_id}")
                else:
                    logger.debug(f"Job {job_id} has no product_sku_id, skipping inventory update")

        except Exception as e:
            logger.error(f"Failed to update finished goods inventory for job {job_id}: {e}")

    async def _deduct_filament_from_printer(self, job_id: str, printer_numeric_id: str):
        """Deduct filament used from printer's filament_level when job completes"""
        try:
            from sqlalchemy import text

            db_service = await get_database_service()

            # First, get the printer UUID from numeric ID
            printer_uuid_query = text("""
            SELECT id, tenant_id FROM printers
            WHERE printer_id = :numeric_id
            LIMIT 1
            """)

            async with db_service.get_session() as session:
                printer_result = await session.execute(
                    printer_uuid_query,
                    {"numeric_id": int(printer_numeric_id) if printer_numeric_id.isdigit() else None}
                )
                printer_row = printer_result.fetchone()

                if not printer_row:
                    logger.warning(f"Printer with numeric ID {printer_numeric_id} not found, skipping filament deduction")
                    return

                printer_uuid = printer_row[0]

                # Get filament weight from print_files via print_jobs
                query = text("""
                SELECT pf.filament_weight_grams
                FROM print_jobs pj
                JOIN print_files pf ON pj.print_file_id = pf.id
                WHERE pj.id = :job_id
                """)

                result = await session.execute(query, {"job_id": job_id})
                row = result.fetchone()

                if not row or row[0] is None:
                    logger.warning(f"No filament weight found for job {job_id}, skipping filament deduction")
                    return

                filament_grams = row[0]
                # Round UP (3.21 -> 4 grams)
                filament_rounded = math.ceil(filament_grams)

                logger.info(f"Deducting {filament_rounded}g (from {filament_grams}g) from printer {printer_uuid}")

            # Get current printer to calculate new level
            printer = await db_service.get_printer_by_id(printer_uuid)
            if not printer:
                logger.error(f"Printer {printer_uuid} not found, cannot deduct filament")
                return

            current_level = printer.filament_level or 0
            new_level = max(0, current_level - filament_rounded)  # Don't go negative

            # Use database service upsert_printer to update
            update_data = {
                'id': printer_uuid,
                'tenant_id': printer.tenant_id,
                'filament_level': new_level,
                'updated_at': datetime.now(timezone.utc)
            }

            success = await db_service.upsert_printer(update_data)

            if success:
                logger.info(f"Updated printer {printer_uuid} filament level: {current_level}g -> {new_level}g")
            else:
                logger.error(f"Failed to update filament level for printer {printer_uuid}")

        except Exception as e:
            logger.error(f"Failed to deduct filament for job {job_id}: {e}")

# Global service instance
live_job_sync_service = LiveJobSyncService()