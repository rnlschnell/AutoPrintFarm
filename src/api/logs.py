from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import logging
import os
import zipfile
import tempfile
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import io

logger = logging.getLogger(__name__)
router = APIRouter(tags=["System Logs"])

@router.get("/download", response_class=StreamingResponse)
async def download_logs(tenant_name: Optional[str] = None):
    """
    Download all system logs as a ZIP archive.
    Restricted to admin users only.

    Args:
        tenant_name: Optional tenant/company name to include in filename
    """
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # Use tenant name in filename if provided, otherwise use default
        if tenant_name:
            # Sanitize tenant name for filename (replace spaces with dashes, remove special chars)
            safe_tenant_name = tenant_name.replace(" ", "-").replace("/", "-").replace("\\", "-")
            zip_filename = f"{safe_tenant_name}-logs-{timestamp}.zip"
        else:
            zip_filename = f"printfarm-logs-{timestamp}.zip"

        # Create in-memory ZIP file
        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # Add application log files
            logs_dir = Path("/home/pi/PrintFarmSoftware/logs")
            if logs_dir.exists():
                for log_file in logs_dir.glob("*.log*"):
                    if log_file.is_file():
                        arc_name = f"application-logs/{log_file.name}"
                        try:
                            zip_file.write(log_file, arc_name)
                            logger.debug(f"Added {log_file.name} to archive")
                        except Exception as e:
                            logger.warning(f"Could not add {log_file.name}: {e}")

            # Add output.log if it exists
            output_log = Path("/home/pi/PrintFarmSoftware/output.log")
            if output_log.exists():
                try:
                    zip_file.write(output_log, "application-logs/output.log")
                    logger.debug("Added output.log to archive")
                except Exception as e:
                    logger.warning(f"Could not add output.log: {e}")

            # Add first boot logs if they exist
            first_boot_log = Path("/home/pi/PrintFarmSoftware/logs/first-boot.log")
            if first_boot_log.exists():
                try:
                    zip_file.write(first_boot_log, "First Boot Logs/first-boot.log")
                    logger.debug("Added first-boot.log to archive")
                except Exception as e:
                    logger.warning(f"Could not add first-boot.log: {e}")

            # Export systemd journal logs
            try:
                # Get logs from last 7 days
                since_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
                journal_cmd = [
                    "journalctl",
                    "-u", "bambu-program",
                    "--since", since_date,
                    "--no-pager"
                ]

                result = subprocess.run(
                    journal_cmd,
                    capture_output=True,
                    text=True,
                    timeout=30
                )

                if result.returncode == 0 and result.stdout:
                    zip_file.writestr(
                        "system-logs/journalctl-bambu-program.log",
                        result.stdout
                    )
                    logger.debug("Added systemd journal logs to archive")
                else:
                    logger.warning(f"Could not export journal logs: {result.stderr}")
            except subprocess.TimeoutExpired:
                logger.warning("Journal export timed out")
            except Exception as e:
                logger.warning(f"Could not export journal logs: {e}")

            # Add system information
            try:
                system_info = []
                system_info.append(f"Log Archive Generated: {datetime.now().isoformat()}")
                system_info.append(f"System: Raspberry Pi PrintFarm Software")
                system_info.append("")

                # Get disk usage
                try:
                    df_result = subprocess.run(
                        ["df", "-h", "/"],
                        capture_output=True,
                        text=True,
                        timeout=5
                    )
                    if df_result.returncode == 0:
                        system_info.append("Disk Usage:")
                        system_info.append(df_result.stdout)
                        system_info.append("")
                except Exception:
                    pass

                # Get memory info
                try:
                    free_result = subprocess.run(
                        ["free", "-h"],
                        capture_output=True,
                        text=True,
                        timeout=5
                    )
                    if free_result.returncode == 0:
                        system_info.append("Memory Usage:")
                        system_info.append(free_result.stdout)
                        system_info.append("")
                except Exception:
                    pass

                # Get service status
                try:
                    status_result = subprocess.run(
                        ["systemctl", "status", "bambu-program", "--no-pager", "-n", "20"],
                        capture_output=True,
                        text=True,
                        timeout=5
                    )
                    if status_result.returncode in [0, 3]:  # 3 = inactive
                        system_info.append("Service Status:")
                        system_info.append(status_result.stdout)
                        system_info.append("")
                except Exception:
                    pass

                # Get uptime
                try:
                    uptime_result = subprocess.run(
                        ["uptime"],
                        capture_output=True,
                        text=True,
                        timeout=5
                    )
                    if uptime_result.returncode == 0:
                        system_info.append(f"System Uptime: {uptime_result.stdout.strip()}")
                        system_info.append("")
                except Exception:
                    pass

                # Write system info to archive
                zip_file.writestr(
                    "system-info.txt",
                    "\n".join(system_info)
                )
                logger.debug("Added system info to archive")
            except Exception as e:
                logger.warning(f"Could not generate system info: {e}")

        # Reset buffer position
        zip_buffer.seek(0)

        # Check size limit (100MB)
        zip_size = zip_buffer.getbuffer().nbytes
        if zip_size > 100 * 1024 * 1024:  # 100MB
            raise HTTPException(
                status_code=413,
                detail="Log archive exceeds maximum size limit (100MB)"
            )

        logger.info(f"Log archive created: {zip_filename} ({zip_size / 1024 / 1024:.2f}MB)")

        # Return as streaming response
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={zip_filename}",
                "Content-Length": str(zip_size)
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create log archive: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create log archive: {str(e)}"
        )

