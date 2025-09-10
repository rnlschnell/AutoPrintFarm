import asyncio
import os
import tempfile
import logging
import shutil
from typing import Optional, List, Dict
from pathlib import Path
import json
import zipfile

logger = logging.getLogger(__name__)

class OrcaSlicerClient:
    """Client for interacting with OrcaSlicer CLI using printer profiles for Bambu Studio compatibility"""
    
    def __init__(self):
        self.orcaslicer_command = ["/usr/bin/flatpak", "run", "io.github.softfever.OrcaSlicer"]
        self.default_timeout = 300  # 5 minutes default
        self.profiles_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "orcaslicer-profiles")
        self._profile_cache = {}
        
    def _get_profile_for_printer_nozzle(self, printer_id: str, nozzle_size: float = 0.4) -> Optional[str]:
        """Get the appropriate OrcaSlicer profile for a printer and nozzle size"""
        # Map printer models and nozzle sizes to Flatpak internal profile paths
        profile_mapping = {
            ('A1', 0.2): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab A1 0.2 nozzle.json',
            ('A1', 0.4): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab A1 0.4 nozzle.json',
            ('A1', 0.6): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab A1 0.6 nozzle.json',
            ('A1', 0.8): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab A1 0.8 nozzle.json',
            ('A1MINI', 0.2): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab A1 mini 0.2 nozzle.json',
            ('A1MINI', 0.4): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab A1 mini 0.4 nozzle.json',
            ('A1MINI', 0.6): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab A1 mini 0.6 nozzle.json',
            ('A1MINI', 0.8): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab A1 mini 0.8 nozzle.json',
            ('P1P', 0.2): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab P1P 0.2 nozzle.json',
            ('P1P', 0.4): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab P1P 0.4 nozzle.json',
            ('P1P', 0.6): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab P1P 0.6 nozzle.json',
            ('P1P', 0.8): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab P1P 0.8 nozzle.json',
            ('P1S', 0.2): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab P1S 0.2 nozzle.json',
            ('P1S', 0.4): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab P1S 0.4 nozzle.json',
            ('P1S', 0.6): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab P1S 0.6 nozzle.json',
            ('P1S', 0.8): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab P1S 0.8 nozzle.json',
            ('X1', 0.2): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1 0.2 nozzle.json',
            ('X1', 0.4): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1 0.4 nozzle.json',
            ('X1', 0.6): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1 0.6 nozzle.json',
            ('X1', 0.8): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1 0.8 nozzle.json',
            ('X1C', 0.2): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1 Carbon 0.2 nozzle.json',
            ('X1C', 0.4): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1 Carbon 0.4 nozzle.json',
            ('X1C', 0.6): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1 Carbon 0.6 nozzle.json',
            ('X1C', 0.8): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1 Carbon 0.8 nozzle.json',
            ('X1E', 0.2): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1E 0.2 nozzle.json',
            ('X1E', 0.4): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1E 0.4 nozzle.json',
            ('X1E', 0.6): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1E 0.6 nozzle.json',
            ('X1E', 0.8): '/app/share/OrcaSlicer/profiles/BBL/machine/Bambu Lab X1E 0.8 nozzle.json',
        }
        
        # Extract printer model from printer_id (e.g., "a1_main" -> "A1")
        printer_model = self._extract_printer_model(printer_id)
        profile_path = profile_mapping.get((printer_model, nozzle_size))
        
        if profile_path:
            return profile_path
                
        logger.warning(f"No profile found for printer {printer_model} with {nozzle_size}mm nozzle")
        return None
        
    def _extract_printer_model(self, printer_id: str) -> str:
        """Extract printer model from printer_id"""
        # Convert to uppercase and extract model
        printer_id_upper = printer_id.upper()
        
        # Check A1 mini first before checking A1
        if 'A1_MINI' in printer_id_upper or 'A1MINI' in printer_id_upper:
            return 'A1MINI'
        elif 'A1' in printer_id_upper:
            return 'A1'
        elif 'P1P' in printer_id_upper:
            return 'P1P'
        elif 'P1S' in printer_id_upper:
            return 'P1S'
        elif 'X1C' in printer_id_upper:
            return 'X1C'
        elif 'X1E' in printer_id_upper:
            return 'X1E'
        elif 'X1' in printer_id_upper:
            return 'X1'
        else:
            # Default to A1 if unknown
            logger.warning(f"Unknown printer model in {printer_id}, defaulting to A1")
            return 'A1'
            
    def _detect_nozzle_size_from_3mf(self, input_path: str) -> float:
        """Detect nozzle size from 3MF metadata"""
        try:
            with zipfile.ZipFile(input_path, 'r') as zip_file:
                # Check for plate metadata
                plate_files = [f for f in zip_file.namelist() if f.startswith('Metadata/plate_') and f.endswith('.json')]
                for plate_file in plate_files:
                    try:
                        plate_data = json.loads(zip_file.read(plate_file).decode('utf-8'))
                        if 'nozzle_diameter' in plate_data:
                            return float(plate_data['nozzle_diameter'])
                    except Exception as e:
                        logger.debug(f"Could not parse {plate_file}: {e}")
                        
                # Check for machine config files
                machine_files = [f for f in zip_file.namelist() if f.startswith('Metadata/machine_') and f.endswith('.json')]
                for machine_file in machine_files:
                    try:
                        machine_data = json.loads(zip_file.read(machine_file).decode('utf-8'))
                        if 'nozzle_diameter' in machine_data:
                            return float(machine_data['nozzle_diameter'])
                    except Exception as e:
                        logger.debug(f"Could not parse {machine_file}: {e}")
                        
        except Exception as e:
            logger.warning(f"Could not detect nozzle size from 3MF: {e}")
            
        # Default to 0.4mm if detection fails
        return 0.4
        
    async def slice_3mf(
        self, 
        input_path: str, 
        output_filename: Optional[str] = None,
        timeout: Optional[int] = None,
        printer_id: Optional[str] = None
    ) -> str:
        """
        Slice a 3MF file using OrcaSlicer CLI with appropriate printer profile
        
        Args:
            input_path: Path to input 3MF file
            output_filename: Optional custom output filename
            timeout: Timeout in seconds (default: 300s)
            printer_id: Printer ID for profile selection (e.g., 'a1_main', 'x1c_main')
            
        Returns:
            Path to the sliced .gcode.3mf file
            
        Raises:
            asyncio.TimeoutError: If slicing takes longer than timeout
            RuntimeError: If slicing fails
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Input file not found: {input_path}")
            
        if not input_path.lower().endswith('.3mf'):
            raise ValueError("Input file must be a .3mf file")
            
        # Generate output path
        if output_filename:
            if not output_filename.endswith('.gcode.3mf'):
                output_filename += '.gcode.3mf'
        else:
            input_basename = os.path.splitext(os.path.basename(input_path))[0]
            output_filename = f"{input_basename}_sliced.gcode.3mf"
            
        # Use home directory for output (flatpak sandbox accessibility)
        output_dir = os.path.expanduser("~/orcaslicer-temp")
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, output_filename)
        
        # Ensure output path doesn't already exist
        counter = 1
        original_output_path = output_path
        while os.path.exists(output_path):
            base, ext = os.path.splitext(original_output_path)
            if ext == '.3mf':
                base = base.replace('.gcode', '')
                output_path = f"{base}_{counter}.gcode.3mf"
            else:
                output_path = f"{base}_{counter}{ext}"
            counter += 1
            
        logger.info(f"Starting OrcaSlicer processing: {input_path} -> {output_path}")
        
        try:
            # Detect nozzle size from 3MF
            nozzle_size = self._detect_nozzle_size_from_3mf(input_path)
            logger.info(f"Detected nozzle size: {nozzle_size}mm")
            
            # Get appropriate printer profile
            profile_path = None
            if printer_id:
                profile_path = self._get_profile_for_printer_nozzle(printer_id, nozzle_size)
                
            if not profile_path:
                # Default to A1 0.4mm profile if no specific profile found
                profile_path = self._get_profile_for_printer_nozzle('A1', 0.4)
                logger.warning(f"Using default A1 profile for slicing")
                
            if not profile_path:
                raise RuntimeError("No suitable OrcaSlicer profile found")
                
            logger.info(f"Using profile: {os.path.basename(profile_path)}")
            
            # Build slicing command with profile
            command = self._build_slice_command_with_profile(input_path, output_path, profile_path)
            
            # Execute with timeout
            timeout_seconds = timeout or self.default_timeout
            await self._execute_with_timeout(command, timeout_seconds, input_path)
            
            # Verify output file was created
            if not os.path.exists(output_path):
                raise RuntimeError("OrcaSlicer completed but output file was not created")
                
            # Verify output file is not empty
            if os.path.getsize(output_path) == 0:
                raise RuntimeError("OrcaSlicer created empty output file")
                
            logger.info(f"Successfully sliced 3MF file: {output_path}")
            return output_path
            
        except Exception as e:
            # Clean up partial output file if it exists
            if os.path.exists(output_path):
                try:
                    os.remove(output_path)
                except:
                    pass
            raise
            
    def _build_slice_command_with_profile(self, input_path: str, output_path: str, profile_path: str) -> List[str]:
        """Build the OrcaSlicer command using built-in Bambu Lab profiles"""
        command = self.orcaslicer_command.copy()
        
        command.extend([
            "--allow-newer-file",  # Allow files with newer versions  
            "--load-settings", profile_path,  # Load the dynamically selected profile
            "--slice", "1",        # Slice all plates  
            "--export-3mf", output_path,  # Export as .gcode.3mf
        ])
        
        # Add input file last
        command.append(input_path)
        
        return command
        
    def list_available_profiles(self) -> Dict[str, str]:
        """List all available OrcaSlicer profiles"""
        profiles = {}
        
        if not os.path.exists(self.profiles_dir):
            logger.warning(f"Profiles directory not found: {self.profiles_dir}")
            return profiles
            
        for filename in os.listdir(self.profiles_dir):
            if filename.endswith('.ini'):
                profile_path = os.path.join(self.profiles_dir, filename)
                profiles[filename] = profile_path
                
        return profiles
        
    def get_profile_info(self, profile_path: str) -> Dict[str, str]:
        """Extract information from an OrcaSlicer profile"""
        info = {
            'printer_model': 'Unknown',
            'nozzle_size': 'Unknown',
            'description': 'Unknown'
        }
        
        try:
            with open(profile_path, 'r') as f:
                content = f.read()
                
            # Extract printer model from profile name
            filename = os.path.basename(profile_path)
            if 'A1' in filename:
                info['printer_model'] = 'Bambu A1'
            elif 'P1P' in filename:
                info['printer_model'] = 'Bambu P1P'
            elif 'X1C' in filename:
                info['printer_model'] = 'Bambu X1 Carbon'
                
            # Extract nozzle size
            if '0.4' in filename:
                info['nozzle_size'] = '0.4mm'
            elif '0.2' in filename:
                info['nozzle_size'] = '0.2mm'
                
            info['description'] = f"{info['printer_model']} {info['nozzle_size']} nozzle profile with Bambu Studio compatibility"
            
        except Exception as e:
            logger.warning(f"Could not read profile info from {profile_path}: {e}")
            
        return info
        
        
    async def _execute_with_timeout(
        self, 
        command: List[str], 
        timeout: int, 
        input_file: str
    ) -> None:
        """Execute OrcaSlicer command with timeout and proper error handling"""
        logger.info(f"Executing: {' '.join(command)}")
        logger.info(f"Timeout: {timeout}s for file: {os.path.basename(input_file)}")
        
        try:
            # Start the process
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
                # Removed cwd parameter - let Flatpak handle its own working directory
            )
            
            # Wait for completion with timeout
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), 
                timeout=timeout
            )
            
            # Check return code
            if process.returncode != 0:
                stdout_str = stdout.decode('utf-8', errors='ignore') if stdout else ""
                stderr_str = stderr.decode('utf-8', errors='ignore') if stderr else ""
                
                logger.error(f"OrcaSlicer failed with return code {process.returncode}")
                logger.error(f"STDOUT: {stdout_str}")
                logger.error(f"STDERR: {stderr_str}")
                
                # Extract meaningful error from output
                error_msg = self._extract_error_message(stdout_str, stderr_str)
                raise RuntimeError(f"OrcaSlicer failed: {error_msg}")
                
            # Log successful completion
            stdout_str = stdout.decode('utf-8', errors='ignore') if stdout else ""
            if stdout_str:
                logger.debug(f"OrcaSlicer output: {stdout_str}")
                
        except asyncio.TimeoutError:
            logger.error(f"OrcaSlicer timed out after {timeout}s for {input_file}")
            # Try to kill the process
            try:
                process.kill()
                await process.wait()
            except:
                pass
            raise asyncio.TimeoutError(f"Slicing timed out after {timeout} seconds")
            
        except Exception as e:
            logger.error(f"Error executing OrcaSlicer: {e}")
            raise RuntimeError(f"Failed to execute OrcaSlicer: {e}")
            
    def _extract_error_message(self, stdout: str, stderr: str) -> str:
        """Extract meaningful error message from OrcaSlicer output"""
        # Combine both streams
        full_output = f"{stderr}\n{stdout}".strip()
        
        # Look for common error patterns
        error_patterns = [
            "Error:",
            "ERROR:",
            "error:",
            "Failed",
            "FAILED", 
            "Exception:",
            "Fatal:"
        ]
        
        lines = full_output.split('\n')
        error_lines = []
        
        for line in lines:
            line = line.strip()
            if any(pattern in line for pattern in error_patterns):
                error_lines.append(line)
                
        if error_lines:
            return "; ".join(error_lines[:3])  # Return first 3 error lines
        elif stderr:
            # Return first non-empty line from stderr
            for line in stderr.split('\n'):
                line = line.strip()
                if line:
                    return line
        elif stdout:
            # Return last non-empty line from stdout
            lines = [line.strip() for line in stdout.split('\n') if line.strip()]
            if lines:
                return lines[-1]
                
        return "Unknown error occurred during slicing"
        
    def calculate_timeout(self, file_size_mb: float, object_count: int = 1) -> int:
        """
        Calculate appropriate timeout based on file size and complexity
        
        Args:
            file_size_mb: File size in megabytes
            object_count: Number of objects (for multiplication scenarios)
            
        Returns:
            Timeout in seconds
        """
        # Base timeout: 2 minutes for simple files
        base_timeout = 120
        
        # Add time based on file size (30s per MB)
        size_factor = max(1, file_size_mb * 30)
        
        # Add time based on object count (15s per object after first)
        object_factor = max(0, (object_count - 1) * 15)
        
        # Calculate total with minimum and maximum bounds
        total_timeout = int(base_timeout + size_factor + object_factor)
        
        # Enforce reasonable bounds
        min_timeout = 60   # 1 minute minimum
        max_timeout = 1800 # 30 minutes maximum
        
        return max(min_timeout, min(max_timeout, total_timeout))
        
    def validate_3mf_file(self, file_path: str) -> bool:
        """
        Validate that the file is a proper 3MF file
        
        Args:
            file_path: Path to the file to validate
            
        Returns:
            True if valid 3MF file
            
        Raises:
            ValueError: If file is not valid
        """
        if not os.path.exists(file_path):
            raise ValueError(f"File does not exist: {file_path}")
            
        if not file_path.lower().endswith('.3mf'):
            raise ValueError("File must have .3mf extension")
            
        # Check if file is not empty
        if os.path.getsize(file_path) == 0:
            raise ValueError("File is empty")
            
        # Basic ZIP file validation (3MF files are ZIP archives)
        try:
            import zipfile
            with zipfile.ZipFile(file_path, 'r') as zip_file:
                # Check for required 3MF structure
                files = zip_file.namelist()
                if '3D/3dmodel.model' not in files:
                    raise ValueError("Invalid 3MF file: missing 3dmodel.model")
        except zipfile.BadZipFile:
            raise ValueError("File is not a valid ZIP/3MF archive")
        except Exception as e:
            raise ValueError(f"Error validating 3MF file: {e}")
            
        return True
        
    async def get_file_info(self, file_path: str) -> dict:
        """
        Get information about a 3MF file without slicing
        
        Args:
            file_path: Path to 3MF file
            
        Returns:
            Dictionary with file information
        """
        self.validate_3mf_file(file_path)
        
        file_size = os.path.getsize(file_path)
        file_size_mb = file_size / (1024 * 1024)
        
        # Try to extract basic info from 3MF
        object_count = 1  # Default assumption
        try:
            import zipfile
            import xml.etree.ElementTree as ET
            
            with zipfile.ZipFile(file_path, 'r') as zip_file:
                model_content = zip_file.read('3D/3dmodel.model')
                root = ET.fromstring(model_content)
                
                # Count objects in the model
                namespace = {'3mf': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'}
                objects = root.findall('.//3mf:object', namespace)
                if objects:
                    object_count = len(objects)
                    
        except Exception as e:
            logger.warning(f"Could not extract object count from 3MF: {e}")
            
        return {
            "file_size_bytes": file_size,
            "file_size_mb": round(file_size_mb, 2),
            "estimated_object_count": object_count,
            "recommended_timeout": self.calculate_timeout(file_size_mb, object_count)
        }
        
