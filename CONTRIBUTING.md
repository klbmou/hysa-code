# Contributing to HYSA Code

Thank you for considering contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/hysa/hysa-code.git
cd hysa-code
npm install
npm run build
npm start
```

## Project Structure

```
src/
  index.ts           # Entry point
  cli.ts             # Main CLI and chat loop
  config/            # Configuration types and storage
  ai/                # Provider implementations
  context/           # Project context and ranking
  files/             # File reading and writing
  prompts/           # System prompts
  utils/             # Utilities (git, session, secrets, etc.)
```

## Adding a New Provider

1. Create `src/ai/your-provider.ts` implementing `AIClient`
2. Add provider type to `src/config/keys.ts`
3. Add default model and model list
4. Add provider to `src/ai/client.ts` factory
5. Add UI entry in `src/cli.ts` provider choices

## Code Style

- TypeScript strict mode
- No comments in code (self-documenting)
- ES modules with `.js` extensions in imports
- Follow existing patterns

## Before Submitting

```bash
npm run build
npm run check
```

## Reporting Issues

Use the GitHub issue templates for bugs and feature requests.
