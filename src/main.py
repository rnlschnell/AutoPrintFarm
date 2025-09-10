import sys
import os
# Add the project root to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import asyncio
import logging
from pathlib import Path
from src.core.config import load_config, load_printers_config
from src.core.logger import setup_logging
from src.core.printer_client import printer_manager
from src.utils.exceptions import BambuProgramError, PrinterNotFoundError, PrinterConnectionError, ValidationError

# Import all API routers
from src.api import printers, print_control, movement, temperature, filament, maintenance, files, camera, system, websocket, object_manipulation, sync, auth, color_presets, products_sync, product_skus_sync, print_files_sync, print_jobs_sync, file_operations, available_files, enhanced_print_jobs, connection_status, printers_sync

# Import sync services
from src.services.config_service import get_config_service
from src.services.database_service import get_database_service, close_database_service
from src.services.sync_service import initialize_sync_service, shutdown_sync_service
from src.services.auth_service import initialize_auth_service
from src.services.printer_connection_service import initialize_printer_connection_service, shutdown_printer_connection_service
from src.services.startup_service import startup_service
from src.services.live_job_sync_service import live_job_sync_service
from src.services.backup_service import initialize_backup_service, get_backup_service

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Startup
    try:
        logger.info("Starting Bambu Program API...")
        
        # Initialize configuration service
        config_service = get_config_service()
        logger.info("Configuration service initialized")
        
        # Initialize auth service
        supabase_config = config_service.get_supabase_config()
        supabase_url = supabase_config.get('url', '')
        supabase_key = supabase_config.get('anon_key', '')
        
        if supabase_url and supabase_key:
            auth_service = initialize_auth_service(supabase_url, supabase_key)
            logger.info("Auth service initialized")
        else:
            logger.warning("Supabase configuration incomplete, auth service not started")
        
        # Initialize database service
        db_service = await get_database_service()
        logger.info("Database service initialized")
        
        # Initialize startup service (job queue and resource monitoring)
        try:
            await startup_service.startup()
            logger.info("Resource management and job queue services started")
        except Exception as e:
            logger.error(f"Failed to start resource management services: {e}")
            # Continue startup even if resource management fails
        
        # Initialize sync service if tenant is configured
        tenant_config = config_service.get_tenant_config()
        supabase_config = config_service.get_supabase_config()
        sync_config = config_service.get_sync_config()
        
        tenant_id = tenant_config.get('id', '').strip()
        if tenant_id and sync_config.get('enabled', True):
            try:
                supabase_url = supabase_config.get('url', '')
                supabase_key = supabase_config.get('anon_key', '')
                
                if supabase_url and supabase_key:
                    await initialize_sync_service(tenant_id, supabase_url, supabase_key)
                    logger.info(f"Sync service initialized for tenant {tenant_id}")
                else:
                    logger.warning("Supabase configuration incomplete, sync service not started")
            except Exception as e:
                logger.error(f"Failed to initialize sync service: {e}")
                # Continue startup even if sync fails
        else:
            logger.info("Tenant not configured or sync disabled, sync service not started")
        
        # Initialize backup service if tenant is configured
        if tenant_id and supabase_url and supabase_key:
            try:
                backup_service = await initialize_backup_service(tenant_id, supabase_url, supabase_key)
                await backup_service.start()
                logger.info(f"Backup service initialized and started for tenant {tenant_id}")
            except Exception as e:
                logger.error(f"Failed to initialize backup service: {e}")
                # Continue startup even if backup fails
        
        # Initialize printer connection service if tenant is configured
        if tenant_id:
            try:
                await initialize_printer_connection_service(tenant_id)
                logger.info(f"Printer connection service initialized for tenant {tenant_id}")
                
                # The printer connection service automatically syncs and connects printers
                # from the database during initialization
                
            except Exception as e:
                logger.error(f"Failed to initialize printer connection service: {e}")
                # Continue startup even if printer connection fails
        else:
            # Fallback to YAML configuration if no tenant configured
            logger.info("No tenant configured, falling back to YAML printer configuration")
            try:
                printers_config = load_printers_config()
                for printer_config in printers_config.get("printers", []):
                    printer_manager.add_printer(printer_config["id"], printer_config)
                logger.info(f"Loaded {len(printers_config.get('printers', []))} printer configurations from YAML")
                
                # Auto-connect all configured printers
                connected_count = 0
                for printer_config in printers_config.get("printers", []):
                    try:
                        await printer_manager.connect_printer(printer_config["id"])
                        connected_count += 1
                        logger.info(f"Auto-connected to printer: {printer_config['id']}")
                    except Exception as e:
                        logger.warning(f"Failed to auto-connect to printer {printer_config['id']}: {e}")
                
                logger.info(f"Auto-connected to {connected_count} out of {len(printers_config.get('printers', []))} printers")
                
            except FileNotFoundError:
                logger.warning("No printers configuration file found, starting with empty configuration")
        
        # Start live job sync service
        try:
            await live_job_sync_service.start()
            logger.info("Live job sync service started")
        except Exception as e:
            logger.error(f"Failed to start live job sync service: {e}")
            # Continue startup even if sync service fails
        
        logger.info("Bambu Program API started successfully")
        
    except Exception as e:
        logger.error(f"Failed to start application: {e}")
        raise
    
    yield
    
    # Shutdown
    try:
        logger.info("Shutting down Bambu Program API...")
        
        # Shutdown live job sync service
        try:
            await live_job_sync_service.stop()
            logger.info("Live job sync service shutdown complete")
        except Exception as e:
            logger.error(f"Error shutting down live job sync service: {e}")
        
        # Shutdown printer connection service
        try:
            await shutdown_printer_connection_service()
            logger.info("Printer connection service shutdown complete")
        except Exception as e:
            logger.error(f"Error shutting down printer connection service: {e}")
        
        # Shutdown backup service
        try:
            backup_service = get_backup_service()
            if backup_service:
                await backup_service.stop()
                logger.info("Backup service shutdown complete")
        except Exception as e:
            logger.error(f"Error shutting down backup service: {e}")
        
        # Shutdown sync service
        try:
            await shutdown_sync_service()
            logger.info("Sync service shutdown complete")
        except Exception as e:
            logger.error(f"Error shutting down sync service: {e}")
        
        # Shutdown startup service (job queue and resource monitoring)
        try:
            await startup_service.shutdown()
            logger.info("Resource management and job queue services stopped")
        except Exception as e:
            logger.error(f"Error shutting down resource management services: {e}")
        
        # Close database service
        try:
            await close_database_service()
            logger.info("Database service closed")
        except Exception as e:
            logger.error(f"Error closing database service: {e}")
        
        # Disable auto-reconnect and disconnect all printers
        printer_manager.auto_reconnect_enabled = False
        
        # Cancel all reconnection tasks
        for printer_id, task in list(printer_manager.reconnect_tasks.items()):
            try:
                task.cancel()
                await task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.error(f"Error cancelling reconnection task for {printer_id}: {e}")
        
        # Disconnect all printers
        for printer_id in list(printer_manager.clients.keys()):
            try:
                printer_manager.disconnect_printer(printer_id)
                logger.info(f"Disconnected from printer {printer_id}")
            except Exception as e:
                logger.error(f"Error disconnecting from printer {printer_id}: {e}")
        
        logger.info("Bambu Program API shutdown complete")
        
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")

