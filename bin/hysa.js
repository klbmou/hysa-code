#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist', 'index.js');

if (!fs.existsSync(distPath)) {
  console.error('');
  console.error('HYSA Code was installed without built files.');
  console.error('Please install from the main branch after dist is committed,');
  console.error('or clone the repo and run: npm install && npm run build');
  console.error('');
  process.exit(1);
}

await import(pathToFileURL(distPath).href);
