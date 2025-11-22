/**
 * Metadata Parser Service
 *
 * Provides functionality to extract metadata from 3MF print files by calling the backend API.
 * Used during product file upload to automatically detect printer model from file metadata.
 */

export interface FileMetadata {
  print_time_seconds: number | null;
  filament_weight_grams: number | null;
  filament_length_meters: number | null;
  filament_type: string | null;
  printer_model_id: string | null;
  nozzle_diameter: number | null;
  layer_count: number | null;
  curr_bed_type: string | null;
  default_print_profile: string | null;
}

export interface ParseMetadataResponse {
  success: boolean;
  filename: string;
  printer_model_id: string;
  metadata: FileMetadata;
}

export interface ParseMetadataError {
  success: false;
  error: string;
  detail?: string;
}

/**
 * Parse metadata from a 3MF file without storing it permanently.
 *
 * This function uploads the file to the backend parse-metadata endpoint,
 * which temporarily saves it, extracts the metadata (especially printer_model_id),
 * and then deletes the temporary file.
 *
 * @param file - The 3MF file to parse
 * @returns Promise with parsed metadata including printer_model_id
 * @throws Error if the file is not a 3MF file or parsing fails
 */
export async function parseFileMetadata(file: File): Promise<ParseMetadataResponse> {
  // Validate file type client-side first
  const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
  if (fileExtension !== '.3mf') {
    throw new Error('Only 3MF files can be parsed for metadata. Other file types (STL, GCODE, etc.) must be manually assigned to a printer model.');
  }

  // Create FormData to send the file
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/file-operations/parse-metadata', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      // Try to extract error details from response
      let errorMessage = 'Failed to parse file metadata';
      try {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorMessage;
      } catch {
        // If JSON parsing fails, use default message
        errorMessage = await response.text() || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (!data.success || !data.printer_model_id) {
      throw new Error('Could not extract printer model from file. The file may not contain valid printer metadata.');
    }

    return data;
  } catch (error) {
    console.error('Metadata parsing error:', error);
    throw error instanceof Error ? error : new Error('Unknown error parsing file metadata');
  }
}

/**
 * Helper function to get a human-readable printer model name from the code.
 * Maps Bambu printer codes to display names.
 *
 * @param modelCode - Bambu printer model code (N1, N2S, P1P, X1C, etc.)
 * @returns Human-readable printer model name
 */
export function getPrinterModelLabel(modelCode: string | null): string {
  const modelMap: Record<string, string> = {
    'N1': 'A1 Mini',
    'N2S': 'A1',
    'P1P': 'P1P',
    'P1S': 'P1S',
    'X1': 'X1',
    'X1C': 'X1 Carbon',
    'X1E': 'X1 Enterprise',
  };

  if (modelCode === null) {
    return 'Default / All Models';
  }

  return modelMap[modelCode] || modelCode;
}
