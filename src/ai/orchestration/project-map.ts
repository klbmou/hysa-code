import { join, dirname, basename, relative } from 'node:path';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { readProjectMap, writeProjectMap, getBrainDir } from '../../brain/store.js';
import type { ProjectMap } from '../../brain/types.js';

const ENTRYPOINT_PATTERNS = [
  /^(?:src\/)?(?:index|main|app|server|cli)\.(ts|js|mjs|cjs|tsx|jsx)$/,
  /^src\/desktop\/main\.(ts|js)$/,
  /^src\/web\/server\.(ts|js)$/,
  /^src\/cli\.(ts|js)$/,
  /^api\/(?:index|route)\.(ts|js)$/,
];

const CORE_SERVICE_PATTERNS = [
  /^src\/web\/api\.(ts|js)$/,
  /^src\/web\/agent-api\.(ts|js)$/,
  /^src\/ai\/client\.(ts|js)$/,
  /^src\/ai\/orchestration\//,
  /^src\/agent\//,
  /^src\/brain\//,
  /^src\/context\//,
  /^src\/config\//,
  /^src\/tools\//,
  /^src\/files\//,
];

const API_PATTERNS = [
  /^src\/web\//,
  /^src\/api\//,
  /^api\/.*\.(ts|js)$/,
];

const DB_PATTERNS = [
  /(?:prisma|sequelize|typeorm|drizzle|knex)\//,
  /schema\.(ts|js|prisma)$/,
  /migrations?\//,
  /database\.(ts|js)$/,
  /db\.(ts|js)$/,
  /\.hysa\/brain\//,
];

let cachedMap: { data: ProjectMap; time: number; dir: string } | null = null;
const CACHE_TTL_MS = 30000;

function getWorkspaceRoot(): string {
  return process.cwd();
}

function findEntrypoints(root: string, allFiles: string[]): string[] {
  return allFiles.filter(f => ENTRYPOINT_PATTERNS.some(p => p.test(f)))
    .filter(f => existsSync(join(root, f)));
}

function findCoreServices(root: string, allFiles: string[]): string[] {
  return allFiles.filter(f => CORE_SERVICE_PATTERNS.some(p => p.test(f)))
    .filter(f => existsSync(join(root, f)));
}

function findApiFiles(root: string, allFiles: string[]): string[] {
  return allFiles.filter(f => API_PATTERNS.some(p => p.test(f)))
    .filter(f => existsSync(join(root, f)));
}

function findDbConfigs(root: string, allFiles: string[]): string[] {
  return allFiles.filter(f => DB_PATTERNS.some(p => p.test(f)))
    .filter(f => existsSync(join(root, f)));
}

function isConfigFile(name: string): boolean {
  const configFiles = [
    'package.json', 'tsconfig.json', '.env', '.env.example',
    'docker-compose.yml', 'Dockerfile', 'vitest.config.ts',
    'vite.config.ts', 'jest.config.ts', 'next.config.js',
    'eslint.config.js', '.prettierrc', 'AGENTS.md',
    'electron-builder.yml', '.gitignore',
  ];
  return configFiles.includes(name);
}

function walkFiles(root: string, dir: string, relativeRoot: string): string[] {
  const result: string[] = [];
  const ignoreDirs = new Set(['node_modules', '.git', 'dist', '.hysa', 'bin', '.git', 'coverage', '.cache']);
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (ignoreDirs.has(entry) || entry.startsWith('.')) continue;
      const fullPath = join(dir, entry);
      const relPath = join(relativeRoot, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          result.push(...walkFiles(root, fullPath, relPath));
        } else if (stat.isFile() && (entry.endsWith('.ts') || entry.endsWith('.js') || entry.endsWith('.json') || entry.endsWith('.mjs') || entry.endsWith('.cjs') || entry.endsWith('.tsx'))) {
          result.push(relPath);
        }
      } catch {
        // skip inaccessible
      }
    }
  } catch {
    // skip inaccessible
  }
  return result;
}

function detectModules(root: string, allFiles: string[]): Record<string, { purpose: string; files: string[]; dependsOn?: string[] }> {
  const modules: Record<string, { purpose: string; files: string[]; dependsOn?: string[] }> = {};

  const webFiles = allFiles.filter(f => f.startsWith('src/web/') || f.startsWith('web/'));
  const aiFiles = allFiles.filter(f => f.startsWith('src/ai/'));
  const agentFiles = allFiles.filter(f => f.startsWith('src/agent/'));
  const brainFiles = allFiles.filter(f => f.startsWith('src/brain/'));
  const contextFiles = allFiles.filter(f => f.startsWith('src/context/'));
  const desktopFiles = allFiles.filter(f => f.startsWith('src/desktop/'));
  const utilsFiles = allFiles.filter(f => f.startsWith('src/utils/') || f.startsWith('src/tools/'));

  if (webFiles.length > 0) {
    modules.web = { purpose: 'Web server, API routes, and frontend serving', files: webFiles.slice(0, 20), dependsOn: ['ai', 'context'] };
  }
  if (aiFiles.length > 0) {
    modules.ai = { purpose: 'AI provider clients, orchestration, and model routing', files: aiFiles.slice(0, 20) };
  }
  if (agentFiles.length > 0) {
    modules.agent = { purpose: 'Agent loop, tool execution, memory context', files: agentFiles.slice(0, 10), dependsOn: ['ai', 'brain'] };
  }
  if (brainFiles.length > 0) {
    modules.brain = { purpose: 'Persistent memory, experience graph, project map', files: brainFiles.slice(0, 10) };
  }
  if (contextFiles.length > 0) {
    modules.context = { purpose: 'Project analysis and context building', files: contextFiles.slice(0, 5) };
  }
  if (desktopFiles.length > 0) {
    modules.desktop = { purpose: 'Electron desktop application entry', files: desktopFiles.slice(0, 5), dependsOn: ['web'] };
  }
  if (utilsFiles.length > 0) {
    modules.utils = { purpose: 'Utility functions and tools', files: utilsFiles.slice(0, 15) };
  }

  return modules;
}

