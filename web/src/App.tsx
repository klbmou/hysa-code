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

// ── Types ─────────────────────────────────────────

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
  | { kind: 'tool_event'; eventType: 'read' | 'edit' | 'done' | 'run' | 'error'; message: string }
  | { kind: 'diff_card'; filePath: string; content: string; diff: string }
  | { kind: 'command_card'; command: string }
);

type RightTab = 'code' | 'diff' | 'terminal';

let idCounter = 0;
function nextId(): string {
  return `item_${++idCounter}`;
}

// ── App ───────────────────────────────────────────

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

  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatItems]);

  // Adjust scroll when loading changes (placeholder appears/disappears)
  useEffect(() => {
    if (loading) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [loading]);

  // Load initial data
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

  // Open file
  const openFile = useCallback(async (path: string) => {
    setSelectedFile(path);
    setRightOpen(true);
    setRightTab('code');
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setFileContent(data.content !== undefined ? data.content : `// ${data.error || 'Cannot read file'}`);
    } catch {
      setFileContent('// Error loading file');
    }
  }, []);

  // Save file
  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    try {
      const res = await fetch('/api/file/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: fileContent }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveMsg('Saved');
        setTimeout(() => setSaveMsg(null), 2000);
      } else {
        setSaveMsg(`Error: ${data.error}`);
        setTimeout(() => setSaveMsg(null), 4000);
      }
    } catch {
      setSaveMsg('Error saving file');
      setTimeout(() => setSaveMsg(null), 4000);
    }
  }, [selectedFile, fileContent]);

  // Apply diff edit
  const applyEdit = useCallback(async (filePath: string, content: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/file/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      });
      const data = await res.json();
      if (data.success) {
        if (selectedFile === filePath) {
          setFileContent(content);
        }
        return null;
      }
      return data.error || 'Failed to save';
    } catch (err: unknown) {
      return (err as Error).message;
    }
  }, [selectedFile]);

  // Run command
  const runCommand = useCallback(async (command: string): Promise<{ stdout: string; stderr: string; error?: string } | null> => {
    try {
      setRightOpen(true);
      setRightTab('terminal');
      setTerminalOutput(`Running: ${command}...`);
      setTerminalType('output');
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const data = await res.json();
      const outputText = data.stdout || '';
      const errorText = data.error || data.stderr || '';
      if (errorText) {
        setTerminalType('error');
        setTerminalOutput(errorText);
      } else {
        setTerminalOutput(outputText);
      }
      return { stdout: outputText, stderr: errorText, error: data.error };
    } catch (err: unknown) {
      const msg = (err as Error).message;
      setTerminalType('error');
      setTerminalOutput(msg);
      return { stdout: '', stderr: msg, error: msg };
    }
  }, []);

  // Build message list for API from chat items
  const buildMessages = useCallback((items: ChatItem[]): { role: string; content: string }[] => {
    const msgs: { role: string; content: string }[] = [];
    for (const item of items) {
      if (item.kind === 'user_msg') {
        msgs.push({ role: 'user', content: item.content });
      } else if (item.kind === 'ai_msg') {
        if (item.content) msgs.push({ role: 'assistant', content: item.content });
      }
    }
    return msgs;
  }, []);

  // Toggle YOLO mode
  const toggleYolo = useCallback(async () => {
    const newVal = !yolo;
    setYolo(newVal);
    try {
      await fetch('/api/yolo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newVal }),
      });
    } catch {}
  }, [yolo]);

  // Send chat message
  const sendMessage = useCallback(async (input: string) => {
    const userItem: ChatItem = { id: nextId(), kind: 'user_msg', content: input };
    setChatItems(prev => [...prev, userItem]);
    setLoading(true);

    const aiId = nextId();
    const thinkId = aiId + '_think';

    const thinkItem: ChatItem = { id: thinkId, kind: 'ai_msg', content: '' };
    setChatItems(prev => [...prev, thinkItem]);

    try {
      const chatMessages = buildMessages([...chatItems, userItem]);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatMessages }),
      });
      const data = await res.json();

      setChatItems(prev => prev.filter(i => i.id !== thinkId));

      if (data.error) {
        setChatItems(prev => [...prev, { id: aiId, kind: 'ai_msg', content: `Error: ${data.error}` }]);
        setLoading(false);
        return;
      }

      const newItems: ChatItem[] = [];

      if (data.message) {
        newItems.push({ id: aiId, kind: 'ai_msg', content: data.message });
      }

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
              const previewRes = await fetch('/api/file/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: fp, content: nc }),
              });
              const previewData = await previewRes.json();
              newItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: previewData.diff || 'No diff available' });
            } catch {
              newItems.push({ id: nextId(), kind: 'diff_card', filePath: fp, content: nc, diff: 'Error generating diff' });
            }
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
      setChatItems(prev => prev.filter(i => i.id !== thinkId));
      setChatItems(prev => [...prev, { id: aiId, kind: 'ai_msg', content: `Error: ${(err as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  }, [chatItems, openFile, buildMessages]);

  const hasItems = chatItems.length > 0;

  return (
    <div className="app">
      <TopBar status={status} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} yolo={yolo} onToggleYolo={toggleYolo} />
      <div className="app-body">
        <FileTree
          files={files}
          fileCount={fileCount}
          selectedFile={selectedFile}
          onSelect={openFile}
          collapsed={!sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className="chat-area">
          <div className="chat-column">
            <div className={`chat-messages ${hasItems ? 'has-items' : ''}`} ref={messagesRef}>
              {!hasItems ? (
                <WelcomeScreen onHint={sendMessage} />
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
                            <div className="dot-pulse">
                              <span></span><span></span><span></span>
                            </div>
                            Thinking...
                          </div>
                        );
                      }
                      return (
                        <div key={item.id} className="message-row assistant">
                          <div className="avatar ai">H</div>
                          <div className="bubble assistant" dir="auto">{item.content}</div>
                        </div>
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
                        />
                      );
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
            <Composer onSend={sendMessage} loading={loading} status={status} />
          </div>
        </div>
        {rightOpen && (
          <RightPanel
            tab={rightTab}
            onTabChange={setRightTab}
            onClose={() => setRightOpen(false)}
            selectedFile={selectedFile}
            fileContent={fileContent}
            onFileChange={setFileContent}
            onSave={saveFile}
            saveMsg={saveMsg}
            diffContent={diffContent}
            diffPath={diffPath}
            terminalOutput={terminalOutput}
            terminalType={terminalType}
          />
        )}
      </div>
      <StatusBar fileCount={fileCount} loading={loading} messageCount={chatItems.length} yolo={yolo} />
    </div>
  );
}
