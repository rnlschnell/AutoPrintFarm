import numpy as np
import trimesh
from typing import Tuple, List, Optional
import logging

logger = logging.getLogger(__name__)

class MeshUtils:
    """Utility functions for mesh operations"""
    
    @staticmethod
    def validate_mesh(mesh: trimesh.Trimesh) -> bool:
        """Validate that mesh is valid and printable"""
        if not mesh.is_valid:
            logger.warning("Mesh is not valid")
            return False
        
        if not mesh.is_watertight:
            logger.warning("Mesh is not watertight")
            # Still allow non-watertight meshes but warn
        
        if mesh.vertices.shape[0] == 0:
            logger.error("Mesh has no vertices")
            return False
        
        if mesh.faces.shape[0] == 0:
            logger.error("Mesh has no faces")
            return False
        
        return True
    
    @staticmethod
    def get_mesh_dimensions(mesh: trimesh.Trimesh) -> Tuple[float, float, float]:
        """Get mesh dimensions (width, depth, height)"""
        bounds = mesh.bounds
        width = bounds[1][0] - bounds[0][0]
        depth = bounds[1][1] - bounds[0][1]
        height = bounds[1][2] - bounds[0][2]
        return width, depth, height
    
    @staticmethod
    def center_mesh_xy(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
        """Center mesh at origin in X and Y, keep Z position"""
        centered = mesh.copy()
        bounds = centered.bounds
        center_x = (bounds[0][0] + bounds[1][0]) / 2
        center_y = (bounds[0][1] + bounds[1][1]) / 2
        centered.apply_translation([-center_x, -center_y, 0])
        return centered
    
    @staticmethod
    def place_on_build_plate(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
        """Place mesh on build plate (Z=0)"""
        placed = mesh.copy()
        z_min = placed.bounds[0][2]
        if z_min != 0:
            placed.apply_translation([0, 0, -z_min])
        return placed
    
    @staticmethod
    def calculate_optimal_grid(
        object_count: int, 
        object_width: float, 
        object_depth: float,
        spacing: float,
        max_width: float,
        max_depth: float
    ) -> Tuple[int, int]:
        """
        Calculate optimal grid dimensions for object placement
        
        Returns:
            Tuple of (columns, rows)
        """
        # Start with square grid
        cols = int(np.ceil(np.sqrt(object_count)))
        rows = int(np.ceil(object_count / cols))
        
        # Check if it fits
        total_width = (cols * object_width) + ((cols - 1) * spacing)
        total_depth = (rows * object_depth) + ((rows - 1) * spacing)
        
        # If doesn't fit, try different arrangements
        if total_width > max_width or total_depth > max_depth:
            # Try more rows, fewer columns
            while cols > 1:
                cols -= 1
                rows = int(np.ceil(object_count / cols))
                total_width = (cols * object_width) + ((cols - 1) * spacing)
                total_depth = (rows * object_depth) + ((rows - 1) * spacing)
                
                if total_width <= max_width and total_depth <= max_depth:
                    return cols, rows
            
            # If still doesn't fit, try more columns, fewer rows
            cols = int(np.ceil(np.sqrt(object_count)))
            while rows > 1:
                rows -= 1
                cols = int(np.ceil(object_count / rows))
                total_width = (cols * object_width) + ((cols - 1) * spacing)
                total_depth = (rows * object_depth) + ((rows - 1) * spacing)
                
                if total_width <= max_width and total_depth <= max_depth:
                    return cols, rows
        
        return cols, rows
    
    @staticmethod
    def validate_spacing(
        object_count: int,
        object_width: float,
        object_depth: float,
        spacing: float,
        max_width: float,
        max_depth: float
    ) -> Tuple[bool, Optional[float]]:
        """
        Validate if objects fit with given spacing
        
        Returns:
            Tuple of (fits, max_allowed_spacing)
        """
        cols, rows = MeshUtils.calculate_optimal_grid(
            object_count, object_width, object_depth, spacing, max_width, max_depth
        )
        
        total_width = (cols * object_width) + ((cols - 1) * spacing)
        total_depth = (rows * object_depth) + ((rows - 1) * spacing)
        
        if total_width <= max_width and total_depth <= max_depth:
            # Calculate maximum possible spacing
            max_spacing_width = (max_width - (cols * object_width)) / (cols - 1) if cols > 1 else float('inf')
            max_spacing_depth = (max_depth - (rows * object_depth)) / (rows - 1) if rows > 1 else float('inf')
            max_spacing = min(max_spacing_width, max_spacing_depth)
            return True, max_spacing
        
        # Calculate maximum spacing that would work
        if cols > 1 and rows > 1:
            max_spacing_width = (max_width - (cols * object_width)) / (cols - 1)
            max_spacing_depth = (max_depth - (rows * object_depth)) / (rows - 1)
            max_spacing = min(max_spacing_width, max_spacing_depth)
            if max_spacing > 0:
                return False, max_spacing
        
        return False, 0.0
    
    @staticmethod
    def estimate_mesh_volume(mesh: trimesh.Trimesh) -> float:
        """Estimate mesh volume in mm³"""
        try:
            return float(mesh.volume)
        except:
            # Fallback for non-watertight meshes
            bounds = mesh.bounds
            width = bounds[1][0] - bounds[0][0]
            depth = bounds[1][1] - bounds[0][1]
            height = bounds[1][2] - bounds[0][2]
            return width * depth * height * 0.5  # Rough estimate