import React from 'react';
import Editor from '@monaco-editor/react';

type RightTab = 'code' | 'diff' | 'terminal';

interface RightPanelProps {
  tab: RightTab;
  onTabChange: (tab: RightTab) => void;
  onClose: () => void;
  selectedFile: string | null;
  fileContent: string;
  onFileChange: (content: string) => void;
  onSave: () => void;
  saveMsg: string | null;
  diffContent: string | null;
  diffPath: string | null;
  terminalOutput: string | null;
  terminalType: 'output' | 'error';
}

function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', html: 'html',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', sh: 'shell', bash: 'shell', sql: 'sql',
    graphql: 'graphql', xml: 'xml', svg: 'xml',
  };
  return map[ext] || 'plaintext';
}

export default function RightPanel({
  tab, onTabChange, onClose,
  selectedFile, fileContent, onFileChange, onSave, saveMsg,
  diffContent, diffPath,
  terminalOutput, terminalType,
}: RightPanelProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopyFile = () => {
    if (!fileContent) return;
    navigator.clipboard.writeText(fileContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="right-panel">
      <div className="right-panel-header">
        <div className="right-panel-tabs">
          <button className={`rp-tab ${tab === 'code' ? 'active' : ''}`} onClick={() => onTabChange('code')}>Code</button>
          <button className={`rp-tab ${tab === 'diff' ? 'active' : ''}`} onClick={() => onTabChange('diff')}>Diff</button>
          <button className={`rp-tab ${tab === 'terminal' ? 'active' : ''}`} onClick={() => onTabChange('terminal')}>Terminal</button>
        </div>
        <button className="rp-close" onClick={onClose}>x</button>
      </div>
      <div className="right-panel-body">
        {tab === 'code' && (
          selectedFile ? (
            <>
              <div className="rp-file-info">
                <span className="rp-file-path">{selectedFile}</span>
              </div>
              <div className="rp-actions">
                {saveMsg && (
                  <span className={`rp-save-msg ${saveMsg.includes('Error') ? 'error' : 'success'}`}>{saveMsg}</span>
                )}
                <button className="rp-action-btn" onClick={handleCopyFile}>{copied ? 'Copied' : 'Copy'}</button>
                <button className="rp-action-btn primary" onClick={onSave}>Save</button>
              </div>
              <div className="right-panel-editor">
                <Editor
                  height="100%"
                  language={getLanguage(selectedFile)}
                  value={fileContent}
                  onChange={(val) => onFileChange(val || '')}
                  theme="vs-dark"
                  options={{
                    fontSize: 13,
                    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    renderWhitespace: 'selection',
                    tabSize: 2,
                    wordWrap: 'on',
                  }}
                />
              </div>
            </>
          ) : (
            <div className="right-panel-empty">
              <span className="rp-empty-icon">&gt;_</span>
              <span>Select a file to preview</span>
            </div>
          )
        )}
        {tab === 'diff' && (
          diffContent ? (
            <div className="rp-diff">
              <div className="rp-diff-path">{diffPath || 'Diff'}</div>
              <div className="rp-diff-body">
                {diffContent.split('\n').map((line, i) => {
                  let cls = '';
                  if (line.startsWith('+')) cls = 'diff-add';
                  else if (line.startsWith('-')) cls = 'diff-remove';
                  else if (line.startsWith('@@')) cls = 'diff-header';
                  return <div key={i} className={cls}>{line}</div>;
                })}
              </div>
            </div>
          ) : (
            <div className="right-panel-empty">No diff to show</div>
          )
        )}
        {tab === 'terminal' && (
          terminalOutput ? (
            <div className="rp-terminal">
              <div className={terminalType === 'error' ? 'term-error' : 'term-output'}>{terminalOutput}</div>
            </div>
          ) : (
            <div className="right-panel-empty">No terminal output</div>
          )
        )}
      </div>
    </div>
  );
}
