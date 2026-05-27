import { execSync } from 'node:child_process';

export type ShellType = 'powershell' | 'cmd' | 'bash' | 'wsl';

export function detectShell(): ShellType {
  if (process.platform !== 'win32') {
    return process.env.WSL_DISTRO_NAME ? 'wsl' : 'bash';
  }
  const parentPid = process.ppid?.toString() || '';
  const comspec = process.env.ComSpec || '';
  const psParent = parentPid.includes('powershell') || parentPid.includes('pwsh');
  if (psParent) return 'powershell';
  if (comspec.toLowerCase().includes('powershell') || comspec.toLowerCase().includes('pwsh')) return 'powershell';
  return 'cmd';
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isWindowsShell(): boolean {
  return isWindows() && detectShell() !== 'wsl';
}

const UNIX_TO_WIN_CMD: [RegExp, (match: RegExpExecArray) => string][] = [
  [/^(.*?)\s*\|\s*head\s+-(\d+)\s*$/i, (m) => {
    const cmd = m[1].trim();
    const n = m[2];
    return isPowerShell() ? `${cmd} | Select-Object -First ${n}` : cmd;
  }],
  [/^(.*?)\s*\|\s*head\s+-n\s+(\d+)\s*$/i, (m) => {
    const cmd = m[1].trim();
    const n = m[2];
    return isPowerShell() ? `${cmd} | Select-Object -First ${n}` : cmd;
  }],
  [/^(.*?)\s*\|\s*tail\s+-(\d+)\s*$/i, (m) => {
    const cmd = m[1].trim();
    const n = m[2];
    return isPowerShell() ? `${cmd} | Select-Object -Last ${n}` : cmd;
  }],
  [/^(.*?)\s*\|\s*tail\s+-n\s+(\d+)\s*$/i, (m) => {
    const cmd = m[1].trim();
    const n = m[2];
    return isPowerShell() ? `${cmd} | Select-Object -Last ${n}` : cmd;
  }],
  [/^(.*?)\s*\|\s*grep\s+(.+)/i, (m) => {
    const cmd = m[1].trim();
    const pattern = m[2].trim().replace(/^["']|["']$/g, '');
    return isPowerShell() ? `${cmd} | Select-String -Pattern "${pattern.replace(/"/g, '`"')}"` : cmd;
  }],
  [/^head\s+-(\d+)\s+(.+)$/i, (m) => {
    const n = m[1];
    const file = m[2].trim();
    return isPowerShell() ? `Get-Content "${file}" -Head ${n}` : `type "${file}"`;
  }],
  [/^head\s+-n\s+(\d+)\s+(.+)$/i, (m) => {
    const n = m[1];
    const file = m[2].trim();
    return isPowerShell() ? `Get-Content "${file}" -Head ${n}` : `type "${file}"`;
  }],
  [/^tail\s+-(\d+)\s+(.+)$/i, (m) => {
    const n = m[1];
    const file = m[2].trim();
    return isPowerShell() ? `Get-Content "${file}" -Tail ${n}` : `type "${file}"`;
  }],
  [/^tail\s+-n\s+(\d+)\s+(.+)$/i, (m) => {
    const n = m[1];
    const file = m[2].trim();
    return isPowerShell() ? `Get-Content "${file}" -Tail ${n}` : `type "${file}"`;
  }],
  [/^grep\s+-rl\s+(.+)/i, (m) => {
    const pattern = m[1].trim().replace(/^["']|["']$/g, '');
    if (isPowerShell()) {
      return `Get-ChildItem -Recurse -File | Select-String -Pattern "${pattern.replace(/"/g, '`"')}" | Select-Object -ExpandProperty Path`;
    }
    return `findstr /S /M "${pattern.replace(/"/g, '')}" *`;
  }],
  [/^grep\s+-r\s+(.+?)\s+(.+)/i, (m) => {
    const pattern = m[1].trim().replace(/^["']|["']$/g, '');
    const path = m[2].trim();
    if (isPowerShell()) {
      return `Get-ChildItem -Path "${path}" -Recurse -File | Select-String -Pattern "${pattern.replace(/"/g, '`"')}"`;
    }
    return `findstr /S "${pattern.replace(/"/g, '')}" "${path}\\*"`;
  }],
  [/^grep\s+(.+?)\s+(.+)/i, (m) => {
    const pattern = m[1].trim().replace(/^["']|["']$/g, '');
    const file = m[2].trim();
    return isPowerShell()
      ? `Select-String -Path "${file}" -Pattern "${pattern.replace(/"/g, '`"')}"`
      : `findstr "${pattern.replace(/"/g, '')}" "${file}"`;
  }],
  [/^find\s+\.\s+-name\s+"([^"]+)"\s*(\|.*)?$/i, (m) => {
    const glob = m[1].replace(/\*/g, '*');
    const pipe = m[2] || '';
    if (isPowerShell()) {
      const cmd = `Get-ChildItem -Recurse -Filter "${glob}" | Select-Object -ExpandProperty FullName`;
      if (pipe) return `${cmd} ${pipe.replace(/^\s*\|\s*/, '| ')}`;
      return cmd;
    }
    return `dir /s /b "${glob}"${pipe ? ` ${pipe}` : ''}`;
  }],
  [/^find\s+\.\s+-type\s+f\s+-name\s+"([^"]+)"\s*(\|.*)?$/i, (m) => {
    const glob = m[1].replace(/\*/g, '*');
    const pipe = m[2] || '';
    if (isPowerShell()) {
      const cmd = `Get-ChildItem -Recurse -Filter "${glob}" -File | Select-Object -ExpandProperty FullName`;
      if (pipe) return `${cmd} ${pipe.replace(/^\s*\|\s*/, '| ')}`;
      return cmd;
    }
    return `dir /s /b "${glob}"${pipe ? ` ${pipe}` : ''}`;
  }],
  [/^ls\s+-la\s+(.+)$/i, (_m) => {
    const dir = _m[1].trim();
    return isPowerShell() ? `Get-ChildItem -Force "${dir}" | Format-Table -AutoSize` : `dir "${dir}"`;
  }],
  [/^ls\s+-l\s+(.+)$/i, (_m) => {
    const dir = _m[1].trim();
    return isPowerShell() ? `Get-ChildItem "${dir}" | Format-Table -AutoSize` : `dir "${dir}"`;
  }],
  [/^ls\s+(.+)$/i, (_m) => {
    const dir = _m[1].trim();
    return isPowerShell() ? `Get-ChildItem "${dir}" | Select-Object Name` : `dir "${dir}"`;
  }],
  [/^cat\s+(.+)$/i, (_m) => {
    const file = _m[1].trim();
    return isPowerShell() ? `Get-Content "${file}"` : `type "${file}"`;
  }],
  [/^wc\s+-l\s+(.+)$/i, (_m) => {
    const file = _m[1].trim();
    return isPowerShell() ? `(Get-Content "${file}" | Measure-Object -Line).Lines` : `find /c /v "" "${file}"`;
  }],
  [/^sort\s+(.+)$/i, (_m) => {
    const file = _m[1].trim();
    return `sort "${file}"`;
  }],
  [/^uniq\s+(.+)$/i, (_m) => {
    const file = _m[1].trim();
    return isPowerShell() ? `Get-Content "${file}" | Get-Unique` : `sort "${file}" | uniq`;
  }],
];

