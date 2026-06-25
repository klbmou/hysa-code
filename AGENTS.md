# AGENTS.md — Coding Conventions

## Smoke Test Reliability Rules

### 1. Never rely on CLI commands that may not exist
- Smoke tests call non-existent CLI commands → test the underlying function directly via `tsx`
- Example: instead of `npx tsx src/index.ts route`, import `classifyTask` from `src/ai/task-classifier.ts` and call it
- Check `src/cli.ts` to confirm a CLI command actually exists before using it

### 2. Prefer testing exported functions over CLI output parsing
- Import functions directly: `import { X } from './src/path.js'`
- Parse return values, not stdout strings
- This is faster (no CLI startup overhead) and more precise

### 3. Use `tsx dist/cli.mjs` for running TypeScript
- Node module path: `node ./node_modules/tsx/dist/cli.mjs <file.ts>`
- Works for both `.ts` and `.mjs` files
- Use temp files for inline tests, clean up in `finally` block

### 4. Don't test brittle string counts
- Counting function occurrences in source files breaks when code is refactored
- Instead, test actual behavior: call the function and check the return value
- Source-level checks are OK for "does file X exist" but not for "how many times is Y referenced in file Z"

### 5. Detach long-running background processes
- `Start-Process` creates child processes that get killed when parent PowerShell exits
- Use `cmd /c start "" "program.exe" args` to fully detach
- This is important for 9Router, web servers, and any process started by a smoke

### 6. Smoke tests should run existing unit tests
- The `tests/` directory has 40+ test files covering routing, chat, verification, etc.
- Smokes should delegate to existing unit tests via `run-tests.ps1` or direct `tsx --test` calls
- Don't duplicate test logic in smoke scripts

### 7. Use `-Quiet` and `-Quick` flags for CI mode
- Smokes support `-Quick` to skip slow direct function tests
- Run only the essential checks in quick mode; defer full tests to normal mode

### 8. Follow the pattern: state intent, check result, produce machine-readable output
Each smoke should:
1. Print `"=== smoke:<name> ==="` header
2. For each check: `[OK]` or `[FAIL]` prefix, colored output
3. Print `"=== smoke:<name> PASSED/FAILED ==="` at end
4. Exit with 0 for pass, 1 for fail

### 9. Answers/prompts must not ask user to run tests manually
- Generated code/task answers should never tell the user to manually run `npm test`, `npm run build`, `npx tsc`, or smoke scripts
- If OpenCode has terminal access, it must run verification steps itself
- The answer quality critic (`src/ai/answer-quality.ts`) flags `manual_verification_request` for any prompt suggesting manual test execution

### 10. Destructive actions need explicit approval wording
- Any generated answer suggesting `delete`, `remove`, `rm`, `format`, `shutdown`, or similar destructive actions must also include approval-seeking wording (`shall I`, `do you want me to`, `approve`, `can I`)
- The quality critic flags `unsafe_action_without_approval` when destructive commands lack approval phrasing

### 11. Smoke scripts must be truthful about component vs E2E coverage
- If a smoke tests individual functions/helpers instead of a real E2E flow, its name and documentation must reflect this
- `smoke:hysa-chat` is component-level (tests provider routing helpers + unit tests), not true E2E chat
- `smoke:hysa-chat-e2e` is the true full-stack chat check (starts web server, POSTs to real chat endpoints). Default mode is **deterministic** (uses `HYSA_E2E_TEST_PROVIDER=true`).
- True E2E smokes must be named with `-e2e` suffix

### 12. Destructive tools require approval
- `write_file`, `run_command`, and any tool with risk level `review` or `dangerous` require explicit approval
- Tools must check `ToolRunContext.approved` before executing destructive actions
- `run_command` must use `isDangerousCommand()` to block destructive patterns (rm -rf, format, shutdown, etc.) even with approval
- The `--approve` flag in CLI must never override dangerous command blocking

### 13. Dry-run first for file/command operations
- `write_file` and `run_command` must return proposed action details in dry-run mode without executing
- `write_file` dry-run must include diff output if file exists
- `run_command` dry-run must show the command string, safety classification, and cwd
- Dry-run should be the default; explicit `approved=true` is required for actual execution

