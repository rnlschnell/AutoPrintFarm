"""
Connection status monitoring API endpoint
Provides real-time information about connection manager and resource usage
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any
import logging

from ..core.connection_manager import connection_manager
from ..utils.resource_monitor import resource_monitor

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/connection-status", 
    tags=["Connection Status"],
    responses={404: {"description": "Not found"}},
)

@router.get("/")
async def get_connection_status() -> Dict[str, Any]:
    """Get current connection manager and resource status"""
    try:
        # Get connection manager status
        connection_status = connection_manager.get_status()
        
        # Get resource monitor status  
        resource_status = resource_monitor.check_system_health()
        
        # Calculate overall system health
        system_health = "healthy"
        if resource_status["cpu_percent"] > 80 or resource_status["memory_percent"] > 85:
            system_health = "overloaded"
        elif resource_status["cpu_percent"] > 60 or resource_status["memory_percent"] > 70:
            system_health = "stressed"
        
        # Count circuit breaker states
        circuit_states = {}
        for printer_id, printer_info in connection_status.get("printers", {}).items():
            state = printer_info.get("circuit_state", "unknown")
            circuit_states[state] = circuit_states.get(state, 0) + 1
        
        return {
            "success": True,
            "timestamp": resource_status.get("timestamp", "unknown"),
            "system_health": system_health,
            "resource_usage": {
                "cpu_percent": resource_status["cpu_percent"], 
                "memory_percent": resource_status["memory_percent"],
                "memory_available_mb": resource_status["memory_available_mb"],
                "disk_percent": resource_status.get("disk_percent", 0),
                "disk_free_gb": resource_status.get("disk_free_gb", 0)
            },
            "connection_manager": {
                "global_attempts_last_minute": connection_status["global_attempts_last_minute"],
                "active_connections": connection_status["active_connections"], 
                "max_concurrent": connection_status["max_concurrent"],
                "circuit_breaker_states": circuit_states,
                "total_printers": len(connection_status.get("printers", {}))
            },
            "printers": connection_status.get("printers", {})
        }
        
    except Exception as e:
        logger.error(f"Failed to get connection status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reset-circuit-breaker/{printer_id}")
async def reset_circuit_breaker(printer_id: str) -> Dict[str, Any]:
    """Reset circuit breaker for a specific printer"""
    try:
        circuit_breaker = connection_manager.get_circuit_breaker(printer_id)
        circuit_breaker.state = "closed"
        circuit_breaker.failure_count = 0
        
        backoff_timer = connection_manager.get_backoff_timer(printer_id)
        backoff_timer.reset()
        
        logger.info(f"Reset circuit breaker for printer {printer_id}")
        
        return {
            "success": True,
            "message": f"Circuit breaker reset for printer {printer_id}",
            "printer_id": printer_id
        }
        
    except Exception as e:
        logger.error(f"Failed to reset circuit breaker for {printer_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))