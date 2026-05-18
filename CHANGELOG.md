# Changelog

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
