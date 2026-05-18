# Security Policy

## How HYSA Code Protects You

### API Keys Are Stored Locally
- Your API keys are stored in `~/.hysa/config.json` on your machine only
- They are never sent to any server other than the AI provider you choose
- They are never uploaded, logged, or transmitted elsewhere
- You can view stored keys anytime with `hysa config`

### Secrets Are Never Sent to AI
- Before sending file contents to the AI, HYSA Code scans for:
  - API keys (`sk-...`, `AIza...`)
  - Private keys (`-----BEGIN ... PRIVATE KEY-----`)
  - GitHub tokens (`ghp_...`, `gho_...`, `ghu_...`)
  - Slack tokens, AWS keys, JWT tokens
- If a secret is detected, the file content is blocked from being sent
- You will see a warning with the type of secret found

### Edits Require Your Approval
- Before any file is modified, you see a colored diff preview
- You must explicitly confirm before changes are applied
- A backup is automatically created at `~/.hysa/backups/`

### Commands Require Your Approval
- Every shell command the AI wants to run is shown to you first
- Commands are NOT executed automatically
- You must explicitly approve each command

### `node_modules` and Sensitive Files Are Never Read
- HYSA Code respects `.gitignore` rules
- It never reads: `.env`, `node_modules`, `.git`, `dist`, `build`

## Reporting a Vulnerability

If you discover a security vulnerability, please do NOT open a public issue.
Instead, email the maintainer directly at security@hysa.dev.

We will respond within 48 hours and work on a fix.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅ |
| < 0.2   | ❌ |
