"""
Database backup and restore API endpoints
"""

import os
import shutil
import gzip
import json
import logging
import sqlite3
import hashlib
import tarfile
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List
from fastapi import APIRouter, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
import aiofiles
import tempfile

from ..services.database_service import DatabaseService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Database Backup & Restore"])

# Initialize database service
db_service = DatabaseService()

async def _gather_files_metadata(
    files_path: Path,
    supported_extensions: List[str],
    validate_files: bool = True
) -> Dict:
    """
    Gather metadata about files in the backup

    Args:
        files_path: Path to the files directory
        supported_extensions: List of supported file extensions
        validate_files: Whether to calculate file checksums

    Returns:
        Dictionary containing files metadata
    """
    files_info = {
        "total_files": 0,
        "total_size_bytes": 0,
        "by_extension": {},
        "by_tenant": {},
        "file_checksums": {} if validate_files else None
    }

    if not files_path.exists():
        return files_info

    # Initialize extension counters
    for ext in supported_extensions:
        files_info["by_extension"][ext] = {"count": 0, "size_bytes": 0}

    # Scan all files
    for tenant_dir in files_path.iterdir():
        if tenant_dir.is_dir():
            tenant_id = tenant_dir.name
            tenant_info = {
                "file_count": 0,
                "extensions": [],
                "size_bytes": 0
            }

            for file_path in tenant_dir.iterdir():
                if file_path.is_file():
                    file_ext = None
                    # Handle special case for .gcode.3mf files
                    if file_path.name.endswith('.gcode.3mf'):
                        file_ext = '.gcode.3mf'
                    else:
                        file_ext = file_path.suffix.lower()

                    if file_ext in supported_extensions:
                        file_size = file_path.stat().st_size

                        # Update totals
                        files_info["total_files"] += 1
                        files_info["total_size_bytes"] += file_size

                        # Update by extension
                        files_info["by_extension"][file_ext]["count"] += 1
                        files_info["by_extension"][file_ext]["size_bytes"] += file_size

                        # Update tenant info
                        tenant_info["file_count"] += 1
                        tenant_info["size_bytes"] += file_size
                        if file_ext not in tenant_info["extensions"]:
                            tenant_info["extensions"].append(file_ext)

                        # Calculate checksum if validation requested
                        if validate_files:
                            hasher = hashlib.sha256()
                            with open(file_path, 'rb') as f:
                                for chunk in iter(lambda: f.read(4096), b""):
                                    hasher.update(chunk)
                            files_info["file_checksums"][file_path.name] = f"sha256:{hasher.hexdigest()}"

            if tenant_info["file_count"] > 0:
                files_info["by_tenant"][tenant_id] = tenant_info

    # Clean up empty extension entries
    files_info["by_extension"] = {
        ext: info for ext, info in files_info["by_extension"].items()
        if info["count"] > 0
    }

    return files_info

