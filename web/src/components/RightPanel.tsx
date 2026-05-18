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
  return (
    <div className="right-panel">
      <div className="right-panel-tabs">
        <div className={`right-panel-tab ${tab === 'code' ? 'active' : ''}`} onClick={() => onTabChange('code')}>
          Code
        </div>
        <div className={`right-panel-tab ${tab === 'diff' ? 'active' : ''}`} onClick={() => onTabChange('diff')}>
          Diff
        </div>
        <div className={`right-panel-tab ${tab === 'terminal' ? 'active' : ''}`} onClick={() => onTabChange('terminal')}>
          Terminal
        </div>
        <button className="right-panel-close" onClick={onClose}>✕</button>
      </div>
      <div className="right-panel-body">
        {tab === 'code' && (
          selectedFile ? (
            <>
              <div className="right-panel-file-header">
                <span>{selectedFile}</span>
                <div>
                  {saveMsg && (
                    <span style={{ marginRight: 8, fontSize: 11, color: saveMsg.includes('Error') ? '#ef4444' : '#22c55e' }}>
                      {saveMsg}
                    </span>
                  )}
                  <button onClick={onSave}>Save</button>
                </div>
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
            <div className="right-panel-empty">Select a file to view its contents</div>
          )
        )}
        {tab === 'diff' && (
          diffContent ? (
            <div className="right-panel-diff">
              <div style={{ fontWeight: 600, color: '#a855f7', marginBottom: 8 }}>
                {diffPath || 'Diff'}
              </div>
              {diffContent.split('\n').map((line, i) => {
                let cls = '';
                if (line.startsWith('+')) cls = 'diff-add';
                else if (line.startsWith('-')) cls = 'diff-remove';
                else if (line.startsWith('@@')) cls = 'diff-header';
                return <div key={i} className={cls}>{line}</div>;
              })}
            </div>
          ) : (
            <div className="right-panel-empty">No diff to show</div>
          )
        )}
        {tab === 'terminal' && (
          terminalOutput ? (
            <div className="right-panel-terminal">
              <div className={terminalType === 'error' ? 'term-error' : 'term-output'}>
                {terminalOutput}
              </div>
            </div>
          ) : (
            <div className="right-panel-empty">No terminal output yet</div>
          )
        )}
      </div>
    </div>
  );
}
