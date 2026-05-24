---
name: browser-testing
title: Browser Testing
description: Test web applications using the built-in browser tools
triggers: [browser, test, webapp]
---

# Browser Testing

HYSA includes built-in browser automation tools powered by Playwright. You can use these tools to open URLs, inspect pages, take screenshots, and interact with elements.

## Available Browser Commands

Use these commands to control the browser:

- `/browser open <url>` — Open a URL (http/https only)
- `/browser screenshot` — Take a screenshot of the current page
- `/browser text` — Get visible text content from the page
- `/browser snapshot` — Get an accessibility/ARIA snapshot
- `/browser click <target>` — Click an element by CSS selector or text
- `/browser type <target> <value>` — Type text into an input field
- `/browser status` — Check browser session status
- `/browser close` — Close the browser session

## Typical Workflow

1. Open a URL: `/browser open http://localhost:8787`
2. Inspect the page: `/browser text` or `/browser snapshot`
3. Interact: `/browser click "Sign in"` then `/browser type "username" "test"`
4. Take a screenshot: `/browser screenshot`
5. Close when done: `/browser close`

## Notes

- Only http:// and https:// URLs are allowed.
- The browser runs headless by default (set `HYSA_BROWSER_HEADLESS=false` to see it).
- Screenshots are saved to `.hysa/screenshots/` by default.
- Playwright must be installed: `npx playwright install chromium`
