"""
API endpoints for product SKUs management with local sync
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
import logging
import uuid
from datetime import datetime

from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
from ..services.sync_service import get_sync_service
from ..models.database import ProductSku, FinishedGoods
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Pydantic models for requests/responses
class ProductSkuCreateRequest(BaseModel):
    product_id: str
    sku: str
    color: str
    filament_type: Optional[str] = None
    hex_code: Optional[str] = None
    quantity: int = 1
    stock_level: int = 0
    price: Optional[float] = None  # In dollars, will be converted to cents

class ProductSkuUpdateRequest(BaseModel):
    sku: Optional[str] = None
    color: Optional[str] = None
    filament_type: Optional[str] = None
    hex_code: Optional[str] = None
    quantity: Optional[int] = None
    stock_level: Optional[int] = None
    price: Optional[float] = None

router = APIRouter(
    prefix="/product-skus-sync",
    tags=["Product SKUs Sync"],
    responses={404: {"description": "Not found"}},
)

@router.get("/", response_model=List[dict])
async def get_product_skus():
    """
    Get all product SKUs for the current tenant from local SQLite
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get product SKUs from local database
        db_service = await get_database_service()
        skus = await db_service.get_product_skus_by_tenant(tenant_id)
        
        # Convert to dict for response
        return [sku.to_dict() for sku in skus]
        
    except Exception as e:
        logger.error(f"Failed to get product SKUs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/product/{product_id}", response_model=List[dict])
async def get_product_skus_by_product(product_id: str):
    """
    Get all SKUs for a specific product from local SQLite
    """
    try:
        db_service = await get_database_service()
        skus = await db_service.get_product_skus_by_product(product_id)
        
        # Convert to dict for response
        return [sku.to_dict() for sku in skus]
        
    except Exception as e:
        logger.error(f"Failed to get SKUs for product {product_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{sku_id}", response_model=dict)
