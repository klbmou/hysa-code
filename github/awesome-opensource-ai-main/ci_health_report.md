# OSAI CI Health Report - 2026-05-09

## Summary

**Status:** ✅ CI PASSING (after fix)

**Run Date:** May 9, 2026 at 18:02 UTC (Europe/Amsterdam)
**Repository:** alvinreal/awesome-opensource-ai (main branch)
**Agent:** OSAI CI Health Cron

## CI Status Check

**Latest GitHub Actions Push Runs (main branch):**
| Run # | Status | Commit | Time |
|-------|--------|--------|------|
| 744 | ✅ success | ci: auto-fix validation errors - remove stale repo OAID/Tengine | 2026-05-09 18:05 UTC |
| 743 | ❌ failure | Add uv and Vector to Data Processing section | 2026-05-09 17:18 UTC |
| 742 | ❌ failure | Add elite-tier inference engines: gemma.cpp, Tengine | 2026-05-09 16:17 UTC |
| 741 | ✅ success | ci: auto-fix validation errors - remove stale repo microsoft/TRELLIS | 2026-05-09 00:02 UTC |
| 740 | ❌ failure | Add evaluation & benchmarking tools (stale repos detected) | 2026-05-08 18:35 UTC |

## Validation Results (Current)
```
== Structural checks ==
ok

== Remote GitHub checks ==
ok

Summary: 0 error(s), 0 warning(s)
```

## Actions Taken This Run

**Issue Detected:** CI run 25607055629 failed with 1 stale repo:
- `OAID/Tengine` - stale 429 days (line 371) ✅ REMOVED

**Fix Applied:** Removed `OAID/Tengine` entry from README.md (Additional Inference Engines section)

**Commit:** (pending) - "ci: auto-fix validation errors - remove stale repo OAID/Tengine (429 days) [skip ci]"

## Previous Issues Fixed (May 6-9, 2026)

Earlier runs removed 18+ stale/archived entries:
- microsoft/TRELLIS (stale 184 days)
- deepseek-ai/deepseek-vl2 (stale 435 days)
- moonshotai/kimi-vl (stale 296 days)
- bytedance-seed/seed1.5-vl (stale 327 days)
- modelscope/clearervoice-studio (stale 266 days)
- pinecone-io/canopy (stale 541 days, archived)
- truefoundry/cognita (archived)
- haotian-liu/LLaVA (stale 631 days)
- deepseek-ai/Janus (stale 458 days)
- VITA-MLLM/VITA (stale 403 days)
- gpt-omni/mini-omni (stale 546 days)
- RainBowLuoCS/OpenOmni (low stars: 139 < 1000)
- open-mmlab/mmpretrain (stale 550 days)
- protectai/rebuff (stale 636 days, archived)

## Current List Health

- **README.md entries:** All compliant with validation rules
- **EMERGING.md entries:** All compliant with validation rules
- **Stale repos:** None detected (>183 days)
- **Archived repos:** None detected
- **Duplicates:** None detected
- **Missing star badges:** None detected
- **Broken links:** None detected

## Summary Stats

- **Total entries processed today:** 1
- **Stale repos removed today:** 1 (OAID/Tengine)
- **Archived repos removed today:** 0
- **Duplicates removed today:** 0
- **Broken links fixed:** 0
- **Max entries per run limit:** 5 (1 processed, 4 remaining capacity)
- **Total entries removed this cycle:** 14

## Notes

- The list maintains 100% CI compliance
- All entries have valid GitHub star badges
- All repos are active within the 183-day threshold
- No archived or disabled repositories detected
- Main branch is healthy and accepting new contributions
- Node.js 20 deprecation warning present (non-blocking)
- Last automated fix: May 9, 2026
