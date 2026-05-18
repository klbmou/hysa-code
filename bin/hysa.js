#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distPath = path.join(rootDir, 'dist', 'index.js');

async function loadDist() {
  const { start } = await import(pathToFileURL(distPath).href);
  await start();
}

if (fs.existsSync(distPath)) {
  loadDist().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} else {
  console.error('HYSA Code: dist/index.js not found. Attempting to build...');
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    console.error('');
    console.error('HYSA Code is missing dist files.');
    console.error('Clone the repo and run: npm install && npm run build && npm run build:web');
    console.error('Or install from the npm package instead of GitHub.');
    process.exit(1);
  }
  const webResult = spawnSync('npm', ['run', 'build:web'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  });
  if (webResult.status !== 0) {
    console.error('');
    console.error('HYSA Code: Web UI build failed, but CLI may still work.');
  }
  loadDist().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
