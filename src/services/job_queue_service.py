"""
Job queue management service to prevent resource conflicts and ensure orderly processing
"""

import asyncio
import logging
import time
from typing import Dict, List, Optional, Callable, Any
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import uuid

from ..utils.resource_monitor import resource_monitor

logger = logging.getLogger(__name__)

class JobStatus(Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class JobPriority(Enum):
    LOW = 1
    NORMAL = 2
    HIGH = 3
    URGENT = 4

@dataclass
class QueuedJob:
    """Represents a job in the processing queue"""
    id: str
    job_type: str  # e.g., "3mf_processing", "slicing", "print_start"
    priority: JobPriority
    payload: Dict[str, Any]
    callback: Callable
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    status: JobStatus = JobStatus.QUEUED
    error_message: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3

class JobQueueService:
    """
    Manages job queues to prevent resource conflicts and ensure orderly processing
    """
    
    def __init__(self):
        self.job_queues: Dict[str, List[QueuedJob]] = {
            "3mf_processing": [],
            "slicing": [],
            "print_start": [],
            "general": []
        }
        self.active_jobs: Dict[str, QueuedJob] = {}
        self.completed_jobs: List[QueuedJob] = []
        self.max_completed_history = 10  # CRITICAL: Reduced from 100 to 10 to prevent memory leak
        self.processing_task: Optional[asyncio.Task] = None
        self.is_running = False
        
        # Resource limits for concurrent jobs
        self.max_concurrent_jobs = {
            "3mf_processing": 1,  # Only one 3MF processing at a time (resource intensive)
            "slicing": 1,         # Only one slicing at a time (resource intensive)
            "print_start": 3,     # Allow multiple print starts (less resource intensive)
            "general": 2          # General purpose jobs
        }
        
    async def start(self):
        """Start the job queue processing"""
        if self.is_running:
            return
            
        self.is_running = True
        self.processing_task = asyncio.create_task(self._process_queue())
        logger.info("Job queue service started")
        
    async def stop(self):
        """Stop the job queue processing"""
        self.is_running = False
        if self.processing_task:
            self.processing_task.cancel()
            try:
                await self.processing_task
            except asyncio.CancelledError:
                pass
        logger.info("Job queue service stopped")
        
    async def add_job(
        self, 
        job_type: str, 
        payload: Dict[str, Any], 
        callback: Callable,
        priority: JobPriority = JobPriority.NORMAL,
        max_retries: int = 3
    ) -> str:
        """
        Add a job to the appropriate queue
        
        Args:
            job_type: Type of job (determines which queue to use)
            payload: Job data/parameters
            callback: Async function to execute for this job
            priority: Job priority
            max_retries: Maximum number of retry attempts
            
        Returns:
            Job ID for tracking
        """
        # Validate job type
        if job_type not in self.job_queues:
            job_type = "general"
            
        job_id = str(uuid.uuid4())
        job = QueuedJob(
            id=job_id,
            job_type=job_type,
            priority=priority,
            payload=payload,
            callback=callback,
            max_retries=max_retries
        )
        
        # Insert job in priority order
        queue = self.job_queues[job_type]
        inserted = False
        for i, existing_job in enumerate(queue):
            if job.priority.value > existing_job.priority.value:
                queue.insert(i, job)
                inserted = True
                break
                
        if not inserted:
            queue.append(job)
            
        logger.info(f"Added job {job_id} to {job_type} queue (priority: {priority.name}, queue size: {len(queue)})")
        return job_id
        
    async def cancel_job(self, job_id: str) -> bool:
        """
        Cancel a job if it's still queued
        
        Args:
            job_id: ID of job to cancel
            
        Returns:
            True if job was cancelled, False if not found or already processing
        """
        # Check if job is currently active
        if job_id in self.active_jobs:
            logger.warning(f"Cannot cancel job {job_id}: already processing")
            return False
            
        # Find and remove from queues
        for queue_name, queue in self.job_queues.items():
            for i, job in enumerate(queue):
                if job.id == job_id:
                    job.status = JobStatus.CANCELLED
                    job.completed_at = datetime.now()
                    self.completed_jobs.append(job)
                    del queue[i]
                    logger.info(f"Cancelled job {job_id} from {queue_name} queue")
                    return True
                    
        logger.warning(f"Job {job_id} not found for cancellation")
        return False
        
    def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        """
        Get status information for a job
        
        Args:
            job_id: ID of job to check
            
        Returns:
            Job status dictionary or None if not found
        """
        # Check active jobs
        if job_id in self.active_jobs:
            job = self.active_jobs[job_id]
            return {
                "id": job.id,
                "status": job.status.value,
                "job_type": job.job_type,
                "priority": job.priority.name,
                "created_at": job.created_at.isoformat(),
                "started_at": job.started_at.isoformat() if job.started_at else None,
                "retry_count": job.retry_count,
                "error_message": job.error_message
            }
            
        # Check queued jobs
        for queue_name, queue in self.job_queues.items():
            for job in queue:
                if job.id == job_id:
                    position = queue.index(job) + 1
                    return {
                        "id": job.id,
                        "status": job.status.value,
                        "job_type": job.job_type,
                        "priority": job.priority.name,
                        "queue_position": position,
                        "created_at": job.created_at.isoformat(),
                        "retry_count": job.retry_count
                    }
                    
        # Check completed jobs
        for job in self.completed_jobs:
            if job.id == job_id:
                return {
                    "id": job.id,
                    "status": job.status.value,
                    "job_type": job.job_type,
                    "priority": job.priority.name,
                    "created_at": job.created_at.isoformat(),
                    "started_at": job.started_at.isoformat() if job.started_at else None,
                    "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                    "retry_count": job.retry_count,
                    "error_message": job.error_message
                }
                
        return None
        
    def get_queue_status(self) -> Dict[str, Any]:
        """
        Get overall queue status
        
        Returns:
            Dictionary with queue status information
        """
        queue_info = {}
        for queue_name, queue in self.job_queues.items():
            queue_info[queue_name] = {
                "queued_count": len(queue),
                "active_count": len([j for j in self.active_jobs.values() if j.job_type == queue_name]),
                "max_concurrent": self.max_concurrent_jobs[queue_name]
            }
            
        return {
            "is_running": self.is_running,
            "total_active_jobs": len(self.active_jobs),
            "total_completed_jobs": len(self.completed_jobs),
            "queue_details": queue_info,
            "resource_status": self._get_resource_status()
        }
        
    def _get_resource_status(self) -> Dict[str, Any]:
        """Get current resource status"""
        try:
            is_safe, reason = resource_monitor.check_resources_safe("Queue status check")
            resources = resource_monitor.get_system_resources()
            return {
                "resources_safe": is_safe,
                "reason": reason if not is_safe else None,
                "cpu_percent": resources.cpu_percent,
                "memory_percent": resources.memory_percent,
                "memory_available_mb": resources.memory_available_mb
            }
        except Exception as e:
            return {
                "resources_safe": False,
                "reason": f"Error checking resources: {e}",
                "cpu_percent": 0,
                "memory_percent": 0,
                "memory_available_mb": 0
            }
        
    async def _process_queue(self):
        """Main queue processing loop"""
        logger.info("Started job queue processing loop")
        
        while self.is_running:
            try:
                # Check if system resources are available
                is_safe, reason = resource_monitor.check_resources_safe("Job queue processing")
                if not is_safe:
                    logger.warning(f"Delaying job processing due to resource constraints: {reason}")
                    await asyncio.sleep(30)  # Wait 30 seconds before retrying (increased from 10s)
                    continue
                    
                # Process each queue type
                for queue_name, queue in self.job_queues.items():
                    if not queue:
                        continue
                        
                    # Check if we can start more jobs of this type
                    active_count = len([j for j in self.active_jobs.values() if j.job_type == queue_name])
                    max_concurrent = self.max_concurrent_jobs[queue_name]
                    
                    if active_count >= max_concurrent:
                        continue
                        
                    # Get the highest priority job
                    job = queue.pop(0)
                    
                    # Start processing the job
                    asyncio.create_task(self._process_job(job))
                    
                await asyncio.sleep(5)  # Check every 5 seconds (reduced from 1s to save CPU)
                
            except Exception as e:
                logger.error(f"Error in job queue processing loop: {e}")
                await asyncio.sleep(5)  # Wait before retrying
                
        logger.info("Job queue processing loop stopped")
        
    async def _process_job(self, job: QueuedJob):
        """
        Process a single job
        
        Args:
            job: Job to process
        """
        job.status = JobStatus.PROCESSING
        job.started_at = datetime.now()
        self.active_jobs[job.id] = job
        
        logger.info(f"Starting job {job.id} ({job.job_type}, attempt {job.retry_count + 1})")
        
        try:
            # Execute the job callback
            await job.callback(job.payload)
            
            # Job completed successfully
            job.status = JobStatus.COMPLETED
            job.completed_at = datetime.now()
            logger.info(f"Job {job.id} completed successfully")
            
        except Exception as e:
            logger.error(f"Job {job.id} failed: {e}")
            job.error_message = str(e)
            job.retry_count += 1
            
            # Check if we should retry
            if job.retry_count <= job.max_retries:
                logger.info(f"Retrying job {job.id} (attempt {job.retry_count + 1}/{job.max_retries + 1})")
                # Reset job status and re-queue it
                job.status = JobStatus.QUEUED
                job.started_at = None
                job.error_message = None
                
                # Add back to queue (at the end for fairness)
                self.job_queues[job.job_type].append(job)
            else:
                logger.error(f"Job {job.id} failed permanently after {job.retry_count} attempts")
                job.status = JobStatus.FAILED
                job.completed_at = datetime.now()
                
        finally:
            # Remove from active jobs if completed or failed permanently
            if job.status in [JobStatus.COMPLETED, JobStatus.FAILED]:
                if job.id in self.active_jobs:
                    del self.active_jobs[job.id]
                    
                # Add to completed jobs history
                # Clear payload data to free memory before storing
                job.payload = {"cleared": True, "original_size": len(str(job.payload))}
                job.callback = None  # Clear callback reference
                
                self.completed_jobs.append(job)
                
                # Aggressive cleanup of completed jobs history  
                if len(self.completed_jobs) > self.max_completed_history:
                    # Clear old jobs completely to free memory
                    old_jobs = self.completed_jobs[:-self.max_completed_history]
                    for old_job in old_jobs:
                        old_job.payload = {}
                        old_job.callback = None
                    self.completed_jobs = self.completed_jobs[-self.max_completed_history:]

# Global job queue service instance
job_queue_service = JobQueueService()