@router.get("/database/backup/download")
async def download_database_backup(
    compress: bool = True,
    include_metadata: bool = True,
    include_files: bool = True,
    validate_files: bool = True,
    tenant_name: Optional[str] = None
):
    """
    Download a complete backup of the SQLite database and print files

    Args:
        compress: Whether to compress the backup with gzip (default: True)
        include_metadata: Include metadata about the backup (default: True)
        include_files: Include all print files in backup (default: True)
        validate_files: Validate file integrity and cross-reference with database (default: True)
        tenant_name: Optional tenant/company name to include in filename

    Returns:
        The complete backup archive for download
    """
    try:
        # Get the database path
        db_path = Path(db_service.database_path)

        if not db_path.exists():
            raise HTTPException(status_code=404, detail="Database file not found")

        # Create timestamp for filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # Create temporary directory for backup
        temp_dir = tempfile.mkdtemp()

        try:
            # Create backup directory structure
            backup_root = Path(temp_dir) / "backup_contents"
            backup_root.mkdir(exist_ok=True)

            db_backup_dir = backup_root / "database"
            db_backup_dir.mkdir(exist_ok=True)

            # Files directory paths
            files_source_path = Path("/home/pi/PrintFarmSoftware/files")
            files_backup_dir = backup_root / "files" if include_files else None

            # Initialize metadata structure
            metadata = {}
            files_info = {}

            # Gather database metadata
            if include_metadata:
                async with db_service.async_session() as session:
                    # Get table counts
                    table_counts = {}
                    tables = [
                        'printers', 'color_presets', 'sync_logs', 'products',
                        'product_skus', 'print_files', 'print_jobs',
                        'finished_goods'
                    ]

                    for table in tables:
                        result = await session.execute(text(f"SELECT COUNT(*) FROM {table}"))
                        count = result.scalar()
                        table_counts[table] = count

                    metadata = {
                        "backup_timestamp": timestamp,
                        "backup_date": datetime.now().isoformat(),
                        "database_info": {
                            "size_bytes": db_path.stat().st_size,
                            "table_counts": table_counts
                        },
                        "software_version": "1.0.0",
                        "backup_type": "complete" if include_files else "database_only"
                    }

            # Copy and compress database
            if compress:
                db_backup_filename = "tenant.db.gz"
                db_backup_path = db_backup_dir / db_backup_filename

                with open(db_path, 'rb') as f_in:
                    with gzip.open(db_backup_path, 'wb') as f_out:
                        shutil.copyfileobj(f_in, f_out)
            else:
                db_backup_filename = "tenant.db"
                db_backup_path = db_backup_dir / db_backup_filename
                shutil.copy2(db_path, db_backup_path)

            # Process files if requested
            if include_files and files_source_path.exists():
                logger.info("Including print files in backup...")
                files_backup_dir.mkdir(exist_ok=True)

                # Supported file extensions
                supported_extensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf', '.g', '.gcode.3mf']

                # Copy entire files directory structure
                if files_source_path.exists():
                    shutil.copytree(files_source_path, files_backup_dir, dirs_exist_ok=True)

                # Gather files metadata if requested
                if include_metadata:
                    files_info = await _gather_files_metadata(
                        files_backup_dir / "print_files",
                        supported_extensions,
                        validate_files
                    )
                    metadata["files_info"] = files_info

            elif include_files:
                logger.warning("Files directory not found, creating database-only backup")
                metadata["backup_type"] = "database_only"
                metadata["files_info"] = {
                    "total_files": 0,
                    "total_size_bytes": 0,
                    "message": "Files directory not found"
                }

            # Save metadata
            if include_metadata:
                metadata_path = backup_root / "metadata.json"
                with open(metadata_path, 'w') as f:
                    json.dump(metadata, f, indent=2)

            # For now, let's simplify and return a basic tar without compression issues
            # Create final archive
            # Use tenant name in filename if provided, otherwise use default
            if tenant_name:
                # Sanitize tenant name for filename (replace spaces with dashes, remove special chars)
                safe_tenant_name = tenant_name.replace(" ", "-").replace("/", "-").replace("\\", "-")
                archive_filename = f"{safe_tenant_name}-backup-{timestamp}.tar"
            else:
                archive_filename = f"printfarm_backup_{timestamp}.tar"
            archive_path = Path(temp_dir) / archive_filename

            # Create archive with tarfile
            with tarfile.open(archive_path, 'w') as tar:
                # Add all contents with proper structure
                for item in backup_root.iterdir():
                    tar.add(item, arcname=item.name)

            logger.info(f"Created backup archive: {archive_path} ({archive_path.stat().st_size} bytes)")

            # Determine media type and filename
            media_type = "application/x-tar"

            return FileResponse(
                path=str(archive_path),
                media_type=media_type,
                filename=archive_filename,
                headers={
                    "Content-Disposition": f"attachment; filename={archive_filename}"
                }
            )

        except Exception as e:
            # Clean up temp directory on error
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise e

    except Exception as e:
        logger.error(f"Error creating database backup: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create backup: {str(e)}")


