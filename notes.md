# PII Guard — Notes

## What It Does

Browser extension that sits between the user and LLM APIs (ChatGPT, Claude, Gemini, etc.). It intercepts outgoing HTTP requests, scans for PII in the prompt/message body, and replaces detected PII with typed tokens (`<person>`, `<aadhar_card>`, `<email>`, `<phone>`, etc.) before the request leaves the machine. Everything runs locally — no data sent to any external service for analysis.

## Rough System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser (Chrome)                  │
│                                                      │
│  ┌──────────────────────────────────┐                │
│  │     PII Guard Extension          │                │
│  │                                  │                │
│  │  - Intercepts requests to known  │                │
│  │    LLM API endpoints             │                │
│  │  - Forwards request body to      │                │
│  │    local proxy via Native        │                │
│  │    Messaging or localhost HTTP    │                │
│  │  - Receives anonymized body back │                │
│  │  - Replaces original body and    │                │
│  │    forwards to LLM               │                │
│  │  - Shows badge/notification of   │                │
│  │    what was redacted              │                │
│  └──────────┬───────────────────────┘                │
│             │                                        │
└─────────────┼────────────────────────────────────────┘
              │  localhost:9400 or Native Messaging
              ▼
┌─────────────────────────────────────────────────────┐
│              Local Proxy (Go or Rust)                │
│                                                      │
│  - Lightweight HTTP server on localhost              │
│  - Receives raw message body from extension          │
│  - Calls Presidio Analyzer for PII detection         │
│  - Calls Presidio Anonymizer to replace PII          │
│  - Returns anonymized text + redaction manifest      │
│    (what was replaced, entity types, positions)      │
│  - Manages config (which entity types to redact,     │
│    custom patterns like Aadhar, PAN, etc.)           │
│                                                      │
│  Communication with Presidio:                        │
│    Option A: Embed Presidio via Python subprocess    │
│    Option B: Presidio runs as sidecar HTTP service   │
│    Option C: Rewrite core NER in Go/Rust (later)     │
│                                                      │
└──────────┬──────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────┐
│          Presidio Engine (Python)                    │
│                                                      │
│  - presidio-analyzer: NER-based PII detection        │
│    (spaCy en_core_web_lg model)                      │
│  - presidio-anonymizer: replacement/masking          │
│  - Custom recognizers:                               │
│    - Aadhar card numbers (12-digit pattern)          │
│    - PAN card (AAAAA0000A pattern)                   │
│    - Indian phone numbers (+91 patterns)             │
│    - UPI IDs                                         │
│  - Runs as FastAPI microservice on localhost:9401    │
│  - Packaged as a single binary/venv for easy install │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Component Breakdown

### 1. Browser Extension (Chrome Manifest V3)

- **Intercept targets:** Known LLM API domains — `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, plus web UIs like `chat.openai.com`, `claude.ai`, `gemini.google.com`
- **Mechanism:** `chrome.webRequest` or `DeclarativeNetRequest` to intercept outgoing POST requests. For streaming SSE responses, use `chrome.debugger` or service worker fetch interception.
- **UI:** Popup showing redaction log, toggle on/off, entity type config. Badge count of redactions on icon.
- **Communication:** HTTP to `localhost:9400` (simplest, avoids native messaging complexity). Falls back to warning if proxy isn't running.
- Keep this as thin as possible — all PII logic lives in the proxy.

### 2. Local Proxy (Go or Rust)

- **Why not just Python?** Need low latency on the interception path. Go/Rust handles the HTTP plumbing, config management, and request routing fast. Presidio is the only Python piece.
- **Endpoints:**
  - `POST /analyze` — receive text, return PII entities found
  - `POST /anonymize` — receive text, return anonymized text + manifest
  - `GET /health` — extension checks if proxy is alive
  - `GET /config` — return current entity type settings
  - `PUT /config` — update which entity types to redact
- **Presidio integration (Phase 1):** HTTP call to Presidio sidecar on `:9401`
- **Startup:** Launches Presidio sidecar process automatically if not running
- **Binary distribution:** Single binary via `go build` or `cargo build`, Apple Silicon native (arm64)

### 3. Presidio Engine (Python/FastAPI)

- Thin FastAPI wrapper around `presidio-analyzer` + `presidio-anonymizer`
- Custom recognizers registered at startup for Indian PII (Aadhar, PAN, phone, UPI)
- Packaged as a Python venv or PyInstaller binary to avoid requiring user to install Python
- Listens on `localhost:9401`, only accepts connections from localhost

## Entity Types to Detect

| Entity | Token | Detection Method |
|---|---|---|
| Person name | `<person>` | spaCy NER |
| Email | `<email>` | Regex + context |
| Phone number | `<phone>` | Regex (intl + Indian) |
| Aadhar card | `<aadhar_card>` | Regex (XXXX XXXX XXXX) + checksum |
| PAN card | `<pan_card>` | Regex (AAAAA0000A) |
| Credit card | `<credit_card>` | Regex + Luhn |
| Address | `<address>` | spaCy NER |
| IP address | `<ip_address>` | Regex |
| UPI ID | `<upi_id>` | Regex (xxx@upi) |
| Date of birth | `<dob>` | Pattern + context |
| SSN (US) | `<ssn>` | Regex |
| Passport | `<passport>` | Regex + context |

## Request Flow (Happy Path)

```
1. User types prompt in ChatGPT/Claude/etc.
2. User hits send → browser makes POST to LLM API
3. Extension intercepts the request before it leaves
4. Extension extracts message body, sends to localhost:9400/anonymize
5. Proxy forwards to Presidio (localhost:9401)
6. Presidio detects: "Hari Prasad" → PERSON, "1234 5678 9012" → AADHAR
7. Proxy returns anonymized text:
   "Tell me about <person>'s tax filing with Aadhar <aadhar_card>"
