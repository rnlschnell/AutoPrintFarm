"""
Authentication API endpoints for Pi device setup
"""

from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, EmailStr
from typing import Dict, Any, Optional
import logging
from datetime import datetime

from ..services.auth_service import get_auth_service, AuthService
from ..services.config_service import get_config_service
from ..services.tunnel_service import get_tunnel_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Authentication"])

# Request/Response Models
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class LoginResponse(BaseModel):
    success: bool
    message: str
    user_id: Optional[str] = None
    tenant_id: Optional[str] = None
    expires_at: Optional[str] = None

class AuthStatus(BaseModel):
    authenticated: bool
    user_id: Optional[str] = None
    tenant_id: Optional[str] = None
    user_email: Optional[str] = None
    expires_at: Optional[str] = None
    needs_refresh: Optional[bool] = None

class RefreshResponse(BaseModel):
    success: bool
    message: str
    expires_at: Optional[str] = None

def get_auth_service_dep() -> AuthService:
    """Dependency to get auth service"""
    auth_service = get_auth_service()
    if not auth_service:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service not available"
        )
    return auth_service

@router.post("/login", response_model=LoginResponse)
async def login(
    request: LoginRequest,
    auth_service: AuthService = Depends(get_auth_service_dep)
):
    """
    Authenticate user with email and password
    
    This endpoint allows users to sign in on their Pi device using
    their existing Supabase credentials. The Pi will store the authentication
    tokens securely for ongoing sync operations.
    
    Args:
        request: Login credentials
        
    Returns:
        Authentication result with user and tenant information
    """
    try:
        logger.info(f"Authentication attempt for {request.email}")
        
        # Attempt authentication
        result = await auth_service.authenticate_with_email(
            request.email, 
            request.password
        )
        
        if result['success']:
            # Auto-configure tenant ID in Pi configuration
            tenant_id = result.get('tenant_id')
            if tenant_id:
                config_service = get_config_service()
                config_service.set_tenant_info(tenant_id)
                logger.info(f"Pi automatically configured for tenant {tenant_id}")

            # Provision and start tunnel if service is available
            tunnel_service = get_tunnel_service()
            if tunnel_service:
                try:
                    # Check if tunnel credentials already exist
                    status = tunnel_service.get_status()

                    if not status.get('credentials_exist'):
                        # Get auth token
                        access_token = auth_service.current_session.get('access_token')
                        if access_token:
                            logger.info("Provisioning tunnel for first-time login...")
                            tunnel_service.set_auth_token(access_token)

                            # Provision tunnel
                            tunnel_result = await tunnel_service.provision_tunnel()
                            logger.info(f"Tunnel provisioned: {tunnel_result.get('subdomain')}")

                            # Start tunnel
                            started = await tunnel_service.start_tunnel()
                            if started:
                                logger.info("Tunnel started successfully after login")
                            else:
                                logger.warning("Tunnel provisioned but failed to start")
                    elif not status.get('active'):
                        # Credentials exist but tunnel not running - start it
                        logger.info("Starting existing tunnel...")
                        access_token = auth_service.current_session.get('access_token')
                        if access_token:
                            tunnel_service.set_auth_token(access_token)
                        started = await tunnel_service.start_tunnel()
                        if started:
                            logger.info("Existing tunnel started successfully after login")
                except Exception as e:
                    # Don't fail login if tunnel provisioning fails
                    logger.error(f"Failed to provision/start tunnel: {e}")

            return LoginResponse(
                success=True,
                message="Authentication successful",
                user_id=result.get('user_id'),
                tenant_id=result.get('tenant_id'),
                expires_at=result.get('expires_at')
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=result.get('error', 'Authentication failed')
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error for {request.email}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal authentication error"
        )

@router.get("/status", response_model=AuthStatus)
async def get_auth_status(
    auth_service: AuthService = Depends(get_auth_service_dep)
):
    """
    Get current authentication status
    
    Returns information about the current authenticated user,
    including whether the session is valid and if a refresh is needed.
    
    Returns:
        Current authentication status and user information
    """
    try:
        is_authenticated = auth_service.is_authenticated()
        
        if is_authenticated:
            # Check if refresh is needed (within 30 minutes of expiry)
            needs_refresh = False
            if auth_service.session_expires_at:
                time_until_expiry = (auth_service.session_expires_at - datetime.utcnow()).total_seconds()
                needs_refresh = time_until_expiry < 1800  # 30 minutes
            
            return AuthStatus(
                authenticated=True,
                user_id=auth_service.get_current_user_id(),
                tenant_id=auth_service.get_current_tenant_id(),
                user_email=auth_service.current_user.email if auth_service.current_user else None,
                expires_at=auth_service.session_expires_at.isoformat() if auth_service.session_expires_at else None,
                needs_refresh=needs_refresh
            )
        else:
            return AuthStatus(
                authenticated=False
            )
            
    except Exception as e:
        logger.error(f"Error getting auth status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error retrieving authentication status"
        )