@router.post("/database/backup/restore")
async def restore_database_backup(
    backup_file: UploadFile = File(...),
    create_backup_before_restore: bool = True,
    background_tasks: BackgroundTasks = None
):
    """
    Restore the database from an uploaded backup file

    Args:
        backup_file: The backup file to restore from
        create_backup_before_restore: Create a backup of current database before restoring

    Returns:
        Success status and restore details
    """
    try:
        # Validate file extension
        filename = backup_file.filename.lower()
        is_compressed = filename.endswith('.gz') or filename.endswith('.tar')
        is_database = filename.endswith('.db') or filename.endswith('.sqlite')

        if not (is_compressed or is_database):
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Please upload a .db, .db.gz, or .tar backup file"
            )

        # Create temporary directory for processing
        temp_dir = tempfile.mkdtemp()

        try:
            # Save uploaded file
            temp_upload_path = Path(temp_dir) / backup_file.filename

            async with aiofiles.open(temp_upload_path, 'wb') as f:
                content = await backup_file.read()
                await f.write(content)

            # Process the uploaded file based on type
            restored_db_path = None
            restored_files_path = None
            metadata = None
            backup_format = "unknown"

            if filename.endswith('.tar'):
                # Extract tar archive
                with tarfile.open(temp_upload_path, 'r') as tar:
                    tar.extractall(temp_dir)

                # Detect backup format (new vs old)
                extracted_items = list(Path(temp_dir).iterdir())

                # Check for new format (database/ and files/ directories)
                has_database_dir = any(item.name == "database" and item.is_dir() for item in extracted_items)
                has_files_dir = any(item.name == "files" and item.is_dir() for item in extracted_items)
                has_metadata_json = any(item.name == "metadata.json" for item in extracted_items)

                if has_database_dir and has_metadata_json:
                    backup_format = "complete"
                    logger.info("Detected new complete backup format with structured directories")

                    # Find database file in database/ directory
                    db_dir = Path(temp_dir) / "database"
                    for db_file in db_dir.iterdir():
                        if db_file.name.endswith('.db.gz'):
                            # Decompress the database
                            decompressed_path = db_file.with_suffix('')
                            with gzip.open(db_file, 'rb') as f_in:
                                with open(decompressed_path, 'wb') as f_out:
                                    shutil.copyfileobj(f_in, f_out)
                            restored_db_path = decompressed_path
                            break
                        elif db_file.name.endswith('.db'):
                            restored_db_path = db_file
                            break

                    # Get files directory if present
                    if has_files_dir:
                        restored_files_path = Path(temp_dir) / "files"

                    # Load metadata
                    metadata_file = Path(temp_dir) / "metadata.json"
                    if metadata_file.exists():
                        with open(metadata_file, 'r') as f:
                            metadata = json.load(f)

                else:
                    # Old format - look for .db.gz and .json files directly
                    backup_format = "legacy"
                    logger.info("Detected legacy backup format")

                    for file in extracted_items:
                        if file.name.endswith('.db.gz'):
                            # Decompress the database
                            decompressed_path = file.with_suffix('')
                            with gzip.open(file, 'rb') as f_in:
                                with open(decompressed_path, 'wb') as f_out:
                                    shutil.copyfileobj(f_in, f_out)
                            restored_db_path = decompressed_path
                        elif file.name.endswith('.json'):
                            with open(file, 'r') as f:
                                metadata = json.load(f)

            elif filename.endswith('.gz'):
                # Decompress gzip file
                decompressed_path = temp_upload_path.with_suffix('')
                with gzip.open(temp_upload_path, 'rb') as f_in:
                    with open(decompressed_path, 'wb') as f_out:
                        shutil.copyfileobj(f_in, f_out)
                restored_db_path = decompressed_path

            else:
                # Direct database file
                restored_db_path = temp_upload_path

            # Validate that it's a valid SQLite database
            try:
                conn = sqlite3.connect(restored_db_path)
                cursor = conn.cursor()

                # Check if required tables exist
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
                tables = [row[0] for row in cursor.fetchall()]

                required_tables = {
                    'printers', 'products', 'product_skus',
                    'print_files', 'print_jobs'
                }

                missing_tables = required_tables - set(tables)
                if missing_tables:
                    conn.close()
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid backup file. Missing tables: {missing_tables}"
                    )

                # Get table counts for validation
                table_counts = {}
                for table in tables:
                    cursor.execute(f"SELECT COUNT(*) FROM {table}")
                    table_counts[table] = cursor.fetchone()[0]

                conn.close()

            except sqlite3.Error as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid SQLite database file: {str(e)}"
                )

            # Create backup of current state if requested
            backup_created = None
            files_backup_created = None

            if create_backup_before_restore:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                current_db_path = Path(db_service.database_path)
                current_files_path = Path("/home/pi/PrintFarmSoftware/files")

                # Backup database
                if current_db_path.exists():
                    backup_dir = current_db_path.parent / "backups"
                    backup_dir.mkdir(exist_ok=True)

                    backup_name = f"pre_restore_backup_{timestamp}.db"
                    backup_path = backup_dir / backup_name

                    shutil.copy2(current_db_path, backup_path)
                    backup_created = str(backup_path)
                    logger.info(f"Created pre-restore database backup at: {backup_path}")

                # Backup files directory if it exists and we're restoring files
                if current_files_path.exists() and restored_files_path:
                    files_backup_name = f"pre_restore_files_{timestamp}"
                    files_backup_path = backup_dir / files_backup_name

                    shutil.copytree(current_files_path, files_backup_path, dirs_exist_ok=True)
                    files_backup_created = str(files_backup_path)
                    logger.info(f"Created pre-restore files backup at: {files_backup_path}")

            # Close all database connections
            await db_service.engine.dispose()

            # Replace the current database with the restored one
            current_db_path = Path(db_service.database_path)
            shutil.copy2(restored_db_path, current_db_path)
            logger.info(f"Database restored from: {restored_db_path}")

            # Restore files if present in backup
            if restored_files_path and restored_files_path.exists():
                current_files_path = Path("/home/pi/PrintFarmSoftware/files")

                # Remove existing files directory
                if current_files_path.exists():
                    shutil.rmtree(current_files_path)
                    logger.info("Removed existing files directory")

                # Copy restored files
                shutil.copytree(restored_files_path, current_files_path, dirs_exist_ok=True)

                # Fix file permissions (ensure pi:pi ownership)
                import os
                import pwd
                import grp
                try:
                    pi_uid = pwd.getpwnam('pi').pw_uid
                    pi_gid = grp.getgrnam('pi').gr_gid

                    for root, dirs, files in os.walk(current_files_path):
                        os.chown(root, pi_uid, pi_gid)
                        for d in dirs:
                            os.chown(os.path.join(root, d), pi_uid, pi_gid)
                        for f in files:
                            os.chown(os.path.join(root, f), pi_uid, pi_gid)

                    logger.info("Fixed file permissions for restored files")
                except Exception as perm_error:
                    logger.warning(f"Could not fix file permissions: {perm_error}")

                logger.info(f"Files restored from: {restored_files_path}")

            # Reinitialize the database connection
            await db_service.initialize_database()

            # Verify the restoration
            async with db_service.async_session() as session:
                # Check that we can query the database
                result = await session.execute(text("SELECT COUNT(*) FROM products"))
                product_count = result.scalar()

            # Count restored files for response
            restored_files_count = 0
            if restored_files_path and restored_files_path.exists():
                for root, dirs, files in os.walk(restored_files_path):
                    restored_files_count += len(files)

            # Prepare response
            restore_type = "complete" if restored_files_path else "database_only"
            message = f"{'Complete system' if restored_files_path else 'Database'} restored successfully"

            response_data = {
                "success": True,
                "message": message,
                "details": {
                    "backup_format": backup_format,
                    "restore_type": restore_type,
                    "restored_tables": list(tables),
                    "table_counts": table_counts,
                    "database_backup_created": backup_created,
                    "files_backup_created": files_backup_created,
                    "restored_files_count": restored_files_count,
                    "restored_from": backup_file.filename,
                    "restoration_timestamp": datetime.now().isoformat()
                }
            }

            if metadata:
                response_data["details"]["original_backup_metadata"] = metadata

            return JSONResponse(content=response_data)

        finally:
            # Clean up temporary directory
            shutil.rmtree(temp_dir, ignore_errors=True)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error restoring database: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to restore database: {str(e)}")


