"""
API endpoints for finished goods management with local sync
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
import logging
import uuid
from datetime import datetime

from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
from ..services.sync_service import get_sync_service
from ..models.database import FinishedGoods
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Pydantic models for requests/responses
class FinishedGoodsCreateRequest(BaseModel):
    product_sku_id: str
    sku: str
    color: str
    material: str = 'PLA'
    current_stock: int = 0
    unit_price: float = 0.0
    requires_assembly: bool = False
    quantity_assembled: int = 0
    quantity_needs_assembly: int = 0
    low_stock_threshold: int = 5
    quantity_per_sku: int = 1
    extra_cost: float = 0.0
    profit_margin: float = 0.0
    image_url: Optional[str] = None

class FinishedGoodsUpdateRequest(BaseModel):
    current_stock: Optional[int] = None
    unit_price: Optional[float] = None
    requires_assembly: Optional[bool] = None
    quantity_assembled: Optional[int] = None
    quantity_needs_assembly: Optional[int] = None
    status: Optional[str] = None
    low_stock_threshold: Optional[int] = None
    quantity_per_sku: Optional[int] = None
    extra_cost: Optional[float] = None
    profit_margin: Optional[float] = None
    material: Optional[str] = None
    image_url: Optional[str] = None

class StockUpdateRequest(BaseModel):
    new_stock: int

class AssemblyStockUpdateRequest(BaseModel):
    new_quantity: int
    assembly_type: str  # 'assembled' or 'needs_assembly'

router = APIRouter(
    prefix="/finished-goods-sync",
    tags=["Finished Goods Sync"],
    responses={404: {"description": "Not found"}},
)

@router.get("/", response_model=List[dict])
async def get_finished_goods():
    """
    Get all finished goods for the current tenant from local SQLite
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get finished goods from local database
        db_service = await get_database_service()
        finished_goods = await db_service.get_finished_goods_by_tenant(tenant_id)
        
        # Convert to dict for response
        return [fg.to_dict() for fg in finished_goods]
        
    except Exception as e:
        logger.error(f"Failed to get finished goods: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{finished_good_id}", response_model=dict)