function isPowerShell(): boolean {
  const shell = detectShell();
  return shell === 'powershell';
}

export function translateCommand(command: string): string {
  if (!isWindowsShell()) return command;

  const trimmed = command.trim();

  for (const [pattern, replacer] of UNIX_TO_WIN_CMD) {
    const match = pattern.exec(trimmed);
    if (match) {
      const translated = replacer(match);
      return translated;
    }
  }

  return command;
}

export function shellInfo(): string {
  const shell = detectShell();
  const platform = process.platform;

  if (platform !== 'win32') {
    return 'POSIX environment (Linux/Mac) — standard Unix commands are available: head, tail, grep, find, cat, ls, sort, wc, uniq.';
  }

  if (shell === 'wsl') {
    return 'Windows Subsystem for Linux — standard Unix commands are available.';
  }

  if (shell === 'powershell') {
    return `PowerShell on Windows — use PowerShell syntax.
  - Get-Content -Head N or Select-Object -First N instead of head -N
  - Get-Content -Tail N or Select-Object -Last N instead of tail -N
  - Select-String -Pattern "..." instead of grep
  - Get-ChildItem -Recurse -Filter "*.ts" instead of find . -name "*.ts"
  - Get-Content file instead of cat file
  - dir instead of ls
  - sort file works (same as Unix)`;
  }

  if (shell === 'cmd') {
    return `Command Prompt (cmd.exe) on Windows — limited shell.
  - Use "type file" instead of "cat file"
  - Use "dir" instead of "ls"
  - Use "findstr" instead of "grep"
  - Use "dir /s /b" instead of "find . -name"
  - head/tail are NOT available — consider using Node.js tools instead
  - sort works
  - Prefer PowerShell commands by running: powershell -Command "Get-Content file -Head 10"`;
  }

  return '';
}

export function isCommandAvailable(commandName: string): boolean {
  if (!isWindowsShell()) return true;
  try {
    execSync(`where ${commandName}`, { encoding: 'utf-8', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