@router.get("/database/backup/info")
async def get_database_info():
    """
    Get information about the current database

    Returns:
        Database statistics and information
    """
    try:
        db_path = Path(db_service.database_path)

        if not db_path.exists():
            raise HTTPException(status_code=404, detail="Database file not found")

        async with db_service.async_session() as session:
            # Get table information
            tables_info = {}
            tables = [
                'printers', 'color_presets', 'sync_logs', 'products',
                'product_skus', 'print_files', 'print_jobs',
                'finished_goods'
            ]

            total_records = 0
            for table in tables:
                try:
                    result = await session.execute(text(f"SELECT COUNT(*) FROM {table}"))
                    count = result.scalar()
                    tables_info[table] = count
                    total_records += count
                except Exception as e:
                    tables_info[table] = f"Error: {str(e)}"

            # Get database file info
            db_stats = db_path.stat()

            return {
                "database_path": str(db_path),
                "database_size_bytes": db_stats.st_size,
                "database_size_mb": round(db_stats.st_size / (1024 * 1024), 2),
                "last_modified": datetime.fromtimestamp(db_stats.st_mtime).isoformat(),
                "tables": tables_info,
                "total_records": total_records,
                "backup_directory": str(db_path.parent / "backups"),
                "database_type": "SQLite",
                "version": sqlite3.version
            }

    except Exception as e:
        logger.error(f"Error getting database info: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get database info: {str(e)}")


