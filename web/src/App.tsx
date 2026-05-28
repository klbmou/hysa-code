import React, { useState, useEffect, useCallback, useRef } from 'react';
import TopBar from './components/TopBar.js';
import FileTree from './components/FileTree.js';
import RightPanel from './components/RightPanel.js';
import Composer, { Attachment } from './components/Composer.js';
import WelcomeScreen from './components/WelcomeScreen.js';
import MessageBubble from './components/MessageBubble.js';
import HysaIntro from './components/HysaIntro.js';
import ToolEvent from './components/ToolEvent.js';
import DiffCard from './components/DiffCard.js';
import CommandCard from './components/CommandCard.js';
import PlanCard from './components/PlanCard.js';
import StatusBar from './components/StatusBar.js';

const TIMEOUT_MS = 30000;
const CONFIRM_PATTERNS = [/^(ok\s*)?do\s*it$/i, /^yes$/i, /^apply$/i, /^go\s*ahead$/i, /^proceed$/i, /^yeah\s*do\s*it$/i];
const PROPOSAL_PATTERNS = [/should I/i, /would you like/i, /i can start/i, /shall I/i];

type LoadingPhase = 'thinking' | 'reading' | 'running' | 'continuing' | 'finalizing' | '';

const PHASE_LABELS: Record<Exclude<LoadingPhase, ''>, string> = {
  thinking: 'Thinking...',
  reading: 'Reading project files...',
  running: 'Running safe command...',
  continuing: 'Continuing after tool result...',
  finalizing: 'Finalizing answer...',
};

interface TimingData {
  classification?: number;
  project_scan?: number;
  context_select?: number;
  provider?: number;
  total?: number;
  tool_steps?: number;
  routing_mode?: string;
  capability?: string;
  project_mode?: boolean;
  files_selected?: number;
}

const LOG = '[HYSA Web Chat]';

function getAssistantText(data: any): string {
  return data.message || data.response || data.content || data.text || data.assistantMessage || '';
}

interface StatusData {
  provider: string;
  model: string;
  tier: string;
  visionCapable: boolean;
  git: { branch: string | null; hasChanges: boolean } | null;
}

interface ToolCall {
  type: string;
  params: Record<string, string>;
}

type ChatItem = {
  id: string;
} & (
  | { kind: 'user_msg'; content: string; attachments?: Attachment[] }
  | { kind: 'ai_msg'; content: string }
  | { kind: 'plan_card'; plan: any; currentStep?: number }
  | { kind: 'tool_event'; eventType: 'read' | 'edit' | 'done' | 'run' | 'error' | 'fallback'; message: string }
  | { kind: 'diff_card'; filePath: string; content: string; diff: string }
  | { kind: 'command_card'; command: string; toolCall?: ToolCall }
  | { kind: 'tool_result'; content: string }
);

type RightTab = 'code' | 'diff' | 'terminal';

function isArabic(text: string): boolean {
  const arabicRange = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return arabicRange.test(text);
}

let idCounter = 0;
function nextId(): string { return `item_${++idCounter}`; }

function hasProposal(text: string): boolean {
  return PROPOSAL_PATTERNS.some(p => p.test(text)) || text.includes('```');
}

function isConfirmation(text: string): boolean {
  return CONFIRM_PATTERNS.some(p => p.test(text.trim()));
}

function isSimpleQuestion(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.length > 60) return false;
  const actionWords = /\b(read|edit|write|update|change|modify|create|add|fix|debug|run|exec|find|search|scan|symbol|import|show|open|check|look|list|tell|describe|apply|remove|delete|rename|move|copy|refactor)\b/i;
  return !actionWords.test(trimmed);
}

