"""
API endpoints for print jobs management with local sync
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
import logging

from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
from ..services.sync_service import get_sync_service
from ..models.database import PrintJob

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/print-jobs-sync",
    tags=["Print Jobs Sync"],
    responses={404: {"description": "Not found"}},
)

@router.post("/")
async def create_print_job(job_data: dict):
    """
    Create a new print job in local SQLite (source of truth)
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Add tenant_id to job data
        job_data['tenant_id'] = tenant_id
        
        # Create job in local database
        db_service = await get_database_service()
        new_job = await db_service.create_print_job(job_data)
        
        if not new_job:
            raise HTTPException(status_code=500, detail="Failed to create print job")
        
        logger.info(f"Print job created successfully in local database: {new_job.id}")
        
        # Trigger immediate backup to Supabase
        sync_service = await get_sync_service()
        if sync_service:
            await sync_service.trigger_immediate_backup('print_jobs', new_job.id)
        
        return {
            "success": True,
            "message": "Print job created successfully",
            "print_job": new_job.to_dict()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create print job: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/", response_model=List[dict])
async def get_print_jobs():
    """
    Get all print jobs for the current tenant from local SQLite
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get print jobs from local database
        db_service = await get_database_service()
        jobs = await db_service.get_print_jobs_by_tenant(tenant_id)
        
        # Convert to dict for response
        return [job.to_dict() for job in jobs]
        
    except Exception as e:
        logger.error(f"Failed to get print jobs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/{status}", response_model=List[dict])
async def get_print_jobs_by_status(status: str):
    """
    Get print jobs by status from local SQLite
    Valid statuses: queued, printing, completed, failed, cancelled
    """
    try:
        # Validate status
        valid_statuses = ['queued', 'printing', 'completed', 'failed', 'cancelled']
        if status not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}")
        
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get print jobs by status from local database
        db_service = await get_database_service()
        jobs = await db_service.get_print_jobs_by_status(tenant_id, status)
        
        # Convert to dict for response
        return [job.to_dict() for job in jobs]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get print jobs by status {status}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{job_id}")
async def update_print_job(job_id: str, updates: dict):
    """
    Update a specific print job by ID in local SQLite
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # First check if job exists and belongs to this tenant
        db_service = await get_database_service()
        job = await db_service.get_print_job_by_id(job_id)
        
        if not job:
            raise HTTPException(status_code=404, detail="Print job not found")
            
        if job.tenant_id != tenant_id:
            raise HTTPException(status_code=403, detail="Access denied to this print job")
        
        # Update the job in local database
        success = await db_service.update_print_job(job_id, updates, tenant_id)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update print job")
        
        # Get updated job
        updated_job = await db_service.get_print_job_by_id(job_id)
        
        logger.info(f"Print job {job_id} updated successfully for tenant {tenant_id}")
        
        return {
            "success": True,
            "message": "Print job updated successfully",
            "print_job": updated_job.to_dict() if updated_job else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update print job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{job_id}")
async def delete_print_job(job_id: str):
    """
    Delete a specific print job by ID from local SQLite
    This completely removes the job from the database
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # First check if job exists and belongs to this tenant
        db_service = await get_database_service()
        job = await db_service.get_print_job_by_id(job_id)
        
        if not job:
            raise HTTPException(status_code=404, detail="Print job not found")
            
        if job.tenant_id != tenant_id:
            raise HTTPException(status_code=403, detail="Access denied to this print job")
        
        # Prevent deletion of actively printing jobs, but allow deletion of stuck jobs
        if job.status == 'printing':
            # Smart detection: If job shows 100% progress, it's likely stuck and completed
            if job.progress_percentage == 100:
                logger.warning(f"Found stuck job {job_id} with 'printing' status but 100% progress - allowing deletion")
            else:
                raise HTTPException(status_code=400, detail="Cannot delete a job that is currently printing. Stop the print first.")
        
        # Delete the job from local database
        success = await db_service.delete_print_job(job_id, tenant_id)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete print job")
        
        logger.info(f"Print job {job_id} deleted successfully for tenant {tenant_id}")
        
        return {
            "success": True,
            "message": "Print job deleted successfully",
            "deleted_job_id": job_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete print job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{job_id}", response_model=dict)
async def get_print_job(job_id: str):
    """
    Get a specific print job by ID from local SQLite
    """
    try:
        db_service = await get_database_service()
        job = await db_service.get_print_job_by_id(job_id)
        
        if not job:
            raise HTTPException(status_code=404, detail="Print job not found")
        
        return job.to_dict()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get print job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync")
async def force_print_jobs_sync():
    """
    Force a manual sync of print jobs - DISABLED for local-first architecture
    
    LOCAL-FIRST ARCHITECTURE: Print jobs sync from Supabase is disabled 
    to prevent restoration of deleted jobs. Local SQLite is the source of truth.
    """
    try:
        # Get current count from local database only
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if tenant_id:
            db_service = await get_database_service()
            jobs = await db_service.get_print_jobs_by_tenant(tenant_id)
            
            return {
                "success": True,
                "message": "Local-first architecture: sync from Supabase disabled. Local SQLite is source of truth.",
                "architecture": "local-first",
                "local_print_jobs_count": len(jobs),
                "supabase_sync_disabled": True,
                "reason": "Prevents restoration of deleted jobs"
            }
        else:
            return {
                "success": True,
                "message": "Local-first architecture: sync from Supabase disabled. Tenant not configured.",
                "architecture": "local-first",
                "local_print_jobs_count": 0,
                "supabase_sync_disabled": True
            }
        
    except Exception as e:
        logger.error(f"Failed to get local print jobs count: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/sync")
async def get_print_jobs_sync_status():
    """
    Get the current sync status for print jobs
    """
    try:
        sync_service = await get_sync_service()
        
        if not sync_service:
            return {
                "sync_enabled": False,
                "message": "Sync service not configured"
            }
        
        # Get tenant ID
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            return {
                "sync_enabled": False,
                "message": "Tenant not configured"
            }
        
        # Get print jobs count
        db_service = await get_database_service()
        jobs = await db_service.get_print_jobs_by_tenant(tenant_id)
        
        # Get sync status
        sync_status = await sync_service.get_sync_status()
        
        return {
            "sync_enabled": True,
            "is_running": sync_status.get('is_running', False),
            "connected_to_realtime": sync_status.get('connected_to_realtime', False),
            "tenant_id": tenant_id,
            "local_print_jobs_count": len(jobs),
            "last_check": sync_status.get('last_check')
        }
        
    except Exception as e:
        logger.error(f"Failed to get print jobs sync status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/queue/active")
async def get_active_queue():
    """
    Get the active print queue (queued and printing jobs)
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get jobs with active statuses
        db_service = await get_database_service()
        queued_jobs = await db_service.get_print_jobs_by_status(tenant_id, 'queued')
        printing_jobs = await db_service.get_print_jobs_by_status(tenant_id, 'printing')
        
        # Combine and sort by priority (desc) then submission time
        active_jobs = queued_jobs + printing_jobs
        active_jobs.sort(key=lambda job: (-job.priority, job.time_submitted))
        
        # Convert to dict for response
        return [job.to_dict() for job in active_jobs]
        
    except Exception as e:
        logger.error(f"Failed to get active print queue: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats/summary")
async def get_print_jobs_summary():
    """
    Get summary statistics for print jobs
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get all print jobs
        db_service = await get_database_service()
        all_jobs = await db_service.get_print_jobs_by_tenant(tenant_id)
        
        # Calculate statistics by status
        status_counts = {}
        total_print_time = 0
        total_filament = 0
        
        for job in all_jobs:
            status = job.status or 'unknown'
            status_counts[status] = status_counts.get(status, 0) + 1
            
            # Add to totals for completed jobs
            if status == 'completed':
                if job.actual_print_time_minutes:
                    total_print_time += job.actual_print_time_minutes
                if job.filament_needed_grams:
                    total_filament += job.filament_needed_grams
        
        return {
            "total_jobs": len(all_jobs),
            "status_breakdown": status_counts,
            "total_print_time_hours": round(total_print_time / 60, 2) if total_print_time > 0 else 0,
            "total_filament_grams": total_filament / 100.0 if total_filament > 0 else 0,  # Convert from centrigrams
            "queued_jobs": status_counts.get('queued', 0),
            "active_jobs": status_counts.get('printing', 0),
            "completed_jobs": status_counts.get('completed', 0),
            "failed_jobs": status_counts.get('failed', 0)
        }
        
    except Exception as e:
        logger.error(f"Failed to get print jobs summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))