@router.delete("/database/backup/clear")
async def clear_database(
    create_backup: bool = True,
    confirm: str = None
):
    """
    Clear all data from the database (dangerous operation)

    Args:
        create_backup: Create a backup before clearing (default: True)
        confirm: Must be set to "CLEAR_ALL_DATA" to confirm the operation

    Returns:
        Status of the clear operation
    """
    try:
        if confirm != "CLEAR_ALL_DATA":
            raise HTTPException(
                status_code=400,
                detail="Please confirm this dangerous operation by setting confirm='CLEAR_ALL_DATA'"
            )

        # Create backup if requested
        backup_created = None
        if create_backup:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            current_db_path = Path(db_service.database_path)

            if current_db_path.exists():
                backup_dir = current_db_path.parent / "backups"
                backup_dir.mkdir(exist_ok=True)

                backup_name = f"pre_clear_backup_{timestamp}.db"
                backup_path = backup_dir / backup_name

                shutil.copy2(current_db_path, backup_path)
                backup_created = str(backup_path)
                logger.info(f"Created pre-clear backup at: {backup_path}")

        # Clear all tables
        async with db_service.async_session() as session:
            tables = [
                'print_jobs', 'finished_goods', 'product_skus', 'print_files',
                'products', 'printers', 'color_presets', 'sync_logs'
            ]

            cleared_counts = {}

            for table in tables:
                # Get count before clearing
                result = await session.execute(text(f"SELECT COUNT(*) FROM {table}"))
                count_before = result.scalar()

                # Clear the table
                await session.execute(text(f"DELETE FROM {table}"))

                cleared_counts[table] = count_before

            await session.commit()

        return {
            "success": True,
            "message": "Database cleared successfully",
            "backup_created": backup_created,
            "cleared_tables": cleared_counts,
            "timestamp": datetime.now().isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error clearing database: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear database: {str(e)}")