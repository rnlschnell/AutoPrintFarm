from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
from enum import Enum

# Base Response Models
class BaseResponse(BaseModel):
    """Base response model"""
    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Response timestamp")

class ErrorResponse(BaseResponse):
    """Error response model"""
    success: bool = Field(default=False, description="Always false for errors")
    error_code: Optional[str] = Field(None, description="Error code")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional error details")

# Printer Management Response Models
class PrinterInfo(BaseModel):
    """Printer information model"""
    id: str = Field(..., description="Unique printer identifier")
    name: str = Field(..., description="Human-readable printer name")
    ip: str = Field(..., description="Printer IP address")
    serial: str = Field(..., description="Printer serial number")
    model: str = Field(..., description="Printer model")
    enabled: bool = Field(..., description="Whether the printer is enabled")
    connected: bool = Field(..., description="Whether the printer is currently connected")

class PrinterListResponse(BaseResponse):
    """Response model for listing printers"""
    printers: List[PrinterInfo] = Field(..., description="List of configured printers")
    total_count: int = Field(..., description="Total number of printers")

class PrinterCreateResponse(BaseResponse):
    """Response model for printer creation"""
    printer: PrinterInfo = Field(..., description="Created printer information")

class PrinterStatusResponse(BaseResponse):
    """Response model for printer status"""
    printer_id: str = Field(..., description="Printer identifier")
    status: Dict[str, Any] = Field(..., description="Current printer status")

# Print Control Response Models
class PrintJobStatus(str, Enum):
    """Print job status enumeration"""
    idle = "idle"
    printing = "printing"
    paused = "paused"
    stopped = "stopped"
    finished = "finished"
    failed = "failed"
    offline = "offline"

class PrintProgress(BaseModel):
    """Print progress information"""
    percentage: float = Field(..., ge=0, le=100, description="Print progress percentage")
    elapsed_time: int = Field(..., description="Elapsed time in seconds")
    remaining_time: Optional[int] = Field(None, description="Estimated remaining time in seconds")
    current_layer: Optional[int] = Field(None, description="Current layer number")
    total_layers: Optional[int] = Field(None, description="Total number of layers")

class PrintJobInfo(BaseModel):
    """Print job information"""
    job_id: Optional[str] = Field(None, description="Print job identifier")
    filename: Optional[str] = Field(None, description="Name of the file being printed")
    status: PrintJobStatus = Field(..., description="Current print job status")
    progress: Optional[PrintProgress] = Field(None, description="Print progress information")

class PrintControlResponse(BaseResponse):
    """Response model for print control operations"""
    printer_id: str = Field(..., description="Printer identifier")
    job_info: Optional[PrintJobInfo] = Field(None, description="Print job information")

# Temperature Response Models
class TemperatureInfo(BaseModel):
    """Temperature information"""
    current: float = Field(..., description="Current temperature")
    target: float = Field(..., description="Target temperature")
    is_heating: bool = Field(..., description="Whether actively heating")

class TemperatureStatus(BaseModel):
    """Complete temperature status"""
    nozzle: TemperatureInfo = Field(..., description="Nozzle temperature")
    bed: TemperatureInfo = Field(..., description="Bed temperature")
    chamber: Optional[TemperatureInfo] = Field(None, description="Chamber temperature")

class TemperatureResponse(BaseResponse):
    """Response model for temperature operations"""
    printer_id: str = Field(..., description="Printer identifier")
    temperatures: TemperatureStatus = Field(..., description="Temperature information")

# Movement Response Models
class PositionInfo(BaseModel):
    """Current position information"""
    x: float = Field(..., description="X position in mm")
    y: float = Field(..., description="Y position in mm")
    z: float = Field(..., description="Z position in mm")
    is_homed: bool = Field(..., description="Whether axes are homed")

class MovementResponse(BaseResponse):
    """Response model for movement operations"""
    printer_id: str = Field(..., description="Printer identifier")
    position: Optional[PositionInfo] = Field(None, description="Current position")

# Filament Response Models
class FilamentSlot(BaseModel):
    """Filament slot information"""
    slot_number: int = Field(..., description="Slot number")
    is_loaded: bool = Field(..., description="Whether filament is loaded")
    filament_type: Optional[str] = Field(None, description="Type of filament")
    color: Optional[str] = Field(None, description="Filament color")
    remaining: Optional[float] = Field(None, description="Remaining filament percentage")

class AMSStatus(BaseModel):
    """AMS (Automatic Material System) status"""
    is_connected: bool = Field(..., description="Whether AMS is connected")
    slots: List[FilamentSlot] = Field(..., description="Filament slot information")
    current_slot: Optional[int] = Field(None, description="Currently active slot")

class FilamentResponse(BaseResponse):
    """Response model for filament operations"""
    printer_id: str = Field(..., description="Printer identifier")
    ams_status: Optional[AMSStatus] = Field(None, description="AMS status information")

# Lighting Response Models
class LightStatus(BaseModel):
    """Light status information"""
    enabled: bool = Field(..., description="Whether light is enabled")
    brightness: Optional[int] = Field(None, description="Light brightness percentage")

class LightingStatus(BaseModel):
    """Complete lighting status"""
    chamber_light: LightStatus = Field(..., description="Chamber light status")
    work_light: Optional[LightStatus] = Field(None, description="Work light status")
    logo_light: Optional[LightStatus] = Field(None, description="Logo light status")

