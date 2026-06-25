# Changelog

## [1.0.0] - 2026-06-25

### Added
- **🌐 Global SaaS Deployment** — self-hosted production server with PM2 daemonization, one-click deploy script (`npm run deploy:global`), public URL support, and 0.0.0.0 binding.
- **🛡️ Public Access Key Authentication** — `HYSA_PUBLIC_API_KEY` guard middleware with private-IP auto-bypass. External requests require `x-api-key` header or `api_key` query param. Landing page "Remember Me" checkbox for persistent localStorage key storage.
- **📊 Live Health & Log Monitoring** — `GET /api/health` endpoint for PM2/load balancers, live log viewer UI polling `/api/logs` every 2s with dark terminal styling.
- **🧠 Failure Memory System** — automatic 400MB RSS memory threshold watcher with PM2 broadcast. Self-correcting AI that learns from runtime failures.
- **🖥️ Professional UI** — SVG brand favicon, `error.html` offline fallback, "Live Sessions: 1" neon cyan pulse indicator, compact single-line terminal status bar.
- **💾 Deterministic Test Provider** — `HYSA_E2E_TEST_PROVIDER=true` for reliable CI/CD pipeline testing without external API calls. Covers all `/api/chat` paths (streaming, non-streaming, continueChat, vision fallback).
- **🎯 24 Automated Smoke Tests** — component-level and true E2E smoke scripts covering memory-aware planning, 9Router probes, Arabic chat routing, and production deployment validation.

### Changed
- Version bumped to 1.0.0 — first stable production release.
- Server now binds to `0.0.0.0` in production mode by default.
- `safeFetchJson` auto-injects `x-api-key` header from sessionStorage.
- PM2 ecosystem config hardened with `max_memory_restart: 512M`, `listen_timeout: 15000`, `kill_timeout: 10000`.

### Fixed
- String terminator and brace parsing errors in `scripts/deploy-global.ps1`.
- Inline `} finally { Pop-Location }` constructs rewritten to multi-line to avoid PowerShell parser ambiguity.

## [0.6.0] - 2025-05-25

### Added
- **Persistent Project Memory** — experience graph stores decisions, lessons, and provider events with importance/confidence scoring. Auto-learns from fixes, failures, and user input. Dual storage (graph JSON + markdown files).
- **Memory Quality & Cleanup** — fuzzy deduplication via Jaccard similarity (threshold >0.4), label normalization, cleanup commands (dry-run default, `--apply` to execute). New CLI: `hysa brain inspect`, `hysa brain cleanup`, `hysa brain forget`, `hysa brain merge`, `hysa brain pin`.
- **Smart Context Injection** — relevant memories are scored by keyword relevance (0.4), importance (0.25), confidence (0.2), and recency (0.15), then injected within per-task token budgets (simple:800, code:2000, planning:3000, provider:1500 chars). Provider-only tasks filter for provider events; pinned memories always preserved.
- **Session Tracking** — records commands, file edits, tools, errors, auto-fix attempts, provider fallbacks, and memory injections. `hysa session summary`, `hysa session save`, `hysa session clear` CLI commands. Auto-saves important outcomes to Brain (decisions, lessons, provider fallbacks). Trivial sessions are skipped. Secrets redacted from all records.
- **39 automated tests** across 4 suites (memory-writer, brain-quality, context-selector, session-tracker).

### Changed
- Experience graph version bumped to 2 (backward-compatible — old graphs read via fallback).
- Context injection now uses ranked selection instead of broad recall context.
- `writeMemory()` now handles scoring (importance/confidence) and fuzzy deduplication.

### Fixed
- Type error in context-selector.ts (unused `intent` variable and comparison against non-existent `'code'` intent).
- CLI session commands no longer call `getOrCreateSession()` before `saveSessionToBrain()`, which would overwrite saved session data.

## [0.5.1] - 2025-05-23