@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token(
    auth_service: AuthService = Depends(get_auth_service_dep)
):
    """
    Manually refresh the authentication token
    
    Forces a refresh of the current authentication token if a valid
    refresh token is available. This is typically handled automatically,
    but can be triggered manually if needed.
    
    Returns:
        Refresh operation result
    """
    try:
        if not auth_service.is_authenticated():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated"
            )
        
        result = await auth_service.refresh_session()
        
        if result['success']:
            return RefreshResponse(
                success=True,
                message=result.get('message', 'Token refreshed successfully'),
                expires_at=result.get('expires_at')
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=result.get('error', 'Token refresh failed')
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token refresh error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Token refresh error"
        )

@router.post("/logout")
async def logout(
    auth_service: AuthService = Depends(get_auth_service_dep)
):
    """
    Sign out the current user
    
    Clears all stored authentication data and signs out the user.
    The Pi will need to be re-authenticated before sync operations
    can continue.
    
    Returns:
        Logout confirmation
    """
    try:
        await auth_service.sign_out()
        
        return {
            "success": True,
            "message": "Successfully signed out"
        }
        
    except Exception as e:
        logger.error(f"Logout error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Logout error"
        )

@router.get("/tenant-info")
async def get_tenant_info(
    auth_service: AuthService = Depends(get_auth_service_dep)
):
    """
    Get information about the authenticated tenant
    
    Returns detailed information about the tenant that the
    authenticated user belongs to.
    
    Returns:
        Tenant information
    """
    try:
        if not auth_service.is_authenticated():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required"
            )
        
        tenant_info = await auth_service.get_tenant_info()
        
        if tenant_info:
            return {
                "success": True,
                "tenant": {
                    "id": tenant_info.get("id"),
                    "name": tenant_info.get("name"),
                    "is_active": tenant_info.get("is_active", False),
                    "created_at": tenant_info.get("created_at")
                }
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant information not found"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting tenant info: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error retrieving tenant information"
        )

@router.get("/health")
async def auth_health_check():
    """
    Comprehensive authentication service health check
    
    Returns detailed health status including authentication state,
    circuit breaker status, and session expiry information.
    
    Returns:
        Detailed health status for monitoring
    """
    try:
        auth_service = get_auth_service()
        
        if auth_service:
            # Get comprehensive health status
            health_status = auth_service.get_auth_health_status()
            return {
                "status": "healthy" if health_status['healthy'] else "degraded",
                "service": "auth",
                **health_status
            }
        else:
            return {
                "status": "critical",
                "service": "auth",
                "healthy": False,
                "reason": "Auth service not initialized",
                "timestamp": datetime.utcnow().isoformat()
            }
            
    except Exception as e:
        logger.error(f"Auth health check error: {e}")
        return {
            "status": "critical",
            "service": "auth",
            "healthy": False,
            "reason": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }

@router.post("/recover")
async def force_auth_recovery(
    auth_service: AuthService = Depends(get_auth_service_dep)
):
    """
    Force authentication recovery
    
    This endpoint can be used to manually trigger authentication recovery
    when the system is in a degraded state.
    
    Returns:
        Recovery operation result
    """
    try:
        logger.info("Manual authentication recovery requested")
        
        recovery_result = await auth_service.ensure_authenticated_or_reauth()
        
        return {
            "success": recovery_result['success'],
            "action": recovery_result.get('action'),
            "message": recovery_result.get('error') if not recovery_result['success'] else "Recovery completed",
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Auth recovery error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication recovery failed"
        )

class SessionTokenRequest(BaseModel):
    access_token: str
    tenant_id: str
    user_id: str
    user_email: str
    expires_at: str

