"""
3MF Print File Metadata Parser

This module provides functionality to extract metadata from 3MF print files
(Bambu Studio plate-sliced files). 3MF files are ZIP archives containing XML
and JSON metadata files with information about print time, filament usage,
printer requirements, and more.

The parser extracts the following metadata:
- Print time estimate (seconds)
- Filament weight (grams)
- Filament length (meters)
- Filament type (PLA, PETG, ABS, etc.)
- Printer model ID (N1, N2S, P1P, X1, etc.)
- Nozzle diameter (millimeters)
- Layer count
- Bed/plate type
- Print profile used
- Object count (number of objects/instances in the print)
"""

import zipfile
import xml.etree.ElementTree as ET
import json
import logging
import re
from pathlib import Path
from typing import Dict, Optional, Any

logger = logging.getLogger(__name__)


def _map_printer_name_to_id(printer_name: str) -> Optional[str]:
    """
    Map full printer name from project_settings.config to short printer model ID.

    This handles cases where files are sliced with cross-compatible profiles
    (e.g., X1C profile for P1S printer). The printer_model field in project_settings
    contains the actual target printer, which is more accurate than the profile's
    printer_model_id in slice_info.

    Args:
        printer_name: Full printer name like "Bambu Lab P1S" or "Bambu Lab X1-Carbon"

    Returns:
        Short printer model ID like "P1S", "X1C", etc., or None if not recognized
    """
    if not printer_name:
        return None

    # Mapping of full printer names to short IDs
    # Based on Bambu Studio/OrcaSlicer printer naming conventions
    name_to_id = {
        'Bambu Lab X1-Carbon': 'X1C',
        'Bambu Lab X1': 'X1',
        'Bambu Lab X1E': 'X1E',
        'Bambu Lab P1P': 'P1P',
        'Bambu Lab P1S': 'P1S',
        'Bambu Lab A1 mini': 'N1',
        'Bambu Lab A1': 'N2S',
    }

    return name_to_id.get(printer_name)


def parse_3mf_metadata(file_path: str) -> Dict[str, Any]:
    """
    Parse 3MF file and extract metadata.

    Args:
        file_path: Path to the 3MF file

    Returns:
        Dictionary containing extracted metadata fields.
        Fields will be None if not found or if parsing fails.

    Example:
        >>> metadata = parse_3mf_metadata("/path/to/file.3mf")
        >>> print(f"Print time: {metadata['print_time_seconds']} seconds")
        >>> print(f"Filament: {metadata['filament_weight_grams']}g of {metadata['filament_type']}")
    """
    metadata = {
        'print_time_seconds': None,
        'filament_weight_grams': None,
        'filament_length_meters': None,
        'filament_type': None,
        'printer_model_id': None,
        'nozzle_diameter': None,
        'layer_count': None,
        'curr_bed_type': None,
        'default_print_profile': None,
        'object_count': None,
    }

    # Validate file exists
    file_path_obj = Path(file_path)
    if not file_path_obj.exists():
        logger.error(f"3MF file not found: {file_path}")
        return metadata

    # Validate file extension
    if file_path_obj.suffix.lower() != '.3mf':
        logger.warning(f"File does not have .3mf extension: {file_path}")
        # Continue anyway - file might still be a valid 3MF

    try:
        # Open 3MF file as ZIP archive
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            # Parse slice_info.config (fast, small XML file)
            # This contains printer_model_id from the slicing profile
            try:
                metadata.update(_parse_slice_info(zip_ref))
            except Exception as e:
                logger.warning(f"Failed to parse slice_info.config from {file_path}: {e}")

            # Parse project_settings.config (larger JSON file)
            # This contains the actual target printer model, which overrides
            # printer_model_id if they differ (e.g., X1C profile used on P1S)
            try:
                project_settings = _parse_project_settings(zip_ref)
                metadata.update(project_settings)
            except Exception as e:
                logger.warning(f"Failed to parse project_settings.config from {file_path}: {e}")

            # Count objects in the 3MF file
            try:
                object_count = _count_objects_in_3mf(zip_ref)
                metadata['object_count'] = object_count
            except Exception as e:
                logger.warning(f"Failed to count objects in {file_path}: {e}")

        # Log successful extraction
        non_null_count = sum(1 for v in metadata.values() if v is not None)
        logger.info(f"Extracted {non_null_count}/10 metadata fields from {file_path_obj.name}")

        return metadata

    except zipfile.BadZipFile:
        logger.error(f"Invalid ZIP/3MF file: {file_path}")
        return metadata
    except Exception as e:
        logger.error(f"Unexpected error parsing 3MF file {file_path}: {e}")
        return metadata


