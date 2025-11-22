"""
Tunnel API endpoints for Cloudflare Tunnel management
"""

from fastapi import APIRouter, HTTPException, Depends, status, Header
from pydantic import BaseModel
from typing import Dict, Any, Optional
import logging

from ..services.tunnel_service import get_tunnel_service, TunnelService
from ..services.config_service import get_config_service, ConfigService

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Tunnel"])


# Response Models
class TunnelStatus(BaseModel):
    active: bool
    tunnel_id: Optional[str] = None
    subdomain: Optional[str] = None
    full_domain: Optional[str] = None
    process_pid: Optional[int] = None
    config_exists: bool
    credentials_exist: bool


class TunnelProvisionResponse(BaseModel):
    success: bool
    message: str
    tunnel_id: Optional[str] = None
    subdomain: Optional[str] = None
    full_domain: Optional[str] = None


class TunnelActionResponse(BaseModel):
    success: bool
    message: str


def get_tunnel_service_dep() -> TunnelService:
    """Dependency to get tunnel service"""
    tunnel_service = get_tunnel_service()
    if not tunnel_service:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Tunnel service not available"
        )
    return tunnel_service


def get_config_service_dep() -> ConfigService:
    """Dependency to get config service"""
    config_service = get_config_service()
    if not config_service:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Configuration service not available"
        )
    return config_service


@router.get("/status", response_model=TunnelStatus)
async def get_tunnel_status(
    tunnel_service: TunnelService = Depends(get_tunnel_service_dep)
):
    """
    Get current tunnel status

    Returns information about the tunnel connection including:
    - Active status
    - Tunnel ID
    - Subdomain and full domain URL
    - Process information
    - Configuration status
    """
    try:
        status_data = tunnel_service.get_status()
        return TunnelStatus(**status_data)
    except Exception as e:
        logger.error(f"Failed to get tunnel status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get tunnel status: {str(e)}"
        )


@router.post("/provision", response_model=TunnelProvisionResponse)
async def provision_tunnel(
    tunnel_service: TunnelService = Depends(get_tunnel_service_dep),
    config_service: ConfigService = Depends(get_config_service_dep),
    authorization: Optional[str] = Header(None)
):
    """
    Manually trigger tunnel provisioning

    This endpoint:
    1. Gets tenant ID from local config (physical device isolation)
    2. Gets user's Supabase auth token from Authorization header
    3. Requests tunnel provisioning from Cloudflare Worker
    4. Saves tunnel credentials locally
    5. Starts the tunnel automatically

    Requires: Authorization header with Bearer token from frontend user's Supabase session
    """
    try:
        # Get tenant config
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()

        if not tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tenant not configured. Please configure tenant first."
            )

        # Get auth token from Authorization header
        if not authorization:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authorization header required. Please login first."
            )

        # Extract Bearer token
        try:
            scheme, token = authorization.split()
            if scheme.lower() != 'bearer':
                raise ValueError("Invalid authorization scheme")
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Authorization header format. Expected: Bearer <token>"
            )

        logger.info(f"Provisioning tunnel for tenant: {tenant_id}")

        # Set auth token for tunnel service
        tunnel_service.set_auth_token(token)

        # Check if tunnel is already provisioned
        status_data = tunnel_service.get_status()
        if status_data.get('credentials_exist'):
            logger.info("Tunnel already provisioned, starting existing tunnel")

            # Start the tunnel
            started = await tunnel_service.start_tunnel()
            if started:
                status_data = tunnel_service.get_status()
                return TunnelProvisionResponse(
                    success=True,
                    message="Existing tunnel started successfully",
                    tunnel_id=status_data.get('tunnel_id'),
                    subdomain=status_data.get('subdomain'),
                    full_domain=status_data.get('full_domain')
                )
            else:
                raise Exception("Failed to start existing tunnel")

        # Provision new tunnel
        logger.info("Provisioning new tunnel...")
        result = await tunnel_service.provision_tunnel()

        # Start the tunnel
        started = await tunnel_service.start_tunnel()
        if not started:
            logger.warning("Tunnel provisioned but failed to start automatically")

        return TunnelProvisionResponse(
            success=True,
            message="Tunnel provisioned and started successfully" if started else "Tunnel provisioned but failed to start",
            tunnel_id=result.get('tunnel_id'),
            subdomain=result.get('subdomain'),
            full_domain=result.get('full_domain')
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to provision tunnel: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to provision tunnel: {str(e)}"
        )


@router.post("/start", response_model=TunnelActionResponse)
async def start_tunnel(
    tunnel_service: TunnelService = Depends(get_tunnel_service_dep)
):
    """
    Start the tunnel daemon

    Starts the cloudflared process with existing credentials.
    Tunnel must already be provisioned.
    """
    try:
        # Check if credentials exist
        status_data = tunnel_service.get_status()
        if not status_data.get('credentials_exist'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tunnel not provisioned. Call /provision first."
            )

        # Check if already running
        if status_data.get('active'):
            return TunnelActionResponse(
                success=True,
                message="Tunnel is already running"
            )

        # Start the tunnel
        started = await tunnel_service.start_tunnel()
        if started:
            return TunnelActionResponse(
                success=True,
                message="Tunnel started successfully"
            )
        else:
            raise Exception("Failed to start tunnel daemon")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start tunnel: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start tunnel: {str(e)}"
        )


@router.post("/stop", response_model=TunnelActionResponse)
async def stop_tunnel(
    tunnel_service: TunnelService = Depends(get_tunnel_service_dep)
):
    """
    Stop the tunnel daemon

    Gracefully stops the cloudflared process.
    """
    try:
        await tunnel_service.stop_tunnel()
        return TunnelActionResponse(
            success=True,
            message="Tunnel stopped successfully"
        )
    except Exception as e:
        logger.error(f"Failed to stop tunnel: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stop tunnel: {str(e)}"
        )


@router.post("/restart", response_model=TunnelActionResponse)
async def restart_tunnel(
    tunnel_service: TunnelService = Depends(get_tunnel_service_dep)
):
    """
    Restart the tunnel daemon

    Stops and restarts the cloudflared process.
    Useful for applying configuration changes.
    """
    try:
        restarted = await tunnel_service.restart_tunnel()
        if restarted:
            return TunnelActionResponse(
                success=True,
                message="Tunnel restarted successfully"
            )
        else:
            raise Exception("Failed to restart tunnel daemon")

    except Exception as e:
        logger.error(f"Failed to restart tunnel: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to restart tunnel: {str(e)}"
        )