### 14. No secrets in action logs
- Action log entries must redact: API keys, tokens, passwords, private keys, credentials
- Input summaries must be truncated to 500 chars max before logging
- Full file contents must never be logged as input summary
- Logging failures must be non-fatal — tool execution continues with warning

### 15. Tools must not escape cwd
- All file path tools must resolve and validate paths against a project root or cwd
- `isWithinCwd()` must be called before any file operation
- Path traversal attempts must return a structured error, not throw
- Binary files must be detected and blocked from `read_file`

### 16. Plan before executing (Agent Planner rule)
- `planToolActionsForTask()` must be called before any tool execution in an agent loop
- The plan must be reviewable and human-readable via `formatPlanForDisplay()`
- Blocked actions must never be executed

### 17. write_file and run_command never auto-approved
- In both tool system and agent planner, write_file and run_command must always require approval
- Their `approvalPolicy` must never be `'auto'` in any context
- `status` must always be `'requires_approval'` in all plans

### 18. Plans must be reviewable and deterministic
- Tool plans must be deterministic (no AI calls during planning)
- Task classification must be pattern-based, not AI-based
- Plans must include per-action risk level, approval policy, status, and reason
- The `--json` flag must produce deterministic output for testing

### 19. E2E smoke tests must use shared server harness
- All future E2E smoke tests that start the HYSA web server must use `scripts/lib/hysa-test-server.ps1`
- Never use `cmd /c start` with detached processes in smoke scripts
- Never duplicate server startup logic inline — dot-source the shared harness instead
- The shared harness provides:
  - Managed process (not detached) with PID tracking
  - stdout/stderr log capture to `%TEMP%\hysa-test-server\`
  - Readiness polling on `GET /api/status` with timeout
  - `Write-HysaServerDiagnostics` for failure diagnostics
  - `Stop-HysaTestServer` in `finally` block for cleanup

### 20. No silent server startup failures without diagnostics
- Every smoke script that starts the HYSA web server must call `Write-HysaServerDiagnostics` on startup failure
- Must print: command, cwd, port, readiness URL, process ID, exit code, last stdout/stderr lines
- Use the shared harness functions instead of ad-hoc diagnostics

### 21. Long provider-dependent smokes need -Quick mode
- Smokes that make live provider calls (9Router probes, Arabic chat) must support `-Quick` flag
- Quick mode: run essential deterministic checks only, skip slow provider-dependent probes
- Full mode: run all checks including provider probes
- Package scripts must provide both: `smoke:<name>` (full) and `smoke:<name>:quick` (quick)
- CI should use `:quick` variants for provider-dependent smokes

### 22. Every network/local service wait must have timeout
- No `while ($true)` loops without a max iteration count or time budget
- Every `Invoke-RestMethod`/`Invoke-WebRequest` must include `-TimeoutSec`
- Every `tsx --test` call must have a timeout wrapper (via `scripts/lib/tsx-runner.ps1`)
- Every server readiness poll must have a configurable timeout
- On timeout, the error must report: which step timed out, what was being waited for, how long waited

### 23. E2E smoke script semantics
- `smoke:hysa-chat-e2e` — **Default: deterministic.** REQUIRED for CI gate. Uses `HYSA_E2E_TEST_PROVIDER=true`. Tests real `/api/chat` + `/api/chat/stream` paths, sessionId, answerQuality, Arabic routing. Passes reliably every time with zero external provider calls.
- `smoke:hysa-chat-e2e:deterministic` — Same as default (alias).
- `smoke:hysa-chat-e2e:live` — Live-provider mode. English + Arabic + streaming. Rate-limited responses show `[RATE_LIMIT]` (yellow warning), not `[FAIL]`.
- `smoke:hysa-chat-e2e:live:quick` — Live-provider quick mode. English chat only, skips Arabic + streaming.
- `smoke:hysa-chat-e2e:live:required` — Live-provider mode that treats rate_limit as `[FAIL]`. Use this to require a working live provider.
- Deterministic E2E is the REQUIRED CI gate. Live provider smokes are provider-dependent.

### 24. 9Router smoke must handle rate limits gracefully
- When all probe models return `429 Too Many Requests`, report clearly: "All N models rate-limited"
- Do not hang waiting for rate limits to expire
- In Quick mode, probe at most 3 models
- Always report: URL, model count, models tried, status per model, total duration

### 25. Deterministic test provider safety rules
- `HYSA_E2E_TEST_PROVIDER=true` activates `src/ai/test-client.ts` which returns deterministic responses ("OK", Arabic "حسنًا")
- The test client intercepts in `createClient()` BEFORE any provider routing (smart router, fallback chain)
- Never activates in normal production — only when the env var is explicitly set
- No API keys, no network calls, no external dependencies
- The test provider is NOT in the `ProviderType` union — it cannot be selected by config or smart routing
- All `/api/chat` paths (streaming, non-streaming, continueChat, vision fallback) are covered

### 26. Live provider E2E rate_limit reporting (scripts/smoke-hysa-chat-e2e.ps1)
- Default (no `-TreatRateLimitAsWarning`): rate-limited responses are `[FAIL]` — used by `smoke:hysa-chat-e2e:live:required`
- With `-TreatRateLimitAsWarning`: rate-limited responses are `[RATE_LIMIT]` (yellow warning), not `[FAIL]` — used by `smoke:hysa-chat-e2e:live`
- Rate_limit detection: response has a message but no `answerQuality` field AND message contains "rate limit", "busy", "unavailable", "cooldown", "all free", or "timed out"

### 27. Memory-Aware Planning Architecture

#### 27.1 Memory Context Layer (`src/agent/memory-context.ts`)
- `getMemoryContextForTask({ task, taskKind? })` returns `MemoryContextResult` with:
  - `recentMemories`, `relevantMemories`, `projectFacts`, `summary`
  - `memoryUsed: boolean` and `memoryHits: number`
  - `relevantFiles: string[]` — file paths extracted from memory items
- Deterministic — no AI calls, wraps existing `selectContext()` from brain/context-selector
- Safe when memory unavailable (returns empty result, never throws)

#### 27.2 Memory-Aware Planner (`planToolActionsForTask`)
- Accepts optional `memoryContext` parameter
- Plan output includes: `memoryUsed`, `memoryHits`, `memoryReasoning` fields
- Memory-implied files replace generic `list_files` fallback when no user-specified files exist
- User-specified files always take priority over memory-implied files
- `memoryReasoning` provides deterministic explanation (e.g., "Memory shows recent work in: src/web/api.ts")
- All existing approval guarantees maintained — memory only influences file prioritization

#### 27.3 Memory Flow
```
User Request → getMemoryContextForTask() → MemoryContextResult
                                               ↓
