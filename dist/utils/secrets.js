const SECRET_PATTERNS = [
    /sk-[a-zA-Z0-9]{20,}/g,
    /AIza[0-9A-Za-z_-]{35}/g,
    /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----/g,
    /ghp_[a-zA-Z0-9]{36}/g,
    /gho_[a-zA-Z0-9]{36}/g,
    /ghu_[a-zA-Z0-9]{36}/g,
    /xox[baprs]-[a-zA-Z0-9]{10,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
];
export function detectSecrets(content) {
    const found = new Set();
    for (const pattern of SECRET_PATTERNS) {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
            const preview = match[0].length > 24 ? match[0].slice(0, 16) + '...' : match[0];
            found.add(preview);
        }
    }
    return [...found];
}
//# sourceMappingURL=secrets.js.map