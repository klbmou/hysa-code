import React, { useState, useEffect, useRef } from 'react';

// ── Static data ──────────────────────────────────

const WHY = [
  { icon: '</>', title: 'Open-source', desc: 'MIT licensed. Free to use, modify, and share.' },
  { icon: '>_', title: 'Terminal + browser', desc: 'Works wherever you code — CLI or Web UI.' },
  { icon: '⬡', title: 'Provider-flexible', desc: 'Bring your own key, use local models, or free APIs.' },
  { icon: '◈', title: 'Local & free options', desc: 'Ollama, OpenCode Zen, Gemini, Groq, DeepSeek, and more.' },
  { icon: '✓', title: 'Safer edits with approval', desc: 'Diff every change, approve before writing, backups automatic.' },
  { icon: '{ }', title: 'Built for real projects', desc: 'Reads your codebase, understands context, edits files directly.' },
];

const DEV_NOTES = [
  { id: 1, icon: '</>', text: 'I can review a diff before anything touches my files.', color: '#a855f7' },
  { id: 2, icon: '⬡', text: 'I can use OpenRouter, Gemini, Ollama, or my own HYSA AI provider.', color: '#3b82f6' },
  { id: 3, icon: '>_', text: 'It works in the terminal when I want speed, and the browser when I want visuals.', color: '#22c55e' },
  { id: 4, icon: '⚡', text: 'YOLO mode is there when I trust the project — off by default.', color: '#f59e0b' },
  { id: 5, icon: '◈', text: 'Doctor commands help debug provider problems in seconds.', color: '#ec4899' },
];

const WORKFLOW = [
  { icon: '📂', title: 'Open project', desc: 'Point HYSA Code at any local directory or open the Web UI.' },
  { icon: '💬', title: 'Ask HYSA', desc: 'Describe what you want to build, fix, or change in plain English.' },
  { icon: '📖', title: 'Read files', desc: 'HYSA reads relevant files to understand your codebase context.' },
  { icon: '📋', title: 'Review diff', desc: 'HYSA shows exactly what changed — additions green, removals red.' },
  { icon: '✅', title: 'Apply safely', desc: 'Approve the edit. HYSA writes the file and backs up the original.' },
  { icon: '⚡', title: 'Run commands', desc: 'Let HYSA run tests, linters, or builds — classified by risk level.' },
];

const PROVIDERS = [
  'OpenRouter', 'Gemini', 'Groq', 'DeepSeek', 'OpenCode Zen',
  'Ollama', 'HYSA AI', 'Anthropic', 'OpenAI',
];

const PROVIDER_GLOW: Record<string, string> = {
  'OpenRouter': '#a855f7',
  'Gemini': '#4285f4',
  'Groq': '#f97316',
  'DeepSeek': '#22c55e',
  'OpenCode Zen': '#06b6d4',
  'Ollama': '#6366f1',
  'HYSA AI': '#ec4899',
  'Anthropic': '#f59e0b',
  'OpenAI': '#10b981',
};

const SAFETY = [
  { icon: '🛡️', title: 'Diff before write', desc: 'See every change before it hits disk.' },
  { icon: '✓', title: 'Approval before edit', desc: 'You decide what gets written.' },
  { icon: '◈', title: 'Backups before write', desc: 'Original files backed up with .bak.' },
  { icon: '⛔', title: 'Dangerous files blocked', desc: '.env, lockfiles, build artifacts protected.' },
  { icon: '🔐', title: 'Commands need confirmation', desc: 'Dangerous commands always ask first.' },
  { icon: '⚡', title: 'YOLO mode optional', desc: 'Skip confirmations when you trust the AI.' },
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
  'npm release',
  'Stronger fallback engine',
  'Better local HYSA AI provider',
  'VS Code extension',
  'GitHub PR automation',
];

const PROVIDER_ORBIT = [
  'OpenRouter', 'Gemini', 'Groq', 'DeepSeek',
  'OpenCode Zen', 'Ollama', 'HYSA AI', 'Anthropic', 'OpenAI',
];

const STAR_PARTICLES = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  left: `${Math.random() * 100}%`,
  top: `${Math.random() * 100}%`,
  size: Math.random() * 2 + 1,
  delay: Math.random() * 5,
  color: ['rgba(168,85,247,0.6)', 'rgba(236,72,153,0.4)', 'rgba(59,130,246,0.5)'][Math.floor(Math.random() * 3)],
}));

// ── Components ───────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="lp-copy-btn" onClick={() => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }}>
      {copied ? '✓ Copied!' : 'Copy'}
    </button>
  );
}

