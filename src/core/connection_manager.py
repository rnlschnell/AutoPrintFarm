"""
Connection Manager with Circuit Breaker and Rate Limiting
Prevents runaway reconnection loops that overwhelm the Pi
"""

import asyncio
import time
import logging
from typing import Dict, Optional, Set
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"         # Circuit breaker open, blocking calls
    HALF_OPEN = "half_open"  # Testing if service recovered

@dataclass
class ConnectionAttempt:
    timestamp: float
    success: bool
    error: Optional[str] = None

class ConnectionCircuitBreaker:
    """Circuit breaker to prevent excessive connection attempts"""
    
    def __init__(self, 
                 failure_threshold: int = 5,
                 recovery_timeout: int = 300,
                 half_open_max_calls: int = 1):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.last_failure_time = 0
        self.half_open_calls = 0
        
    def can_execute(self, user_action: bool = False) -> bool:
        """Check if operation is allowed
        
        Args:
            user_action: If True, allows bypass of circuit breaker for user-initiated actions
        """
        current_time = time.time()
        
        if self.state == CircuitState.CLOSED:
            return True
        elif self.state == CircuitState.OPEN:
            # Allow user actions to bypass circuit breaker after minimum cooldown
            if user_action and current_time - self.last_failure_time >= 30:  # 30 second minimum cooldown
                logger.info("User action bypassing circuit breaker")
                return True
            elif current_time - self.last_failure_time >= self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                self.half_open_calls = 0
                logger.info("Circuit breaker moving to HALF_OPEN state")
                return True
            return False
        else:  # HALF_OPEN
            return self.half_open_calls < self.half_open_max_calls
    
    def record_success(self):
        """Record successful operation"""
        if self.state == CircuitState.HALF_OPEN:
            self.state = CircuitState.CLOSED
            self.failure_count = 0
            logger.info("Circuit breaker reset to CLOSED state")
        else:
            self.failure_count = max(0, self.failure_count - 1)
    
    def record_failure(self, error: str = ""):
        """Record failed operation"""
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.state == CircuitState.HALF_OPEN:
            self.state = CircuitState.OPEN
            logger.warning(f"Circuit breaker opened due to failure in HALF_OPEN state: {error}")
        elif self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
            logger.warning(f"Circuit breaker opened after {self.failure_count} failures: {error}")
        
        if self.state == CircuitState.HALF_OPEN:
            self.half_open_calls += 1

class ExponentialBackoff:
    """Exponential backoff for connection attempts"""
    
    def __init__(self, initial_delay: float = 1.0, max_delay: float = 300.0, multiplier: float = 2.0):
        self.initial_delay = initial_delay
        self.max_delay = max_delay
        self.multiplier = multiplier
        self.current_delay = initial_delay
        self.last_attempt = 0
    
    def get_delay(self) -> float:
        """Get current delay and increment for next time"""
        delay = self.current_delay
        self.current_delay = min(self.max_delay, self.current_delay * self.multiplier)
        return delay
    
    def reset(self):
        """Reset backoff on successful connection"""
        self.current_delay = self.initial_delay
    
    def should_attempt(self) -> bool:
        """Check if enough time has passed for next attempt"""
        current_time = time.time()
        if current_time - self.last_attempt >= self.current_delay:
            self.last_attempt = current_time
            return True
        return False

