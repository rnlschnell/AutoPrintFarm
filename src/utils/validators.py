import re
from typing import Any, Dict
from src.utils.exceptions import ValidationError

def validate_ip_address(ip: str) -> bool:
    """Validate IP address format"""
    pattern = r'^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$'
    return bool(re.match(pattern, ip))

def validate_access_code(access_code: str) -> bool:
    """Validate access code format (8 digits)"""
    return bool(re.match(r'^\d{8}$', access_code))

def validate_serial_number(serial: str) -> bool:
    """Validate serial number format"""
    # Bambu Lab serial numbers are typically alphanumeric
    return bool(re.match(r'^[A-Z0-9]{10,}$', serial.upper()))

def validate_printer_model(model: str) -> bool:
    """Validate printer model"""
    valid_models = ['X1', 'X1C', 'X1E', 'P1P', 'P1S', 'A1', 'A1M']
    return model.upper() in valid_models

def validate_printer_config(config: Dict[str, Any]) -> None:
    """Validate printer configuration"""
    required_fields = ['id', 'name', 'ip', 'access_code', 'serial', 'model']
    
    for field in required_fields:
        if field not in config:
            raise ValidationError(f"Missing required field: {field}")
    
    if not validate_ip_address(config['ip']):
        raise ValidationError(f"Invalid IP address: {config['ip']}")
    
    if not validate_access_code(config['access_code']):
        raise ValidationError(f"Invalid access code: {config['access_code']} (must be 8 digits)")
    
    if not validate_serial_number(config['serial']):
        raise ValidationError(f"Invalid serial number: {config['serial']}")
    
    if not validate_printer_model(config['model']):
        raise ValidationError(f"Invalid printer model: {config['model']}")

def validate_temperature(temperature: float) -> None:
    """Validate temperature value"""
    if not 0 <= temperature <= 350:
        raise ValidationError(f"Invalid temperature: {temperature} (must be between 0 and 350)")

def validate_coordinates(x: float = None, y: float = None, z: float = None) -> None:
    """Validate movement coordinates"""
    if x is not None and not -500 <= x <= 500:
        raise ValidationError(f"Invalid X coordinate: {x} (must be between -500 and 500)")
    
    if y is not None and not -500 <= y <= 500:
        raise ValidationError(f"Invalid Y coordinate: {y} (must be between -500 and 500)")
    
    if z is not None and not 0 <= z <= 400:
        raise ValidationError(f"Invalid Z coordinate: {z} (must be between 0 and 400)")

def validate_speed(speed: int) -> None:
    """Validate movement speed"""
    if not 100 <= speed <= 15000:
        raise ValidationError(f"Invalid speed: {speed} (must be between 100 and 15000)")

def validate_fan_speed(speed: int) -> None:
    """Validate fan speed percentage"""
    if not 0 <= speed <= 100:
        raise ValidationError(f"Invalid fan speed: {speed} (must be between 0 and 100)")

def sanitize_bambu_filename(filename: str) -> str:
    """
    Sanitize filename to be compatible with Bambu Lab printers.
    Replaces spaces with underscores and removes invalid characters.
    Preserves the file extension.

    Args:
        filename: Original filename that may contain spaces or invalid characters

    Returns:
        Sanitized filename safe for Bambu Lab printers

    Example:
        "Quick ReleaseAMS.gcode" -> "Quick_ReleaseAMS.gcode"
        "My File (2).3mf" -> "My_File_2.3mf"
    """
    # Split filename and extension
    if '.' in filename:
        name_part, ext = filename.rsplit('.', 1)
    else:
        name_part, ext = filename, ''

    # Replace spaces with underscores
    name_part = name_part.replace(' ', '_')

    # Remove any characters that aren't alphanumeric, dots, hyphens, or underscores
    name_part = re.sub(r'[^a-zA-Z0-9._-]', '', name_part)

    # Reconstruct filename
    return f"{name_part}.{ext}" if ext else name_part

def validate_bambu_file_path(file_path: str) -> None:
    """Validate Bambu Labs file path format"""
    if not file_path.endswith(('.3mf', '.gcode', '.g')):
        raise ValidationError(f"Invalid file type: {file_path} (must be .3mf, .gcode, or .g for Bambu Labs)")
    
    if '/' in file_path or '\\' in file_path:
        raise ValidationError(f"File path should be just the filename: {file_path}")
    
    # Check for valid filename characters for supported file types
    if not re.match(r'^[a-zA-Z0-9._-]+\.(3mf|gcode|g)$', file_path):
        raise ValidationError(f"Invalid filename format: {file_path} (use only alphanumeric, dots, hyphens, underscores)")

def validate_bambu_plate_number(plate_number: int) -> None:
    """Validate Bambu Labs plate number"""
    if not 1 <= plate_number <= 4:
        raise ValidationError(f"Invalid plate number: {plate_number} (must be 1-4)")

def validate_bambu_ams_mapping(ams_mapping: list) -> None:
    """Validate Bambu Labs AMS slot mapping"""
    if not ams_mapping:
        return
    
    for i, slot in enumerate(ams_mapping):
        if not isinstance(slot, int) or not -1 <= slot <= 3:
            raise ValidationError(f"Invalid AMS slot {i}: {slot} (must be -1 to 3, -1 for external spool)")

def validate_bambu_sequence_id(sequence_id: int) -> None:
    """Validate Bambu Labs MQTT sequence ID"""
    if not 1 <= sequence_id <= 65535:
        raise ValidationError(f"Invalid sequence ID: {sequence_id} (must be 1-65535)")

def validate_bambu_print_params(params: Dict[str, Any]) -> None:
    """Validate all Bambu Labs print parameters"""
    # Validate file path
    if 'file_path' in params:
        validate_bambu_file_path(params['file_path'])
    
    # Validate plate number
    if 'plate_number' in params:
        validate_bambu_plate_number(params['plate_number'])
    
    # Validate AMS mapping
    if 'ams_mapping' in params and params['ams_mapping']:
        validate_bambu_ams_mapping(params['ams_mapping'])
    
    # Validate boolean parameters
    boolean_params = ['use_ams', 'bed_leveling', 'flow_calibration', 'vibration_calibration', 
                     'layer_inspect', 'timelapse']
    for param in boolean_params:
        if param in params and not isinstance(params[param], bool):
            raise ValidationError(f"Parameter {param} must be boolean, got {type(params[param])}")

def validate_bambu_mqtt_command(command: str, params: Dict[str, Any]) -> None:
    """Validate Bambu Labs MQTT command structure"""
    valid_commands = [
        'gcode_line', 'print_start', 'print_stop', 'print_pause', 'print_resume', 'print_cancel',
        'get_directory_info', 'delete_file', 'get_file_info', 'move_to', 'home', 'disable_motors'
    ]
    
    if command not in valid_commands:
        raise ValidationError(f"Invalid MQTT command: {command} (valid: {', '.join(valid_commands)})")
    
    # Command-specific validation
    if command == 'gcode_line' and 'url' not in params:
        raise ValidationError("MQTT command 'gcode_line' requires 'url' parameter")
    
    if command in ['get_directory_info', 'delete_file', 'get_file_info'] and 'target' not in params:
        raise ValidationError(f"MQTT command '{command}' requires 'target' parameter")