function InstallTerminal() {
  const [tab, setTab] = useState<'release' | 'dev'>('release');
  const releaseCmd = 'npm install -g https://github.com/klbmou/hysa-code/releases/download/v0.2.0/hysa-code-0.2.0.tgz';
  const devCmds = [
    'git clone https://github.com/klbmou/hysa-code',
    'cd hysa-code',
    'npm install && npm run build && npm run build:web',
    'npm pack',
    'npm install -g ./hysa-code-0.2.0.tgz',
  ];

  return (
    <div className="lp-terminal-window">
      <div className="lp-terminal-header">
        <div className="lp-terminal-dots">
          <span className="lp-terminal-dot red" />
          <span className="lp-terminal-dot yellow" />
          <span className="lp-terminal-dot green" />
        </div>
        <span className="lp-terminal-title">install.sh</span>
        <CopyButton text={tab === 'release' ? releaseCmd : devCmds.join(' ; ')} />
      </div>
      <div className="lp-terminal-tabs">
        <button className={`lp-terminal-tab${tab === 'release' ? ' active' : ''}`} onClick={() => setTab('release')}>Release</button>
        <button className={`lp-terminal-tab${tab === 'dev' ? ' active' : ''}`} onClick={() => setTab('dev')}>Developer</button>
      </div>
      <div className="lp-terminal-body">
        {tab === 'release' ? (
          <div className="lp-terminal-line">
            <span className="lp-term-prompt-sign">$</span>
            <span className="lp-term-command">{releaseCmd}</span>
            <span className="lp-term-cursor" />
          </div>
        ) : (
          devCmds.map((cmd, i) => (
            <div key={i} className="lp-terminal-line">
              <span className="lp-term-prompt-sign">$</span>
              <span className="lp-term-command">{cmd}</span>
            </div>
          ))
        )}
      </div>
      {tab === 'release' && (
        <div className="lp-terminal-footer">
          <span className="lp-terminal-rec">Recommended</span>
          <span>Stable release · no build required</span>
        </div>
      )}
      {tab === 'dev' && (
        <div className="lp-terminal-footer">
          <span className="lp-terminal-rec dev">Clone & build</span>
          <span>Requires Node.js 18+</span>
        </div>
      )}
    </div>
  );
}

function Section({ title, desc, alt, children, id }: {
  title?: string; desc?: string; alt?: boolean; children: React.ReactNode; id?: string;
}) {
  return (
    <section className={`lp-section${alt ? ' lp-section-alt' : ''}`} id={id}>
      <div className="lp-section-inner">
        {title && <h2 className="lp-section-title">{title}</h2>}
        {desc && <p className="lp-section-desc">{desc}</p>}
        {children}
      </div>
    </section>
  );
}

