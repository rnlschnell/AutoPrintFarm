/**
 * Test script for 3MF parsing functionality
 * This directly tests the metadata extraction without needing the queue.
 *
 * Run with: node test-3mf-parse.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { unzipSync } from 'fflate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test 3MF file path
const TEST_FILE_PATH = path.join(__dirname, '..', 'files', 'print_files', '3fab2973-5689-4ef9-9633-ab235b9be4ba.3mf');

/**
 * Simplified 3MF parser (same logic as src/lib/threemf.ts)
 */
function parse3MF(data) {
  const metadata = {
    printTimeSeconds: null,
    filamentWeightGrams: null,
    filamentLengthMeters: null,
    filamentType: null,
    printerModelId: null,
    nozzleDiameter: null,
    layerCount: null,
    currBedType: null,
    defaultPrintProfile: null,
    objectCount: 0,
  };

  let thumbnail = null;

  try {
    // Unzip the 3MF file
    const uint8Data = new Uint8Array(data);
    const files = unzipSync(uint8Data);

    console.log('Files in 3MF archive:');
    for (const [name, content] of Object.entries(files)) {
      console.log(`  - ${name} (${content.length} bytes)`);
    }

    // Look for Bambu-specific metadata files
    const projectConfigPath = 'Metadata/project_settings.config';
    const sliceInfoPath = 'Metadata/slice_info.config';
    const modelSettingsPath = 'Metadata/model_settings.config';

    // Try to find thumbnail
    const thumbnailPaths = [
      'Metadata/plate_1.png',
      'Metadata/thumbnail.png',
      'thumbnail.png',
      '3D/Thumbnail/thumbnail.png',
    ];

    for (const thumbPath of thumbnailPaths) {
      if (files[thumbPath]) {
        thumbnail = {
          data: files[thumbPath],
          contentType: 'image/png',
        };
        console.log(`\nFound thumbnail at: ${thumbPath} (${files[thumbPath].length} bytes)`);
        break;
      }
    }

    // Parse slice_info.config for timing and filament info
    if (files[sliceInfoPath]) {
      const sliceInfo = new TextDecoder().decode(files[sliceInfoPath]);
      console.log('\nSlice info config found');

      // Extract print time
      const timeMatch = sliceInfo.match(/prediction\s*=\s*(\d+)/);
      if (timeMatch) {
        metadata.printTimeSeconds = parseInt(timeMatch[1], 10);
      }

      // Extract filament weight
      const weightMatch = sliceInfo.match(/weight\s*=\s*([\d.]+)/);
      if (weightMatch) {
        metadata.filamentWeightGrams = parseFloat(weightMatch[1]);
      }

      // Extract filament length
      const lengthMatch = sliceInfo.match(/filament_used_m\s*=\s*([\d.]+)/);
      if (lengthMatch) {
        metadata.filamentLengthMeters = parseFloat(lengthMatch[1]);
      }

      // Extract filament type
      const typeMatch = sliceInfo.match(/filament_type\s*=\s*([^\s\n]+)/);
      if (typeMatch) {
        metadata.filamentType = typeMatch[1];
      }

      // Extract layer count
      const layerMatch = sliceInfo.match(/layer_num\s*=\s*(\d+)/);
      if (layerMatch) {
        metadata.layerCount = parseInt(layerMatch[1], 10);
      }
    }

    // Parse project_settings.config for printer and profile info
    if (files[projectConfigPath]) {
      const projectConfig = new TextDecoder().decode(files[projectConfigPath]);
      console.log('Project settings config found');

      // Extract printer model
      const printerMatch = projectConfig.match(/printer_model\s*=\s*([^\s\n]+)/);
      if (printerMatch) {
        metadata.printerModelId = printerMatch[1];
      }

      // Extract nozzle diameter
      const nozzleMatch = projectConfig.match(/nozzle_diameter\s*=\s*([\d.]+)/);
      if (nozzleMatch) {
        metadata.nozzleDiameter = parseFloat(nozzleMatch[1]);
      }

      // Extract bed type
      const bedMatch = projectConfig.match(/curr_bed_type\s*=\s*([^\s\n]+)/);
      if (bedMatch) {
        metadata.currBedType = bedMatch[1];
      }

      // Extract print profile
      const profileMatch = projectConfig.match(/print_settings_id\s*=\s*([^\n]+)/);
      if (profileMatch) {
        metadata.defaultPrintProfile = profileMatch[1].trim();
      }
    }

    // Parse model_settings.config for object count
    if (files[modelSettingsPath]) {
      const modelSettings = new TextDecoder().decode(files[modelSettingsPath]);
      console.log('Model settings config found');

      // Count object entries
      const objectMatches = modelSettings.match(/<object/g);
      if (objectMatches) {
        metadata.objectCount = objectMatches.length;
      }
    }

    // Also check 3D/3dmodel.model for objects
    const modelPath = '3D/3dmodel.model';
    if (files[modelPath]) {
      const modelContent = new TextDecoder().decode(files[modelPath]);
      const objectMatches = modelContent.match(/<object\s+id=/g);
      if (objectMatches && objectMatches.length > metadata.objectCount) {
        metadata.objectCount = objectMatches.length;
      }
    }

  } catch (error) {
    console.error('Error parsing 3MF:', error);
  }

  return { metadata, thumbnail };
}

