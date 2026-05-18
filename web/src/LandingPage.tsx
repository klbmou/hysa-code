import React, { useState } from 'react';

const FEATURES = [
  { icon: '📖', title: 'Reads your project', desc: 'Understands your codebase before making changes.' },
  { icon: '✏️', title: 'Edits with diff approval', desc: 'Shows you exactly what changed before applying.' },
  { icon: '⚡', title: 'Runs commands safely', desc: 'Classifies commands by risk. Asks before dangerous operations.' },
  { icon: '🖥️', title: 'CLI + Web UI', desc: 'Works from your terminal or browser.' },
  { icon: '🔌', title: 'Many AI providers', desc: 'Anthropic, OpenAI, Gemini, Groq, DeepSeek, OpenRouter and more.' },
  { icon: '🆓', title: 'Local & free options', desc: 'Use local Ollama models or free API providers.' },
  { icon: '🤖', title: 'YOLO mode', desc: 'Skip confirmations for rapid iteration when you trust the AI.' },
  { icon: '🩺', title: 'Doctor diagnostics', desc: 'Check your setup, keys, and provider health.' },
];

const PROVIDERS = [
  'OpenRouter', 'Gemini', 'Groq', 'DeepSeek', 'OpenCode Zen',
  'Ollama', 'HYSA AI', 'Anthropic', 'OpenAI', 'Pollinations', 'LLM7', 'Puter',
];

const COMMANDS = [
  { cmd: 'hysa chat', desc: 'Start interactive chat with AI' },
  { cmd: 'hysa web', desc: 'Launch the Web UI' },
  { cmd: 'hysa config', desc: 'View or update configuration' },
  { cmd: 'hysa providers', desc: 'List all available providers' },
  { cmd: 'hysa doctor', desc: 'Run diagnostics' },
  { cmd: 'hysa models <provider>', desc: 'List models for a provider' },
  { cmd: 'hysa experimental on', desc: 'Enable experimental free providers' },
  { cmd: 'hysa yolo on', desc: 'Enable YOLO auto-apply mode' },
];

const ROADMAP = [
  'Better Web UI',
  'Stronger fallback engine',
  'HYSA AI local provider',
  'npm release',
  'VS Code extension',
  'GitHub PR automation',
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="lp-copy-btn" onClick={() => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }}>
      {copied ? '✓ Copied!' : '📋 Copy'}
    </button>
  );
}

