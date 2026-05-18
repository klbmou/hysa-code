#!/usr/bin/env node

import { start } from './cli.js';

start().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
