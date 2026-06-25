import React, { useState, useEffect, useRef } from 'react';

const COMMANDS = [
  { cmd: 'hysa chat', desc: 'Start interactive AI session' },
  { cmd: 'hysa web', desc: 'Launch the Web UI' },
  { cmd: 'hysa config', desc: 'View or update config' },
  { cmd: 'hysa providers', desc: 'List available providers' },
  { cmd: 'hysa doctor', desc: 'Run diagnostics' },
  { cmd: 'hysa models <provider>', desc: 'List provider models' },
  { cmd: 'hysa experimental on', desc: 'Enable experimental free providers' },
  { cmd: 'hysa yolo on', desc: 'Enable auto-apply mode' },
];

const WORKFLOW_STEPS = [
  { icon: '💬', title: 'Chat with your codebase', desc: 'Ask HYSA to build, fix, or change anything. The AI reads your files to understand the full project context.' },
  { icon: '📖', title: 'Review proposed changes', desc: 'See exactly what will change — additions in green, removals in red — before anything touches your files.' },
  { icon: '✅', title: 'Approve or reject', desc: 'Approve the edit and HYSA writes the file. Reject and nothing changes. Backups are automatic.' },
  { icon: '⚡', title: 'Run commands safely', desc: 'Let HYSA run tests, linters, and builds. Dangerous commands always ask for confirmation first.' },
];

