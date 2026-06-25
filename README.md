# HYSA Code v1.0.0 — The AI-Powered SaaS Platform

<div dir="rtl">

## HYSA كود v1.0.0 — منصة برمجية عالمية بالذكاء الاصطناعي

HYSA Code v1.0.0 منصة استضافة ذاتية، تعمل دائمًا، لمنصة برمجة بالذكاء الاصطناعي مصممة للأداء والموثوقية والأمان.

```bash
npm install -g hysa-code
hysa
```

</div>

---

**HYSA Code v1.0.0** is a self-hosted, always-on AI coding platform engineered for performance, reliability, and security.

```bash
npm install -g hysa-code
hysa
```

### Core Features

- **🌐 Global SaaS Deployment (Always-On)** — One-click deploy via `npm run deploy:global`. PM2 daemonization with auto-restart, memory threshold watcher (400MB RSS alert, 512MB max), live health endpoint for load balancers, and live log viewer UI.
- **🧠 Failure Memory System (Self-Correcting AI)** — Automatic memory of runtime failures, provider fallbacks, and user corrections. The system learns from every interaction and adapts to your workflow.
- **🖥️ Professional UI** — Obsidian-grade dark terminal interface with live session indicator (neon cyan pulse), compact single-line status bar, SVG brand favicon, and professional offline error page.
- **🛡️ Enterprise-Ready Security & Authentication** — Public access key middleware with private-IP auto-bypass. External requests require API key auth. "Remember Me" localStorage persistence. Secrets redacted from all logs and diagnostics.

> **v1.0.0 highlights:**
> - **🌐 Global SaaS Deployment** — one-click `npm run deploy:global` starts a PM2-managed production daemon with auto-restart, memory threshold alerts (400MB RSS), and public URL support.
> - **🛡️ Public Access Key Authentication** — key guard middleware with private-IP auto-bypass. External requests must provide key via `x-api-key` header or `api_key` query param.
> - **📊 Live Log Viewer & Health Monitoring** — real-time log polling at `/api/logs` with dark terminal UI, color-coded levels. Unauthenticated `/api/health` endpoint.
> - **🧠 Failure Memory System** — automatic 400MB RSS memory threshold watcher with PM2 broadcast on threshold exceeded.
> - **🖥️ Professional UI Polish** — SVG brand favicon, error.html offline fallback, neon cyan pulse live session indicator, compact single-line terminal status bar.
> - **✅ Deterministic E2E Testing** — `HYSA_E2E_TEST_PROVIDER=true` enables predictable responses for CI/CD pipelines with zero external API calls.

## Quick Start

```bash
# Start interactive chat
hysa

# Or explicitly
hysa chat

# View configuration
hysa config

# Show project tree
hysa tree
```

On first run, you'll choose your AI mode:

1. **☁️ Free API Key** — OpenCode Zen, OpenRouter, Groq, DeepSeek, Gemini (free API key, no download)
2. **🖥️  Local Free** — Ollama, LM Studio, Jan, llama.cpp (no API key, requires local server)
3. **🔑 Premium API** — Claude, GPT (paid or billed API)

Experimental free providers (Pollinations, LLM7, Puter) are hidden by default. Enable with:
```bash
hysa experimental on
```

---

## Provider Comparison

