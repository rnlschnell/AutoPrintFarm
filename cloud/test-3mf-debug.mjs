/**
 * Debug script to see the actual content of 3MF config files
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { unzipSync } from 'fflate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_FILE_PATH = path.join(__dirname, '..', 'files', 'print_files', '3fab2973-5689-4ef9-9633-ab235b9be4ba.3mf');

const fileBuffer = fs.readFileSync(TEST_FILE_PATH);
const uint8Data = new Uint8Array(fileBuffer);
const files = unzipSync(uint8Data);

// Output slice_info.config
console.log('='.repeat(70));
console.log('slice_info.config:');
console.log('='.repeat(70));
const sliceInfo = new TextDecoder().decode(files['Metadata/slice_info.config']);
console.log(sliceInfo);

console.log('\n' + '='.repeat(70));
console.log('First 2000 chars of project_settings.config:');
console.log('='.repeat(70));
const projectConfig = new TextDecoder().decode(files['Metadata/project_settings.config']);
console.log(projectConfig.substring(0, 2000));

console.log('\n' + '='.repeat(70));
console.log('model_settings.config:');
console.log('='.repeat(70));
const modelSettings = new TextDecoder().decode(files['Metadata/model_settings.config']);
console.log(modelSettings);