@router.post("/session-import")
async def import_session_token(
    request: SessionTokenRequest,
    auth_service: AuthService = Depends(get_auth_service_dep)
):
    """
    Import a session token from external authentication
    
    This endpoint allows importing a valid session token obtained from the frontend
    to establish authentication on the Pi when direct auth fails.
    
    Args:
        request: Session token details
        
    Returns:
        Import result
    """
    try:
        logger.info(f"Session token import requested for {request.user_email}")
        
        # Validate the token format
        import jwt
        try:
            payload = jwt.decode(request.access_token, options={"verify_signature": False})
            logger.info(f"Token payload validation successful for user {payload.get('sub')}")
        except Exception as e:
            logger.error(f"Invalid token format: {e}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid token format"
            )
        
        # Create a mock session object
        from datetime import datetime
        try:
            expires_at_dt = datetime.fromisoformat(request.expires_at.replace('Z', '+00:00').replace('+00:00', ''))
        except:
            expires_at_dt = datetime.utcnow() + timedelta(hours=1)  # Default 1 hour
        
        # Set up the session in auth service
        mock_session = type('Session', (), {
            'access_token': request.access_token,
            'refresh_token': None,
            'expires_at': int(expires_at_dt.timestamp())
        })()
        
        mock_user = type('User', (), {
            'id': request.user_id,
            'email': request.user_email
        })()
        
        # Import the session
        auth_service.current_session = mock_session
        auth_service.current_user = mock_user
        auth_service.current_tenant_id = request.tenant_id
        auth_service.session_expires_at = expires_at_dt
        auth_service._auth_failure_count = 0  # Reset failures
        
        # Save the credentials
        auth_service._save_credentials()
        
        logger.info(f"Successfully imported session for tenant {request.tenant_id}")
        
        return {
            "success": True,
            "message": "Session imported successfully",
            "authenticated": True,
            "tenant_id": request.tenant_id,
            "user_id": request.user_id,
            "user_email": request.user_email,
            "expires_at": request.expires_at,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Session import error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Session import failed"
        )

@router.get("/debug")
async def auth_debug_info(
    auth_service: AuthService = Depends(get_auth_service_dep)
):
    """
    Get detailed authentication debugging information

    Returns:
        Comprehensive debug information
    """
    try:
        # Test direct Supabase connection
        import requests

        supabase_test = {
            "api_accessible": False,
            "auth_endpoint_accessible": False,
            "api_error": None,
            "auth_error": None
        }

        # Test API access
        # NOTE: Using printers endpoint only for connectivity testing (printers are not synced to Supabase)
        try:
            api_response = requests.get(
                "https://rippurqgfesmtoovxidz.supabase.co/rest/v1/printers",
                headers={"apikey": auth_service.supabase_key},
                timeout=10
            )
            supabase_test["api_accessible"] = api_response.status_code == 200
            if api_response.status_code != 200:
                supabase_test["api_error"] = api_response.text
        except Exception as e:
            supabase_test["api_error"] = str(e)

        # Test auth endpoint
        try:
            auth_response = requests.post(
                "https://rippurqgfesmtoovxidz.supabase.co/auth/v1/token?grant_type=password",
                headers={
                    "apikey": auth_service.supabase_key,
                    "Content-Type": "application/json"
                },
                json={"email": "test@example.com", "password": "test"},
                timeout=10
            )
            supabase_test["auth_endpoint_accessible"] = auth_response.status_code in [200, 400, 401]  # Any response means accessible
            if auth_response.status_code not in [200, 400, 401]:
                supabase_test["auth_error"] = auth_response.text
        except Exception as e:
            supabase_test["auth_error"] = str(e)

        # Get current auth state
        auth_health = auth_service.get_auth_health_status()

        return {
            "auth_service_status": auth_health,
            "supabase_connectivity": supabase_test,
            "configuration": {
                "supabase_url": auth_service.supabase_url,
                "has_supabase_key": bool(auth_service.supabase_key),
                "key_length": len(auth_service.supabase_key) if auth_service.supabase_key else 0
            },
            "stored_credentials": {
                "has_stored_session": auth_service.current_session is not None,
                "has_stored_user": auth_service.current_user is not None,
                "has_tenant_id": auth_service.current_tenant_id is not None
            },
            "timestamp": datetime.utcnow().isoformat()
        }

    except Exception as e:
        logger.error(f"Auth debug error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Debug information gathering failed"
        )

# Phase 2: Subdomain Management Endpoints

class CheckSubdomainRequest(BaseModel):
    subdomain: str

class CheckSubdomainResponse(BaseModel):
    available: bool
    subdomain: str

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    company_name: str
    subdomain: Optional[str] = None  # Optional - will auto-generate if not provided

