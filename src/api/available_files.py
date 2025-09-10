"""
API endpoints for retrieving available files on Pi
Supports both print files and product-linked files
"""

from fastapi import APIRouter, HTTPException, Request
import os
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime

from ..services.config_service import get_config_service
from ..services.database_service import get_database_service
from ..utils.tenant_utils import get_tenant_id_or_raise
import re

logger = logging.getLogger(__name__)

def clean_filename(filename: str) -> str:
    """
    Remove timestamp and random characters from filename if present.
    Handles patterns like: 
    - 1755983326688-SFGood3MF.gcode
    - SFGood3MF_1755983326688_eo6b.gcode  
    - 12d13552-62c3-4ff0-913c-484cfa2db316.3mf (falls back to UUID.ext)
    Returns the clean filename without timestamp/UUID.
    """
    if not filename:
        return filename
    
    # Pattern 1: timestamp prefix (13 digits followed by dash)
    pattern1 = r'^\d{13}-'
    cleaned = re.sub(pattern1, '', filename)
    
    # Pattern 2: name_timestamp_randomchars.ext -> name.ext
    pattern2 = r'_\d{13}_\w+(\.\w+)$'
    match = re.search(pattern2, cleaned)
    if match:
        # Extract base name before first underscore and add extension
        base_name = cleaned.split('_')[0]
        extension = match.group(1)
        cleaned = base_name + extension
    
    return cleaned

router = APIRouter(
    prefix="/available-files",
    tags=["Available Files"],
    responses={404: {"description": "Not found"}},
)

@router.get("/print-files")
async def get_available_print_files(request: Request):
    """
    Get available print files that are linked to active products
    Returns file information including local paths and metadata, filtered by active products
    """
    try:
        # Get tenant ID from authenticated request
        tenant_id = get_tenant_id_or_raise(request)
        
        # Get database service to check active products
        db_service = await get_database_service()
        
        # Get active products and their print file IDs
        active_products = await db_service.get_products_by_tenant(tenant_id)
        active_file_ids = {p.print_file_id for p in active_products if p.print_file_id and p.is_active}
        
        # Create mapping from print_file_id to clean filename using products.file_name
        # This is the authoritative source for clean filenames
        file_names_map = {}
        for product in active_products:
            if product.print_file_id and product.is_active and product.file_name:
                file_names_map[product.print_file_id] = product.file_name
        
        logger.info(f"Found {len(active_products)} total products, {len(active_file_ids)} active print file IDs")
        
        # Get print files directory
        files_dir = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id
        
        available_files = []
        supported_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        
        if files_dir.exists():
            # Scan for all supported file types
            for ext in supported_extensions:
                for file_path in files_dir.glob(f"*{ext}"):
                    try:
                        stat = file_path.stat()
                        
                        # Extract record ID from filename (should be {record_id}.{ext})
                        record_id = file_path.stem
                        
                        # Only include files that are linked to active products
                        if record_id in active_file_ids:
                            # Use clean filename from products table (authoritative source)
                            # Fallback to cleaning the filename if not found in products
                            clean_name = file_names_map.get(record_id)
                            if not clean_name:
                                # Fallback: clean the filename from print_files or file path
                                clean_name = clean_filename(file_path.name)
                            
                            file_info = {
                                "id": record_id,
                                "filename": clean_name,  # Use clean filename from products or cleaned fallback
                                "local_path": str(file_path),
                                "size_bytes": stat.st_size,
                                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                                "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                                "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                                "exists": True
                            }
                            
                            available_files.append(file_info)
                            logger.debug(f"Including file {file_path.name} linked to active product")
                        else:
                            logger.debug(f"Skipping orphaned file {file_path.name} (not linked to active product)")
                            
                    except Exception as e:
                        logger.warning(f"Error processing file {file_path}: {e}")
                        continue
        
        # Sort by creation time (newest first)
        available_files.sort(key=lambda x: x['created_at'], reverse=True)
        
        logger.info(f"Found {len(available_files)} available print files linked to active products for tenant {tenant_id}")
        
        return {
            "success": True,
            "message": f"Found {len(available_files)} print files linked to active products",
            "tenant_id": tenant_id,
            "files": available_files,
            "total_count": len(available_files),
            "active_products_count": len(active_file_ids),
            "total_size_mb": round(sum(f['size_bytes'] for f in available_files) / (1024 * 1024), 2) if available_files else 0
        }
        
    except Exception as e:
        logger.error(f"Failed to get available print files: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/products-with-files")
