"""
Tenant API endpoints for PrintFarmSoftware
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging

from ..services.config_service import get_config_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Tenant"])

class TenantInfoResponse(BaseModel):
    tenant_id: Optional[str]
    tenant_name: Optional[str]

@router.get("/api/tenant/info", response_model=TenantInfoResponse)
async def get_tenant_info():
    """
    Get tenant information for Shopify integration

    Returns the tenant ID needed to connect this Print Farm to Shopify.
    """
    try:
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()

        tenant_id = tenant_config.get('id', '').strip()
        tenant_name = tenant_config.get('name', '').strip()

        if not tenant_id:
            logger.warning("Tenant ID not configured")
            raise HTTPException(
                status_code=404,
                detail="Tenant ID not configured. Please set up authentication first."
            )

        return TenantInfoResponse(
            tenant_id=tenant_id,
            tenant_name=tenant_name if tenant_name else None
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching tenant info: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch tenant information"
        )
