"""
API endpoints for worklist tasks management
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
import logging
import uuid
from datetime import datetime

from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
from ..models.database import WorklistTask
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Pydantic models for requests/responses
class WorklistTaskCreateRequest(BaseModel):
    title: str
    subtitle: Optional[str] = None
    description: Optional[str] = None
    task_type: str  # assembly, filament_change, collection, maintenance, quality_check
    priority: Optional[str] = 'medium'  # low, medium, high
    status: Optional[str] = 'pending'  # pending, in_progress, completed, cancelled
    assembly_task_id: Optional[str] = None
    printer_id: Optional[str] = None
    assigned_to: Optional[str] = None
    order_number: Optional[str] = None
    estimated_time_minutes: Optional[int] = None
    due_date: Optional[datetime] = None
    metadata: Optional[dict] = None

class WorklistTaskUpdateRequest(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    printer_id: Optional[str] = None
    assigned_to: Optional[str] = None
    order_number: Optional[str] = None
    estimated_time_minutes: Optional[int] = None
    actual_time_minutes: Optional[int] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    due_date: Optional[datetime] = None
    metadata: Optional[dict] = None

class WorklistTaskCompleteRequest(BaseModel):
    actual_time_minutes: Optional[int] = None
    metadata: Optional[dict] = None

router = APIRouter(
    prefix="/worklist",
    tags=["Worklist"],
    responses={404: {"description": "Not found"}},
)

@router.get("/", response_model=List[dict])
async def get_worklist_tasks(
    status: Optional[str] = Query(None, description="Filter by status: pending, in_progress, completed, cancelled"),
    task_type: Optional[str] = Query(None, description="Filter by task type: assembly, filament_change, collection, maintenance, quality_check"),
    priority: Optional[str] = Query(None, description="Filter by priority: low, medium, high"),
    assigned_to: Optional[str] = Query(None, description="Filter by assigned user")
):
    """
    Get all worklist tasks for the current tenant from local SQLite
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()

        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")

        # Get worklist tasks from local database
        db_service = await get_database_service()

        # Build filters
        filters = {'tenant_id': tenant_id}
        if status:
            filters['status'] = status
        if task_type:
            filters['task_type'] = task_type
        if priority:
            filters['priority'] = priority
        if assigned_to:
            filters['assigned_to'] = assigned_to

        # Get tasks
        worklist_tasks = await db_service.get_worklist_tasks_by_filters(filters)

        # Convert to dict for response
        return [task.to_dict() for task in worklist_tasks]

    except Exception as e:
        logger.error(f"Failed to get worklist tasks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{task_id}", response_model=dict)
async def get_worklist_task(task_id: str):
    """
    Get a specific worklist task by ID from local SQLite
    """
    try:
        db_service = await get_database_service()
        task = await db_service.get_worklist_task_by_id(task_id)

        if not task:
            raise HTTPException(status_code=404, detail="Worklist task not found")

        return task.to_dict()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get worklist task {task_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=dict)