async def get_finished_good(finished_good_id: str):
    """
    Get a specific finished good by ID from local SQLite
    """
    try:
        db_service = await get_database_service()
        finished_good = await db_service.get_finished_good_by_id(finished_good_id)
        
        if not finished_good:
            raise HTTPException(status_code=404, detail="Finished good not found")
        
        return finished_good.to_dict()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get finished good {finished_good_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/by-sku/{product_sku_id}", response_model=dict)
async def get_finished_good_by_sku(product_sku_id: str):
    """
    Get finished good by product SKU ID
    """
    try:
        db_service = await get_database_service()
        finished_good = await db_service.get_finished_good_by_sku_id(product_sku_id)
        
        if not finished_good:
            raise HTTPException(status_code=404, detail="Finished good not found for this SKU")
        
        return finished_good.to_dict()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get finished good for SKU {product_sku_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=dict)
async def create_finished_good(request: FinishedGoodsCreateRequest):
    """
    Create a new finished good in local SQLite
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Check if finished good already exists for this SKU
        db_service = await get_database_service()
        existing = await db_service.get_finished_good_by_sku_id(request.product_sku_id)
        if existing:
            raise HTTPException(status_code=400, detail="Finished good already exists for this SKU")
        
        # Create new finished good
        finished_good = FinishedGoods(
            id=str(uuid.uuid4()),
            product_sku_id=request.product_sku_id,
            tenant_id=tenant_id,
            sku=request.sku,
            color=request.color,
            material=request.material,
            current_stock=request.current_stock,
            unit_price=int(request.unit_price * 100),  # Convert to cents
            requires_assembly=request.requires_assembly,
            quantity_assembled=request.quantity_assembled,
            quantity_needs_assembly=request.quantity_needs_assembly,
            status='out_of_stock' if request.current_stock == 0 else 'low_stock' if request.current_stock < 5 else 'in_stock',
            low_stock_threshold=request.low_stock_threshold,
            quantity_per_sku=request.quantity_per_sku,
            extra_cost=int(request.extra_cost * 100),  # Convert to cents
            profit_margin=int(request.profit_margin * 100),  # Convert to percentage * 100
            image_url=request.image_url,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        result = await db_service.create_finished_good(finished_good)
        
        if not result:
            raise HTTPException(status_code=500, detail="Failed to create finished good")
        
        logger.info(f"Created finished good: {result.id} for SKU: {request.product_sku_id}")
        return result.to_dict()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create finished good: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{finished_good_id}", response_model=dict)
async def update_finished_good(finished_good_id: str, request: FinishedGoodsUpdateRequest):
    """
    Update a finished good in local SQLite
    """
    try:
        db_service = await get_database_service()
        
        # Prepare update data
        update_data = {}
        if request.current_stock is not None:
            update_data['current_stock'] = request.current_stock
            # Auto-update status based on stock
            if request.current_stock == 0:
                update_data['status'] = 'out_of_stock'
            elif request.current_stock < 5:
                update_data['status'] = 'low_stock'
            else:
                update_data['status'] = 'in_stock'
        
        if request.unit_price is not None:
            update_data['unit_price'] = request.unit_price
        if request.requires_assembly is not None:
            update_data['requires_assembly'] = request.requires_assembly
        if request.quantity_assembled is not None:
            update_data['quantity_assembled'] = request.quantity_assembled
        if request.quantity_needs_assembly is not None:
            update_data['quantity_needs_assembly'] = request.quantity_needs_assembly
        if request.status is not None and 'status' not in update_data:
            update_data['status'] = request.status
        if request.low_stock_threshold is not None:
            update_data['low_stock_threshold'] = request.low_stock_threshold
        if request.quantity_per_sku is not None:
            update_data['quantity_per_sku'] = request.quantity_per_sku
        if request.extra_cost is not None:
            update_data['extra_cost'] = request.extra_cost
        if request.profit_margin is not None:
            update_data['profit_margin'] = request.profit_margin
        if request.material is not None:
            update_data['material'] = request.material
        if request.image_url is not None:
            update_data['image_url'] = request.image_url
        
        result = await db_service.update_finished_good(finished_good_id, update_data)
        
        if not result:
            raise HTTPException(status_code=404, detail="Finished good not found")
        
        logger.info(f"Updated finished good: {finished_good_id}")
        return result.to_dict()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update finished good {finished_good_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{finished_good_id}/stock", response_model=dict)
async def update_finished_good_stock(finished_good_id: str, request: StockUpdateRequest):
    """
    Update stock level for a finished good
    """
    try:
        db_service = await get_database_service()
        result = await db_service.update_finished_good_stock(finished_good_id, request.new_stock)

        if not result:
            raise HTTPException(status_code=404, detail="Finished good not found")

        logger.info(f"Updated stock for finished good {finished_good_id}: {request.new_stock}")
        return result.to_dict()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update stock for finished good {finished_good_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{finished_good_id}/assembly-stock", response_model=dict)
async def update_finished_good_assembly_stock(finished_good_id: str, request: AssemblyStockUpdateRequest):
    """
    Update assembled or needs assembly stock for a finished good
    """
    try:
        db_service = await get_database_service()

        # Get the existing finished good
        existing_fg = await db_service.get_finished_good_by_id(finished_good_id)
        if not existing_fg:
            raise HTTPException(status_code=404, detail="Finished good not found")

        # Update the appropriate quantity field
        update_data = {'id': finished_good_id, 'updated_at': datetime.utcnow()}

        if request.assembly_type == 'assembled':
            update_data['quantity_assembled'] = request.new_quantity
        elif request.assembly_type == 'needs_assembly':
            update_data['quantity_needs_assembly'] = request.new_quantity
        else:
            raise HTTPException(status_code=400, detail="Invalid assembly_type. Must be 'assembled' or 'needs_assembly'")

        # Update in database
        updated_fg = await db_service.update_finished_good(finished_good_id, update_data)

        if not updated_fg:
            raise HTTPException(status_code=500, detail="Failed to update assembly stock")

        logger.info(f"Updated {request.assembly_type} stock for finished good {finished_good_id}: {request.new_quantity}")
        return updated_fg.to_dict() if updated_fg else update_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update assembly stock for finished good {finished_good_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{finished_good_id}")
async def delete_finished_good(finished_good_id: str):
    """
    Soft delete a finished good
    """
    try:
        db_service = await get_database_service()
        success = await db_service.delete_finished_good(finished_good_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="Finished good not found")
        
        logger.info(f"Deleted finished good: {finished_good_id}")
        return {"message": "Finished good deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete finished good {finished_good_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync")
async def sync_finished_goods_from_supabase():
    """
    One-time sync of finished goods from Supabase to local SQLite
    """
    try:
        sync_service = await get_sync_service()
        
        if not sync_service:
            raise HTTPException(status_code=503, detail="Sync service not available")
        
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Fetch finished goods from Supabase
        supabase_client = sync_service.supabase
        result = supabase_client.table('finished_goods').select('*').eq('tenant_id', tenant_id).execute()
        
        if result.data:
            db_service = await get_database_service()
            count = await db_service.sync_finished_goods_from_supabase(tenant_id, result.data)
            logger.info(f"Synced {count} finished goods from Supabase")
            return {"message": f"Synced {count} finished goods from Supabase"}
        else:
            return {"message": "No finished goods found in Supabase"}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to sync finished goods from Supabase: {e}")
        raise HTTPException(status_code=500, detail=str(e))