const FEATURES = [
  { icon: '💬', title: 'Web chat interface', desc: 'Full-featured chat with streaming responses, code diffs, image generation, and source browsing.' },
  { icon: '🔍', title: 'Source chips & search', desc: 'Ask "what is X in the codebase?" and get file-backed answers with clickable source references.' },
  { icon: '🖼️', title: 'Image generation proxy', desc: 'Generate and display images inline via the AI provider — with fallback URLs and retry support.' },
  { icon: '📁', title: 'File browser', desc: 'Browse, upload, and manage project files directly from the browser UI with drag-and-drop support.' },
  { icon: '🔌', title: 'Provider routing', desc: 'Bring your own key for OpenRouter, Gemini, Groq, DeepSeek, Ollama, Anthropic, OpenAI, and more.' },
  { icon: '🌐', title: 'Arabic & English', desc: 'Full bilingual support — chat in Arabic or English with proper RTL layout and Arabic search.' },
  { icon: '⚙️', title: 'Settings panel', desc: 'Configure AI providers, theme, font size, and experimental features from an intuitive settings UI.' },
  { icon: '📱', title: 'Mobile-friendly', desc: 'Responsive design that works on phones and tablets without sacrificing functionality or readability.' },
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
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function InstallTerminal() {
  const [tab, setTab] = useState<'release' | 'dev'>('release');
  const releaseCmd = 'npm install -g hysa-code';
  const devCmds = [
    'git clone https://github.com/klbmou/hysa-code',
    'cd hysa-code',
    'npm install && npm run build && npm run build:web',
    'npm install -g ./hysa-code-1.0.0.tgz',
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
      <div className="lp-terminal-footer">
        {tab === 'release' ? (
          <>
            <span className="lp-terminal-rec">Recommended</span>
            <span>Stable release · no build required</span>
          </>
        ) : (
          <>
            <span className="lp-terminal-rec dev">Clone & build</span>
            <span>Requires Node.js 18+</span>
          </>
        )}
      </div>
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

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);

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

  const [rememberKey, setRememberKey] = React.useState(() => {
    return localStorage.getItem('hysa_remember_key') === 'true';
  });

  const handleLaunchChat = () => {
    const requiredKey = (window as any).__HYSA_PUBLIC_API_KEY__;
    if (requiredKey && !requiredKey.startsWith('$')) {
      if (rememberKey) {
        localStorage.setItem('hysa_api_key', requiredKey);
        localStorage.setItem('hysa_remember_key', 'true');
      } else {
        sessionStorage.setItem('hysa_api_key', requiredKey);
        localStorage.removeItem('hysa_remember_key');
      }
    }
    window.location.hash = '#/chat';
  };

  return (
    <div className="lp-root" ref={rootRef}>
      {/* ── Nav ── */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <span className="lp-logo">HYSA Code</span>
          <div className="lp-nav-center">
            <span className="lp-nav-link" onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>Features</span>
            <span className="lp-nav-link" onClick={handleLaunchChat}>Web App</span>
            <span className="lp-nav-link" onClick={() => document.getElementById('cli')?.scrollIntoView({ behavior: 'smooth' })}>CLI</span>
            <a href="https://github.com/klbmou/hysa-code" target="_blank" rel="noopener noreferrer" className="lp-nav-link">GitHub</a>
          </div>
          <div className="lp-nav-actions">
            <button className="lp-btn lp-btn-primary lp-btn-sm" onClick={handleLaunchChat}>Launch Chat</button>
            <a href="https://github.com/klbmou/hysa-code" target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-secondary lp-btn-sm">
              View GitHub
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-content">
          <div className="lp-hero-badges">
            <span className="lp-hero-badge">
              <span className="lp-badge-dot" />
              Open source
            </span>
            <span className="lp-hero-badge">
              <span className="lp-badge-dot green" />
              CLI + Web UI
            </span>
            <span className="lp-hero-badge">
              <span className="lp-badge-dot blue" />
              v1.0.0 Stable
            </span>
          </div>

          <h1 className="lp-hero-title">
            <span className="lp-hero-title-line">HYSA <span className="lp-hero-accent">Code</span></span>
            <span className="lp-hero-subtitle">The AI coding assistant that edits your project files</span>
          </h1>

          <p className="lp-hero-desc">
            Chat with your codebase from the terminal or browser. HYSA reads files,
            proposes changes, shows diffs, asks before writing, and runs commands — all with your approval.
          </p>

          <div className="lp-hero-actions">
            <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={handleLaunchChat}>
              Launch Chat
            </button>
            <a href="https://github.com/klbmou/hysa-code" target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-secondary lp-btn-lg">
              View on GitHub
            </a>
          </div>
          {typeof (window as any).__HYSA_PUBLIC_API_KEY__ === 'string' && (
            <label className="lp-remember-key">
              <input type="checkbox" checked={rememberKey} onChange={e => setRememberKey(e.target.checked)} />
              <span>Remember access key on this device</span>
            </label>
          )}
        </div>
      </section>

      {/* ── Product Preview ── */}
      <Section title="See it in action" desc="HYSA reads your code, shows diffs, and applies changes with your approval." alt id="features">
        <div className="lp-preview">
          <div className="lp-preview-chat">
            <div className="lp-preview-header">
              <span className="lp-preview-dot red" />
              <span className="lp-preview-dot yellow" />
              <span className="lp-preview-dot green" />
              <span className="lp-preview-title">Chat — hysa-code</span>
            </div>
            <div className="lp-preview-body">
              <div className="lp-preview-msg user">
                Add dark mode support to the settings panel
              </div>
              <div className="lp-preview-msg ai">
                <div className="lp-preview-tool">
                  <span className="lp-preview-tool-icon">📖</span>
                  read_file: src/components/Settings.tsx
                </div>
                <div className="lp-preview-tool">
                  <span className="lp-preview-tool-icon">📖</span>
                  read_file: src/styles.css
                </div>
                <div className="lp-preview-text">
                  I found the settings component. Here is the change to add a dark mode toggle:
                </div>
                <div className="lp-preview-diff">
                  <div className="lp-preview-diff-line add">+ const [theme, setTheme] = useState('dark')</div>
                  <div className="lp-preview-diff-line add">+ const toggleTheme = () =&gt; setTheme(t =&gt; t === 'dark' ? 'light' : 'dark')</div>
                  <div className="lp-preview-diff-line add">+ document.documentElement.dataset.theme = theme</div>
                </div>
                <div className="lp-preview-actions">
                  <span className="lp-preview-btn primary">Apply edit</span>
                  <span className="lp-preview-btn">View diff</span>
                  <span className="lp-preview-btn">Discard</span>
                </div>
              </div>
              <div className="lp-preview-msg ai search">
                <div className="lp-preview-chips">
                  <span className="lp-preview-chip web">web_search</span>
                  <span className="lp-preview-chip file">read_file</span>
                  <span className="lp-preview-chip image">image_gen</span>
                </div>
                <div className="lp-preview-text">
                  I searched the codebase and found relevant files for your request.
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Developer Workflow ── */}
      <Section title="Built for real project work" desc="A workflow that puts you in control at every step.">
        <div className="lp-workflow-grid">
          {WORKFLOW_STEPS.map((w, i) => (
            <div key={i} className="lp-workflow-card">
              <span className="lp-workflow-icon">{w.icon}</span>
              <h3 className="lp-workflow-title">{w.title}</h3>
              <p className="lp-workflow-desc">{w.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Features ── */}
      <Section title="Everything you need" desc="A complete toolset for AI-assisted development." alt>
        <div className="lp-features-grid">
          {FEATURES.map((f, i) => (
            <div key={i} className="lp-feature-card">
              <span className="lp-feature-icon">{f.icon}</span>
              <h3 className="lp-feature-title">{f.title}</h3>
              <p className="lp-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── CLI ── */}
      <Section title="CLI commands" desc="Work from the terminal when you prefer speed over visuals." id="cli">
        <div className="lp-commands">
          {COMMANDS.map(c => (
            <div key={c.cmd} className="lp-command-row">
              <code className="lp-command-code">{c.cmd}</code>
              <span className="lp-command-desc">{c.desc}</span>
            </div>
          ))}
        </div>
        <div className="lp-cli-note">
          After install: <code className="lp-inline-code-sm">hysa chat</code> or <code className="lp-inline-code-sm">hysa web</code>
        </div>
      </Section>

      {/* ── Install ── */}
      <Section title="Get started in one command" desc="Install globally via npm — no build tools required." alt>
        <InstallTerminal />
        <div className="lp-download-exe">
          <a href="/api/download/exe" className="lp-btn lp-btn-secondary" download>
            ⬇ Download hysa.exe (Windows) — 59MB standalone
          </a>
        </div>
      </Section>

      {/* ── Open Source ── */}
      <section className="lp-section lp-open-source">
        <div className="lp-section-inner">
          <div className="lp-os-card">
            <h2 className="lp-os-title">Alpha quality. Free. Open source.</h2>
            <p className="lp-os-desc">
              HYSA Code is in active development. Things may break, APIs may change, and some
              features are still being built. But it is MIT licensed, free to use, and
              {' '}<a href="https://github.com/klbmou/hysa-code" target="_blank" rel="noopener noreferrer">available on GitHub</a>.
              Contributions, bug reports, and feedback are always welcome.
            </p>
            <div className="lp-os-stats">
              <div className="lp-os-stat">
                <span className="lp-os-stat-num">MIT</span>
                <span className="lp-os-stat-label">License</span>
              </div>
              <div className="lp-os-stat">
                <span className="lp-os-stat-num">v1.0.0</span>
                <span className="lp-os-stat-label">Stable release</span>
              </div>
              <div className="lp-os-stat">
                <span className="lp-os-stat-num">9+</span>
                <span className="lp-os-stat-label">AI providers</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <h2 className="lp-footer-title">Start building with HYSA Code</h2>
          <div className="lp-footer-actions">
            <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={handleLaunchChat}>
              Launch Chat
            </button>
            <a href="https://github.com/klbmou/hysa-code" target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-secondary lp-btn-lg">
              View on GitHub
            </a>
          </div>
          <p className="lp-footer-copy">HYSA Code — open-source AI coding assistant · MIT licensed</p>
        </div>
      </footer>
    </div>
  );
}
