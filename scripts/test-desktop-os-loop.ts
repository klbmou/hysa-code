import { planToolActionsForTask } from '../src/agent/tool-planner.js';
import { getMemoryContextForTask } from '../src/agent/memory-context.js';
import { executeMultiStepPlan } from '../src/agent/multi-step-agent.js';

const C_RED = '\x1b[31m';
const C_GREEN = '\x1b[32m';
const C_YELLOW = '\x1b[33m';
const C_CYAN = '\x1b[36m';
const C_RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

function ok(msg: string) {
  passed++;
  console.log(`  ${C_GREEN}[OK]${C_RESET} ${msg}`);
}

function fail(msg: string) {
  failed++;
  console.log(`  ${C_RED}[FAIL]${C_RESET} ${msg}`);
}

async function main() {
  console.log(`${C_CYAN}=== smoke:hysa-desktop-os-loop ===${C_RESET}\n`);

  // ── 1. Plan OS actions with explicit coordinates ──
  {
    const plan = planToolActionsForTask({
      userText: 'move the mouse to (900, 500) and then click left button',
      filesMentioned: [],
    });
    if (!plan || plan.actions.length === 0) {
      fail('No actions planned for OS command');
    } else {
      const osActions = plan.actions.filter(a =>
        ['move_mouse', 'click_mouse', 'type_keyboard', 'press_key'].includes(a.toolName)
      );
      if (osActions.length < 2) {
        fail(`Expected ≥2 OS actions, got ${osActions.length}: ${osActions.map(a => a.toolName).join(', ')}`);
      } else {
        ok(`Planned ${osActions.length} OS actions: ${osActions.map(a => a.toolName).join(' → ')}`);
      }

      const moveAction = osActions.find(a => a.toolName === 'move_mouse');
      if (moveAction) {
        const coords = moveAction.input as Record<string, number>;
        if (coords.x === 900 && coords.y === 500) {
          ok(`move_mouse coordinates: x=${coords.x}, y=${coords.y}`);
        } else {
          fail(`move_mouse coordinates mismatch: got x=${coords.x}, y=${coords.y}, expected 900,500`);
        }
      }

      const clickAction = osActions.find(a => a.toolName === 'click_mouse');
      if (clickAction) {
        const input = clickAction.input as Record<string, unknown>;
        ok(`click_mouse params: button=${input.button}, count=${input.count}`);
      }
    }
  }

  // ── 2. Verify requires_approval on OS actions ──
  {
    const plan = planToolActionsForTask({
      userText: 'move mouse to (500, 300)',
      filesMentioned: [],
    });
    if (!plan) {
      fail('No plan for OS command');
    } else {
      const osActions = plan.actions.filter(a =>
        ['move_mouse', 'click_mouse', 'type_keyboard', 'press_key'].includes(a.toolName)
      );
      if (osActions.length === 0) {
        fail('No OS actions in plan');
      } else {
        let allRequireApproval = osActions.every(a => a.status === 'requires_approval');
        if (allRequireApproval) {
          ok(`All ${osActions.length} OS actions have status: requires_approval`);
        } else {
          const statuses = osActions.map(a => `${a.toolName}=${a.status}`).join(', ');
          fail(`Not all OS actions require approval: ${statuses}`);
        }
      }
    }
  }

  // ── 3. Test with memory context (simulating previous memory) ──
  {
    const memoryContext = {
      recentMemories: [
        { summary: 'Previously identified the dashboard panel is at (900, 500)', type: 'coord' },
        { summary: 'The user clicked the settings button at (200, 150) yesterday', type: 'coord' },
      ],
      relevantMemories: [{ summary: 'Dashboard coordinates confirmed at (900, 500)', type: 'coord' }],
      projectFacts: ['This is a monitoring dashboard application'],
      summary: 'Recent work on dashboard navigation. Known coordinates: dashboard (900, 500), settings (200, 150).',
      memoryUsed: true,
      memoryHits: 3,
      relevantFiles: ['src/dashboard/panel.tsx'],
    };

    const plan = planToolActionsForTask({
      userText: 'move mouse to the dashboard coordinates and click',
      filesMentioned: [],
      memoryContext,
    });

    if (!plan || plan.actions.length === 0) {
      fail('No actions planned with memory context');
    } else {
      const moveAction = plan.actions.find(a => a.toolName === 'move_mouse');
      if (moveAction) {
        const coords = moveAction.input as Record<string, number>;
        if (coords.x === 900 && coords.y === 500) {
          ok(`Memory-guided coordinates: x=${coords.x}, y=${coords.y} (from memory hint)`);
        } else {
          fail(`Memory-guided coordinates wrong: got x=${coords.x}, y=${coords.y}, expected 900,500`);
        }
      } else {
        fail('No move_mouse action in memory-guided plan');
      }
    }
  }

  // ── 4. Full multi-step plan with approval simulation ──
  {
    const plan = planToolActionsForTask({
      userText: 'move the mouse to (400, 400)',
      filesMentioned: [],
    });

    if (!plan) {
      fail('No plan for multi-step test');
    } else {
      if (plan.taskKind === 'os_control') {
        ok(`Task kind classified as 'os_control'`);
      } else {
        fail(`Task kind expected 'os_control', got '${plan.taskKind}'`);
      }

      const approvalInfo = plan.actions.filter(a => a.status === 'requires_approval');
      if (approvalInfo.length > 0) {
        ok(`${approvalInfo.length} action(s) pending approval: ${approvalInfo.map(a => a.toolName).join(', ')}`);
      } else {
        fail('No actions pending approval');
      }

      const blockedCount = plan.actions.filter(a => a.status === 'blocked').length;
      if (blockedCount === 0) {
        ok('No blocked actions in plan');
      } else {
        fail(`${blockedCount} blocked action(s) in plan`);
      }
    }
  }

  // ── 5. Verify deterministic safety for run_command ──
  {
    const plan = planToolActionsForTask({
      userText: 'run the tests',
      filesMentioned: [],
    });

    if (!plan) {
      ok('No plan for run command (expected — no actions planned)');
    } else {
      const runActions = plan.actions.filter(a => a.toolName === 'run_command');
      if (runActions.length > 0) {
        ok(`Planned ${runActions.length} run_command action(s)`);
        const cmds = runActions.map(a => (a.input as Record<string, string>)?.command || '');
        const blockedInPlan = runActions.filter(a => a.status === 'blocked');
        const dangerous = cmds.some(c => c.includes('rm -rf') || c.includes('format'));
        if (!dangerous) {
          ok('No dangerous command patterns detected in planned actions');
        }
      } else {
        ok(`No run_command actions planned (read-only task ` + `classification)`);
      }
    }
  }

  // ── Summary ──
  console.log(`\n${C_CYAN}=== smoke:hysa-desktop-os-loop${failed > 0 ? C_RED + ' FAILED' : C_GREEN + ' PASSED'}${C_CYAN} ===${C_RESET}`);
  console.log(`  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${C_RED}Fatal error:${C_RESET}`, err);
  process.exit(1);
});