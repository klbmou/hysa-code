# HYSA Code v0.6.0 — Brain & Session Stable

> **Phase 3A–3I release:** Persistent project memory, memory quality/cleanup,
> smart context injection, and session tracking.

---

## New Features

### Persistent Project Memory (3A–3B)
- **Experience graph** — `.hysa/brain/experience-graph.json` stores decisions,
  lessons, provider events, and session outcomes with importance/confidence scoring
- **Auto-learning** — decisions, fixes, and provider successes/failures are
  automatically written to the graph
- **Dual storage** — graph file for structured querying + markdown files
  (`lessons.md`, `decisions.md`) for human reading
- **Secret redaction** — API keys, tokens, and secrets are detected before
  any memory write

### Memory Quality & Cleanup (3C–3E)
- **Importance/confidence scoring** — each memory node scored 0–100 based on
  kind and source; higher scores = more relevant context
- **Fuzzy deduplication** — Jaccard similarity on word sets (threshold >0.4)
  detects and merges duplicate labels
- **Label normalization** — lowercase, strip punctuation, collapse whitespace
- **Cleanup command** — `hysa brain cleanup --apply` prunes low-importance
  events (>30d, importance <30) and merges duplicate provider events
- **Inspect command** — `hysa brain inspect` reports node counts by kind,
  duplicate groups, stale events, top decisions/lessons, recent provider events
- **Edit commands** — `hysa brain forget`, `hysa brain merge`, `hysa brain pin`
- **Safety** — pinned nodes are never deleted; cleanup defaults to dry-run

### Smart Context Injection (3F)
- **Relevance ranking** — each memory scored by keyword relevance (0.4),
  importance (0.25), confidence (0.2), and recency (0.15)
- **Task-complexity budgets** — simple chat: 800 chars, code: 2000,
  planning: 3000, provider query: 1500
- **Smart filtering** — provider-only tasks include only provider events;
  code tasks skip generic events; pinned memories always preserved
- **Debug mode** — `--debug-timing` shows per-item score breakdown and
  skipped reasons

### Session Tracking (3I)
- **Activity recorder** — commands, file reads/edits, tool usage, errors,
  auto-fix attempts, provider fallbacks, memory injections
- **Summary generator** — `hysa session summary` shows duration, status,
  files changed, decisions, lessons, unresolved issues, test/build status
- **Auto-save** — `hysa session save` writes important outcomes to Brain
  as decision/lesson memory nodes
- **Trivial session detection** — sessions with no commands, files, or
  errors are skipped
- **Safety** — secrets redacted, summary capped at 4000 chars, raw command
  output and file diffs are never saved

---

## New CLI Commands

### Brain Memory
```
hysa brain init            Initialize .hysa/brain files
hysa brain status          Show brain directory status
hysa brain inspect         Memory quality report
hysa brain cleanup         Prune low-value memories (dry-run default)
hysa brain forget <query>  Remove matching memories (pinned protected)
hysa brain merge <a> <b>   Merge two memory nodes
hysa brain pin <query>     Pin a memory node (protected from cleanup)
hysa brain recall <query>  Search experience graph
```

### Session Tracking
```
hysa session summary       Show session summary
hysa session save          Save important outcomes to Brain
hysa session clear         Clear session tracking state
```

### Existing (enhanced)
```
hysa brain note            Add manual note
hysa brain lesson          Add lesson
hysa brain decision        Add decision
hysa brain remember        Save via keyword classification
hysa brain graph stats     Graph statistics
hysa brain graph search    Search graph nodes/edges
```

---

## Migration Note

The experience graph version was bumped from **1 to 2** to include
quality-scoring fields (`importance`, `confidence`, `source`,
`lastAccessedAt`, `pinned`). Existing graphs from v0.5.x are read via a
fallback (`|| EMPTY_GRAPH`) and will be migrated automatically when the
next write occurs. No manual migration is required.

---

## Known Tradeoffs

- **Context injection is keyword‑based** — relevance scoring uses simple
  substring matching, not semantic embeddings. May surface false positives
  for ambiguous queries. A future phase could add embedding-based retrieval.
- **Decision/lesson extraction from sessions** is heuristic — keyword
  matching for "decided"/"learned" will miss some entries and false-positive
  others. The session summary is always saved as a whole.
- **Cleanup only handles `event` kind** — lessons and decisions are never
  auto-pruned, only events. Manual cleanup via `hysa brain forget` can
  remove them if needed.
- **Session state is file-based** — every event writes to disk. Not suitable
  for high-frequency event recording (>1000 events per session). For normal
  CLI usage this is fine (<50 events per session).
- **Fuzzy dedup uses Jaccard similarity** — works well for short labels but
  may miss semantically similar labels with different word choice.
- **Graph version 2 is forward‑compatible** — the scoring fields are
  optional, so new nodes can coexist with old un-scored nodes.

---

## Test Summary

- **39 tests total** across 4 suites
- **Zero failures** — build, type-check, web build, and all tests pass cleanly
- Test suites: `memory-writer` (10), `brain-quality` (9),
  `context-selector` (10), `session-tracker` (10)

---

## Files Changed (Phase 3A–3I)

| File | Action | Purpose |
|------|--------|---------|
| `src/brain/graph-types.ts` | Modified | Added scoring fields, cleanup types, MemorySource |
| `src/brain/graph-store.ts` | Modified | Scoring-aware upsert, fuzzy dedup, cleanup, inspect, forget, merge, pin |
| `src/brain/context-selector.ts` | Created | Smart context injection with relevance ranking + token budgets |
| `src/brain/session-tracker.ts` | Created | Session recording, summary generation, save/clear |
| `src/brain/index.ts` | Modified | Export new modules |
| `src/tools/memory-writer.ts` | Modified | Scoring in writeMemory(), writeMemoryFromText() |
| `src/cli.ts` | Modified | Added brain edit/cleanup/session commands, integrated context-selector |
| `tests/memory-writer.test.ts` | Modified | 9 new quality/cleanup tests |
| `tests/context-selector.test.ts` | Created | 10 tests for context selector |
| `tests/session-tracker.test.ts` | Created | 10 tests for session tracker |
| `README.md` | Modified | Documentation for brain/session features |
| `RELEASE-v0.6.0.md` | Created | This file |
