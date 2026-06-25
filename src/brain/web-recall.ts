import { selectContext, formatSelectedContext } from './context-selector.js';
import type { SelectedContext } from './context-selector.js';

export interface WebRecallResult {
  recallUsed: boolean;
  recallItemCount: number;
  recallChars: number;
  systemPromptInjection: string;
}

export async function buildWebRecallContext(
  message: string,
  taskKind: string,
  debug?: boolean,
): Promise<WebRecallResult> {
  try {
    const selected = await selectContext({
      message,
      taskKind,
      maxItems: 5,
      debug: !!debug,
    });
    if (selected.items.length > 0) {
      return {
        recallUsed: true,
        recallItemCount: selected.items.length,
        recallChars: selected.totalChars,
        systemPromptInjection: formatSelectedContext(selected),
      };
    }
  } catch {
    // recall failure is non-fatal
  }
  return {
    recallUsed: false,
    recallItemCount: 0,
    recallChars: 0,
    systemPromptInjection: '',
  };
}

export function shouldUseRecallForWebMessage(
  message: string,
  isSimple: boolean,
  searchQuery: string | null,
): boolean {
  return !isSimple && !searchQuery;
}
