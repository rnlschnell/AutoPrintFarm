"""
API endpoints for build plate types management
"""

from fastapi import APIRouter, HTTPException, Depends, Request
from typing import List, Optional
import logging
import uuid
from datetime import datetime
import time
from collections import defaultdict

from ..services.database_service import get_database_service
from ..services.config_service import get_config_service
from ..models.database import BuildPlateType
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Emergency rate limiting for build plate types endpoint
request_counts = defaultdict(list)
RATE_LIMIT_WINDOW = 60  # 1 minute window
RATE_LIMIT_MAX_REQUESTS = 50  # Max 50 requests per minute per IP

def check_rate_limit(request: Request):
    """Emergency rate limiting to prevent infinite loops"""
    client_ip = request.client.host if request.client else "unknown"
    current_time = time.time()

    # Clean old requests outside the window
    cutoff_time = current_time - RATE_LIMIT_WINDOW
    request_counts[client_ip] = [req_time for req_time in request_counts[client_ip] if req_time > cutoff_time]

    # Check if over limit
    if len(request_counts[client_ip]) >= RATE_LIMIT_MAX_REQUESTS:
        logger.warning(f"Rate limit exceeded for IP {client_ip}: {len(request_counts[client_ip])} requests in {RATE_LIMIT_WINDOW}s")
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Max {RATE_LIMIT_MAX_REQUESTS} requests per {RATE_LIMIT_WINDOW} seconds."
        )

    # Record this request
    request_counts[client_ip].append(current_time)

# Pydantic models for requests/responses
class BuildPlateTypeCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    is_active: bool = True

class BuildPlateTypeUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

router = APIRouter(
    prefix="/build-plate-types",
    tags=["Build Plate Types"],
    responses={404: {"description": "Not found"}},
)

@router.get("/", response_model=List[dict])
async def get_build_plate_types(request: Request):
    """
    Get all build plate types for the current tenant
    """
    # Emergency rate limiting to prevent infinite loops
    check_rate_limit(request)

    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()

        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")

        # Get build plate types from database
        db_service = await get_database_service()
        build_plates = await db_service.get_build_plate_types_by_tenant(tenant_id)

        # Convert to dict for response
        return [build_plate.to_dict() for build_plate in build_plates]

    except Exception as e:
        logger.error(f"Failed to get build plate types: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{build_plate_id}", response_model=dict)
async def get_build_plate_type(build_plate_id: str):
    """
    Get a specific build plate type by ID
    """
    try:
        db_service = await get_database_service()
        build_plate = await db_service.get_build_plate_type_by_id(build_plate_id)

        if not build_plate:
            raise HTTPException(status_code=404, detail="Build plate type not found")

        return build_plate.to_dict()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get build plate type {build_plate_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=dict)
async def create_build_plate_type(build_plate_request: BuildPlateTypeCreateRequest):
    """
    Create a new build plate type (local-first)

    Creates a new build plate type in the local SQLite database.
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()

        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")

        # Generate UUID for new build plate type
        build_plate_id = str(uuid.uuid4())

        # Create build plate type data dict
        build_plate_data = {
            'id': build_plate_id,
            'tenant_id': tenant_id,
            'name': build_plate_request.name,
            'description': build_plate_request.description,
            'is_active': build_plate_request.is_active,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow()
        }

        # Insert into local SQLite (local-first, no Supabase backup)
        db_service = await get_database_service()
        success = await db_service.upsert_build_plate_type(build_plate_data)

        if success:
            return {
                'success': True,
                'message': f"Build plate type '{build_plate_request.name}' created successfully",
                'build_plate': build_plate_data
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create build plate type")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create build plate type: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{build_plate_id}", response_model=dict)
async def update_build_plate_type(build_plate_id: str, build_plate_request: BuildPlateTypeUpdateRequest):
    """
    Update an existing build plate type (local-first)
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()

        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")

        # Get existing build plate type
        db_service = await get_database_service()
        existing_build_plate = await db_service.get_build_plate_type_by_id(build_plate_id)

        if not existing_build_plate:
            raise HTTPException(status_code=404, detail="Build plate type not found")

        # Build update data
        update_data = {'id': build_plate_id, 'tenant_id': tenant_id, 'updated_at': datetime.utcnow()}

        if build_plate_request.name is not None:
            update_data['name'] = build_plate_request.name
        if build_plate_request.description is not None:
            update_data['description'] = build_plate_request.description
        if build_plate_request.is_active is not None:
            update_data['is_active'] = build_plate_request.is_active

        # Update in local SQLite
        success = await db_service.upsert_build_plate_type(update_data)

        if success:
            # Get updated build plate type
            updated_build_plate = await db_service.get_build_plate_type_by_id(build_plate_id)
            return {
                'success': True,
                'message': f"Build plate type '{build_plate_id}' updated successfully",
                'build_plate': updated_build_plate.to_dict() if updated_build_plate else update_data
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to update build plate type")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update build plate type {build_plate_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{build_plate_id}")
async def delete_build_plate_type(build_plate_id: str):
    """
    Delete a build plate type (local-first)
    """
    try:
        # Get tenant ID from config
        config_service = get_config_service()
        tenant_config = config_service.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()

        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant not configured")

        # Check if build plate type exists
        db_service = await get_database_service()
        existing_build_plate = await db_service.get_build_plate_type_by_id(build_plate_id)

        if not existing_build_plate:
            raise HTTPException(status_code=404, detail="Build plate type not found")

        # Delete from local SQLite
        success = await db_service.delete_build_plate_type(build_plate_id, tenant_id)

        if success:
            return {
                'success': True,
                'message': f"Build plate type '{build_plate_id}' deleted successfully"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to delete build plate type")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete build plate type {build_plate_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