def _parse_slice_info(zip_ref: zipfile.ZipFile) -> Dict[str, Any]:
    """
    Parse Metadata/slice_info.config file (XML format).

    This file contains:
    - prediction: print time in seconds
    - weight: filament weight in grams
    - printer_model_id: Bambu printer model code
    - nozzle_diameters: nozzle size
    - filament element: filament type, length, weight
    - layer_ranges: for calculating layer count
    """
    metadata = {}

    try:
        with zip_ref.open('Metadata/slice_info.config') as f:
            tree = ET.parse(f)
            root = tree.getroot()

            # Extract plate metadata (prediction, weight, printer_model_id, nozzle_diameters)
            for meta in root.findall('.//plate/metadata'):
                key = meta.get('key')
                value = meta.get('value')

                if key == 'prediction':
                    # Print time in seconds
                    try:
                        metadata['print_time_seconds'] = int(value)
                    except (ValueError, TypeError):
                        logger.warning(f"Invalid prediction value: {value}")

                elif key == 'weight':
                    # Filament weight in grams
                    try:
                        metadata['filament_weight_grams'] = float(value)
                    except (ValueError, TypeError):
                        logger.warning(f"Invalid weight value: {value}")

                elif key == 'printer_model_id':
                    # Printer model code (N1, N2S, P1P, X1, etc.)
                    metadata['printer_model_id'] = value

                elif key == 'nozzle_diameters':
                    # Nozzle diameter in millimeters
                    try:
                        metadata['nozzle_diameter'] = float(value)
                    except (ValueError, TypeError):
                        logger.warning(f"Invalid nozzle_diameters value: {value}")

            # Extract filament info (type, length, weight for multi-material support)
            filaments = root.findall('.//plate/filament')
            if filaments:
                # For multi-material prints, sum the lengths and weights
                total_length_m = 0.0
                total_weight_g = 0.0
                filament_types = []

                for filament in filaments:
                    # Filament length in meters
                    used_m = filament.get('used_m')
                    if used_m:
                        try:
                            total_length_m += float(used_m)
                        except (ValueError, TypeError):
                            logger.warning(f"Invalid used_m value: {used_m}")

                    # Filament weight in grams
                    used_g = filament.get('used_g')
                    if used_g:
                        try:
                            total_weight_g += float(used_g)
                        except (ValueError, TypeError):
                            logger.warning(f"Invalid used_g value: {used_g}")

                    # Filament type
                    ftype = filament.get('type')
                    if ftype and ftype not in filament_types:
                        filament_types.append(ftype)

                # Store aggregated values
                if total_length_m > 0:
                    metadata['filament_length_meters'] = round(total_length_m, 2)

                # Use weight from filament element if available, otherwise use metadata weight
                if total_weight_g > 0:
                    metadata['filament_weight_grams'] = round(total_weight_g, 2)

                # Store filament types (comma-separated for multi-material)
                if filament_types:
                    metadata['filament_type'] = ', '.join(filament_types)

            # Calculate layer count from layer_ranges
            # Format: "0 41" means layers 0-41 = 42 total layers
            layer_list = root.find('.//plate/layer_filament_lists/layer_filament_list')
            if layer_list is not None:
                layer_ranges = layer_list.get('layer_ranges')
                if layer_ranges:
                    try:
                        parts = layer_ranges.split()
                        if len(parts) >= 2:
                            start = int(parts[0])
                            end = int(parts[1])
                            metadata['layer_count'] = end - start + 1
                    except (ValueError, IndexError) as e:
                        logger.warning(f"Invalid layer_ranges format: {layer_ranges} - {e}")

    except KeyError:
        logger.warning("Metadata/slice_info.config not found in 3MF archive")
    except ET.ParseError as e:
        logger.error(f"Failed to parse slice_info.config XML: {e}")

    return metadata


def _parse_project_settings(zip_ref: zipfile.ZipFile) -> Dict[str, Any]:
    """
    Parse Metadata/project_settings.config file (JSON format).

    This file contains:
    - curr_bed_type: Bed/plate type (e.g., "Textured PEI Plate")
    - default_print_profile: Print profile used (e.g., "0.20mm Standard @BBL A1")
    - printer_model: Actual target printer (e.g., "Bambu Lab P1S")
    """
    metadata = {}

    try:
        with zip_ref.open('Metadata/project_settings.config') as f:
            settings = json.load(f)

            # Extract bed type
            if 'curr_bed_type' in settings:
                metadata['curr_bed_type'] = settings['curr_bed_type']

            # Extract print profile
            if 'default_print_profile' in settings:
                metadata['default_print_profile'] = settings['default_print_profile']

            # Extract printer model name and map to ID
            # This is more accurate than printer_model_id from slice_info when using
            # cross-compatible profiles (e.g., X1C profile on P1S printer)
            if 'printer_model' in settings:
                printer_name = settings['printer_model']
                mapped_id = _map_printer_name_to_id(printer_name)
                if mapped_id:
                    metadata['printer_model_id'] = mapped_id
                    logger.debug(f"Mapped printer_model '{printer_name}' to ID '{mapped_id}'")

    except KeyError:
        logger.warning("Metadata/project_settings.config not found in 3MF archive")
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse project_settings.config JSON: {e}")

    return metadata