8. Extension replaces original request body with anonymized version
9. Request goes to LLM API with PII stripped
10. Extension shows badge: "2 items redacted"
```

## Open Questions / Decisions Needed

- **Go vs Rust for proxy?** Go is faster to build, Rust has better binary size and no runtime. Leaning Go for speed of development.
- **Native Messaging vs localhost HTTP?** Localhost HTTP is simpler and works across browsers. Native Messaging is more "proper" but adds complexity. Starting with localhost.
- **Presidio packaging:** PyInstaller single binary vs embedded venv vs requiring Python install. PyInstaller is cleanest for distribution but can be finicky on arm64.
- **Response handling:** Should we also scan LLM *responses* for PII? (e.g., if the LLM echoes back PII from its training data). Phase 2 consideration.
- **Streaming:** SSE streaming responses need chunk-level interception. More complex — defer to Phase 2 or handle by buffering.
- **Allowlisting:** Users may want to allowlist certain entities (e.g., their company name). Need a config mechanism.

## Phases

**Phase 1 — Core (Mac/Apple Silicon)**
- Go proxy + Presidio sidecar + Chrome extension
- Intercept outgoing requests only
- Standard + Indian PII entity types
- Popup UI with redaction log

**Phase 2 — Polish**
- Response scanning (SSE streaming)
- Allowlist/blocklist per site
- Redaction manifest export (for audit)
- Firefox extension port

**Phase 3 — Distribution**
- Homebrew formula for proxy + Presidio
- Chrome Web Store listing
- Windows port

## Tech Stack Summary

| Component | Tech | Runs On |
|---|---|---|
| Browser extension | JS/TS, Manifest V3 | Chrome |
| Local proxy | Go (or Rust) | localhost:9400 |
| PII engine | Python, FastAPI, Presidio, spaCy | localhost:9401 |
| Target platform | macOS, Apple Silicon (arm64) | Phase 1 |

---

## Competitive Analysis: Prompt Security Browser Extension

_Reverse-engineered from Chrome extension v7.0.23 (extension ID: `iidnankcocecmgpcafggbgbmkbcldmno`). Analysis done 2026-02-17._

### Architecture: Cloud-Based DLP (Not Local)

Unlike PII Guard, Prompt Security does **NOT** do local PII detection. It's a cloud-first model:

```
Browser (monkey-patched fetch/XHR/WebSocket)
    ↓  sends user prompt text
Backend API (apiDomain configured via MDM)
    ↓  returns sanitized text + policy decision
