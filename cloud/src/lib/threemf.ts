/**
 * 3MF File Parser - Metadata Extraction
 *
 * This module provides utilities for extracting metadata from 3MF files,
 * which are ZIP archives containing 3D model data and print settings.
 *
 * 3MF files from Bambu Lab (and other slicers) contain:
 * - 3D model geometry (3D/3dmodel.model)
 * - Print settings (Metadata/model_settings.config)
 * - Slice info (Metadata/slice_info.config)
 * - Thumbnails (Metadata/plate_*.png)
 *
 * Phase 6: Print Files & R2 Storage
 */

import * as fflate from "fflate";

// =============================================================================
// TYPES
// =============================================================================

export interface ThreeMFMetadata {
  // Print metrics
  printTimeSeconds: number | null;
  filamentWeightGrams: number | null;
  filamentLengthMeters: number | null;
  layerCount: number | null;

  // Print settings
  filamentType: string | null;
  printerModelId: string | null;
  nozzleDiameter: number | null;
  currBedType: string | null;
  defaultPrintProfile: string | null;

  // Object info
  objectCount: number;

  // Raw data for debugging
  _raw?: {
    sliceInfo?: Record<string, unknown>;
    modelSettings?: Record<string, unknown>;
  };
}

export interface ThreeMFThumbnail {
  data: Uint8Array;
  filename: string;
  contentType: string;
}

export interface ThreeMFParseResult {
  metadata: ThreeMFMetadata;
  thumbnail: ThreeMFThumbnail | null;
}

// =============================================================================
// MAIN PARSER
// =============================================================================

/**
 * Parse a 3MF file and extract metadata and thumbnail
 *
 * @param fileData - The raw 3MF file data as ArrayBuffer
 * @returns Parsed metadata and thumbnail
 */
export async function parse3MF(fileData: ArrayBuffer): Promise<ThreeMFParseResult> {
  // Convert to Uint8Array for fflate
  const data = new Uint8Array(fileData);

  // Unzip the 3MF file
  const unzipped = await new Promise<fflate.Unzipped>((resolve, reject) => {
    fflate.unzip(data, (err, result) => {
      if (err) reject(new Error(`Failed to unzip 3MF file: ${err.message}`));
      else resolve(result);
    });
  });

  // Initialize metadata with defaults
  const metadata: ThreeMFMetadata = {
    printTimeSeconds: null,
    filamentWeightGrams: null,
    filamentLengthMeters: null,
    layerCount: null,
    filamentType: null,
    printerModelId: null,
    nozzleDiameter: null,
    currBedType: null,
    defaultPrintProfile: null,
    objectCount: 1,
  };

  // Look for slice_info.config (Bambu Lab specific)
  const sliceInfoPath = findFile(unzipped, "slice_info.config");
  if (sliceInfoPath && unzipped[sliceInfoPath]) {
    const sliceInfo = parseXMLConfig(unzipped[sliceInfoPath]!);
    extractSliceInfo(sliceInfo, metadata);
  }

  // Look for model_settings.config (Bambu Lab specific)
  const modelSettingsPath = findFile(unzipped, "model_settings.config");
  if (modelSettingsPath && unzipped[modelSettingsPath]) {
    const modelSettings = parseXMLConfig(unzipped[modelSettingsPath]!);
    extractModelSettings(modelSettings, metadata);
  }

  // Look for project config (OrcaSlicer/BambuStudio)
  // Note: project_settings.config is JSON format, not XML!
  const projectConfigPath = findFile(unzipped, "Metadata/project_settings.config");
  if (projectConfigPath && unzipped[projectConfigPath]) {
    const projectConfig = parseProjectSettingsJSON(unzipped[projectConfigPath]!);
    if (projectConfig) {
      extractProjectConfig(projectConfig, metadata);
    }
  }

  // Count objects from the 3D model file
  const modelPath = findFile(unzipped, "3D/3dmodel.model");
  if (modelPath && unzipped[modelPath]) {
    const objectCount = countObjectsInModel(unzipped[modelPath]!);
    if (objectCount > 0) {
      metadata.objectCount = objectCount;
    }
  }

  // Extract thumbnail
  const thumbnail = extractThumbnail(unzipped);

  return { metadata, thumbnail };
}

// =============================================================================
// PRINTER NAME MAPPING
// =============================================================================

/**
 * Map full printer name to short printer model ID
 * Handles cases where project_settings.config contains full names like "Bambu Lab A1 mini"
 */
