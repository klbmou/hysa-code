const DANGEROUS_PATTERNS = [
    /^rm\s+-[rf]/i, /^rm\s+\//i,
    /^del\s+/i, /^rd\s+\/s/i, /^rmdir\s+\/s/i,
    /^format\s+/i, /^sudo\s+(rm|dd|mkfs|fdisk|shutdown|reboot|poweroff)/i,
    /^dd\s+/i, /^mkfs/i, /^fdisk\s+/i, /^pvcreate/i,
    /^chmod\s+-?r?\s*777/i,
    /^chown\s+/i,
    /^:\(\)\{/,
    />.*\/dev\/(sda|sdb|sdc|nvme|hd)/,
    /npm.*--force.*install/i,
    /pip.*--force-reinstall/i,
    /Remove-Item/i,
    /git\s+reset\s+--hard/i,
    /git\s+clean/i,
    /npm\s+publish/i,
    /--force\b/,
];
const SAFE_PATTERNS = [
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
const CAUTION_PATTERNS = [
    /^git\s+(push\s+--force|reset|rebase|merge|cherry-pick)\b/i,
    /^rm\s+/i,
    /^del\s+/i,
    /^npm\s+(uninstall|remove|prune|audit\s+fix)\b/i,
    /^docker\s+(rm|rmi|system\s+prune|volume\s+rm)\b/i,
    /^kill\s+/i,
    /^taskkill\s+/i,
];
export function classifyCommand(command) {
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(command))
            return 'dangerous';
    }
    for (const pattern of SAFE_PATTERNS) {
        if (pattern.test(command))
            return 'safe';
    }
    for (const pattern of CAUTION_PATTERNS) {
        if (pattern.test(command))
            return 'caution';
    }
    return 'unknown';
}
export function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const id = setTimeout(() => {
                clearTimeout(id);
                reject(new Error(`${label || 'Operation'} timed out after ${ms}ms`));
            }, ms);
        }),
    ]);
}
export function formatCommandOutput(stdout, maxLines = 80) {
    const lines = stdout.split('\n');
    if (lines.length <= maxLines)
        return stdout;
    const head = lines.slice(0, Math.floor(maxLines / 2));
    const tail = lines.slice(-Math.floor(maxLines / 2));
    return [...head, `... (${lines.length - maxLines} lines truncated)`, ...tail].join('\n');
}
//# sourceMappingURL=commands.js.map