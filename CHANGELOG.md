# Changelog

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
