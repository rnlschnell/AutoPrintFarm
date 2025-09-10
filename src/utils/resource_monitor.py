"""
Resource monitoring utilities for preventing system overload on Pi
"""

import psutil
import logging
import asyncio
import os
from typing import Dict, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class SystemResources:
    """System resource usage information"""
    cpu_percent: float
    memory_percent: float
    memory_available_mb: float
    disk_percent: float
    load_avg_1min: float
    process_count: int

class ResourceMonitor:
    """Monitor system resources and enforce limits to prevent Pi overload"""
    
    # Realistic limits for Raspberry Pi (adjusted for normal operation)
    MAX_CPU_PERCENT = 85.0
    MAX_MEMORY_PERCENT = 90.0
    MIN_MEMORY_AVAILABLE_MB = 150.0
    MAX_DISK_PERCENT = 95.0
    MAX_LOAD_AVG = 3.0
    MAX_PROCESS_COUNT = 200  # Pi normally runs ~163 processes
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
    
    def get_system_resources(self) -> SystemResources:
        """Get current system resource usage"""
        try:
            # CPU usage (non-blocking, instant reading)
            cpu_percent = psutil.cpu_percent(interval=None)
            
            # Memory usage
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            memory_available_mb = memory.available / (1024 * 1024)
            
            # Disk usage for root partition
            disk = psutil.disk_usage('/')
            disk_percent = disk.percent
            
            # Load average (1 minute)
            load_avg = os.getloadavg()[0] if hasattr(os, 'getloadavg') else 0.0
            
            # Process count
            process_count = len(psutil.pids())
            
            return SystemResources(
                cpu_percent=cpu_percent,
                memory_percent=memory_percent,
                memory_available_mb=memory_available_mb,
                disk_percent=disk_percent,
                load_avg_1min=load_avg,
                process_count=process_count
            )
        except Exception as e:
            logger.error(f"Error getting system resources: {e}")
            # Return safe defaults that will pass checks
            return SystemResources(
                cpu_percent=0.0,
                memory_percent=0.0,
                memory_available_mb=1000.0,
                disk_percent=0.0,
                load_avg_1min=0.0,
                process_count=50
            )
    
    def should_throttle_operation(self, operation_type: str) -> bool:
        """
        Check if an operation should be throttled due to resource constraints
        
        Args:
            operation_type: Type of operation (reconnect, logging, printer_poll, etc.)
            
        Returns:
            True if operation should be throttled, False if safe to proceed
        """
        # Different thresholds for different operations
        if operation_type == "logging":
            # Be very lenient with logging throttling
            resources = self.get_system_resources()
            return resources.memory_percent > 95 or resources.cpu_percent > 95
        
        if operation_type == "printer_poll":
            # Moderate throttling for polling operations
            resources = self.get_system_resources()
            return resources.memory_percent > 85 or resources.cpu_percent > 85
        
        if operation_type == "reconnect":
            # More strict for reconnection attempts
            is_safe, _ = self.check_resources_safe(operation_type)
            return not is_safe
        
        # Default: check general resource safety
        is_safe, _ = self.check_resources_safe(operation_type)
        return not is_safe
    
    def check_resources_safe(self, operation_type: str = "operation") -> Tuple[bool, str]:
        """
        Check if system resources are safe for intensive operations
        
        Returns:
            (is_safe, reason_if_not_safe)
        """
        resources = self.get_system_resources()
        
        # Check each resource limit
        if resources.cpu_percent > self.MAX_CPU_PERCENT:
            return False, f"CPU usage too high: {resources.cpu_percent:.1f}% (max {self.MAX_CPU_PERCENT}%)"
        
        if resources.memory_percent > self.MAX_MEMORY_PERCENT:
            return False, f"Memory usage too high: {resources.memory_percent:.1f}% (max {self.MAX_MEMORY_PERCENT}%)"
        
        if resources.memory_available_mb < self.MIN_MEMORY_AVAILABLE_MB:
            return False, f"Available memory too low: {resources.memory_available_mb:.0f}MB (min {self.MIN_MEMORY_AVAILABLE_MB}MB)"
        
        if resources.disk_percent > self.MAX_DISK_PERCENT:
            return False, f"Disk usage too high: {resources.disk_percent:.1f}% (max {self.MAX_DISK_PERCENT}%)"
        
        if resources.load_avg_1min > self.MAX_LOAD_AVG:
            return False, f"System load too high: {resources.load_avg_1min:.2f} (max {self.MAX_LOAD_AVG})"
        
        if resources.process_count > self.MAX_PROCESS_COUNT:
            return False, f"Too many processes: {resources.process_count} (max {self.MAX_PROCESS_COUNT})"
        
        # Only log resource usage if there are issues or periodically
        if not resources.memory_percent < 50:  # Only log if memory usage is concerning
            logger.info(f"Resource check for {operation_type}: "
                       f"CPU: {resources.cpu_percent:.1f}%, "
                       f"Memory: {resources.memory_percent:.1f}% "
                       f"({resources.memory_available_mb:.0f}MB available), "
                       f"Load: {resources.load_avg_1min:.2f}")
        
        return True, "Resources are safe"
    
    async def monitor_during_operation(
        self, 
        operation_name: str, 
        check_interval: float = 10.0,
        max_duration: float = 300.0
    ) -> None:
        """
        Monitor resources during an operation and log warnings
        
        Args:
            operation_name: Name of the operation being monitored
            check_interval: Seconds between resource checks
            max_duration: Maximum duration to monitor (seconds)
        """
        start_time = asyncio.get_event_loop().time()
        check_count = 0
        
        while True:
            current_time = asyncio.get_event_loop().time()
            elapsed = current_time - start_time
            
            if elapsed > max_duration:
                logger.warning(f"Operation '{operation_name}' exceeded maximum duration ({max_duration}s)")
                break
            
            resources = self.get_system_resources()
            check_count += 1
            
            # Log every 30 seconds or if resources are concerning
            should_log = (check_count % 3 == 0) or (
                resources.cpu_percent > 70 or 
                resources.memory_percent > 75 or
                resources.memory_available_mb < 300
            )
            
            if should_log:
                logger.info(f"Operation '{operation_name}' resources at {elapsed:.0f}s: "
                           f"CPU: {resources.cpu_percent:.1f}%, "
                           f"Memory: {resources.memory_percent:.1f}% "
                           f"({resources.memory_available_mb:.0f}MB available)")
            
            # Check for dangerous resource levels
            if resources.memory_available_mb < 100:
                logger.error(f"CRITICAL: Very low memory during '{operation_name}': "
                            f"{resources.memory_available_mb:.0f}MB available")
                break
                
            if resources.cpu_percent > 95:
                logger.warning(f"HIGH CPU usage during '{operation_name}': {resources.cpu_percent:.1f}%")
            
            await asyncio.sleep(check_interval)
    
    def get_recommended_limits(self, file_size_mb: float, object_count: int) -> Dict[str, int]:
        """
        Get recommended timeout and resource limits based on operation parameters
        
        Args:
            file_size_mb: Size of input file in MB
            object_count: Number of objects to process
            
        Returns:
            Dict with recommended timeouts and limits
        """
        # Base timeouts (conservative for Pi)
        base_multiply_timeout = 10
        base_slice_timeout = 60
        
        # Scale timeouts based on complexity
        size_factor = max(1.0, file_size_mb / 10.0)  # Scale based on file size
        object_factor = max(1.0, object_count / 3.0)  # Scale based on object count
        
        multiply_timeout = int(base_multiply_timeout * size_factor * object_factor)
        slice_timeout = int(base_slice_timeout * size_factor * object_factor)
        
        # Cap timeouts to prevent infinite waits
        multiply_timeout = min(multiply_timeout, 120)  # Max 2 minutes for multiply
        slice_timeout = min(slice_timeout, 600)        # Max 10 minutes for slice
        
        return {
            "multiply_timeout": multiply_timeout,
            "slice_timeout": slice_timeout,
            "max_file_size_mb": 50,  # Reject files larger than 50MB
            "max_object_count": 10,  # Limit object count for Pi
        }

# Global resource monitor instance
resource_monitor = ResourceMonitor()