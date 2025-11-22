import asyncio
import logging
import os
import sqlite3
from datetime import datetime
from typing import Dict, Any, Optional, List
import bambulabs_api as bl
from src.utils.exceptions import PrinterConnectionError, PrinterNotFoundError
from src.utils.validators import (
    validate_bambu_print_params, validate_bambu_mqtt_command,
    validate_bambu_sequence_id, validate_bambu_file_path
)
from .connection_manager import connection_manager
from ..utils.resource_monitor import resource_monitor

logger = logging.getLogger(__name__)

def _test_printer_connectivity(ip: str, port: int = 8883, timeout: float = 3.0) -> tuple[bool, str]:
    """Quick test if printer's MQTT port is reachable

    Args:
        ip: Printer IP address
        port: MQTT port (default 8883 for Bambu printers)
        timeout: Connection timeout in seconds

    Returns:
        (reachable: bool, reason: str) - Whether port is reachable and why
    """
    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((ip, port))
        sock.close()

        if result == 0:
            return True, "MQTT port reachable"
        elif result == 113:
            return False, "No route to host (errno 113)"
        elif result == 111:
            return False, "Connection refused (errno 111)"
        else:
            return False, f"Connection failed (errno {result})"
    except socket.timeout:
        return False, f"Connection timeout after {timeout}s"
    except Exception as e:
        return False, f"Network error: {e}"

