# HYSA Code Provider/Fallback Diagnostic Report

## Executive Summary

HYSA Code has a sophisticated multi-provider architecture supporting 13 AI providers across 4 tiers. The core issue is not a single bug but a **combination of timing, context overhead, and error-handling gaps** that manifest as:

1. **Slow responses** — the CLI sends a large system prompt (full tool documentation + project context) on every request; multi-step tool loops (up to 5 steps) compound latency.
2. **Confusing fallback** — fallbacks take 30s+ per attempt, retries add exponential backoff, and the total timeout budget is 90s; users see providers switching without clear explanation.
3. **Local provider slowdown** — when using Ollama/HYSA AI inside HYSA Code, the prompt is much larger than a direct `ollama run` test; there is no streaming, so the entire response must be generated before anything is displayed.
4. **Empty responses** — recently fixed in `client.ts:324-329` by treating emptiness as a failure, but experimental providers (Pollinations, LLM7) may still return empty responses that trigger fallback chains.
5. **No streaming** — all providers wait for the full response, adding perceived latency especially on weaker models.

---

## Current Architecture

```
User Input
  → CLI (cli.ts) or Web UI (App.tsx)
  → createClient() (client.ts:537)
    → applyGreetingGuard() checks for casual messages
    → createFallbackClient() wraps provider with retry+fallback
      → tryProvider() per attempt
        → client.sendMessage() on specific provider (openai-compatible.ts, gemini.ts, ollama.ts, etc.)
        → extractContentFromResponse() normalizes the raw API response
        → parseToolCalls() extracts tool usage from model output
      → markHealth() records success/failure
      → fallback chain if result is null
  → Tool execution in handleToolCall()
  → Multi-step loop (up to 5 iterations)
  → Response displayed to user
```

**Key entry points:**
- CLI: `chatLoop()` in `cli.ts:740` — manages conversation, multi-step tool loops, retry logic
- Web: `handleChat()` in `web/api.ts:108` — single-shot request/response
- Fallback: `createFallbackClient()` in `client.ts:274` — retry + model fallback + provider fallback

---

## Provider Selection Flow

### Where is the current provider selected from?

**`src/config/keys.ts:15-16`** — `HysaConfig.currentProvider` and `HysaConfig.currentModel` are read from `~/.hysa/config.json` via `loadConfig()`.

### Where is the current model selected from?

Same config file. Defaults per provider are in `PROVIDER_DEFAULTS` (`keys.ts:64-78`), e.g., `openrouter: { model: 'qwen/qwen3-coder:free' }`.

### Does the system rely only on config?

