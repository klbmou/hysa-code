import React, { useState, useEffect, useCallback, useRef } from 'react';
import TopBar from './components/TopBar.js';
import FileTree from './components/FileTree.js';
import RightPanel from './components/RightPanel.js';
import Composer from './components/Composer.js';
import WelcomeScreen from './components/WelcomeScreen.js';
import ToolEvent from './components/ToolEvent.js';
import DiffCard from './components/DiffCard.js';
import CommandCard from './components/CommandCard.js';
import StatusBar from './components/StatusBar.js';

const TIMEOUT_MS = 45000;
const CONFIRM_PATTERNS = [/^(ok\s*)?do\s*it$/i, /^yes$/i, /^apply$/i, /^go\s*ahead$/i, /^proceed$/i, /^yeah\s*do\s*it$/i];
const PROPOSAL_PATTERNS = [/should I/i, /would you like/i, /i can start/i, /shall I/i];

interface StatusData {
  provider: string;
  model: string;
  tier: string;
  git: { branch: string | null; hasChanges: boolean } | null;
}

interface ToolCall {
  type: string;
  params: Record<string, string>;
}

type ChatItem = {
  id: string;
} & (
  | { kind: 'user_msg'; content: string }
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

  const cleanupThinking = useCallback(() => {
    if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setLoading(false); setElapsedSecs(0); setThinkingWarning('');
  }, []);

  const cancelThinking = useCallback(() => {
    cleanupThinking();
    setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: 'Request canceled.' }]);
  }, [cleanupThinking]);

  const clearChat = useCallback(() => {
    setChatItems([]);
  }, []);

  const sendMessage = useCallback(async (input: string) => {
    let finalInput = input;

    const lastAiItem = [...chatItems].reverse().find(i => i.kind === 'ai_msg' && i.content);
    if (lastAiItem && lastAiItem.kind === 'ai_msg') {
      const lastText = lastAiItem.content;
      if (isConfirmation(input) && hasProposal(lastText)) {
        finalInput = 'Proceed now. Use tools to inspect files and apply the requested change. Do not ask for confirmation again unless a dangerous command is required.';
      }
    }

    const userItem: ChatItem = { id: nextId(), kind: 'user_msg', content: finalInput };
    setChatItems(prev => [...prev, userItem]);
    setLoading(true); setElapsedSecs(0); setThinkingWarning('');

    thinkingStartRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - thinkingStartRef.current) / 1000);
      setElapsedSecs(secs);
      if (secs >= 10 && secs < 25) setThinkingWarning('Still working...');
      else if (secs >= 25) setThinkingWarning('This provider may be slow or rate-limited. Try another provider.');
    }, 1000);

    const controller = new AbortController();
    abortRef.current = controller;

    timeoutRef.current = setTimeout(() => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      cleanupThinking();
      setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'error', message: 'Provider timed out. Try another provider or HYSA AI.' }]);
    }, TIMEOUT_MS);

    try {
      const chatMessages = buildMessages([...chatItems, userItem]);
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatMessages }),
        signal: controller.signal,
      });

      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      cleanupThinking();

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const friendly = isRateLimited(errText) ? 'Provider is rate-limited. Try OpenRouter, Gemini, or HYSA AI.' : `Request failed (${res.status})`;
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'error', message: friendly }]);
        return;
      }

      const data = await res.json();

      if (data.error) {
        const errMsg = data.error.toLowerCase();
        if (errMsg.includes('rate') || errMsg.includes('limit') || errMsg.includes('quota') || errMsg.includes('429')) {
          setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'error', message: 'Provider is rate-limited. Try OpenRouter, Gemini, or HYSA AI.' }]);
        } else {
          setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'error', message: data.error }]);
        }
        return;
      }

      const newItems: ChatItem[] = [];
      if (data.message) newItems.push({ id: nextId(), kind: 'ai_msg', content: data.message });

      if (data.toolCalls && data.toolCalls.length > 0) {
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
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      const alreadyHandled = !abortRef.current;
      cleanupThinking();

      if (alreadyHandled) return;

      const e = err as Error;
      if (e.name === 'AbortError') {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: 'Request canceled.' }]);
        return;
      }

      const msg = e.message.toLowerCase();
      if (msg.includes('rate') || msg.includes('limit') || msg.includes('quota') || msg.includes('429') || msg.includes('overloaded')) {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'error', message: 'Provider is rate-limited. Try OpenRouter, Gemini, or HYSA AI.' }]);
      } else if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'error', message: 'Provider timed out. Try another provider or HYSA AI.' }]);
      } else {
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'error', message: e.message }]);
      }
    }
  }, [chatItems, openFile, buildMessages, cleanupThinking]);

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
              <button className="session-btn" onClick={() => { window.location.hash = '#/code'; window.location.reload(); }}>Open landing</button>
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
                          <div className="bubble user" dir="auto">{item.content}</div>
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
                <span className="tb-text">HYSA is working...</span>
                <span className="tb-timer">{elapsedSecs}s</span>
                {thinkingWarning && <span className={`tb-warn ${elapsedSecs >= 25 ? 'tb-slow' : ''}`}>{thinkingWarning}</span>}
                <button className="tb-cancel" onClick={cancelThinking}>Cancel</button>
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