def _count_objects_in_3mf(zip_ref: zipfile.ZipFile) -> Optional[int]:
    """
    Count the number of objects in a 3MF print file.

    Tries two methods in order:
    1. G-code model label id (for sliced multi-object files)
    2. slice_info.config object elements (for other files)

    Args:
        zip_ref: Open ZipFile reference to the 3MF file

    Returns:
        Number of objects, or None if count cannot be determined
    """
    try:
        # Method 1: Try G-code header
        try:
            with zip_ref.open('Metadata/plate_1.gcode') as f:
                # Read first 10KB (header section)
                gcode_header = f.read(10000).decode('utf-8', errors='ignore')

                # Look for: ; model label id: 98,99,100,101,...
                match = re.search(r'; model label id:\s*([0-9,\s]+)', gcode_header)
                if match:
                    # Count comma-separated IDs
                    ids = [id.strip() for id in match.group(1).split(',') if id.strip()]
                    logger.info(f"Found {len(ids)} object(s) via G-code")
                    return len(ids)
        except:
            pass  # Try next method

        # Method 2: Try slice_info.config
        try:
            with zip_ref.open('Metadata/slice_info.config') as f:
                tree = ET.parse(f)
                root = tree.getroot()

                # Find all <object> elements, filter out skipped
                objects = root.findall('.//plate/object')
                active = [o for o in objects if o.get('skipped', 'false').lower() != 'true']

                if active:
                    logger.info(f"Found {len(active)} object(s) via slice_info")
                    return len(active)
        except:
            pass  # Both methods failed

        logger.warning("Could not determine object count")
        return None

    except Exception as e:
        logger.error(f"Error counting objects: {e}")
        return None


def format_print_time(seconds: Optional[int]) -> str:
    """
    Format print time in seconds to human-readable string.

    Args:
        seconds: Print time in seconds

    Returns:
        Formatted string like "1h 23m" or "45m" or "Unknown"
    """
    if seconds is None:
        return "Unknown"

    hours = seconds // 3600
    minutes = (seconds % 3600) // 60

    if hours > 0:
        return f"{hours}h {minutes}m"
    else:
        return f"{minutes}m"


def format_filament_info(
    weight_g: Optional[float],
    length_m: Optional[float],
    ftype: Optional[str]
) -> str:
    """
    Format filament info to human-readable string.

    Args:
        weight_g: Filament weight in grams
        length_m: Filament length in meters
        ftype: Filament type

    Returns:
        Formatted string like "3.32g (1.09m) PETG" or "Unknown"
    """
    parts = []

    if weight_g is not None:
        parts.append(f"{weight_g:.2f}g")

    if length_m is not None:
        parts.append(f"({length_m:.2f}m)")

    if ftype:
        parts.append(ftype)

    if parts:
        return " ".join(parts)
    else:
        return "Unknown"


# Example usage
if __name__ == "__main__":
    # Configure logging for testing
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )

    # Test with a sample file
    import sys
    if len(sys.argv) > 1:
        test_file = sys.argv[1]
        print(f"\nParsing: {test_file}")
        print("=" * 80)

        metadata = parse_3mf_metadata(test_file)

        print(f"Print Time: {format_print_time(metadata['print_time_seconds'])}")
        print(f"Filament: {format_filament_info(metadata['filament_weight_grams'], metadata['filament_length_meters'], metadata['filament_type'])}")
        print(f"Printer: {metadata['printer_model_id']}")
        print(f"Nozzle: {metadata['nozzle_diameter']}mm")
        print(f"Layers: {metadata['layer_count']}")
        print(f"Bed Type: {metadata['curr_bed_type']}")
        print(f"Profile: {metadata['default_print_profile']}")
        print(f"Objects: {metadata['object_count'] if metadata['object_count'] else 'Unknown'}")
    else:
        print("Usage: python metadata_parser.py <path_to_3mf_file>")
