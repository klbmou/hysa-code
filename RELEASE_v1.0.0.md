# HYSA Code v1.0.0 — Global SaaS Platform

**Release Date:** June 25, 2026

---

## The Evolution Is Complete

HYSA Code has evolved from a local terminal tool into a **self-hosted, always-on global SaaS platform**. This is not an incremental update — it is the first stable production release, engineered for performance, reliability, and enterprise-grade security.

---

## What's New in v1.0.0

### 🌐 Global SaaS Deployment (Always-On)
- **One-click production deploy** — `npm run deploy:global` builds, configures, and starts a PM2-managed daemon in a single command
- **PM2 daemonization** — auto-restart on crash, `max_memory_restart: 512M` threshold, listen/kill timeouts for graceful shutdown
- **Public URL support** — `HYSA_PUBLIC_URL` environment variable configures the external-facing address
- **0.0.0.0 binding** — server listens on all interfaces in production mode by default
- **DEPLOYMENT_SUMMARY.txt** — auto-generated connection info with URLs, API key, endpoints, and PM2 commands

### 🛡️ Enterprise-Ready Security & Authentication
- **Public Access Key Middleware** — `HYSA_PUBLIC_API_KEY` guard with private-IP auto-bypass
- **External request authentication** — `x-api-key` header or `api_key` query parameter required for non-local requests
- **"Remember Me" persistence** — Landing page checkbox stores API key to localStorage (sessionStorage by default)
- **Secrets redacted** — no API keys ever printed in logs, diagnostics, or session records

### 📊 Production Monitoring
- **Live Log Viewer** — dark terminal-styled UI polling `/api/logs` every 2 seconds with color-coded levels
- **Health Endpoint** — `GET /api/health` returns status, uptime, memory, and production mode (unauthenticated)
- **Memory Threshold Watcher** — 400MB RSS alert with PM2 broadcast and 60-second cooldown
- **PM2 Integration** — `pm2 status`, `pm2 logs hysa-prod`, `pm2 stop hysa-prod`, `pm2 restart hysa-prod`

### 🖥️ Professional UI
- **SVG Brand Favicon** — pure SVG logo with silver rects and cyan diamond
- **Error Fallback Page** — `error.html` with "System updating, retry in 30s" and Retry Now button
- **Live Sessions Indicator** — neon cyan pulse animation in the top bar
- **Compact Single-Line Status Bar** — `[HYSA v1.0.0] | [Provider: ...] | [Branch: ...] | [Context: ...] | [Status: Always-On]`

### ✅ Quality Assurance
- **Deterministic Test Provider** — `HYSA_E2E_TEST_PROVIDER=true` returns predictable responses with zero external API calls
- **24 Automated Smoke Tests** — component-level and true E2E tests covering memory-aware planning, 9Router probes, Arabic chat routing, and production deployment
- **All chat paths covered** — streaming, non-streaming, continueChat, vision fallback

---

## Breaking Changes

- Server now binds to `0.0.0.0` in production mode (was `localhost`). Use `HYSA_BIND_HOST` to override.
- External access now requires `HYSA_PUBLIC_API_KEY` unless accessing from a private/local IP.
- The `safeFetchJson` utility in the web frontend auto-injects `x-api-key` from `sessionStorage`/`localStorage`.

---

## Migration Guide

### Upgrading from v0.6.x

1. **Pull the latest code:**
   ```bash
   git pull origin main
   npm install
   ```

2. **Set your public access key (required for external access):**
   ```bash
   # Generate a secure key
   HYSA_PUBLIC_API_KEY=$(openssl rand -hex 32)
   
   # Or use your own
   HYSA_PUBLIC_API_KEY=your-secret-key-here
   ```

3. **Deploy:**
   ```bash
   npm run deploy:global
   ```

4. **Verify:**
   ```bash
   curl http://localhost:10000/api/health
   ```

---

## Full Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the complete history of all changes.

---

## Acknowledgments

HYSA Code v1.0.0 represents thousands of hours of development, testing, and refinement. Thank you to everyone who contributed feedback, bug reports, and feature suggestions throughout the alpha and beta phases.

**The future of AI-assisted coding is self-hosted, always-on, and enterprise-ready.**
