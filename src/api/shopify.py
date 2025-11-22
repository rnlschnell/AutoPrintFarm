"""
Shopify Integration API

Endpoints for configuring Shopify app connection and managing sync settings.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, HttpUrl
from typing import Optional
import logging

from src.services.config_service import get_config_service
from src.services.auth_service import get_auth_service
from src.services.shopify_order_sync_service import (
    initialize_shopify_sync_service,
    start_shopify_sync_service,
    stop_shopify_sync_service,
    get_shopify_sync_service
)

logger = logging.getLogger(__name__)
router = APIRouter()


class ShopifyConfigRequest(BaseModel):
    """Request model for saving Shopify configuration"""
    app_url: str
    api_key: str

    class Config:
        json_schema_extra = {
            "example": {
                "app_url": "https://your-app.vercel.app",
                "api_key": "your-api-key-from-shopify-app"
            }
        }


class ShopifyConfigResponse(BaseModel):
    """Response model for Shopify configuration"""
    configured: bool
    app_url: Optional[str] = None
    api_key_set: bool = False
    sync_active: bool = False
    last_sync: Optional[str] = None


@router.get("/api/shopify/config", response_model=ShopifyConfigResponse)
async def get_shopify_config():
    """
    Get current Shopify configuration status

    Returns:
        ShopifyConfigResponse with current configuration
    """
    try:
        config_service = get_config_service()
        shopify_config = config_service.config_data.get('shopify', {})

        app_url = shopify_config.get('app_url', '').strip()
        api_key = shopify_config.get('api_key', '').strip()

        # Check if sync service is running
        sync_service = get_shopify_sync_service()
        sync_active = sync_service is not None and sync_service.is_running

        return ShopifyConfigResponse(
            configured=bool(app_url and api_key),
            app_url=app_url if app_url else None,
            api_key_set=bool(api_key),
            sync_active=sync_active,
            last_sync=None  # TODO: Track last successful sync
        )

    except Exception as e:
        logger.error(f"Error getting Shopify config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/shopify/config")
async def save_shopify_config(config: ShopifyConfigRequest):
    """
    Save Shopify configuration and start sync service

    Args:
        config: ShopifyConfigRequest with app_url and api_key

    Returns:
        Success message and configuration status
    """
    try:
        config_service = get_config_service()

        # Validate inputs
        if not config.app_url or not config.api_key:
            raise HTTPException(
                status_code=400,
                detail="Both app_url and api_key are required"
            )

        # Clean up app_url (remove trailing slash)
        app_url = config.app_url.rstrip('/')

        # Get tenant and Supabase config
        tenant_config = config_service.get_tenant_config()
        supabase_config = config_service.get_supabase_config()

        tenant_id = tenant_config.get('id', '').strip()
        supabase_url = supabase_config.get('url', '').strip()
        supabase_key = supabase_config.get('anon_key', '').strip()

        if not tenant_id:
            raise HTTPException(
                status_code=400,
                detail="Tenant not configured. Please configure tenant first."
            )

        if not supabase_url or not supabase_key:
            raise HTTPException(
                status_code=400,
                detail="Supabase not configured. Please configure Supabase first."
            )

        # Update config
        if 'shopify' not in config_service.config_data:
            config_service.config_data['shopify'] = {}

        config_service.config_data['shopify']['app_url'] = app_url
        config_service.config_data['shopify']['api_key'] = config.api_key

        # Save to config file
        config_service.save_config()
        logger.info(f"Shopify configuration saved: {app_url}")

        # Stop existing sync service if running
        existing_service = get_shopify_sync_service()
        if existing_service and existing_service.is_running:
            await stop_shopify_sync_service()
            logger.info("Stopped existing Shopify sync service")

        # Initialize and start new sync service
        auth_service = get_auth_service()
        if not auth_service or not auth_service.supabase:
            raise HTTPException(
                status_code=500,
                detail="Auth service not available. Cannot initialize Shopify sync."
            )

        initialize_shopify_sync_service(
            tenant_id=tenant_id,
            shopify_app_url=app_url,
            api_key=config.api_key,
            supabase_client=auth_service.supabase,
            poll_interval_seconds=60
        )

        await start_shopify_sync_service()
        logger.info("Shopify sync service started successfully")

        return {
            "success": True,
            "message": "Shopify configuration saved and sync service started",
            "configured": True,
            "app_url": app_url,
            "sync_active": True
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving Shopify config: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/shopify/config")
async def delete_shopify_config():
    """
    Delete Shopify configuration and stop sync service

    Returns:
        Success message
    """
    try:
        # Stop sync service
        sync_service = get_shopify_sync_service()
        if sync_service and sync_service.is_running:
            await stop_shopify_sync_service()
            logger.info("Stopped Shopify sync service")

        # Remove config
        config_service = get_config_service()
        if 'shopify' in config_service.config_data:
            del config_service.config_data['shopify']
            config_service.save_config()
            logger.info("Shopify configuration removed")

        return {
            "success": True,
            "message": "Shopify configuration deleted and sync service stopped"
        }

    except Exception as e:
        logger.error(f"Error deleting Shopify config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/shopify/sync/manual")
async def trigger_manual_sync():
    """
    Manually trigger a Shopify order sync

    Returns:
        Success message with sync results
    """
    try:
        sync_service = get_shopify_sync_service()

        if not sync_service:
            raise HTTPException(
                status_code=400,
                detail="Shopify sync service not configured"
            )

        if not sync_service.is_running:
            raise HTTPException(
                status_code=400,
                detail="Shopify sync service not running"
            )

        # Trigger immediate sync
        await sync_service._fetch_and_sync_orders()

        return {
            "success": True,
            "message": "Manual sync completed successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error triggering manual sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))
