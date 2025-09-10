import yaml
import os
from pathlib import Path
from typing import Dict, Any
import logging
from src.utils.exceptions import ConfigurationError

logger = logging.getLogger(__name__)

def get_config_path() -> Path:
    """Get the configuration directory path"""
    # Get the project root directory (two levels up from this file)
    current_file = Path(__file__)
    project_root = current_file.parent.parent.parent
    return project_root / "config"

def get_default_config() -> Dict[str, Any]:
    """Get default configuration values"""
    return {
        "server": {
            "host": "192.168.4.45",
            "port": 8000,
            "title": "Bambu Program API",
            "description": "Complete Bambu Lab Printer Control API"
        }
    }

def get_default_printers_config() -> Dict[str, Any]:
    """Get default printers configuration"""
    return {
        "printers": []
    }

def load_config() -> Dict[str, Any]:
    """Load configuration from YAML files with fallbacks"""
    config_dir = get_config_path()
    config_file = config_dir / "config.yaml"
    
    # Start with default configuration
    config = get_default_config()
    
    try:
        if config_file.exists():
            with open(config_file, 'r') as f:
                file_config = yaml.safe_load(f) or {}
            
            # Merge file config with defaults
            config.update(file_config)
            logger.info(f"Loaded configuration from {config_file}")
        else:
            logger.warning(f"Configuration file not found at {config_file}, using defaults")
            
            # Create config directory and default file
            config_dir.mkdir(parents=True, exist_ok=True)
            with open(config_file, 'w') as f:
                yaml.safe_dump(config, f, default_flow_style=False, indent=2)
            logger.info(f"Created default configuration file at {config_file}")
    
    except yaml.YAMLError as e:
        logger.error(f"Error parsing configuration file: {e}")
        raise ConfigurationError(f"Invalid YAML in configuration file: {e}")
    except Exception as e:
        logger.error(f"Error loading configuration: {e}")
        raise ConfigurationError(f"Failed to load configuration: {e}")
    
    # Validate required configuration
    try:
        validate_config(config)
    except Exception as e:
        raise ConfigurationError(f"Invalid configuration: {e}")
    
    return config

def validate_config(config: Dict[str, Any]) -> None:
    """Validate configuration structure and values"""
    if "server" not in config:
        raise ValueError("Missing 'server' section in configuration")
    
    server_config = config["server"]
    
    # Validate host
    if "host" not in server_config:
        raise ValueError("Missing 'host' in server configuration")
    
    # Validate port
    if "port" not in server_config:
        raise ValueError("Missing 'port' in server configuration")
    
    port = server_config["port"]
    if not isinstance(port, int) or port < 1 or port > 65535:
        raise ValueError(f"Invalid port number: {port}")

def load_printers_config() -> Dict[str, Any]:
    """Load printer configuration from YAML file with fallbacks"""
    config_dir = get_config_path()
    printers_file = config_dir / "printers.yaml"
    
    # Start with default printers configuration
    config = get_default_printers_config()
    
    try:
        if printers_file.exists():
            with open(printers_file, 'r') as f:
                file_config = yaml.safe_load(f) or {}
            
            # Merge file config with defaults
            config.update(file_config)
            logger.info(f"Loaded printers configuration from {printers_file}")
        else:
            logger.info(f"Printers configuration file not found at {printers_file}, using empty configuration")
            
            # Create config directory and default file
            config_dir.mkdir(parents=True, exist_ok=True)
            with open(printers_file, 'w') as f:
                yaml.safe_dump(config, f, default_flow_style=False, indent=2)
            logger.info(f"Created default printers configuration file at {printers_file}")
    
    except yaml.YAMLError as e:
        logger.error(f"Error parsing printers configuration file: {e}")
        raise ConfigurationError(f"Invalid YAML in printers configuration: {e}")
    except Exception as e:
        logger.error(f"Error loading printers configuration: {e}")
        raise ConfigurationError(f"Failed to load printers configuration: {e}")
    
    # Validate printers configuration
    try:
        validate_printers_config(config)
    except Exception as e:
        raise ConfigurationError(f"Invalid printers configuration: {e}")
    
    return config

def validate_printers_config(config: Dict[str, Any]) -> None:
    """Validate printers configuration structure"""
    if "printers" not in config:
        raise ValueError("Missing 'printers' section in configuration")
    
    if not isinstance(config["printers"], list):
        raise ValueError("'printers' must be a list")
    
    # Validate each printer configuration
    for i, printer in enumerate(config["printers"]):
        if not isinstance(printer, dict):
            raise ValueError(f"Printer {i} must be a dictionary")
        
        required_fields = ["id", "name", "ip", "access_code", "serial", "model"]
        for field in required_fields:
            if field not in printer:
                raise ValueError(f"Printer {i} missing required field: {field}")

def save_printers_config(config: Dict[str, Any]) -> None:
    """Save printer configuration to YAML file"""
    try:
        # Validate before saving
        validate_printers_config(config)
        
        config_dir = get_config_path()
        printers_file = config_dir / "printers.yaml"
        
        # Ensure config directory exists
        config_dir.mkdir(parents=True, exist_ok=True)
        
        # Create backup of existing file
        if printers_file.exists():
            backup_file = printers_file.with_suffix('.yaml.backup')
            printers_file.rename(backup_file)
            logger.info(f"Created backup: {backup_file}")
        
        # Write new configuration
        with open(printers_file, 'w') as f:
            yaml.safe_dump(config, f, default_flow_style=False, indent=2)
        
        logger.info(f"Saved printers configuration to {printers_file}")
        
    except Exception as e:
        logger.error(f"Failed to save printers configuration: {e}")
        raise ConfigurationError(f"Failed to save printers configuration: {e}")