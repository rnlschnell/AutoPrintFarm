"""
Cloudflare Tunnel Service for Remote Access

This service manages the Cloudflare Tunnel connection for secure remote access
to the PrintFarmSoftware instance running on Raspberry Pi.
"""

import os
import logging
import asyncio
import subprocess
import json
import uuid
from typing import Optional, Dict, Any
from pathlib import Path
from datetime import datetime
import aiohttp

from supabase import create_client, Client

logger = logging.getLogger(__name__)


class TunnelService:
    """
    Service for managing Cloudflare Tunnel provisioning and lifecycle
    """

    def __init__(
        self,
        provisioning_url: str,
        supabase_url: str,
        supabase_key: str,
        config_dir: str = None
    ):
        """
        Initialize tunnel service

        Args:
            provisioning_url: URL of the Cloudflare Worker provisioning service
            supabase_url: Supabase project URL
            supabase_key: Supabase anonymous key
            config_dir: Directory for cloudflared configuration (default: ~/.cloudflared)
        """
        self.provisioning_url = provisioning_url
        self.supabase: Client = create_client(supabase_url, supabase_key)

        # Configuration
        if config_dir is None:
            config_dir = os.path.expanduser("~/.cloudflared")
        self.config_dir = Path(config_dir)
        self.config_file = self.config_dir / "config.yml"
        self.credentials_file = self.config_dir / "credentials.json"

        # Tunnel state
        self.tunnel_id: Optional[str] = None
        self.tunnel_process: Optional[subprocess.Popen] = None
        self.subdomain: Optional[str] = None
        self.is_active: bool = False
        self.heartbeat_task: Optional[asyncio.Task] = None
        self.auth_token: Optional[str] = None

        # Ensure config directory exists
        self._ensure_config_directory()

        # Load existing tunnel config if available
        self._load_existing_config()

        logger.info(f"Tunnel service initialized with provisioning URL: {provisioning_url}")

    def _ensure_config_directory(self):
        """Create cloudflared configuration directory if it doesn't exist"""
        self.config_dir.mkdir(parents=True, exist_ok=True)
        logger.debug(f"Config directory ensured at: {self.config_dir}")

    def _load_existing_config(self):
        """Load tunnel ID and subdomain from existing config file if it exists"""
        if self.config_file.exists():
            try:
                import yaml
                with open(self.config_file, 'r') as f:
                    config = yaml.safe_load(f)
                    self.tunnel_id = config.get('tunnel')
                    logger.info(f"Loaded existing tunnel ID from config: {self.tunnel_id}")
            except Exception as e:
                logger.warning(f"Could not load existing config: {e}")

    def get_pi_identifier(self) -> str:
        """
        Get unique hardware identifier for this Raspberry Pi

        Uses the following priority:
        1. Raspberry Pi serial number (preferred)
        2. MAC address (fallback)
        3. Random UUID (last resort)

        Returns:
            Unique hardware identifier string
        """
        # Try to get Raspberry Pi serial number
        try:
            with open('/proc/cpuinfo', 'r') as f:
                for line in f:
                    if line.startswith('Serial'):
                        serial = line.split(':')[1].strip()
                        if serial and serial != '0000000000000000':
                            logger.info(f"Using Pi serial number as identifier: {serial}")
                            return serial
        except Exception as e:
            logger.warning(f"Could not read Pi serial number: {e}")

        # Fallback to MAC address
        try:
            import netifaces
            interfaces = netifaces.interfaces()
            for iface in interfaces:
                if iface != 'lo':  # Skip loopback
                    addrs = netifaces.ifaddresses(iface)
                    if netifaces.AF_LINK in addrs:
                        mac = addrs[netifaces.AF_LINK][0].get('addr')
                        if mac:
                            logger.info(f"Using MAC address as identifier: {mac}")
                            return mac.replace(':', '')
        except Exception as e:
            logger.warning(f"Could not get MAC address: {e}")

        # Last resort: generate and persist a random UUID
        uuid_file = self.config_dir / "pi_identifier.txt"
        if uuid_file.exists():
            identifier = uuid_file.read_text().strip()
            logger.info(f"Using persisted UUID as identifier: {identifier}")
            return identifier
        else:
            identifier = str(uuid.uuid4())
            uuid_file.write_text(identifier)
            logger.warning(f"Generated new UUID as identifier: {identifier}")
            return identifier

    def set_auth_token(self, token: str):
        """
        Set authentication token for provisioning requests

        Args:
            token: JWT token from Supabase authentication
        """
        self.auth_token = token
        logger.debug("Authentication token set")

    async def provision_tunnel(self) -> Dict[str, Any]:
        """
        Request tunnel provisioning from the Cloudflare Worker

        Returns:
            Dictionary containing tunnel credentials and configuration

        Raises:
            Exception: If provisioning fails
        """
        if not self.auth_token:
            raise ValueError("Authentication token not set. Call set_auth_token() first.")

        pi_identifier = self.get_pi_identifier()

        payload = {
            "action": "provision_tunnel",
            "pi_identifier": pi_identifier
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.auth_token}"
        }

        logger.info(f"Requesting tunnel provisioning for Pi: {pi_identifier}")

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.provisioning_url,
                    json=payload,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        raise Exception(f"Provisioning failed with status {response.status}: {error_text}")

                    result = await response.json()

                    self.tunnel_id = result.get('tunnel_id')
                    self.subdomain = result.get('subdomain')

                    # Save tunnel credentials
                    tunnel_token = result.get('tunnel_token')
                    if tunnel_token:
                        self.credentials_file.write_text(tunnel_token)
                        logger.info(f"Tunnel credentials saved to: {self.credentials_file}")

                    # Create config.yml
                    self._create_tunnel_config()

                    logger.info(f"Tunnel provisioned successfully:")
                    logger.info(f"  - Tunnel ID: {self.tunnel_id}")
                    logger.info(f"  - Subdomain: {self.subdomain}")
                    logger.info(f"  - Full Domain: {result.get('full_domain')}")
                    logger.info(f"  - Existing: {result.get('existing', False)}")

                    return result

        except asyncio.TimeoutError:
            logger.error("Tunnel provisioning request timed out")
            raise Exception("Tunnel provisioning timed out after 30 seconds")
        except Exception as e:
            logger.error(f"Tunnel provisioning failed: {e}")
            raise

    def _create_tunnel_config(self):
        """Create cloudflared configuration file"""
        if not self.tunnel_id:
            raise ValueError("Tunnel ID not set. Provision tunnel first.")

        config = {
            'tunnel': self.tunnel_id,
            'credentials-file': str(self.credentials_file),
            'ingress': [
                # Catch-all rule must be last (no hostname = matches all)
                {
                    'service': 'http://localhost:8080'
                }
            ]
        }

        # Write YAML config
        import yaml
        with open(self.config_file, 'w') as f:
            yaml.dump(config, f, default_flow_style=False)

        logger.info(f"Tunnel config created at: {self.config_file}")

    async def start_tunnel(self) -> bool:
        """
        Start the cloudflared tunnel daemon

        Returns:
            True if tunnel started successfully, False otherwise
        """
        if self.is_active and self.tunnel_process:
            logger.warning("Tunnel already running")
            return True

        if not self.config_file.exists():
            logger.error("Tunnel config file not found. Provision tunnel first.")
            return False

        if not self.credentials_file.exists():
            logger.error("Tunnel credentials file not found. Provision tunnel first.")
            return False

        try:
            # Start cloudflared process
            cmd = [
                'cloudflared',
                'tunnel',
                '--config', str(self.config_file),
                'run',
                self.tunnel_id  # Explicitly specify tunnel ID
            ]

            logger.info(f"Starting cloudflared tunnel with command: {' '.join(cmd)}")

            self.tunnel_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,  # Redirect stderr to stdout
                universal_newlines=True,
                bufsize=1  # Line buffered
            )

            # Wait a bit to check if process started successfully
            await asyncio.sleep(2)

            if self.tunnel_process.poll() is None:
                self.is_active = True
                logger.info(f"Tunnel started successfully (PID: {self.tunnel_process.pid})")

                # Start output monitoring
                asyncio.create_task(self._monitor_tunnel_output())

                # Start heartbeat
                if not self.heartbeat_task or self.heartbeat_task.done():
                    self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())

                return True
            else:
                # Process exited
                stdout, stderr = self.tunnel_process.communicate()
                logger.error(f"Tunnel process exited immediately:")
                logger.error(f"  stdout: {stdout}")
                logger.error(f"  stderr: {stderr}")
                self.tunnel_process = None
                return False

        except Exception as e:
            logger.error(f"Failed to start tunnel: {e}")
            self.tunnel_process = None
            return False

    async def stop_tunnel(self):
        """Stop the cloudflared tunnel daemon"""
        if self.heartbeat_task and not self.heartbeat_task.done():
            self.heartbeat_task.cancel()
            try:
                await self.heartbeat_task
            except asyncio.CancelledError:
                pass

        if self.tunnel_process:
            logger.info("Stopping cloudflared tunnel...")
            self.tunnel_process.terminate()

            try:
                self.tunnel_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                logger.warning("Tunnel did not stop gracefully, killing process")
                self.tunnel_process.kill()

            self.tunnel_process = None
            self.is_active = False
            logger.info("Tunnel stopped")

    async def restart_tunnel(self) -> bool:
        """
        Restart the tunnel

        Returns:
            True if restart successful, False otherwise
        """
        logger.info("Restarting tunnel...")
        await self.stop_tunnel()
        await asyncio.sleep(1)
        return await self.start_tunnel()

    def get_status(self) -> Dict[str, Any]:
        """
        Get current tunnel status

        Returns:
            Dictionary containing tunnel status information
        """
        process_running = False
        if self.tunnel_process:
            process_running = self.tunnel_process.poll() is None

        return {
            'active': self.is_active and process_running,
            'tunnel_id': self.tunnel_id,
            'subdomain': self.subdomain,
            'full_domain': f"{self.subdomain}.autoprintfarm.com" if self.subdomain else None,
            'process_pid': self.tunnel_process.pid if self.tunnel_process and process_running else None,
            'config_exists': self.config_file.exists(),
            'credentials_exist': self.credentials_file.exists()
        }

    async def _monitor_tunnel_output(self):
        """Monitor cloudflared output and log errors"""
        if not self.tunnel_process or not self.tunnel_process.stdout:
            return

        try:
            while self.is_active and self.tunnel_process.poll() is None:
                line = await asyncio.to_thread(self.tunnel_process.stdout.readline)
                if line:
                    line = line.strip()
                    # Log errors and important messages
                    if 'ERR' in line or 'error' in line.lower():
                        logger.error(f"cloudflared: {line}")
                    elif 'registered tunnel connection' in line.lower():
                        logger.info(f"cloudflared: {line}")
                    elif 'connection' in line.lower() and ('established' in line.lower() or 'registered' in line.lower()):
                        logger.info(f"cloudflared: {line}")
        except Exception as e:
            logger.warning(f"Tunnel output monitoring stopped: {e}")

    async def _heartbeat_loop(self):
        """Background task to send periodic heartbeats to Supabase"""
        logger.info("Starting tunnel heartbeat loop")

        while self.is_active:
            try:
                if self.tunnel_id:
                    # Call Supabase RPC to update heartbeat
                    await asyncio.to_thread(
                        self.supabase.rpc,
                        'tunnel_heartbeat',
                        {'p_tunnel_id': self.tunnel_id}
                    )
                    logger.debug(f"Heartbeat sent for tunnel {self.tunnel_id}")
            except Exception as e:
                logger.warning(f"Failed to send heartbeat: {e}")

            # Wait 60 seconds before next heartbeat
            await asyncio.sleep(60)

        logger.info("Heartbeat loop stopped")


# Global tunnel service instance
_tunnel_service: Optional[TunnelService] = None


def initialize_tunnel_service(
    provisioning_url: str,
    supabase_url: str,
    supabase_key: str
) -> TunnelService:
    """
    Initialize and return the global tunnel service instance

    Args:
        provisioning_url: URL of the provisioning service
        supabase_url: Supabase project URL
        supabase_key: Supabase anonymous key

    Returns:
        TunnelService instance
    """
    global _tunnel_service
    _tunnel_service = TunnelService(provisioning_url, supabase_url, supabase_key)
    return _tunnel_service


def get_tunnel_service() -> Optional[TunnelService]:
    """
    Get the global tunnel service instance

    Returns:
        TunnelService instance or None if not initialized
    """
    return _tunnel_service


async def shutdown_tunnel_service():
    """Shutdown the tunnel service"""
    global _tunnel_service
    if _tunnel_service:
        await _tunnel_service.stop_tunnel()
        logger.info("Tunnel service shutdown complete")
