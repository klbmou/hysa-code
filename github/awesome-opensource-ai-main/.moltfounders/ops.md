# Operations Setup

Suggested unattended setup for `alvinreal/awesome-opensource-ai`.

This repo uses two loops only:

1. research loop
2. PR review loop

## Research Loop

Recommended schedule: hourly.

```bash
openclaw cron add \
  --name "OSAI Research Loop" \
  --schedule "15 * * * *" \
  --agent max \
  --message "Run the Research Loop for alvinreal/awesome-opensource-ai.

Before acting, read:
- CONTRIBUTING.md
- .moltfounders/README.md
- .moltfounders/research.md
- .moltfounders/spec.txt

Use research.md as the primary procedure and spec.txt for edge cases.

Inputs:
- stateFile: ~/.openclaw/workspace-max/states/cron/awesome-opensource-ai/research.json
- targetRepo: alvinreal/awesome-opensource-ai
- targetBranch: main
- minHoursBetweenRuns: 1
- maxEntriesPerRun: 5

Follow the clean-start requirement.
Research exactly one category and open at most one PR.
Only open PRs that remain auto-merge-eligible: README.md only, single-category only, non-structural.
Reinitialize missing or corrupt state per spec.
Advance rotation on intentional skips.
Do not advance rotation on technical PR-creation failure.
Run required validation before opening any PR.
Persist state at end." \
  --delivery announce \
  --channel telegram \
  --to 1953698775
```

## PR Review Loop

Recommended schedule: 10:20 and 16:20 daily.

```bash
openclaw cron add \
  --name "OSAI PR Review Loop" \
  --schedule "20 10,16 * * *" \
  --agent max \
  --message "Run the PR Review Loop for all open PRs in alvinreal/awesome-opensource-ai.

Before acting, read:
- CONTRIBUTING.md
- .moltfounders/README.md
- .moltfounders/pr-review.md
- .moltfounders/labels.md
- .moltfounders/spec.txt

Use pr-review.md as the primary procedure, labels.md for canonical labels, and spec.txt for edge cases.
Trusted agent account: alvinreal.

Ensure canonical labels exist.
Process agent PRs first, then community PRs.
Skip all draft PRs.
Use comments plus canonical labels only for review signaling.
Auto-merge only agent PRs that still satisfy the README.md-only, single-category, non-structural allowlist and pass all required validation and GitHub API fact checks.
If one or more agent PRs are merged, wait for the resulting main validation workflow/checks and confirm they complete successfully with no errors.
When multiple agent PRs are eligible, merge them one at a time and confirm main CI is green after each merge before merging the next one.
If main CI fails or does not complete cleanly after a merge, stop unattended merging and escalate with needs-human.
For temporary infra failures on agent PRs: comment once, retry on later runs, pause after 3 failures with needs-human, and resume only after meaningful human activity.
Follow the documented rules for conflicts, overlaps, fixes, close-or-leave-open outcomes, and community PR handling exactly." \
  --delivery announce \
  --channel telegram \
  --to 1953698775
```
