const ARABIC_PATTERN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
export function isArabicText(text) {
    if (!text)
        return false;
    return ARABIC_PATTERN.test(text);
}
const GREETINGS = ['hi', 'hello', 'hey', 'yo', 'sup', 'hiya', 'howdy', 'greetings', 'salam', 'thanks', 'ok', 'nice', 'good', 'great', 'perfect', 'yes', 'no', 'sure', 'okay', 'bye', 'goodbye', 'cya', 'see ya', 'later'];
const ARABIC_GREETINGS = ['السلام', 'صباح', 'مساء', 'مرحبا', 'اهلا', 'اه', 'اوك', 'تمام', 'نعم', 'لا', 'شكرا'];
const ALL_GREETINGS = [...GREETINGS, ...ARABIC_GREETINGS];
function isGreeting(text) {
    const t = text.trim().toLowerCase();
    if (ALL_GREETINGS.includes(t))
        return true;
    if (ALL_GREETINGS.some(g => t === g || t === `${g}!` || t === `${g},`))
        return true;
    if (t.length < 15 && /^(?:hi|hello|hey|salam|مرحبا|اهلا|شكرا|thanks|ok|okay|nice|good|great|yes|no)\b/i.test(t))
        return true;
    return false;
}
const SEARCH_PATTERNS = [
    /^hysa\s+(?:search|websearch)\s+/i,
    /^(?:search|look\s*up|google|bing|search\s*the\s*web)\s+(?:for\s+)?/i,
    /^(?:what\s+is\s+the\s+(?:current|latest|recent)\s+)/i,
    /^(?:latest\s+(?:news|updates?|info)\s+(?:about|on)\s+)/i,
    /^(?:how\s+many\s+(?:subscribers|followers|views|likes)\s+(?:does|has|is)\s+)/i,
    /^who\s+(?:is|was|are)\s+(?!the\s+(?:best|worst|same|only|one|most)\b)/i,
    /^(?:what\s+is\s+(?:the\s+)?(?:current|today'?s|this\s+(?:week|month|year)'?s)\s+)/i,
    /^(?:ابحث\s+في\s+(?:الانترنت|الإنترنت|النت)\s+)/i,
    /^(?:ابحث\s+(?:لي\s+)?عن\s+)/i,
    /^(?:ابحث\s+)(?:عنه|عنها|عنهم|عنك)(?:\s+في\s+(?:الانترنت|الإنترنت|النت))?/i,
    /^(?:دور|شوف|فتش)\s+(?:عليها|عليه|عليهم|عليك)(?:\s+في\s+(?:الانترنت|الإنترنت|النت))?/i,
    /^(?:دور|فتش)\s+(?:في\s+)?(?:غوغل|جوجل|النت|الانترنت|الإنترنت)\s+/i,
    /^(?:شوف|فتش)\s+(?:في\s+)?(?:النت|الانترنت|الإنترنت)(?:\s+|$)/i,
    /^(?:هات\s+مصادر|أعطني\s+روابط|اعطني\s+روابط|هات\s+روابط)(?:\s+|$)/i,
    /^(?:اعطني|أعطني)\s+(?:مصادر|معلومة)\s+(?:عن|حول)\s+/i,
    /^(?:مصادر\s+|روابط\s+)(?:عن|حول)\s+/i,
    /^(?:آخر\s+أخبار\s+)/i,
    /^(?:من\s+أين\s+أتيت\s+)/i,
    /^(?:هل\s+هذه\s+المعلومة\s+محدثة)/i,
    /^(?:كم\s+(?:عدد\s+)?(?:مشترك|مشتركين|متابع|متابعين|مشاهدة|مشاهدات)\s*)/i,
    /^(?:كم\s+لديه\s+من\s+(?:متابع|مشترك|مشتركين|متابعين))/i,
    /^(?:ابحث\s+عن\s+آخر\s+إحصائيات|آخر\s+إحصائيات\s+)/i,
    /^(?:ما\s+(?:آخر|أحدث)\s+أخبار\s+)/i,
];
function isWebSearchQuery(text) {
    return SEARCH_PATTERNS.some(p => p.test(text.trim()));
}
export function classifyTask(messages, attachments) {
    if (attachments && attachments.some(a => a.kind === 'image')) {
        return 'image_vision';
    }
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser)
        return 'unknown';
    // Detect image content from array-format messages (when classifyTask is called without attachments)
    if (Array.isArray(lastUser.content)) {
        const hasImage = lastUser.content.some((p) => p.type === 'image_url' && p.image_url?.url);
        if (hasImage)
            return 'image_vision';
    }
    const raw = typeof lastUser.content === 'string' ? lastUser.content : '';
    const text = raw.trim();
    if (!text)
        return 'unknown';
    if (/^\/browser\s/i.test(text))
        return 'browser_task';
    if (/^\/skill\s/i.test(text) || /^@skill\s/i.test(text))
        return 'skill_task';
    // Arabic image/video analysis prompts (no \b — word boundary does not work with Arabic in JS)
    if (/^(?:ما\s+هذا|ما\s+هذه)$/i.test(text) ||
        /^(?:اشرح|شرح|حلل|وصف|صِف|اقرأ|اقرا|شوف|تعرف)\s+(?:لي\s+)?(?:هذه|هذا|الصورة|الصوره|الشكل|الرسم)/i.test(text)) {
        return 'image_vision';
    }
    if (isGreeting(text))
        return 'simple_chat';
    if (isWebSearchQuery(text))
        return 'search';
    const lower = text.toLowerCase();
    const words = text.split(/\s+/).filter(Boolean);
    const searchOrProjectKeywords = /\b(?:code|file|files|repo|project|debug|bug|error|stack|trace|fix|edit|change|modify|implement|refactor|review|search|find|grep|read|run|test|build|compile|function|class|type|interface|component|route|api)\b/i;
    if (words.length < 5 && !searchOrProjectKeywords.test(text))
        return 'simple_chat';
    const debuggingKeywords = /\b(?:debug|bug|error|stack trace|exception|crash|failing|fails|failure|broken|not working|timed out|timeout|rate limit|429)\b/i;
    const reviewKeywords = /\b(?:review|audit|inspect|check)\b.*\b(?:code|diff|pr|pull request|changes?|implementation)\b/i;
    const planningKeywords = /\b(?:plan|design|architecture|approach|strategy|roadmap|steps|break down|think through)\b/i;
    const editKeywords = /\b(?:change|update|modify|create|add|fix|edit|refactor|rename|delete|remove|rewrite|implement|build|setup|configure)\b/i;
    const scanKeywords = /\b(?:scan|explore|analyze|audit|review|inspect|summarize)\b.*\b(?:project|codebase|repo|app|structure)\b/i;
    const codingKeywords = /\b(?:code|function|class|variable|type|interface|import|export|npm|yarn|package|config|build|test|api|endpoint|route|component|hook|state|effect|promise|async|await|callback|module|bundle|deploy)\b/i;
    const reasoningKeywords = /\b(?:explain|describe|compare|contrast|analyze|evaluate|why|how\s+does|what\s+is\s+the\s+difference|what\s+are\s+the\s+pros|write\s+a\s+detailed|comprehensive)\b/i;
    if (debuggingKeywords.test(text))
        return 'debugging';
    if (reviewKeywords.test(text))
        return 'code_review';
    if (scanKeywords.test(text))
        return 'long_context';
    if (planningKeywords.test(text))
        return 'planning';
    if (editKeywords.test(text) && text.length < 100)
        return 'code_edit';
    if (codingKeywords.test(lower) || /\b(?:how\s+to|how\s+do\s+I|how\s+can\s+I)\s+\w+\s+(?:in|with|using)\s+/i.test(text)) {
        if (text.length > 150 || reasoningKeywords.test(text))
            return 'long_context';
        return 'code_edit';
    }
    if (text.length > 200 || reasoningKeywords.test(text))
        return 'long_context';
    if (text.length < 60 && !/\b(?:read|edit|write|run|execute|find|search)\b/i.test(text))
        return 'simple_chat';
    return 'planning';
}
//# sourceMappingURL=task-classifier.js.map