@router.get("/status")
async def get_logs_status():
    """
    Get current logs status and statistics.
    Restricted to admin users only.
    """
    try:
        stats = {
            "total_size": 0,
            "file_count": 0,
            "oldest_entry": None,
            "newest_entry": None,
            "files": []
        }

        # Check application logs
        logs_dir = Path("/home/pi/PrintFarmSoftware/logs")
        if logs_dir.exists():
            for log_file in logs_dir.glob("*.log*"):
                if log_file.is_file():
                    file_stat = log_file.stat()
                    stats["files"].append({
                        "name": log_file.name,
                        "size": file_stat.st_size,
                        "modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat()
                    })
                    stats["total_size"] += file_stat.st_size
                    stats["file_count"] += 1

                    # Track oldest and newest
                    mod_time = datetime.fromtimestamp(file_stat.st_mtime)
                    if not stats["oldest_entry"] or mod_time < datetime.fromisoformat(stats["oldest_entry"]):
                        stats["oldest_entry"] = mod_time.isoformat()
                    if not stats["newest_entry"] or mod_time > datetime.fromisoformat(stats["newest_entry"]):
                        stats["newest_entry"] = mod_time.isoformat()

        # Check output.log
        output_log = Path("/home/pi/PrintFarmSoftware/output.log")
        if output_log.exists():
            file_stat = output_log.stat()
            stats["files"].append({
                "name": "output.log",
                "size": file_stat.st_size,
                "modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat()
            })
            stats["total_size"] += file_stat.st_size
            stats["file_count"] += 1

        # Check first boot log
        first_boot_log = Path("/home/pi/PrintFarmSoftware/logs/first-boot.log")
        if first_boot_log.exists():
            file_stat = first_boot_log.stat()
            stats["files"].append({
                "name": "first-boot.log",
                "size": file_stat.st_size,
                "modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat()
            })
            stats["total_size"] += file_stat.st_size
            stats["file_count"] += 1

            # Track oldest and newest
            mod_time = datetime.fromtimestamp(file_stat.st_mtime)
            if not stats["oldest_entry"] or mod_time < datetime.fromisoformat(stats["oldest_entry"]):
                stats["oldest_entry"] = mod_time.isoformat()
            if not stats["newest_entry"] or mod_time > datetime.fromisoformat(stats["newest_entry"]):
                stats["newest_entry"] = mod_time.isoformat()

        # Format size for display
        stats["total_size_mb"] = round(stats["total_size"] / (1024 * 1024), 2)

        return {
            "success": True,
            "stats": stats
        }

    except Exception as e:
        logger.error(f"Failed to get logs status: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get logs status: {str(e)}"
        )