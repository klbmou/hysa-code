const DANGEROUS_PATTERNS: RegExp[] = [
  /^rm\s+-[rf]/i, /^rm\s+\//i,
  /^del\s+/i, /^rd\s+\/s/i, /^rmdir\s+\/s/i,
  /^format\s+/i, /^sudo\s+(rm|dd|mkfs|fdisk|shutdown|reboot|poweroff)/i,
  /^dd\s+/i, /^mkfs/i, /^fdisk\s+/i, /^pvcreate/i,
  /^chmod\s+-?r?\s*777/i,
  /^chown\s+/i,
  /^:\(\)\{/, // fork bomb
  />.*\/dev\/(sda|sdb|sdc|nvme|hd)/,
  /npm.*--force.*install/i,
  /pip.*--force-reinstall/i,
];

const SAFE_PATTERNS: RegExp[] = [
  /^npm\s+(install|run|test|build|start|ci|audit|ls|outdated)\b/i,
  /^npx\s+/i,
  /^node\s+/i,
  /^cargo\s+(build|test|check|run|clippy|fmt)\b/i,
  /^go\s+(build|test|run|mod|fmt|vet)\b/i,
  /^pip(3)?\s+(install|list|show|freeze)\b/i,
  /^python3?\s+/i,
  /^tsx\s+/i,
  /^tsc\s+/i,
  /^vitest\s+/i,
  /^jest\s+/i,
  /^mocha\s+/i,
  /^git\s+(status|log|diff|branch|add|commit|push|pull|checkout|switch|stash)\b/i,
  /^ls\b/i, /^dir\b/i, /^pwd\b/i, /^whoami\b/i, /^which\s+/i,
  /^cat\s+/i, /^type\s+/i, /^head\s+/i, /^tail\s+/i,
  /^echo\s+/i, /^printf\s+/i,
  /^curl\s+/i, /^wget\s+/i,
  /^cd\s+/i, /^mkdir\s+/i,
  /^rg\s+/i, /^grep\s+/i, /^find\s+/i,
  /^cp\s+/i, /^copy\s+/i, /^move\s+/i, /^mv\s+/i,
  /^sort\s+/i, /^uniq\s+/i, /^wc\s+/i,
  /^date\s+/i, /^time\s+/i,
  /^env\s+/i, /^printenv\s+/i,
  /^uname\s+/i, /^hostname\s+/i,
];

export type CommandSafety = 'safe' | 'dangerous' | 'unknown';

export function classifyCommand(command: string): CommandSafety {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return 'dangerous';
  }
  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(command)) return 'safe';
  }
  return 'unknown';
}
