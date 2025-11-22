import logging
import sys
import subprocess
import socket
from pathlib import Path
from logging.handlers import RotatingFileHandler
from datetime import datetime

def setup_logging(log_level: str = "INFO") -> None:
    """Setup comprehensive logging for the application"""
    
    # Create logs directory if it doesn't exist
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper()))
    
    # Clear any existing handlers
    root_logger.handlers.clear()
    
    # Create formatter
    formatter = logging.Formatter(
        fmt="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # File handler for all logs
    file_handler = RotatingFileHandler(
        filename=log_dir / "bambu-program.log",
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)
    
    # Error-only file handler
    error_handler = RotatingFileHandler(
        filename=log_dir / "errors.log",
        maxBytes=5 * 1024 * 1024,  # 5MB
        backupCount=3
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(formatter)
    root_logger.addHandler(error_handler)
    
    # Set specific logger levels
    logging.getLogger("uvicorn").setLevel(logging.INFO)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("fastapi").setLevel(logging.INFO)
    
    # Setup first boot logging if needed
    setup_first_boot_logging()

    logging.info("Logging system initialized")


def setup_first_boot_logging() -> None:
    """Setup special logging for first boot events"""
    try:
        # Use persistent marker in data directory
        data_dir = Path("data")
        data_dir.mkdir(exist_ok=True)
        first_boot_marker = data_dir / "first_boot_completed"

        if not first_boot_marker.exists():
            # Create dedicated first boot log file (never rotated)
            first_boot_log = Path("logs") / "first-boot.log"

            # Create formatter for first boot logs
            formatter = logging.Formatter(
                fmt="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S"
            )

            # Set up special handler for first boot (no rotation)
            first_boot_handler = logging.FileHandler(first_boot_log)
            first_boot_handler.setFormatter(formatter)

            # Create a special logger for first boot
            first_boot_logger = logging.getLogger("first_boot")
            first_boot_logger.addHandler(first_boot_handler)
            first_boot_logger.setLevel(logging.INFO)

            # Log comprehensive first boot information
            first_boot_logger.info("=" * 80)
            first_boot_logger.info("FIRST BOOT DETECTED - PrintFarm Software Initialization")
            first_boot_logger.info("=" * 80)
            first_boot_logger.info(f"Boot timestamp: {datetime.now().isoformat()}")

            # Log system information
            try:
                # Get hostname
                hostname = socket.gethostname()
                first_boot_logger.info(f"Hostname: {hostname}")

                # Get system uptime
                uptime_result = subprocess.run(
                    ["uptime"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if uptime_result.returncode == 0:
                    first_boot_logger.info(f"System uptime: {uptime_result.stdout.strip()}")

                # Get disk usage
                df_result = subprocess.run(
                    ["df", "-h", "/"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if df_result.returncode == 0:
                    first_boot_logger.info("Disk usage at first boot:")
                    for line in df_result.stdout.strip().split('\n'):
                        first_boot_logger.info(f"  {line}")

                # Get memory info
                free_result = subprocess.run(
                    ["free", "-h"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if free_result.returncode == 0:
                    first_boot_logger.info("Memory usage at first boot:")
                    for line in free_result.stdout.strip().split('\n'):
                        first_boot_logger.info(f"  {line}")

                # Get network configuration
                ip_result = subprocess.run(
                    ["ip", "addr", "show"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if ip_result.returncode == 0:
                    first_boot_logger.info("Network configuration at first boot:")
                    # Only log relevant interfaces (skip loopback details)
                    lines = ip_result.stdout.strip().split('\n')
                    for line in lines:
                        if 'inet ' in line or ': <' in line:
                            first_boot_logger.info(f"  {line.strip()}")

            except Exception as e:
                first_boot_logger.warning(f"Could not capture system information: {e}")

            # Log environment variables (safe ones only)
            try:
                import os
                safe_env_vars = ['PATH', 'HOME', 'USER', 'PWD', 'SHELL']
                first_boot_logger.info("Environment variables:")
                for var in safe_env_vars:
                    value = os.environ.get(var, 'Not set')
                    first_boot_logger.info(f"  {var}={value}")
            except Exception as e:
                first_boot_logger.warning(f"Could not capture environment variables: {e}")

            first_boot_logger.info("First boot logging setup completed")
            first_boot_logger.info("=" * 80)

            # Clean up the handler
            first_boot_handler.close()
            first_boot_logger.removeHandler(first_boot_handler)

            # Mark first boot as completed
            first_boot_marker.touch()

            # Log to main logger that first boot was detected
            logging.info("First boot detected - comprehensive first boot log created")

    except Exception as e:
        # If first boot logging fails, don't crash the application
        logging.warning(f"Failed to setup first boot logging: {e}")