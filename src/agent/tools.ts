import { readFileSync, statSync } from 'node:fs';
import { readFile } from '../files/reader.js';
import { grepSearch } from '../utils/searcher.js';
import { resolve } from 'node:path';

const SYMBOL_PATTERNS = [
  /export\s+(function|const|class|interface|type|enum|async\s+function|default\s+(function|class))\s+(\w+)/g,
  /^(function|const|class|interface|type|enum|async\s+function)\s+(\w+)/gm,
  /(\w+)\s*=\s*(function|\([^)]*\)\s*=>)/g,
];

export interface SymbolInfo {
  name: string;
  type: string;
  line: number;
}

export function listSymbols(filePath: string): SymbolInfo[] {
  const content = readFile(filePath);
  if (!content) return [];

  const symbols: SymbolInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of SYMBOL_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        const groups = match.slice(1).filter(Boolean);
        const name = groups[groups.length - 1];
        const type = groups.slice(0, -1).join(' ');
        if (name && !symbols.some(s => s.name === name)) {
          symbols.push({ name, type, line: i + 1 });
        }
      }
    }
  }

  return symbols;
}

export function findReferences(rootDir: string, symbol: string): { file: string; line: number; content: string }[] {
  const pattern = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return grepSearch(rootDir, pattern, 30).filter(r => {
    // Filter out the definition itself (we want references)
    const line = r.content.trim();
    return !line.startsWith('export') && !line.startsWith('function') && !line.startsWith('const') && !line.startsWith('class');
  });
}

export function searchImports(rootDir: string, moduleName: string): { file: string; line: number; content: string }[] {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = `(import\\s+.*['"]${escaped}['"]|require\\(['"]${escaped}['"]\\))`;
  return grepSearch(rootDir, pattern, 30);
}

export function summarizeFile(filePath: string): string {
  const content = readFile(filePath);
  if (!content) return 'File not found or empty.';

  const lines = content.split('\n');
  const symbols = listSymbols(filePath);

  const parts: string[] = [];
  parts.push(`File: ${filePath}`);
  parts.push(`Lines: ${lines.length}`);

  const importLines = lines.filter(l => l.trim().startsWith('import ') || l.trim().startsWith('const ') || l.trim().startsWith('function '));
  if (importLines.length > 0) {
    const firstImports = importLines.slice(0, 10);
    parts.push(`\nKey declarations (${importLines.length} total):`);
    for (const line of firstImports) {
      parts.push(`  ${line.trim().slice(0, 100)}`);
    }
    if (importLines.length > 10) {
      parts.push(`  ... and ${importLines.length - 10} more`);
    }
  }

  if (symbols.length > 0) {
    parts.push(`\nExported symbols:`);
    for (const sym of symbols.slice(0, 15)) {
      parts.push(`  ${sym.type} ${sym.name} (line ${sym.line})`);
    }
    if (symbols.length > 15) {
      parts.push(`  ... and ${symbols.length - 15} more`);
    }
  }

  return parts.join('\n');
}

export function explainFunction(filePath: string, functionName: string): string {
  const content = readFile(filePath);
  if (!content) return 'File not found.';

  const lines = content.split('\n');
  const funcPattern = new RegExp(`(export\\s+)?(async\\s+)?function\\s+${functionName}\\s*\\(`, 'i');
  const arrowPattern = new RegExp(`(export\\s+)?(const\\s+)?${functionName}\\s*[:=]\\s*(\\([^)]*\\)\\s*=>|async\\s*\\(`, 'i');

  let startLine = -1;
  let braceCount = 0;
  let started = false;
  let result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (startLine === -1) {
      if (funcPattern.test(line) || arrowPattern.test(line)) {
        startLine = i;
        started = true;
        braceCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        result.push(line);
      }
      continue;
    }

    result.push(line);
    braceCount += (line.match(/{/g) || []).length;
    braceCount -= (line.match(/}/g) || []).length;

    if (braceCount <= 0 && started) {
      break;
    }
  }

  if (startLine === -1) {
    return `Function "${functionName}" not found in ${filePath}.`;
  }

  return `Function "${functionName}" in ${filePath} (lines ${startLine + 1}-${startLine + result.length}):\n\`\`\`\n${result.join('\n')}\n\`\`\``;
}