async def create_worklist_task(request: WorklistTaskCreateRequest):
    """
    Create a new worklist task
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()

        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")

        # Validate task_type
        valid_task_types = ['assembly', 'filament_change', 'collection', 'maintenance', 'quality_check']
        if request.task_type not in valid_task_types:
            raise HTTPException(status_code=400, detail=f"Invalid task_type. Must be one of: {', '.join(valid_task_types)}")

        # Validate priority
        valid_priorities = ['low', 'medium', 'high']
        if request.priority and request.priority not in valid_priorities:
            raise HTTPException(status_code=400, detail=f"Invalid priority. Must be one of: {', '.join(valid_priorities)}")

        # Validate status
        valid_statuses = ['pending', 'in_progress', 'completed', 'cancelled']
        if request.status and request.status not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}")

        db_service = await get_database_service()

        # Create new task
        task_id = str(uuid.uuid4())
        task_data = {
            'id': task_id,
            'tenant_id': tenant_id,
            'title': request.title,
            'subtitle': request.subtitle,
            'description': request.description,
            'task_type': request.task_type,
            'priority': request.priority or 'medium',
            'status': request.status or 'pending',
            'assembly_task_id': request.assembly_task_id,
            'printer_id': request.printer_id,
            'assigned_to': request.assigned_to,
            'order_number': request.order_number,
            'estimated_time_minutes': request.estimated_time_minutes,
            'due_date': request.due_date,
            'task_metadata': request.metadata
        }

        # Create task in database
        task = await db_service.create_worklist_task(task_data)

        logger.info(f"Created worklist task: {task_id}")
        return task.to_dict()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create worklist task: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/{task_id}", response_model=dict)
async def update_worklist_task(task_id: str, request: WorklistTaskUpdateRequest):
    """
    Update a worklist task
    """
    try:
        db_service = await get_database_service()

        # Build update data
        update_data = {}

        if request.title is not None:
            update_data['title'] = request.title
        if request.subtitle is not None:
            update_data['subtitle'] = request.subtitle
        if request.description is not None:
            update_data['description'] = request.description
        if request.task_type is not None:
            valid_task_types = ['assembly', 'filament_change', 'collection', 'maintenance', 'quality_check']
            if request.task_type not in valid_task_types:
                raise HTTPException(status_code=400, detail=f"Invalid task_type. Must be one of: {', '.join(valid_task_types)}")
            update_data['task_type'] = request.task_type
        if request.priority is not None:
            valid_priorities = ['low', 'medium', 'high']
            if request.priority not in valid_priorities:
                raise HTTPException(status_code=400, detail=f"Invalid priority. Must be one of: {', '.join(valid_priorities)}")
            update_data['priority'] = request.priority
        if request.status is not None:
            valid_statuses = ['pending', 'in_progress', 'completed', 'cancelled']
            if request.status not in valid_statuses:
                raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}")
            update_data['status'] = request.status

            # Set completed timestamp if status is completed
            if request.status == 'completed':
                update_data['completed_at'] = datetime.utcnow()

                # Calculate actual_time_minutes from started_at and completed_at
                # Get the current task to access started_at
                current_task = await db_service.get_worklist_task_by_id(task_id)
                if current_task and current_task.started_at:
                    time_diff = update_data['completed_at'] - current_task.started_at
                    update_data['actual_time_minutes'] = int(time_diff.total_seconds() / 60)

                # Auto-clear printer if this is a collection task
                if current_task and current_task.task_type == 'collection' and current_task.printer_id:
                    try:
                        # Get current printer data
                        printer = await db_service.get_printer_by_id(current_task.printer_id)
                        if printer:
                            # Update using upsert_printer with full printer dict
                            printer_dict = printer.to_dict()
                            printer_dict['cleared'] = True
                            await db_service.upsert_printer(printer_dict)
                            logger.info(f"Automatically set printer {current_task.printer_id} as cleared after completing collection task {task_id}")
                    except Exception as e:
                        # Log the error but don't fail the task completion
                        logger.error(f"Failed to auto-clear printer {current_task.printer_id} after completing collection task {task_id}: {e}")

            # Set started timestamp if status is in_progress
            elif request.status == 'in_progress' and request.started_at is None:
                update_data['started_at'] = datetime.utcnow()

        if request.printer_id is not None:
            update_data['printer_id'] = request.printer_id
        if request.assigned_to is not None:
            update_data['assigned_to'] = request.assigned_to
        if request.order_number is not None:
            update_data['order_number'] = request.order_number
        if request.estimated_time_minutes is not None:
            update_data['estimated_time_minutes'] = request.estimated_time_minutes
        if request.actual_time_minutes is not None:
            update_data['actual_time_minutes'] = request.actual_time_minutes
        if request.started_at is not None:
            update_data['started_at'] = request.started_at
        if request.completed_at is not None:
            update_data['completed_at'] = request.completed_at
        if request.due_date is not None:
            update_data['due_date'] = request.due_date
        if request.metadata is not None:
            update_data['metadata'] = request.metadata

        if not update_data:
            raise HTTPException(status_code=400, detail="No update data provided")

        # Update task
        task = await db_service.update_worklist_task(task_id, update_data)

        if not task:
            raise HTTPException(status_code=404, detail="Worklist task not found")

        logger.info(f"Updated worklist task: {task_id}")
        return task.to_dict()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update worklist task {task_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{task_id}/complete", response_model=dict)
async def complete_worklist_task(task_id: str, request: WorklistTaskCompleteRequest):
    """
    Mark a worklist task as completed
    """
    try:
        db_service = await get_database_service()

        # Update task status to completed
        update_data = {
            'status': 'completed',
            'completed_at': datetime.utcnow()
        }

        if request.actual_time_minutes is not None:
            update_data['actual_time_minutes'] = request.actual_time_minutes

        if request.metadata is not None:
            update_data['metadata'] = request.metadata

        # Update task
        task = await db_service.update_worklist_task(task_id, update_data)

        if not task:
            raise HTTPException(status_code=404, detail="Worklist task not found")

        logger.info(f"Completed worklist task: {task_id}")
        return task.to_dict()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to complete worklist task {task_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{task_id}")
async def delete_worklist_task(task_id: str):
    """
    Delete a worklist task
    """
    try:
        db_service = await get_database_service()

        # Delete task
        success = await db_service.delete_worklist_task(task_id)

        if not success:
            raise HTTPException(status_code=404, detail="Worklist task not found")

        logger.info(f"Deleted worklist task: {task_id}")
        return {"message": "Worklist task deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete worklist task {task_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))