| Tier | Provider | Signup | Key | Cost | Best For |
|------|----------|--------|-----|------|----------|
| ☁️ FREE API KEY | [OpenCode Zen](https://opencode.ai/zen) | Free, no CC | Required | Free limited models | Curated free/open models |
| ☁️ FREE API KEY | [OpenRouter](https://openrouter.ai/keys) | Free, no CC | Required | Free tier | Many models, gateway |
| ☁️ FREE API KEY | [Groq](https://console.groq.com) | Free, no CC | Required | Free tier | Fast inference |
| ☁️ FREE API KEY | [DeepSeek](https://platform.deepseek.com) | Free, no CC | Required | Free credits | Coding models |
| ☁️ FREE API KEY | [Google Gemini](https://aistudio.google.com/apikey) | Free, no CC | Required | Free tier (60 req/min) | Large context, quotas apply |
| 🖥️  LOCAL FREE | [Ollama](https://ollama.com) | Download only | None | Free | Offline, privacy |
| 🖥️  LOCAL FREE | [LM Studio](https://lmstudio.ai) | Download only | None | Free | GUI, easy model download |
| 🖥️  LOCAL FREE | HYSA AI Provider | Download + npm start | Dev key | Free | Uses Ollama via HYSA Provider |
| 🖥️  LOCAL FREE | Custom local endpoint | Any OpenAI-compatible server | None | Free | Flexible, any local server |
| 🧪 EXPERIMENTAL FREE | [Pollinations AI](https://pollinations.ai) | No key* | Free | No | Toy projects, testing |
| 🧪 EXPERIMENTAL FREE | [LLM7](https://github.com/llm7) | Optional | Free | No | Toy projects, testing |
| 🧪 EXPERIMENTAL FREE | [Puter AI](https://puter.com) | No key | Free | No | Web-mode candidate |

_\*Pollinations does not require an API key by default._
| 🔑 PREMIUM | [OpenAI GPT](https://platform.openai.com/api-keys) | Paid key | Required | Usage-based | Fast, versatile |

---

## Setup Guides

### ☁️ OpenCode Zen (Free API Key)

1. Sign up at [opencode.ai/zen](https://opencode.ai/zen) — free, no credit card
2. Create an OpenCode Zen API key
3. Run `hysa`, select **Free API Key**, choose OpenCode Zen

**Important:** Some models are free for a limited time. Not all models may be available. If a model is unavailable, use `/model` to switch to a different Zen model or provider.

**Free models:** `big-pickle`, `minimax-m2.5-free`, `nemotron-3-super-free`, `mimo-v2-pro-free`, `mimo-v2-omni-free`, `glm-4.7-free`, `kimi-k2.5-free`

### ☁️ OpenRouter (Free API Key)

1. Sign up at [openrouter.ai/keys](https://openrouter.ai/keys) — free, no credit card
2. Create a free API key
3. Run `hysa`, select **Free API Key**, choose OpenRouter

**Default coding model:** `qwen/qwen3-coder:free` (coding-optimized)
**Fallback models:** `deepseek/deepseek-chat:free`, `openai/gpt-oss-120b:free`, `nvidia/nemotron-nano-12b-v2-vl:free`, `z-ai/glm-4.5-air:free`

**Router model (`openrouter/free`):** May route to a general-purpose model that can be weaker for coding. Prefer a specific `:free` coding model.

#### View available OpenRouter free models

OpenRouter provides a large catalog of free models. To see them:

```bash
# Show all OpenRouter models
hysa models openrouter

# Show only free models
hysa models openrouter --free
```

You can also run `/models` inside `hysa chat` when OpenRouter is the current provider to see available free models and switch with `/model`.

Many free models are listed in the [OpenRouter Logs](https://openrouter.ai/logs) after making a request — look for rows with `$0.00` cost. If a model ID includes `:free` or the name says `(free)`, it's available at no cost.

### ☁️ Groq (Free API Key)

1. Sign up at [console.groq.com](https://console.groq.com) — free, no credit card
2. Create a free API key
3. Run `hysa`, select **Free API Key**, choose Groq

**Free models:** `llama3-70b-8192`, `llama3-8b-8192`, `mixtral-8x7b-32768`

### ☁️ DeepSeek (Free API Key)

1. Sign up at [platform.deepseek.com](https://platform.deepseek.com) — free, no credit card
2. Create a free API key
3. Run `hysa`, select **Free API Key**, choose DeepSeek

**Free models:** `deepseek-chat`, `deepseek-coder`

### ☁️ Google Gemini (Free API Key)

1. Sign up at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free, no credit card
2. Create a free API key
3. Run `hysa`, select **Free API Key**, choose Gemini

**Vision support:** Gemini supports image understanding. Attach images in `#/chat` and ask questions about them.
**Limits:** 60 requests per minute, daily quota applies (≈20 requests/day on free tier). 503/429 errors are common on overload.

### 🖥️  Ollama (Local Free)

1. Install [Ollama](https://ollama.com)
2. Pull a model: `ollama run qwen2.5-coder`
3. Run `hysa`, select **Local Free**, choose Ollama

```bash
# Make sure Ollama is running
ollama run qwen2.5-coder
```

### 🖥️  LM Studio / Local OpenAI (Local Free)

1. Download and install [LM Studio](https://lmstudio.ai)
2. Load a model and start the local inference server (default: `http://localhost:1234/v1`)
3. Run `hysa`, select **Local Free**, choose **LM Studio**

Also compatible with:
- **Jan.ai** — default at `http://localhost:1337/v1`
- **llama.cpp** server — default at `http://localhost:8080/v1`
- **Any OpenAI-compatible endpoint** — choose "Custom endpoint" during setup

### 🖥️  HYSA AI Provider (Local Free)

This is your own local/free provider. It uses the HYSA Provider server, which in turn uses Ollama. No external paid API is required.

1. First, set up the HYSA Provider:
   ```bash
   git clone <hysa-provider-repo>
   cd hysa-provider
   npm install
   npm run build
   npm start
   ```
2. Ensure Ollama is running with the required models:
   ```bash
   ollama pull qwen2.5-coder:1.5b
   ollama pull qwen2.5-coder:3b
   ```
3. Run `hysa`, select **Local Free**, choose **HYSA AI**

**Available models:**
| Model | Ollama Model | Quality | Resource Usage |
|---|---|---|---|
| `hysa-coder-lite` | `qwen2.5-coder:1.5b` | Lighter but weaker at tool use | ~1GB RAM |
| `hysa-coder` | `qwen2.5-coder:3b` | Better for coding/tool calls | ~2GB RAM |
| `hysa-fast` | `qwen2.5-coder:1.5b` | Same as lite, fast responses | ~1GB RAM |

**Default API key:** `hysa_dev_key` (pre-configured, no signup needed)

**Architecture:** `HYSA Code → HYSA Provider → Ollama local model`

**Recommended:** For the best coding experience, run the 3b model:
```bash
ollama run qwen2.5-coder:3b
```
Then select `hysa-coder` in HYSA Code's model menu.

### 🔑 Claude / GPT (Premium)

| Provider | Get API Key |
|----------|-------------|
| Anthropic Claude | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI GPT | [platform.openai.com](https://platform.openai.com/api-keys) |

Select **Premium API** during setup and enter your key.

### 🧪 Experimental Free Providers

Experimental free providers may work without a traditional API key, but **they are not guaranteed stable, private, or production-safe**.

```
hysa experimental on
```

Once enabled:

| Provider | Key | Models | Notes |
|----------|-----|--------|-------|
| [Pollinations AI](https://pollinations.ai) | Not required | `openai`, `openai-fast`, `qwen-coder`, `deepseek-v3`, `gemini-2.5-flash-lite` | Free text generation endpoint |
| [LLM7](https://github.com/llm7) | Optional | `qwen2.5-coder-32b-instruct`, `gpt-4o-mini-2024-07-18`, `deepseek-r1-0528` | OpenAI-compatible |
| [Puter AI](https://puter.com) | No traditional key | `gpt-4o-mini` | May require browser/session |

**Warning:** Experimental providers may log prompts, rate-limit, disappear, or change behavior without notice. Do not send sensitive or private code when using experimental providers.

Use these providers for:
- Toy projects and personal testing
- Quick experiments and prototyping
- Evaluating model quality without signup

Avoid for:
- Production code or commercial work
- Private or proprietary codebases
- Anything requiring data privacy

Run diagnostics:
```bash
hysa doctor --provider pollinations
hysa doctor --provider llm7
hysa doctor --provider puter
```

---

## Features

- **12 AI providers** — Claude, GPT, Gemini, Ollama, OpenRouter, Groq, DeepSeek, LM Studio, OpenCode Zen, +3 experimental (Pollinations, LLM7, Puter)
- **Free API Key tier** — OpenRouter, Groq, DeepSeek, Gemini (free key, no local models)
- **Local Free** — Ollama, LM Studio, Jan, llama.cpp (no API key, offline capable)
- **Experimental Free** — no-key providers for testing, not production-safe
- **Chat attachments** — attach text files (500KB max), images (5MB max), PDFs (10MB max), DOCX files (10MB max)
- **PDF text extraction** — selectable-text PDFs extracted in-browser via pdf.js; scanned PDFs detected (OCR not yet supported)
- **Image understanding** — attach images for AI analysis; requires vision-capable provider (Gemini, OpenRouter vision, GPT-4o, Claude)
- **Vision provider fallback** — non-vision providers automatically route to OpenRouter vision → Gemini vision models
- **Persistent Project Memory** — auto-learns decisions, lessons, and provider behavior across sessions. `hysa brain recall` to query past context.
- **Smart Context Injection** — relevant memories (decisions, lessons, provider events) are automatically ranked and injected into chat context with per-task token budgets. Pinned memories are always preserved.
- **Memory Quality & Cleanup** — importance/confidence scoring, fuzzy-duplicate detection via Jaccard similarity, optional pruning of low-value events. `hysa brain inspect`, `hysa brain cleanup`, `hysa brain forget`, `hysa brain merge`, `hysa brain pin`.
- **Session Tracking** — records commands, file edits, tools, errors, auto-fix attempts, provider fallbacks. Auto-saves important outcomes to Brain memory. `hysa session summary`, `hysa session save`, `hysa session clear`.
- **Smart project detection** — auto-detects Next.js, React, Express, Django, Go, Rust, and more
- **Context-aware** — knows your project structure, key files, and entry points
- **Multi-step reasoning** — AI reads, analyzes, then edits in one turn
- **Interactive file editing** — see diffs before applying, automatic backups
- **Safe command execution** — approve or reject every command
- **Secret detection** — blocks API keys, tokens, and secrets from being sent to AI
- **Token safety** — automatically manages context window limits
- **Git awareness** — shows current branch and dirty state
- **Automatic fallback** — if a Free API Key provider rate-limits or fails, tries another
- **Provider-level fallback** — fallback candidates grouped by provider, tries all models on one provider before switching
- **Auth error classification** — 401/403/authentication errors correctly categorized (not misclassified as timeouts)
- **Model health tracking** — models that fail tool calls are deprioritized
- **Automatic retry** — exponential backoff on rate limits and server errors
- **Friendly error messages** — raw JSON hidden in favor of human-readable tips
- **Session memory** — remembers recent tasks, files, and edits across sessions

---

## Commands

### Chat Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/model` | Switch AI provider or model mid-chat |
| `/new` | Clear conversation history |
| `/health` | Show current provider health and status |
| `/models` | Show OpenRouter free models (when provider is OpenRouter) |
| `/providers` | List all providers with tier and key status |
| `/retry` | Retry the last AI response |
| `/debug` | Toggle debug mode (shows raw errors) |
| `/tree` | Show project file tree |
| `/search <pattern>` | Search code for a pattern (grep) |
| `/find <filename>` | Find files by name |
| `/read <path>` | Read a file directly |
| `/run <command>` | Execute a shell command (with approval) |
| `/yolo` | Toggle YOLO mode (auto-apply edits) |
| `/exit` | Exit HYSA Code |

### CLI Commands

| Command | Description |
|---------|-------------|
| `hysa chat` | Start interactive chat |
| `hysa config` | View or update configuration |
| `hysa doctor` | Run system diagnostics |
| `hysa tree` | Show project file tree |
| `hysa session summary` | Show session summary (commands, files, errors, status) |
| `hysa session save` | Save important session outcomes to Brain memory |
| `hysa session clear` | Clear current session tracking state |
| `hysa brain init` | Initialize `.hysa/brain` files |
| `hysa brain status` | Show brain directory status |
| `hysa brain inspect` | Memory quality report: counts, duplicates, stale events, top memories |
| `hysa brain note <text>` | Add a manual note to brain |
| `hysa brain lesson <title> <text>` | Add a lesson learned |
| `hysa brain decision <title> <text>` | Add a design decision |
| `hysa brain remember <text>` | Save text as decision/lesson via keyword classification |
| `hysa brain recall <query>` | Search the experience graph for relevant memories |
| `hysa brain map` | Generate/update project-map.json |
| `hysa brain cleanup [--apply]` | Prune low-value memories (dry-run by default) |
| `hysa brain forget <query>` | Remove matching memory nodes (pinned nodes protected) |
| `hysa brain merge <a> <b>` | Merge two memory nodes |
| `hysa brain pin <query>` | Pin a memory node (protected from cleanup) |
| `hysa local setup` | Show local provider setup instructions |
| `hysa models <provider>` | View available models for a provider |
| `hysa web` | Start the HYSA Web UI |

---

## Safety

| Feature | Description |
|---------|-------------|
| **Local API keys** | Keys stored in `~/.hysa/config.json` on your machine only |
| **Secret scanning** | API keys, tokens, and private keys are detected before sending to AI |
| **Diff approval** | Every file edit shows a colored diff — you approve before applying |
| **Command approval** | Every shell command is shown — you approve before execution |
| **Backup system** | Modified files are automatically backed up to `~/.hysa/backups/` |
| **Ignore rules** | Respects `.gitignore` — never reads `node_modules`, `.env`, `.git`, `dist` |
| **Pinned brain memories** | Pinned memories are never deleted by cleanup or forget commands |
| **Dry-run cleanup** | `hysa brain cleanup` defaults to dry-run; add `--apply` to mutate |
| **Secrets redacted** | API keys, tokens, and secrets are redacted from brain memory and session records |
| **Token-bounded context** | Brain context injection respects per-task token budgets (800–3000 chars) |

See [SECURITY.md](SECURITY.md) for details.

---

## YOLO Mode

YOLO mode enables a faster workflow by automatically applying edits and running safe commands without confirmation prompts.

### How to enable

```bash
# CLI flag (start chat with YOLO enabled)
hysa chat --yolo

# Toggle during chat
/yolo on
/yolo off
/yolo status
```

### What changes

| Behavior | Normal Mode | YOLO Mode |
|----------|-------------|-----------|
| File edits | Show diff, ask "Apply?" | Show diff, apply automatically |
| Pending edits | Show diff, ask "Apply?" | Show diff, apply automatically |
| Safe commands | Ask "Run this?" (default Yes) | Run automatically |
| Caution commands | Ask "Run this?" (default No) | Ask "Run this?" (default Yes) |
| Dangerous commands | Always ask with warning | Always ask with warning |
| File backups | Created automatically | Created automatically |

### Safety

YOLO mode still protects you:

- **Backups are always created** before edits (`~/.hysa/backups/`)
- **Dangerous commands always require approval** (rm -rf, git reset --hard, sudo, etc.)
- **Protected files are never auto-edited** (.env, package-lock.json, node_modules/, .git/, dist/, build/)
- **Diff is still shown** before applying — you can see what changed
- **YOLO mode is session-only** by default — not saved between sessions (use `hysa chat --yolo` or `/yolo on` each session)

### When to use

- **Familiar projects** where you trust the AI's edits
- **Repetitive tasks** like fixing type errors, adding imports
- **Quick prototyping and iteration**

### When to avoid

- **Critical production code** — always review edits carefully
- **Sensitive files** containing secrets or credentials
- **When you're learning** — reviewing diffs helps understand changes
- **New codebases** — let the AI prove itself first

### Command classification

Commands are classified into three safety levels:

**Safe** — run automatically in YOLO mode:
- `npm run build`, `npm run check`
- `npm test`, `node index.js`
- `git diff`, `git status`
- And 30+ other common commands

**Caution** — still require confirmation in YOLO mode:
- `git push --force`, `git reset`, `git merge`
- `rm`, `del`
- `npm uninstall`, `docker rm`

**Dangerous** — always require confirmation:
- `rm -rf`, `sudo`, `dd`, `format`
- `git reset --hard`, `git clean`
- `npm publish`, any command with `--force`
- `Remove-Item` (PowerShell)

---

## Brain — Project Memory

HYSA maintains a persistent **experience graph** (`.hysa/brain/`) that records decisions, lessons, provider events, and session outcomes. This memory survives across chat sessions and is automatically used to inject relevant context into new conversations.

### How it works

1. **Auto-learning** — decisions, lessons, and provider events are written to the graph as you work
2. **Smart context injection** — on each chat message, relevant memories are scored by keyword relevance, importance, confidence, and recency, then injected within a per-task token budget
3. **Memory quality scoring** — each node has `importance` (0–100) and `confidence` (0–100); pinned nodes are protected from cleanup
4. **Fuzzy deduplication** — similar labels are detected via Jaccard similarity (threshold >0.4); duplicates are merged automatically
5. **Pruning** — low-importance events (>30 days old, importance <30) are candidates for cleanup

### CLI commands

| Command | Description |
|---------|-------------|
| `hysa brain status` | Show brain directory status |
| `hysa brain inspect` | Full memory quality report: nodes by kind, stale events, duplicate groups, top decisions/lessons |
| `hysa brain cleanup` | Dry-run: show what would be pruned. Add `--apply` to execute |
| `hysa brain forget <query>` | Remove matching nodes (pinned nodes are skipped) |
| `hysa brain merge <a> <b>` | Merge two nodes (keeps highest confidence/importance) |
| `hysa brain pin <query>` | Protect a node from cleanup (sets pinned, importance bumped to 80) |
| `hysa brain recall <query>` | Search the experience graph for relevant memories |
| `hysa brain note <text>` | Add a manual note |
| `hysa brain lesson <title> <text>` | Add a lesson |
| `hysa brain decision <title> <text>` | Add a decision |
| `hysa brain graph stats` | Show graph statistics |
| `hysa brain graph search <query>` | Search graph nodes and edges |

### Safety

- **Pinned nodes are never deleted** by cleanup or forget commands
- **Dry-run by default** — `hysa brain cleanup` shows actions without mutating; add `--apply` to execute
- **Secrets are redacted** before any memory is written or injected
- **Token budgets** prevent context overflow (800 chars for simple chat, 2000 for code, 3000 for planning, 1500 for provider queries)

---

## Session Tracking

HYSA tracks activity within a session: commands run, files read/edited, tools used, errors encountered, auto-fix attempts, provider fallbacks, and memories injected. At the end of a session, you can generate a summary and save important outcomes to Brain memory.

### CLI commands

| Command | Description |
|---------|-------------|
| `hysa session summary` | Show a human-readable session summary with duration, status, files, decisions, issues, and test/build status |
| `hysa session save` | Auto-save important session outcomes to Brain (decisions as decision nodes, lessons as lesson nodes, session summary as lesson, provider fallbacks as provider events) |
| `hysa session clear` | Reset the current session tracking state |

### Auto-save behavior

When you run `hysa session save`, the tracker:
1. **Detects decisions** — events containing "decided" or "decision" keywords are saved as `decision` memory nodes
2. **Detects lessons** — events containing "learned" or "lesson" keywords are saved as `lesson` memory nodes
3. **Saves a session summary** — if files were changed or errors occurred, a `lesson` node is created with the full summary (files, commands, issues, test/build status)
4. **Records provider fallbacks** — if fallbacks occurred, a `provider_failure` event is recorded
5. **Skips trivial sessions** — sessions with no commands, files, or errors are not saved

### Safety

- **Secrets are redacted** from all event details before storage
- **Summary is capped** at 4000 characters; longer summaries are truncated
- **Raw command output is not saved** — only the command string and outcome
- **File diffs are not saved** — only file paths are recorded

---

## Troubleshooting

### "fetch failed" / Network errors

- Check your internet connection with: `hysa doctor`
- Some providers may be blocked in your region (try a different Free API Key provider)
- Firewall or proxy may be blocking API calls

### Gemini free tier errors

- **503 Service Unavailable** — The model is overloaded. Wait a moment and retry.
- **429 Too Many Requests** — Rate limit hit (60 req/min for free tier).
- **Quota exceeded** — Daily free quota reached. Switch to another provider with `/model`.
- HYSA Code automatically falls back to OpenRouter / Groq / DeepSeek when Gemini fails.

### Ollama not running

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve

# Pull a model
ollama run qwen2.5-coder
```

### LM Studio / Local OpenAI not running

- Make sure the local server is started in LM Studio (localhost:1234)
- Check with: `curl http://localhost:1234/v1/models`
- For custom endpoints, verify the base URL and model name in `hysa config`

### API key missing

```bash
# Run diagnostics
hysa doctor

# Check current config
hysa config

# Set a new API key
hysa config → Update API key
```

### Rate limited

- Free API Key providers have rate limits — wait a moment and retry
- HYSA Code automatically retries with exponential backoff (up to 2 retries)
- If all retries fail, it falls back to other Free API Key providers
- Consider switching to a different provider with `/model`

### Windows PowerShell issues

- Run `hysa` from PowerShell or Command Prompt
- If you get an execution policy error, run: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
- For colorful output, use Windows Terminal (recommended) or VS Code terminal

### "Cannot find module" errors

```bash
# Reinstall globally
npm uninstall -g hysa-code
npm install -g hysa-code
```

---

## Screenshots

```
┌──────────────────────────────────────────────────┐
│  💜 HYSA Code     OpenRouter                    │
│  Model: deepseek/deepseek-chat                   │
│  ☁️  FREE API KEY                                 │
│  Git: main ●                                      │
│  Context: ~1,234 tokens                           │
└──────────────────────────────────────────────────┘

📁 Next.js project (142 files)
🌿 main ● modified

  Type a message or use /help for commands.

❯ fix the type error in UserCard component
🤔 Thinking...
HYSA: Let me read the UserCard component first.

📖 Reading: src/components/UserCard.tsx
✓ Read src/components/UserCard.tsx (68 lines)

HYSA: I see the issue. The `name` prop is typed as optional but you're
accessing it without a fallback. Let me fix it.

✏️  Proposed edit: src/components/UserCard.tsx
-  <h2>{name}</h2>
+  <h2>{name ?? 'Unknown User'}</h2>

? Apply this edit? (Y/n) › Yes
✓ Applied edit to src/components/UserCard.tsx
```

---

## Tech Stack

- **Runtime:** Node.js + TypeScript (ES2022)
- **CLI:** Commander + @inquirer/prompts
- **AI SDKs:** Anthropic, OpenAI, Google Generative AI
- **File diff:** diff (unified patch format)
- **Terminal UI:** picocolors
- **Web UI:** Express + Vite + React + Monaco Editor

## HYSA Web UI

HYSA Code includes a local browser-based UI alongside the CLI.

```bash
# Start the web UI on port 8787
hysa web

# Or specify a custom port
hysa web --port 3000
```

Open http://localhost:8787 in your browser.

### Features

- **File tree** (left) — browse all project files, click to edit
- **Code editor** (center) — Monaco Editor with syntax highlighting, language auto-detection, and save
- **AI Chat** (center) — full AI conversation panel, same provider/model as CLI
- **Files workspace** at `#/files` — stand-alone file browser and editor
- **Chat attachments** — attach text, images, PDFs, DOCX files via drag-and-drop or file picker
- **Image previews** — thumbnails in composer, expanded images in chat messages
- **PDF extraction** — selectable-text PDFs are extracted and sent as AI context
- **Bottom panel** with three tabs:
  - **Diff** — review file changes before applying (Apply / Reject buttons)
  - **Command** — approve or cancel shell commands proposed by the AI
  - **Activity** — tool call log (reads, edits, commands)
- **Top bar** — current provider, model, tier, git branch, YOLO toggle

### Safety

The Web UI uses the same safety systems as the CLI:
- File edits require **diff review + approval** before writing
- Shell commands require **confirmation** before execution
- Automatic file backups on every save
- Secret detection blocks API keys and tokens
- Respects `.gitignore` rules

### Limitations

- **Local only** — runs on `localhost`, no cloud hosting
- **No authentication** — do not expose to networks
- **Single session** — shares provider/model with CLI configuration
- **Requires web build** — run `npm run build:web` to rebuild static assets after updates

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

MIT — see [LICENSE](LICENSE) for details.