### Fixed
- Automatic vision fallback now tries OpenRouter vision models first when current provider is OpenRouter
- Same-provider vision candidates no longer incorrectly skipped (was returning 1, now returns up to 3)
- Vision fallback limited to max 3 attempts with 10s timeout per attempt
- Huge technical error dumps removed from normal chat — shows friendly Arabic/English failure messages instead
- Fallback timeline events hidden from chat UI unless debug mode is on
- Language matching now applies to image analysis, PDF summaries, text attachments, and all vision responses
- Chat layout redesigned: centered 820px column, polished bubbles, proper image card layout below user text

### Added
- Friendly vision failure messages in user's language:
  - Arabic: "لم أستطع تحليل الصورة الآن لأن نماذج الرؤية المتاحة غير متوفرة..."
  - English: "I couldn't analyze the image right now because the available vision models are unavailable..."
- Debug mode shows compact "Tried X vision models:" list with per-model reasons
- Collapsible fallback detail events in debug mode
- `getResponseLanguage()` helper for language-matched error messages
- System prompt instructions for language matching and concise image analysis
- Document-aware quick actions in composer (when attachments present)

### Changed
- Vision fallback timeout reduced from 15s to 10s per model
- Vision candidates prioritized: OpenRouter vision → Gemini (not Gemini → OpenRouter)
- `getVisionFallbackCandidates()` now checks only 3 preferred models instead of iterating all provider model lists
- Quick actions switch between document actions and code actions based on attachment presence
- Composer centered within chat column (same max-width as messages)
- Top bar reduced to compact height with cleaner styling

## [0.5.0] - 2025-05-22

### Added
- Chat attachments inside `#/chat` — drag-and-drop or click to attach files
- Text file understanding — attach `.txt`, `.md`, `.json`, `.js`, `.ts`, `.tsx`, `.jsx`, `.css`, `.html` files
- PDF text extraction in browser using pdf.js — extracted text sent as context to AI
- PDF analysis via extracted text context — AI reads and answers questions about PDF content
- Image attachment previews — thumbnails in composer and expanded in chat
- Vision-capable provider routing — images sent to non-vision providers automatically fall back to Gemini, OpenRouter vision models, OpenAI, or Anthropic
- Non-vision providers return instant hint when no vision provider is available
- Files workspace at `#/files` — stand-alone file browser and editor
- Cleaner chat layout — compact message headers, improved attachment display
- Compact attachment UI — file chips with colored extension badges in composer

### Changed
- Version bumped to 0.5.0
- Secret logging hardened — no API key characters printed in logs or diagnostics
- `.gitignore` now covers all `.env.*` patterns and `.envrc`
- Improved attachment size limits: text 500KB, images 5MB, PDF/DOCX 10MB

### Fixed
- Log statements no longer leak partial API key strings
- Gemini error logs no longer print full stack traces
- Doctor diagnostics show only `[configured]` status, never key fragments

## [0.2.0] - 2025-05-18

### Added
- Cloud Free providers: OpenRouter, Groq, DeepSeek
- Three-mode onboarding: Instant Free Cloud AI, Local Free (Ollama), Premium APIs
- Automatic fallback between Cloud Free providers on rate limits
- Smart context builder with project type detection (Next.js, React, Express, Django, etc.)
- Context ranking: relevant files selected per query
- Multi-step agent loop: AI can read, analyze, then edit in one turn
- File search: `/search <pattern>` and `/find <filename>` commands
- Token safety: message truncation when approaching 8K token limit
- Session memory (`~/.hysa/session.json`)
- Git awareness: branch display, dirty state, commit suggestions
- Provider categories with labels (LOCAL FREE / CLOUD FREE / PREMIUM API)
- Rate limit error display with actionable messages

### Changed
- Upgraded from 4 providers to 7 (added OpenRouter, Groq, DeepSeek)
- System prompt now includes project context dynamically
- Improved UI header with git branch and token count
- Configuration default changed to Cloud Free (openrouter)

### Removed
- None

## [0.1.0] - 2025-04-01

### Added
- Initial release
- Providers: Anthropic Claude, OpenAI GPT, Google Gemini, Ollama
- Free local mode with Ollama
- Interactive chat with provider/model switching
- File read/write with diff preview
- Automatic backups before edits
- Safe command execution with approval
- Secret detection
- `.gitignore` respect
- Project tree viewer
