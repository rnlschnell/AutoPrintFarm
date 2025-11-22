"""
API endpoints for products management with local sync
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
import logging
import uuid
from datetime import datetime

from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
from ..services.sync_service import get_sync_service
from ..services.auth_service import get_auth_service
from ..models.database import Product
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Pydantic models for requests/responses
class ProductCreateRequest(BaseModel):
    id: Optional[str] = None  # Optional pre-generated UUID (for image upload)
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    print_file_id: Optional[str] = None
    file_name: Optional[str] = None
    requires_assembly: bool = False
    requires_post_processing: bool = False
    image_url: Optional[str] = None
    components: Optional[List[dict]] = None
    printer_priority: Optional[str] = None
    wiki_id: Optional[str] = None

class ProductUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    print_file_id: Optional[str] = None
    file_name: Optional[str] = None
    requires_assembly: Optional[bool] = None
    requires_post_processing: Optional[bool] = None
    image_url: Optional[str] = None
    components: Optional[List[dict]] = None
    printer_priority: Optional[str] = None
    wiki_id: Optional[str] = None

router = APIRouter(
    prefix="/products-sync",
    tags=["Products Sync"],
    responses={404: {"description": "Not found"}},
)

@router.get("/", response_model=List[dict])
async def get_products():
    """
    Get all products for the current tenant from local SQLite
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get products from local database
        db_service = await get_database_service()
        products = await db_service.get_products_by_tenant(tenant_id)
        
        # Convert to dict for response
        return [product.to_dict() for product in products]
        
    except Exception as e:
        logger.error(f"Failed to get products: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{product_id}", response_model=dict)
async def get_product(product_id: str):
    """
    Get a specific product by ID from local SQLite
    """
    try:
        db_service = await get_database_service()
        product = await db_service.get_product_by_id(product_id)
        
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        
        return product.to_dict()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get product {product_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync")
async def force_products_sync():
    """
    Force a manual sync of products from Supabase
    
    This endpoint triggers a manual synchronization of products
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
            products = await db_service.get_products_by_tenant(tenant_id)
            
            return {
                "success": True,
                "message": "Products sync completed",
                "products_count": len(products)
            }
        else:
            return {
                "success": True,
                "message": "Products sync completed",
                "products_count": 0
            }
        
    except Exception as e:
        logger.error(f"Failed to force products sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/sync")
async def get_products_sync_status():
    """
    Get the current sync status for products
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
        
        # Get products count
        db_service = await get_database_service()
        products = await db_service.get_products_by_tenant(tenant_id)
        
        # Get sync status
        sync_status = await sync_service.get_sync_status()
        
        return {
            "sync_enabled": True,
            "is_running": sync_status.get('is_running', False),
            "connected_to_realtime": sync_status.get('connected_to_realtime', False),
            "tenant_id": tenant_id,
            "local_products_count": len(products),
            "last_check": sync_status.get('last_check')
        }
        
    except Exception as e:
        logger.error(f"Failed to get products sync status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=dict)
async def create_product(product_request: ProductCreateRequest):
    """
    Create a new product (local-first)

    Creates a new product in the local SQLite database.
    This is the local-first approach where SQLite is the source of truth.
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")

        # Use provided ID if exists (for image upload), otherwise generate new UUID
        product_id = product_request.id or str(uuid.uuid4())

        # Create product data dict
        product_data = {
            'id': product_id,
            'tenant_id': tenant_id,
            'name': product_request.name,
            'description': product_request.description,
            'category': product_request.category,
            'print_file_id': product_request.print_file_id,
            'file_name': product_request.file_name,
            'requires_assembly': product_request.requires_assembly,
            'requires_post_processing': product_request.requires_post_processing,
            'image_url': product_request.image_url,
            'printer_priority': product_request.printer_priority,
            'wiki_id': product_request.wiki_id,
            'is_active': True,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow()
        }
        
        # Insert into local SQLite
        db_service = await get_database_service()
        success = await db_service.upsert_product(product_data)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to create product")

        # Components are handled by frontend directly to Supabase (with user auth context)

        return {
            'success': True,
            'message': f"Product '{product_request.name}' created successfully",
            'product': product_data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create product: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{product_id}", response_model=dict)
async def update_product(product_id: str, product_request: ProductUpdateRequest):
    """
    Update an existing product (local-first)

    Updates a product in the local SQLite database.
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Get existing product
        db_service = await get_database_service()
        existing_product = await db_service.get_product_by_id(product_id)
        
        if not existing_product:
            raise HTTPException(status_code=404, detail="Product not found")
        
        # Build update data (only include fields that were provided)
        update_data = {'id': product_id, 'tenant_id': tenant_id, 'updated_at': datetime.utcnow()}

        if product_request.name is not None:
            update_data['name'] = product_request.name
        if product_request.description is not None:
            update_data['description'] = product_request.description
        if product_request.category is not None:
            update_data['category'] = product_request.category
        if product_request.print_file_id is not None:
            update_data['print_file_id'] = product_request.print_file_id
        if product_request.file_name is not None:
            update_data['file_name'] = product_request.file_name
        if product_request.requires_assembly is not None:
            update_data['requires_assembly'] = product_request.requires_assembly
        if product_request.requires_post_processing is not None:
            update_data['requires_post_processing'] = product_request.requires_post_processing
        if product_request.image_url is not None:
            update_data['image_url'] = product_request.image_url
        if product_request.printer_priority is not None:
            update_data['printer_priority'] = product_request.printer_priority
        if product_request.wiki_id is not None:
            update_data['wiki_id'] = product_request.wiki_id

        # Update in local SQLite
        success = await db_service.upsert_product(update_data)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to update product")

        # Components are handled by frontend directly to Supabase (with user auth context)

        # Get updated product
        updated_product = await db_service.get_product_by_id(product_id)
        return {
            'success': True,
            'message': f"Product '{product_id}' updated successfully",
            'product': updated_product.to_dict() if updated_product else update_data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update product {product_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{product_id}")
async def delete_product(product_id: str):
    """
    Delete a product (local-first)

    Deletes a product from the local SQLite database.
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")
        
        # Check if product exists
        db_service = await get_database_service()
        existing_product = await db_service.get_product_by_id(product_id)

        if not existing_product:
            raise HTTPException(status_code=404, detail="Product not found")

        # Delete product_components from Supabase (Supabase-only table)
        # This must happen before local deletion to ensure cleanup
        auth_service = get_auth_service()
        if auth_service and auth_service.supabase:
            try:
                auth_service.supabase.table('product_components').delete().eq('product_id', product_id).execute()
                logger.info(f"Deleted components for product {product_id}")
            except Exception as e:
                logger.warning(f"Failed to delete components for product {product_id}: {e}")

        # Delete from local SQLite
        success = await db_service.delete_product(product_id, tenant_id)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete product")

        return {
            'success': True,
            'message': f"Product '{product_id}' deleted successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete product {product_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))