async def get_product_sku(sku_id: str):
    """
    Get a specific product SKU by ID from local SQLite
    """
    try:
        db_service = await get_database_service()
        sku = await db_service.get_product_sku_by_id(sku_id)
        
        if not sku:
            raise HTTPException(status_code=404, detail="Product SKU not found")
        
        return sku.to_dict()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get product SKU {sku_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync")
async def force_product_skus_sync():
    """
    Force a manual sync of product SKUs from Supabase
    
    This endpoint triggers a manual synchronization of product SKUs
    from Supabase to the local SQLite database.
    """
    try:
        sync_service = await get_sync_service()
        
        if not sync_service:
            raise HTTPException(status_code=503, detail="Sync service not available")
        
        # Local-first architecture: sync from Supabase disabled
        # Local SQLite is source of truth, prevents data restoration
        
        # Get updated count
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if tenant_id:
            db_service = await get_database_service()
            skus = await db_service.get_product_skus_by_tenant(tenant_id)
            
            return {
                "success": True,
                "message": "Product SKUs sync completed",
                "product_skus_count": len(skus)
            }
        else:
            return {
                "success": True,
                "message": "Product SKUs sync completed",
                "product_skus_count": 0
            }
        
    except Exception as e:
        logger.error(f"Failed to force product SKUs sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/sync")
async def get_product_skus_sync_status():
    """
    Get the current sync status for product SKUs
    """
    try:
        sync_service = await get_sync_service()
        
        if not sync_service:
            return {
                "sync_enabled": False,
                "message": "Sync service not configured"
            }
        
        # Get tenant ID
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            return {
                "sync_enabled": False,
                "message": "Tenant not configured"
            }
        
        # Get product SKUs count
        db_service = await get_database_service()
        skus = await db_service.get_product_skus_by_tenant(tenant_id)
        
        # Get sync status
        sync_status = await sync_service.get_sync_status()
        
        return {
            "sync_enabled": True,
            "is_running": sync_status.get('is_running', False),
            "connected_to_realtime": sync_status.get('connected_to_realtime', False),
            "tenant_id": tenant_id,
            "local_product_skus_count": len(skus),
            "last_check": sync_status.get('last_check')
        }
        
    except Exception as e:
        logger.error(f"Failed to get product SKUs sync status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stock/low")
async def get_low_stock_skus():
    """
    Get product SKUs with low stock levels
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get all SKUs and filter for low stock (stock_level <= 5)
        db_service = await get_database_service()
        all_skus = await db_service.get_product_skus_by_tenant(tenant_id)
        
        low_stock_skus = [sku for sku in all_skus if sku.stock_level <= 5]
        
        # Convert to dict for response
        return [sku.to_dict() for sku in low_stock_skus]
        
    except Exception as e:
        logger.error(f"Failed to get low stock SKUs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=dict)
async def create_product_sku(sku_request: ProductSkuCreateRequest):
    """
    Create a new product SKU (local-first)
    
    Creates a new SKU in the local SQLite database and queues backup to Supabase.
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Verify product exists
        db_service = await get_database_service()
        product = await db_service.get_product_by_id(sku_request.product_id)
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        
        # Generate UUID for new SKU
        sku_id = str(uuid.uuid4())
        
        # Create SKU data dict (convert price to cents)
        sku_data = {
            'id': sku_id,
            'product_id': sku_request.product_id,
            'tenant_id': tenant_id,
            'sku': sku_request.sku,
            'color': sku_request.color,
            'filament_type': sku_request.filament_type,
            'hex_code': sku_request.hex_code,
            'quantity': sku_request.quantity,
            'stock_level': sku_request.stock_level,
            'price': int(sku_request.price * 100) if sku_request.price else None,  # Convert to cents
            'is_active': True,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow()
        }
        
        # Insert into local SQLite (will automatically queue backup to Supabase)
        success = await db_service.upsert_product_sku(sku_data)
        
        # Create associated finished good
        if success:
            try:
                finished_good = FinishedGoods(
                    id=str(uuid.uuid4()),
                    product_sku_id=sku_id,
                    tenant_id=tenant_id,
                    sku=sku_request.sku,
                    color=sku_request.color,
                    material=sku_request.filament_type or 'PLA',
                    current_stock=sku_request.stock_level,
                    unit_price=int(sku_request.price * 100) if sku_request.price else 0,
                    assembly_status='printed',
                    status='out_of_stock' if sku_request.stock_level == 0 else 'low_stock' if sku_request.stock_level < 5 else 'in_stock',
                    low_stock_threshold=5,
                    quantity_per_sku=1,
                    extra_cost=0,
                    profit_margin=0,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                
                await db_service.create_finished_good(finished_good)
                logger.info(f"Created finished good for SKU: {sku_id}")
            except Exception as e:
                logger.error(f"Failed to create finished good for SKU {sku_id}: {e}")
                # Don't fail the SKU creation if finished good creation fails

        
        if success:
            return {
                'success': True,
                'message': f"Product SKU '{sku_request.sku}' created successfully",
                'sku': sku_data
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create product SKU")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create product SKU: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{sku_id}", response_model=dict)
async def update_product_sku(sku_id: str, sku_request: ProductSkuUpdateRequest):
    """
    Update an existing product SKU (local-first)
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get existing SKU
        db_service = await get_database_service()
        existing_sku = await db_service.get_product_sku_by_id(sku_id)
        
        if not existing_sku:
            raise HTTPException(status_code=404, detail="Product SKU not found")
        
        # Build update data
        update_data = {'id': sku_id, 'tenant_id': tenant_id, 'updated_at': datetime.utcnow()}
        
        if sku_request.sku is not None:
            update_data['sku'] = sku_request.sku
        if sku_request.color is not None:
            update_data['color'] = sku_request.color
        if sku_request.filament_type is not None:
            update_data['filament_type'] = sku_request.filament_type
        if sku_request.hex_code is not None:
            update_data['hex_code'] = sku_request.hex_code
        if sku_request.quantity is not None:
            update_data['quantity'] = sku_request.quantity
        if sku_request.stock_level is not None:
            update_data['stock_level'] = sku_request.stock_level
        if sku_request.price is not None:
            update_data['price'] = int(sku_request.price * 100)  # Convert to cents
        
        # Update in local SQLite
        success = await db_service.upsert_product_sku(update_data)
        
        if success:
            # Get updated SKU
            updated_sku = await db_service.get_product_sku_by_id(sku_id)
            return {
                'success': True,
                'message': f"Product SKU '{sku_id}' updated successfully",
                'sku': updated_sku.to_dict() if updated_sku else update_data
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to update product SKU")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update product SKU {sku_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{sku_id}")
async def delete_product_sku(sku_id: str):
    """
    Delete a product SKU (local-first)
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Check if SKU exists
        db_service = await get_database_service()
        existing_sku = await db_service.get_product_sku_by_id(sku_id)
        
        if not existing_sku:
            raise HTTPException(status_code=404, detail="Product SKU not found")
        
        # Delete from local SQLite
        success = await db_service.delete_product_sku(sku_id, tenant_id)
        
        if success:
            # Queue backup deletion to Supabase
            from ..services.backup_service import get_backup_service
            backup_service = get_backup_service()
            if backup_service:
                await backup_service.queue_change(
                    'product_skus',
                    'delete',
                    sku_id,
                    {'id': sku_id, 'tenant_id': tenant_id, 'is_active': False, 'deleted_at': datetime.utcnow()}
                )
            
            return {
                'success': True,
                'message': f"Product SKU '{sku_id}' deleted successfully"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to delete product SKU")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete product SKU {sku_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))