async def get_products_with_files(request: Request):
    """
    Get all products that have associated print files available on Pi
    Returns product information with file availability status
    """
    try:
        # Get tenant ID from authenticated request
        tenant_id = get_tenant_id_or_raise(request)
        
        # Get database service
        db_service = await get_database_service()
        
        # Get all products for this tenant
        products = await db_service.get_products_by_tenant(tenant_id)
        
        products_with_files = []
        files_dir = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id
        
        for product in products:
            # Skip products without print files
            if not product.print_file_id:
                continue
                
            # Check if file exists on Pi
            file_path = files_dir / f"{product.print_file_id}.3mf"
            file_exists = file_path.exists()
            
            file_info = None
            if file_exists:
                try:
                    stat = file_path.stat()
                    file_info = {
                        "local_path": str(file_path),
                        "size_bytes": stat.st_size,
                        "size_mb": round(stat.st_size / (1024 * 1024), 2),
                        "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                        "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat()
                    }
                except Exception as e:
                    logger.warning(f"Error getting file info for {file_path}: {e}")
            
            product_info = {
                "id": product.id,
                "name": product.name,
                "description": product.description,
                "category": product.category,
                "print_file_id": product.print_file_id,
                "requires_assembly": product.requires_assembly,
                "image_url": product.image_url,
                "created_at": product.created_at.isoformat() if hasattr(product.created_at, 'isoformat') else str(product.created_at) if product.created_at else None,
                "file_available": file_exists,
                "file_info": file_info
            }
            
            products_with_files.append(product_info)
        
        # Sort by name
        products_with_files.sort(key=lambda x: x['name'])
        
        # Separate available vs missing files
        available_products = [p for p in products_with_files if p['file_available']]
        missing_file_products = [p for p in products_with_files if not p['file_available']]
        
        logger.info(f"Found {len(available_products)} products with available files, "
                   f"{len(missing_file_products)} with missing files")
        
        return {
            "success": True,
            "message": f"Found {len(products_with_files)} products with print files",
            "tenant_id": tenant_id,
            "products": {
                "available": available_products,
                "missing_files": missing_file_products,
                "all": products_with_files
            },
            "counts": {
                "total_products": len(products_with_files),
                "files_available": len(available_products),
                "files_missing": len(missing_file_products)
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get products with files: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/products/{product_id}/print-file")
async def get_product_print_file(product_id: str, request: Request):
    """
    Get print file information for a specific product
    Validates file exists on Pi and returns file details
    """
    try:
        # Get tenant ID from authenticated request
        tenant_id = get_tenant_id_or_raise(request)
        
        # Get database service
        db_service = await get_database_service()
        
        # Get product
        product = await db_service.get_product_by_id(product_id)
        
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        
        if not product.print_file_id:
            raise HTTPException(status_code=404, detail="Product has no associated print file")
        
        # Check file on Pi
        files_dir = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id
        file_path = files_dir / f"{product.print_file_id}.3mf"
        
        if not file_path.exists():
            raise HTTPException(
                status_code=404, 
                detail=f"Print file not found on Pi: {product.print_file_id}.3mf"
            )
        
        # Get file information
        stat = file_path.stat()
        
        return {
            "success": True,
            "message": "Product print file found",
            "product": {
                "id": product.id,
                "name": product.name,
                "description": product.description,
                "print_file_id": product.print_file_id
            },
            "file": {
                "id": product.print_file_id,
                "filename": file_path.name,
                "local_path": str(file_path),
                "size_bytes": stat.st_size,
                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "exists": True
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get product print file for {product_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status")
async def get_files_status(request: Request):
    """
    Get overall status of file availability and storage
    """
    try:
        # Get tenant ID from authenticated request
        tenant_id = get_tenant_id_or_raise(request)
        
        # Check directories
        base_dir = Path("/home/pi/PrintFarmSoftware/files")
        tenant_dir = base_dir / "print_files" / tenant_id
        
        # Count files
        file_count = 0
        total_size = 0
        
        if tenant_dir.exists():
            for file_path in tenant_dir.glob("*.3mf"):
                if file_path.is_file():
                    file_count += 1
                    total_size += file_path.stat().st_size
        
        # Get database counts
        db_service = await get_database_service()
        products = await db_service.get_products_by_tenant(tenant_id)
        products_with_files = len([p for p in products if p.print_file_id])
        
        return {
            "success": True,
            "message": "File storage status",
            "tenant_id": tenant_id,
            "storage": {
                "base_directory": str(base_dir),
                "tenant_directory": str(tenant_dir),
                "directory_exists": tenant_dir.exists(),
                "total_files": file_count,
                "total_size_bytes": total_size,
                "total_size_mb": round(total_size / (1024 * 1024), 2)
            },
            "database": {
                "total_products": len(products),
                "products_with_files": products_with_files,
                "products_without_files": len(products) - products_with_files
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get files status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/maintenance/cleanup-orphaned")
async def cleanup_orphaned_files(request: Request):
    """
    Comprehensive cleanup of orphaned print files from both database and filesystem
    Removes files that are not linked to any active products
    """
    try:
        # Get tenant ID from authenticated request
        tenant_id = get_tenant_id_or_raise(request)
        
        # Get database service
        db_service = await get_database_service()
        
        # Get active products and their print file IDs
        active_products = await db_service.get_products_by_tenant(tenant_id)
        active_file_ids = {p.print_file_id for p in active_products if p.print_file_id and p.is_active}
        
        logger.info(f"Starting cleanup - {len(active_products)} total products, {len(active_file_ids)} active print file IDs")
        
        cleanup_results = {
            "orphaned_files_removed_from_db": [],
            "orphaned_files_removed_from_filesystem": [],
            "errors": [],
            "active_products_count": len(active_file_ids)
        }
        
        # Phase 1: Clean up orphaned files from database
        all_print_files = await db_service.get_print_files_by_tenant(tenant_id)
        orphaned_db_files = [pf for pf in all_print_files if pf.id not in active_file_ids]
        
        logger.info(f"Found {len(orphaned_db_files)} orphaned files in database")
        
        for orphaned_file in orphaned_db_files:
            try:
                # Delete the print file record (versions will cascade if configured properly)
                success = await db_service.delete_print_file(orphaned_file.id, tenant_id)
                
                if success:
                    cleanup_results["orphaned_files_removed_from_db"].append({
                        "id": orphaned_file.id,
                        "name": orphaned_file.name
                    })
                    logger.info(f"Deleted orphaned print file from database: {orphaned_file.name}")
                
            except Exception as e:
                error_msg = f"Failed to delete orphaned file {orphaned_file.id} from database: {str(e)}"
                logger.error(error_msg)
                cleanup_results["errors"].append(error_msg)
        
        # Phase 2: Clean up orphaned files from filesystem
        files_dir = Path("/home/pi/PrintFarmSoftware/files/print_files") / tenant_id
        supported_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf']
        
        if files_dir.exists():
            for ext in supported_extensions:
                for file_path in files_dir.glob(f"*{ext}"):
                    try:
                        record_id = file_path.stem
                        
                        # If file is not linked to active product, delete it
                        if record_id not in active_file_ids:
                            file_size = file_path.stat().st_size
                            file_path.unlink()
                            
                            cleanup_results["orphaned_files_removed_from_filesystem"].append({
                                "id": record_id,
                                "filename": file_path.name,
                                "size_bytes": file_size,
                                "path": str(file_path)
                            })
                            logger.info(f"Deleted orphaned file from filesystem: {file_path.name}")
                            
                    except Exception as e:
                        error_msg = f"Failed to delete orphaned file {file_path} from filesystem: {str(e)}"
                        logger.error(error_msg)
                        cleanup_results["errors"].append(error_msg)
        
        total_cleaned = len(cleanup_results["orphaned_files_removed_from_db"]) + len(cleanup_results["orphaned_files_removed_from_filesystem"])
        
        return {
            "success": True,
            "message": f"Cleanup completed. Removed {total_cleaned} orphaned files ({len(cleanup_results['orphaned_files_removed_from_db'])} from database, {len(cleanup_results['orphaned_files_removed_from_filesystem'])} from filesystem)",
            "tenant_id": tenant_id,
            "cleanup_results": cleanup_results,
            "total_files_cleaned": total_cleaned,
            "errors_count": len(cleanup_results["errors"])
        }
        
    except Exception as e:
        logger.error(f"Failed to cleanup orphaned files: {e}")
        raise HTTPException(status_code=500, detail=str(e))