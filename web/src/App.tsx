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
  const messagesRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const thinkingStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const cancelThinking = useCallback(() => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setLoading(false); setElapsedSecs(0); setThinkingWarning('');
    setChatItems(prev => prev.filter(i => !i.id.endsWith('_think')));
  }, []);

  const clearChat = useCallback(() => {
    setChatItems([]);
  }, []);

  const sendMessage = useCallback(async (input: string) => {
    const userItem: ChatItem = { id: nextId(), kind: 'user_msg', content: input };
    setChatItems(prev => [...prev, userItem]);
    setLoading(true); setElapsedSecs(0); setThinkingWarning('');

    const aiId = nextId();
    const thinkId = aiId + '_think';
    setChatItems(prev => [...prev, { id: thinkId, kind: 'ai_msg', content: '' }]);

    thinkingStartRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - thinkingStartRef.current) / 1000);
      setElapsedSecs(secs);
      if (secs >= 10 && secs < 25) setThinkingWarning('Still thinking...');
      else if (secs >= 25) setThinkingWarning('This provider may be slow or rate-limited. Try another provider.');
    }, 1000);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const chatMessages = buildMessages([...chatItems, userItem]);
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatMessages }), signal: controller.signal,
      });

      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setElapsedSecs(0); setThinkingWarning('');
      setChatItems(prev => prev.filter(i => i.id !== thinkId));

      const data = await res.json();

      if (data.error) {
        const errMsg = data.error.toLowerCase();
        if (errMsg.includes('rate') || errMsg.includes('limit') || errMsg.includes('quota') || errMsg.includes('429')) {
          setChatItems(prev => [...prev, { id: aiId, kind: 'ai_msg', content: 'Provider is rate-limited. Try OpenRouter, Gemini, or HYSA AI.' }]);
        } else {
          setChatItems(prev => [...prev, { id: aiId, kind: 'ai_msg', content: `Error: ${data.error}` }]);
        }
        setLoading(false); return;
      }

      const newItems: ChatItem[] = [];
      if (data.message) newItems.push({ id: aiId, kind: 'ai_msg', content: data.message });

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
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setElapsedSecs(0); setThinkingWarning('');

      if ((err as Error).name === 'AbortError') {
        setChatItems(prev => prev.filter(i => i.id !== thinkId));
        setChatItems(prev => [...prev, { id: nextId(), kind: 'tool_event', eventType: 'done', message: 'Request canceled.' }]);
        setLoading(false); return;
      }

      setChatItems(prev => prev.filter(i => i.id !== thinkId));
      const msg = (err as Error).message.toLowerCase();
      if (msg.includes('rate') || msg.includes('limit') || msg.includes('quota')) {
        setChatItems(prev => [...prev, { id: aiId, kind: 'ai_msg', content: 'Provider is rate-limited. Try OpenRouter, Gemini, or HYSA AI.' }]);
      } else {
        setChatItems(prev => [...prev, { id: aiId, kind: 'ai_msg', content: `Error: ${(err as Error).message}` }]);
      }
    } finally {
      abortRef.current = null; setLoading(false);
    }
  }, [chatItems, openFile, buildMessages]);

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
            {/* Session controls */}
            <div className="session-controls">
              <button className={`session-btn ${yolo ? 'yolo' : 'safe'}`} onClick={toggleYolo}>
                <span className={`session-dot ${yolo ? 'yolo' : 'safe'}`} />
                {yolo ? 'YOLO' : 'Safe'}
              </button>
              <button className="session-btn" onClick={clearChat} disabled={!hasItems}>Clear chat</button>
              <button className="session-btn" onClick={() => { window.location.hash = '#/code'; window.location.reload(); }}>Open landing</button>
              <span className="session-provider">{status ? `${status.provider}` : 'Loading...'}</span>
              <span className="session-status">Web UI live</span>
            </div>

            <div className={`chat-messages ${hasItems ? 'has-items' : ''}`} ref={messagesRef}>
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
                      if (!item.content) {
                        return (
                          <div key={item.id} className="thinking-indicator">
                            <div className="dot-pulse"><span></span><span></span><span></span></div>
                            <span>HYSA is thinking...</span>
                            <span className="thinking-timer">{elapsedSecs}s</span>
                            {thinkingWarning && <span className={`thinking-warning${elapsedSecs >= 25 ? ' slow' : ''}`}>— {thinkingWarning}</span>}
                            <button className="thinking-cancel" onClick={cancelThinking}>Cancel</button>
                          </div>
                        );
                      }
                      return (
                        <div key={item.id} className="message-row assistant">
                          <div className="avatar ai">H</div>
                          <div className="bubble assistant" dir="auto">{item.content}</div>
                          <div className="message-actions">
                            <button className="msg-action-btn" onClick={() => handleCopyMessage(item.content!)} title="Copy">📋</button>
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