function detectCommands(root: string): Record<string, { purpose: string; entryFile?: string }> {
  const commands: Record<string, { purpose: string; entryFile?: string }> = {};
  try {
    const pkgPath = join(root, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};
      const importantScripts = ['build', 'start', 'dev', 'test', 'check', 'build:web', 'build:desktop', 'build:exe', 'package:nsis', 'package:win'];
      for (const name of importantScripts) {
        if (scripts[name]) {
          commands[name] = { purpose: scripts[name], entryFile: name === 'start' || name === 'dev' ? pkg.main || undefined : undefined };
        }
      }
    }
  } catch {
    // no package.json
  }
  return commands;
}

function buildSummary(map: ProjectMap, entrypoints: string[], coreServices: string[], apiFiles: string[], dbConfigs: string[], configFiles: string[]): string {
  const lines: string[] = [`Project: ${basename(getWorkspaceRoot())}`];
  if (map.projectType) lines.push(`Type: ${map.projectType}`);
  lines.push(`Updated: ${map.updatedAt}`);

  if (entrypoints.length > 0) lines.push(`Entrypoints: ${entrypoints.join(', ')}`);
  if (coreServices.length > 0) lines.push(`Core services: ${coreServices.length} files`);
  if (apiFiles.length > 0) lines.push(`API routes: ${apiFiles.length} files`);
  if (dbConfigs.length > 0) lines.push(`DB/config: ${dbConfigs.length} files`);
  if (configFiles.length > 0) lines.push(`Config files: ${configFiles.join(', ')}`);

  const modNames = Object.keys(map.modules);
  if (modNames.length > 0) lines.push(`Modules: ${modNames.join(', ')}`);

  const cmdNames = Object.keys(map.commands);
  if (cmdNames.length > 0) lines.push(`Scripts: ${cmdNames.join(', ')}`);

  lines.push(`Known systems: ${(map.knownSystems || []).join(', ')}`);

  return `[Project Map]\n${lines.join('\n')}\n`;
}

export async function scanProject(root?: string): Promise<ProjectMap> {
  const wsRoot = root || getWorkspaceRoot();
  const cached = cachedMap;
  if (cached && cached.dir === wsRoot && Date.now() - cached.time < CACHE_TTL_MS) {
    return cached.data;
  }

  const allFiles = walkFiles(wsRoot, wsRoot, '');

  const entrypoints = findEntrypoints(wsRoot, allFiles);
  const coreServices = findCoreServices(wsRoot, allFiles);
  const apiFiles = findApiFiles(wsRoot, allFiles);
  const dbConfigs = findDbConfigs(wsRoot, allFiles);
  const cfgFiles = allFiles.filter(f => isConfigFile(basename(f)));

  const configMap: Record<string, string> = {};
  for (const f of entrypoints) configMap[`entry:${f}`] = 'application entry point';
  for (const f of cfgFiles) configMap[`config:${f}`] = 'configuration file';

  const modules = detectModules(wsRoot, allFiles);
  const commands = detectCommands(wsRoot);

  let projectType = 'unknown';
  try {
    if (existsSync(join(wsRoot, 'package.json'))) {
      const pkg = JSON.parse(readFileSync(join(wsRoot, 'package.json'), 'utf-8'));
      if (pkg.dependencies?.electron || pkg.devDependencies?.electron) projectType = 'electron';
      else if (pkg.dependencies?.express) projectType = 'node-express';
      else if (pkg.dependencies?.next) projectType = 'nextjs';
      else projectType = 'node';
    }
  } catch { /* ignore */ }

  const map: ProjectMap = {
    version: 2,
    updatedAt: new Date().toISOString(),
    projectType,
    importantFiles: configMap,
    modules,
    commands,
    knownSystems: ['node', 'typescript', ...(projectType === 'electron' ? ['electron'] : [])],
  };

  try {
    await writeProjectMap(map);
  } catch {
    // non-blocking
  }

  cachedMap = { data: map, time: Date.now(), dir: wsRoot };
  return map;
}

export function invalidateProjectMapCache(): void {
  cachedMap = null;
}

export async function getProjectMapSummary(root?: string): Promise<string> {
  let map: ProjectMap | null = null;
  try {
    map = await readProjectMap();
  } catch { /* */ }

  const wsRoot = root || getWorkspaceRoot();
  const allFiles = walkFiles(wsRoot, wsRoot, '');

  const entrypoints = findEntrypoints(wsRoot, allFiles);
  const coreServices = findCoreServices(wsRoot, allFiles);
  const apiFiles = findApiFiles(wsRoot, allFiles);
  const dbConfigs = findDbConfigs(wsRoot, allFiles);
  const cfgFiles = allFiles.filter(f => isConfigFile(basename(f)));

  if (!map) {
    map = await scanProject(wsRoot);
  }

  return buildSummary(map, entrypoints, coreServices, apiFiles, dbConfigs, cfgFiles);
}
