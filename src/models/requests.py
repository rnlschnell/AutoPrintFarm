from pydantic import BaseModel, Field, validator
from typing import Optional, List, Union
from enum import Enum

# Printer Management Models
class PrinterCreateRequest(BaseModel):
    """Request model for creating a new printer"""
    id: str = Field(..., description="Unique printer identifier")
    name: str = Field(..., description="Human-readable printer name")
    ip: str = Field(..., description="Printer IP address")
    access_code: str = Field(..., pattern=r"^\d{8}$", description="8-digit access code")
    serial: str = Field(..., description="Printer serial number")
    model: str = Field(..., description="Printer model (X1, X1C, X1E, P1P, P1S, A1, A1M)")
    enabled: bool = Field(default=True, description="Whether the printer is enabled")

class PrinterUpdateRequest(BaseModel):
    """Request model for updating printer configuration"""
    name: Optional[str] = Field(None, description="Human-readable printer name")
    ip: Optional[str] = Field(None, description="Printer IP address")
    access_code: Optional[str] = Field(None, pattern=r"^\d{8}$", description="8-digit access code")
    serial: Optional[str] = Field(None, description="Printer serial number")
    model: Optional[str] = Field(None, description="Printer model")
    enabled: Optional[bool] = Field(None, description="Whether the printer is enabled")
    current_build_plate: Optional[str] = Field(None, description="Current build plate type name")

# Print Control Models
class PrintStartRequest(BaseModel):
    """Request model for starting a print job - CRITICAL: Must match Bambu Lab MQTT protocol exactly"""
    file_path: str = Field(..., description="Name of the 3MF file on printer (without path)")
    plate_number: int = Field(default=1, ge=1, le=4, description="Build plate number (1-4)")
    use_ams: bool = Field(default=False, description="Whether to use AMS for filament")
    ams_mapping: Optional[List[int]] = Field(None, description="AMS slot mapping array, -1 for external spool")
    flow_calibration: bool = Field(default=False, description="Enable automatic flow calibration")
    bed_leveling: bool = Field(default=True, description="Enable bed leveling before print")
    vibration_calibration: bool = Field(default=False, description="Enable vibration calibration")
    layer_inspect: bool = Field(default=False, description="Enable layer inspection")
    timelapse: bool = Field(default=False, description="Enable timelapse recording")
    
    @validator('file_path')
    def validate_file_path(cls, v):
        """Validate file path is just filename with supported extension"""
        if not v.endswith(('.3mf', '.gcode', '.g')):
            raise ValueError('File path must end with .3mf, .gcode, or .g extension')
        if '/' in v or '\\' in v:
            raise ValueError('File path should be just the filename, not a full path')
        return v
    
    @validator('ams_mapping')
    def validate_ams_mapping(cls, v):
        """Validate AMS mapping contains valid slot numbers"""
        if v is not None:
            for slot in v:
                if slot < -1 or slot > 3:
                    raise ValueError('AMS mapping values must be between -1 and 3 (-1 for external spool)')
        return v

class FileUploadRequest(BaseModel):
    """Request model for file upload"""
    filename: str = Field(..., description="Name of the file to upload")
    overwrite: bool = Field(default=False, description="Whether to overwrite existing file")

# Movement Control Models

# Temperature Control Models
class TemperatureRequest(BaseModel):
    """Request model for temperature setting"""
    temperature: float = Field(..., ge=0, le=350, description="Target temperature in Celsius")
    wait: bool = Field(default=False, description="Whether to wait for temperature to be reached")

# Filament Management Models
class FilamentLoadRequest(BaseModel):
    """Request model for loading filament"""
    ams_slot: Optional[int] = Field(None, ge=0, le=3, description="AMS slot number (0-3)")
    filament_type: Optional[str] = Field(None, description="Filament type (PLA, ABS, PETG, etc.)")

class FilamentUnloadRequest(BaseModel):
    """Request model for unloading filament"""
    ams_slot: Optional[int] = Field(None, ge=0, le=3, description="AMS slot number (0-3)")

class FilamentChangeRequest(BaseModel):
    """Request model for changing filament"""
    from_slot: int = Field(..., ge=0, le=3, description="Source AMS slot")
    to_slot: int = Field(..., ge=0, le=3, description="Target AMS slot")

# Lighting Control Models

# Calibration Models
class BedLevelRequest(BaseModel):
    """Request model for bed leveling"""
    auto_level: bool = Field(default=True, description="Whether to perform automatic bed leveling")
    save_result: bool = Field(default=True, description="Whether to save calibration results")

class FlowCalibrationRequest(BaseModel):
    """Request model for flow rate calibration"""
    filament_type: str = Field(..., description="Filament type for calibration")
    nozzle_diameter: float = Field(default=0.4, description="Nozzle diameter in mm")

class CalibrationRequest(BaseModel):
    """Request model for printer calibration"""
    bed_level: bool = Field(default=True, description="Whether to calibrate the bed level")
    vibration_compensation: bool = Field(default=True, description="Whether to calibrate the vibration compensation")
    motor_noise_calibration: bool = Field(default=True, description="Whether to calibrate the motor noise")




# G-code Command Model
class GCodeRequest(BaseModel):
    """Request model for custom G-code commands"""
    command: str = Field(..., description="G-code command to execute")
    wait_for_completion: bool = Field(default=True, description="Whether to wait for command completion")

# 3MF Object Manipulation Models
class ObjectMultiplyRequest(BaseModel):
    """Request model for multiplying objects in 3MF files"""
    object_count: int = Field(..., ge=1, le=100, description="Number of objects to create (1-100)")
    spacing_mm: float = Field(..., ge=0, le=50, description="Spacing between objects in mm (0-50)")
    
    @validator('object_count')
    def validate_object_count(cls, v):
        """Validate object count is reasonable"""
        if v < 1:
            raise ValueError('Object count must be at least 1')
        if v > 100:
            raise ValueError('Object count cannot exceed 100')
        return v
    
    @validator('spacing_mm')
    def validate_spacing(cls, v):
        """Validate spacing is reasonable"""
        if v < 0:
            raise ValueError('Spacing cannot be negative')
        if v > 50:
            raise ValueError('Spacing cannot exceed 50mm')
        return v