class ConnectionManager:
    """Manages printer connections with rate limiting and circuit breaking"""

    # Maximum connection attempts before stopping auto-reconnect
    MAX_CONNECTION_ATTEMPTS = 5

    def __init__(self):
        self.circuit_breakers: Dict[str, ConnectionCircuitBreaker] = {}
        self.backoff_timers: Dict[str, ExponentialBackoff] = {}
        self.connection_attempts: Dict[str, list] = {}
        self.active_connections: Set[str] = set()
        self.max_concurrent_connections = 500

        # Connection attempt counter (for 5-attempt limit)
        self.connection_attempt_count: Dict[str, int] = {}

        # Global rate limiting
        self.global_attempt_window = 60  # 1 minute
        self.max_global_attempts = 10   # Max 10 connection attempts per minute globally
        self.global_attempts = []
        
    def get_circuit_breaker(self, printer_id: str) -> ConnectionCircuitBreaker:
        """Get or create circuit breaker for printer"""
        if printer_id not in self.circuit_breakers:
            self.circuit_breakers[printer_id] = ConnectionCircuitBreaker()
        return self.circuit_breakers[printer_id]
    
    def get_backoff_timer(self, printer_id: str) -> ExponentialBackoff:
        """Get or create backoff timer for printer"""
        if printer_id not in self.backoff_timers:
            self.backoff_timers[printer_id] = ExponentialBackoff()
        return self.backoff_timers[printer_id]
    
    def can_attempt_connection(self, printer_id: str, user_action: bool = False) -> tuple[bool, str]:
        """Check if connection attempt is allowed

        Args:
            printer_id: ID of the printer to check
            user_action: If True, allows bypass of some rate limits for user-initiated actions
        """
        current_time = time.time()

        # Check connection attempt limit (user actions bypass this)
        if not user_action:
            attempt_count = self.connection_attempt_count.get(printer_id, 0)
            if attempt_count >= self.MAX_CONNECTION_ATTEMPTS:
                return False, f"Max connection attempts reached ({attempt_count}/{self.MAX_CONNECTION_ATTEMPTS}). Use manual reconnect."

        # Check global rate limit (user actions get higher limit)
        self.global_attempts = [t for t in self.global_attempts
                               if current_time - t < self.global_attempt_window]

        max_attempts = self.max_global_attempts * 2 if user_action else self.max_global_attempts
        if len(self.global_attempts) >= max_attempts:
            return False, f"Global rate limit exceeded: {len(self.global_attempts)}/{max_attempts} attempts in last minute"

        # Check concurrent connections limit (less strict for user actions)
        max_connections = self.max_concurrent_connections + 1 if user_action else self.max_concurrent_connections
        if len(self.active_connections) >= max_connections:
            return False, f"Max concurrent connections reached: {len(self.active_connections)}/{max_connections}"

        # Check circuit breaker
        circuit_breaker = self.get_circuit_breaker(printer_id)
        if not circuit_breaker.can_execute(user_action):
            return False, f"Circuit breaker is {circuit_breaker.state.value} for printer {printer_id}"

        # Check backoff timer
        backoff_timer = self.get_backoff_timer(printer_id)
        if not backoff_timer.should_attempt():
            next_attempt = backoff_timer.last_attempt + backoff_timer.current_delay
            wait_time = next_attempt - current_time
            return False, f"Backoff timer active, next attempt in {wait_time:.1f} seconds"

        return True, "Connection attempt allowed"
    
    def record_connection_attempt(self, printer_id: str, success: bool, error: str = ""):
        """Record connection attempt result"""
        current_time = time.time()

        # Record global attempt
        self.global_attempts.append(current_time)

        # Record per-printer attempt
        if printer_id not in self.connection_attempts:
            self.connection_attempts[printer_id] = []

        attempt = ConnectionAttempt(current_time, success, error)
        self.connection_attempts[printer_id].append(attempt)

        # Keep only recent attempts
        self.connection_attempts[printer_id] = [
            a for a in self.connection_attempts[printer_id]
            if current_time - a.timestamp < 300  # Keep 5 minutes of history
        ]

        # Update circuit breaker
        circuit_breaker = self.get_circuit_breaker(printer_id)
        backoff_timer = self.get_backoff_timer(printer_id)

        if success:
            circuit_breaker.record_success()
            backoff_timer.reset()
            self.active_connections.add(printer_id)
            # Reset attempt counter on successful connection
            self.connection_attempt_count[printer_id] = 0
            logger.info(f"Connection successful for printer {printer_id}")
        else:
            circuit_breaker.record_failure(error)
            self.active_connections.discard(printer_id)
            delay = backoff_timer.get_delay()
            # Increment attempt counter on failure
            self.connection_attempt_count[printer_id] = self.connection_attempt_count.get(printer_id, 0) + 1
            current_count = self.connection_attempt_count[printer_id]
            if current_count >= self.MAX_CONNECTION_ATTEMPTS:
                logger.warning(f"Printer {printer_id} reached max connection attempts ({current_count}/{self.MAX_CONNECTION_ATTEMPTS}). Auto-reconnect disabled. Use manual reconnect.")
            else:
                logger.warning(f"Connection failed for printer {printer_id}: {error}. Attempt {current_count}/{self.MAX_CONNECTION_ATTEMPTS}. Next attempt in {delay:.1f}s")
    
    def record_disconnection(self, printer_id: str):
        """Record that printer disconnected"""
        self.active_connections.discard(printer_id)
        logger.info(f"Printer {printer_id} disconnected")

    def reset_attempt_count(self, printer_id: str):
        """Reset connection attempt counter for manual reconnect

        Args:
            printer_id: ID of the printer to reset
        """
        old_count = self.connection_attempt_count.get(printer_id, 0)
        self.connection_attempt_count[printer_id] = 0
        logger.info(f"Reset attempt counter for printer {printer_id} (was {old_count}/{self.MAX_CONNECTION_ATTEMPTS})")

    def get_status(self) -> Dict:
        """Get current connection manager status"""
        current_time = time.time()
        
        status = {
            "global_attempts_last_minute": len(self.global_attempts),
            "active_connections": len(self.active_connections),
            "max_concurrent": self.max_concurrent_connections,
            "printers": {}
        }
        
        for printer_id in set(list(self.circuit_breakers.keys()) + list(self.backoff_timers.keys())):
            circuit_breaker = self.circuit_breakers.get(printer_id)
            backoff_timer = self.backoff_timers.get(printer_id)
            attempts = self.connection_attempts.get(printer_id, [])
            
            recent_attempts = [a for a in attempts if current_time - a.timestamp < 300]
            recent_failures = [a for a in recent_attempts if not a.success]
            
            status["printers"][printer_id] = {
                "circuit_state": circuit_breaker.state.value if circuit_breaker else "unknown",
                "failure_count": circuit_breaker.failure_count if circuit_breaker else 0,
                "current_backoff": backoff_timer.current_delay if backoff_timer else 0,
                "recent_attempts": len(recent_attempts),
                "recent_failures": len(recent_failures),
                "connected": printer_id in self.active_connections,
                "attempt_count": self.connection_attempt_count.get(printer_id, 0),
                "max_attempts_reached": self.connection_attempt_count.get(printer_id, 0) >= self.MAX_CONNECTION_ATTEMPTS
            }
        
        return status

# Global connection manager instance
connection_manager = ConnectionManager()