planToolActionsForTask({ userText, memoryContext }) → AgentToolPlan
                                               ↓
                          memoryUsed, memoryHits, memoryReasoning in plan
                                               ↓
                          Multi-step agent propagates memory metadata to result
```

#### 27.4 Testing
- `tests/memory-context.test.ts` — 10 tests covering empty, shape, Arabic, deterministic, error handling
- `tests/memory-aware-planner.test.ts` — 15 tests covering backward compat, metadata, prioritization, deterministic, path traversal filtering
- `scripts/smoke-memory-aware-agent.ps1` — 6 checks (unit tests, metadata, prioritization, deterministic, multi-step integration, package)

### 28. Web Approval UI — no tool executes without user approval
- `POST /api/agent/plan-tools` returns a deterministic plan (pattern-based, no AI calls)
- `POST /api/agent/execute-tools` only executes actions whose IDs are in `approvedActionIds`
- The server stores the original plan in a `Map<string, AgentToolPlan>` — the client cannot mutate toolName, input, or parameters
- Blocked actions (dangerous commands) never execute, even if the client includes their IDs in `approvedActionIds`
- `write_file` and `run_command` always have `approvalPolicy: 'requires_approval'` and `status: 'requires_approval'` in every plan
- Plan-tools is called automatically after every AI response, but only displays the plan panel — never auto-executes
- Auto-continue after execution is only triggered when the user clicks "Execute Approved Actions" in the ToolPlanPanel