class SignupResponse(BaseModel):
    success: bool
    message: str
    user_id: Optional[str] = None
    tenant_id: Optional[str] = None
    subdomain: Optional[str] = None
    full_domain: Optional[str] = None

@router.post("/check-subdomain", response_model=CheckSubdomainResponse)
async def check_subdomain_availability(
    request: CheckSubdomainRequest,
    auth_service: AuthService = Depends(get_auth_service_dep)
):
    """
    Check if a subdomain is available for registration

    Validates subdomain format and checks availability in Supabase.
    Subdomain must be:
    - 3-63 characters long
    - Lowercase letters, numbers, and hyphens only
    - No leading or trailing hyphens

    Args:
        request: Subdomain to check

    Returns:
        Availability status
    """
    try:
        import re
        from supabase import create_client

        subdomain = request.subdomain.lower().strip()

        # Validate format
        if not re.match(r'^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$', subdomain):
            return CheckSubdomainResponse(
                available=False,
                subdomain=subdomain
            )

        # Check availability via Supabase RPC
        supabase = create_client(auth_service.supabase_url, auth_service.supabase_key)
        result = supabase.rpc('check_subdomain_available', {'p_subdomain': subdomain}).execute()

        available = result.data if result.data is not None else False

        return CheckSubdomainResponse(
            available=available,
            subdomain=subdomain
        )

    except Exception as e:
        logger.error(f"Error checking subdomain availability: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error checking subdomain availability"
        )

@router.post("/signup", response_model=SignupResponse)
async def signup_with_subdomain(
    request: SignupRequest,
    auth_service: AuthService = Depends(get_auth_service_dep)
):
    """
    Sign up a new user with subdomain selection

    Creates a new tenant and user account. If subdomain is not provided,
    auto-generates one from the company name. After successful signup,
    claims the subdomain for the tenant.

    Args:
        request: Signup details including email, password, and optional subdomain

    Returns:
        Signup result with user, tenant, and subdomain information
    """
    try:
        from supabase import create_client
        import re

        supabase = create_client(auth_service.supabase_url, auth_service.supabase_key)

        # Generate subdomain if not provided
        subdomain = request.subdomain
        if not subdomain:
            # Auto-generate from company name
            base_subdomain = re.sub(r'[^a-z0-9]+', '-', request.company_name.lower())
            base_subdomain = re.sub(r'^-+|-+$', '', base_subdomain)
            timestamp = datetime.utcnow().strftime('%s')[-6:]  # Last 6 digits of timestamp
            subdomain = f"{base_subdomain}-{timestamp}"
        else:
            subdomain = subdomain.lower().strip()

        # Validate subdomain format
        if not re.match(r'^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$', subdomain):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid subdomain format. Use only lowercase letters, numbers, and hyphens (3-63 characters)."
            )

        # Check subdomain availability
        availability_result = supabase.rpc('check_subdomain_available', {'p_subdomain': subdomain}).execute()
        if not availability_result.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Subdomain '{subdomain}' is already taken"
            )

        # Create user account via Supabase Auth
        auth_response = supabase.auth.sign_up({
            "email": request.email,
            "password": request.password
        })

        if not auth_response.user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create user account"
            )

        user_id = auth_response.user.id

        # Create tenant
        tenant_data = {
            "company_name": request.company_name,
            "subdomain": subdomain,
            "is_active": True
        }

        tenant_response = supabase.table('tenants').insert(tenant_data).execute()

        if not tenant_response.data or len(tenant_response.data) == 0:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create tenant"
            )

        tenant_id = tenant_response.data[0]['id']

        # Create profile linking user to tenant
        profile_data = {
            "id": user_id,
            "tenant_id": tenant_id,
            "email": request.email,
            "first_name": request.first_name,
            "last_name": request.last_name,
            "role": "admin"
        }

        supabase.table('profiles').insert(profile_data).execute()

        # Claim the subdomain (stores subdomain_claimed_at timestamp)
        claim_result = supabase.rpc('claim_subdomain', {
            'p_tenant_id': tenant_id,
            'p_subdomain': subdomain
        }).execute()

        if not claim_result.data:
            logger.warning(f"Subdomain claim RPC returned no data for {subdomain}")

        logger.info(f"Successfully created account for {request.email} with subdomain {subdomain}")

        return SignupResponse(
            success=True,
            message="Account created successfully",
            user_id=user_id,
            tenant_id=tenant_id,
            subdomain=subdomain,
            full_domain=f"{subdomain}.autoprintfarm.com"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signup error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Signup failed: {str(e)}"
        )