"""
Authentication service for managing Supabase authentication
"""

import os
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import json
import asyncio
from pathlib import Path
import base64

from supabase import create_client, Client
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import jwt

logger = logging.getLogger(__name__)

class AuthService:
    """
    Service for managing Supabase authentication and tenant validation
    """
    
    def __init__(self, supabase_url: str, supabase_key: str, config_dir: str = None):
        """
        Initialize authentication service
        
        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase anonymous key
        """
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.supabase: Client = create_client(supabase_url, supabase_key)
        
        # Configuration
        if config_dir is None:
            config_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'config')
        self.config_dir = Path(config_dir)
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.auth_file = self.config_dir / 'auth.json'
        
        # Authentication state
        self.current_session = None
        self.current_user = None
        self.current_tenant_id = None
        self.session_expires_at = None
        self.refresh_token = None
        
        # Production resilience features
        self._auth_failure_count = 0
        self._auth_circuit_breaker_until = None
        self._max_auth_failures = 3
        self._circuit_breaker_duration = 300  # 5 minutes
        self._last_auth_attempt = None
        self._auth_retry_delay = 5
        
        # Encryption setup
        self.cipher_suite = self._setup_encryption()
        
        # Load stored credentials if they exist
        self._load_stored_credentials()
        
        # Auto-refresh task
        self.refresh_task = None
        
        logger.info("Production-grade authentication service initialized")
    
    def _is_circuit_breaker_active(self) -> bool:
        """
        Check if the authentication circuit breaker is currently active
        
        Returns:
            True if circuit breaker is active and should block auth attempts
        """
        if self._auth_circuit_breaker_until is None:
            return False
        
        if datetime.utcnow() >= self._auth_circuit_breaker_until:
            # Circuit breaker timeout has passed, reset it
            self._auth_circuit_breaker_until = None
            self._auth_failure_count = 0
            logger.info("Authentication circuit breaker reset")
            return False
        
        return True
    
    def _handle_auth_failure(self):
        """
        Handle authentication failure with circuit breaker logic
        """
        self._auth_failure_count += 1
        self._last_auth_attempt = datetime.utcnow()
        
        if self._auth_failure_count >= self._max_auth_failures:
            self._auth_circuit_breaker_until = datetime.utcnow() + timedelta(seconds=self._circuit_breaker_duration)
            logger.error(f"Authentication circuit breaker activated until {self._auth_circuit_breaker_until} after {self._auth_failure_count} failures")
        else:
            logger.warning(f"Authentication failure {self._auth_failure_count}/{self._max_auth_failures}")
    
    def get_auth_health_status(self) -> Dict[str, Any]:
        """
        Get authentication service health status
        
        Returns:
            Comprehensive health status information
        """
        now = datetime.utcnow()
        
        status = {
            'healthy': True,
            'authenticated': self.is_authenticated(),
            'tenant_id': self.current_tenant_id,
            'user_email': self.current_user.email if self.current_user else None,
            'session_expires_at': self.session_expires_at.isoformat() if self.session_expires_at else None,
            'circuit_breaker_active': self._is_circuit_breaker_active(),
            'failure_count': self._auth_failure_count,
            'last_attempt': self._last_auth_attempt.isoformat() if self._last_auth_attempt else None,
            'timestamp': now.isoformat()
        }
        
        # Check session expiry status
        if self.session_expires_at:
            time_until_expiry = (self.session_expires_at - now).total_seconds()
            status['expires_in_seconds'] = max(0, int(time_until_expiry))
            status['needs_refresh'] = time_until_expiry < 1800  # 30 minutes
            
            if time_until_expiry <= 0:
                status['healthy'] = False
                status['issues'] = ['Session expired']
        
        # Check circuit breaker
        if self._is_circuit_breaker_active():
            status['healthy'] = False
            if 'issues' not in status:
                status['issues'] = []
            status['issues'].append(f'Circuit breaker active until {self._auth_circuit_breaker_until}')
        
        return status
    
    def _setup_encryption(self) -> Fernet:
        """
        Setup encryption for storing sensitive data
        
        Returns:
            Fernet cipher suite for encryption/decryption
        """
        # Use machine-specific data as salt
        salt = b'pi-auth-salt-v1'  # In production, use hardware ID
        
        # Derive a key from the salt
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        
        # Generate key from machine ID or use default
        machine_id = os.environ.get('MACHINE_ID', 'default-pi-key').encode()
        key = base64.urlsafe_b64encode(kdf.derive(machine_id))
        
        return Fernet(key)
    
    def _encrypt_data(self, data: str) -> str:
        """Encrypt sensitive data"""
        return self.cipher_suite.encrypt(data.encode()).decode()
    
    def _decrypt_data(self, encrypted_data: str) -> str:
        """Decrypt sensitive data"""
        try:
            return self.cipher_suite.decrypt(encrypted_data.encode()).decode()
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            return None
    
    def _load_stored_credentials(self) -> bool:
        """
        Load stored credentials from encrypted file
        
        Returns:
            True if credentials loaded successfully
        """
        try:
            if not self.auth_file.exists():
                return False
            
            with open(self.auth_file, 'r') as f:
                encrypted_data = json.load(f)
            
            # Decrypt sensitive fields
            if 'access_token' in encrypted_data:
                access_token = self._decrypt_data(encrypted_data['access_token'])
                if not access_token:
                    logger.error("Failed to decrypt stored credentials")
                    return False
                
                # Decode JWT to check expiry
                try:
                    payload = jwt.decode(access_token, options={"verify_signature": False})
                    exp = payload.get('exp')
                    if exp and datetime.fromtimestamp(exp) > datetime.utcnow():
                        # Token still valid, restore session
                        self.current_session = type('Session', (), {
                            'access_token': access_token,
                            'refresh_token': self._decrypt_data(encrypted_data.get('refresh_token', '')),
                            'expires_at': exp
                        })()
                        self.current_tenant_id = encrypted_data.get('tenant_id')
                        self.session_expires_at = datetime.fromtimestamp(exp)
                        self.current_user = type('User', (), {
                            'id': encrypted_data.get('user_id'),
                            'email': encrypted_data.get('user_email')
                        })()
                        
                        logger.info(f"Loaded stored credentials for tenant {self.current_tenant_id}")
                        return True
                    else:
                        logger.info("Stored token expired, will need to refresh")
                        # Store refresh token for later use
                        self.refresh_token = self._decrypt_data(encrypted_data.get('refresh_token', ''))
                        return False
                except Exception as e:
                    logger.error(f"Failed to decode stored JWT: {e}")
                    return False
            
            return False
            
        except Exception as e:
            logger.error(f"Error loading stored credentials: {e}")
            return False
    
    def _save_credentials(self) -> bool:
        """
        Save current credentials to encrypted file
        
        Returns:
            True if saved successfully
        """
        try:
            if not self.current_session:
                return False
            
            # Prepare data for storage
            auth_data = {
                'access_token': self._encrypt_data(self.current_session.access_token),
                'refresh_token': self._encrypt_data(self.current_session.refresh_token) if hasattr(self.current_session, 'refresh_token') else '',
                'tenant_id': self.current_tenant_id,
                'user_id': self.current_user.id if self.current_user else None,
                'user_email': self.current_user.email if self.current_user else None,
                'expires_at': self.session_expires_at.isoformat() if self.session_expires_at else None,
                'stored_at': datetime.utcnow().isoformat()
            }
            
            # Save to file
            with open(self.auth_file, 'w') as f:
                json.dump(auth_data, f, indent=2)
            
            # Set file permissions (read/write for owner only)
            os.chmod(self.auth_file, 0o600)
            
            logger.info("Credentials saved successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error saving credentials: {e}")
            return False
    
    def _extract_tenant_from_jwt(self, token: str) -> Optional[str]:
        """
        Extract tenant_id from JWT token
        
        Args:
            token: JWT access token
            
        Returns:
            Tenant ID if found
        """
        try:
            payload = jwt.decode(token, options={"verify_signature": False})
            
            # Check user metadata for tenant_id
            user_metadata = payload.get('user_metadata', {})
            tenant_id = user_metadata.get('tenant_id')
            
            if tenant_id:
                return tenant_id
            
            # Check app metadata as fallback
            app_metadata = payload.get('app_metadata', {})
            return app_metadata.get('tenant_id')
            
        except Exception as e:
            logger.error(f"Error extracting tenant from JWT: {e}")
            return None
    
    async def authenticate_with_email(self, email: str, password: str) -> Dict[str, Any]:
        """
        Authenticate with email and password with production resilience
        
        Args:
            email: User email
            password: User password
            
        Returns:
            Authentication result with session info
        """
        try:
            # Check circuit breaker
            if self._is_circuit_breaker_active():
                logger.warning(f"Authentication blocked by circuit breaker until {self._auth_circuit_breaker_until}")
                return {
                    'success': False,
                    'error': f'Authentication temporarily blocked due to repeated failures. Try again after {self._auth_circuit_breaker_until}'
                }
            
            logger.info(f"Attempting authentication for {email}")
            
            # Authenticate with Supabase
            response = self.supabase.auth.sign_in_with_password({
                "email": email,
                "password": password
            })
            
            if response.user and response.session:
                self.current_session = response.session
                self.current_user = response.user
                
                # Extract tenant ID from JWT first
                self.current_tenant_id = self._extract_tenant_from_jwt(response.session.access_token)
                
                # If not in JWT, try user metadata
                if not self.current_tenant_id:
                    user_metadata = response.user.user_metadata or {}
                    self.current_tenant_id = user_metadata.get('tenant_id')
                
                if not self.current_tenant_id:
                    # Try to get tenant ID from profiles table
                    profile_response = self.supabase.table('profiles').select('tenant_id').eq('id', response.user.id).single().execute()
                    if profile_response.data:
                        self.current_tenant_id = profile_response.data.get('tenant_id')
                
                # Set session expiration
                if response.session.expires_at:
                    self.session_expires_at = datetime.fromtimestamp(response.session.expires_at)
                
                # Save credentials for persistence
                self._save_credentials()
                
                # Reset failure tracking on successful auth
                self._auth_failure_count = 0
                self._auth_circuit_breaker_until = None
                
                # Start auto-refresh task
                if self.refresh_task:
                    self.refresh_task.cancel()
                self.refresh_task = asyncio.create_task(self._auto_refresh_loop())
                
                logger.info(f"Successfully authenticated user {email} for tenant {self.current_tenant_id}")
                
                return {
                    'success': True,
                    'user_id': response.user.id,
                    'tenant_id': self.current_tenant_id,
                    'access_token': response.session.access_token,
                    'refresh_token': response.session.refresh_token if hasattr(response.session, 'refresh_token') else None,
                    'expires_at': self.session_expires_at.isoformat() if self.session_expires_at else None
                }
            else:
                logger.error(f"Authentication failed for {email}: No user or session returned")
                return {
                    'success': False,
                    'error': 'Authentication failed'
                }
                
        except Exception as e:
            logger.error(f"Authentication error for {email}: {e}")
            self._handle_auth_failure()
            return {
                'success': False,
                'error': str(e)
            }
    
    async def authenticate_with_service_key(self, service_key: str) -> Dict[str, Any]:
        """
        Authenticate with service key for system-level operations
        
        Args:
            service_key: Supabase service key
            
        Returns:
            Authentication result
        """
        try:
            # Create service client
            service_client = create_client(self.supabase_url, service_key)
            
            # Test the service key by making a simple query
            test_response = service_client.table('tenants').select('id').limit(1).execute()
            
            if hasattr(test_response, 'data'):
                logger.info("Successfully authenticated with service key")
                
                # Update the client to use service key
                self.supabase = service_client
                
                return {
                    'success': True,
                    'auth_type': 'service_key'
                }
            else:
                logger.error("Service key authentication failed")
                return {
                    'success': False,
                    'error': 'Service key authentication failed'
                }
                
        except Exception as e:
            logger.error(f"Service key authentication error: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    async def validate_tenant_access(self, tenant_id: str) -> bool:
        """
        Validate that the current user has access to the specified tenant
        
        Args:
            tenant_id: Tenant ID to validate access for
            
        Returns:
            True if user has access, False otherwise
        """
        try:
            if not self.current_user or not self.current_tenant_id:
                logger.error("No authenticated user for tenant validation")
                return False
            
            if self.current_tenant_id != tenant_id:
                logger.error(f"Tenant ID mismatch: current={self.current_tenant_id}, requested={tenant_id}")
                return False
            
            # Verify tenant exists and is active
            tenant_response = self.supabase.table('tenants').select('id, is_active').eq('id', tenant_id).single().execute()
            
            if tenant_response.data and tenant_response.data.get('is_active', False):
                return True
            else:
                logger.error(f"Tenant {tenant_id} not found or inactive")
                return False
                
        except Exception as e:
            logger.error(f"Error validating tenant access: {e}")
            return False
    
    async def _auto_refresh_loop(self):
        """
        Background task to automatically refresh tokens before expiry
        """
        while self.is_authenticated():
            try:
                # Calculate time until refresh needed (30 minutes before expiry)
                if self.session_expires_at:
                    time_until_refresh = (self.session_expires_at - datetime.utcnow() - timedelta(minutes=30)).total_seconds()
                    
                    if time_until_refresh > 0:
                        # Wait until refresh is needed
                        await asyncio.sleep(min(time_until_refresh, 300))  # Check at least every 5 minutes
                    
                    # Check if we should refresh
                    if datetime.utcnow() >= (self.session_expires_at - timedelta(minutes=30)):
                        result = await self.refresh_session()
                        if not result['success']:
                            logger.error("Auto-refresh failed, user will need to re-authenticate")
                            break
                else:
                    # No expiry time, check every 5 minutes
                    await asyncio.sleep(300)
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in auto-refresh loop: {e}")
                await asyncio.sleep(60)  # Retry after 1 minute on error
    
    async def refresh_session(self) -> Dict[str, Any]:
        """
        Refresh the current session if it's about to expire
        
        Returns:
            Refresh result
        """
        try:
            # Check circuit breaker
            if self._is_circuit_breaker_active():
                return {
                    'success': False,
                    'error': f'Authentication circuit breaker active until {self._auth_circuit_breaker_until}'
                }
            
            refresh_token = None
            
            # Get refresh token from current session or stored value
            if self.current_session and hasattr(self.current_session, 'refresh_token'):
                refresh_token = self.current_session.refresh_token
            elif self.refresh_token:
                refresh_token = self.refresh_token
            
            if not refresh_token:
                # Try to load from stored credentials
                if self._load_stored_credentials() and self.refresh_token:
                    refresh_token = self.refresh_token
                else:
                    logger.warning("No refresh token available for session refresh")
                    return {
                        'success': False,
                        'error': 'No refresh token available'
                    }
            
            # Check if session really needs refresh (with proper expiry logic)
            if self.session_expires_at:
                time_until_expiry = (self.session_expires_at - datetime.utcnow()).total_seconds()
                if time_until_expiry > 300:  # More than 5 minutes left
                    logger.debug(f"Session still valid for {int(time_until_expiry/60)} minutes")
                    return {
                        'success': True,
                        'message': f'Session still valid for {int(time_until_expiry/60)} minutes',
                        'expires_at': self.session_expires_at.isoformat()
                    }
            
            logger.info("Refreshing authentication session...")
            
            # Refresh the session
            refresh_response = self.supabase.auth.refresh_session(refresh_token)
            
            if refresh_response.session:
                self.current_session = refresh_response.session
                
                # Extract tenant ID from new token
                if not self.current_tenant_id:
                    self.current_tenant_id = self._extract_tenant_from_jwt(refresh_response.session.access_token)
                
                if refresh_response.session.expires_at:
                    self.session_expires_at = datetime.fromtimestamp(refresh_response.session.expires_at)
                
                # Save updated credentials
                self._save_credentials()
                
                # Reset failure counter on success
                self._auth_failure_count = 0
                
                logger.info(f"Session refreshed successfully, expires at {self.session_expires_at}")
                
                return {
                    'success': True,
                    'access_token': refresh_response.session.access_token,
                    'refresh_token': refresh_response.session.refresh_token if hasattr(refresh_response.session, 'refresh_token') else None,
                    'expires_at': self.session_expires_at.isoformat() if self.session_expires_at else None
                }
            else:
                logger.error("Session refresh failed")
                return {
                    'success': False,
                    'error': 'Session refresh failed'
                }
                
        except Exception as e:
            logger.error(f"Error refreshing session: {e}")
            self._handle_auth_failure()
            return {
                'success': False,
                'error': str(e)
            }
    
    def is_authenticated(self) -> bool:
        """
        Check if there's a valid authenticated session
        
        Returns:
            True if authenticated, False otherwise
        """
        return (
            self.current_session is not None and
            self.current_user is not None and
            self.current_tenant_id is not None and
            (self.session_expires_at is None or datetime.utcnow() < self.session_expires_at)
        )
    
    def get_current_user_id(self) -> Optional[str]:
        """
        Get the current authenticated user ID
        
        Returns:
            User ID if authenticated, None otherwise
        """
        return self.current_user.id if self.current_user else None
    
    def get_current_tenant_id(self) -> Optional[str]:
        """
        Get the current tenant ID
        
        Returns:
            Tenant ID if authenticated, None otherwise
        """
        return self.current_tenant_id
    
    def get_access_token(self) -> Optional[str]:
        """
        Get the current access token
        
        Returns:
            Access token if authenticated, None otherwise
        """
        return self.current_session.access_token if self.current_session else None
    
    async def sign_out(self):
        """
        Sign out the current user
        """
        try:
            # Cancel auto-refresh task
            if self.refresh_task:
                self.refresh_task.cancel()
                self.refresh_task = None
            
            if self.current_session:
                self.supabase.auth.sign_out()
            
            # Clear stored credentials file
            if self.auth_file.exists():
                self.auth_file.unlink()
            
            # Clear authentication state
            self.current_session = None
            self.current_user = None
            self.current_tenant_id = None
            self.session_expires_at = None
            self.refresh_token = None
            
            logger.info("User signed out successfully")
            
        except Exception as e:
            logger.error(f"Error signing out: {e}")
    
    def get_authenticated_client(self) -> Optional[Client]:
        """
        Get a Supabase client with authentication headers
        
        Returns:
            Authenticated Supabase client if available
        """
        if not self.is_authenticated():
            return None
        
        # Create new client with authenticated headers
        auth_client = create_client(self.supabase_url, self.supabase_key)
        
        # Set the session on the client
        if self.current_session:
            auth_client.auth._session = self.current_session
        
        return auth_client
    
    def get_auth_headers(self) -> Dict[str, str]:
        """
        Get headers for authenticated requests
        
        Returns:
            Dictionary with authorization headers
        """
        if self.current_session:
            return {
                'Authorization': f'Bearer {self.current_session.access_token}',
                'apikey': self.supabase_key
            }
        return {
            'apikey': self.supabase_key
        }
    
    async def get_tenant_info(self, tenant_id: str = None) -> Optional[Dict[str, Any]]:
        """
        Get tenant information
        
        Args:
            tenant_id: Optional tenant ID (defaults to current tenant)
            
        Returns:
            Tenant information if found, None otherwise
        """
        try:
            target_tenant_id = tenant_id or self.current_tenant_id
            
            if not target_tenant_id:
                logger.error("No tenant ID provided or current tenant")
                return None
            
            tenant_response = self.supabase.table('tenants').select('*').eq('id', target_tenant_id).single().execute()
            
            if tenant_response.data:
                return tenant_response.data
            else:
                logger.error(f"Tenant {target_tenant_id} not found")
                return None
                
        except Exception as e:
            logger.error(f"Error getting tenant info: {e}")
            return None
    
    async def ensure_authenticated_or_reauth(self, email: str = None, password: str = None) -> Dict[str, Any]:
        """
        Ensure authentication is valid, or attempt re-authentication
        
        This method is designed for sync services to call when they encounter 401 errors.
        
        Args:
            email: Optional email for re-authentication
            password: Optional password for re-authentication
            
        Returns:
            Authentication status and token information
        """
        try:
            # First, check if current session is valid
            if self.is_authenticated():
                # Check if token is about to expire (within 5 minutes)
                if self.session_expires_at:
                    time_until_expiry = (self.session_expires_at - datetime.utcnow()).total_seconds()
                    if time_until_expiry > 300:  # More than 5 minutes left
                        logger.debug("Authentication is valid and not expiring soon")
                        return {
                            'success': True,
                            'action': 'none',
                            'access_token': self.current_session.access_token,
                            'expires_in_seconds': int(time_until_expiry)
                        }
            
            # Try to refresh the session first
            logger.info("Attempting to refresh authentication session")
            refresh_result = await self.refresh_session()
            if refresh_result['success']:
                logger.info("Session refreshed successfully")
                return {
                    'success': True,
                    'action': 'refreshed',
                    'access_token': refresh_result.get('access_token'),
                    'expires_at': refresh_result.get('expires_at')
                }
            
            # If refresh failed and we have credentials, try re-authentication
            if email and password:
                logger.info("Refresh failed, attempting re-authentication")
                auth_result = await self.authenticate_with_email(email, password)
                if auth_result['success']:
                    logger.info("Re-authentication successful")
                    return {
                        'success': True,
                        'action': 'reauthenticated',
                        'access_token': auth_result.get('access_token'),
                        'expires_at': auth_result.get('expires_at')
                    }
            
            logger.error("Authentication recovery failed")
            return {
                'success': False,
                'error': 'Authentication recovery failed - manual login required',
                'action': 'manual_login_required'
            }
            
        except Exception as e:
            logger.error(f"Error in authentication recovery: {e}")
            return {
                'success': False,
                'error': str(e),
                'action': 'error'
            }
    
    def get_sync_compatible_client(self) -> Optional[Client]:
        """
        Get a Supabase client configured for sync operations
        
        Returns:
            Configured Supabase client or None if not authenticated
        """
        if not self.is_authenticated():
            logger.warning("Cannot create sync client - not authenticated")
            return None
        
        return self.get_authenticated_client()


# Global authentication service instance
auth_service: Optional[AuthService] = None

def get_auth_service() -> Optional[AuthService]:
    """
    Get the global authentication service instance
    """
    return auth_service

def initialize_auth_service(supabase_url: str, supabase_key: str) -> AuthService:
    """
    Initialize the global authentication service
    
    Args:
        supabase_url: Supabase project URL
        supabase_key: Supabase anonymous key
        
    Returns:
        AuthService instance
    """
    global auth_service
    
    if auth_service is not None:
        logger.warning("Auth service already initialized")
        return auth_service
    
    auth_service = AuthService(supabase_url, supabase_key)
    logger.info("Global auth service initialized")
    
    return auth_service