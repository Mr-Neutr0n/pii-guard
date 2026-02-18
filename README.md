# PII Guard

Browser extension that intercepts requests to LLM services (ChatGPT, Claude, Gemini) and strips personally identifiable information before your prompt leaves your machine.

All PII detection runs locally. No data is sent to any external service.

```
You type: "My name is John Smith, email john@example.com"

ChatGPT receives: "My name is <PERSON>, email <EMAIL_ADDRESS>"
```

## Two versions

| | **Full** | **Lite** |
|---|---|---|
| **Setup** | Backend required (Go + Python) | Just install the extension |
| **Detection** | Presidio + spaCy NER (560MB model) | In-browser regex + Transformers.js NER (65MB model) |
| **Person names** | High accuracy (spaCy en_core_web_lg) | Good accuracy (DistilBERT quantized) |
| **Latency** | ~200ms (HTTP roundtrip) | ~100ms (in-process) |
| **Works offline** | Needs proxy running | Yes |
| **Best for** | Maximum accuracy, enterprise | Quick setup, personal use |

Both versions use the same interception engine (monkey-patched `fetch`/`XHR`/`WebSocket`) and detect the same entity types.

## What it detects

| Entity | Detection | Validation |
|---|---|---|
| Person names | NER (spaCy / DistilBERT) | — |
| Email addresses | Regex | — |
| Phone numbers | Regex (Indian +91, US, international) | — |
| Credit card numbers | Regex | Luhn checksum |
| Aadhaar numbers | Regex | Verhoeff checksum |
| PAN cards | Regex | Format (AAAAA0000A) |
| UPI IDs | Regex (30+ bank suffixes) | — |
| US SSN | Regex | Area/group/serial rules |
| IP addresses | Regex | Octet range |
| Locations | NER | — |

## Supported platforms

| Platform | Endpoint | Status |
|---|---|---|
| ChatGPT Web | `/backend-api/f/conversation`, autocompletion | Verified |
| Claude Web | `/api/organizations/.../completion` | Configured |
| Gemini Web | `BardChatUi`, `StreamGenerate` | Configured |
| OpenAI API | `/v1/chat/completions` | Configured |
| Anthropic API | `/v1/messages` | Configured |
| Gemini API | `generateContent` | Configured |

## Quick start: Lite (no backend)

```bash
cd extension-lite
npm install
npm run build
```

1. Open `chrome://extensions` → Enable **Developer mode**
2. Click **Load unpacked** → select `extension-lite/dist/`
3. Open ChatGPT and type PII — it gets redacted automatically

The NER model (~65MB) downloads on first use and is cached in the browser.

## Quick start: Full (maximum accuracy)

### Requirements

- macOS (Apple Silicon or Intel)
- Python 3.10–3.13
- Go 1.21+
- Chrome or Chromium-based browser

### Setup

```bash
git clone https://github.com/Mr-Neutr0n/pii-guard.git
cd pii-guard
make setup    # creates venv, installs Presidio + spaCy model (~560MB)
make run      # starts proxy on :9400, auto-launches Presidio on :9401
```

Then load the extension:

1. Open `chrome://extensions` → Enable **Developer mode**
2. Click **Load unpacked** → select `extension/`
3. Wait for the toolbar icon — green badge means proxy is healthy

Test: open ChatGPT and send `"My name is John Smith, email john@example.com"`

## Architecture

### Full version

```
Chrome Extension (MV3)
  inject.js   — MAIN world, monkey-patches fetch/XHR/WS
  content.js  — ISOLATED world, bridges page ↔ background
  background.js — relays to proxy, manages badge
        ↓ localhost:9400
Go Proxy
  Routes requests, CORS, entity config toggles
        ↓ localhost:9401
Presidio Engine (Python)
  FastAPI + spaCy en_core_web_lg, 12+ entity types
```

### Lite version

```
Chrome Extension (MV3)
  inject.js     — same interception as Full
  content.js    — same bridge as Full
  background.js — routes to offscreen document (no proxy)
        ↓ chrome.runtime messaging
Offscreen Document + Web Worker
  Tier 1: regex + Luhn/Verhoeff checksums (<1ms)
  Tier 2: Transformers.js DistilBERT NER (~100ms)
```

## Design principles

- **Local-only** — all detection on localhost, zero external data transmission
- **Fail-open** — if detection is unavailable, requests pass through unmodified
- **Monkey-patching** — patches `window.fetch` in MAIN world to intercept before requests are sent
- **CSP bypass** — `chrome.scripting.executeScript` with `world: "MAIN"` for sites like ChatGPT
- **User text extraction** — only user message text goes to detection, not timestamps/UUIDs/metadata
- **Typing protection** — intercepts ChatGPT's autocompletion endpoint that sends text while typing

## API (Full version only)

```bash
# Anonymize text
curl -X POST http://localhost:9400/anonymize \
  -H 'Content-Type: application/json' \
  -d '{"text": "My name is John Smith, email john@example.com"}'

# Health check
curl http://localhost:9400/health

# Get entity config
curl http://localhost:9400/config

# Toggle entity types
curl -X PUT http://localhost:9400/config \
  -H 'Content-Type: application/json' \
  -d '{"US_SSN": false}'
```

## Project structure

```
pii-guard/
├── extension/                 Full version — Chrome extension
│   ├── manifest.json
│   ├── src/
│   │   ├── inject.js          Monkey-patches fetch/XHR/WS (MAIN world)
│   │   ├── content.js         Bridges page ↔ background
│   │   └── background.js      Relays to Go proxy
│   └── popup/                 Extension popup UI
├── proxy/                     Full version — Go proxy (localhost:9400)
│   ├── main.go                Entry point, CORS, routing
│   ├── handlers.go            /anonymize, /analyze, /health, /config
│   ├── presidio.go            Presidio HTTP client
│   ├── sidecar.go             Auto-launches Presidio process
│   └── config.go              Entity type toggles
├── presidio/                  Full version — Python PII engine (localhost:9401)
│   ├── app.py                 FastAPI + Presidio + spaCy
│   ├── setup.sh               Venv + model setup
│   └── tests/                 pytest suite
├── extension-lite/            Lite version — standalone Chrome extension
│   ├── manifest.json
│   ├── package.json           Build deps (Transformers.js, Vite)
│   ├── vite.config.js         Build config
│   ├── src/
│   │   ├── inject.js          Same as Full
│   │   ├── content.js         Same as Full
│   │   ├── background.js      Routes to offscreen document
│   │   ├── offscreen.html     Hosts Web Worker
│   │   ├── offscreen-worker.js  NER inference + regex detection
│   │   └── pii/
│   │       ├── detector.js    Detection orchestrator
│   │       ├── regex-patterns.js  Regex patterns + context
│   │       ├── validators.js  Luhn, Verhoeff, PAN, SSN
│   │       └── anonymizer.js  Entity replacement
│   └── popup/                 Same popup as Full
├── e2e/                       E2E test tooling
│   └── requirements.txt
├── Makefile                   setup, build, run, test
└── CLAUDE.md                  Project context
```

## Development

```bash
# Full version
make run-presidio    # run Presidio standalone
make build           # build Go binary
make test            # run all tests (pytest + go test)

# Lite version
cd extension-lite
npm install
npm run build        # build to dist/
npm run watch        # rebuild on changes

# E2E testing
make setup-e2e       # install Playwright
make test-e2e        # automated PII test on ChatGPT
make test-e2e-interactive  # manual browser testing
```

After modifying extension files: reload on `chrome://extensions` and **close + reopen** the LLM tab.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run tests: `make test`
5. Submit a PR

## License

MIT
