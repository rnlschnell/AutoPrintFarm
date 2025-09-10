"""
Configuration service for managing tenant-specific settings
"""

import os
import yaml
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

class ConfigService:
    """
    Service for managing tenant configuration
    """
    
    def __init__(self, config_path: str = None):
        """
        Initialize configuration service
        
        Args:
            config_path: Optional path to configuration file
        """
        # Load environment variables from .env file if it exists
        project_root = Path(__file__).parent.parent.parent
        env_path = project_root / ".env"
        if env_path.exists():
            load_dotenv(env_path)
            logger.info("Loaded environment variables from .env file")
        
        if config_path is None:
            # Default to config directory in project root
            config_path = str(project_root / "config" / "tenant_config.yaml")
        
        self.config_path = config_path
        self.config_data: Dict[str, Any] = {}
        self.last_loaded = None
        
        logger.info(f"Configuration service initialized with path: {config_path}")
    
    def load_config(self) -> Dict[str, Any]:
        """
        Load configuration from file
        
        Returns:
            Configuration dictionary
        """
        try:
            if not os.path.exists(self.config_path):
                logger.warning(f"Configuration file not found: {self.config_path}")
                return self._get_default_config()
            
            with open(self.config_path, 'r', encoding='utf-8') as file:
                self.config_data = yaml.safe_load(file) or {}
                self.last_loaded = datetime.utcnow()
            
            # Merge with defaults to ensure all required keys exist
            self.config_data = self._merge_with_defaults(self.config_data)
            
            logger.info("Configuration loaded successfully")
            return self.config_data.copy()
            
        except Exception as e:
            logger.error(f"Failed to load configuration: {e}")
            return self._get_default_config()
    
    def save_config(self, config_data: Dict[str, Any] = None) -> bool:
        """
        Save configuration to file
        
        Args:
            config_data: Optional configuration data (uses current config if None)
            
        Returns:
            True if successful, False otherwise
        """
        try:
            data_to_save = config_data or self.config_data
            
            # Ensure directory exists
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            
            with open(self.config_path, 'w', encoding='utf-8') as file:
                yaml.dump(data_to_save, file, default_flow_style=False, sort_keys=False)
            
            if config_data:
                self.config_data = config_data.copy()
            
            self.last_loaded = datetime.utcnow()
            logger.info("Configuration saved successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to save configuration: {e}")
            return False
    
    def get_tenant_config(self) -> Dict[str, Any]:
        """
        Get tenant-specific configuration
        
        Returns:
            Tenant configuration
        """
        if not self.config_data:
            self.load_config()
        
        return self.config_data.get('tenant', {})
    
    def get_supabase_config(self) -> Dict[str, Any]:
        """
        Get Supabase configuration
        
        Returns:
            Supabase configuration
        """
        if not self.config_data:
            self.load_config()
        
        return self.config_data.get('supabase', {})
    
    def get_sync_config(self) -> Dict[str, Any]:
        """
        Get sync configuration
        
        Returns:
            Sync configuration
        """
        if not self.config_data:
            self.load_config()
        
        return self.config_data.get('sync', {})
    
    def get_database_config(self) -> Dict[str, Any]:
        """
        Get database configuration
        
        Returns:
            Database configuration
        """
        if not self.config_data:
            self.load_config()
        
        return self.config_data.get('database', {})
    
    def get_logging_config(self) -> Dict[str, Any]:
        """
        Get logging configuration
        
        Returns:
            Logging configuration
        """
        if not self.config_data:
            self.load_config()
        
        return self.config_data.get('logging', {})
    
    def set_tenant_info(self, tenant_id: str, tenant_name: str = None) -> bool:
        """
        Set tenant information in configuration
        
        Args:
            tenant_id: Tenant UUID
            tenant_name: Optional tenant name
            
        Returns:
            True if successful, False otherwise
        """
        try:
            if not self.config_data:
                self.load_config()
            
            if 'tenant' not in self.config_data:
                self.config_data['tenant'] = {}
            
            self.config_data['tenant']['id'] = tenant_id
            if tenant_name:
                self.config_data['tenant']['name'] = tenant_name
            
            return self.save_config()
            
        except Exception as e:
            logger.error(f"Failed to set tenant info: {e}")
            return False
    
    def is_tenant_configured(self) -> bool:
        """
        Check if tenant is configured
        
        Returns:
            True if tenant ID is set, False otherwise
        """
        tenant_config = self.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        return len(tenant_id) > 0
    
    def get_tenant_id(self) -> Optional[str]:
        """
        Get the configured tenant ID
        
        Checks configuration file first, then environment variable as fallback
        
        Returns:
            Tenant ID if configured, None otherwise
        """
        # Try configuration file first
        tenant_config = self.get_tenant_config()
        tenant_id = tenant_config.get('id', '').strip()
        
        if tenant_id:
            return tenant_id
        
        # Fallback to environment variable
        env_tenant_id = os.getenv('TENANT_ID', '').strip()
        if env_tenant_id:
            logger.info("Using tenant ID from environment variable")
            return env_tenant_id
        
        return None
    
    def validate_config(self) -> Dict[str, Any]:
        """
        Validate the current configuration
        
        Returns:
            Validation results
        """
        if not self.config_data:
            self.load_config()
        
        issues = []
        warnings = []
        
        # Check tenant configuration
        tenant_config = self.config_data.get('tenant', {})
        if not tenant_config.get('id'):
            issues.append("Tenant ID is not configured")
        
        # Check Supabase configuration
        supabase_config = self.config_data.get('supabase', {})
        if not supabase_config.get('url'):
            issues.append("Supabase URL is not configured")
        if not supabase_config.get('anon_key'):
            issues.append("Supabase anonymous key is not configured")
        
        # Check database configuration
        database_config = self.config_data.get('database', {})
        db_path = database_config.get('path')
        if db_path:
            db_dir = os.path.dirname(db_path)
            if not os.path.exists(db_dir):
                warnings.append(f"Database directory does not exist: {db_dir}")
        
        # Check logging configuration
        logging_config = self.config_data.get('logging', {})
        log_path = logging_config.get('file_path')
        if log_path:
            log_dir = os.path.dirname(log_path)
            if not os.path.exists(log_dir):
                warnings.append(f"Log directory does not exist: {log_dir}")
        
        return {
            'valid': len(issues) == 0,
            'issues': issues,
            'warnings': warnings,
            'validated_at': datetime.utcnow().isoformat()
        }
    
    def _get_default_config(self) -> Dict[str, Any]:
        """
        Get default configuration
        
        Returns:
            Default configuration dictionary
        """
        return {
            'tenant': {
                'id': '',
                'name': ''
            },
            'supabase': {
                'url': 'https://rippurqgfesmtoovxidz.supabase.co',
                'anon_key': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpcHB1cnFnZmVzbXRvb3Z4aWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE0OTQwNjEsImV4cCI6MjA2NzA3MDA2MX0.ct4KGkxZvQS0LW9llwKlPK4VAPsdHusKU_3mWXzOt58',
                'service_role_key': ''
            },
            'sync': {
                'enabled': True,
                'initial_sync_on_startup': True,
                'retry_attempts': 5,
                'retry_delay_seconds': 5,
                'heartbeat_interval_seconds': 30
            },
            'database': {
                'path': 'data/tenant.db',
                'backup_enabled': True,
                'backup_interval_hours': 24,
                'cleanup_logs_after_days': 7
            },
            'logging': {
                'level': 'INFO',
                'sync_operations': True,
                'database_operations': False,
                'file_path': 'logs/sync.log',
                'max_file_size_mb': 10,
                'backup_count': 5
            },
            'security': {
                'encrypt_credentials': True,
                'require_https': True,
                'validate_tenant_access': True
            },
            'performance': {
                'max_concurrent_syncs': 3,
                'batch_size': 100,
                'connection_pool_size': 5
            }
        }
    
    def _merge_with_defaults(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Merge configuration with defaults
        
        Args:
            config: User configuration
            
        Returns:
            Merged configuration
        """
        defaults = self._get_default_config()
        
        def merge_dict(default: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
            result = default.copy()
            for key, value in user.items():
                if isinstance(value, dict) and key in result and isinstance(result[key], dict):
                    result[key] = merge_dict(result[key], value)
                else:
                    result[key] = value
            return result
        
        return merge_dict(defaults, config)


# Global configuration service instance
config_service: Optional[ConfigService] = None

def get_config_service() -> ConfigService:
    """
    Get or create global configuration service instance
    """
    global config_service
    if config_service is None:
        config_service = ConfigService()
        config_service.load_config()
    return config_service