// ── Landing Page ─────────────────────────────────

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sections = el.querySelectorAll('.lp-section');
    if (prefersReduced) {
      sections.forEach(s => s.classList.add('is-visible'));
      return;
    }
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    sections.forEach(s => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;
    const handleMouse = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      el.style.setProperty('--mouse-x', `${e.clientX}px`);
      el.style.setProperty('--mouse-y', `${e.clientY}px`);
    };
    window.addEventListener('mousemove', handleMouse, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouse);
  }, []);

  const handleLaunchChat = () => {
    window.location.hash = '#/chat';
  };

  const installCmd = 'npm install -g https://github.com/klbmou/hysa-code/releases/download/v0.2.0/hysa-code-0.2.0.tgz';

  return (
    <div className="lp-root" ref={rootRef}>
      <div className="lp-ambient-glow" />
      <div className="lp-cursor-glow" style={{ left: mousePos.x, top: mousePos.y }} />

      {/* Star particles */}
      {STAR_PARTICLES.map(p => (
        <span
          key={p.id}
          className="lp-star-particle"
          style={{
            left: p.left,
            top: p.top,
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: p.color,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}

      {/* ── Nav ── */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <span className="lp-logo">HYSA Code</span>
          <div className="lp-nav-links">
            <button className="lp-nav-text-btn" onClick={() => { window.location.hash = '#/files'; }}>Files</button>
            <a href="https://github.com/klbmou/hysa-code" target="_blank" rel="noopener noreferrer">GitHub</a>
            <button className="lp-btn lp-btn-primary lp-btn-sm" onClick={handleLaunchChat}>Launch Chat</button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-bg-glow" />
        <div className="lp-hero-content">
          <div className="hysa-mascot">
            <div className="mascot-glow" />
            <div className="mascot-neural-ring" />
            <div className="mascot-circuit-dot top-left" />
            <div className="mascot-circuit-dot top-right" />
            <div className="mascot-circuit-dot bottom-left" />
            <div className="mascot-circuit-dot bottom-right" />
            <div className="mascot-body">
              <div className="mascot-eyes">
                <span className="mascot-eye" />
                <span className="mascot-eye" />
              </div>
              <span className="mascot-icon">&gt;_</span>
            </div>
          </div>

          <div className="lp-news-pill">
            <span className="lp-news-dot" />
            HYSA Code v0.2 Web MVP is live
          </div>

          <div className="lp-hero-badge">
            <span>Open-source</span>
            <span className="lp-badge-sep">·</span>
            <span>CLI + Web</span>
            <span className="lp-badge-sep">·</span>
            <span>Local providers</span>
          </div>

          <h1 className="lp-hero-title">
            HYSA <span className="lp-hero-title-accent">Code</span>
          </h1>

          <p className="lp-hero-headline">
            The AI coding assistant that actually edits your project.
          </p>
          <p className="lp-hero-sub">
            Chat with your codebase from the terminal or the browser. Reads files,
            proposes changes, shows diffs, asks before writing, runs commands safely.
          </p>

          <div className="lp-hero-buttons">
            <button className="lp-btn lp-btn-primary lp-btn-glow" onClick={handleLaunchChat}>
              <span className="lp-btn-icon">▶</span>
              Launch Chat
            </button>
            <a href="https://github.com/klbmou/hysa-code" target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-secondary">
              <span className="lp-btn-icon">⌘</span>
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ── Live status ── */}
      <div className="lp-live-status">
        <div className="lp-status-pill">
          <span className="lp-status-dot green" />
          CLI ready
        </div>
        <div className="lp-status-pill">
          <span className="lp-status-dot purple" />
          Web UI live
        </div>
        <div className="lp-status-pill">
          <span className="lp-status-dot blue" />
          Local providers
        </div>
      </div>

      {/* ── Install ── */}
      <Section title="One command to start" desc="Install globally via npm — no build tools required." alt>
        <InstallTerminal />
        <p className="lp-install-hint">
          After install: <code className="lp-inline-code-sm">hysa chat</code> or <code className="lp-inline-code-sm">hysa web</code>
        </p>
        <div className="lp-download-exe" style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <a href="/api/download/exe" className="lp-btn lp-btn-secondary lp-btn-glow" download>
            <span className="lp-btn-icon">⬇</span>
            Download hysa.exe (Windows)
          </a>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Standalone 59MB executable — no Node.js required
          </p>
        </div>
      </Section>

      {/* ── Why ── */}
      <Section title="Why HYSA Code?" desc="Built for developers who want AI assistance without giving up control.">
        <div className="lp-cards-grid">
          {WHY.map(w => (
            <div key={w.title} className="lp-card">
              <span className="lp-card-icon lp-card-icon-css">{w.icon}</span>
              <h3 className="lp-card-title">{w.title}</h3>
              <p className="lp-card-desc">{w.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Developer notes ── */}
      <Section title="What developers will love" desc="Honest notes from the team behind HYSA Code." alt>
        <div className="lp-dev-notes-grid">
          {DEV_NOTES.map(n => (
            <div key={n.id} className="lp-dev-note" style={{ '--note-accent': n.color } as React.CSSProperties}>
              <div className="lp-dev-note-header">
                <div className="lp-dev-note-avatar" style={{ background: n.color }}>{n.icon}</div>
                <span className="lp-dev-note-tag">Developer note</span>
              </div>
              <p className="lp-dev-note-text">"{n.text}"</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Workflow ── */}
      <Section title="How it works" desc="Simple workflow. Full control at every step.">
        <div className="lp-workflow">
          <div className="lp-workflow-track" />
          {WORKFLOW.map((s, i) => (
            <div key={i} className="lp-workflow-step">
              <div className="lp-workflow-dot"><span>{s.icon}</span></div>
              <div className="lp-workflow-card">
                <h3 className="lp-workflow-card-title">{s.title}</h3>
                <p className="lp-workflow-card-desc">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Product preview ── */}
      <Section title="CLI + Web UI" desc="Two ways to work. One AI assistant." alt>
        <div className="lp-product-mockups">
          <div className="lp-terminal-mockup">
            <div className="lp-mockup-header">
              <span className="lp-mockup-dot green" />
              <span className="lp-mockup-dot yellow" />
              <span className="lp-mockup-dot red" />
              <span className="lp-mockup-label">Terminal</span>
            </div>
            <div className="lp-mockup-body">
              <div className="lp-term-line"><span className="lp-term-prmpt">$</span> hysa chat</div>
              <div className="lp-term-line lp-term-ai">┃ Hello! I can help with your code.</div>
              <div className="lp-term-line"><span className="lp-term-prmpt">$</span> Add dark mode to App.tsx</div>
              <div className="lp-term-line lp-term-ai">┃ Let me read App.tsx first...</div>
              <div className="lp-term-line lp-term-event">📖 Read src/App.tsx</div>
              <div className="lp-term-line lp-term-event">✅ Done. Here is the diff:</div>
              <div className="lp-term-line lp-term-diff">+ const [dark, setDark] = useState(false)</div>
              <div className="lp-term-line lp-term-pending">Apply this edit? (Y/n) <span className="lp-term-cursor" /></div>
            </div>
            <div className="lp-floating-tags">
              <span className="lp-tag">read_file</span>
              <span className="lp-tag">edit_file</span>
              <span className="lp-tag lp-tag-diff">diff approval</span>
              <span className="lp-tag lp-tag-safe">backup created</span>
            </div>
          </div>
          <div className="lp-web-mockup">
            <div className="lp-mockup-header">
              <span className="lp-mockup-dot green" />
              <span className="lp-mockup-dot yellow" />
              <span className="lp-mockup-dot red" />
              <span className="lp-mockup-label">Web UI</span>
            </div>
            <div className="lp-mockup-body">
              <div className="lp-web-bar">HYSA Code — dark mode toggle</div>
              <div className="lp-web-chat-area">
                <div className="lp-web-msg user">Add dark mode toggle to App.tsx</div>
                <div className="lp-web-msg ai">
                  <div className="lp-web-ev">📖 Read src/App.tsx</div>
                  <div className="lp-web-ev">✅ Done. Adding dark mode:</div>
                  <div className="lp-web-diff">
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
            <div className="lp-floating-tags lp-floating-tags-right">
              <span className="lp-tag lp-tag-safe">safe edit</span>
              <span className="lp-tag">execute_command</span>
            </div>
          </div>
        </div>
        <div className="lp-mockup-footer">
          <code className="lp-inline-code-sm">hysa chat</code>
          <span className="lp-mockup-or">or</span>
          <code className="lp-inline-code-sm">hysa web</code>
        </div>
      </Section>

      {/* ── Provider cloud ── */}
      <Section title="Provider ecosystem" desc="Bring your own key, use local models, or connect HYSA AI.">
        <div className="lp-provider-cloud">
          <div className="lp-provider-center">
            <span className="lp-provider-center-icon">&gt;_</span>
            <span>HYSA Code</span>
          </div>
          <div className="lp-provider-items">
            {PROVIDER_ORBIT.map(p => (
              <div key={p} className="lp-provider-item" style={{ '--provider-glow': PROVIDER_GLOW[p] || '#a855f7' } as React.CSSProperties}>
                <span>{p}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Safety ── */}
      <Section title="Safety by default" desc="Nothing happens without your approval." alt>
        <div className="lp-safety-grid">
          {SAFETY.map(s => (
            <div key={s.title} className="lp-safety-card">
              <div className="lp-safety-card-shield">{s.icon}</div>
              <h3 className="lp-card-title">{s.title}</h3>
              <p className="lp-card-desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Commands ── */}
      <Section title="Commands" desc="Everything you need from the terminal.">
        <div className="lp-commands">
          {COMMANDS.map(c => (
            <div key={c.cmd} className="lp-command-row">
              <code className="lp-command-code">{c.cmd}</code>
              <span className="lp-command-desc">{c.desc}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Roadmap ── */}
      <Section title="Roadmap" desc="What is coming next." alt>
        <div className="lp-roadmap">
          {ROADMAP.map((item, i) => (
            <div key={item} className="lp-roadmap-item">
              <span className="lp-roadmap-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="lp-roadmap-text">{item}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Final CTA ── */}
      <footer className="lp-footer">
        <div className="lp-footer-glow" />
        <div className="lp-footer-inner">
          <h2 className="lp-footer-title">Start building with HYSA Code</h2>
          <div className="lp-footer-actions">
            <button className="lp-btn lp-btn-primary lp-btn-glow" onClick={handleLaunchChat}>
              <span className="lp-btn-icon">▶</span> Launch Chat
            </button>
            <a href="https://github.com/klbmou/hysa-code" target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-secondary">
              <span className="lp-btn-icon">⌘</span> GitHub
            </a>
            <button className="lp-btn lp-btn-secondary" onClick={() => { navigator.clipboard.writeText(installCmd).catch(() => {}); }}>
              Copy Install Command
            </button>
          </div>
          <p className="lp-footer-copy">HYSA Code — open-source AI coding assistant · MIT licensed</p>
        </div>
      </footer>
    </div>
  );
}
