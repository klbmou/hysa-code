import React, { useState, useEffect, useCallback, useRef } from 'react';
import TopBar from './components/TopBar.js';
import FileTree from './components/FileTree.js';
import RightPanel from './components/RightPanel.js';
import Composer, { Attachment } from './components/Composer.js';
import WelcomeScreen from './components/WelcomeScreen.js';
import ToolEvent from './components/ToolEvent.js';
import DiffCard from './components/DiffCard.js';
import CommandCard from './components/CommandCard.js';
import StatusBar from './components/StatusBar.js';

const TIMEOUT_MS = 30000;
const CONFIRM_PATTERNS = [/^(ok\s*)?do\s*it$/i, /^yes$/i, /^apply$/i, /^go\s*ahead$/i, /^proceed$/i, /^yeah\s*do\s*it$/i];
const PROPOSAL_PATTERNS = [/should I/i, /would you like/i, /i can start/i, /shall I/i];

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
  | { kind: 'tool_event'; eventType: 'read' | 'edit' | 'done' | 'run' | 'error' | 'fallback'; message: string }
  | { kind: 'diff_card'; filePath: string; content: string; diff: string }
  | { kind: 'command_card'; command: string }
);

type RightTab = 'code' | 'diff' | 'terminal';

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
  const [debug, setDebug] = useState(false);
  const [lastRawResponse, setLastRawResponse] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const thinkingStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatItems]);
  useEffect(() => { if (loading) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [loading]);

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {});
    fetch('/api/project/tree').then(r => r.json()).then(data => {
      setFiles(data.files || []);
      setFileCount(data.fileCount || 0);
    }).catch(() => {});
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

  const toggleYolo = useCallback(async () => {
    const newVal = !yolo; setYolo(newVal);
    try { await fetch('/api/yolo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: newVal }) }); } catch {}
  }, [yolo]);

  const clearState = useCallback(() => {
    if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setLoading(false);
    setElapsedSecs(0);
    setThinkingWarning('');
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
      addError('Provider timed out. Try another provider or HYSA AI.');
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
        const friendly = isRateLimited(errText) ? 'Provider is rate-limited. Try OpenRouter, Gemini, or HYSA AI.' : `Web API error: ${res.status}`;
        addError(friendly);
        return;
      }

      // ── Streaming path ──────────────────────────────
      if (useStream) {
        const reader = res.body?.getReader();
        if (!reader) { addError('Stream not available'); return; }

        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedText = '';
        let streamDone = false;
        let streamError: string | null = null;
        let finalToolCalls: any[] | null = null;
        let streamItemId: string | null = null;

        // Create a placeholder AI message that will be updated
        const placeholderItem: ChatItem = { id: nextId(), kind: 'ai_msg', content: '' };
        streamItemId = placeholderItem.id;
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
              } else if (event.type === 'done') {
                streamDone = true;
                accumulatedText = event.fullText || accumulatedText;
                finalToolCalls = event.toolCalls || [];
              } else if (event.type === 'error') {
                streamError = event.message || 'Stream error';
              }
            } catch { /* skip malformed SSE */ }
          }
        }

        // Process remaining buffer
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const event = JSON.parse(trimmed.slice(6));
              if (event.type === 'token') {
                accumulatedText += event.text;
              } else if (event.type === 'done') {
                streamDone = true;
                accumulatedText = event.fullText || accumulatedText;
                finalToolCalls = event.toolCalls || [];
              } else if (event.type === 'error') {
                streamError = event.message || 'Stream error';
              }
            } catch { /* skip */ }
          }
        }

        // Finalize the streaming message
        if (streamError) {
          setChatItems(prev => prev.map(item =>
            item.id === streamItemId && item.kind === 'ai_msg'
              ? { ...item, content: accumulatedText || `Error: ${streamError}` }
              : item
          ));
          addError(streamError);
        } else if (streamDone) {
          setChatItems(prev => prev.map(item =>
            item.id === streamItemId && item.kind === 'ai_msg'
              ? { ...item, content: accumulatedText }
              : item
          ));

          // Handle tool calls from stream response
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
                toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Proposed command: ${cmd}` });
                toolItems.push({ id: nextId(), kind: 'command_card', command: cmd });
              } else {
                toolItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Tool: ${tc.type}` });
              }
            }
            if (toolItems.length > 0) {
              setChatItems(prev => [...prev, ...toolItems]);
            }
          }
        } else {
          // Stream ended without done/error — likely incomplete
          setChatItems(prev => prev.map(item =>
            item.id === streamItemId && item.kind === 'ai_msg'
              ? { ...item, content: accumulatedText || '(Incomplete response)' }
              : item
          ));
        }
        return;
      }

      // ── Non-streaming path (tool tasks, fallback) ──
      let rawText: string;
      try {
        rawText = await res.text();
        if (debug) setLastRawResponse(rawText);
      } catch {
        addError('Failed to read response from API.');
        return;
      }

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        addError('Invalid response from API. Check provider configuration.');
        return;
      }

      if (data.error) {
        const errMsg = data.error.toLowerCase();
        if (errMsg.includes('rate') || errMsg.includes('limit') || errMsg.includes('quota') || errMsg.includes('429')) {
          addError('Provider is rate-limited. Try OpenRouter, Gemini, or HYSA AI.');
        } else if (errMsg.includes('timeout') || errMsg.includes('timed out')) {
          addError('Provider timed out. Try OpenRouter, Gemini, or HYSA AI.');
        } else if (errMsg.includes('fallback') || errMsg.includes('unavailable') || errMsg.includes('all providers')) {
          addError('All providers failed. Run hysa config to check your setup.');
        } else {
          addError(data.error);
        }
        return;
      }

      const assistantText = getAssistantText(data);
      const hasToolCalls = data.toolCalls && data.toolCalls.length > 0;

      if (!assistantText && !hasToolCalls) {
        addError('HYSA returned an empty response. Check provider configuration or try another provider.');
        return;
      }

      const newItems: ChatItem[] = [];

      if (data.fallbackEvents && data.fallbackEvents.length > 0) {
        for (const event of data.fallbackEvents) {
          newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'fallback', message: event });
        }
      }

      if (data.hint) {
        newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'fallback', message: `⚠ ${data.hint}` });
      }

      if (assistantText) {
        newItems.push({ id: nextId(), kind: 'ai_msg', content: assistantText });
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
            newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Proposed command: ${cmd}` });
            newItems.push({ id: nextId(), kind: 'command_card', command: cmd });
          } else {
            newItems.push({ id: nextId(), kind: 'tool_event', eventType: 'run', message: `Tool: ${tc.type}` });
          }
        }
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

      const msg = e.message ? e.message.toLowerCase() : '';
      console.debug(LOG, 'Error message:', msg);
      if (msg.includes('rate') || msg.includes('limit') || msg.includes('quota') || msg.includes('429') || msg.includes('overloaded')) {
        addError('Provider is rate-limited. Try OpenRouter, Gemini, or HYSA AI.');
      } else if (msg.includes('timeout') || msg.includes('timed out')) {
        addError('Provider timed out. Try another provider or HYSA AI.');
      } else if (msg.includes('fallback') || msg.includes('unavailable') || msg.includes('all providers')) {
        addError('All providers failed. Run hysa config to check your setup.');
      } else {
        const displayMsg = e.message || 'Unknown error';
        console.debug(LOG, 'Unhandled error:', displayMsg);
        addError(`HYSA could not get a response: ${displayMsg}`);
      }
    } finally {
      console.debug(LOG, '=== sendMessage finally ===');
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
      setLoading(false);
      setElapsedSecs(0);
      setThinkingWarning('');
      console.debug(LOG, '=== sendMessage end ===');
    }
  }, [chatItems, openFile, buildMessages, clearState, addError, debug, loading]);

  const handleCopyMessage = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  const hasItems = chatItems.length > 0;

  return (
    <div className="app">
      <TopBar status={status} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} yolo={yolo} onToggleYolo={toggleYolo} />
      <div className="app-body">
        <FileTree files={files} fileCount={fileCount} selectedFile={selectedFile} onSelect={openFile} collapsed={!sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="chat-area">
          <div className="chat-area-glow" />
          <div className="chat-column">
            <div className="session-controls">
              <button className={`session-btn ${yolo ? 'yolo' : 'safe'}`} onClick={toggleYolo}>
                <span className={`session-dot ${yolo ? 'yolo' : 'safe'}`} />
                {yolo ? 'YOLO' : 'Safe'}
              </button>
              <button className="session-btn" onClick={clearChat} disabled={!hasItems}>Clear chat</button>
              <button className="session-btn" onClick={() => { window.location.hash = '#/'; }}>Landing</button>
              <button className="session-btn" onClick={() => { window.location.hash = '#/files'; }}>Files page</button>
              <button className={`session-btn ${debug ? 'active' : ''}`} onClick={() => setDebug(!debug)} title="Toggle debug mode">
                {debug ? 'Debug ON' : 'Debug'}
              </button>
              <span className="session-provider">{status ? `${status.provider}` : 'Loading...'}</span>
            </div>

            <div className={`chat-messages ${!hasItems ? 'center-welcome' : ''}`}>
              {!hasItems ? (
                <WelcomeScreen onHint={sendMessage} fileCount={fileCount} status={status} yolo={yolo} />
              ) : (
                <>
                  {chatItems.map((item) => {
                    if (item.kind === 'user_msg') {
                      return (
                        <div key={item.id} className="message-row user">
                          <div className="user-msg-container">
                            <div className="bubble user">
                              {item.content && <div dir="auto">{item.content}</div>}
                            </div>
                            {item.attachments && item.attachments.length > 0 && (
                              <div className="msg-attachments">
                                {item.attachments.map(a => {
                                  let note = '';
                                  if (a.kind === 'image') {
                                    note = 'Image · ready for analysis';
                                    if (status && !status.visionCapable) {
                                      note = 'Image · will try vision-capable provider';
                                    }
                                  } else if (a.kind === 'pdf' && a.pdfStatus === 'ready') note = 'PDF · ready for analysis';
                                  else if (a.kind === 'pdf' && (a.pdfStatus === 'scanned_pdf' || a.pdfStatus === 'failed')) note = 'This PDF may be scanned or image-based. OCR is not enabled yet.';
                                  else if (a.kind === 'pdf' && a.pdfStatus === 'too_large') note = 'PDF too large for text extraction';
                                  else if (a.kind === 'pdf') note = 'PDF · ready for analysis';
                                  else if (a.kind === 'docx') note = 'Reading not enabled';
                                  return (
                                    <div key={a.id} className={`msg-attachment msg-attachment-${a.kind}`}>
                                      {a.kind === 'image' && a.previewUrl ? (
                                        <>
                                          <img src={a.previewUrl} alt={a.name} className="msg-attach-img" />
                                          <div className="msg-attach-image-content">
                                            <span className="msg-attach-name">{a.name}</span>
                                            <span className="msg-attach-size">{formatBytes(a.size)}</span>
                                          </div>
                                        </>
                                      ) : a.kind === 'text' ? (
                                        <span className="msg-attach-badge" style={{ color: ATTACH_EXT_COLOR[a.ext] || 'var(--text-dim)' }}>
                                          {ATTACH_EXT_LABEL[a.ext] || a.ext.slice(1).toUpperCase()}
                                        </span>
                                      ) : (
                                        <span className="msg-attach-badge">{a.kind === 'pdf' ? 'PDF' : 'DOCX'}</span>
                                      )}
                                      {a.kind !== 'image' && (
                                        <div className="msg-attach-info">
                                          <span className="msg-attach-name">{a.name}</span>
                                          <span className="msg-attach-size">
                                            {formatBytes(a.size)}
                                            {a.kind === 'pdf' && a.pdfCharCount ? ` · ${a.pdfCharCount.toLocaleString()} chars` : ''}
                                          </span>
                                        </div>
                                      )}
                                      {note && <span className="msg-attach-note">{note}</span>}
                                      {a.kind === 'pdf' && a.pdfTruncated && (
                                        <span className="msg-attach-truncated">PDF text was truncated for analysis.</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    if (item.kind === 'ai_msg') {
                      return (
                        <div key={item.id} className="message-row assistant">
                          <div className="avatar ai">H</div>
                          <div className="bubble assistant" dir="auto">{item.content}</div>
                          <div className="message-actions">
                            <button className="msg-action-btn" onClick={() => handleCopyMessage(item.content)} title="Copy">[Copy]</button>
                          </div>
                        </div>
                      );
                    }
                    if (item.kind === 'tool_event') {
                      return <ToolEvent key={item.id} type={item.eventType} message={item.message} />;
                    }
                    if (item.kind === 'diff_card') {
                      return <DiffCard key={item.id} filePath={item.filePath} diff={item.diff} content={item.content} onApply={applyEdit} onOpenFile={openFile} />;
                    }
                    if (item.kind === 'command_card') {
                      return <CommandCard key={item.id} command={item.command} onRun={runCommand} />;
                    }
                    return null;
                  })}
                  <div ref={chatEndRef} />
                </>
              )}
            </div>

            {loading && (
              <div className="thinking-bar">
                <span className="tb-dot-pulse"><span></span><span></span><span></span></span>
                <span className="tb-text">HYSA is working with {status ? status.provider : '?'} / {status ? status.model : '?'}...</span>
                <span className="tb-timer">{elapsedSecs}s</span>
                {thinkingWarning && <span className={`tb-warn ${elapsedSecs >= 25 ? 'tb-slow' : ''}`}>{thinkingWarning}</span>}
                <button className="tb-cancel" onClick={cancelThinking}>Cancel</button>
              </div>
            )}

            {debug && lastRawResponse && (
              <div className="debug-panel">
                <div className="debug-panel-header">
                  <span>Last API Response</span>
                  <button className="debug-panel-close" onClick={() => setLastRawResponse(null)}>x</button>
                </div>
                <pre className="debug-panel-body">{lastRawResponse}</pre>
              </div>
            )}

            {selectedFile && (
              <div className="composer-using-file">
                <span className="composer-using-file-icon">📄</span>
                <span>Using <strong>{selectedFile.split('/').pop()}</strong></span>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ATTACH_EXT_LABEL: Record<string, string> = {
  '.txt': 'TXT', '.md': 'MD', '.json': 'JSON', '.js': 'JS', '.ts': 'TS',
  '.tsx': 'TSX', '.jsx': 'JSX', '.css': 'CSS', '.html': 'HTML',
  '.png': 'IMG', '.jpg': 'IMG', '.jpeg': 'IMG', '.webp': 'IMG',
  '.pdf': 'PDF', '.docx': 'DOCX',
};

const ATTACH_EXT_COLOR: Record<string, string> = {
  '.txt': '#8888a0', '.md': '#a855f7', '.json': '#f59e0b', '.js': '#f7df1e',
  '.ts': '#3178c6', '.tsx': '#3178c6', '.jsx': '#61dafb', '.css': '#3b82f6',
  '.html': '#ef4444', '.png': '#22c55e', '.jpg': '#22c55e', '.jpeg': '#22c55e',
  '.webp': '#22c55e', '.pdf': '#ef4444', '.docx': '#3b82f6',
};
