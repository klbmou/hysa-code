import { execSync } from 'node:child_process';
import type { ToolDefinition, ToolRunContext } from './types.js';

const MAX_TEXT_LENGTH = 500;
const MAX_COORD = 99999;
const VALID_KEYS = new Set([
  'enter', 'tab', 'escape', 'backspace', 'delete', 'insert', 'home', 'end',
  'pageup', 'pagedown', 'up', 'down', 'left', 'right',
  'space', 'capslock', 'numlock', 'scrolllock', 'printscreen', 'pause',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
]);

const MODIFIER_KEYS = new Set([
  'shift', 'ctrl', 'alt', 'win', 'lwin', 'rwin',
]);

const VALID_SPECIAL_KEYS = new Set([
  ...VALID_KEYS, ...MODIFIER_KEYS,
  '+', '^', '%', '~',
]);

interface MoveMouseInput { x: number; y: number }
interface ClickMouseInput { button?: 'left' | 'right'; count?: number }
interface TypeKeyboardInput { text: string }
interface PressKeyInput { key: string }

interface MoveMouseOutput { x: number; y: number }
interface ClickMouseOutput { button: string; count: number }
interface TypeKeyboardOutput { text: string; charCount: number }
interface PressKeyOutput { key: string }

function buildPowerShellScript(action: string, args: Record<string, unknown>, context: ToolRunContext): string {
  const lines: string[] = [
    'Add-Type @\"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class Win32 {',
    '  [DllImport("user32.dll")]',
    '  public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")]',
    '  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);',
    '  [DllImport("user32.dll")]',
    '  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);',
    '  [DllImport("user32.dll")]',
    '  public static extern short VkKeyScan(char ch);',
    '}',
    '\"@',
  ];

  switch (action) {
    case 'move_mouse': {
      const x = Math.round(Number(args.x) || 0);
      const y = Math.round(Number(args.y) || 0);
      lines.push(`[Win32]::SetCursorPos(${x}, ${y})`);
      break;
    }
    case 'click_mouse': {
      const button = (args.button as string) || 'left';
      const count = Math.min(Math.max(Math.round(Number(args.count) || 1), 1), 100);
      const downFlag = button === 'right' ? '0x08' : '0x02';
      const upFlag = button === 'right' ? '0x10' : '0x04';
      lines.push(`for ($i = 0; $i -lt ${count}; $i++) {`);
      lines.push(`  [Win32]::mouse_event(${downFlag}, 0, 0, 0, 0);`);
      lines.push('  Start-Sleep -Milliseconds 30;');
      lines.push(`  [Win32]::mouse_event(${upFlag}, 0, 0, 0, 0);`);
      lines.push('  if ($i -lt (' + count + ' - 1)) { Start-Sleep -Milliseconds 50 }');
      lines.push('}');
      break;
    }
    case 'type_keyboard': {
      const text = (args.text as string) || '';
      const escaped = text
        .replace(/[{}()+^%~\[\]]/g, '{$&}')
        .replace(/\n/g, '{ENTER}')
        .replace(/\r/g, '')
        .replace(/\t/g, '{TAB}');
      lines.push('Add-Type -AssemblyName System.Windows.Forms;');
      lines.push(`[System.Windows.Forms.SendKeys]::SendWait('${escaped}')`);
      break;
    }
    case 'press_key': {
      const key = (args.key as string) || '';
      const sendKey = translateKeyToSendKeys(key);
      lines.push('Add-Type -AssemblyName System.Windows.Forms;');
      lines.push(`[System.Windows.Forms.SendKeys]::SendWait('${sendKey}')`);
      break;
    }
  }
  return lines.join('\n');
}