Browser replaces request body → forwards to LLM
```

All detection happens **server-side**. The extension is a thin interception + policy enforcement client.

### How It Intercepts Requests

The key is `script.bundle.js`, injected into every page at `document_start`. It **monkey-patches** browser APIs:

| API | Target |
|---|---|
| `window.fetch()` | ChatGPT, Claude, Gemini, DeepSeek, etc. |
| `XMLHttpRequest.open/send` | Legacy API calls + file uploads |
| `WebSocket.send` | Copilot, Claude, Lizzy AI |
| `EventSource` constructor | SSE-based streaming |

Before any request hits the network, it extracts the body, calls their backend `/protect` API, gets back either a sanitized version or a block decision, and replaces the body in-flight.

### What It Monitors

- **30+ AI platforms** hardcoded (ChatGPT, Claude, Copilot, Gemini, Grok, Perplexity, DeepSeek, Mistral, GitHub Copilot, Cerebras, Writer, Grammarly, LMSys, You.com, OmniGPT, Otter.ai, etc.)
- **Cloud storage** (Google Drive, Dropbox, OneDrive, S3, SharePoint, iCloud, WeTransfer)
- **File uploads** — scans text-based files, sends base64 to a separate file protection API
- **Clipboard paste** — can block paste operations entirely
- **Enterprise vs personal account detection** per platform (ChatGPT, Claude, Gemini, Perplexity, Copilot)

### Enterprise Policy Controls (via MDM / managed storage)

- Block personal accounts on Claude, Copilot, Gemini, Perplexity
- Block ChatGPT sharing, training, memory, voice mode, dev mode, file uploads, MCP connectors
- Force temporary chat mode or workspace accounts
- Set corporate domain allowlists
- Configure SSO (Okta/Azure/Google) with auto-redirect
- Block entire AI platforms outright

### Telemetry & Logging

Extensive — every intercepted request logs:
- `flowTraceId` (UUID per request), `conversationId`, user email, domain, page title, full URL
- Whether text was modified, what violations were found, what action the user took
- Enterprise vs personal flag, browser version, extension version
- MCP tool calls (server name, tool name, arguments, SHA-256 hashed tool lists)

Logs auto-upload to backend every 50 entries or 60 seconds.

### Modal System (3 types)

1. **Block Modal** — "Access Denied", shows reason, optional bypass button
2. **Education Modal** — "Sensitive Data Alert", shows detected violations in a carousel (entity type + actual value)
3. **Auth Redirect Modal** — 5-second countdown, forces SSO authentication

### Security Observations

- No request signing/HMAC detected
- API keys stored in plaintext in `chrome.storage.local`
- No TLS pinning (vulnerable to MITM with local proxy)
- `<all_urls>` host permission — can modify any request
- File upload scanning only covers text-based files, not binary (PDFs, images)

### Comparison: Prompt Security vs PII Guard

| | Prompt Security | PII Guard (ours) |
|---|---|---|
| **Detection** | Cloud/server-side | Local (Presidio + spaCy) |
| **Privacy** | Sends prompts to their backend | Never leaves localhost |
| **Scope** | DLP + policy enforcement + audit | PII anonymization only |
| **Interception** | Monkey-patches fetch/XHR/WebSocket | Chrome extension request interception |
| **Config** | MDM-managed, enterprise-grade | User-controlled |
| **File scanning** | Yes (base64 upload) | Not yet planned |
| **Platform coverage** | 30+ AI platforms + cloud storage | 6 LLM platforms (Phase 1) |
| **Telemetry** | Heavy (user email, URLs, page titles) | None (local-only) |

### Key Takeaways for PII Guard Implementation

1. **Monkey-patching is the proven approach** — `declarativeNetRequest` alone isn't enough for modifying request bodies. We need to inject a script that patches `fetch()` and `XHR` at `document_start`.
2. **WebSocket interception matters** — Copilot and some Claude interfaces use WebSockets, not just HTTP POST. Need to patch `WebSocket.send` too.
3. **Enterprise/personal account detection** is valuable for enterprise customers (Phase 2+).
4. **Our local-only architecture is a genuine differentiator** — Prompt Security sends all user prompts to their cloud for analysis, which is ironic for a privacy tool. Our Presidio-based local approach avoids this entirely.
5. **File upload scanning** is worth considering — they scan text-based file uploads, which is a real data leak vector.
6. **MCP tool logging** — they track MCP server calls in Claude; worth monitoring as MCP adoption grows.

---

## Roadmap (post Phase 1 core)

### Phase 2 — Smart Backend + Coverage

- **Smart body parser** — build a wrapper around Presidio that understands JSON structure. Send full request body (like Prompt Security does), parse platform-specific formats server-side, scan only user text, return modified body. Moves platform knowledge from extension to proxy so the extension stays thin.
- **Expand endpoint coverage** — add all ChatGPT input endpoints (autocomplete `input_text`, `/f/conversation/prepare` partial queries, file uploads). Mirror Prompt Security's full endpoint list per platform.
- **Tune Presidio recognizers** — remove noisy/unnecessary detectors (US_DRIVER_LICENSE, IBAN, US_PASSPORT etc. that cause false positives). Keep: PERSON, EMAIL, PHONE, CREDIT_CARD, IN_AADHAAR, IN_PAN, IN_UPI_ID, IP_ADDRESS, US_SSN.
- **Custom validators** — implement Luhn algorithm for credit cards, Verhoeff checksum for Aadhaar, PAN format validation, instead of relying on Presidio's regex-only matching. Reduces false positives significantly.

### Phase 3 — Native App + De-anonymization

- **macOS native app** — package the Go proxy + Presidio into a lightweight menu bar app. Auto-starts on login, shows status icon, no terminal needed. Explore PyInstaller for Presidio binary or embed Python runtime.
- **De-anonymization mapping** — store `<PERSON_1>` → "Hari Prasad", `<PERSON_2>` → "John Smith" etc. in local encrypted storage. Option to de-anonymize LLM responses client-side (map tokens back to real values). Might be overkill but useful for workflows where you need the real output.

### Phase 4 — Distribution

- **Binary distribution** — single downloadable package (DMG/pkg for macOS) containing the proxy + Presidio + spaCy model. No Python/Go install needed.
- **Chrome Web Store** — publish extension for free. Extension connects to locally-installed proxy.
- **Homebrew formula** — `brew install pii-guard` for the backend.
- **Windows/Linux ports** — after macOS is stable.
