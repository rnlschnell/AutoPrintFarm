import os
import zipfile
import tempfile
import shutil
import xml.etree.ElementTree as ET
import numpy as np
import logging
from typing import Tuple, List, Dict, Any, Optional
import uuid
from pathlib import Path
import math
import asyncio

from ..utils.resource_monitor import resource_monitor

logger = logging.getLogger(__name__)

class ThreeMFProcessor:
    """Handles 3MF file manipulation for object multiplication"""
    
    # Build plate dimensions for Bambu Lab printers (in mm)
    BUILD_PLATE_SIZE = 220.0  # Reduced to ensure objects stay well within bounds
    EDGE_MARGIN = 10.0  # Safety margin from edges
    USABLE_AREA = BUILD_PLATE_SIZE - (2 * EDGE_MARGIN)
    
    def __init__(self):
        self.temp_dir = None
        self.namespace = {'3mf': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'}
        self.is_step_import = False
        
    async def process_3mf(self, input_file_path: str, object_count: int, spacing_mm: float) -> str:
        """
        Process a 3MF file to multiply objects while preserving all metadata
        
        Args:
            input_file_path: Path to input 3MF file
            object_count: Number of objects to create
            spacing_mm: Spacing between objects in mm
            
        Returns:
            Path to the processed 3MF file
        """
        # Start resource monitoring task
        monitoring_task = None
        try:
            # Check system resources before starting intensive operation
            is_safe, reason = resource_monitor.check_resources_safe("3MF multiplication")
            if not is_safe:
                raise RuntimeError(f"System resources insufficient for 3MF processing: {reason}")
            
            # Validate file size and object count for Pi limitations
            file_size_mb = os.path.getsize(input_file_path) / (1024 * 1024)
            limits = resource_monitor.get_recommended_limits(file_size_mb, object_count)
            
            if file_size_mb > limits["max_file_size_mb"]:
                raise ValueError(f"File too large: {file_size_mb:.1f}MB (max {limits['max_file_size_mb']}MB for Pi)")
                
            if object_count > limits["max_object_count"]:
                raise ValueError(f"Too many objects: {object_count} (max {limits['max_object_count']} for Pi)")
            
            logger.info(f"Starting 3MF processing: {file_size_mb:.1f}MB file, {object_count} objects")
            logger.info(f"Recommended timeout: {limits['multiply_timeout']}s")
            
            # Start background resource monitoring
            monitoring_task = asyncio.create_task(
                resource_monitor.monitor_during_operation(
                    "3MF multiplication", 
                    check_interval=5.0, 
                    max_duration=limits['multiply_timeout']
                )
            )
            # Create temporary directory for processing
            self.temp_dir = tempfile.mkdtemp()
            extract_dir = os.path.join(self.temp_dir, 'extracted')
            output_dir = os.path.join(self.temp_dir, 'output')
            
            # Extract 3MF contents
            logger.info(f"Extracting 3MF file to {extract_dir}")
            self._extract_3mf(input_file_path, extract_dir)
            
            # Check resources after extraction
            is_safe, reason = resource_monitor.check_resources_safe("After 3MF extraction")
            if not is_safe:
                raise RuntimeError(f"System resources depleted during extraction: {reason}")
            
            # Copy all files to output directory first (preserve everything)
            shutil.copytree(extract_dir, output_dir)
            
            # Detect if this is a STEP import before processing
            self.is_step_import = self._detect_step_import(output_dir)
            
            # Find and analyze the 3D model file
            model_path = self._find_model_file(output_dir)
            if not model_path:
                raise ValueError("No 3D model file found in 3MF")
            
            # Parse and analyze the original model
            logger.info("Analyzing original 3D model structure...")
            original_bounds = self._get_object_bounds(model_path)
            if not original_bounds:
                raise ValueError("Could not determine object bounds from 3MF file")
            
            # Calculate grid positions for objects
            logger.info(f"Calculating grid layout for {object_count} objects with {spacing_mm}mm spacing")
            positions = self._calculate_grid_positions(
                original_bounds, 
                object_count, 
                spacing_mm
            )
            
            # Validate positions before processing
            if len(positions) != object_count:
                raise ValueError(f"Position count ({len(positions)}) doesn't match requested object count ({object_count})")
            
            # Modify the model file to include multiple build items
            logger.info(f"Creating multiplied build layout for {object_count} objects...")
            self._create_multiplied_build_items(model_path, positions)
            
            # Check resources after multiplication
            is_safe, reason = resource_monitor.check_resources_safe("After object multiplication")
            if not is_safe:
                raise RuntimeError(f"System resources depleted during multiplication: {reason}")
            
            # Verify the multiplication worked by checking the file
            self._verify_multiplication_success(model_path, object_count)
            
            # Standardize metadata for consistent object display
            logger.info("Updating object metadata...")
            self._standardize_object_metadata(output_dir, object_count, positions, original_bounds)
            
            # For STEP files, verify the assembly metadata was updated correctly
            if self.is_step_import:
                self._verify_step_assembly_update(output_dir, object_count)
            
            # Create output 3MF file
            output_filename = f"multiplied_{object_count}x_{int(spacing_mm)}mm_{uuid.uuid4().hex[:8]}.3mf"
            output_path = os.path.join(self.temp_dir, output_filename)
            self._create_3mf(output_dir, output_path)
            
            logger.info(f"Successfully created 3MF with {object_count} objects")
            return output_path
            
        except Exception as e:
            logger.error(f"Error processing 3MF file: {e}")
            if self.temp_dir and os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir)
            raise
        finally:
            # Cancel resource monitoring task
            if monitoring_task and not monitoring_task.done():
                monitoring_task.cancel()
                try:
                    await monitoring_task
                except asyncio.CancelledError:
                    pass
    
    def cleanup(self):
        """Clean up temporary files"""
        if self.temp_dir and os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
            self.temp_dir = None
    
    def _extract_3mf(self, file_path: str, extract_dir: str):
        """Extract 3MF ZIP contents"""
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)
    
    def _create_3mf(self, source_dir: str, output_path: str):
        """Create 3MF file from directory contents"""
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
            for root, dirs, files in os.walk(source_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arc_name = os.path.relpath(file_path, source_dir)
                    zip_ref.write(file_path, arc_name)
    
    def _find_model_file(self, extract_dir: str) -> Optional[str]:
        """Find the 3D model file in extracted contents"""
        # Common locations for 3D model in 3MF files
        possible_paths = [
            os.path.join(extract_dir, '3D', '3dmodel.model'),
            os.path.join(extract_dir, '3D', 'Objects', '3dmodel.model'),
            os.path.join(extract_dir, '3dmodel.model')
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                return path
        
        # Search for any .model file
        for root, dirs, files in os.walk(extract_dir):
            for file in files:
                if file.endswith('.model'):
                    return os.path.join(root, file)
        
        return None
    
    def _detect_step_import(self, output_dir: str) -> bool:
        """Detect if this 3MF was imported from a STEP file"""
        try:
            model_settings_path = os.path.join(output_dir, 'Metadata', 'model_settings.config')
            
            if not os.path.exists(model_settings_path):
                return False
            
            with open(model_settings_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Check for STEP file references in the metadata
            import re
            
            # Method 1: Check for .step file extensions in source_file attributes
            step_pattern = r'source_file="[^"]*\.step"'
            step_match = re.search(step_pattern, content, re.IGNORECASE)
            
            if step_match:
                logger.info("Detected STEP file import via source_file attribute")
                return True
            
            # Method 2: Check for .step in source names
            source_pattern = r'<source[^>]*name="[^"]*\.step"'
            source_match = re.search(source_pattern, content, re.IGNORECASE)
            
            if source_match:
                logger.info("Detected STEP file import via source name")
                return True
            
            # Method 3: Check for .step in object names (like "Bambu_Ball.step")
            object_pattern = r'name="[^"]*\.step"'
            object_match = re.search(object_pattern, content, re.IGNORECASE)
            
            if object_match:
                logger.info("Detected STEP file import via object name")
                return True
                
            # Method 4: Check for .step anywhere in the file (last resort)
            if '.step' in content.lower():
                logger.info("Detected potential STEP file import via content scan")
                return True
                
            return False
            
        except Exception as e:
            logger.warning(f"Could not detect STEP import: {e}")
            return False
    
    def _get_object_bounds(self, model_path: str) -> Optional[Dict[str, float]]:
        """Get the bounding box of the printable object from the 3MF model"""
        try:
            tree = ET.parse(model_path)
            root = tree.getroot()
            
            # Find the build item to get the transform and object reference
            build = root.find('.//3mf:build', self.namespace)
            if build is None:
                logger.error("No build section found in 3MF model")
                return None
            
            # Get the first build item
            item = build.find('3mf:item', self.namespace)
            if item is None:
                logger.error("No build items found in 3MF model")
                return None
            
            # Get the object ID and transform
            object_id = item.get('objectid')
            transform = item.get('transform')
            
            if not object_id:
                logger.error("Build item has no object ID")
                return None
            
            # Find the referenced object
            obj = root.find(f'.//3mf:object[@id="{object_id}"]', self.namespace)
            if obj is None:
                logger.error(f"Referenced object {object_id} not found")
                return None
            
            # Calculate bounds from the object and transform
            bounds = self._calculate_object_bounds_recursive(root, object_id, transform)
            
            if bounds:
                width = bounds['max_x'] - bounds['min_x']
                depth = bounds['max_y'] - bounds['min_y']
                height = bounds['max_z'] - bounds['min_z']
                
                logger.info(f"Object bounds: {width:.2f}x{depth:.2f}x{height:.2f}mm")
                return {
                    'width': width,
                    'depth': depth,
                    'height': height,
                    'min_x': bounds['min_x'],
                    'min_y': bounds['min_y'],
                    'min_z': bounds['min_z'],
                    'max_x': bounds['max_x'],
                    'max_y': bounds['max_y'],
                    'max_z': bounds['max_z']
                }
            
            return None
            
        except Exception as e:
            logger.error(f"Error calculating object bounds: {e}")
            return None
    
    def _calculate_object_bounds_recursive(self, root, object_id: str, transform: str = None) -> Optional[Dict[str, float]]:
        """Recursively calculate bounds of an object, following component references"""
        obj = root.find(f'.//3mf:object[@id="{object_id}"]', self.namespace)
        if obj is None:
            return None
        
        # Parse transform if provided
        transform_matrix = self._parse_transform(transform) if transform else np.eye(4)
        
        all_bounds = []
        
        # Check if object has mesh data
        mesh = obj.find('3mf:mesh', self.namespace)
        if mesh is not None:
            bounds = self._get_mesh_bounds(mesh, transform_matrix)
            if bounds:
                all_bounds.append(bounds)
        
        # Check if object has components
        components = obj.find('3mf:components', self.namespace)
        if components is not None:
            for component in components.findall('3mf:component', self.namespace):
                comp_object_id = component.get('objectid')
                comp_transform = component.get('transform')
                
                # Combine transforms
                comp_matrix = self._parse_transform(comp_transform) if comp_transform else np.eye(4)
                combined_matrix = np.dot(transform_matrix, comp_matrix)
                
                # Get bounds of referenced object
                comp_bounds = self._calculate_object_bounds_recursive(root, comp_object_id, self._matrix_to_transform(combined_matrix))
                if comp_bounds:
                    all_bounds.append(comp_bounds)
        
        # Combine all bounds
        if all_bounds:
            return {
                'min_x': min(b['min_x'] for b in all_bounds),
                'min_y': min(b['min_y'] for b in all_bounds),
                'min_z': min(b['min_z'] for b in all_bounds),
                'max_x': max(b['max_x'] for b in all_bounds),
                'max_y': max(b['max_y'] for b in all_bounds),
                'max_z': max(b['max_z'] for b in all_bounds)
            }
        
        return None
    
    def _get_mesh_bounds(self, mesh, transform_matrix: np.ndarray) -> Optional[Dict[str, float]]:
        """Get bounds of a mesh with transform applied"""
        vertices_elem = mesh.find('3mf:vertices', self.namespace)
        if vertices_elem is None:
            return None
        
        vertices = []
        for vertex in vertices_elem.findall('3mf:vertex', self.namespace):
            x = float(vertex.get('x', 0))
            y = float(vertex.get('y', 0))
            z = float(vertex.get('z', 0))
            vertices.append([x, y, z, 1])  # Homogeneous coordinates
        
        if not vertices:
            return None
        
        # Apply transform to all vertices
        vertices_array = np.array(vertices)
        transformed_vertices = np.dot(vertices_array, transform_matrix.T)
        
        return {
            'min_x': float(np.min(transformed_vertices[:, 0])),
            'min_y': float(np.min(transformed_vertices[:, 1])),
            'min_z': float(np.min(transformed_vertices[:, 2])),
            'max_x': float(np.max(transformed_vertices[:, 0])),
            'max_y': float(np.max(transformed_vertices[:, 1])),
            'max_z': float(np.max(transformed_vertices[:, 2]))
        }
    
    def _parse_transform(self, transform_str: str) -> np.ndarray:
        """Parse 3MF transform string to 4x4 matrix with robust error handling"""
        if not transform_str:
            return np.eye(4)
        
        try:
            # Split and clean the transform string, handling scientific notation
            values = []
            for val_str in transform_str.split():
                try:
                    # Handle scientific notation like -2.22044605e-16
                    val = float(val_str)
                    # Clamp very small values to zero to avoid floating point issues
                    if abs(val) < 1e-10:
                        val = 0.0
                    values.append(val)
                except ValueError as e:
                    logger.warning(f"Could not parse transform value '{val_str}': {e}")
                    values.append(0.0)
            
            if len(values) != 12:
                logger.warning(f"Invalid transform format (expected 12 values, got {len(values)}): {transform_str}")
                return np.eye(4)
            
            # Build 4x4 matrix
            matrix = np.eye(4)
            matrix[0, :3] = values[0:3]   # m00 m01 m02
            matrix[1, :3] = values[3:6]   # m10 m11 m12
            matrix[2, :3] = values[6:9]   # m20 m21 m22
            matrix[0, 3] = values[9]      # m30
            matrix[1, 3] = values[10]     # m31
            matrix[2, 3] = values[11]     # m32
            
            logger.debug(f"Parsed transform matrix from: {transform_str}")
            return matrix
            
        except Exception as e:
            logger.error(f"Error parsing transform '{transform_str}': {e}")
            return np.eye(4)
    
    def _matrix_to_transform(self, matrix: np.ndarray) -> str:
        """Convert 4x4 matrix to 3MF transform string"""
        return f"{matrix[0,0]} {matrix[0,1]} {matrix[0,2]} {matrix[1,0]} {matrix[1,1]} {matrix[1,2]} {matrix[2,0]} {matrix[2,1]} {matrix[2,2]} {matrix[0,3]} {matrix[1,3]} {matrix[2,3]}"
    
    def _calculate_grid_positions(self, bounds: Dict[str, float], count: int, spacing: float) -> List[Tuple[float, float]]:
        """Calculate grid positions for objects with robust center calculation"""
        object_width = bounds['width']
        object_depth = bounds['depth']
        
        # Calculate grid dimensions
        grid_cols = int(math.ceil(math.sqrt(count)))
        grid_rows = int(math.ceil(count / grid_cols))
        
        # Calculate cell size (object + spacing)
        cell_width = object_width + spacing
        cell_depth = object_depth + spacing
        
        # Calculate total grid size
        grid_width = (grid_cols * object_width) + ((grid_cols - 1) * spacing)
        grid_depth = (grid_rows * object_depth) + ((grid_rows - 1) * spacing)
        
        # Check if it fits on build plate
        if grid_width > self.USABLE_AREA or grid_depth > self.USABLE_AREA:
            # Try different arrangements
            while grid_cols > 1 and (grid_width > self.USABLE_AREA or grid_depth > self.USABLE_AREA):
                if grid_width > grid_depth:
                    grid_cols -= 1
                else:
                    if grid_rows > 1:
                        grid_rows -= 1
                    else:
                        grid_cols -= 1
                
                grid_rows = int(math.ceil(count / grid_cols))
                grid_width = (grid_cols * object_width) + ((grid_cols - 1) * spacing)
                grid_depth = (grid_rows * object_depth) + ((grid_rows - 1) * spacing)
            
            if grid_width > self.USABLE_AREA or grid_depth > self.USABLE_AREA:
                raise ValueError(f"Cannot fit {count} objects with {spacing}mm spacing on {self.BUILD_PLATE_SIZE}mm build plate")
        
        # ALWAYS center the grid on the actual build plate center (128, 128)
        # regardless of original object position - this fixes both STEP and STL positioning
        ACTUAL_BUILD_PLATE_SIZE = 256.0  # Actual Bambu Lab build plate size
        BUILD_PLATE_CENTER = ACTUAL_BUILD_PLATE_SIZE / 2  # 128mm
        
        start_x = BUILD_PLATE_CENTER - (grid_width / 2)
        start_y = BUILD_PLATE_CENTER - (grid_depth / 2)
        
        # Generate positions - ensure we create exactly the requested count
        positions = []
        for i in range(count):
            row = i // grid_cols
            col = i % grid_cols
            
            # Position is the center of where this object should be placed
            x = start_x + (col * cell_width) + (object_width / 2)
            y = start_y + (row * cell_depth) + (object_depth / 2)
            
            positions.append((x, y))
            
            # Only log first few objects to avoid spam with large counts
            if i < 5 or count <= 10:
                if self.is_step_import:
                    logger.debug(f"STEP import object {i}: positioned at ({x:.1f}, {y:.1f})")
                else:
                    logger.debug(f"Standard object {i}: positioned at ({x:.1f}, {y:.1f})")
        
        positioning_type = "STEP-aware" if self.is_step_import else "standard"
        logger.info(f"Grid layout ({positioning_type}): {grid_cols}x{grid_rows}, {len(positions)} objects, grid size: {grid_width:.1f}x{grid_depth:.1f}mm, centered at ({BUILD_PLATE_CENTER}, {BUILD_PLATE_CENTER})")
        
        # Validate we created the correct number of positions
        if len(positions) != count:
            logger.error(f"Position count mismatch: expected {count}, created {len(positions)}")
            raise ValueError(f"Failed to generate correct number of positions: expected {count}, got {len(positions)}")
            
        return positions
    
    def _apply_rotation_compensation(self, x: float, y: float, rotation_matrix: np.ndarray) -> Tuple[float, float]:
        """Apply rotation compensation to ensure objects appear at desired visual positions"""
        # Check if there's a meaningful rotation (not identity matrix)
        is_rotated = not np.allclose(rotation_matrix, np.eye(3))
        
        if not is_rotated:
            # No rotation, use position directly
            return x, y
        
        # Check if this is a Z-axis rotation (in-plane rotation)
        # Z-axis rotations have the form: [[cos, -sin, 0], [sin, cos, 0], [0, 0, 1]]
        # We detect this by checking if the Z column and Z row are [0, 0, 1]
        z_column_correct = np.allclose(rotation_matrix[:, 2], [0, 0, 1])
        z_row_correct = np.allclose(rotation_matrix[2, :], [0, 0, 1])
        is_z_rotation = z_column_correct and z_row_correct
        
        if not is_z_rotation:
            # This is an axis-swapping rotation (like X or Y rotation)
            # These are problematic for position compensation
            # For now, use direct positioning without compensation
            logger.info(f"Detected axis-swapping rotation, using direct positioning")
            return x, y
        
        try:
            # For Z-axis rotations, apply standard compensation
            # This works because Z rotations don't affect the Z coordinate
            desired_pos = np.array([x - 128, y - 128, 0])  # Center-relative position
            inv_rotation = np.linalg.inv(rotation_matrix)
            rotated_pos = np.dot(inv_rotation, desired_pos)
            
            adjusted_x = rotated_pos[0] + 128
            adjusted_y = rotated_pos[1] + 128
            
            logger.debug(f"Z-rotation compensation: ({x:.1f}, {y:.1f}) -> ({adjusted_x:.1f}, {adjusted_y:.1f})")
            return adjusted_x, adjusted_y
            
        except np.linalg.LinAlgError:
            # If rotation matrix is not invertible, use original position
            logger.warning("Cannot invert rotation matrix, using original position")
            return x, y
    
    def _verify_multiplication_success(self, model_path: str, expected_count: int):
        """Verify that the multiplication created the correct number of build items"""
        try:
            with open(model_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Count build items
            import re
            item_pattern = r'<item\s+[^>]+/>'
            items = re.findall(item_pattern, content)
            actual_count = len(items)
            
            if actual_count != expected_count:
                raise ValueError(f"Multiplication verification failed: expected {expected_count} build items, found {actual_count}")
            
            logger.info(f"Multiplication verification successful: {actual_count} build items created")
            
        except Exception as e:
            logger.error(f"Failed to verify multiplication: {e}")
            raise
    
    def _verify_step_assembly_update(self, output_dir: str, expected_count: int):
        """Verify that STEP assembly metadata was updated correctly"""
        try:
            model_settings_path = os.path.join(output_dir, 'Metadata', 'model_settings.config')
            
            if not os.path.exists(model_settings_path):
                raise ValueError("model_settings.config not found for STEP verification")
            
            with open(model_settings_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Count assemble items
            import re
            assemble_pattern = r'<assemble_item[^>]+/>'
            assemble_items = re.findall(assemble_pattern, content)
            actual_count = len(assemble_items)
            
            # Debug logging
            logger.info(f"STEP assembly verification: looking for {expected_count} items")
            logger.info(f"Found assemble items: {assemble_items}")
            logger.info(f"Actual count: {actual_count}")
            
            if actual_count != expected_count:
                # Log the actual content for debugging
                logger.error(f"Assembly section content: {content}")
                raise ValueError(f"STEP assembly verification failed: expected {expected_count} assemble items, found {actual_count}")
            
            logger.info(f"STEP assembly verification successful: {actual_count} assemble items updated")
            
        except Exception as e:
            logger.error(f"Failed to verify STEP assembly update: {e}")
            raise
    
    def _create_multiplied_build_items(self, model_path: str, positions: List[Tuple[float, float]]):
        """Modify the 3MF model to create multiple build items at specified positions"""
        try:
            # Read the file as text to preserve exact formatting and namespaces
            with open(model_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Find the build section using regex
            import re
            build_pattern = r'<build>(.*?)</build>'
            build_match = re.search(build_pattern, content, re.DOTALL)
            
            if not build_match:
                raise ValueError("No build section found in 3MF model")
            
            # Extract the original build content
            original_build_content = build_match.group(1).strip()
            
            # Find the original item using regex
            item_pattern = r'<item\s+([^>]+)/>'
            item_match = re.search(item_pattern, original_build_content)
            
            if not item_match:
                raise ValueError("No build items found in 3MF model")
            
            # Parse the original item attributes
            item_attrs = item_match.group(1)
            
            # Extract objectid, transform, and printable attributes
            objectid_match = re.search(r'objectid="([^"]+)"', item_attrs)
            transform_match = re.search(r'transform="([^"]+)"', item_attrs)
            printable_match = re.search(r'printable="([^"]+)"', item_attrs)
            
            if not objectid_match:
                raise ValueError("No objectid found in build item")
            
            original_object_id = objectid_match.group(1)
            original_transform = transform_match.group(1) if transform_match else None
            original_printable = printable_match.group(1) if printable_match else "1"
            
            # Parse original transform to get rotation and Z position
            original_matrix = self._parse_transform(original_transform) if original_transform else np.eye(4)
            rotation_matrix = original_matrix[:3, :3]
            original_z = original_matrix[2, 3]
            original_x = original_matrix[0, 3]
            original_y = original_matrix[1, 3]
            
            logger.info(f"Creating {len(positions)} build items (original transform: {original_transform})")
            logger.info(f"Original position: ({original_x:.1f}, {original_y:.1f}, {original_z:.1f}), STEP: {self.is_step_import}")
            
            # For STEP files that are positioned off-center, calculate the offset
            # This helps maintain relative positioning that Bambu Studio expects
            x_offset = 0
            y_offset = 0
            if self.is_step_import:
                # Check if original position is significantly off-center
                distance_from_center = math.sqrt((original_x - 128)**2 + (original_y - 128)**2)
                if distance_from_center > 20:  # More than 20mm from center
                    # Calculate offset from original to center
                    x_offset = original_x - 128
                    y_offset = original_y - 128
                    logger.info(f"STEP file is off-center by ({x_offset:.1f}, {y_offset:.1f}), applying offset correction")
            
            # Generate new build items - ENSURE we create exactly the requested count
            new_build_items = []
            for i, (x, y) in enumerate(positions):
                # Apply rotation compensation for visual positioning
                adjusted_x, adjusted_y = self._apply_rotation_compensation(x, y, rotation_matrix)
                
                # For off-center STEP files, apply the offset
                if self.is_step_import and (x_offset != 0 or y_offset != 0):
                    # Instead of centering at 128,128, maintain relative offset
                    adjusted_x = x + x_offset
                    adjusted_y = y + y_offset
                    logger.debug(f"STEP offset applied: ({x:.1f}, {y:.1f}) -> ({adjusted_x:.1f}, {adjusted_y:.1f})")
                
                # Create new transform matrix preserving original rotation and Z
                new_matrix = original_matrix.copy()
                new_matrix[0, 3] = adjusted_x  # Set X position
                new_matrix[1, 3] = adjusted_y  # Set Y position
                new_matrix[2, 3] = original_z  # Preserve original Z
                
                # Create new item XML
                new_transform = self._matrix_to_transform(new_matrix)
                new_item = f'  <item objectid="{original_object_id}" transform="{new_transform}" printable="{original_printable}"/>'
                new_build_items.append(new_item)
                
                # Only log first few items to reduce spam for large counts
                if i < 5 or len(positions) <= 10:
                    logger.debug(f"Created build item {i+1}/{len(positions)}: pos=({adjusted_x:.1f}, {adjusted_y:.1f}, {original_z:.1f})")
            
            # Validate we created the correct number of items
            if len(new_build_items) != len(positions):
                raise ValueError(f"Build item count mismatch: expected {len(positions)}, created {len(new_build_items)}")
            
            logger.info(f"Successfully created {len(new_build_items)} build items")
            
            # Create new build section content
            new_build_content = f"<build>\n{chr(10).join(new_build_items)}\n </build>"
            
            # Replace the build section in the content
            new_content = re.sub(build_pattern, new_build_content, content, flags=re.DOTALL)
            
            # Write the modified content back
            with open(model_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            
            logger.info(f"Created {len(positions)} build items in model file")
            
        except Exception as e:
            logger.error(f"Error creating multiplied build items: {e}")
            raise
    
    def _standardize_object_metadata(self, output_dir: str, object_count: int, positions: List[Tuple[float, float]], bounds: Dict[str, float]):
        """Update metadata for consistent display - CRITICAL for STEP files"""
        try:
            model_settings_path = os.path.join(output_dir, 'Metadata', 'model_settings.config')
            
            if not os.path.exists(model_settings_path):
                logger.warning("model_settings.config not found, skipping metadata update")
                return
            
            # For STEP files, this metadata update is CRITICAL - it overrides build item positions
            if self.is_step_import:
                logger.info("STEP file detected: Updating assembly metadata to override build positions")
                self._update_step_assembly_metadata(model_settings_path, output_dir, object_count)
            else:
                # For STL files, just do standard metadata sync
                logger.info("STL file: Performing standard metadata synchronization")
                self._update_standard_metadata(model_settings_path, output_dir, object_count, positions, bounds)
            
        except Exception as e:
            logger.error(f"Error updating object metadata: {e}")
            if self.is_step_import:
                # For STEP files, metadata failure is critical
                raise RuntimeError(f"STEP file metadata update failed - positioning will not work: {e}")
            else:
                # For STL files, continue without metadata update
                logger.info("Continuing without metadata update for STL file")
    
    def _update_step_assembly_metadata(self, model_settings_path: str, output_dir: str, object_count: int):
        """Update assembly section for STEP files - this has final authority over positioning"""
        logger.info(f"Starting STEP assembly metadata update for {object_count} objects")
        try:
            # Read the current metadata
            logger.info(f"Reading metadata from: {model_settings_path}")
            with open(model_settings_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            logger.info(f"Original metadata length: {len(content)} characters")
            
            # Get the EXACT transforms from the 3D model build items
            model_path = self._find_model_file(output_dir)
            if not model_path:
                raise ValueError("Cannot find 3D model file for STEP assembly update")
            
            logger.info(f"Reading 3D model from: {model_path}")
            with open(model_path, 'r', encoding='utf-8') as f:
                model_content = f.read()
            
            # Extract the transforms from build items - these are our target positions
            import re
            item_pattern = r'<item\s+objectid="[^"]+"\s+transform="([^"]+)"'
            build_transforms = re.findall(item_pattern, model_content)
            
            logger.info(f"Found {len(build_transforms)} build transforms: {build_transforms}")
            
            if len(build_transforms) != object_count:
                raise ValueError(f"Transform count mismatch: expected {object_count}, found {len(build_transforms)}")
            
            # Create NEW assemble items that EXACTLY match the build transforms
            new_assemble_items = []
            for i, transform in enumerate(build_transforms):
                assemble_item = f'   <assemble_item object_id="2" instance_id="{i}" transform="{transform}" offset="0 0 0" />'
                new_assemble_items.append(assemble_item)
                # Only log first few items to reduce spam for large counts
                if i < 3 or object_count <= 10:
                    logger.info(f"Created assemble item {i}: {assemble_item}")
            
            new_assemble_section = f"<assemble>\n{chr(10).join(new_assemble_items)}\n  </assemble>"
            if object_count <= 5:
                logger.info(f"New assemble section: {new_assemble_section}")
            else:
                logger.info(f"Created assemble section with {len(new_assemble_items)} items")
            
            # Replace the ENTIRE assemble section
            assemble_pattern = r'<assemble>.*?</assemble>'
            
            # Check if pattern exists
            if not re.search(assemble_pattern, content, flags=re.DOTALL):
                logger.warning("No existing assemble section found, appending new one")
                # If no assemble section exists, add it
                new_content = content + "\n" + new_assemble_section
            else:
                logger.info("Replacing existing assemble section")
                new_content = re.sub(assemble_pattern, new_assemble_section, content, flags=re.DOTALL)
            
            logger.info(f"Updated metadata length: {len(new_content)} characters")
            
            # Write the updated metadata back
            with open(model_settings_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            
            logger.info(f"STEP assembly metadata updated: {object_count} instances with synchronized transforms")
            
        except Exception as e:
            logger.error(f"Failed to update STEP assembly metadata: {e}")
            raise
    
    def _update_standard_metadata(self, model_settings_path: str, output_dir: str, object_count: int, positions: List[Tuple[float, float]], bounds: Dict[str, float]):
        """Update metadata for STL files (standard approach)"""
        try:
            # Read the current metadata
            with open(model_settings_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Get the original Z position from bounds
            original_z = bounds.get('min_z', 0.0)
            
            # Create assemble items based on positions
            new_assemble_items = []
            for i, (x, y) in enumerate(positions):
                transform = f"1.0 0.0 0.0 0.0 1.0 0.0 0.0 0.0 1.0 {x} {y} {original_z}"
                assemble_item = f'   <assemble_item object_id="2" instance_id="{i}" transform="{transform}" offset="0 0 0" />'
                new_assemble_items.append(assemble_item)
            
            new_assemble_section = f"<assemble>\n{chr(10).join(new_assemble_items)}\n  </assemble>"
            
            # Replace the assemble section
            import re
            assemble_pattern = r'<assemble>.*?</assemble>'
            new_content = re.sub(assemble_pattern, new_assemble_section, content, flags=re.DOTALL)
            
            # Write the updated metadata back
            with open(model_settings_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            
            logger.info(f"Standard metadata updated: {object_count} items")
            
        except Exception as e:
            logger.error(f"Failed to update standard metadata: {e}")
            # Don't raise for STL files
            pass