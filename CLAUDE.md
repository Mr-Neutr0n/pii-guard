# CLAUDE.md

## About

Data security engineer building local-first middleware for safe LLM usage. The goal is a tool that sits between users and any LLM — detecting and stripping PII before prompts leave the machine, with or without customization.

GitHub: [Mr-Neutr0n](https://github.com/Mr-Neutr0n)

## Project

**PII Guard** — Browser extension + local proxy that intercepts requests to LLM services (ChatGPT, Claude, Gemini) and anonymizes PII before prompts reach the provider. All detection runs locally via Presidio + spaCy NER. Zero data sent externally.

## Architecture

```
Chrome Extension (MV3)
  inject.js   — MAIN world, monkey-patches fetch/XHR/WS, extracts user text
  content.js  — ISOLATED world, bridges page ↔ background
  background.js — injects page script (CSP bypass), badge, popup

Go Proxy (localhost:9400)
  Routes requests, CORS, auto-launches Presidio sidecar

Presidio Engine (localhost:9401)
  FastAPI + spaCy en_core_web_lg, 12 entity types incl. Indian PII
```

## Key Implementation Details

- Extension injects into page via `chrome.scripting.executeScript` with `world: "MAIN"` (only method that bypasses CSP on ChatGPT)
- Must extract URL/method from raw fetch arguments WITHOUT constructing `new Request()` to avoid consuming the body stream
- ChatGPT's actual message endpoint is `/backend-api/f/conversation` (not `/conversation` or `/conversation/init`)
- Only user text is sent to Presidio — sending full JSON body causes false positives (timestamps → phone numbers, UUIDs → driver licenses, model names → organizations)
- Content script has a fallback: if `chrome.runtime` is invalidated (dev reloads), it calls the proxy directly

## Stack

- **Extension:** JavaScript, Chrome Manifest V3
- **Proxy:** Go (stdlib only, no external deps)
- **PII Engine:** Python 3.10–3.13, FastAPI, Presidio, spaCy
- **Target:** macOS (Apple Silicon + Intel)

## Commands

```bash
make setup        # one-time: venv + spaCy model (~560MB)
make run          # start proxy (:9400) + auto-launch Presidio (:9401)
make test         # pytest + go test
make run-presidio # Presidio standalone
make build        # Go binary only
```

## Testing

- Reload extension on chrome://extensions after code changes
- Close and reopen the target tab (stale content scripts cause "Extension context invalidated")
- Disable Prompt Security or other fetch-patching extensions during testing
- Check DevTools console for `[PII Guard]` logs

## Rules

- Do not add AI co-author attribution on commits (this is an open source project)
- Fail-open always — never block the user's workflow if the proxy is down
- Keep the extension thin — platform-specific logic should move to the proxy over time
- notes.md has the full roadmap, competitive analysis, and architectural decisions