// Run the test
console.log('='.repeat(70));
console.log('3MF PARSING TEST');
console.log('='.repeat(70));

if (!fs.existsSync(TEST_FILE_PATH)) {
  console.error(`Test file not found: ${TEST_FILE_PATH}`);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(TEST_FILE_PATH);
console.log(`\nLoaded file: ${TEST_FILE_PATH}`);
console.log(`File size: ${fileBuffer.length} bytes\n`);

const result = parse3MF(fileBuffer);

console.log('\n' + '='.repeat(70));
console.log('EXTRACTED METADATA');
console.log('='.repeat(70));

const meta = result.metadata;
console.log(`Print Time: ${meta.printTimeSeconds ? `${meta.printTimeSeconds} seconds (${(meta.printTimeSeconds / 60).toFixed(1)} minutes)` : 'N/A'}`);
console.log(`Filament Weight: ${meta.filamentWeightGrams ? `${meta.filamentWeightGrams} grams` : 'N/A'}`);
console.log(`Filament Length: ${meta.filamentLengthMeters ? `${meta.filamentLengthMeters} meters` : 'N/A'}`);
console.log(`Filament Type: ${meta.filamentType || 'N/A'}`);
console.log(`Printer Model: ${meta.printerModelId || 'N/A'}`);
console.log(`Nozzle Diameter: ${meta.nozzleDiameter ? `${meta.nozzleDiameter} mm` : 'N/A'}`);
console.log(`Layer Count: ${meta.layerCount || 'N/A'}`);
console.log(`Bed Type: ${meta.currBedType || 'N/A'}`);
console.log(`Print Profile: ${meta.defaultPrintProfile || 'N/A'}`);
console.log(`Object Count: ${meta.objectCount}`);
console.log(`Thumbnail: ${result.thumbnail ? 'Yes' : 'No'}`);

console.log('\n' + '='.repeat(70));
console.log('VERIFICATION RESULT');
console.log('='.repeat(70));

// Check if metadata was extracted
const hasMetadata = meta.printTimeSeconds || meta.filamentWeightGrams || meta.filamentType;
const hasThumbnail = result.thumbnail !== null;

if (hasMetadata) {
  console.log('✓ Metadata extraction: WORKING');
} else {
  console.log('✗ Metadata extraction: No metadata found in this file');
}

if (hasThumbnail) {
  console.log('✓ Thumbnail extraction: WORKING');
  // Save thumbnail to verify
  const thumbPath = path.join(__dirname, 'test-thumbnail.png');
  fs.writeFileSync(thumbPath, Buffer.from(result.thumbnail.data));
  console.log(`  Thumbnail saved to: ${thumbPath}`);
} else {
  console.log('✗ Thumbnail extraction: No thumbnail found in this file');
}

console.log('='.repeat(70));