const PRINTER_NAME_TO_ID: Record<string, string> = {
  'Bambu Lab X1-Carbon': 'X1C',
  'Bambu Lab X1 Carbon': 'X1C',
  'Bambu Lab X1': 'X1',
  'Bambu Lab X1E': 'X1E',
  'Bambu Lab P1P': 'P1P',
  'Bambu Lab P1S': 'P1S',
  'Bambu Lab A1 mini': 'N1',
  'Bambu Lab A1 Mini': 'N1',
  'Bambu Lab A1': 'N2S',
};

/**
 * Map a printer name to its short ID
 */
function mapPrinterNameToId(printerName: string | null | undefined): string | null {
  if (!printerName) return null;

  // First check direct mapping
  const mapped = PRINTER_NAME_TO_ID[printerName];
  if (mapped) return mapped;

  // If it's already a short ID, return it
  const shortIds = ['X1C', 'X1', 'X1E', 'P1P', 'P1S', 'N1', 'N2S'];
  if (shortIds.includes(printerName.toUpperCase())) {
    return printerName.toUpperCase();
  }

  // Try partial match
  const lowerName = printerName.toLowerCase();
  if (lowerName.includes('x1-carbon') || lowerName.includes('x1 carbon')) return 'X1C';
  if (lowerName.includes('x1e')) return 'X1E';
  if (lowerName.includes('x1')) return 'X1';
  if (lowerName.includes('p1p')) return 'P1P';
  if (lowerName.includes('p1s')) return 'P1S';
  if (lowerName.includes('a1 mini') || lowerName.includes('a1mini')) return 'N1';
  if (lowerName.includes('a1')) return 'N2S';

  return null;
}

/**
 * Parse project_settings.config as JSON (not XML!)
 */
