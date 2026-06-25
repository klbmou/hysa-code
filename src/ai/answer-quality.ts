export type AnswerQualityIssueCode =
  | 'empty_response'
  | 'wrong_language'
  | 'arabic_mojibake'
  | 'raw_json_leak'
  | 'raw_source_leak'
  | 'missing_sources'
  | 'manual_verification_request'
  | 'unsafe_action_without_approval'
  | 'overconfident_claim'
  | 'generic_low_value'
  | 'missing_next_step';

export interface AnswerQualityIssue {
  code: AnswerQualityIssueCode;
  severity: 'info' | 'warn' | 'error';
  message: string;
}

export interface AnswerQualityInput {
  answer: string;
  userText: string;
  language?: 'ar' | 'en' | 'mixed' | 'unknown';
  taskKind?: string;
  sourcesCount?: number;
  hasSearchResults?: boolean;
  isOpenCodePrompt?: boolean;
  isStreaming?: boolean;
  toolResultCount?: number;
}

export interface AnswerQualityResult {
  ok: boolean;
  score: number;
  issues: AnswerQualityIssue[];
  shouldRegenerate: boolean;
  shouldWarnOnly: boolean;
  toolSynthesisUsed?: boolean;
  toolResultCount?: number;
}

const ARABIC_PATTERN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function hasArabic(text: string | undefined | null): boolean {
  if (!text) return false;
  for (const char of text) {
    if (ARABIC_PATTERN.test(char)) return true;
  }
  return false;
}

function hasExplicitEnglishRequest(text: string): boolean {
  return /\b(?:answer\s+(?:in|using|with)\s+english|speak\s+english|use\s+english|in\s+english|english\s+(?:only|please))\b/i.test(text);
}

function isMostlyEnglish(text: string): boolean {
  if (!text) return true;
  const arabicChars = text.split('').filter(c => ARABIC_PATTERN.test(c)).length;
  const totalChars = text.replace(/\s/g, '').length;
  if (totalChars === 0) return true;
  return arabicChars / totalChars < 0.1;
}

function hasSourcesSection(text: string): boolean {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    const sourceHeader = /^(?:\*\*|#+\s*)?(?:Sources?|References?|Citations?|Links?|مصادر|المصادر|المراجع|روابط|المصدر|مصدر)(?:\*\*|\s*#*)?:?\s*$/i;
    if (sourceHeader.test(line)) {
      let nextNonEmpty = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) { nextNonEmpty = j; break; }
      }
      if (nextNonEmpty < 0) continue;
      const next = lines[nextNonEmpty].trim();
      if (/^\d+[.)]\s/.test(next) || /^[-*]\s/.test(next) || /https?:\/\//i.test(next) || /^\[.+\]/.test(next)) {
        return true;
      }
    }
  }
  return false;
}

function hasMojibake(text: string): boolean {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xD8 && c <= 0xDB) {
      count++;
      if (count >= 4) return true;
    }
  }
  return false;
}

function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '');
}