class LightingResponse(BaseResponse):
    """Response model for lighting operations"""
    printer_id: str = Field(..., description="Printer identifier")
    lighting: LightingStatus = Field(..., description="Lighting status")

# File Management Response Models
class FileInfo(BaseModel):
    """File information"""
    name: str = Field(..., description="File name")
    size: int = Field(..., description="File size in bytes")
    created_at: Optional[datetime] = Field(None, description="File creation timestamp")
    modified_at: Optional[datetime] = Field(None, description="File modification timestamp")
    file_type: str = Field(..., description="File type (3MF, gcode, etc.)")

class FileListResponse(BaseResponse):
    """Response model for file listing"""
    printer_id: str = Field(..., description="Printer identifier")
    files: List[FileInfo] = Field(..., description="List of files")
    total_count: int = Field(..., description="Total number of files")

class FileUploadResponse(BaseResponse):
    """Response model for file upload"""
    printer_id: str = Field(..., description="Printer identifier")
    file_info: FileInfo = Field(..., description="Uploaded file information")

# Camera Response Models
class CameraSnapshot(BaseModel):
    """Camera snapshot information"""
    image_data: str = Field(..., description="Base64 encoded image data")
    timestamp: datetime = Field(..., description="Snapshot timestamp")
    resolution: str = Field(..., description="Image resolution")

class CameraStreamInfo(BaseModel):
    """Camera stream information"""
    stream_url: str = Field(..., description="Camera stream URL")
    is_active: bool = Field(..., description="Whether stream is active")
    resolution: str = Field(..., description="Stream resolution")

class CameraRecordingInfo(BaseModel):
    """Camera recording information"""
    is_recording: bool = Field(..., description="Whether currently recording")
    start_time: Optional[datetime] = Field(None, description="Recording start time")
    duration: Optional[int] = Field(None, description="Recording duration in seconds")

class CameraResponse(BaseResponse):
    """Response model for camera operations"""
    printer_id: str = Field(..., description="Printer identifier")
    snapshot: Optional[CameraSnapshot] = Field(None, description="Camera snapshot")
    stream_info: Optional[CameraStreamInfo] = Field(None, description="Stream information")
    recording_info: Optional[CameraRecordingInfo] = Field(None, description="Recording information")

# Fan Control Response Models
class FanStatus(BaseModel):
    """Fan status information"""
    speed: int = Field(..., ge=0, le=100, description="Fan speed percentage")
    is_running: bool = Field(..., description="Whether fan is running")

class FanSystemStatus(BaseModel):
    """Complete fan system status"""
    part_cooling: FanStatus = Field(..., description="Part cooling fan")
    aux_fan: Optional[FanStatus] = Field(None, description="Auxiliary fan")
    chamber_fan: Optional[FanStatus] = Field(None, description="Chamber fan")

class FanResponse(BaseResponse):
    """Response model for fan operations"""
    printer_id: str = Field(..., description="Printer identifier")
    fans: FanSystemStatus = Field(..., description="Fan system status")

# System Response Models
class SystemInfo(BaseModel):
    """System information"""
    firmware_version: Optional[str] = Field(None, description="Firmware version")
    uptime: Optional[int] = Field(None, description="System uptime in seconds")
    free_storage: Optional[int] = Field(None, description="Free storage in bytes")
    total_storage: Optional[int] = Field(None, description="Total storage in bytes")

class SystemResponse(BaseResponse):
    """Response model for system operations"""
    printer_id: str = Field(..., description="Printer identifier")
    system_info: Optional[SystemInfo] = Field(None, description="System information")

# Live Status WebSocket Response Models
class LivePrintStatus(BaseModel):
    """Live print status for WebSocket streaming"""
    printer_id: str = Field(..., description="Printer identifier")
    status: PrintJobStatus = Field(..., description="Current print status")
    progress: Optional[PrintProgress] = Field(None, description="Print progress")
    temperatures: TemperatureStatus = Field(..., description="Live temperature readings")
    light_on: bool = Field(default=False, description="Whether chamber light is on")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Status timestamp")

class LiveStatusUpdate(BaseModel):
    """WebSocket live status update"""
    type: str = Field(default="live_status", description="Message type")
    data: Union[LivePrintStatus, List[LivePrintStatus]] = Field(..., description="Status data")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Update timestamp")

# 3MF Object Manipulation Response Models
class ObjectMultiplyFileInfo(BaseModel):
    """Information about multiplied 3MF file"""
    filename: str = Field(..., description="Generated filename")
    download_url: str = Field(..., description="URL to download the file")
    object_count: int = Field(..., description="Number of objects in the file")
    grid_layout: str = Field(..., description="Grid layout (e.g., '3x3')")
    spacing_mm: float = Field(..., description="Spacing between objects in mm")
    total_size: str = Field(..., description="File size (human readable)")

class ObjectMultiplyResponse(BaseResponse):
    """Response model for 3MF object multiplication"""
    file_info: ObjectMultiplyFileInfo = Field(..., description="Information about the generated file")

# Health Check Response
class HealthResponse(BaseModel):
    """Health check response"""
    status: str = Field(..., description="Service status")
    service: str = Field(..., description="Service name")
    version: str = Field(default="1.0.0", description="API version")
    uptime: Optional[int] = Field(None, description="Service uptime in seconds")