# Create FastAPI app with lifespan
app = FastAPI(
    title="Bambu Program API",
    description="Complete Bambu Lab Printer Control API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global exception handler
@app.exception_handler(BambuProgramError)
async def bambu_program_exception_handler(request: Request, exc: BambuProgramError):
    """Handle custom application exceptions"""
    if isinstance(exc, PrinterNotFoundError):
        status_code = 404
    elif isinstance(exc, PrinterConnectionError):
        status_code = 503
    elif isinstance(exc, ValidationError):
        status_code = 400
    else:
        status_code = 500
    
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "message": str(exc),
            "error_code": exc.__class__.__name__,
            "timestamp": "2024-01-01T00:00:00Z"  # Will be properly set by response models
        }
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "message": exc.detail,
            "error_code": "HTTPException",
            "timestamp": "2024-01-01T00:00:00Z"
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions"""
    logger.error(f"Unexpected error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "message": "Internal server error",
            "error_code": "InternalServerError",
            "timestamp": "2024-01-01T00:00:00Z"
        }
    )

@app.get("/")
async def root():
    """Serve the React frontend or redirect to docs"""
    frontend_dist_path = Path("frontend/dist")
    if frontend_dist_path.exists():
        index_file = frontend_dist_path / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
    
    # Fallback to API docs if frontend not available
    return RedirectResponse(url="/docs")

@app.get("/health")
async def health_check():
    """System health check endpoint"""
    return {
        "status": "healthy", 
        "service": "bambu-program", 
        "version": "1.0.0",
        "printers_configured": len(printer_manager.printer_configs),
        "printers_connected": len(printer_manager.clients)
    }

@app.get("/api/printers/status-quick")
async def get_printers_quick_status():
    """Quick printer status check without WebSocket dependency"""
    try:
        printers_list = printer_manager.list_printers()
        
        # Only return legitimate printers (4 and 7) with their connection status
        status_data = []
        for printer in printers_list:
            printer_id = printer.get("id")
            if str(printer_id) in ["4", "7"]:  # Only legitimate printers
                status_data.append({
                    "printer_id": str(printer_id),
                    "name": printer.get("name", "Unknown"),
                    "model": printer.get("model", "Unknown"),
                    "connected": printer.get("connected", False),
                    "status": "idle" if printer.get("connected", False) else "offline"
                })
        
        return {
            "success": True,
            "printers": status_data
        }
    except Exception as e:
        logger.error(f"Error getting quick printer status: {e}")
        return {
            "success": False,
            "error": str(e),
            "printers": []
        }

# Include all API routers with /api/ prefix to avoid frontend route conflicts
app.include_router(printers.router, prefix="/api/printers", tags=["Printer Management"])
app.include_router(printers_sync.router, prefix="/api", tags=["Printers Sync Management"])
app.include_router(print_control.router, prefix="/api/printers", tags=["Print Control"])
app.include_router(movement.router, prefix="/api/printers", tags=["Movement Control"])
app.include_router(temperature.router, prefix="/api/printers", tags=["Temperature Control"])
app.include_router(filament.router, prefix="/api/printers", tags=["Filament Management"])
app.include_router(maintenance.router, prefix="/api/printers", tags=["Maintenance & Calibration"])
app.include_router(files.router, prefix="/api/printers", tags=["File Operations"])
app.include_router(camera.router, prefix="/api/printers", tags=["Camera Operations"])
app.include_router(system.router, prefix="/api/printers", tags=["System Commands"])

# Include WebSocket router for live status streaming
app.include_router(websocket.router, prefix="/api/v1", tags=["WebSocket Live Status"])

# Include 3MF Object Manipulation router
app.include_router(object_manipulation.router, prefix="/api/printers", tags=["3MF Object Manipulation"])

# Include Sync Management router
app.include_router(sync.router, prefix="/api/sync", tags=["Sync Management"])

# Include Authentication router
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])

# Include Color Presets router
app.include_router(color_presets.router, prefix="/api", tags=["Color Presets Management"])

# Include Realtime sync routers for new tables
app.include_router(products_sync.router, prefix="/api", tags=["Products Sync Management"])
app.include_router(product_skus_sync.router, prefix="/api", tags=["Product SKUs Sync Management"])
app.include_router(print_files_sync.router, prefix="/api", tags=["Print Files Sync Management"])
app.include_router(print_jobs_sync.router, prefix="/api", tags=["Print Jobs Sync Management"])

# Include File Operations router for local file management
app.include_router(file_operations.router, prefix="/api", tags=["File Operations"])

# Include Available Files router for enhanced print job creation
app.include_router(available_files.router, prefix="/api", tags=["Available Files"])

# Include Enhanced Print Jobs router for automated print job processing
app.include_router(enhanced_print_jobs.router, prefix="/api", tags=["Enhanced Print Jobs"])

# Include Connection Status router for monitoring system health
app.include_router(connection_status.router, prefix="/api", tags=["Connection Status"])

# Mount static files for frontend assets (CSS, JS, etc.)
frontend_dist_path = Path("frontend/dist")
if frontend_dist_path.exists():
    # Mount assets directory for static files like JS/CSS
    assets_path = frontend_dist_path / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_path)), name="assets")

# Catch-all route for React Router (must be last!)
@app.get("/{path:path}")
async def serve_frontend_routes(path: str):
    """Catch-all route for React Router"""
    frontend_dist_path = Path("frontend/dist")
    
    # Skip API routes - only /api/ prefix and system routes are reserved
    if path.startswith(("api/", "docs", "redoc", "health")):
        raise HTTPException(status_code=404, detail="API endpoint not found")
    
    if frontend_dist_path.exists():
        # Serve specific files if they exist (like favicon.ico, etc.)
        file_path = frontend_dist_path / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        
        # For all other routes, serve index.html (React Router will handle)
        index_file = frontend_dist_path / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
    
    return JSONResponse({"error": "Frontend not found"}, status_code=404)

if __name__ == "__main__":
    # Setup logging first
    setup_logging()
    
    # Load configuration
    try:
        config = load_config()
        
        # Detect if running in production/systemd (no reload)
        import os
        is_production = (
            os.environ.get("SYSTEMD_EXEC_PID") or 
            os.environ.get("INVOCATION_ID") or 
            os.environ.get("JOURNAL_STREAM")
        )
        
        # Run the application
        uvicorn.run(
            "main:app",
            host=config["server"]["host"],
            port=config["server"]["port"],
            reload=not is_production,  # Disable reload in production
            log_level="info"
        )
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        raise