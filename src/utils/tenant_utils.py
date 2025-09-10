"""
Utilities for extracting tenant information from authentication context
"""

import logging
import os
from typing import Optional
from fastapi import Request, HTTPException
import jwt

from ..services.auth_service import get_auth_service
from ..services.config_service import get_config_service

logger = logging.getLogger(__name__)

def extract_tenant_from_request(request: Request) -> Optional[str]:
    """
    Extract tenant ID from FastAPI request using multiple fallback methods
    
    Args:
        request: FastAPI Request object
        
    Returns:
        Tenant ID if found, None otherwise
    """
    tenant_id = None
    
    # Method 1: Try to get tenant from Authorization header (JWT token)
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        tenant_id = extract_tenant_from_jwt(token)
        if tenant_id:
            logger.debug(f"Tenant ID extracted from JWT: {tenant_id}")
            return tenant_id
    
    # Method 2: Try to get from auth service current session
    auth_service = get_auth_service()
    if auth_service:
        tenant_id = auth_service.get_current_tenant_id()
        if tenant_id:
            logger.debug(f"Tenant ID from auth service session: {tenant_id}")
            return tenant_id
    
    # Method 3: Fallback to config file (original method)
    try:
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        if tenant_id:
            logger.debug(f"Tenant ID from config file: {tenant_id}")
            return tenant_id
    except Exception as e:
        logger.warning(f"Failed to get tenant from config: {e}")
    
    logger.warning("Could not extract tenant ID from any source")
    return None

def extract_tenant_from_jwt(token: str) -> Optional[str]:
    """
    Extract tenant_id from JWT token without verification
    (For use when we just need the tenant ID and Supabase will validate the token)
    
    Args:
        token: JWT access token
        
    Returns:
        Tenant ID if found in token
    """
    try:
        # Decode without verification to extract payload
        # Supabase will handle token validation on actual API calls
        payload = jwt.decode(token, options={"verify_signature": False})
        
        # Check for tenant_id in user_metadata or app_metadata
        user_metadata = payload.get('user_metadata', {})
        app_metadata = payload.get('app_metadata', {})
        
        tenant_id = (
            user_metadata.get('tenant_id') or 
            app_metadata.get('tenant_id') or
            payload.get('tenant_id')
        )
        
        if tenant_id:
            return str(tenant_id).strip()
            
    except Exception as e:
        logger.debug(f"Could not extract tenant from JWT: {e}")
    
    return None

def get_tenant_id_or_raise(request: Request) -> str:
    """
    Get tenant ID from request or raise HTTP 400 error
    
    Args:
        request: FastAPI Request object
        
    Returns:
        Tenant ID
        
    Raises:
        HTTPException: If tenant ID cannot be found
    """
    tenant_id = extract_tenant_from_request(request)
    
    if not tenant_id:
        # Final fallback: Try to get a default tenant ID
        # This handles cases where the frontend is authenticated but doesn't send proper headers
        tenant_id = get_fallback_tenant_id()
        
        if tenant_id:
            logger.warning(f"Using fallback tenant ID: {tenant_id}")
            return tenant_id
    
    if not tenant_id:
        logger.error("Tenant not configured - cannot proceed")
        raise HTTPException(status_code=400, detail="Tenant not configured")
    
    return tenant_id

def get_fallback_tenant_id() -> Optional[str]:
    """
    Get fallback tenant ID for cases where request doesn't contain tenant info
    but we know the system should have a default tenant
    
    Returns:
        Fallback tenant ID if available
    """
    try:
        # Try to get from environment variable first
        tenant_id = os.environ.get('DEFAULT_TENANT_ID')
        if tenant_id and tenant_id.strip():
            return tenant_id.strip()
        
        # No hardcoded fallback - require proper authentication
        # If no tenant ID is found through proper auth channels, return None
        logger.debug("No fallback tenant ID available - authentication required")
        return None
            
    except Exception as e:
        logger.warning(f"Error getting fallback tenant ID: {e}")
    
    return None

async def get_tenant_info_from_request(request: Request) -> Optional[dict]:
    """
    Get full tenant information from request context
    
    Args:
        request: FastAPI Request object
        
    Returns:
        Tenant information dict or None
    """
    tenant_id = extract_tenant_from_request(request)
    
    if not tenant_id:
        return None
    
    # Try to get full tenant info from auth service
    auth_service = get_auth_service()
    if auth_service:
        try:
            tenant_info = await auth_service.get_tenant_info(tenant_id)
            if tenant_info:
                return tenant_info
        except Exception as e:
            logger.warning(f"Could not get tenant info from auth service: {e}")
    
    # Fallback to basic info with just ID
    return {
        'id': tenant_id,
        'name': f'Tenant {tenant_id}',  # Placeholder name
    }