function translateKeyToSendKeys(key: string): string {
  const lower = key.toLowerCase();
  const sendKeyMap: Record<string, string> = {
    'enter': '{ENTER}', 'tab': '{TAB}', 'escape': '{ESC}', 'esc': '{ESC}',
    'backspace': '{BACKSPACE}', 'bs': '{BACKSPACE}',
    'delete': '{DELETE}', 'del': '{DELETE}',
    'insert': '{INSERT}', 'ins': '{INSERT}',
    'home': '{HOME}', 'end': '{END}',
    'pageup': '{PGUP}', 'pagedown': '{PGDN}',
    'up': '{UP}', 'down': '{DOWN}', 'left': '{LEFT}', 'right': '{RIGHT}',
    'space': ' ',
    'capslock': '{CAPSLOCK}', 'numlock': '{NUMLOCK}', 'scrolllock': '{SCROLLLOCK}',
    'printscreen': '{PRTSC}', 'pause': '{PAUSE}',
    'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}',
    'f5': '{F5}', 'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}',
    'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}',
    'shift': '+', 'ctrl': '^', 'control': '^',
    'alt': '%', 'win': '^{ESC}', 'lwin': '^{ESC}',
  };

  if (sendKeyMap[lower]) return sendKeyMap[lower];

  const parts = key.split(/\+/).map(p => p.trim().toLowerCase());
  if (parts.length >= 2) {
    const mods = parts.slice(0, -1);
    const main = parts[parts.length - 1];
    const modPrefix = mods.map(m => {
      if (m === 'ctrl' || m === 'control') return '^';
      if (m === 'alt') return '%';
      if (m === 'shift') return '+';
      if (m === 'win') return '^{ESC}(';
      return '';
    }).join('');
    const suffix = mods.includes('win') ? ')' : '';
    const mainKey = main.length === 1 ? main.toUpperCase() : (sendKeyMap[main] || `{${main.toUpperCase()}}`);
    return `${modPrefix}${mainKey}${suffix}`;
  }

  if (lower.length === 1) return `{${lower.toUpperCase()}}`;
  return `{${lower.toUpperCase()}}`;
}

export const moveMouseTool: ToolDefinition<MoveMouseInput, MoveMouseOutput> = {
  name: 'move_mouse',
  description: 'Move the cursor to precise screen coordinates',
  riskLevel: 'review',
  approvalPolicy: 'requires_approval',
  inputSchema: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'X coordinate on screen' },
      y: { type: 'number', description: 'Y coordinate on screen' },
    },
    required: ['x', 'y'],
  },
  async run(input: MoveMouseInput, context: ToolRunContext) {
    const x = Math.round(Number(input.x) || 0);
    const y = Math.round(Number(input.y) || 0);
    if (x < 0 || y < 0 || x > MAX_COORD || y > MAX_COORD) {
      return { ok: false, error: `Coordinates out of range (0-${MAX_COORD})`, summary: 'Invalid coordinates' };
    }
    if (context.dryRun) {
      return {
        ok: true, output: { x, y },
        summary: `[DRY-RUN] Would move cursor to (${x}, ${y})`,
        requiresApproval: true,
        approvalReason: 'Moving the mouse controls a physical input device',
        proposedAction: { tool: 'move_mouse', x, y },
      };
    }
    if (!context.approved) {
      return {
        ok: false, error: 'Mouse movement requires approval',
        summary: 'Mouse movement requires approval',
        requiresApproval: true,
        approvalReason: 'Moving the mouse controls a physical input device',
        proposedAction: { tool: 'move_mouse', x, y },
      };
    }
    try {
      const script = buildPowerShellScript('move_mouse', { x, y }, context);
      execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 5000 });
      return { ok: true, output: { x, y }, summary: `Cursor moved to (${x}, ${y})` };
    } catch (err: unknown) {
      const e = err as Error;
      return { ok: false, error: e.message, summary: `Failed to move cursor: ${e.message}` };
    }
  },
};

