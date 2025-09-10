"""
Rate limiting utilities to prevent resource exhaustion
"""

import time
import logging
from typing import Dict, List
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class RateLimit:
    max_calls: int
    window_seconds: int
    current_calls: List[float]
    
    def __post_init__(self):
        if not hasattr(self, 'current_calls'):
            self.current_calls = []

class RateLimiter:
    """Rate limiter to prevent excessive API calls or operations"""
    
    def __init__(self):
        self.limits: Dict[str, RateLimit] = {
            'reconnect': RateLimit(max_calls=5, window_seconds=60, current_calls=[]),
            'printer_poll': RateLimit(max_calls=10, window_seconds=60, current_calls=[]),
            'error_log': RateLimit(max_calls=20, window_seconds=60, current_calls=[])
        }
    
    def is_allowed(self, operation: str) -> bool:
        """Check if an operation is allowed based on rate limits"""
        if operation not in self.limits:
            return True
            
        limit = self.limits[operation]
        current_time = time.time()
        
        # Remove old entries outside the window
        limit.current_calls = [
            call_time for call_time in limit.current_calls 
            if current_time - call_time < limit.window_seconds
        ]
        
        # Check if we're under the limit
        if len(limit.current_calls) >= limit.max_calls:
            if operation == 'error_log':
                # Don't log rate limit violations for error_log to avoid recursion
                pass
            else:
                logger.warning(f"Rate limit exceeded for {operation}: {len(limit.current_calls)}/{limit.max_calls} in {limit.window_seconds}s")
            return False
        
        # Record this call
        limit.current_calls.append(current_time)
        return True
    
    def get_remaining_calls(self, operation: str) -> int:
        """Get remaining calls for an operation in the current window"""
        if operation not in self.limits:
            return float('inf')
            
        limit = self.limits[operation]
        current_time = time.time()
        
        # Remove old entries
        limit.current_calls = [
            call_time for call_time in limit.current_calls 
            if current_time - call_time < limit.window_seconds
        ]
        
        return max(0, limit.max_calls - len(limit.current_calls))
    
    def reset_limit(self, operation: str):
        """Reset the rate limit for an operation"""
        if operation in self.limits:
            self.limits[operation].current_calls = []
            logger.info(f"Reset rate limit for {operation}")

# Global rate limiter instance
rate_limiter = RateLimiter()