Yes — `createClient()` (`client.ts:537`) reads `config.currentProvider` and `config.currentModel` directly. There is no runtime model discovery (except OpenRouter's `/models` command for display only). The `/model` CLI command (`cli.ts:894`) updates config and recreates the entire client.

### Is there automatic fallback?

Yes — but only for `free_api` and `premium_api` tiers (via `createFallbackClient()` at `client.ts:545-546`). For `local_free`, fallback wrapping is conditional on `lightMode`:
- If `lightMode === true` (default for local): **no fallback** (`client.ts:558-559`).
- If `lightMode === false`: fallback wrapping is applied (`client.ts:563`).

This means **local providers in default light mode have NO fallback support** — a failure immediately throws.

### Does model-health affect provider/model choice?

Yes — `shouldSkipProvider()` (`client.ts:172-177`) checks both:
1. `isSkippedForRequest()` — providers that already failed during this request
2. `isUnhealthy()` — providers marked unhealthy in `model-health.ts`

A provider with `failedCount >= 2` is auto-skipped for the rest of the session (`model-health.ts:81-86`).

---

## Fallback Flow

### When does fallback start?

Fallback starts after the primary provider fails (returns `null` from `tryProvider()`). This happens when:
1. All retries (max 2) are exhausted and the error is non-retryable, OR
2. A retryable error still fails after 3 attempts (original + 2 retries)

The flow order is (`client.ts:369-454`):
1. **Primary attempt** — try current provider + model with 45s timeout
2. **Model fallback (OpenRouter only)** — try alternative OpenRouter models with 30s timeout each
3. **Provider fallback** — iterate through `getFallbackCandidates()` with 30s timeout each, max 3 providers

### Which errors trigger fallback?

`isRetryableError()` (`client.ts:86-89`) categorizes these as retryable:
- `rate_limit` — triggers retry with exponential backoff, then fallback
- `timeout` — triggers retry, then fallback
- `network` — triggers retry, then fallback
- `model_unavailable` — triggers retry, then fallback
- `quota` — triggers retry, then fallback

`unknown` category errors (including empty responses, invalid API keys, 404s) do NOT retry — they immediately return `null`, triggering the fallback chain.

### Does an empty response trigger fallback?

**Yes, as of the recent fix** at `client.ts:324-329`. Empty/whitespace messages with no toolCalls throw an error that is caught, marked unhealthy, and falls through to the next provider. For experimental providers (Pollinations, LLM7, Puter), an additional warning "Experimental providers are not guaranteed stable." is appended.

### Does timeout trigger fallback?

Yes — timeout errors (categorized as `'timeout'`) are retryable, get up to 2 retries with backoff (1s, 2s, max 4s), then fallback.

### Does rate limit trigger fallback?

Yes — same as timeout: retry with backoff, then fallback.

### Does network error trigger fallback?

Yes — same pattern.

### What is the actual fallback order in code?

Defined in `getFallbackCandidates()` (`client.ts:99-168`), depending on the primary provider's tier:

**Free API tier** (`free_api`):
1. `openrouter/qwen/qwen3-coder:free`
2. `openrouter/deepseek/deepseek-chat:free`
3. `openrouter/openai/gpt-oss-120b:free`
4. `gemini` (if not current)
5. `deepseek` (if not current)
6. `opencode_zen` (if not current)
7. `groq` (if not current)
8. `pollinations` (only if `allowExperimentalProviders`)

**Local free tier** (`local_free`):
1. `hysa_ai`
2. `ollama`
3. `local_openai`
4. Free API providers (only if their API keys exist)

**Premium tier** (`premium_api`):
1. Other premium providers
2. `openrouter/qwen/qwen3-coder:free` (if key exists)
3. `gemini` (if key exists)

**Experimental tier** (`experimental_free`):
1. Other experimental providers
2. Free API providers (if keys exist)

### Is the fallback order logical?

**Mostly yes**, with one concern:
- The free API tier lists `openrouter` with 3 specific models first, then `gemini`, `deepseek`, `opencode_zen`, `groq`. This makes sense because OpenRouter has many free models.
- Experimental providers are last in the chain, which is correct.
- Local providers fall back to each other first, then cloud APIs — logical.

**Risk**: The fallback chain can be long (up to 8 candidates), each taking 30s timeout (FALLBACK_ATTEMPT_TIMEOUT_MS). With retries (2 per provider), a full chain exhaust could take 8 × 30s × 3 = **720s** if every provider hits timeout. The `MAX_TOTAL_TIME_MS = 90000` (90s) cap prevents this, cutting off after 90s total regardless of remaining candidates.

### Is there any risk of loops or unnecessary retries?

Yes — potential issues:
1. **`unknown` errors don't retry but trigger fallback** — a transient error like a malformed response immediately falls through instead of retrying on the same provider.
2. **Empty response throws are categorized as 'unknown'** — no retry on the same provider. This is the correct behavior (retrying an empty-response provider won't help), but it means fallback triggers faster for empty responses than for timeouts.
3. **The retry backoff delays are 1s, 2s, max 4s** — these are reasonable but cumulative: 3 attempts = up to 7s delay + API call time per provider.

---

## Slow Request Causes

### Is the system sending too much context?

**Yes, especially in non-light mode.**

The full system prompt (`buildSystemPrompt()` in `system.ts:46-202`) is **~200 lines** including:
- Full project context (type, entry points, config files, file count)
- Complete tool documentation with 8 tool examples in XML format
- Multi-step reasoning instructions
- Greeting guard instructions
- Edit planning instructions
- 15 rules

Estimated token count: **~1500-2000 tokens** for the system prompt alone.

### How many files are included in context?

In non-light mode (`cli.ts:1576-1607`):
- `rankFiles()` selects up to **5 relevant files** from `importantFiles`
- `rankFiles()` also selects up to **8 files** from the full file tree (filtered by score > 5)
- Each file is read and included up to **3000 characters** each
- For small projects (≤2 files), entry points are also included

This can add **5000-24000 characters** (~1250-6000 tokens) of file context per request.

### Is the full project context sent on every request?

**The system prompt regenerates on `/model` and `/mode` changes but is fixed between them.** However, file context is rebuilt per request:
- Tree is included in the system prompt (truncated to 3000 chars, `cli.ts:809`)
- Ranked files are re-read and included in the user message per request (`cli.ts:1577-1607`)

### Is token counting implemented?

Yes — `estimateTokens()` in `tokens.ts:4` uses a simple `text.length / 4` heuristic. This is **rough** (does not account for subword tokenization) but functional.

### Is truncation implemented?

Yes — `truncateMessages()` in `tokens.ts:24-56`:
1. Removes oldest messages until under the limit
2. Falls back to truncating the oldest remaining message content

Limits:
- Light mode: 2000 tokens (`cli.ts:1569`)
- Normal mode: 8000 tokens (`tokens.ts:1`)
- Web API: 2000/8000 depending on light mode (`web/api.ts:145`)

**Risk**: The truncation removes entire messages from the middle of history, which may break conversation coherence.

### Are there multi-step loops that make requests slower?

**Yes — this is a major source of perceived slowness.**

`chatLoop()` (`cli.ts:1644`) has a `MAX_STEPS = 5` loop (2 in light mode). For each step:
1. Provider is called (potentially with fallback chains)
2. Tool calls are parsed and executed sequentially (file reads, edits, commands)
3. Results are appended to messages
4. Next step begins

Each provider call in the loop sends the **full accumulated history**, growing larger with each step. A 5-step interaction could result in **5 separate provider calls**, each potentially triggering its own fallback chain.

### Does fallback wait too long before moving to the next provider?

**Yes — the 30s per fallback attempt is aggressive.**

- Primary: `CHAT_TIMEOUT_MS = 45000` (45s)
- Fallback: `FALLBACK_ATTEMPT_TIMEOUT_MS = 30000` (30s)
- Each fallback includes up to 2 retries (with backoff delays)

So a single fallback candidate takes up to **30s + (1+2+max4=7s delays) = ~37s** before the next candidate is tried. With `MAX_FALLBACK_ATTEMPTS = 3` and `MAX_TOTAL_TIME_MS = 90000`, the total wait before "all providers failed" is **90s**.

For end users, 30s of silence followed by switching providers is confusing — the UI shows no progress during this time.

---

## Local Provider Issues

### Does HYSA send a much larger prompt than direct local tests?

**Yes — significantly.**

Direct Ollama test (`cli.py` / `ollama run qwen2.5-coder`):
- System: ~50 tokens (default Ollama system)
- User: "say hi" (2 tokens)
- **Total: ~52 tokens**

HYSA Code via Ollama:
- System: ~1500-2000 tokens (full tool docs + project context + rules)
- History: depends on conversation length
- File context: 0-6000 tokens depending on mode
- **Total: 1500-8000+ tokens**

This is **30-150x larger** than a direct test, which explains why local models (1.5B-7B) are slow.

### Is the system prompt too long?

**Yes — the full system prompt is ~200 lines** with verbose XML tool examples. Light mode's `buildLightSystemPrompt()` is much shorter (~40 lines) but is only the default for local providers.

### Are tool instructions too long?

**Yes — the non-light system prompt includes 8 tool examples** with full XML markup, rules, multi-step reasoning guides, and edit planning instructions. This could be shortened by 50-70% without losing clarity.

### Are too many files included?

**In non-light mode, yes.** `rankFiles()` reads and sends up to 5 files, each up to 3000 characters, on every request. For local models, this is wasteful — most single-turn requests don't need 5 files of context.

### Does HYSA use streaming or wait for the full response?

**HYSA waits for the full response.** None of the client implementations use streaming (`stream: false` in ollama.ts:33). All providers generate the complete response before anything is displayed to the user.

### Are timeouts too large?

For local providers: **yes, 45s is too long.** If Ollama is responding in 2-5s directly, the 45s timeout means the system will wait 45s before declaring failure. But since the empty response fix treats `result.message.trim()` emptiness as a failure, a model that responds but with empty content will fail instantly — however, if the model takes 20s to respond with content, that's just slow.

The real issue: **no progress indicator per provider** — the CLI shows "Thinking..." for the entire duration across retries and fallbacks.

### Is the local model receiving the OpenAI-compatible format correctly?

**Ollama** (`ollama.ts:19-56`) uses Ollama's native API format (`/api/chat`), which is correct. The `stream: false` option ensures complete responses.

**HYSA AI** (`hysa-ai.ts:4-6`) delegates to `createOpenAICompatibleClient()` which uses the OpenAI SDK. For HYSA AI running on `localhost:3002/v1`, this sends a standard OpenAI-format request.

Both should work correctly, but the prompt size is the bottleneck.

### Can the tool-call format cause weird or slow responses?

**Yes.** The system prompt tells models to use XML tool format (`<tool_call><tool_name>...</tool_name>...`), but small local models (1.5B-7B) may:
1. Not follow the XML format correctly
2. Output tool calls in plain text instead
3. Refuse to use tools at all
4. Hallucinate tool calls with wrong parameters

The parser (`parseToolCalls()` in `tools.ts:298-316`) tries **6 different formats**, but still fails if the model outputs completely unstructured text. When parsing fails, the system logs a warning (`cli.ts:1787-1788`) but the response is still displayed as-is.

---

## Tool Calling Issues

### Do all providers support tool calls?

**No — tool support depends on the model and provider:**
- OpenRouter models: varies by model, some (especially free/community) don't support XML tool formats
- Gemini: supported via the Gemini SDK native format, but HYSA uses text-based XML extraction instead
- Ollama models: small models (1.5B-3B) often fail to use tools correctly
- Experimental providers (Pollinations, LLM7, Puter): inconsistent tool support
- Premium providers (Claude, GPT): best tool support

### Do some providers fail to understand the tool format?

**Yes — especially small local models** (hysa-coder-lite uses qwen2.5-coder:1.5b). The XML tool format requires specific output formatting that small models struggle with.

### Does the parser accept many formats?

**Yes — `parseToolCalls()` (`tools.ts:298-316`) tries 6 formats:**
1. `parseArgumentFormat()` — `<tool_call><tool_name>...</tool_name><arguments>{...}</arguments>`
2. `parseXmlFormat()` — `<tool_call><tool_name>...</tool_name>{...}</tool_call>`
3. `parseAngleBracketFormat()` — `<|tool_call_start|>[name(...)]<|tool_call_end|>`
4. `parseToolNameFormat()` — bare `<tool_name>...</tool_name>` + JSON
5. `parseFunctionStyleFormat()` — `name(key="value", ...)`
6. `parseJsonFormat()` — `{"type": "name", ...}`

### Can the parser cause duplicates or misinterpretation?

**Yes — deduplication happens at `tools.ts:309-315`** by `type + JSON.stringify(params)`. This can cause:
- Legitimate duplicate tool calls to be silently dropped
- Param ordering differences to create false positives/negatives
- Nested JSON params to be incorrectly compared

### Does the system prompt clearly ask models to use tools?

**Yes — the system prompt has extensive tool documentation** with multiple examples, rules, and warnings about using `read_file` before `edit_file`.

### Should weak tool providers be avoided for file-editing tasks?

**Yes — local 1.5B models and experimental providers should be flagged** for tool-heavy tasks. The system shows a warning for `hysa-coder-lite` at `cli.ts:354-357` ("may be weaker at tool use") but does not restrict tool usage.

---

## Web Chat Issues

### Does the frontend handle all response shapes?

**Yes — `getAssistantText()` (`App.tsx:18-20`) tries 5 fields:**
- `data.message`, `data.response`, `data.content`, `data.text`, `data.assistantMessage`

The backend always returns `{ message, toolCalls, error?, fallbackEvents? }`.

### Does the backend always return JSON?

**Yes — `handleChat()` (`web/api.ts:108-188`) always returns `ChatResult` as JSON.** Errors are caught and returned as structured `{ message: '', toolCalls: [], error: '...' }`.

### Are fallbackEvents displayed in the UI?

**Yes — `App.tsx:318-323`** renders `data.fallbackEvents` as `tool_event` items with `eventType: 'fallback'`.

### Are errors displayed clearly?

**Reasonably.** Error categories are detected in `App.tsx:290-303`:
- Rate limit → "Provider is rate-limited"
- Timeout → "Provider timed out"
- Fallback/unavailable → "All providers failed"
- Generic → displays raw error message

### Does debug mode work?

**Yes — both CLI debug (`/debug on`)** and Web debug toggle (`App.tsx:199-207`) work. The Web UI shows raw API responses in a debug panel (`App.tsx:483-491`).

### Are there cases where the backend responds but the message does not render?

**Yes — `App.tsx:310-313`** checks `if (!assistantText && !hasToolCalls)` and shows an error instead of rendering. This is a safety guard: if the backend returns `{ message: '', toolCalls: [] }`, the UI shows "HYSA returned an empty response" rather than rendering nothing.

This now properly catches empty responses that the server-side empty-response fix should have caught, but serves as a double safety net.

---

## Health/Usage Telemetry

### Is last request duration recorded correctly?

**Partially.** `recordRequest()` (`session.ts:160-167`) records `totalRequests++` but only for successful requests (called at `client.ts:332`). Duration is recorded in `markHealth()` for individual providers (`model-health.ts:89` stores `totalResponseTimeMs` and `averageResponseTimeMs`).

### Is last error recorded correctly?

**Yes — `recordError()` (`session.ts:169-176`)** stores the error message, provider, and model. `markHealth()` with `status: 'unhealthy'` also updates `lastError` (`model-health.ts:79`).

**Issue**: `recordError()` is called inside the catch block (`client.ts:343`), which fires even for retried errors. A provider that fails 3 times (original + 2 retries) records 3 errors.

### Is request count recorded correctly?

**Partially.** `totalRequests` increments for every successful response. But failures are tracked separately in `totalErrors`. The ratio should give a reliability picture, but the request count doesn't track which provider succeeded.

### Does fallback status show useful information?

**Yes — `/fallback status` in CLI** (`cli.ts:943-964`) and `getFallbackStatus()` in the web API (`web/api.ts:224-232`) show:
- Unhealthy providers (from `toHealthSummary()`)
- Last error (provider, model, reason)
- Last fallback used

### Does /usage show accurate information or is it incomplete?

**Partially.** `/usage` (`cli.ts:1041-1065`) shows:
- Current provider + model
- Context token estimate (from conversation history)
- Last error (from `getLastError()`)
- Last fallback (from `getLastFallbackUsed()`)

**Missing**: total requests, total errors, request duration, provider-specific stats — these are stored in `session.ts` but not displayed in the CLI `/usage` output. They're only shown in the separate `hysa usage` command.

---

## Provider Classification

| Provider | PROVIDER_TIERS | Correct? |
|----------|---------------|----------|
| anthropic | premium_api | Yes |
| openai | premium_api | Yes |
| gemini | free_api | Yes |
| ollama | local_free | Yes |
| openrouter | free_api | Yes |
| groq | free_api | Yes |
| deepseek | free_api | Yes |
| local_openai | local_free | Yes |
| opencode_zen | free_api | Yes |
| pollinations | experimental_free | Yes |
| llm7 | experimental_free | Yes |
| puter | experimental_free | Yes |
| hysa_ai | local_free | Yes |

Note the dual classification system: `PROVIDER_CATEGORIES` uses `cloud_free` / `experimental_free` while `PROVIDER_TIERS` uses `free_api` / `experimental_free`. These overlap but are not identical (e.g., `gemini` is `cloud_free` category but `free_api` tier).

**Experimental providers show warnings** — confirmed at `cli.ts:360-371` and configuration menus.

**Local providers are checked before use** — `checkOllama()` and `checkLocalOpenAI()` exist in `doctor.ts`.

**Providers requiring keys but missing are properly skipped** — `tryCreateClient()` returns `null` and `getFallbackCandidates()` only adds providers with existing keys for non-local tiers.

**Local providers are NOT checked for server availability before use** — `tryCreateClient()` succeeds even if the server is not running (it just creates an HTTP client), and the 45s timeout is the only guard. The `/latency` command (`cli.ts:1371-1446`) provides a manual test.

---

## Top 10 Problems Ranked

| Priority | Problem | Likely Cause | File/Function | Impact | Suggested Fix |
|----------|---------|-------------|---------------|--------|---------------|
| 1 | **No streaming** | All providers use non-streaming mode | All provider files (`ollama.ts:33`, `openai-compatible.ts:37-47`, etc.) | Perceived latency: users wait for entire response | Add streaming support with progressive rendering in CLI/Web UI |
| 2 | **System prompt is too large** | Full tool docs + rules + project context sent every time | `system.ts:46-202` | 1500-2000 tokens overhead before any user content | Reduce tool examples, shorten rules, move project tree to dynamic message |
| 3 | **Multi-step loop sends full history each time** | 5-step max, each step sends growing history | `cli.ts:1644-1835` | Compound latency: 5 provider calls instead of 1 | Reduce max steps to 3, or make step count user-configurable |
| 4 | **Fallback timeout budget is opaque** | 90s total with 30s per attempt, no progress to user | `client.ts:18-21` | Users see "Thinking..." for 90s without explanation | Add "Trying provider X... failed, trying Y..." status messages to CLI |
| 5 | **Token estimation is rough** | `text.length / 4` heuristic | `tokens.ts:4` | Over/under-estimation can cause premature truncation | Use a proper tokenizer or per-model token limits |
| 6 | **Web UI has no cancellation feedback** | Abort works but user sees no intermediate status | `App.tsx:236-247` | Users can cancel but don't know which provider is being tried | Show provider name in thinking bar |
| 7 | **Experimental providers can trigger long fallback chains** | Pollinations/LLM7 often return empty responses | `client.ts:324-329` | Users experience 30s+ delays before fallback kicks in | Reduce FALLBACK_ATTEMPT_TIMEOUT_MS to 15s for experimental providers |
| 8 | **Local providers have no pre-flight check** | Client created even if server is down | `client.ts:206-212` | 45s timeout before user knows server is not running | Add connectivity check in `tryCreateClient()` for local providers |
| 9 | **Tool call deduplication can drop legitimate calls** | JSON.stringify params comparison | `tools.ts:309-315` | Legitimate duplicate tool calls are silently ignored | Compare by structured hash instead of JSON string |
| 10 | **Usage telemetry is incomplete** | Request count doesn't track provider-level stats | `session.ts:160-176` | Can't identify which providers are unreliable | Track per-provider request/error counts |

---

## Full Request Flow Map

```
User sends message
  │
  ├─ CLI: chatLoop() [cli.ts:740]
  │   │
  │   ├─ Pre-checks:
  │   │   ├─ Greeting guard → casual response (skip AI)
  │   │   ├─ Built-in commands (/help, /model, etc.)
  │   │   └─ Pending edit detection
  │   │
  │   ├─ Context Building [cli.ts:1560-1615]:
  │   │   ├─ Light mode: truncateMessages to 2000 tokens
  │   │   └─ Full mode: rankFiles(5) → readFile() → append to userMessage
  │   │
  │   ├─ createClient() [client.ts:537]:
  │   │   ├─ clearRequestSkips() + clearFallbackEvents()
  │   │   ├─ applyGreetingGuard() wrapping
  │   │   └─ createFallbackClient() or createSingleClient()
  │   │
  │   ├─ Multi-step loop (max 5/2 steps) [cli.ts:1649]:
  │   │   │
  │   │   ├─ sendMessage() [fallback client]:
  │   │   │   ├─ tryProvider(primary, 45s):
  │   │   │   │   ├─ shouldSkipProvider() check
  │   │   │   │   ├─ tryCreateClient() → createSingleClient()
  │   │   │   │   ├─ AbortController with 45s timeout
  │   │   │   │   ├─ client.sendMessage():
  │   │   │   │   │   ├─ openai-compatible.ts: OpenAI SDK call
  │   │   │   │   │   ├─ gemini.ts: Gemini SDK call
  │   │   │   │   │   ├─ ollama.ts: /api/chat POST
  │   │   │   │   │   └─ etc.
  │   │   │   │   ├─ empty response check [client.ts:324]
  │   │   │   │   ├─ markHealth(success/failure)
  │   │   │   │   ├─ recordRequest() / recordError()
  │   │   │   │   └─ Return result or null (on failure)
  │   │   │   │
  │   │   │   ├─ Model fallback (OpenRouter only):
  │   │   │   │   └─ tryProvider(altModel, 30s) for each model
  │   │   │   │
  │   │   │   └─ Provider fallback:
  │   │   │       ├─ getFallbackCandidates() → ordered list
  │   │   │       └─ tryProvider(candidate, 30s) max 3 times
  │   │   │
  │   │   ├─ parseToolCalls() [tools.ts:298]:
  │   │   │   └─ Tries 6 formats → deduplicates
  │   │   │
  │   │   ├─ If toolCalls exist:
  │   │   │   ├─ handleToolCall() per tool
  │   │   │   ├─ Tool results appended to messages
  │   │   │   └─ Continue loop for next step
  │   │   │
  │   │   └─ If no toolCalls:
  │   │       ├─ Display response
  │   │       ├─ Pending edit detection
  │   │       └─ Break loop
  │   │
  │   └─ Display context estimate
  │
  └─ Web UI: handleChat() [web/api.ts:108]:
      ├─ Greeting guard check
      ├─ createClient() + buildSystemPrompt()
      ├─ truncateMessages()
      ├─ client.sendMessage() (same fallback chain as CLI)
      ├─ getFallbackEvents() → add to response
      └─ Return ChatResult JSON
```

---

## Recommended Fix Plan

### Phase 1: Fix Silent Failures and Empty Responses

**Problem**: Empty responses still reach the Web UI in edge cases; experimental provider failures are confusing.

**Files likely to change**:
- `client.ts` — already fixed (empty response check at line 324)
- No further changes needed — verify the fix works

**Risks**: Low — the change is already applied

**How to test**:
```
npm run build
npm run build:web
```

**What not to touch**: Provider implementations, fallback order, model-health

**Status**: ✅ Already completed

---

### Phase 2: Reduce Slowness

**Problem**: Large system prompt, no streaming, multi-step loops, verbose tool docs.

**Files likely to change**:
- `prompts/system.ts` — shorten tool examples (use 2-3 examples instead of 8, shorter rules)
- `cli.ts` — reduce `MAX_STEPS` from 5 to 3 (line 1644)
- `context/tokens.ts` — improve token estimation (at least account for subword patterns)
- All provider files — add streaming support (complex change)

**Risks**: Medium — shortening prompts may cause weaker tool adherence from small models

**How to test**:
```
hysa chat --debug  (compare prompt sizes before/after)
npm run build && npm run check
```

**What not to touch**: Fallback logic, provider creation, model-health

---

### Phase 3: Improve Local Providers

**Problem**: Local models receive huge prompts, no pre-flight check, slow without streaming.

**Files likely to change**:
- `client.ts` — add `tryCreateClient()` connectivity check for local providers (ping `/api/tags` or `/models` before wrapping)
- `cli.ts` — show "Testing local server..." message before first request
- `prompts/system.ts` — further shorten light mode prompt (remove less-used tools)
- `context/builder.ts` — reduce file count in `importantFiles` for local providers

**Risks**: Low — changes are additive (pre-flight checks) or reductive (shorter prompts)

**How to test**:
```
hysa doctor --provider ollama
hysa doctor --provider hysa-ai
hysa chat  (test with local provider)
```

**What not to touch**: Cloud provider implementations, fallback order

---

### Phase 4: Improve Smart Fallback

**Problem**: Fallback is opaque, too slow per attempt, and doesn't handle experimental providers well.

**Files likely to change**:
- `client.ts`:
  - Reduce `FALLBACK_ATTEMPT_TIMEOUT_MS` to 15000 (15s) for experimental/weaker providers
  - Add progress logging to CLI during fallback ("Trying X... failed, trying Y...")
  - Add provider name to the "Thinking..." message
- `web/api.ts` — include current fallback status in ChatResult (already partially done)
- `web/src/App.tsx` — show provider name in thinking bar

**Risks**: Medium — changing timeouts may cause legitimate providers to be skipped too early

**How to test**:
```
hysa chat --debug  (force a fallback by using a failing provider)
hysa fallback status
```

**What not to touch**: Provider health marking, request recording

---

### Phase 5: Improve Tool-Use Compatibility

**Problem**: Weak models don't understand XML tool format; parser drops legitimate calls.

**Files likely to change**:
- `ai/tools.ts` — improve deduplication (compare structured params instead of JSON string)
- `prompts/system.ts` — keep only the primary XML format in non-light mode, remove 5 alternative formats to reduce confusion
- `cli.ts` — add tool-use quality warning per provider (e.g., "This provider may not support tool calls well")

**Risks**: Medium — changing format instructions may cause model confusion during transition

**How to test**:
```
hysa chat  (ask model to read a file, verify tool call)
npm run build && npm run check
```

**What not to touch**: Provider creation, fallback logic, session/telemetry

---

## Tests To Run

```bash
# TypeScript compilation
npm run build
npm run check

# Web build
npm run build:web

# CLI diagnostics
hysa usage
hysa fallback status
hysa doctor --provider openrouter
hysa doctor --provider ollama
hysa doctor --provider hysa-ai
hysa doctor

# Latency test
hysa chat
  /latency  (for local providers)

# Health test
hysa chat
  /health
  /fallback test
```