export const clickMouseTool: ToolDefinition<ClickMouseInput, ClickMouseOutput> = {
  name: 'click_mouse',
  description: 'Simulate mouse clicks at the current cursor position',
  riskLevel: 'review',
  approvalPolicy: 'requires_approval',
  inputSchema: {
    type: 'object',
    properties: {
      button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button (default left)' },
      count: { type: 'number', description: 'Number of clicks (default 1, max 100)' },
    },
  },
  async run(input: ClickMouseInput, context: ToolRunContext) {
    const button = input.button || 'left';
    const count = Math.min(Math.max(Math.round(input.count || 1), 1), 100);
    if (context.dryRun) {
      return {
        ok: true, output: { button, count },
        summary: `[DRY-RUN] Would click ${button} button ${count} time(s)`,
        requiresApproval: true,
        approvalReason: 'Clicking simulates physical mouse input',
        proposedAction: { tool: 'click_mouse', button, count },
      };
    }
    if (!context.approved) {
      return {
        ok: false, error: 'Mouse click requires approval',
        summary: 'Mouse click requires approval',
        requiresApproval: true,
        approvalReason: 'Clicking simulates physical mouse input',
        proposedAction: { tool: 'click_mouse', button, count },
      };
    }
    try {
      const script = buildPowerShellScript('click_mouse', { button, count }, context);
      execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 10000 });
      return { ok: true, output: { button, count }, summary: `Clicked ${button} button ${count} time(s)` };
    } catch (err: unknown) {
      const e = err as Error;
      return { ok: false, error: e.message, summary: `Failed to click mouse: ${e.message}` };
    }
  },
};

export const typeKeyboardTool: ToolDefinition<TypeKeyboardInput, TypeKeyboardOutput> = {
  name: 'type_keyboard',
  description: 'Simulate typing text at the current focus',
  riskLevel: 'review',
  approvalPolicy: 'requires_approval',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to type (max 500 chars)' },
    },
    required: ['text'],
  },
  async run(input: TypeKeyboardInput, context: ToolRunContext) {
    const text = (input.text || '').slice(0, MAX_TEXT_LENGTH);
    if (!text) {
      return { ok: false, error: 'No text provided', summary: 'No text to type' };
    }
    if (context.dryRun) {
      return {
        ok: true, output: { text, charCount: text.length },
        summary: `[DRY-RUN] Would type ${text.length} characters`,
        requiresApproval: true,
        approvalReason: 'Keyboard input controls physical input device',
        proposedAction: { tool: 'type_keyboard', charCount: text.length },
      };
    }
    if (!context.approved) {
      return {
        ok: false, error: 'Keyboard input requires approval',
        summary: 'Keyboard input requires approval',
        requiresApproval: true,
        approvalReason: 'Keyboard input controls physical input device',
        proposedAction: { tool: 'type_keyboard', charCount: text.length },
      };
    }
    try {
      const script = buildPowerShellScript('type_keyboard', { text }, context);
      execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 15000 });
      return { ok: true, output: { text, charCount: text.length }, summary: `Typed ${text.length} characters` };
    } catch (err: unknown) {
      const e = err as Error;
      return { ok: false, error: e.message, summary: `Failed to type: ${e.message}` };
    }
  },
};

export const pressKeyTool: ToolDefinition<PressKeyInput, PressKeyOutput> = {
  name: 'press_key',
  description: 'Simulate pressing a specific key or hotkey combination',
  riskLevel: 'review',
  approvalPolicy: 'requires_approval',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Key to press (e.g. enter, ctrl+s, alt+f4). Supported: enter, tab, escape, backspace, delete, insert, home, end, pageup, pagedown, up, down, left, right, space, f1-f12, shift, ctrl, alt, and combinations like ctrl+s',
      },
    },
    required: ['key'],
  },
  async run(input: PressKeyInput, context: ToolRunContext) {
    const key = (input.key || '').trim().toLowerCase();
    if (!key) {
      return { ok: false, error: 'No key provided', summary: 'No key to press' };
    }
    if (context.dryRun) {
      return {
        ok: true, output: { key },
        summary: `[DRY-RUN] Would press key: ${key}`,
        requiresApproval: true,
        approvalReason: 'Keyboard input controls physical input device',
        proposedAction: { tool: 'press_key', key },
      };
    }
    if (!context.approved) {
      return {
        ok: false, error: 'Key press requires approval',
        summary: 'Key press requires approval',
        requiresApproval: true,
        approvalReason: 'Keyboard input controls physical input device',
        proposedAction: { tool: 'press_key', key },
      };
    }
    try {
      const script = buildPowerShellScript('press_key', { key }, context);
      execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 5000 });
      return { ok: true, output: { key }, summary: `Pressed key: ${key}` };
    } catch (err: unknown) {
      const e = err as Error;
      return { ok: false, error: e.message, summary: `Failed to press key: ${e.message}` };
    }
  },
};
