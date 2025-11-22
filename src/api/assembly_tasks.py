"""
API endpoints for assembly tasks management
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
import logging
import uuid
from datetime import datetime

from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
from ..models.database import AssemblyTask
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Pydantic models for requests/responses
class AssemblyTaskCreateRequest(BaseModel):
    finished_good_id: str
    product_name: str
    sku: str
    quantity: int = 1
    assigned_to: Optional[str] = None
    notes: Optional[str] = None

class AssemblyTaskUpdateRequest(BaseModel):
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    notes: Optional[str] = None

class AssemblyTaskCompleteRequest(BaseModel):
    notes: Optional[str] = None

router = APIRouter(
    prefix="/assembly-tasks",
    tags=["Assembly Tasks"],
    responses={404: {"description": "Not found"}},
)

@router.get("/", response_model=List[dict])
async def get_assembly_tasks(
    status: Optional[str] = Query(None, description="Filter by status: pending, in_progress, completed"),
    assigned_to: Optional[str] = Query(None, description="Filter by assigned user")
):
    """
    Get all assembly tasks for the current tenant from local SQLite
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()

        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")

        # Get assembly tasks from local database
        db_service = await get_database_service()

        # Build filters
        filters = {'tenant_id': tenant_id}
        if status:
            filters['status'] = status
        if assigned_to:
            filters['assigned_to'] = assigned_to

        # Get tasks (this method would need to be added to database_service)
        assembly_tasks = await db_service.get_assembly_tasks_by_filters(filters)

        # Convert to dict for response
        return [task.to_dict() for task in assembly_tasks]

    except Exception as e:
        logger.error(f"Failed to get assembly tasks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{task_id}", response_model=dict)
async def get_assembly_task(task_id: str):
    """
    Get a specific assembly task by ID from local SQLite
    """
    try:
        db_service = await get_database_service()
        task = await db_service.get_assembly_task_by_id(task_id)

        if not task:
            raise HTTPException(status_code=404, detail="Assembly task not found")

        return task.to_dict()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get assembly task {task_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=dict)
async def create_assembly_task(request: AssemblyTaskCreateRequest):
    """
    Create a new assembly task
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()

        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")

        db_service = await get_database_service()

        # Create new task
        task_id = str(uuid.uuid4())
        task_data = {
            'id': task_id,
            'tenant_id': tenant_id,
            'finished_good_id': request.finished_good_id,
            'product_name': request.product_name,
            'sku': request.sku,
            'quantity': request.quantity,
            'status': 'pending',
            'assigned_to': request.assigned_to,
            'notes': request.notes
        }

        # Create task in database
        task = await db_service.create_assembly_task(task_data)

        logger.info(f"Created assembly task: {task_id}")
        return task.to_dict()

    except Exception as e:
        logger.error(f"Failed to create assembly task: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/{task_id}", response_model=dict)
async def update_assembly_task(task_id: str, request: AssemblyTaskUpdateRequest):
    """
    Update an assembly task and consume component inventory when completed
    """
    try:
        db_service = await get_database_service()
        config_service = get_config_service()

        # Build update data
        update_data = {}
        if request.status is not None:
            if request.status not in ['pending', 'in_progress', 'completed']:
                raise HTTPException(status_code=400, detail="Invalid status. Must be: pending, in_progress, completed")
            update_data['status'] = request.status

            # Set completed timestamp if status is completed
            if request.status == 'completed':
                update_data['completed_at'] = datetime.utcnow()
                logger.info(f"Completing assembly task {task_id}")
                # Note: Component inventory consumption is handled by the frontend
                # where the user is authenticated and RLS policies work correctly

        if request.assigned_to is not None:
            update_data['assigned_to'] = request.assigned_to

        if request.notes is not None:
            update_data['notes'] = request.notes

        if not update_data:
            raise HTTPException(status_code=400, detail="No update data provided")

        # Update task
        task = await db_service.update_assembly_task(task_id, update_data)

        if not task:
            raise HTTPException(status_code=404, detail="Assembly task not found")

        logger.info(f"Updated assembly task: {task_id}")
        return task.to_dict()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update assembly task {task_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{task_id}/complete", response_model=dict)
async def complete_assembly_task(task_id: str, request: AssemblyTaskCompleteRequest):
    """
    Mark an assembly task as completed
    Note: Component inventory consumption is handled by the frontend
    """
    try:
        db_service = await get_database_service()

        # Get the assembly task
        task = await db_service.get_assembly_task_by_id(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Assembly task not found")

        # Update task status to completed
        update_data = {
            'status': 'completed',
            'completed_at': datetime.utcnow()
        }

        if request.notes:
            update_data['notes'] = request.notes

        # Update task
        task = await db_service.update_assembly_task(task_id, update_data)

        if not task:
            raise HTTPException(status_code=404, detail="Assembly task not found")

        logger.info(f"Completed assembly task: {task_id}")
        return task.to_dict()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to complete assembly task {task_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{task_id}/wiki")
async def get_assembly_task_wiki(task_id: str):
    """
    Get the wiki associated with an assembly task's product

    Looks up the wiki via: AssemblyTask → FinishedGoods → ProductSku → Product → wiki_id
    Returns the wiki_id if found, which can be used to fetch the wiki from Supabase
    """
    try:
        db_service = await get_database_service()

        # Get the assembly task
        task = await db_service.get_assembly_task_by_id(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Assembly task not found")

        # Get the finished good
        finished_good = await db_service.get_finished_good_by_id(task.finished_good_id)
        if not finished_good:
            logger.warning(f"Finished good {task.finished_good_id} not found for task {task_id}")
            return {"wiki_id": None, "message": "Finished good not found"}

        # Get the product SKU
        product_sku = await db_service.get_product_sku_by_id(finished_good.product_sku_id)
        if not product_sku:
            logger.warning(f"Product SKU {finished_good.product_sku_id} not found")
            return {"wiki_id": None, "message": "Product SKU not found"}

        # Get the product
        product = await db_service.get_product_by_id(product_sku.product_id)
        if not product:
            logger.warning(f"Product {product_sku.product_id} not found")
            return {"wiki_id": None, "message": "Product not found"}

        # Return the wiki_id
        if product.wiki_id:
            return {
                "wiki_id": product.wiki_id,
                "product_id": product.id,
                "product_name": product.name,
                "message": "Wiki found for product"
            }
        else:
            return {
                "wiki_id": None,
                "product_id": product.id,
                "product_name": product.name,
                "message": "No wiki configured for this product"
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get wiki for assembly task {task_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{task_id}")
async def delete_assembly_task(task_id: str):
    """
    Delete an assembly task
    """
    try:
        db_service = await get_database_service()

        # Delete task
        success = await db_service.delete_assembly_task(task_id)

        if not success:
            raise HTTPException(status_code=404, detail="Assembly task not found")

        logger.info(f"Deleted assembly task: {task_id}")
        return {"message": "Assembly task deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete assembly task {task_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))