export default function LandingPage() {
  const handleGetStarted = () => {
    window.location.hash = '#/chat';
    window.location.reload();
  };

  return (
    <div className="lp-root">
      {/* ── Nav ── */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <span className="lp-logo">HYSA Code</span>
          <div className="lp-nav-links">
            <a href="https://github.com/klbmou/hysa-code" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="#/chat" onClick={handleGetStarted}>Launch Chat</a>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-bg-glow" />
        <div className="lp-hero-content">
          <h1 className="lp-hero-title">HYSA Code</h1>
          <p className="lp-hero-headline">
            The AI coding assistant that actually edits your project.
          </p>
          <p className="lp-hero-sub">
            Chat with your codebase from the terminal or the browser. HYSA Code reads files,
            proposes changes, shows diffs, asks before writing, and can run commands safely.
          </p>
          <div className="lp-hero-buttons">
            <button className="lp-btn lp-btn-primary" onClick={handleGetStarted}>
              Install HYSA Code
            </button>
            <a
              href="https://github.com/klbmou/hysa-code"
              target="_blank"
              rel="noopener noreferrer"
              className="lp-btn lp-btn-secondary"
            >
              View on GitHub
            </a>
          </div>
          <div className="lp-install-block">
            <div className="lp-install-header">
              <span>Install</span>
              <CopyButton text="npm install -g github:klbmou/hysa-code#main" />
            </div>
            <pre className="lp-install-command">npm install -g github:klbmou/hysa-code#main</pre>
            <div className="lp-install-sub">
              <span><code>hysa chat</code> — start coding</span>
              <span><code>hysa web</code> — open the browser UI</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── What HYSA Code Does ── */}
      <section className="lp-section">
        <div className="lp-section-inner">
          <h2 className="lp-section-title">What HYSA Code does</h2>
          <div className="lp-cards-grid">
            {FEATURES.map(f => (
              <div key={f.title} className="lp-card">
                <span className="lp-card-icon">{f.icon}</span>
                <h3 className="lp-card-title">{f.title}</h3>
                <p className="lp-card-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Web + Terminal ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-section-inner">
          <h2 className="lp-section-title">Web + Terminal</h2>
          <p className="lp-section-desc">
            Two ways to work with HYSA Code. Choose what fits your flow.
          </p>
          <div className="lp-showcase">
            <div className="lp-showcase-card">
              <div className="lp-showcase-header">
                <span className="lp-showcase-dot" style={{ background: '#22c55e' }} />
                <span className="lp-showcase-dot" style={{ background: '#f59e0b' }} />
                <span className="lp-showcase-dot" style={{ background: '#ef4444' }} />
                <span className="lp-showcase-label">Terminal</span>
              </div>
              <div className="lp-showcase-body">
                <div className="lp-term-line"><span className="lp-term-prompt">$</span> hysa chat</div>
                <div className="lp-term-line lp-term-ai">┃ Hello! I can help with your code.</div>
                <div className="lp-term-line"><span className="lp-term-prompt">$</span> Add dark mode toggle to App.tsx</div>
                <div className="lp-term-line lp-term-ai">┃ I'll read App.tsx first...</div>
                <div className="lp-term-line lp-term-event">📖 Read src/App.tsx</div>
                <div className="lp-term-line lp-term-event">✅ Done. Here's the diff:</div>
                <div className="lp-term-line lp-term-diff">+ const [dark, setDark] = useState(false)</div>
                <div className="lp-term-line lp-term-pending">Apply this edit? (Y/n)</div>
              </div>
            </div>
            <div className="lp-showcase-card">
              <div className="lp-showcase-header">
                <span className="lp-showcase-dot" style={{ background: '#22c55e' }} />
                <span className="lp-showcase-dot" style={{ background: '#f59e0b' }} />
                <span className="lp-showcase-dot" style={{ background: '#ef4444' }} />
                <span className="lp-showcase-label">Web UI</span>
              </div>
              <div className="lp-showcase-body">
                <div className="lp-web-preview">
                  <div className="lp-web-bar">HYSA Code — dark mode toggle</div>
                  <div className="lp-web-chat">
                    <div className="lp-web-msg lp-web-user">Add dark mode toggle to App.tsx</div>
                    <div className="lp-web-msg lp-web-ai">
                      <div className="lp-web-event">📖 Read src/App.tsx</div>
                      <div className="lp-web-event">✅ Done. Adding dark mode:</div>
                      <div className="lp-web-diff-preview">
                        <div className="lp-web-diff-line add">+ const [dark, setDark] = useState(false)</div>
                        <div className="lp-web-diff-line add">+ const toggleDark = () =&gt; setDark(!dark)</div>
                      </div>
                      <div className="lp-web-btns">
                        <span className="lp-web-btn primary">Apply</span>
                        <span className="lp-web-btn">Discard</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Providers ── */}
      <section className="lp-section">
        <div className="lp-section-inner">
          <h2 className="lp-section-title">Supported providers</h2>
          <p className="lp-section-desc">
            Bring your own key, use local models, or connect the HYSA AI provider.
          </p>
          <div className="lp-pills">
            {PROVIDERS.map(p => (
              <span key={p} className="lp-pill">{p}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Safety ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-section-inner">
          <h2 className="lp-section-title">Safety first</h2>
          <p className="lp-section-desc">
            HYSA Code is designed to be safe by default. Nothing happens without your approval.
          </p>
          <div className="lp-safety-grid">
            {[
              { icon: '👁️', title: 'Diff before writing', desc: 'See every change before it is applied.' },
              { icon: '✅', title: 'Approval before edits', desc: 'You decide what gets written to disk.' },
              { icon: '📦', title: 'Backups before modifications', desc: 'Original files are backed up with .bak.' },
              { icon: '🛡️', title: 'Dangerous files blocked', desc: '.env, secrets, and build artifacts are protected.' },
              { icon: '🔐', title: 'Commands require confirmation', desc: 'Dangerous commands always ask first.' },
              { icon: '🤫', title: 'Secrets protected', desc: 'API keys are never exposed in debug output.' },
            ].map(s => (
              <div key={s.title} className="lp-card">
                <span className="lp-card-icon">{s.icon}</span>
                <h3 className="lp-card-title">{s.title}</h3>
                <p className="lp-card-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Commands ── */}
      <section className="lp-section">
        <div className="lp-section-inner">
          <h2 className="lp-section-title">Commands</h2>
          <p className="lp-section-desc">
            Everything you need from the terminal.
          </p>
          <div className="lp-commands">
            {COMMANDS.map(c => (
              <div key={c.cmd} className="lp-command-row">
                <code className="lp-command-code">{c.cmd}</code>
                <span className="lp-command-desc">{c.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Roadmap ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-section-inner">
          <h2 className="lp-section-title">Roadmap</h2>
          <p className="lp-section-desc">What is coming next.</p>
          <div className="lp-roadmap">
            {ROADMAP.map((item, i) => (
              <div key={item} className="lp-roadmap-item">
                <span className="lp-roadmap-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="lp-roadmap-text">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <h2 className="lp-footer-title">Start building with HYSA Code</h2>
          <div className="lp-footer-actions">
            <button className="lp-btn lp-btn-primary" onClick={handleGetStarted}>
              Get Started
            </button>
            <a
              href="https://github.com/klbmou/hysa-code"
              target="_blank"
              rel="noopener noreferrer"
              className="lp-btn lp-btn-secondary"
            >
              GitHub
            </a>
          </div>
          <p className="lp-footer-copy">HYSA Code — open-source AI coding assistant</p>
        </div>
      </footer>
    </div>
  );
}