function parseProjectSettingsJSON(data: Uint8Array): Record<string, string> | null {
  try {
    const text = new TextDecoder().decode(data);
    const trimmed = text.trim();

    // Check if it's JSON (starts with {)
    if (!trimmed.startsWith('{')) {
      // Fallback to XML parser if it's not JSON
      return parseXMLConfig(data);
    }

    const json = JSON.parse(trimmed);
    const result: Record<string, string> = {};

    // Extract relevant fields from JSON
    if (json.printer_model) result.printer_model = json.printer_model;
    if (json.curr_bed_type) result.curr_bed_type = json.curr_bed_type;
    if (json.default_print_profile) result.default_print_profile = json.default_print_profile;
    if (json.printer_settings_id) result.printer_settings_id = json.printer_settings_id;
    if (json.filament_settings_id) result.filament_settings_id = json.filament_settings_id;
    if (json.print_settings_id) result.print_settings_id = json.print_settings_id;
    if (json.nozzle_diameter) result.nozzle_diameter = String(json.nozzle_diameter);

    return result;
  } catch (e) {
    console.warn('Failed to parse project_settings.config as JSON:', e);
    return null;
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Find a file in the unzipped archive (case-insensitive)
 * Returns the path if found, null otherwise
 */
function findFile(unzipped: fflate.Unzipped, searchName: string): string | undefined {
  const lowerSearch = searchName.toLowerCase();

  for (const path of Object.keys(unzipped)) {
    if (path.toLowerCase().endsWith(lowerSearch)) {
      return path;
    }
  }

  // Also try with Metadata/ prefix
  for (const path of Object.keys(unzipped)) {
    if (path.toLowerCase().includes(lowerSearch)) {
      return path;
    }
  }

  return undefined;
}

/**
 * Parse an XML config file and extract key-value pairs
 * This is a simple XML parser for the flat key-value format used by Bambu Lab
 */
function parseXMLConfig(data: Uint8Array): Record<string, string> {
  const text = new TextDecoder().decode(data);
  const result: Record<string, string> = {};

  // Pattern 1: <metadata key="name" value="something"/>
  // Note: key and value can appear in any order
  const metadataPattern1 = /<metadata[^>]*\skey\s*=\s*["']([^"']+)["'][^>]*\svalue\s*=\s*["']([^"']*)["'][^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = metadataPattern1.exec(text)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      result[key] = value;
    }
  }

  // Pattern 2: <metadata value="something" key="name"/> (reversed order)
  const metadataPattern2 = /<metadata[^>]*\svalue\s*=\s*["']([^"']*)["'][^>]*\skey\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;
  while ((match = metadataPattern2.exec(text)) !== null) {
    const value = match[1];
    const key = match[2];
    if (key !== undefined && value !== undefined && !result[key]) {
      result[key] = value;
    }
  }

  // Pattern 3: <filament ... type="PETG" used_m="1.09" used_g="3.32" ... />
  const filamentPattern = /<filament[^>]*\stype\s*=\s*["']([^"']+)["'][^>]*\sused_m\s*=\s*["']([^"']*)["'][^>]*\sused_g\s*=\s*["']([^"']*)["'][^>]*\/?>/gi;
  while ((match = filamentPattern.exec(text)) !== null) {
    if (match[1] && !result.filament_type) result.filament_type = match[1];
    if (match[2] && !result.used_m) result.used_m = match[2];
    if (match[3] && !result.used_g) result.used_g = match[3];
  }

  // Pattern 4: Simple element content <print_time>123</print_time>
  const simplePattern = /<(\w+)>([^<]*)<\/\1>/gi;
  while ((match = simplePattern.exec(text)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined && !result[key]) {
      result[key] = value;
    }
  }

  // Pattern 5: Direct attributes on plate element
  // <plate prediction="123" weight="456" />
  const attrPattern = /\b(prediction|weight|filament_used|layer_count|nozzle_diameter|nozzle_diameters|filament_type|printer_model|printer_model_id|bed_type|print_profile|total_weight|used_m|used_g)\s*=\s*["']([^"']*)["']/gi;
  while ((match = attrPattern.exec(text)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined && !result[key]) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Extract metadata from slice_info.config
 */
function extractSliceInfo(config: Record<string, string>, metadata: ThreeMFMetadata): void {
  // Print time (in seconds)
  const printTime = config.prediction || config.print_time || config.estimated_time;
  if (printTime) {
    const seconds = parseFloat(printTime);
    if (!isNaN(seconds)) {
      metadata.printTimeSeconds = Math.round(seconds);
    }
  }

  // Filament weight (in grams) - from <filament used_g="..."/> or <metadata key="weight" value="..."/>
  const weight = config.weight || config.used_g || config.total_weight || config.filament_weight;
  if (weight) {
    const grams = parseFloat(weight);
    if (!isNaN(grams)) {
      metadata.filamentWeightGrams = grams;
    }
  }

  // Filament length (in meters) - from <filament used_m="..."/> or filament_used
  const length = config.used_m || config.filament_used || config.filament_length;
  if (length) {
    // Could be in mm or m, Bambu uses meters
    let meters = parseFloat(length);
    if (!isNaN(meters)) {
      if (meters > 100) {
        meters = meters / 1000; // Convert mm to m
      }
      metadata.filamentLengthMeters = meters;
    }
  }

  // Layer count
  const layers = config.layer_count || config.total_layers;
  if (layers) {
    const count = parseInt(layers, 10);
    if (!isNaN(count)) {
      metadata.layerCount = count;
    }
  }

  // Filament type - from <filament type="..."/>
  if (config.filament_type && !metadata.filamentType) {
    metadata.filamentType = config.filament_type;
  }

  // Printer model - from <metadata key="printer_model_id" value="..."/>
  if (config.printer_model_id && !metadata.printerModelId) {
    metadata.printerModelId = config.printer_model_id;
  }

  // Nozzle diameter - from <metadata key="nozzle_diameters" value="..."/>
  const nozzle = config.nozzle_diameters || config.nozzle_diameter;
  if (nozzle && !metadata.nozzleDiameter) {
    const diameter = parseFloat(nozzle);
    if (!isNaN(diameter)) {
      metadata.nozzleDiameter = diameter;
    }
  }
}

/**
 * Extract metadata from model_settings.config
 */
function extractModelSettings(config: Record<string, string>, metadata: ThreeMFMetadata): void {
  // Printer model
  const printerModel = config.printer_model || config.machine_type || config.printer;
  if (printerModel) {
    metadata.printerModelId = printerModel;
  }

  // Filament type
  const filamentType = config.filament_type || config.material || config.filament;
  if (filamentType) {
    metadata.filamentType = filamentType;
  }

  // Nozzle diameter
  const nozzle = config.nozzle_diameter || config.nozzle_size;
  if (nozzle) {
    const diameter = parseFloat(nozzle);
    if (!isNaN(diameter)) {
      metadata.nozzleDiameter = diameter;
    }
  }

  // Bed type
  const bedType = config.bed_type || config.curr_bed_type || config.build_plate;
  if (bedType) {
    metadata.currBedType = bedType;
  }

  // Print profile
  const profile = config.print_profile || config.profile_name || config.process;
  if (profile) {
    metadata.defaultPrintProfile = profile;
  }
}

/**
 * Extract metadata from project_settings.config (OrcaSlicer/BambuStudio)
 * This file is JSON format and contains the actual target printer model
 */
function extractProjectConfig(config: Record<string, string>, metadata: ThreeMFMetadata): void {
  // This file may contain additional settings not in the other configs
  // printer_model from project_settings.config is the most accurate source

  // Map printer_model (e.g., "Bambu Lab A1 mini") to short ID (e.g., "N1")
  // This overrides any printer_model_id from slice_info.config
  if (config.printer_model) {
    const mappedId = mapPrinterNameToId(config.printer_model);
    if (mappedId) {
      metadata.printerModelId = mappedId;
    }
  }

  // Fallback to printer_settings_id if printer_model not found
  if (!metadata.printerModelId && config.printer_settings_id) {
    const mappedId = mapPrinterNameToId(config.printer_settings_id);
    metadata.printerModelId = mappedId || config.printer_settings_id;
  }

  if (!metadata.filamentType && config.filament_settings_id) {
    metadata.filamentType = config.filament_settings_id;
  }

  if (!metadata.defaultPrintProfile && config.print_settings_id) {
    metadata.defaultPrintProfile = config.print_settings_id;
  }

  // Extract bed type from project settings (more reliable than model_settings)
  if (config.curr_bed_type) {
    metadata.currBedType = config.curr_bed_type;
  }

  // Extract print profile from project settings
  if (config.default_print_profile) {
    metadata.defaultPrintProfile = config.default_print_profile;
  }

  if (!metadata.nozzleDiameter && config.nozzle_diameter) {
    const diameter = parseFloat(config.nozzle_diameter);
    if (!isNaN(diameter)) {
      metadata.nozzleDiameter = diameter;
    }
  }
}

/**
 * Count the number of objects in the 3D model file
 */
function countObjectsInModel(data: Uint8Array): number {
  const text = new TextDecoder().decode(data);

  // Count <object> elements
  const objectMatches = text.match(/<object\s/gi);

  // Also try counting <mesh> elements as fallback
  const meshMatches = text.match(/<mesh\s*>/gi);

  const objectCount = objectMatches?.length || 0;
  const meshCount = meshMatches?.length || 0;

  return Math.max(objectCount, meshCount, 1);
}

/**
 * Extract thumbnail from the 3MF file
 */
function extractThumbnail(unzipped: fflate.Unzipped): ThreeMFThumbnail | null {
  // Common thumbnail locations in Bambu Lab 3MF files
  const thumbnailPaths = [
    "Metadata/plate_1.png",
    "Metadata/thumbnail.png",
    "Metadata/plate_1_thumbnail.png",
    "thumbnail/plate_1.png",
    "Metadata/model_pic.png",
    ".thumbnail/thumbnail.png",
    "Metadata/Thumbnail.png",
  ];

  // Try each known path
  for (const path of thumbnailPaths) {
    const data = unzipped[path];
    if (data) {
      return {
        data,
        filename: path.split("/").pop() || "thumbnail.png",
        contentType: "image/png",
      };
    }
  }

  // Search for any PNG in Metadata folder
  for (const path of Object.keys(unzipped)) {
    if (
      (path.toLowerCase().includes("metadata/") ||
        path.toLowerCase().includes("thumbnail")) &&
      path.toLowerCase().endsWith(".png")
    ) {
      const data = unzipped[path];
      if (data) {
        return {
          data,
          filename: path.split("/").pop() || "thumbnail.png",
          contentType: "image/png",
        };
      }
    }
  }

  // Search for any image file
  for (const path of Object.keys(unzipped)) {
    const lowerPath = path.toLowerCase();
    if (
      lowerPath.endsWith(".png") ||
      lowerPath.endsWith(".jpg") ||
      lowerPath.endsWith(".jpeg")
    ) {
      const data = unzipped[path];
      if (data) {
        const contentType = lowerPath.endsWith(".png") ? "image/png" : "image/jpeg";
        return {
          data,
          filename: path.split("/").pop() || "thumbnail.png",
          contentType,
        };
      }
    }
  }

  return null;
}

/**
 * Extract just the metadata from a 3MF file (without thumbnail)
 */
export async function extract3MFMetadata(
  fileData: ArrayBuffer
): Promise<ThreeMFMetadata> {
  const result = await parse3MF(fileData);
  return result.metadata;
}

/**
 * Extract just the thumbnail from a 3MF file
 */
export async function extract3MFThumbnail(
  fileData: ArrayBuffer
): Promise<ThreeMFThumbnail | null> {
  const result = await parse3MF(fileData);
  return result.thumbnail;
}

/**
 * Validate that a file is a valid 3MF file
 */
export function validate3MF(fileData: ArrayBuffer): boolean {
  try {
    const data = new Uint8Array(fileData);

    // Check ZIP magic number
    if (data[0] !== 0x50 || data[1] !== 0x4b) {
      return false;
    }

    // Try to parse to verify structure
    // For now, just check if it starts with PK (ZIP signature)
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.substring(lastDot + 1).toLowerCase();
}

/**
 * Check if a file is a supported print file format
 */
export function isSupportedPrintFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ["3mf", "gcode", "stl"].includes(ext);
}