export default function App() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('code');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string | null>(null);
  const [terminalType, setTerminalType] = useState<'output' | 'error'>('output');
  const [yolo, setYolo] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [thinkingWarning, setThinkingWarning] = useState('');
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('');
  const [timingData, setTimingData] = useState<TimingData | null>(null);
  const [debug, setDebug] = useState(false);
  const [lastRawResponse, setLastRawResponse] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [revealPos, setRevealPos] = useState(0);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const thinkingStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingMsgsRef = useRef<{ role: string; content: string }[] | null>(null);
  const treeCacheRef = useRef<{ files: string[]; fileCount: number } | null>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatItems]);
  useEffect(() => { if (loading) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [loading]);

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {});
    // Use cached tree if available
    if (treeCacheRef.current) {
      setFiles(treeCacheRef.current.files);
      setFileCount(treeCacheRef.current.fileCount);
    } else {
      fetch('/api/project/tree').then(r => r.json()).then(data => {
        const result = { files: data.files || [], fileCount: data.fileCount || 0 };
        treeCacheRef.current = result;
        setFiles(result.files);
        setFileCount(result.fileCount);
      }).catch(() => {});
    }
    fetch('/api/yolo').then(r => r.json()).then(data => {
      if (data && typeof data.enabled === 'boolean') setYolo(data.enabled);
    }).catch(() => {});
  }, []);

  const openFile = useCallback(async (path: string) => {
    setSelectedFile(path);
    setRightOpen(true);
    setRightTab('code');
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setFileContent(data.content !== undefined ? data.content : `// ${data.error || 'Cannot read file'}`);
    } catch { setFileContent('// Error loading file'); }
  }, []);

  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    try {
      const res = await fetch('/api/file/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: fileContent }),
      });
      const data = await res.json();
      if (data.success) { setSaveMsg('Saved'); setTimeout(() => setSaveMsg(null), 2000); }
      else { setSaveMsg(`Error: ${data.error}`); setTimeout(() => setSaveMsg(null), 4000); }
    } catch { setSaveMsg('Error saving file'); setTimeout(() => setSaveMsg(null), 4000); }
  }, [selectedFile, fileContent]);

  const applyEdit = useCallback(async (filePath: string, content: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/file/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      });
      const data = await res.json();
      if (data.success) { if (selectedFile === filePath) setFileContent(content); return null; }
      return data.error || 'Failed to save';
    } catch (err: unknown) { return (err as Error).message; }
  }, [selectedFile]);

  const runCommand = useCallback(async (command: string) => {
    try {
      setRightOpen(true); setRightTab('terminal');
      setTerminalOutput(`Running: ${command}...`); setTerminalType('output');
      const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) });
      const data = await res.json();
      const outputText = data.stdout || ''; const errorText = data.error || data.stderr || '';
      if (errorText) { setTerminalType('error'); setTerminalOutput(errorText); }
      else { setTerminalOutput(outputText); }
      return { stdout: outputText, stderr: errorText, error: data.error };
    } catch (err: unknown) {
      const msg = (err as Error).message;
      setTerminalType('error'); setTerminalOutput(msg);
      return { stdout: '', stderr: msg, error: msg };
    }
  }, []);

  const buildMessages = useCallback((items: ChatItem[]): { role: string; content: string }[] => {
    const msgs: { role: string; content: string }[] = [];
    for (const item of items) {
      if (item.kind === 'user_msg') msgs.push({ role: 'user', content: item.content });
      else if (item.kind === 'ai_msg' && item.content) msgs.push({ role: 'assistant', content: item.content });
    }
    return msgs;
  }, []);

  const continueAfterTool = useCallback(async (tc: ToolCall, result: string) => {
    const msgs = pendingMsgsRef.current || buildMessages(chatItems);
    setLoading(true);
    setLoadingPhase('continuing');
    try {
      const res = await fetch('/api/chat/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs,
          toolCalls: [tc],
          toolResults: [result],
        }),
      });
      const data = await res.json();

      if (data.message) {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: data.message }]);
        pendingMsgsRef.current = msgs ? [...msgs, { role: 'assistant', content: data.message }] : null;
      }

      if (data.toolCalls && data.toolCalls.length > 0) {
        const toolItems: ChatItem[] = [];
        for (const t of data.toolCalls as ToolCall[]) {
          if (t.type === 'read_file') {
            toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'done', message: `Read ${t.params.filePath || ''}` });
            openFile(t.params.filePath || '');
          } else if (t.type === 'edit_file') {
            const fp = t.params.filePath || '';
            const nc = t.params.newContent || t.params.content || '';
            toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'edit', message: `Proposed edit for ${fp}` });
            try {
              const previewRes = await fetch('/api/file/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fp, content: nc }) });
              const previewData = await previewRes.json();
              toolItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: previewData.diff || 'No diff available' });
            } catch { toolItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: 'Error generating diff' }); }
          } else if (t.type === 'execute_command') {
            toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Command: ${t.params.command || ''}` });
            toolItems.push({ id: nextId(), kind: 'command_card', command: t.params.command || '', toolCall: t });
          } else {
            toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Tool: ${t.type}` });
          }
        }
        setChatItems(prev => [...prev, ...toolItems]);
      } else {
        pendingMsgsRef.current = null;
      }
    } catch {
      setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'Continuation failed. Please try again.' }]);
      pendingMsgsRef.current = null;
    } finally {
      setLoading(false);
      setLoadingPhase('');
    }
  }, [chatItems, buildMessages, openFile]);

  const toggleYolo = useCallback(async () => {
    const newVal = !yolo; setYolo(newVal);
    try { await fetch('/api/yolo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: newVal }) }); } catch {}
  }, [yolo]);

  const clearState = useCallback(() => {
    if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (revealTimerRef.current) { clearInterval(revealTimerRef.current); revealTimerRef.current = null; }
    setLoading(false);
    setElapsedSecs(0);
    setThinkingWarning('');
    setLoadingPhase('');
    setRevealingId(null);
    setRevealPos(0);
  }, []);

  const cancelThinking = useCallback(() => {
    console.debug(LOG, 'Cancel button clicked');
    clearState();
    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: 'Request canceled.' }]);
  }, [clearState]);

  const clearChat = useCallback(() => {
    console.debug(LOG, 'Clear chat');
    setChatItems([]);
    setLastRawResponse(null);
  }, []);

  const addError = useCallback((msg: string) => {
    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'error', message: msg }]);
  }, []);

  const sendMessage = useCallback(async (input: string, attachments?: Attachment[]) => {
    console.debug(LOG, '=== sendMessage start ===');
    console.debug(LOG, 'Input:', JSON.stringify(input));
    console.debug(LOG, 'Attachments:', attachments?.length || 0);
    console.debug(LOG, 'loading:', loading, 'debug:', debug);
    console.debug(LOG, 'chatItems count:', chatItems.length);

    if (revealTimerRef.current) { clearInterval(revealTimerRef.current); revealTimerRef.current = null; }
    setRevealingId(null);
    setRevealPos(0);

    if (input.startsWith('/')) {
      const cmd = input.slice(1).trim().toLowerCase();
      if (cmd === 'debug') {
        const newVal = !debug;
        setDebug(newVal);
        console.debug(LOG, 'Debug mode toggled:', newVal);
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: `Debug mode ${newVal ? 'ON' : 'OFF'}` }]);
        return;
      }
    }

    let finalInput = input;
    const lastAiItem = [...chatItems].reverse().find(i => i.kind === 'ai_msg' && i.content);
    if (lastAiItem && lastAiItem.kind === 'ai_msg') {
      const lastText = lastAiItem.content;
      if (isConfirmation(input) && hasProposal(lastText)) {
        finalInput = 'Proceed now. Use tools to inspect files and apply the requested change. Do not ask for confirmation again unless a dangerous command is required.';
        console.debug(LOG, 'Confirmation detected, replaced with proceed instruction');
      }
    }

    const userItem: ChatItem = { id: nextId(), kind: 'user_msg', content: finalInput, attachments };
    setChatItems(prev => [...prev, userItem]);
    setLoading(true);
    setLoadingPhase('thinking');
    setTimingData(null);
    setElapsedSecs(0);
    setThinkingWarning('');

    console.debug(LOG, 'User message added, loading=true');

    thinkingStartRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - thinkingStartRef.current) / 1000);
      setElapsedSecs(secs);
      if (secs >= 8 && secs < 20) setThinkingWarning('Still working... provider may be slow.');
      else if (secs >= 20) setThinkingWarning('Provider may be slow or rate-limited. Try OpenRouter, Gemini, or HYSA AI.');
    }, 1000);

    const controller = new AbortController();
    abortRef.current = controller;

    timeoutRef.current = setTimeout(() => {
      console.debug(LOG, 'Request timed out after 45s');
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      clearState();
      setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'The provider did not respond in time. Try again shortly or switch providers.' }]);
    }, TIMEOUT_MS);

    try {
      const chatMessages = buildMessages([...chatItems, userItem]);
      const payload: any = { messages: chatMessages };
      if (attachments && attachments.length > 0) {
        payload.attachments = attachments.map(a => ({
          name: a.name, ext: a.ext, size: a.size, kind: a.kind,
          textContent: (a.kind === 'text' || a.kind === 'pdf') ? a.textContent : undefined,
          dataUrl: a.kind === 'image' ? a.previewUrl : undefined,
        }));
      }
      const lastUserContent = finalInput;
      const useStream = isSimpleQuestion(lastUserContent);
      const apiEndpoint = useStream ? '/api/chat/stream' : '/api/chat';

      console.debug(LOG, `Sending to ${apiEndpoint}, messages:`, chatMessages.length, 'stream:', useStream);

      const res = await fetch(apiEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      console.debug(LOG, 'Response status:', res.status, res.statusText);

      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.debug(LOG, 'Non-200 response body:', errText);
        if (debug) setLastRawResponse(errText || `Status ${res.status}`);
        const newItems: ChatItem[] = [];
        newItems.push({ id: nextId(), kind: 'ai_msg', content: isRateLimited(errText) ? 'The provider is rate-limited or unavailable. Try again shortly or switch providers.' : 'Could not reach the server. Try again.' });
        if (debug) newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'error', message: errText || `Status ${res.status}` });
        setChatItems(prev => [...prev, ...newItems]);
        return;
      }

      // ── Streaming path ──────────────────────────────
      if (useStream) {
        const reader = res.body?.getReader();
        if (!reader) { setStreamingId(null); setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'Stream not available. Try again without streaming.' }]); return; }

        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedText = '';
        let streamDone = false;
        let streamError: string | null = null;
        let finalToolCalls: any[] | null = null;
        let streamItemId: string | null = null;

        const placeholderItem: ChatItem = { id: nextId(), kind: 'ai_msg', content: '' };
        streamItemId = placeholderItem.id;
        setStreamingId(placeholderItem.id);
        setChatItems(prev => [...prev, placeholderItem]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            try {
              const event = JSON.parse(trimmed.slice(6));

                  if (event.type === 'token') {
                    if (!accumulatedText) {
                      setLoading(false);
                    }
                    accumulatedText += event.text;
                    setChatItems(prev => prev.map(item =>
                      item.id === streamItemId && item.kind === 'ai_msg'
                        ? { ...item, content: accumulatedText }
                        : item
                    ));
                  } else if (event.type === 'tool_result' && event.status === 'executing') {
                    setLoadingPhase('running');
                    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: `Step ${event.step}/${event.total}: Auto-executing tools...` }]);
                  } else if (event.type === 'tool_result' && event.status === 'done') {
                    setLoadingPhase('finalizing');
                    const resultItem: ChatItem = { id: nextId(), kind: 'tool_result', content: event.results || '' };
                    setChatItems(prev => [...prev, resultItem]);
                  } else if (event.type === 'fallback' && debug) {
                    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'fallback', message: event.message || '' }]);
                  } else if (event.type === 'plan') {
                    setChatItems(prev => [...prev, { id: nextId(), kind: 'plan_card', plan: event.plan }]);
                  } else if (event.type === 'plan_update') {
                    setChatItems(prev => {
                      const idx = prev.length - 1;
                      for (let i = prev.length - 1; i >= 0; i--) {
                        if (prev[i].kind === 'plan_card') {
                          return prev.map((item, j) => j === i ? { ...item, plan: event.plan, currentStep: event.stepIndex } : item);
                        }
                      }
                      return prev;
                    });
                  } else if (event.type === 'done') {
                    streamDone = true;
                    accumulatedText = event.fullText || accumulatedText;
                    finalToolCalls = event.toolCalls || [];
                    if (event.timing) setTimingData(event.timing);
                    if (event.plan) {
                      setChatItems(prev => {
                        for (let i = prev.length - 1; i >= 0; i--) {
                          if (prev[i].kind === 'plan_card') {
                            return prev.map((item, j) => j === i ? { ...item, plan: event.plan } : item);
                          }
                        }
                        return [...prev, { id: nextId(), kind: 'plan_card', plan: event.plan }];
                      });
                    }
                  } else if (event.type === 'error') {
                    streamError = event.message || '';
                  }
            } catch { /* skip malformed SSE */ }
          }
        }

        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const event = JSON.parse(trimmed.slice(6));
              if (event.type === 'token') {
                accumulatedText += event.text;
              } else if (event.type === 'tool_result' && event.status === 'executing') {
                setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: `Step ${event.step}/${event.total}: Auto-executing tools...` }]);
              } else if (event.type === 'tool_result' && event.status === 'done') {
                setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_result', content: event.results || '' }]);
              } else if (event.type === 'fallback' && debug) {
                setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'fallback', message: event.message || '' }]);
              } else if (event.type === 'plan') {
                setChatItems(prev => [...prev, { id: nextId(), kind: 'plan_card', plan: event.plan }]);
              } else if (event.type === 'plan_update') {
                setChatItems(prev => {
                  for (let i = prev.length - 1; i >= 0; i--) {
                    if (prev[i].kind === 'plan_card') {
                      return prev.map((item, j) => j === i ? { ...item, plan: event.plan, currentStep: event.stepIndex } : item);
                    }
                  }
                  return prev;
                });
              } else if (event.type === 'done') {
                streamDone = true;
                accumulatedText = event.fullText || accumulatedText;
                finalToolCalls = event.toolCalls || [];
                if (event.timing) setTimingData(event.timing);
                if (event.plan) {
                  setChatItems(prev => {
                    for (let i = prev.length - 1; i >= 0; i--) {
                      if (prev[i].kind === 'plan_card') {
                        return prev.map((item, j) => j === i ? { ...item, plan: event.plan } : item);
                      }
                    }
                    return [...prev, { id: nextId(), kind: 'plan_card', plan: event.plan }];
                  });
                }
              } else if (event.type === 'error') {
                streamError = event.message || '';
              }
            } catch { /* skip */ }
          }
        }

        setStreamingId(null);
        if (streamError) {
          setChatItems(prev => prev.map(item =>
            item.id === streamItemId && item.kind === 'ai_msg'
              ? { ...item, content: accumulatedText || streamError }
              : item
          ));
        } else if (streamDone) {
          setChatItems(prev => prev.map(item =>
            item.id === streamItemId && item.kind === 'ai_msg'
              ? { ...item, content: accumulatedText }
              : item
          ));

          if (finalToolCalls && finalToolCalls.length > 0) {
            const toolItems: ChatItem[] = [];
            for (const tc of finalToolCalls) {
              if (tc.type === 'read_file') {
                const fp = tc.params.filePath || '';
                toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'done', message: `Read ${fp}` });
                openFile(fp);
              } else if (tc.type === 'edit_file') {
                const fp = tc.params.filePath || '';
                const nc = tc.params.newContent || tc.params.content || '';
                toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'edit', message: `Proposed edit for ${fp}` });
                try {
                  const previewRes = await fetch('/api/file/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fp, content: nc }) });
                  const previewData = await previewRes.json();
                  toolItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: previewData.diff || 'No diff available' });
                } catch { toolItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: 'Error generating diff' }); }
              } else if (tc.type === 'execute_command') {
                const cmd = tc.params.command || '';
                toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Command: ${cmd}` });
                toolItems.push({ id: nextId(), kind: 'command_card', command: cmd, toolCall: tc });
              } else {
                toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Tool: ${tc.type}` });
              }
            }
            if (toolItems.length > 0) {
              setChatItems(prev => [...prev, ...toolItems]);
            }
            // Save pending messages for continuation (include streaming AI response)
            const streamMsgs = buildMessages(chatItems);
            if (accumulatedText) {
              streamMsgs.push({ role: 'assistant', content: accumulatedText });
            }
            pendingMsgsRef.current = streamMsgs;
          }
        } else {
          setStreamingId(null);
          setChatItems(prev => prev.map(item =>
            item.id === streamItemId && item.kind === 'ai_msg'
              ? { ...item, content: accumulatedText || '(Incomplete response)' }
              : item
          ));
        }
        return;
      }

      // ── Non-streaming path ──────────────────────────
      let rawText: string;
      try {
        rawText = await res.text();
        if (debug) setLastRawResponse(rawText);
      } catch {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'An unexpected error occurred. Try again shortly.' }]);
        return;
      }

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'The server returned an unexpected response. Try again or switch providers.' }]);
        return;
      }

      const assistantText = getAssistantText(data);
      const hasToolCalls = data.toolCalls && data.toolCalls.length > 0;
      if (data.timing) setTimingData(data.timing);

      if (data.error && !assistantText && !hasToolCalls) {
        const newItems: ChatItem[] = [];
        newItems.push({ id: nextId(), kind: 'ai_msg', content: debug ? `Error: ${data.error}` : 'An unexpected error occurred. Try again shortly.' });
        if (debug && data.debugError) {
          newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'error', message: data.debugError });
        }
        setChatItems(prev => [...prev, ...newItems]);
        return;
      }

      if (!assistantText && !hasToolCalls) {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'ai_msg', content: 'HYSA returned an empty response. Try again or switch providers.' }]);
        return;
      }

      const newItems: ChatItem[] = [];

      if (debug && data.fallbackEvents && data.fallbackEvents.length > 0) {
        for (const event of data.fallbackEvents) {
          newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'fallback', message: event });
        }
      }

      if (data.plan) {
        newItems.push({ id: nextId(), kind: 'plan_card', plan: data.plan });
      }

      if (assistantText) {
        const msgId = nextId();
        newItems.push({ id: msgId, kind: 'ai_msg', content: assistantText });
        if (!useStream) {
          if (revealTimerRef.current) { clearInterval(revealTimerRef.current); revealTimerRef.current = null; }
          setRevealingId(msgId);
          setRevealPos(0);
          const totalChars = assistantText.length;
          const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(assistantText);
          if (hasArabic) {
            const wordEnds: number[] = [];
            for (let i = 1; i <= totalChars; i++) {
              if (i === totalChars || /\s/.test(assistantText[i])) {
                wordEnds.push(i);
              }
            }
            if (wordEnds.length === 0) wordEnds.push(totalChars);
            let wi = 0;
            const msPer = Math.max(35, Math.min(80, Math.round(Math.min(5000, wordEnds.length * 50) / wordEnds.length)));
            revealTimerRef.current = setInterval(() => {
              wi++;
              if (wi >= wordEnds.length) {
                if (revealTimerRef.current) { clearInterval(revealTimerRef.current); revealTimerRef.current = null; }
                setRevealingId(null);
                setRevealPos(0);
                return;
              }
              setRevealPos(wordEnds[wi]);
            }, msPer);
          } else {
            const chunkSize = totalChars > 800 ? 15 : totalChars > 400 ? 8 : totalChars > 100 ? 5 : 3;
            const totalMs = Math.min(5000, Math.round(totalChars * 0.1));
            const steps = Math.ceil(totalChars / chunkSize);
            const msPerChunk = Math.max(25, Math.min(65, Math.round(totalMs / steps)));
            let pos = 0;
            revealTimerRef.current = setInterval(() => {
              pos += chunkSize;
              if (pos >= totalChars) {
                if (revealTimerRef.current) { clearInterval(revealTimerRef.current); revealTimerRef.current = null; }
                setRevealingId(null);
                setRevealPos(0);
                return;
              }
              setRevealPos(pos);
            }, msPerChunk);
          }
        }
      }

      if (hasToolCalls) {
        for (const tc of data.toolCalls as ToolCall[]) {
          if (tc.type === 'read_file') {
            const fp = tc.params.filePath || '';
            newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'done', message: `Read ${fp}` });
            openFile(fp);
          } else if (tc.type === 'edit_file') {
            const fp = tc.params.filePath || '';
            const nc = tc.params.newContent || tc.params.content || '';
            newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'edit', message: `Proposed edit for ${fp}` });
            try {
              const previewRes = await fetch('/api/file/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fp, content: nc }) });
              const previewData = await previewRes.json();
              newItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: previewData.diff || 'No diff available' });
            } catch { newItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: 'Error generating diff' }); }
          } else if (tc.type === 'execute_command') {
            const cmd = tc.params.command || '';
            newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Command: ${cmd}` });
            newItems.push({ id: nextId(), kind: 'command_card', command: cmd, toolCall: tc });
          } else {
            newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Tool: ${tc.type}` });
          }
        }
        // Save pending messages for continuation
        const msgsBefore = buildMessages(chatItems);
        msgsBefore.push({ role: 'user', content: finalInput });
        if (assistantText) {
          msgsBefore.push({ role: 'assistant', content: assistantText });
        }
        pendingMsgsRef.current = msgsBefore;
      }

      setChatItems(prev => [...prev, ...newItems]);
    } catch (err: unknown) {
      console.debug(LOG, 'Caught error:', err);
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      const alreadyHandled = !abortRef.current;
      if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setLoading(false);
      setElapsedSecs(0);
      setThinkingWarning('');

      if (alreadyHandled) {
        console.debug(LOG, 'Error already handled (abortRef was null), skipping');
        return;
      }

      const e = err as Error;
      if (e.name === 'AbortError') {
        console.debug(LOG, 'Request was aborted');
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: 'Request canceled.' }]);
        return;
      }

      const fallbackMsg = 'An unexpected error occurred. Try again shortly or switch providers.';
      const newItems: ChatItem[] = [];
      newItems.push({ id: nextId(), kind: 'ai_msg', content: fallbackMsg });
      if (debug && e.message) {
        newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'error', message: e.message.slice(0, 200) });
      }
      setChatItems(prev => [...prev, ...newItems]);
    } finally {
      console.debug(LOG, '=== sendMessage finally ===');
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
      setLoading(false);
      setElapsedSecs(0);
      setThinkingWarning('');
      setLoadingPhase('');
      console.debug(LOG, '=== sendMessage end ===');
    }
  }, [chatItems, openFile, buildMessages, clearState, addError, debug, loading]);

  const handleCopyMessage = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  const hasItems = chatItems.length > 0;

  return (
    <div className="app">
      <TopBar
        status={status}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        yolo={yolo}
        onToggleYolo={toggleYolo}
        debug={debug}
        onToggleDebug={() => setDebug(!debug)}
        onClearChat={clearChat}
        onFilesPage={() => { window.location.hash = '#/files'; }}
        onLanding={() => { window.location.hash = '#/'; }}
        hasItems={hasItems}
      />
      <div className="app-body">
        <FileTree files={files} fileCount={fileCount} selectedFile={selectedFile} onSelect={openFile} collapsed={!sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="chat-panel">
          <div className="messages-scroll">
            <div className={`chat-column${!hasItems ? ' empty' : ''}`}>
              {!hasItems ? (
                showIntro ? (
                  <HysaIntro onDone={() => setShowIntro(false)} />
                ) : (
                  <div className="center-welcome">
                    <WelcomeScreen onHint={sendMessage} fileCount={fileCount} status={status} yolo={yolo} />
                  </div>
                )
              ) : (
                <>
                  {chatItems.map((item, idx) => {
                    if (item.kind === 'user_msg') {
                      return (
                        <MessageBubble
                          key={item.id}
                          kind="user"
                          content={item.content}
                          attachments={item.attachments}
                        />
                      );
                    }
                    if (item.kind === 'ai_msg') {
                      const prevItem = idx > 0 ? chatItems[idx - 1] : null;
                      const sourceFiles = prevItem?.kind === 'user_msg' && prevItem.attachments?.length
                        ? prevItem.attachments.map(a => a.name).join(', ')
                        : null;
                      const isRevealing = item.id === revealingId;
                      const isStreaming = item.id === streamingId;
                      const displayContent = isRevealing
                        ? item.content.slice(0, revealPos)
                        : item.content;
                      return (
                        <MessageBubble
                          key={item.id}
                          kind="assistant"
                          content={displayContent}
                          onCopy={handleCopyMessage}
                          sourceFiles={sourceFiles || undefined}
                          streaming={isRevealing || isStreaming}
                          className={isRevealing || isStreaming ? 'streaming-row' : undefined}
                        />
                      );
                    }
                    if (item.kind === 'tool_event') {
                      return <ToolEvent key={item.id} type={item.eventType} message={item.message} />;
                    }
                    if (item.kind === 'diff_card') {
                      return (
                        <DiffCard
                          key={item.id}
                          filePath={item.filePath}
                          diff={item.diff}
                          content={item.content}
                          onApply={applyEdit}
                          onOpenFile={openFile}
                          yolo={yolo}
                          onComplete={(ok) => {
                            if (ok && pendingMsgsRef.current) {
                              continueAfterTool(
                                { type: 'edit_file', params: { filePath: item.filePath, content: item.content } },
                                'Edit applied successfully'
                              );
                            }
                          }}
                        />
                      );
                    }
                    if (item.kind === 'command_card') {
                      return (
                        <CommandCard
                          key={item.id}
                          command={item.command}
                          onRun={runCommand}
                          yolo={yolo}
                          autoRun={yolo && item.command ? false : undefined}
                          onComplete={item.toolCall ? (result) => {
                            const output = result.output || result.error || '';
                            if (output) continueAfterTool(item.toolCall!, output);
                          } : undefined}
                        />
                      );
                    }
                    if (item.kind === 'plan_card') {
                      return <PlanCard key={item.id} plan={item.plan} currentStep={item.currentStep} />;
                    }
                    if (item.kind === 'tool_result') {
                      return (
                        <div className="tool-result" key={item.id}>
                          <pre className="tool-result-pre">{item.content}</pre>
                        </div>
                      );
                    }
                    return null;
                  })}
                  <div ref={chatEndRef} />
                </>
              )}
            </div>

            {loading && (() => {
              const lastUser = [...chatItems].reverse().find(i => i.kind === 'user_msg');
              const lastUserArabic = lastUser?.kind === 'user_msg' && isArabic(lastUser.content);
              const phaseText = loadingPhase ? PHASE_LABELS[loadingPhase] : (
                lastUserArabic ? 'جارٍ نسج الرد...' : 'Weaving response...'
              );
              const warnText = lastUserArabic
                ? elapsedSecs >= 20 ? 'قد يكون المزود بطيئًا أو محدود المعدل. جرّب OpenRouter أو Gemini أو HYSA AI.' : elapsedSecs >= 8 ? 'لا يزال قيد العمل... قد يكون المزود بطيئًا.' : ''
                : thinkingWarning;
              return (
                <div className={`thinking-bar${loadingPhase ? ` phase-${loadingPhase}` : ''}`}>
                  <span className="tb-pixel-icon">&gt;</span>
                  <span className="tb-text">{phaseText}</span>
                  <span className="tb-timer">{elapsedSecs}s</span>
                  {warnText && <span className={`tb-warn ${elapsedSecs >= 25 ? 'tb-slow' : ''}`}>{warnText}</span>}
                  <button className="tb-cancel" onClick={cancelThinking}>Cancel</button>
                </div>
              );
            })()}

            {debug && lastRawResponse && (
              <div className="debug-panel">
                <div className="debug-panel-header">
                  <span>Last API Response</span>
                  <button className="debug-panel-close" onClick={() => setLastRawResponse(null)}>x</button>
                </div>
                <pre className="debug-panel-body">{lastRawResponse}</pre>
              </div>
            )}
            {debug && timingData && (
              <div className="debug-panel timing-panel">
                <div className="debug-panel-header">
                  <span>Timing &amp; Routing</span>
                  <button className="debug-panel-close" onClick={() => setTimingData(null)}>x</button>
                </div>
                <div className="timing-grid">
                  {timingData.routing_mode !== undefined && <div className="timing-row"><span className="timing-label">Routing mode</span><span className="timing-value">{timingData.routing_mode}</span></div>}
                  {timingData.capability !== undefined && <div className="timing-row"><span className="timing-label">Capability</span><span className="timing-value">{timingData.capability}</span></div>}
                  {timingData.project_mode !== undefined && <div className="timing-row"><span className="timing-label">Project mode</span><span className="timing-value">{String(timingData.project_mode)}</span></div>}
                  {timingData.files_selected !== undefined && <div className="timing-row"><span className="timing-label">Files selected</span><span className="timing-value">{timingData.files_selected}</span></div>}
                  {timingData.tool_steps !== undefined && <div className="timing-row"><span className="timing-label">Tool steps</span><span className="timing-value">{timingData.tool_steps}</span></div>}
                  {timingData.classification !== undefined && <div className="timing-row"><span className="timing-label">Classification</span><span className="timing-value">{timingData.classification}ms</span></div>}
                  {timingData.project_scan !== undefined && <div className="timing-row"><span className="timing-label">Project scan</span><span className="timing-value">{timingData.project_scan}ms</span></div>}
                  {timingData.context_select !== undefined && <div className="timing-row"><span className="timing-label">Context select</span><span className="timing-value">{timingData.context_select}ms</span></div>}
                  {timingData.provider !== undefined && <div className="timing-row"><span className="timing-label">Provider</span><span className="timing-value">{timingData.provider}ms</span></div>}
                  {timingData.total !== undefined && <div className="timing-row timing-total"><span className="timing-label">Total</span><span className="timing-value">{timingData.total}ms</span></div>}
                </div>
              </div>
            )}
            <Composer onSend={sendMessage} loading={loading} status={status} onCancel={cancelThinking} />
          </div>
        </div>
        {rightOpen && (
          <RightPanel tab={rightTab} onTabChange={setRightTab} onClose={() => setRightOpen(false)} selectedFile={selectedFile} fileContent={fileContent} onFileChange={setFileContent} onSave={saveFile} saveMsg={saveMsg} diffContent={diffContent} diffPath={diffPath} terminalOutput={terminalOutput} terminalType={terminalType} />
        )}
      </div>
      <StatusBar fileCount={fileCount} loading={loading} messageCount={chatItems.length} yolo={yolo} />
    </div>
  );
}

function isRateLimited(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('rate') || lower.includes('limit') || lower.includes('quota') || lower.includes('429') || lower.includes('overloaded');
}