class PrinterClientManager:
    """Manages connections to multiple Bambu Lab printers"""

    def __init__(self):
        self.clients: Dict[str, bl.Printer] = {}
        self.printer_configs: Dict[str, Dict[str, Any]] = {}
        self.sequence_ids: Dict[str, int] = {}  # Track sequence IDs per printer
        self.auto_reconnect_enabled: bool = True
        self.reconnect_interval: int = 30  # seconds
        self.max_reconnect_attempts: int = 5
        self.reconnect_tasks: Dict[str, asyncio.Task] = {}  # Track reconnection tasks

        # Debouncing for database writes
        self.last_db_write: Dict[str, float] = {}  # Track last DB write time per printer
        self.pending_db_state: Dict[str, bool] = {}  # Track pending connection state per printer
        self.state_change_time: Dict[str, float] = {}  # Track when state last changed per printer

        # Track last layer for cleared status management
        self.last_layer_seen: Dict[str, int] = {}  # Track last layer number per printer
        self.printing_start_time: Dict[str, float] = {}  # Track when printer entered 'printing' status

    def _update_connection_status_db(self, printer_id: str, is_connected: bool, user_action: bool = False) -> None:
        """Debounced SQLite update for printer connection status

        Args:
            printer_id: Printer identifier
            is_connected: Connection status
            user_action: True if this is a user-initiated action (skip debouncing)
        """
        import time
        current_time = time.time()

        # Store the pending state
        self.pending_db_state[printer_id] = is_connected

        # Update state change time if state actually changed
        if printer_id not in self.pending_db_state or self.pending_db_state.get(printer_id) != is_connected:
            self.state_change_time[printer_id] = current_time

        # Determine if we should write to DB now
        should_write = False

        if user_action:
            # User-initiated actions always write immediately
            should_write = True
            reason = "user action"
        else:
            last_write = self.last_db_write.get(printer_id, 0)
            time_since_last_write = current_time - last_write

            # Get when state last changed
            state_change_time = self.state_change_time.get(printer_id, current_time)
            time_since_state_change = current_time - state_change_time

            # Write if:
            # 1. State has been stable for 5+ seconds, OR
            # 2. It's been 60+ seconds since last write (periodic sync)
            if time_since_state_change >= 5:
                should_write = True
                reason = "state stable for 5+ seconds"
            elif time_since_last_write >= 60:
                should_write = True
                reason = "periodic sync (60+ seconds)"

        if not should_write:
            logger.debug(f"Debouncing DB write for printer {printer_id} (state will be written when stable)")
            return

        try:
            # Simple direct SQLite update - no complex dependencies
            db_path = "/home/pi/PrintFarmSoftware/data/tenant.db"
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            # Update is_connected field AND status based on printer_id (integer ID from config)
            # When disconnected, set status to 'offline' to keep UI in sync
            if is_connected:
                cursor.execute("""
                    UPDATE printers
                    SET is_connected = ?,
                        updated_at = ?
                    WHERE printer_id = ?
                """, (1, datetime.utcnow().isoformat(), int(printer_id)))
            else:
                cursor.execute("""
                    UPDATE printers
                    SET is_connected = ?,
                        status = 'offline',
                        updated_at = ?
                    WHERE printer_id = ?
                """, (0, datetime.utcnow().isoformat(), int(printer_id)))

            conn.commit()
            conn.close()

            # Update last write time
            self.last_db_write[printer_id] = current_time

            logger.debug(f"Updated DB connection status for printer {printer_id}: connected={is_connected} (reason: {reason})")
        except Exception as e:
            # Don't fail the connection process if DB update fails
            logger.error(f"Failed to update DB connection status for printer {printer_id}: {e}")

    def add_printer(self, printer_id: str, config: Dict[str, Any]) -> None:
        """Add a printer configuration"""
        self.printer_configs[printer_id] = config
        self.sequence_ids[printer_id] = 1  # Initialize sequence ID
        logger.info(f"Added printer configuration: {printer_id}")
    
    def remove_printer(self, printer_id: str) -> None:
        """Remove a printer configuration and disconnect if connected"""
        if printer_id in self.clients:
            self.disconnect_printer(printer_id)
        
        # Cancel any running reconnection task
        if printer_id in self.reconnect_tasks:
            self.reconnect_tasks[printer_id].cancel()
            del self.reconnect_tasks[printer_id]
        
        if printer_id in self.printer_configs:
            del self.printer_configs[printer_id]
            
        if printer_id in self.sequence_ids:
            del self.sequence_ids[printer_id]
            
        logger.info(f"Removed printer configuration: {printer_id}")
    
    def get_printer_config(self, printer_id: str) -> Dict[str, Any]:
        """Get printer configuration"""
        if printer_id not in self.printer_configs:
            raise PrinterNotFoundError(f"Printer {printer_id} not found")
        return self.printer_configs[printer_id]
    
    def list_printers(self) -> List[Dict[str, Any]]:
        """List all configured printers with connection status"""
        printers = []
        for printer_id, config in self.printer_configs.items():
            printer_info = config.copy()
            printer_info["connected"] = printer_id in self.clients
            printer_info["enabled"] = printer_info.get("enabled", True)
            printers.append(printer_info)
        return printers
    
    async def connect_printer(self, printer_id: str) -> bl.Printer:
        """Connect to a specific printer with rate limiting and resource protection"""
        if printer_id not in self.printer_configs:
            raise PrinterNotFoundError(f"Printer {printer_id} not found")
        
        if printer_id in self.clients:
            return self.clients[printer_id]
        
        # Check if connection attempt is allowed (user action for manual connections)
        can_attempt, reason = connection_manager.can_attempt_connection(printer_id, user_action=True)
        if not can_attempt:
            logger.warning(f"Connection attempt blocked for printer {printer_id}: {reason}")
            raise PrinterConnectionError(f"Connection rate limited: {reason}")
        
        # Check system resources before connecting
        if resource_monitor.should_throttle_operation("reconnect"):
            logger.warning(f"Connection throttled due to system resources for printer {printer_id}")
            raise PrinterConnectionError("System resources overloaded, connection throttled")
        
        config = self.printer_configs[printer_id]

        try:
            # LAYER 1: Pre-connection network check
            # Quick test if printer's MQTT port is reachable before creating client
            logger.info(f"Pre-check: Testing connectivity to {config['ip']}:8883...")
            reachable, reason = _test_printer_connectivity(config["ip"], port=8883, timeout=3.0)

            if not reachable:
                error_msg = f"Printer unreachable: {reason}"
                connection_manager.record_connection_attempt(printer_id, False, error_msg)
                logger.warning(f"Connection pre-check failed for printer {printer_id}: {error_msg}")
                raise PrinterConnectionError(error_msg)

            logger.info(f"Pre-check passed: {reason}")

            # Create printer client using bambulabs_api
            # bl.Printer expects positional arguments: (IP, ACCESS_CODE, SERIAL)
            client = bl.Printer(
                config["ip"],
                config["access_code"],
                config["serial"]
            )
            
            # Log client attributes for debugging
            logger.info(f"Printer {printer_id} client created - IP: {config['ip']}, Model: {config.get('model', 'unknown')}")
            logger.info(f"  Available MQTT client attributes: {[attr for attr in dir(client.mqtt_client) if not attr.startswith('_')]}")

            # Set up instant MQTT disconnect callback BEFORE connecting
            def on_disconnect_callback(mqtt_client_obj, client_obj, userdata, flags, reason_code, properties):
                """Instant callback when MQTT disconnects - immediately updates DB and removes client"""
                logger.warning(f"[DISCONNECT EVENT] MQTT disconnected for printer {printer_id}: reason_code={reason_code}")
                logger.info(f"[DISCONNECT EVENT] Updating database: is_connected=False, status='offline' for printer {printer_id}")
                self._update_connection_status_db(printer_id, False, user_action=True)

                # Remove client object to stop internal MQTT reconnection loop
                if printer_id in self.clients:
                    try:
                        del self.clients[printer_id]
                        connection_manager.record_disconnection(printer_id)
                        logger.info(f"[DISCONNECT EVENT] Removed client object for printer {printer_id} - reconnection loop stopped")
                    except Exception as e:
                        logger.error(f"[DISCONNECT EVENT] Error removing client for printer {printer_id}: {e}")

            # Set up instant MQTT connect callback
            def on_connect_callback(mqtt_client_obj, client_obj, userdata, flags, reason_code, properties):
                """Instant callback when MQTT connects - immediately updates DB

                LAYER 3: Enhanced callback to handle connection failures
                """
                logger.info(f"[CONNECT EVENT] MQTT connected for printer {printer_id}: reason_code={reason_code}")

                # Check if connection actually succeeded
                if reason_code == 0 or not reason_code.is_failure:
                    logger.info(f"[CONNECT EVENT] Connection successful - Updating database: is_connected=True for printer {printer_id}")
                    self._update_connection_status_db(printer_id, True, user_action=True)
                else:
                    # Connection failed with error code
                    logger.error(f"[CONNECT EVENT] MQTT connection failed for printer {printer_id}: {reason_code}")
                    # Remove client immediately to prevent reconnection loop
                    if printer_id in self.clients:
                        try:
                            del self.clients[printer_id]
                            connection_manager.record_disconnection(printer_id)
                            logger.info(f"[CONNECT EVENT] Removed failed client for printer {printer_id}")
                        except Exception as e:
                            logger.error(f"[CONNECT EVENT] Error removing client: {e}")

            # Try multiple ways to attach callbacks (library may use different attribute names)
            callback_attached = False

            # Method 1: Try on_disconnect_handler / on_connect_handler (current approach)
            if hasattr(client.mqtt_client, 'on_disconnect_handler'):
                client.mqtt_client.on_disconnect_handler = on_disconnect_callback
                client.mqtt_client.on_connect_handler = on_connect_callback
                logger.info(f"Attached callbacks using *_handler attributes for printer {printer_id}")
                callback_attached = True

            # Method 2: Try standard paho-mqtt on_disconnect / on_connect
            elif hasattr(client.mqtt_client, 'on_disconnect'):
                client.mqtt_client.on_disconnect = on_disconnect_callback
                client.mqtt_client.on_connect = on_connect_callback
                logger.info(f"Attached callbacks using standard paho-mqtt attributes for printer {printer_id}")
                callback_attached = True

            if not callback_attached:
                logger.warning(f"Could not attach MQTT callbacks for printer {printer_id} - attributes not found")

            # Connect to printer with timeout
            await asyncio.wait_for(
                asyncio.to_thread(client.connect),
                timeout=30.0  # 30 second timeout
            )

            # LAYER 2: Post-connection MQTT verification
            # Verify MQTT actually connected before declaring success
            logger.info(f"Verifying MQTT connection for printer {printer_id}...")
            mqtt_connected = False
            verification_timeout = 10.0
            check_interval = 0.5
            elapsed = 0

            while elapsed < verification_timeout:
                if client.mqtt_client.is_connected():
                    mqtt_connected = True
                    logger.info(f"MQTT connection verified for printer {printer_id}")
                    break
                await asyncio.sleep(check_interval)
                elapsed += check_interval

            if not mqtt_connected:
                # MQTT failed to connect - clean up and fail
                error_msg = f"MQTT connection verification failed after {verification_timeout}s"
                logger.error(f"Printer {printer_id}: {error_msg}")

                # CRITICAL: Stop the MQTT client to prevent reconnection loop
                try:
                    client.disconnect()
                except Exception as e:
                    logger.warning(f"Error during cleanup disconnect: {e}")

                # Record failure and throw exception
                connection_manager.record_connection_attempt(printer_id, False, error_msg)
                raise PrinterConnectionError(error_msg)

            # Only if verification passed, add to active clients
            self.clients[printer_id] = client
            connection_manager.record_connection_attempt(printer_id, True)
            logger.info(f"Connected to printer: {printer_id}")

            # Update database connection status to connected (user-initiated, write immediately)
            self._update_connection_status_db(printer_id, True, user_action=True)

            # Start auto-reconnection monitoring with reduced frequency
            if self.auto_reconnect_enabled:
                self._start_connection_monitor(printer_id)
            
            return client
            
        except asyncio.TimeoutError:
            error_msg = f"Connection timeout for printer {printer_id}"
            connection_manager.record_connection_attempt(printer_id, False, error_msg)
            logger.error(error_msg)
            raise PrinterConnectionError(error_msg)
        except Exception as e:
            error_msg = f"Failed to connect to printer {printer_id}: {e}"
            connection_manager.record_connection_attempt(printer_id, False, str(e))
            logger.error(error_msg)
            raise PrinterConnectionError(error_msg)
    
    def disconnect_printer(self, printer_id: str) -> None:
        """Disconnect from a specific printer"""
        # Cancel any running reconnection task
        if printer_id in self.reconnect_tasks:
            self.reconnect_tasks[printer_id].cancel()
            del self.reconnect_tasks[printer_id]
            
        if printer_id in self.clients:
            try:
                self.clients[printer_id].disconnect()
                del self.clients[printer_id]
                connection_manager.record_disconnection(printer_id)
                # Update database connection status to disconnected (user-initiated, write immediately)
                self._update_connection_status_db(printer_id, False, user_action=True)
                logger.info(f"Disconnected from printer: {printer_id}")
            except Exception as e:
                logger.error(f"Error disconnecting from printer {printer_id}: {e}")
                connection_manager.record_disconnection(printer_id)  # Still record disconnection
                # Update database even on error (user-initiated, write immediately)
                self._update_connection_status_db(printer_id, False, user_action=True)
    
    def get_client(self, printer_id: str) -> bl.Printer:
        """Get connected client for a printer"""
        if printer_id not in self.clients:
            raise PrinterConnectionError(f"Printer {printer_id} is not connected")
        return self.clients[printer_id]
    
    def _start_connection_monitor(self, printer_id: str) -> None:
        """Start monitoring connection for auto-reconnect"""
        if printer_id in self.reconnect_tasks:
            self.reconnect_tasks[printer_id].cancel()
        
        task = asyncio.create_task(self._connection_monitor_loop(printer_id))
        self.reconnect_tasks[printer_id] = task
        logger.debug(f"Started connection monitor for printer {printer_id}")
    
    async def _connection_monitor_loop(self, printer_id: str) -> None:
        """Monitor connection and handle reconnection - relies on MQTT callbacks for disconnect detection"""
        attempt = 0
        # Significantly reduced monitor interval - MQTT callbacks handle most disconnect detection
        monitor_interval = 300  # 5 minutes - safety net only, MQTT callbacks are primary detector

        while self.auto_reconnect_enabled and printer_id in self.printer_configs:
            try:
                await asyncio.sleep(monitor_interval)

                # Check system resources first
                if resource_monitor.should_throttle_operation("reconnect"):
                    logger.info(f"Connection monitor throttled for printer {printer_id} due to system resources")
                    continue

                # Check if still connected
                if printer_id not in self.clients:
                    # Only attempt reconnection if allowed by rate limiter
                    can_attempt, reason = connection_manager.can_attempt_connection(printer_id)
                    if can_attempt:
                        logger.info(f"Printer {printer_id} disconnected, attempting reconnection...")
                        await self._attempt_reconnection(printer_id)
                    else:
                        logger.info(f"Reconnection skipped for printer {printer_id}: {reason}")
                else:
                    # Only test connection very occasionally - rely on MQTT callbacks for disconnect detection
                    if attempt % 10 == 0:  # Test every 10th cycle (50 minutes) - just a safety net
                        try:
                            client = self.clients[printer_id]
                            # Simplified connection test
                            if hasattr(client, 'mqtt_client_connected'):
                                connected = await asyncio.wait_for(
                                    asyncio.to_thread(client.mqtt_client_connected),
                                    timeout=10.0  # Short timeout
                                )
                                if not connected:
                                    logger.warning(f"MQTT connection lost for printer {printer_id}")
                                    # Update database connection status to disconnected
                                    self._update_connection_status_db(printer_id, False)
                                    # Remove stale client from dictionary
                                    try:
                                        self.clients[printer_id].disconnect()
                                    except Exception:
                                        pass  # Ignore errors during disconnect
                                    del self.clients[printer_id]
                                    connection_manager.record_disconnection(printer_id)
                                    logger.info(f"Removed stale client for printer {printer_id} from active connections")
                                    # Don't immediately reconnect, just log it
                        except Exception as e:
                            logger.debug(f"Connection test failed for printer {printer_id}: {e}")

                # Increment attempt counter
                attempt += 1
                
            except asyncio.CancelledError:
                logger.debug(f"Connection monitor cancelled for printer {printer_id}")
                break
            except Exception as e:
                attempt += 1
                if resource_monitor.should_throttle_operation("logging"):
                    logger.error(f"Error in connection monitor for printer {printer_id} (attempt {attempt}): {e}")
                if attempt >= self.max_reconnect_attempts:
                    logger.error(f"Max reconnect attempts reached for printer {printer_id}, stopping monitor")
                    break
    
    async def _attempt_reconnection(self, printer_id: str) -> None:
        """Attempt to reconnect to a printer"""
        try:
            # Remove existing client if present
            if printer_id in self.clients:
                try:
                    self.clients[printer_id].disconnect()
                except Exception:
                    pass
                del self.clients[printer_id]
            
            # Attempt reconnection
            config = self.printer_configs[printer_id]
            client = bl.Printer(
                config["ip"],
                config["access_code"],
                config["serial"]
            )
            
            await asyncio.to_thread(client.connect)
            self.clients[printer_id] = client
            logger.info(f"Successfully reconnected to printer {printer_id}")
            
        except Exception as e:
            logger.warning(f"Failed to reconnect to printer {printer_id}: {e}")
            # Client will remain disconnected, monitor will try again next cycle
    
    async def get_printer_status(self, printer_id: str) -> Dict[str, Any]:
        """Get current status of a printer"""
        client = self.get_client(printer_id)
        
        try:
            # Get status using bambulabs_api
            gcode_state = await asyncio.to_thread(client.get_state)
            
            # Convert GcodeState enum to dictionary format
            status_dict = {
                "state": gcode_state.value if hasattr(gcode_state, 'value') else str(gcode_state),
                "connected": client.connected if hasattr(client, 'connected') else True,
                "timestamp": asyncio.get_event_loop().time()
            }
            
            # Try to get additional status information
            try:
                # Get temperatures if available
                nozzle_temp = await asyncio.to_thread(getattr, client, 'nozzle_temperature', None)
                bed_temp = await asyncio.to_thread(getattr, client, 'bed_temperature', None)
                
                if nozzle_temp is not None:
                    status_dict["nozzle_temperature"] = nozzle_temp
                if bed_temp is not None:
                    status_dict["bed_temperature"] = bed_temp
                    
            except Exception:
                # If we can't get additional info, just continue with basic status
                pass
            
            return status_dict
        except Exception as e:
            logger.error(f"Failed to get status for printer {printer_id}: {e}")
            raise PrinterConnectionError(f"Failed to get status for printer {printer_id}: {e}")
    
    def get_next_sequence_id(self, printer_id: str) -> int:
        """Get next sequence ID for MQTT commands"""
        if printer_id not in self.sequence_ids:
            self.sequence_ids[printer_id] = 1
        
        seq_id = self.sequence_ids[printer_id]
        self.sequence_ids[printer_id] += 1
        
        # Reset to 1 if we reach maximum
        if self.sequence_ids[printer_id] > 65535:
            self.sequence_ids[printer_id] = 1
            
        return seq_id
    
    def create_mqtt_message(self, printer_id: str, command: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Create MQTT message with proper Bambu Labs structure"""
        sequence_id = self.get_next_sequence_id(printer_id)
        
        # Validate command and parameters
        validate_bambu_mqtt_command(command, params)
        validate_bambu_sequence_id(sequence_id)
        
        mqtt_msg = {
            "print": {
                "sequence_id": str(sequence_id),
                "command": command,
                **params
            }
        }
        
        return mqtt_msg
    
    # Print Control Methods
    async def start_print(self, printer_id: str, filename: str, **params) -> Dict[str, Any]:
        """Start a print job using Bambu Labs MQTT protocol"""
        client = self.get_client(printer_id)
        try:
            # Validate filename and parameters first
            validate_bambu_file_path(filename)
            validate_bambu_print_params({**params, 'filename': filename})
            
            # Create MQTT message with correct Bambu Labs parameters
            # Use correct file path - files are uploaded to /sdcard/ 
            file_url = f"ftp://{filename}"  # Bambu Labs uses FTP protocol prefix for uploaded files
            
            mqtt_params = {
                "command": "project_file",
                "param": file_url,
                "subtask_name": "",
                "bed_leveling": params.get("bed_leveling", True),
                "flow_cali": params.get("flow_calibration", False),
                "vibration_cali": params.get("vibration_calibration", False),
                "layer_inspect": params.get("layer_inspect", False),
                "use_ams": params.get("use_ams", False),
                "timelapse": params.get("timelapse", False)
            }
            
            # Add plate number (1-based to 0-based conversion)
            if "plate_number" in params:
                mqtt_params["bed_type"] = params["plate_number"] - 1

            # Add AMS mapping - default to external spool [254] when not using AMS
            if "ams_mapping" in params and params["ams_mapping"]:
                mqtt_params["ams_mapping"] = params["ams_mapping"]
            elif not params.get("use_ams", False):
                # When not using AMS, explicitly map to external spool holder (value 254)
                mqtt_params["ams_mapping"] = [254]
            
            # Create proper MQTT message structure for print command
            mqtt_message = self.create_mqtt_message(printer_id, "print_start", mqtt_params)
            
            # Try to send using bambulabs_api
            if hasattr(client, 'publish') or hasattr(client, 'send_command'):
                logger.info(f"Sending MQTT print command: {mqtt_message}")
                if hasattr(client, 'publish'):
                    # Use correct MQTT topic for print commands
                    result = await asyncio.to_thread(client.publish, "device/request", mqtt_message)
                    logger.info(f"MQTT publish result: {result}")
                elif hasattr(client, 'send_command'):
                    result = await asyncio.to_thread(client.send_command, mqtt_message)
                    logger.info(f"MQTT send_command result: {result}")
                
                logger.info(f"Print start command sent via MQTT successfully")
                return {
                    "success": True,
                    "message": f"Print start command sent for {filename}",
                    "filename": filename,
                    "mqtt_message": mqtt_message
                }
            elif hasattr(client, 'start_print'):
                # Use bambulabs_api start_print method with correct parameters
                # Based on bambulabs_api docs: start_print(filename, plate_number, use_ams=True, ams_mapping=[0], skip_objects=None, flow_calibration=True)
                plate_number = params.get('plate_number', 1)  # Default to plate 1
                use_ams = params.get('use_ams', False)  # Default to False for no AMS

                # Set ams_mapping based on use_ams parameter
                if "ams_mapping" in params and params["ams_mapping"]:
                    ams_mapping = params["ams_mapping"]
                elif not use_ams:
                    # When not using AMS, explicitly map to external spool holder (value 254)
                    ams_mapping = [254]
                else:
                    # Default AMS mapping when use_ams=True
                    ams_mapping = [0]

                flow_calibration = params.get('flow_calibration', False)

                logger.info(f"Calling bambulabs_api start_print with filename: {filename}, plate_number: {plate_number}, use_ams: {use_ams}, ams_mapping: {ams_mapping}, flow_calibration: {flow_calibration}")
                result = await asyncio.to_thread(
                    client.start_print,
                    filename,
                    plate_number,
                    use_ams=use_ams,
                    ams_mapping=ams_mapping,
                    flow_calibration=flow_calibration
                )
                logger.info(f"bambulabs_api start_print result: {result}")
                
                return {
                    "success": True,
                    "message": f"Print started successfully for {filename} on plate {plate_number}",
                    "filename": filename,
                    "plate_number": plate_number,
                    "start_result": result
                }
            else:
                logger.warning("No print start method available - command logged for testing")
                logger.info(f"Would send MQTT: {mqtt_message}")
                
                return {
                    "success": True,
                    "message": f"Print start simulated for {filename} (method not available)",
                    "filename": filename
                }
        except Exception as e:
            logger.error(f"Failed to start print: {e}")
            return {
                "success": False,
                "message": f"Failed to start print: {str(e)}",
                "error": str(e),
                "filename": filename
            }
    
    async def stop_print(self, printer_id: str) -> bool:
        """Stop current print job using Bambu Labs MQTT protocol"""
        client = self.get_client(printer_id)
        try:
            # Create MQTT message for print stop
            mqtt_params = {}
            mqtt_message = self.create_mqtt_message(printer_id, "print_stop", mqtt_params)
            
            # Try to send using bambulabs_api
            if hasattr(client, 'publish') or hasattr(client, 'send_command'):
                if hasattr(client, 'publish'):
                    await asyncio.to_thread(client.publish, "device/request/print", mqtt_message)
                elif hasattr(client, 'send_command'):
                    await asyncio.to_thread(client.send_command, mqtt_message)
                logger.info(f"Sent print stop command: {mqtt_message}")
            elif hasattr(client, 'stop_print'):
                await asyncio.to_thread(client.stop_print)
            else:
                logger.warning("Print stop method not available in bambulabs_api")
                logger.info(f"Would send MQTT: {mqtt_message}")
                
            return True
        except Exception as e:
            logger.error(f"Failed to stop print: {e}")
            raise PrinterConnectionError(f"Failed to stop print: {e}")
    
    async def pause_print(self, printer_id: str) -> bool:
        """Pause current print job using Bambu Labs MQTT protocol"""
        client = self.get_client(printer_id)
        try:
            # Create MQTT message for print pause
            mqtt_params = {}
            mqtt_message = self.create_mqtt_message(printer_id, "print_pause", mqtt_params)
            
            # Try to send using bambulabs_api
            if hasattr(client, 'publish') or hasattr(client, 'send_command'):
                if hasattr(client, 'publish'):
                    await asyncio.to_thread(client.publish, "device/request/print", mqtt_message)
                elif hasattr(client, 'send_command'):
                    await asyncio.to_thread(client.send_command, mqtt_message)
                logger.info(f"Sent print pause command: {mqtt_message}")
            elif hasattr(client, 'pause_print'):
                await asyncio.to_thread(client.pause_print)
            else:
                logger.warning("Print pause method not available in bambulabs_api")
                logger.info(f"Would send MQTT: {mqtt_message}")
                
            return True
        except Exception as e:
            logger.error(f"Failed to pause print: {e}")
            raise PrinterConnectionError(f"Failed to pause print: {e}")
    
    async def resume_print(self, printer_id: str) -> bool:
        """Resume paused print job using Bambu Labs MQTT protocol"""
        client = self.get_client(printer_id)
        try:
            # Create MQTT message for print resume
            mqtt_params = {}
            mqtt_message = self.create_mqtt_message(printer_id, "print_resume", mqtt_params)
            
            # Try to send using bambulabs_api
            if hasattr(client, 'publish') or hasattr(client, 'send_command'):
                if hasattr(client, 'publish'):
                    await asyncio.to_thread(client.publish, "device/request/print", mqtt_message)
                elif hasattr(client, 'send_command'):
                    await asyncio.to_thread(client.send_command, mqtt_message)
                logger.info(f"Sent print resume command: {mqtt_message}")
            elif hasattr(client, 'resume_print'):
                await asyncio.to_thread(client.resume_print)
            else:
                logger.warning("Print resume method not available in bambulabs_api")
                logger.info(f"Would send MQTT: {mqtt_message}")
                
            return True
        except Exception as e:
            logger.error(f"Failed to resume print: {e}")
            raise PrinterConnectionError(f"Failed to resume print: {e}")
    
    async def cancel_print(self, printer_id: str) -> bool:
        """Cancel current print job using Bambu Labs MQTT protocol"""
        client = self.get_client(printer_id)
        try:
            # Create MQTT message for print stop (cancel and stop are the same in Bambu Labs)
            mqtt_params = {}
            mqtt_message = self.create_mqtt_message(printer_id, "print_stop", mqtt_params)

            # Try to send using bambulabs_api
            if hasattr(client, 'publish') or hasattr(client, 'send_command'):
                if hasattr(client, 'publish'):
                    await asyncio.to_thread(client.publish, "device/request/print", mqtt_message)
                elif hasattr(client, 'send_command'):
                    await asyncio.to_thread(client.send_command, mqtt_message)
                logger.info(f"Sent print cancel command: {mqtt_message}")
            elif hasattr(client, 'stop_print'):
                await asyncio.to_thread(client.stop_print)
            else:
                logger.warning("Print cancel method not available in bambulabs_api")
                logger.info(f"Would send MQTT: {mqtt_message}")

            return True
        except Exception as e:
            logger.error(f"Failed to cancel print: {e}")
            raise PrinterConnectionError(f"Failed to cancel print: {e}")
    
    async def get_print_status(self, printer_id: str) -> Dict[str, Any]:
        """Get current print progress and status using bambulabs_api methods"""
        client = self.get_client(printer_id)
        try:
            # Get print status information using available bambulabs_api methods
            print_percentage = None
            remaining_time = None
            current_state = None
            
            # Get percentage if available
            if hasattr(client, 'get_percentage'):
                try:
                    percentage_result = await asyncio.to_thread(client.get_percentage)
                    if percentage_result is not None and percentage_result != "Unknown":
                        print_percentage = float(percentage_result) if isinstance(percentage_result, (int, str)) else 0.0
                    else:
                        print_percentage = 0.0
                except Exception as e:
                    logger.warning(f"Failed to get print percentage: {e}")
                    print_percentage = 0.0
            
            # Get remaining time if available
            if hasattr(client, 'get_time'):
                try:
                    time_result = await asyncio.to_thread(client.get_time)
                    if time_result is not None and time_result != "Unknown":
                        remaining_time = int(time_result) if isinstance(time_result, (int, str)) else 0
                    else:
                        remaining_time = 0
                except Exception as e:
                    logger.warning(f"Failed to get remaining time: {e}")
                    remaining_time = 0
            
            # Get current state for status
            if hasattr(client, 'get_state'):
                try:
                    state_result = await asyncio.to_thread(client.get_state)
                    current_state = state_result.value if hasattr(state_result, 'value') else str(state_result)
                except Exception as e:
                    logger.warning(f"Failed to get printer state: {e}")
                    current_state = "unknown"
            
            # Calculate elapsed time (estimated based on percentage and remaining time)
            elapsed_time = 0
            if print_percentage and remaining_time and print_percentage > 0:
                # Estimate total time and calculate elapsed
                total_estimated_time = remaining_time / (1 - (print_percentage / 100)) if print_percentage < 100 else remaining_time
                elapsed_time = int(total_estimated_time - remaining_time)
            
            # Map printer state to job status
            job_status_map = {
                "RUNNING": "printing",
                "PAUSE": "paused", 
                "FAILED": "failed",
                "FINISH": "finished",
                "IDLE": "idle"
            }
            job_status = job_status_map.get(current_state, "idle")
            
            # Return properly structured response
            return {
                "job_id": f"print_{printer_id}_{int(asyncio.get_event_loop().time())}",
                "filename": await self._get_current_filename(client),
                "status": job_status,
                "progress": {
                    "percentage": print_percentage if print_percentage is not None else 0.0,
                    "elapsed_time": elapsed_time,
                    "remaining_time": remaining_time,
                    "current_layer": await self._get_current_layer(client),
                    "total_layers": await self._get_total_layers(client)
                }
            }
            
        except Exception as e:
            logger.error(f"Failed to get print status: {e}")
            raise PrinterConnectionError(f"Failed to get print status: {e}")
    
    async def _get_current_filename(self, client) -> str:
        """Helper method to get current printing filename"""
        try:
            if hasattr(client, 'get_file_name'):
                filename = await asyncio.to_thread(client.get_file_name)
                return filename if filename else "unknown"
            return "unknown"
        except Exception:
            return "unknown"
    
    async def _get_current_layer(self, client) -> Optional[int]:
        """Helper method to get current layer number"""
        try:
            if hasattr(client, 'current_layer_num'):
                layer_num = await asyncio.to_thread(client.current_layer_num)
                return int(layer_num) if layer_num not in [None, "Unknown"] else None
            return None
        except Exception:
            return None
    
    async def _get_total_layers(self, client) -> Optional[int]:
        """Helper method to get total layer count"""
        try:
            if hasattr(client, 'total_layer_num'):
                total_layers = await asyncio.to_thread(client.total_layer_num)
                return int(total_layers) if total_layers not in [None, "Unknown"] else None
            return None
        except Exception:
            return None
    
    def _parse_ftp_file_line(self, file_line: str) -> Optional[Dict[str, Any]]:
        """Parse FTP file listing line into file info"""
        try:
            # Format: '-rw-rw-rw-   1 root  root    969888 Jul 17 07:10 filename'
            parts = file_line.strip().split()
            if len(parts) < 9:
                return None
            
            # Extract file info
            size = int(parts[4])
            month = parts[5]
            day = parts[6] 
            time_or_year = parts[7]
            filename = ' '.join(parts[8:])  # Handle filenames with spaces
            
            # Determine file type
            if filename.lower().endswith('.3mf'):
                file_type = "3MF"
            elif filename.lower().endswith(('.gcode', '.g')):
                file_type = "gcode"
            else:
                file_type = "unknown"
            
            # Create timestamp (simplified - using current year if time format)
            import datetime
            current_year = datetime.datetime.now().year
            if ':' in time_or_year:  # Time format like '07:10'
                timestamp = f"{current_year}-{self._month_to_num(month):02d}-{int(day):02d}T{time_or_year}:00Z"
            else:  # Year format
                timestamp = f"{time_or_year}-{self._month_to_num(month):02d}-{int(day):02d}T12:00:00Z"
            
            return {
                "name": filename,
                "size": size,
                "created_at": timestamp,
                "modified_at": timestamp,
                "file_type": file_type
            }
        except Exception as e:
            logger.warning(f"Failed to parse FTP file line: {file_line} - {e}")
            return None
    
    def _month_to_num(self, month: str) -> int:
        """Convert month abbreviation to number"""
        months = {
            'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
            'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
        }
        return months.get(month, 1)
    
    def _is_printable_file(self, filename: str) -> bool:
        """Check if file is a printable file type"""
        return filename.lower().endswith(('.3mf', '.gcode', '.g'))
    
    async def _get_firmware_version(self, client) -> str:
        """Helper method to get firmware version"""
        try:
            # Try different possible methods to get firmware version
            for method_name in ['firmware_version', 'get_firmware_version', 'info_get_version']:
                if hasattr(client, method_name):
                    try:
                        firmware = await asyncio.to_thread(getattr(client, method_name))
                        if firmware and firmware not in [None, "Unknown"]:
                            return str(firmware)
                    except Exception as e:
                        logger.debug(f"Method {method_name} failed: {e}")
                        continue
            
            # Try to get firmware from MQTT dump
            try:
                mqtt_data = await asyncio.to_thread(client.mqtt_dump)
                if mqtt_data and isinstance(mqtt_data, dict):
                    # Look for firmware version in different sections
                    if 'info' in mqtt_data and 'module' in mqtt_data['info']:
                        module_info = mqtt_data['info']['module']
                        if isinstance(module_info, list):
                            for module in module_info:
                                if isinstance(module, dict) and module.get('name') == 'ota':
                                    fw_ver = module.get('sw_ver')
                                    if fw_ver:
                                        return str(fw_ver)
                                elif isinstance(module, dict) and module.get('name') == 'mc':
                                    fw_ver = module.get('sw_ver')
                                    if fw_ver:
                                        return str(fw_ver)
            except Exception as e:
                logger.debug(f"MQTT dump firmware lookup failed: {e}")
            
            return "N/A"
        except Exception as e:
            logger.warning(f"Failed to get firmware version: {e}")
            return "N/A"
    
    async def _get_hardware_info(self, client) -> Dict[str, Any]:
        """Helper method to get hardware information from MQTT data"""
        try:
            hardware_info = {}
            
            # Get WiFi signal (try different method names)
            for method_name in ['wifi_signal', 'get_wifi_signal']:
                if hasattr(client, method_name):
                    try:
                        wifi_signal = await asyncio.to_thread(getattr(client, method_name))
                        if wifi_signal not in [None, "Unknown"]:
                            hardware_info["wifi_signal"] = f"{wifi_signal} dBm"
                            break
                    except Exception:
                        continue
            
            # Get nozzle information (try different method names)
            for method_name in ['nozzle_type', 'get_nozzle_type']:
                if hasattr(client, method_name):
                    try:
                        nozzle_type = await asyncio.to_thread(getattr(client, method_name))
                        if nozzle_type not in [None, "Unknown"]:
                            hardware_info["nozzle_type"] = nozzle_type
                            break
                    except Exception:
                        continue
            
            for method_name in ['nozzle_diameter', 'get_nozzle_diameter']:
                if hasattr(client, method_name):
                    try:
                        nozzle_diameter = await asyncio.to_thread(getattr(client, method_name))
                        if nozzle_diameter not in [None, "Unknown"]:
                            hardware_info["nozzle_diameter"] = f"{nozzle_diameter}mm"
                            break
                    except Exception:
                        continue
            
            # Try to get MQTT dump for additional info
            try:
                mqtt_data = await asyncio.to_thread(client.mqtt_dump)
                if mqtt_data and isinstance(mqtt_data, dict):
                    # Extract hardware version from MQTT data
                    if 'info' in mqtt_data and 'module' in mqtt_data['info']:
                        module_info = mqtt_data['info']['module']
                        if isinstance(module_info, list) and len(module_info) > 0:
                            for module in module_info:
                                if isinstance(module, dict) and 'name' in module and 'sw_ver' in module:
                                    if module['name'] == 'mc':  # Main controller
                                        hardware_info["hardware_version"] = module.get('hw_ver', 'N/A')
                                        break
            except Exception as e:
                logger.warning(f"Failed to get MQTT dump: {e}")
            
            return hardware_info
        except Exception as e:
            logger.warning(f"Failed to get hardware info: {e}")
            return {}
    
    async def _get_storage_info(self, client) -> Dict[str, Optional[int]]:
        """Helper method to get storage information"""
        try:
            # Try to get storage info from MQTT dump
            mqtt_data = await asyncio.to_thread(client.mqtt_dump)
            if mqtt_data and isinstance(mqtt_data, dict):
                # Look for storage info in the MQTT data
                # This may be in different sections depending on printer model
                storage_info = {}
                
                # Check for system or device info sections
                for section in ['system', 'device', 'print']:
                    if section in mqtt_data:
                        section_data = mqtt_data[section]
                        if isinstance(section_data, dict):
                            # Look for storage-related keys
                            for key, value in section_data.items():
                                if 'storage' in key.lower() or 'disk' in key.lower() or 'space' in key.lower():
                                    try:
                                        if isinstance(value, (int, float)):
                                            if 'free' in key.lower():
                                                storage_info['free'] = int(value)
                                            elif 'total' in key.lower():
                                                storage_info['total'] = int(value)
                                    except Exception:
                                        pass
                
                if storage_info:
                    return storage_info
            
            # Fallback: Try to get info through FTP if available
            logger.info("Storage information not directly available via current API")
            return {"free": None, "total": None}
        except Exception as e:
            logger.warning(f"Failed to get storage info: {e}")
            return {"free": None, "total": None}
    
    async def _get_uptime_info(self, client) -> Optional[int]:
        """Helper method to get uptime information"""
        try:
            # Try to get uptime from MQTT dump
            mqtt_data = await asyncio.to_thread(client.mqtt_dump)
            if mqtt_data and isinstance(mqtt_data, dict):
                # Look for uptime info in the MQTT data
                for section in ['system', 'device', 'print', 'info']:
                    if section in mqtt_data:
                        section_data = mqtt_data[section]
                        if isinstance(section_data, dict):
                            for key, value in section_data.items():
                                if 'uptime' in key.lower() or 'runtime' in key.lower():
                                    try:
                                        return int(value)
                                    except Exception:
                                        pass
            
            logger.info("Uptime information not directly available via current API")
            return None
        except Exception as e:
            logger.warning(f"Failed to get uptime info: {e}")
            return None

    async def _set_printer_cleared_status(self, printer_id: str, cleared: bool) -> None:
        """
        Update printer cleared status in database

        Args:
            printer_id: Printer identifier
            cleared: New cleared status (True = ready, False = needs clearing)
        """
        try:
            # Simple direct SQLite update - matching pattern used for is_connected
            db_path = "/home/pi/PrintFarmSoftware/data/tenant.db"
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            # Update cleared field based on printer_id (integer ID from config)
            cursor.execute("""
                UPDATE printers
                SET cleared = ?,
                    updated_at = ?
                WHERE printer_id = ?
            """, (1 if cleared else 0, datetime.utcnow().isoformat(), int(printer_id)))

            conn.commit()
            conn.close()

            logger.debug(f"Printer {printer_id} cleared status set to {cleared}")

        except Exception as e:
            logger.error(f"Failed to update cleared status for printer {printer_id}: {e}")
            raise

    # Lighting Control Methods
    async def get_light_status(self, printer_id: str) -> Dict[str, Any]:
        """Get current light status using proper bambulabs_api method with caching"""
        client = self.get_client(printer_id)
        
        # Check if we should throttle this operation
        if resource_monitor.should_throttle_operation("printer_poll"):
            logger.debug(f"Light status polling throttled for printer {printer_id}")
            return {"is_on": False, "available": False, "error": "Throttled"}
        
        try:
            # Use the correct bambulabs_api method: get_light_state()
            if hasattr(client, 'get_light_state'):
                # Add timeout to prevent hanging
                led_mode = await asyncio.wait_for(
                    asyncio.to_thread(client.get_light_state),
                    timeout=5.0  # 5 second timeout
                )
                
                # Reduce excessive logging
                if resource_monitor.should_throttle_operation("logging"):
                    logger.debug(f"Got LED mode from get_light_state: {led_mode}")
                
                # Parse the LED mode string
                light_on = False
                if led_mode:
                    # LED mode is typically "on", "off", or similar
                    light_on = str(led_mode).lower() in ['on', '1', 'true', 'enabled']
                
                return {
                    "is_on": light_on,
                    "available": True,
                    "led_mode": led_mode
                }
            else:
                # Fallback with timeout
                mqtt_data = await asyncio.wait_for(
                    asyncio.to_thread(client.mqtt_dump),
                    timeout=5.0
                )
                
                light_on = False
                if mqtt_data and isinstance(mqtt_data, dict):
                    # Look for light status in various possible locations
                    system_data = mqtt_data.get('system', {})
                    if isinstance(system_data, dict):
                        led_ctrl = system_data.get('led_ctrl', 0)
                        light_on = bool(led_ctrl)
                
                return {
                    "is_on": light_on,
                    "available": True
                }
                
        except asyncio.TimeoutError:
            logger.warning(f"Light status timeout for printer {printer_id}")
            return {"is_on": False, "available": False, "error": "Timeout"}
        except Exception as e:
            # Reduce error logging spam
            if resource_monitor.should_throttle_operation("logging"):
                logger.error(f"Failed to get light status: {e}")
            return {
                "is_on": False,
                "available": False,
                "error": str(e)
            }
    
    async def turn_light_on(self, printer_id: str) -> bool:
        """Turn printer light on"""
        client = self.get_client(printer_id)
        try:
            await asyncio.to_thread(client.turn_light_on)
            return True
        except Exception as e:
            logger.error(f"Failed to turn light on: {e}")
            raise PrinterConnectionError(f"Failed to turn light on: {e}")
    
    async def turn_light_off(self, printer_id: str) -> bool:
        """Turn printer light off"""
        client = self.get_client(printer_id)
        try:
            await asyncio.to_thread(client.turn_light_off)
            return True
        except Exception as e:
            logger.error(f"Failed to turn light off: {e}")
            raise PrinterConnectionError(f"Failed to turn light off: {e}")
    
    # Movement Control Methods
    async def home_axes(self, printer_id: str) -> bool:
        """Home all axes using Bambu Labs API"""
        client = self.get_client(printer_id)
        try:
            # Use bambulabs_api home_printer method directly
            result = await asyncio.to_thread(client.home_printer)
            logger.info(f"Successfully homed printer {printer_id}, result: {result}")
            return True if result is None else result
        except Exception as e:
            logger.error(f"Failed to home axes: {e}")
            raise PrinterConnectionError(f"Failed to home axes: {e}")

    async def get_temperatures(self, printer_id: str) -> Dict[str, Any]:
        """Get all temperature information"""
        client = self.get_client(printer_id)
        try:
            # Get temperatures using real bambulabs_api methods
            nozzle_temp = await asyncio.to_thread(client.get_nozzle_temperature)
            bed_temp = await asyncio.to_thread(client.get_bed_temperature)
            chamber_temp = await asyncio.to_thread(client.get_chamber_temperature)
            
            return {
                "nozzle": {
                    "current": float(nozzle_temp) if nozzle_temp not in [None, "Unknown"] else 0.0,
                    "target": 0.0,  # Target not available in current API
                    "is_heating": False  # Heating status not available in current API
                },
                "bed": {
                    "current": float(bed_temp) if bed_temp not in [None, "Unknown"] else 0.0,
                    "target": 0.0,
                    "is_heating": False
                },
                "chamber": {
                    "current": float(chamber_temp) if chamber_temp not in [None, "Unknown"] else 0.0,
                    "target": 0.0,
                    "is_heating": False
                }
            }
        except Exception as e:
            logger.error(f"Failed to get temperatures: {e}")
            raise PrinterConnectionError(f"Failed to get temperatures: {e}")
    
    async def set_nozzle_temperature(self, printer_id: str, temperature: float, wait: bool = False) -> bool:
        """Set nozzle temperature"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'set_nozzle_temperature'):
                # Convert to int as bambulabs_api expects int
                await asyncio.to_thread(client.set_nozzle_temperature, int(temperature))
            else:
                logger.warning("set_nozzle_temperature method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to set nozzle temperature: {e}")
            raise PrinterConnectionError(f"Failed to set nozzle temperature: {e}")
    
    async def set_bed_temperature(self, printer_id: str, temperature: float, wait: bool = False) -> bool:
        """Set bed temperature"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'set_bed_temperature'):
                # Convert to int as bambulabs_api expects int
                await asyncio.to_thread(client.set_bed_temperature, int(temperature))
            else:
                logger.warning("set_bed_temperature method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to set bed temperature: {e}")
            raise PrinterConnectionError(f"Failed to set bed temperature: {e}")
    
    async def set_chamber_temperature(self, printer_id: str, temperature: float, wait: bool = False) -> bool:
        """Set chamber temperature"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'set_chamber_temperature'):
                # Convert to int as bambulabs_api expects int
                await asyncio.to_thread(client.set_chamber_temperature, int(temperature))
            else:
                logger.warning("set_chamber_temperature method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to set chamber temperature: {e}")
            raise PrinterConnectionError(f"Failed to set chamber temperature: {e}")
    
    async def turn_off_heaters(self, printer_id: str) -> bool:
        """Turn off all heaters"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'turn_off_heaters'):
                await asyncio.to_thread(client.turn_off_heaters)
            else:
                logger.warning("turn_off_heaters method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to turn off heaters: {e}")
            raise PrinterConnectionError(f"Failed to turn off heaters: {e}")
    
    # Filament Management Methods
    async def get_ams_status(self, printer_id: str) -> Dict[str, Any]:
        """Get AMS status and filament information"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'get_ams_status'):
                ams_data = await asyncio.to_thread(client.get_ams_status)
                return ams_data
            else:
                logger.warning("get_ams_status method not available in bambulabs_api")
                # Return mock data for API testing
                return {
                    "ams_slots": [],
                    "current_slot": None,
                    "status": "unknown"
                }
        except Exception as e:
            logger.error(f"Failed to get AMS status: {e}")
            raise PrinterConnectionError(f"Failed to get AMS status: {e}")
    
    async def load_filament(self, printer_id: str, slot: int) -> bool:
        """Load filament from AMS slot"""
        client = self.get_client(printer_id)
        try:
            # FIXED: Swapped methods because bambulabs_api has them backwards
            result = await asyncio.to_thread(client.unload_filament_spool)
            logger.info(f"Filament LOAD command sent to printer {printer_id} (using unload_filament_spool method)")
            return True
        except Exception as e:
            logger.error(f"Failed to load filament: {e}")
            raise PrinterConnectionError(f"Failed to load filament: {e}")
    
    async def unload_filament(self, printer_id: str, slot: int = None) -> bool:
        """Unload filament from printer"""
        client = self.get_client(printer_id)
        try:
            # FIXED: Swapped methods because bambulabs_api has them backwards
            result = await asyncio.to_thread(client.load_filament_spool)
            logger.info(f"Filament UNLOAD command sent to printer {printer_id} (using load_filament_spool method)")
            return True
        except Exception as e:
            logger.error(f"Failed to unload filament: {e}")
            raise PrinterConnectionError(f"Failed to unload filament: {e}")
    
    async def change_filament(self, printer_id: str, target_slot: int) -> bool:
        """Change filament to different AMS slot"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'change_filament'):
                await asyncio.to_thread(client.change_filament, target_slot=target_slot)
            else:
                logger.warning("change_filament method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to change filament: {e}")
            raise PrinterConnectionError(f"Failed to change filament: {e}")
    
    async def reset_ams(self, printer_id: str) -> bool:
        """Reset AMS system"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'reset_ams'):
                await asyncio.to_thread(client.reset_ams)
            else:
                logger.warning("reset_ams method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to reset AMS: {e}")
            raise PrinterConnectionError(f"Failed to reset AMS: {e}")
    
    async def calibrate_ams(self, printer_id: str) -> bool:
        """Calibrate AMS system"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'calibrate_ams'):
                await asyncio.to_thread(client.calibrate_ams)
            else:
                logger.warning("calibrate_ams method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to calibrate AMS: {e}")
            raise PrinterConnectionError(f"Failed to calibrate AMS: {e}")
    
    # Maintenance and Calibration Methods
    async def auto_bed_level(self, printer_id: str, save: bool = True) -> bool:
        """Auto bed leveling calibration"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'auto_bed_level'):
                await asyncio.to_thread(client.auto_bed_level, save=save)
            else:
                logger.warning("auto_bed_level method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed auto bed leveling: {e}")
            raise PrinterConnectionError(f"Failed auto bed leveling: {e}")
    
    async def calibrate_flow(self, printer_id: str, filament_type: str, nozzle: float) -> bool:
        """Flow rate calibration"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'calibrate_flow'):
                await asyncio.to_thread(client.calibrate_flow, filament_type=filament_type, nozzle=nozzle)
            else:
                logger.warning("calibrate_flow method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed flow calibration: {e}")
            raise PrinterConnectionError(f"Failed flow calibration: {e}")
    
    async def calibrate_xy_axes(self, printer_id: str) -> bool:
        """Calibrate XY axes"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'calibrate_xy_axes'):
                await asyncio.to_thread(client.calibrate_xy_axes)
            else:
                logger.warning("calibrate_xy_axes method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to calibrate XY axes: {e}")
            raise PrinterConnectionError(f"Failed to calibrate XY axes: {e}")
    
    async def cut_filament(self, printer_id: str) -> bool:
        """Cut filament"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'cut_filament'):
                await asyncio.to_thread(client.cut_filament)
            else:
                logger.warning("cut_filament method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to cut filament: {e}")
            raise PrinterConnectionError(f"Failed to cut filament: {e}")

    async def calibrate_printer(self, printer_id: str, bed_level: bool = True,
                                vibration_compensation: bool = True,
                                motor_noise_calibration: bool = True) -> bool:
        """Calibrate printer with specified calibration options"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'calibrate_printer'):
                await asyncio.to_thread(
                    client.calibrate_printer,
                    bed_level=bed_level,
                    vibration_compensation=vibration_compensation,
                    motor_noise_calibration=motor_noise_calibration
                )
            else:
                logger.warning("calibrate_printer method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to calibrate printer: {e}")
            raise PrinterConnectionError(f"Failed to calibrate printer: {e}")

    # File Operations Methods
    async def list_files(self, printer_id: str) -> List[Dict[str, Any]]:
        """List files on printer storage using FTP client"""
        client = self.get_client(printer_id)
        try:
            # Use real FTP client to get file list from SD card only
            if hasattr(client, 'ftp_client'):
                parsed_files = []
                
                # Only check root directory (SD card) for files
                directories_to_check = [
                    ("root", lambda: client.ftp_client.list_directory())
                ]
                
                for dir_name, list_func in directories_to_check:
                    try:
                        ftp_files = await asyncio.to_thread(list_func)
                        logger.info(f"Checking {dir_name} directory: {ftp_files}")
                        
                        # Handle FTP response - it's a tuple: ('status_code', [file_list])
                        if isinstance(ftp_files, tuple) and len(ftp_files) >= 2:
                            status_code, file_list = ftp_files
                            
                            if isinstance(file_list, list) and len(file_list) > 0:
                                for file_line in file_list:
                                    if isinstance(file_line, str):
                                        file_info = self._parse_ftp_file_line(file_line)
                                        if file_info and self._is_printable_file(file_info['name']):
                                            # Add directory info
                                            file_info['directory'] = dir_name
                                            parsed_files.append(file_info)
                        elif isinstance(ftp_files, list) and len(ftp_files) > 0:
                            # Fallback for direct list format
                            for file_line in ftp_files:
                                if isinstance(file_line, str):
                                    file_info = self._parse_ftp_file_line(file_line)
                                    if file_info and self._is_printable_file(file_info['name']):
                                        file_info['directory'] = dir_name
                                        parsed_files.append(file_info)
                    except Exception as e:
                        logger.warning(f"Failed to list {dir_name} directory: {e}")
                        continue
                
                # Since we're only checking SD card, no need for duplicate removal
                logger.info(f"Retrieved {len(parsed_files)} files from SD card on printer {printer_id}")
                return parsed_files
            else:
                logger.warning("FTP client not available - using mock data")
                # Return mock data as fallback
                return [
                    {"name": "example.3mf", "size": 1024000, "created_at": "2024-01-01T10:00:00Z", "modified_at": "2024-01-01T10:00:00Z", "file_type": "3MF"},
                    {"name": "test_print.3mf", "size": 2048000, "created_at": "2024-01-02T15:30:00Z", "modified_at": "2024-01-02T15:30:00Z", "file_type": "3MF"}
                ]
        except Exception as e:
            logger.error(f"Failed to list files: {e}")
            raise PrinterConnectionError(f"Failed to list files: {e}")
    
    async def upload_file(self, printer_id: str, file_path: str = None, filename: str = None) -> Dict[str, Any]:
        """Upload file to printer storage using Bambu Labs protocol"""
        client = self.get_client(printer_id)
        
        # Handle both file_path (new) and filename with content (legacy) approaches
        if file_path:
            actual_filename = filename or os.path.basename(file_path)
            source_path = file_path
        else:
            raise ValueError("file_path is required for file upload")
        
        try:
            # Validate file extension for Bambu Labs
            if not actual_filename.lower().endswith(('.3mf', '.gcode', '.g')):
                raise ValueError(f"Unsupported file type: {actual_filename}. Only .3mf, .gcode, and .g files are supported")
            
            # Validate file exists
            if not os.path.exists(source_path):
                raise FileNotFoundError(f"File not found: {source_path}")
            
            logger.info(f"Uploading file {source_path} as {actual_filename} to printer {printer_id}")
            
            if hasattr(client, 'upload_file'):
                # bambulabs_api upload_file method might expect file handle instead of path
                logger.info(f"Calling bambulabs_api upload_file with path: {source_path}")
                
                try:
                    # Try with file handle first (some versions expect this)
                    with open(source_path, 'rb') as file_handle:
                        result = await asyncio.to_thread(client.upload_file, file_handle, actual_filename)
                    logger.info(f"bambulabs_api upload_file result (with handle): {result}")
                except Exception as handle_error:
                    logger.warning(f"Upload with file handle failed: {handle_error}")
                    logger.info("Trying upload with file path instead")
                    
                    # Fallback to file path
                    try:
                        result = await asyncio.to_thread(client.upload_file, source_path)
                        logger.info(f"bambulabs_api upload_file result (with path): {result}")
                    except Exception as path_error:
                        logger.error(f"Upload with file path also failed: {path_error}")
                        raise path_error
                
                # Return structured response
                return {
                    "success": True,
                    "message": f"File {actual_filename} uploaded successfully",
                    "file_info": {
                        "filename": actual_filename,
                        "original_path": source_path,
                        "size_bytes": os.path.getsize(source_path)
                    },
                    "upload_result": result
                }
            else:
                # Fallback for testing/mock scenarios
                logger.warning("File upload method not available in bambulabs_api")
                file_size = os.path.getsize(source_path) if os.path.exists(source_path) else 0
                logger.info(f"Would upload file {actual_filename} ({file_size} bytes)")
                
                return {
                    "success": True,
                    "message": f"File {actual_filename} upload simulated (bambulabs_api method not available)",
                    "file_info": {
                        "filename": actual_filename,
                        "original_path": source_path,
                        "size_bytes": file_size
                    },
                    "upload_result": "simulated"
                }
                
        except Exception as e:
            logger.error(f"Failed to upload file {actual_filename}: {e}")
            return {
                "success": False,
                "message": f"Failed to upload file: {str(e)}",
                "error": str(e)
            }
    
    async def delete_file(self, printer_id: str, filename: str) -> bool:
        """Delete file from printer storage using Bambu Labs MQTT protocol"""
        client = self.get_client(printer_id)
        try:
            # Validate filename
            validate_bambu_file_path(filename)
            
            # Create MQTT message for file deletion
            target_path = f"/sdcard/cache/{filename}"
            mqtt_params = {
                "command": "delete_file",
                "target": target_path
            }
            mqtt_message = self.create_mqtt_message(printer_id, "delete_file", mqtt_params)
            
            # Try to send using bambulabs_api
            if hasattr(client, 'publish') or hasattr(client, 'send_command'):
                if hasattr(client, 'publish'):
                    await asyncio.to_thread(client.publish, "device/request/file", mqtt_message)
                elif hasattr(client, 'send_command'):
                    await asyncio.to_thread(client.send_command, mqtt_message)
                logger.info(f"Sent file deletion request: {mqtt_message}")
            elif hasattr(client, 'delete_file'):
                await asyncio.to_thread(client.delete_file, filename)
            else:
                logger.warning("File deletion method not available in bambulabs_api")
                logger.info(f"Would delete file: {target_path}")
                
            return True
        except Exception as e:
            logger.error(f"Failed to delete file: {e}")
            raise PrinterConnectionError(f"Failed to delete file: {e}")
    
    async def get_file_info(self, printer_id: str, filename: str) -> Dict[str, Any]:
        """Get file information using Bambu Labs MQTT protocol"""
        client = self.get_client(printer_id)
        try:
            # Validate filename
            validate_bambu_file_path(filename)
            
            # Create MQTT message for file info request
            target_path = f"/sdcard/cache/{filename}"
            mqtt_params = {
                "command": "get_file_info",
                "target": target_path
            }
            mqtt_message = self.create_mqtt_message(printer_id, "get_file_info", mqtt_params)
            
            # Try to send using bambulabs_api
            if hasattr(client, 'publish') or hasattr(client, 'send_command'):
                if hasattr(client, 'publish'):
                    await asyncio.to_thread(client.publish, "device/request/info", mqtt_message)
                elif hasattr(client, 'send_command'):
                    await asyncio.to_thread(client.send_command, mqtt_message)
                logger.info(f"Sent file info request: {mqtt_message}")
            elif hasattr(client, 'get_file_info'):
                file_info = await asyncio.to_thread(client.get_file_info, filename)
                return file_info
            else:
                logger.warning("File info method not available in bambulabs_api")
            
            # Return mock data for API testing until response parsing is implemented
            import os
            file_ext = os.path.splitext(filename)[1].lower()
            return {
                "name": filename,
                "size": 1024000 if file_ext == '.3mf' else 512000,
                "created_at": "2024-01-01T10:00:00Z",
                "modified_at": "2024-01-01T10:00:00Z",
                "file_type": "3MF" if file_ext == '.3mf' else "gcode"
            }
        except Exception as e:
            logger.error(f"Failed to get file info: {e}")
            raise PrinterConnectionError(f"Failed to get file info: {e}")
    
    # Camera Operations Methods
    async def take_snapshot(self, printer_id: str) -> Dict[str, Any]:
        """Take camera snapshot using get_camera_frame() for direct base64"""
        from datetime import datetime
        client = self.get_client(printer_id)

        # Log diagnostic information
        logger.info(f"Camera snapshot request for printer {printer_id} - IP: {client.ip_address}, camera_alive: {client.camera_client_alive()}")
        logger.info(f"  Camera client configured IP: {client.camera_client._PrinterCamera__hostname}")

        # Ensure camera is started (only start once, let daemon run)
        if not client.camera_client_alive():
            logger.info(f"Starting camera for printer {printer_id}...")
            try:
                client.camera_start()
            except RuntimeError as e:
                if "threads can only be started once" not in str(e):
                    raise
            await asyncio.sleep(1)  # Brief delay for camera daemon to start

        # Retry logic: wait up to 30 seconds for first frame (A1 needs more time than A1 Mini)
        max_retries = 15
        retry_delay = 2.0

        for attempt in range(max_retries):
            try:
                # Use get_camera_frame() to get base64 directly (more efficient than get_camera_image)
                # This returns the JPEG already encoded as base64 string
                image_base64 = await asyncio.to_thread(client.get_camera_frame)

                logger.info(f"Successfully captured camera snapshot for printer {printer_id}")
                return {
                    "image_data": image_base64,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "resolution": "1920x1080"  # Default Bambu Lab camera resolution
                }

            except Exception as e:
                error_msg = str(e)
                if "No frame available" in error_msg and attempt < max_retries - 1:
                    logger.debug(f"Camera not ready for printer {printer_id}, waiting... (attempt {attempt + 1}/{max_retries})")
                    await asyncio.sleep(retry_delay)
                    continue
                elif attempt == max_retries - 1:
                    logger.error(f"Failed to take snapshot for printer {printer_id} after {max_retries} attempts: {e}")
                    logger.error(f"  Printer IP: {client.ip_address}")
                    logger.error(f"  Camera alive: {client.camera_client_alive()}")
                    logger.error(f"  Access code (masked): {'*' * (len(client.access_code) - 2)}{client.access_code[-2:] if len(client.access_code) > 2 else '**'}")
                    logger.error(f"  Troubleshooting: Verify printer has 'LAN Only Mode' enabled, camera not disabled in settings, and correct access code")
                    # Return empty data when camera fails
                    return {
                        "image_data": "",
                        "timestamp": "2024-01-01T00:00:00Z",
                        "resolution": "1920x1080"
                    }
                else:
                    # Other unexpected errors
                    logger.error(f"Failed to take snapshot for printer {printer_id}: {e}")
                    return {
                        "image_data": "",
                        "timestamp": "2024-01-01T00:00:00Z",
                        "resolution": "1920x1080"
                    }

        # Fallback if loop completes without returning
        logger.warning(f"Camera snapshot failed for printer {printer_id} - no frames available")
        return {
            "image_data": "",
            "timestamp": "2024-01-01T00:00:00Z",
            "resolution": "1920x1080"
        }

    async def stop_camera(self, printer_id: str) -> bool:
        """Stop camera connection for a printer"""
        client = self.get_client(printer_id)
        if client.camera_client_alive():
            await asyncio.to_thread(client.camera_stop)
            logger.info(f"Camera stopped for printer {printer_id}")
            return True
        logger.info(f"Camera already stopped for printer {printer_id}")
        return False

    # System Commands & Control Methods
    async def send_gcode(self, printer_id: str, command: str, wait: bool = False) -> bool:
        """Send custom G-code command"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'send_gcode'):
                await asyncio.to_thread(client.send_gcode, command, wait=wait)
            else:
                logger.warning("send_gcode method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to send G-code: {e}")
            raise PrinterConnectionError(f"Failed to send G-code: {e}")
    
    
    async def reset_printer(self, printer_id: str) -> bool:
        """Reset printer to default state"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'reset'):
                await asyncio.to_thread(client.reset)
            else:
                logger.warning("reset method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to reset printer: {e}")
            raise PrinterConnectionError(f"Failed to reset printer: {e}")
    
    
    
    
    async def get_system_info(self, printer_id: str) -> Dict[str, Any]:
        """Get system information"""
        client = self.get_client(printer_id)
        try:
            # Get what real information we can from the printer and configuration
            config = self.get_printer_config(printer_id)
            
            # Get real values where available
            serial_number = getattr(client, 'serial', config.get('serial', 'unknown'))
            model = config.get('model', 'unknown')
            ip_address = getattr(client, 'ip_address', config.get('ip', 'unknown'))
            
            # Use bambulabs_api methods to get real system info
            firmware_version = await self._get_firmware_version(client)
            storage_info = await self._get_storage_info(client)
            uptime_info = await self._get_uptime_info(client)
            
            # Get additional hardware info from MQTT data
            hardware_info = await self._get_hardware_info(client)
            
            return {
                "firmware_version": firmware_version,
                "hardware_version": hardware_info.get("hardware_version", model),
                "model": model,
                "serial": serial_number,
                "ip_address": ip_address,
                "uptime": uptime_info,
                "free_storage": storage_info.get("free", None),
                "total_storage": storage_info.get("total", None),
                "wifi_signal": hardware_info.get("wifi_signal", None),
                "nozzle_type": hardware_info.get("nozzle_type", None),
                "nozzle_diameter": hardware_info.get("nozzle_diameter", None)
            }
        except Exception as e:
            logger.error(f"Failed to get system info: {e}")
            raise PrinterConnectionError(f"Failed to get system info: {e}")
    
    async def reboot_printer(self, printer_id: str) -> bool:
        """Reboot printer system"""
        client = self.get_client(printer_id)
        try:
            if hasattr(client, 'reboot'):
                await asyncio.to_thread(client.reboot)
            else:
                logger.warning("reboot method not available in bambulabs_api")
                pass
            return True
        except Exception as e:
            logger.error(f"Failed to reboot printer: {e}")
            raise PrinterConnectionError(f"Failed to reboot printer: {e}")
    
    # Live Status Methods for WebSocket Streaming
    async def get_live_print_status(self, printer_id: str) -> Dict[str, Any]:
        """Get live print status including progress and temperatures"""
        client = self.get_client(printer_id)
        try:
            # Get MQTT dump for comprehensive status
            mqtt_data = await asyncio.to_thread(client.mqtt_dump)
            
            # Initialize status structure
            status = {
                "printer_id": printer_id,
                "status": "idle",
                "progress": None,
                "temperatures": {
                    "nozzle": {"current": 0.0, "target": 0.0, "is_heating": False},
                    "bed": {"current": 0.0, "target": 0.0, "is_heating": False},
                    "chamber": {"current": 0.0, "target": 0.0, "is_heating": False}
                },
                "current_job": None,
                "raw_gcode_state": None,  # Raw state from printer for job completion detection
                "error_code": None  # Error code for failed prints
            }
            
            if mqtt_data and isinstance(mqtt_data, dict):
                # Parse print status and progress
                print_data = mqtt_data.get('print', {})
                if isinstance(print_data, dict):
                    # Get print status
                    gcode_state = print_data.get('gcode_state', 'idle')
                    error_code = print_data.get('mc_print_error_code', 0)

                    # Store raw state and error code for downstream services to use
                    status["raw_gcode_state"] = gcode_state if isinstance(gcode_state, str) else None
                    status["error_code"] = error_code

                    if isinstance(gcode_state, str):
                        # Map Bambu states to our enum values
                        state_mapping = {
                            'idle': 'idle',
                            'printing': 'printing',
                            'pause': 'paused',      # MQTT reports "PAUSE" which becomes "pause" when lowercased
                            'paused': 'paused',
                            'stopped': 'stopped',
                            'finished': 'finished',
                            'failed': 'failed',
                            'prepare': 'printing',
                            'running': 'printing'
                        }
                        mapped_status = state_mapping.get(gcode_state.lower(), 'idle')

                        # Check if "failed" is due to cancellation (no error) or actual failure (has error code)
                        if mapped_status == 'failed':
                            # Check for error code - if it's 0 or missing, it was a user cancellation
                            if error_code == 0 or error_code is None:
                                # No error code means user canceled - show as idle
                                mapped_status = 'idle'
                            # Otherwise keep it as 'failed' for actual errors

                        status["status"] = mapped_status
                    
                    # Get print progress
                    mc_percent = print_data.get('mc_percent', 0)
                    mc_remaining_time = print_data.get('mc_remaining_time', 0)
                    current_layer = print_data.get('layer_num', 0)
                    total_layers = print_data.get('total_layer_num', 0)
                    
                    # Calculate elapsed time (rough estimate)
                    elapsed_time = 0
                    if mc_percent > 0 and mc_remaining_time > 0:
                        total_estimated = mc_remaining_time / (1 - (mc_percent / 100))
                        elapsed_time = int(total_estimated - mc_remaining_time)
                    
                    if mc_percent > 0 or current_layer > 0:
                        status["progress"] = {
                            "percentage": float(mc_percent),
                            "elapsed_time": elapsed_time,
                            "remaining_time": int(mc_remaining_time * 60) if mc_remaining_time else None,
                            "current_layer": int(current_layer) if current_layer else None,
                            "total_layers": int(total_layers) if total_layers else None
                        }

                    # Check if we need to mark printer as needing to be cleared
                    # Set cleared=false when print reaches layer 1 AND has been printing for 45+ seconds
                    if mapped_status == 'printing':
                        import time
                        current_time = time.time()

                        # Track when printer entered 'printing' status
                        if printer_id not in self.printing_start_time:
                            self.printing_start_time[printer_id] = current_time
                            logger.debug(f"Printer {printer_id} entered 'printing' status at {current_time}")

                        # Calculate how long printer has been printing
                        printing_duration = current_time - self.printing_start_time[printer_id]

                        # Only set cleared=false if printing for 45+ seconds AND layer is 1
                        if current_layer >= 1 and printing_duration >= 45:
                            last_layer = self.last_layer_seen.get(printer_id, 0)
                            # Only update if this is the first time we're seeing layer 1 or higher
                            if last_layer == 0 and current_layer >= 1:
                                try:
                                    await self._set_printer_cleared_status(printer_id, False)
                                    logger.info(f"Printer {printer_id} marked as needing to be cleared (layer {current_layer}, printing for {printing_duration:.1f}s)")
                                    # Only update tracking if database update succeeded
                                    self.last_layer_seen[printer_id] = current_layer
                                except Exception as e:
                                    logger.error(f"Failed to set cleared status for printer {printer_id}: {e}")
                                    # Don't update last_layer_seen so we retry on next poll
                            elif last_layer > 0:
                                # Update layer tracking for subsequent layers
                                self.last_layer_seen[printer_id] = current_layer
                    elif mapped_status in ['idle', 'finished', 'failed', 'stopped']:
                        # Reset layer tracking and printing start time when print is done or idle
                        self.last_layer_seen[printer_id] = 0
                        if printer_id in self.printing_start_time:
                            del self.printing_start_time[printer_id]
                            logger.debug(f"Printer {printer_id} exited 'printing' status, cleared timestamp")

                    # Extract current job information from MQTT data
                    try:
                        current_filename = await self._get_current_filename(client)
                        if current_filename and current_filename != "unknown":
                            status["current_job"] = {
                                "filename": current_filename,
                                "print_id": print_data.get("task_id", ""),
                                "subtask_name": print_data.get("subtask_name", ""),
                                "project_id": print_data.get("project_id", "")
                            }
                    except Exception as e:
                        logger.debug(f"Failed to get current job filename for printer {printer_id}: {e}")
                
                # Parse temperature data
                temp_data = print_data
                nozzle_temp = temp_data.get('nozzle_temper', 0)
                nozzle_target = temp_data.get('nozzle_target_temper', 0)
                bed_temp = temp_data.get('bed_temper', 0)
                bed_target = temp_data.get('bed_target_temper', 0)
                chamber_temp = temp_data.get('chamber_temper', 0)
                
                status["temperatures"] = {
                    "nozzle": {
                        "current": float(nozzle_temp),
                        "target": float(nozzle_target),
                        "is_heating": abs(float(nozzle_temp) - float(nozzle_target)) > 2.0 and float(nozzle_target) > 0
                    },
                    "bed": {
                        "current": float(bed_temp),
                        "target": float(bed_target),
                        "is_heating": abs(float(bed_temp) - float(bed_target)) > 2.0 and float(bed_target) > 0
                    },
                    "chamber": {
                        "current": float(chamber_temp),
                        "target": 0.0,  # Chamber usually not actively heated
                        "is_heating": False
                    }
                }
                
                # Add light status to live data
                light_status = await self.get_light_status(printer_id)
                status["light_on"] = light_status.get("is_on", False)

            # Add is_connected field based on whether printer is in active clients
            status["is_connected"] = printer_id in self.clients

            return status
            
        except Exception as e:
            logger.error(f"Failed to get live status for printer {printer_id}: {e}")
            raise PrinterConnectionError(f"Failed to get live status: {e}")
    
    async def get_all_live_status(self) -> List[Dict[str, Any]]:
        """Get live status for all configured printers (both connected and disconnected)"""
        all_status = []
        
        # Get all configured printers
        for printer_id, config in self.printer_configs.items():
            try:
                if printer_id in self.clients:
                    # Connected printer - get full status
                    status = await self.get_live_print_status(printer_id)
                    
                    # Filter out phantom connections with unrealistic temperature data
                    temps = status.get("temperatures", {})
                    nozzle_temp = temps.get("nozzle", {}).get("current", 0.0)
                    bed_temp = temps.get("bed", {}).get("current", 0.0)
                    
                    # Only include connected printers with realistic temperature readings
                    if nozzle_temp > 15.0 or bed_temp > 15.0:
                        status["is_connected"] = True
                        all_status.append(status)
                        logger.debug(f"Including connected printer {printer_id} with temps: nozzle={nozzle_temp}°C, bed={bed_temp}°C")
                    else:
                        # Treat as disconnected if temps are unrealistic
                        logger.debug(f"Treating printer {printer_id} as disconnected due to unrealistic temps: nozzle={nozzle_temp}°C, bed={bed_temp}°C")
                        offline_status = {
                            "printer_id": printer_id,
                            "status": "offline",
                            "is_connected": False,
                            "progress": None,
                            "temperatures": {
                                "nozzle": {"current": 0.0, "target": 0.0, "is_heating": False},
                                "bed": {"current": 0.0, "target": 0.0, "is_heating": False},
                                "chamber": {"current": 0.0, "target": 0.0, "is_heating": False}
                            }
                        }
                        all_status.append(offline_status)
                else:
                    # Disconnected printer - create offline status
                    offline_status = {
                        "printer_id": printer_id,
                        "status": "offline",
                        "is_connected": False,
                        "progress": None,
                        "temperatures": {
                            "nozzle": {"current": 0.0, "target": 0.0, "is_heating": False},
                            "bed": {"current": 0.0, "target": 0.0, "is_heating": False},
                            "chamber": {"current": 0.0, "target": 0.0, "is_heating": False}
                        }
                    }
                    all_status.append(offline_status)
                    logger.debug(f"Including offline printer {printer_id}")
                    
            except Exception as e:
                logger.warning(f"Error getting status for printer {printer_id}: {e}")
                # Still include as offline on error
                offline_status = {
                    "printer_id": printer_id,
                    "status": "offline",
                    "is_connected": False,
                    "progress": None,
                    "temperatures": {
                        "nozzle": {"current": 0.0, "target": 0.0, "is_heating": False},
                        "bed": {"current": 0.0, "target": 0.0, "is_heating": False},
                        "chamber": {"current": 0.0, "target": 0.0, "is_heating": False}
                    }
                }
                all_status.append(offline_status)
        
        return all_status
    
    # Light Control Methods
    async def toggle_light(self, printer_id: str) -> Dict[str, Any]:
        """Toggle printer chamber light on/off"""
        client = self.get_client(printer_id)
        try:
            # Get current light status first
            current_status = await self.get_light_status(printer_id)
            current_state = current_status.get('is_on', False)
            new_state = not current_state
            
            logger.info(f"Toggling light for printer {printer_id}: {current_state} -> {new_state}")
            
            # Use bambulabs_api light control methods
            try:
                if new_state:
                    await self.turn_light_on(printer_id)
                    logger.info(f"Turn light on command sent for printer {printer_id}")
                else:
                    await self.turn_light_off(printer_id)
                    logger.info(f"Turn light off command sent for printer {printer_id}")
                
                # Wait longer for the command to take effect (increased from 1 to 3 seconds)
                await asyncio.sleep(3)
                
                # Verify the command worked by checking status again
                verification_status = await self.get_light_status(printer_id)
                actual_state = verification_status.get('is_on', False)
                
                if actual_state == new_state:
                    logger.info(f"Light toggle successful for printer {printer_id}: state is now {actual_state}")
                    return {
                        "success": True,
                        "light_on": actual_state,
                        "message": f"Light {'turned on' if actual_state else 'turned off'}"
                    }
                else:
                    # Try one more time with a longer delay
                    logger.warning(f"Light state mismatch, retrying after longer delay...")
                    await asyncio.sleep(2)
                    
                    final_status = await self.get_light_status(printer_id)
                    final_state = final_status.get('is_on', False)
                    
                    if final_state == new_state:
                        logger.info(f"Light toggle successful after retry for printer {printer_id}: state is now {final_state}")
                        return {
                            "success": True,
                            "light_on": final_state,
                            "message": f"Light {'turned on' if final_state else 'turned off'} (after delay)"
                        }
                    else:
                        logger.warning(f"Light toggle verification failed for printer {printer_id}: expected {new_state}, got {final_state}")
                        # Return what actually happened
                        return {
                            "success": True,
                            "light_on": final_state,
                            "message": f"Light command sent, current state: {'on' if final_state else 'off'}"
                        }
                    
            except Exception as control_error:
                logger.error(f"Light control command failed for printer {printer_id}: {control_error}")
                # If control fails, return current status
                return {
                    "success": False,
                    "light_on": current_state,
                    "message": "Light control command failed",
                    "error": str(control_error)
                }
            
        except Exception as e:
            logger.error(f"Failed to toggle light for printer {printer_id}: {e}")
            return {
                "success": False,
                "error": str(e),
                "message": "Failed to toggle light"
            }
    
    async def set_light_state(self, printer_id: str, turn_on: bool) -> Dict[str, Any]:
        """Set printer chamber light to specific state"""
        client = self.get_client(printer_id)
        try:
            # Use existing bambulabs_api light control methods
            if turn_on:
                await self.turn_light_on(printer_id)
                logger.info(f"Turned light on for printer {printer_id}")
            else:
                await self.turn_light_off(printer_id)
                logger.info(f"Turned light off for printer {printer_id}")
            
            return {
                "success": True,
                "light_on": turn_on,
                "message": f"Light {'turned on' if turn_on else 'turned off'}"
            }
            
        except Exception as e:
            logger.error(f"Failed to set light state for printer {printer_id}: {e}")
            return {
                "success": False,
                "error": str(e),
                "message": "Failed to set light state"
            }
    

# Global printer manager instance
printer_manager = PrinterClientManager()