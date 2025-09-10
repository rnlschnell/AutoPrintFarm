"""
Service startup and shutdown management
"""

import asyncio
import logging
from typing import List, Callable

from .job_queue_service import job_queue_service

logger = logging.getLogger(__name__)

class StartupService:
    """Manages startup and shutdown of various services"""
    
    def __init__(self):
        self.startup_tasks: List[Callable] = []
        self.shutdown_tasks: List[Callable] = []
        self.is_started = False
        
    def add_startup_task(self, task: Callable):
        """Add a task to run on startup"""
        self.startup_tasks.append(task)
        
    def add_shutdown_task(self, task: Callable):
        """Add a task to run on shutdown"""
        self.shutdown_tasks.append(task)
        
    async def startup(self):
        """Run all startup tasks"""
        if self.is_started:
            logger.warning("Startup service already started")
            return
            
        logger.info("Starting up services...")
        
        # Start job queue service
        try:
            await job_queue_service.start()
            logger.info("Job queue service started successfully")
        except Exception as e:
            logger.error(f"Failed to start job queue service: {e}")
            raise
            
        # Run custom startup tasks
        for task in self.startup_tasks:
            try:
                if asyncio.iscoroutinefunction(task):
                    await task()
                else:
                    task()
                logger.info(f"Startup task {task.__name__} completed")
            except Exception as e:
                logger.error(f"Startup task {task.__name__} failed: {e}")
                # Continue with other tasks, don't fail entire startup
                
        self.is_started = True
        logger.info("All services started successfully")
        
    async def shutdown(self):
        """Run all shutdown tasks"""
        if not self.is_started:
            logger.warning("Startup service not started, nothing to shutdown")
            return
            
        logger.info("Shutting down services...")
        
        # Run custom shutdown tasks
        for task in self.shutdown_tasks:
            try:
                if asyncio.iscoroutinefunction(task):
                    await task()
                else:
                    task()
                logger.info(f"Shutdown task {task.__name__} completed")
            except Exception as e:
                logger.error(f"Shutdown task {task.__name__} failed: {e}")
                # Continue with other tasks
                
        # Stop job queue service
        try:
            await job_queue_service.stop()
            logger.info("Job queue service stopped successfully")
        except Exception as e:
            logger.error(f"Failed to stop job queue service: {e}")
            
        self.is_started = False
        logger.info("All services shut down")

# Global startup service instance
startup_service = StartupService()