const RAW_JSON_LEAK_RE = /\[[\s\S]*?"(?:title|url|snippet|rank)"[\s\S]*?\](?:\s*\[|\s*\{)/;
const RAW_SOURCE_ARRAY_RE = /\[\s*\{\s*"(?:title|url|snippet)"\s*:/;

function hasRawJsonLeak(text: string): boolean {
  const stripped = stripCodeBlocks(text);
  return RAW_JSON_LEAK_RE.test(stripped) || RAW_SOURCE_ARRAY_RE.test(stripped);
}

function isCodeTask(taskKind?: string): boolean {
  if (!taskKind) return false;
  return ['code', 'code_edit', 'code_review', 'debug', 'debug_error', 'debugging', 'coding_qa', 'refactor'].includes(taskKind);
}

function hasSmallJsonInCodeAnswer(text: string, taskKind?: string): boolean {
  if (!isCodeTask(taskKind)) return false;
  const jsonBlocks = text.match(/\[\s*\{[^]]+\}\s*\]/g);
  if (!jsonBlocks) return false;
  return jsonBlocks.some(j => {
    const inCode = text.indexOf(j) > 0 && text.slice(0, text.indexOf(j)).split('```').length % 2 === 0;
    return !inCode && j.length < 300;
  });
}

const MANUAL_VERIFICATION_PATTERNS = [
  /\b(?:you|u)\s+(?:should|need to|must|have to|can|try)\s+(?:run|execute|test)\s+(?:npm\s+test|npm\s+run\s+(?:build|check)|npx\s+tsc|\.\/scripts\/smoke)/i,
  /\byou\s+(?:should|need to|must|have to|can|try)\s+(?:build|compile|test)\s+(?:the\s+)?(?:project|code|app)/i,
  /(?:test|verify|check)\s+(?:manually|yourself|by yourself)/i,
  /\byou\s+(?:could\s+)?(?:also\s+)?(?:run|try)\s+(?:(?:npm|npx)\s+)?test/i,
];

function hasManualVerificationRequest(text: string): boolean {
  const stripped = stripCodeBlocks(text);
  return MANUAL_VERIFICATION_PATTERNS.some(p => p.test(stripped));
}

const DESTRUCTIVE_COMMANDS = [
  /delete/i, /remove/i, /rm\b/i, /wipe/i, /destroy/i,
  /format/i, /dd\b/i, /mkfs/i,
  /systemctl/i, /sc\s+delete/i,
  /net\s+user/i, /reg\s+delete/i,
  /shutdown/i, /reboot/i,
  /taskkill/i, /kill/i,
  /send\s+mail/i, /sendmail/i,
  /iptables/i,
];

function hasUnsafeAction(text: string): boolean {
  const stripped = stripCodeBlocks(text);
  return DESTRUCTIVE_COMMANDS.some(p => p.test(stripped));
}

function hasApprovalWording(text: string): boolean {
  const approval = /\b(?:approve|confirm|let me know|shall I|should I|may I|want me to|permission|ok to|can I|do you want me to)\b/i.test(text);
  const warning = /\b(?:warning|caution|careful|backup|undo|can't undo|will be lost)\b/i.test(text);
  return approval || warning;
}

const OVERCONFIDENT_CLAIMS = [
  /\bdefinitely\s+(?:fixed|solved|resolved|works)\b/i,
  /\bguaranteed?\b/i,
  /\b100%\s+(?:fixed|solved|working|guaranteed)\b/i,
  /\bperfectly?\s+(?:working|fixed|solved)\b/i,
  /\bno\s+(?:bugs?|issues?|problems?)\s+(?:at\s+all|whatsoever)\b/i,
  /\babsolutely\s+(?:certain|certainly|no issue)\b/i,
];

function hasOverconfidentClaim(text: string): boolean {
  const stripped = stripCodeBlocks(text);
  return OVERCONFIDENT_CLAIMS.some(p => p.test(stripped));
}

const LOW_VALUE_RESPONSES = [
  /^(?:ok|okay|done|sure|yes|no|got it|thanks|let me know|i understand|i see)[.!]?\s*$/i,
  /^(?:i'll\s+(?:look|check|try|let you know)|i\s+will\s+(?:look|check|try|let you know))[.!]?\s*$/i,
  /^(?:that'?s?\s+(?:a\s+)?(?:good|great|interesting|fair|fine))\s*$/i,
];

function isGenericLowValue(answer: string, taskKind?: string): boolean {
  if (!isCodeTask(taskKind) && taskKind !== 'web_research' && taskKind !== 'arabic_explanation') return false;
  const trimmed = answer.trim();
  if (trimmed.length < 80) {
    const stripped = stripCodeBlocks(trimmed);
    if (stripped.length < 80) return true;
  }
  const lines = trimmed.split('\n').filter(l => l.trim());
  if (lines.length <= 2 && trimmed.length < 120) return true;
  if (LOW_VALUE_RESPONSES.some(p => p.test(trimmed))) return true;
  return false;
}

const NEXT_STEP_PROMPT_RE = /\b(?:next\s+step|next\s+action|you\s+should|i recommend|here'?s?\s+(?:what|how)|let'?s?\s+(?:start|begin|try|implement)|to\s+(?:proceed|implement|fix|add))\b/i;
const COMPLEX_TASK_KINDS = ['code', 'code_edit', 'code_review', 'debug', 'debug_error', 'debugging', 'refactor', 'plan', 'project_scan'];

function hasMissingNextStep(answer: string, taskKind?: string): boolean {
  if (!taskKind || !COMPLEX_TASK_KINDS.includes(taskKind)) return false;
  const stripped = stripCodeBlocks(answer);
  if (stripped.length < 100) return false;
  return !NEXT_STEP_PROMPT_RE.test(stripped);
}

export function evaluateAnswerQuality(input: AnswerQualityInput): AnswerQualityResult {
  const issues: AnswerQualityIssue[] = [];
  const { answer, userText, language, taskKind, sourcesCount, hasSearchResults, isOpenCodePrompt, isStreaming, toolResultCount } = input;

  if (!answer || !answer.trim()) {
    issues.push({ code: 'empty_response', severity: 'error', message: 'Response is empty or whitespace-only' });
    return {
      ok: false,
      score: 0,
      issues,
      shouldRegenerate: !isStreaming,
      shouldWarnOnly: false,
    };
  }

  const userIsArabic = hasArabic(userText);
  const userExplicitlyAskedEnglish = hasExplicitEnglishRequest(userText);
  const answerIsMostlyEnglish = isMostlyEnglish(answer);

  if (userIsArabic && answerIsMostlyEnglish && !userExplicitlyAskedEnglish) {
    const arabicCount = answer.split('').filter(c => ARABIC_PATTERN.test(c)).length;
    if (arabicCount === 0) {
      issues.push({ code: 'wrong_language', severity: 'error', message: 'User wrote in Arabic but answer is entirely in English without being asked' });
    } else {
      issues.push({ code: 'wrong_language', severity: 'warn', message: 'User wrote in Arabic but answer is mostly English' });
    }
  }

  if (hasMojibake(answer)) {
    issues.push({ code: 'arabic_mojibake', severity: 'error', message: 'Answer contains mojibake (corrupted Arabic characters)' });
  }

  if (hasRawJsonLeak(answer)) {
    const isFalselyFlagged = hasSmallJsonInCodeAnswer(answer, taskKind);
    if (!isFalselyFlagged) {
      issues.push({ code: 'raw_json_leak', severity: 'warn', message: 'Answer contains raw JSON source data visible to the user' });
    }
  }

  if (hasRawJsonLeak(answer)) {
    issues.push({ code: 'raw_source_leak', severity: 'warn', message: 'Answer includes unformatted source dump' });
  }

  const hasSearchContext = hasSearchResults || (sourcesCount !== undefined && sourcesCount > 0);
  if (hasSearchContext && !hasSourcesSection(answer)) {
    issues.push({ code: 'missing_sources', severity: 'info', message: 'Search results were provided but the answer does not include a readable sources section' });
  }

  if (isOpenCodePrompt && hasManualVerificationRequest(answer)) {
    issues.push({ code: 'manual_verification_request', severity: 'warn', message: 'Answer tells the user to run tests/manual verification instead of having OpenCode run them' });
  }

  if (hasUnsafeAction(answer) && !hasApprovalWording(answer)) {
    issues.push({ code: 'unsafe_action_without_approval', severity: 'warn', message: 'Answer suggests destructive actions without seeking approval' });
  }

  if (hasOverconfidentClaim(answer)) {
    issues.push({ code: 'overconfident_claim', severity: 'info', message: 'Answer contains overconfident unverified claims' });
  }

  if (isGenericLowValue(answer, taskKind)) {
    issues.push({ code: 'generic_low_value', severity: 'warn', message: 'Answer is very short or generic for a task that requires detail' });
  }

  if (hasMissingNextStep(answer, taskKind)) {
    issues.push({ code: 'missing_next_step', severity: 'info', message: 'Implementation/planning answer lacks a clear next step' });
  }

  const score = Math.max(0, 100 - issues.reduce((sum, i) => {
    if (i.severity === 'error') return sum + 40;
    if (i.severity === 'warn') return sum + 15;
    return sum + 5;
  }, 0));

  const hasError = issues.some(i => i.severity === 'error');
  const hasWarn = issues.some(i => i.severity === 'warn');

  return {
    ok: score >= 85,
    score,
    issues,
    shouldRegenerate: hasError && !isStreaming,
    shouldWarnOnly: !hasError && hasWarn,
    toolSynthesisUsed: toolResultCount !== undefined && toolResultCount > 0,
    toolResultCount,
  };
}

const DUPLICATE_SOURCE_SECTION_RE = /(?:(?:Sources?|References?|Citations?|Links?|مصادر|المصادر|المراجع|روابط)(?:\*\*)?:?\s*\n(?:\d+[.)]\s.*\n?)+)\s*\n(?:\*\*)?(?:Sources?|References?|Citations?|Links?|مصادر|المصادر|المراجع|روابط)(?:\*\*)?:?\s*\n/i;

const TRAILING_JSON_ARRAY_RE = /\n*\[\s*\{[^}]*"(?:title|url|snippet)"[^}]*\}\s*\]\s*$/;

export function cleanObviousAnswerArtifacts(answer: string): string {
  let cleaned = answer;

  const dupMatch = cleaned.match(DUPLICATE_SOURCE_SECTION_RE);
  if (dupMatch) {
    const beforeDup = cleaned.slice(0, dupMatch.index! + dupMatch[0].length);
    const afterDup = cleaned.slice(dupMatch.index! + dupMatch[0].length);
    const afterNewline = afterDup.indexOf('\n');
    const remaining = afterNewline >= 0 ? afterDup.slice(afterNewline + 1) : '';
    cleaned = (beforeDup + remaining).trim();
  }

  cleaned = cleaned.replace(TRAILING_JSON_ARRAY_RE, '');
  cleaned = cleaned.trim();

  return cleaned;
}
