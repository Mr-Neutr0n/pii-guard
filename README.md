# PII Guard

Browser extension + local proxy that intercepts requests to LLM services (ChatGPT, Claude, Gemini) and strips personally identifiable information before your prompt leaves your machine.

All PII detection runs locally via [Microsoft Presidio](https://github.com/microsoft/presidio) + spaCy NER. No data is sent to any external service for analysis.

## How it works

```
You type: "My name is John Smith, email john@example.com"

ChatGPT receives: "My name is <PERSON>, email <EMAIL_ADDRESS>"
```

```
Chrome Extension (intercepts fetch)
       ↓ extracts user text from request body
Go Proxy (localhost:9400)
       ↓ forwards to Presidio
Presidio + spaCy (localhost:9401)
       ↓ detects PII, returns anonymized text
Extension replaces request body → LLM gets sanitized input
```

## What it detects

| Entity | Method |
|---|---|
| Person names | spaCy NER |
| Email addresses | Regex |
| Phone numbers | Regex (international + Indian +91) |
| Credit card numbers | Regex + Luhn |
| Aadhaar numbers | Regex + Verhoeff checksum |
| PAN cards | Regex (AAAAA0000A format) |
| UPI IDs | Regex (xxx@ybl, xxx@paytm, etc.) |
| IP addresses | Regex |
| SSN (US) | Regex |
| Dates of birth | Pattern + context |

## Supported platforms

- **ChatGPT** (chatgpt.com) — verified working
- **Claude** (claude.ai) — endpoint configured, needs testing
- **Gemini** (gemini.google.com) — endpoint configured, needs testing
- **OpenAI API** (api.openai.com)
- **Anthropic API** (api.anthropic.com)
- **Gemini API** (generativelanguage.googleapis.com)

## Setup

### Requirements

- macOS (Apple Silicon or Intel)
- Python 3.10–3.13 (Python 3.14 not yet supported by spaCy)
- Go 1.21+
- Google Chrome or Chromium-based browser

### 1. Install backend

```bash
git clone https://github.com/Mr-Neutr0n/pii-guard.git
cd pii-guard
make setup   # creates Python venv, installs Presidio + spaCy model (~560MB download)
```

### 2. Start the proxy

```bash
make run     # builds Go binary, starts proxy on :9400, auto-launches Presidio on :9401
```

Wait for `PII Guard proxy listening on 127.0.0.1:9400` — first start takes ~10s for spaCy model loading.

### 3. Load the extension

1. Open `chrome://extensions` (or `arc://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. The PII Guard icon appears in your toolbar

### 4. Test it

Open ChatGPT and send: `"Hello, my name is John Smith and my email is john@example.com"`

ChatGPT should respond to `<PERSON>` and `<EMAIL_ADDRESS>` instead of real values.

## Project structure

```
pii-guard/
├── extension/               Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── src/
│   │   ├── inject.js        Monkey-patches fetch/XHR/WS (MAIN world)
│   │   ├── content.js       Bridges page ↔ background (ISOLATED world)
│   │   └── background.js    Injects page script, manages badge/popup
│   └── popup/               Extension popup UI
├── proxy/                   Go proxy (localhost:9400)
│   ├── main.go              Entry point, CORS, routing
│   ├── handlers.go          /anonymize, /analyze, /health, /config
│   ├── presidio.go          Presidio HTTP client
│   ├── sidecar.go           Auto-launches Presidio process
│   └── config.go            Entity type toggle
├── presidio/                Python PII detection engine (localhost:9401)
│   ├── app.py               FastAPI wrapper around Presidio
│   ├── setup.sh             Venv + spaCy model setup
│   └── tests/               pytest suite
└── Makefile                 setup, build, run, test
```

## Architecture decisions

- **Local-only** — all detection runs on localhost. No data leaves your machine.
- **Monkey-patching** — the extension patches `window.fetch` in page context to intercept requests before they're sent. Same approach used by commercial tools like Prompt Security.
- **CSP bypass** — `chrome.scripting.executeScript` with `world: "MAIN"` injects the page script, bypassing Content Security Policy restrictions on sites like ChatGPT.
- **User text extraction** — only the user's message text is sent to Presidio, not the full JSON body. This avoids false positives on timestamps, UUIDs, and model names.
- **Fail-open** — if the proxy is down or times out, requests pass through unmodified. Never blocks the user's workflow.

## API

### Proxy (localhost:9400)

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

## Development

```bash
make run-presidio   # run Presidio standalone on :9401
make build          # build Go binary only
make test           # run all tests (pytest + go test)
```

After modifying extension files, click the reload icon on `chrome://extensions` and hard-refresh the target page.

## Roadmap

- [ ] Smart body parser — proxy-side JSON parsing (send full body like Prompt Security)
- [ ] Expand to all ChatGPT input endpoints (autocomplete, prepare, file uploads)
- [ ] Custom validators (Luhn for credit cards, Verhoeff for Aadhaar)
- [ ] Tune Presidio (remove noisy recognizers that cause false positives)
- [ ] macOS menu bar app (no terminal needed)
- [ ] De-anonymization mapping (`<PERSON_1>` ↔ real name, local encrypted storage)
- [ ] Chrome Web Store listing
- [ ] Standalone extension with in-browser NER (Transformers.js / compromise.js)

## License

MIT
