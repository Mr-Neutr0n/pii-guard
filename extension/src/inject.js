/**
 * PII Guard — Page Script (MAIN world)
 *
 * Monkey-patches fetch/XHR/WebSocket to intercept LLM API requests.
 * Communicates with content.js via postMessage for anonymization.
 *
 * Modeled after Prompt Security's interception pattern:
 * - Specific endpoint matching (not all requests)
 * - Request.clone() to safely read body
 * - new Request(original, {body}) to preserve all properties
 * - Await anonymization before proceeding (synchronous blocking)
 * - Full body sent to proxy (no platform-specific extraction)
 * - Fail-open on any error
 */
(function () {
  "use strict";

  const MSG_PREFIX = "PII_GUARD";
  let messageIdCounter = 0;
  const pendingRequests = new Map();

  // ==========================================================================
  // Endpoint matching — only actual message-sending URLs
  // Modeled after Prompt Security's CHATGPT_CONVERSATION_URLS, CLAUDE_CHAT_URLS, etc.
  // ==========================================================================

  const ENDPOINTS = [
    // ChatGPT Web — conversation endpoints (note the /f/ path segment)
    { match: "exact", value: "/backend-api/f/conversation", host: "chatgpt.com" },
    { match: "exact", value: "/backend-api/conversation", host: "chatgpt.com" },
    { match: "exact", value: "/backend-anon/f/conversation", host: "chatgpt.com" },
    { match: "exact", value: "/backend-anon/conversation", host: "chatgpt.com" },
    // ChatGPT Web — autocompletion (sends user text while typing, logged-in only)
    { match: "includes", value: "generate_autocompletion", host: "chatgpt.com" },
    // Claude Web
    { match: "regex", value: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion$/, host: "claude.ai" },
    // OpenAI API
    { match: "exact", value: "/v1/chat/completions", host: "api.openai.com" },
    { match: "exact", value: "/v1/completions", host: "api.openai.com" },
    // Anthropic API
    { match: "exact", value: "/v1/messages", host: "api.anthropic.com" },
    // Gemini API
    { match: "includes", value: "generateContent", host: "generativelanguage.googleapis.com" },
    // Gemini Web
    { match: "includes", value: "BardChatUi", host: "gemini.google.com" },
    { match: "includes", value: "StreamGenerate", host: "gemini.google.com" },
  ];

  function isMessageEndpoint(urlString) {
    try {
      const u = new URL(urlString, window.location.origin);
      return ENDPOINTS.some((ep) => {
        if (u.hostname !== ep.host) return false;
        if (ep.match === "exact") return u.pathname === ep.value;
        if (ep.match === "regex") return ep.value.test(u.pathname);
        if (ep.match === "includes") return u.pathname.includes(ep.value);
        return false;
      });
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Extract user text from JSON body (platform-specific)
  // Only the user's message text is sent to Presidio — not timestamps, UUIDs, etc.
  // ==========================================================================

  function extractUserText(bodyStr) {
    try {
      const parsed = JSON.parse(bodyStr);

      // ChatGPT format: messages[].content.parts[] (string elements)
      if (parsed?.messages && Array.isArray(parsed.messages)) {
        for (let i = parsed.messages.length - 1; i >= 0; i--) {
          const msg = parsed.messages[i];
          if (msg?.author?.role !== "user" && msg?.role !== "user") continue;
          const parts = msg?.content?.parts;
          if (!parts || !Array.isArray(parts)) continue;
          const textParts = parts.map((p, idx) => ({ idx, val: p })).filter((p) => typeof p.val === "string");
          if (textParts.length === 0) continue;
          const combinedText = textParts.map((p) => p.val).join("\n");
          return {
            text: combinedText,
            replaceWith: (newText) => {
              // Split back if there were multiple text parts
              const newParts = newText.split("\n");
              for (let j = 0; j < textParts.length; j++) {
                parts[textParts[j].idx] = j < newParts.length ? newParts[j] : "";
              }
              return JSON.stringify(parsed);
            },
          };
        }
      }

      // Claude format: prompt field
      if (typeof parsed?.prompt === "string" && parsed.prompt.length > 0) {
        return {
          text: parsed.prompt,
          replaceWith: (newText) => {
            parsed.prompt = newText;
            return JSON.stringify(parsed);
          },
        };
      }

      // OpenAI/Anthropic API format: messages[].content (string or array)
      if (parsed?.messages && Array.isArray(parsed.messages)) {
        for (let i = parsed.messages.length - 1; i >= 0; i--) {
          const msg = parsed.messages[i];
          if (msg?.role !== "user") continue;
          if (typeof msg.content === "string") {
            return {
              text: msg.content,
              replaceWith: (newText) => {
                msg.content = newText;
                return JSON.stringify(parsed);
              },
            };
          }
          if (Array.isArray(msg.content)) {
            const textBlocks = msg.content.filter((c) => c.type === "text" && typeof c.text === "string");
            if (textBlocks.length === 0) continue;
            const combinedText = textBlocks.map((c) => c.text).join("\n");
            return {
              text: combinedText,
              replaceWith: (newText) => {
                const newParts = newText.split("\n");
                for (let j = 0; j < textBlocks.length; j++) {
                  textBlocks[j].text = j < newParts.length ? newParts[j] : "";
                }
                return JSON.stringify(parsed);
              },
            };
          }
        }
      }

      // Gemini API format: contents[].parts[].text
      if (parsed?.contents && Array.isArray(parsed.contents)) {
        for (let i = parsed.contents.length - 1; i >= 0; i--) {
          const content = parsed.contents[i];
          if (content?.role !== "user") continue;
          const textParts = content.parts?.filter((p) => typeof p.text === "string");
          if (!textParts || textParts.length === 0) continue;
          const combinedText = textParts.map((p) => p.text).join("\n");
          return {
            text: combinedText,
            replaceWith: (newText) => {
              const newParts = newText.split("\n");
              for (let j = 0; j < textParts.length; j++) {
                textParts[j].text = j < newParts.length ? newParts[j] : "";
              }
              return JSON.stringify(parsed);
            },
          };
        }
      }

      // Fallback: common text fields (autocompletion, draft, etc.)
      // ChatGPT autocompletion uses "input_text"
      for (const field of ["input_text", "prompt", "text", "prefix", "content", "query"]) {
        if (typeof parsed?.[field] === "string" && parsed[field].length > 0) {
          return {
            text: parsed[field],
            replaceWith: (newText) => {
              parsed[field] = newText;
              return JSON.stringify(parsed);
            },
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // Communication with content script (postMessage with correlation IDs)
  // Same pattern as Prompt Security: FROM_PAGE / FROM_BACKGROUND
  // ==========================================================================

  function sendToProxy(text) {
    return new Promise((resolve) => {
      const messageId = `pg_${++messageIdCounter}_${Date.now()}`;
      pendingRequests.set(messageId, resolve);

      window.postMessage({
        type: `${MSG_PREFIX}_FROM_PAGE`,
        messageId,
        payload: { action: "anonymize", text },
      }, "*");

      // Fail-open timeout: 8 seconds (generous for local Presidio)
      setTimeout(() => {
        if (pendingRequests.has(messageId)) {
          pendingRequests.delete(messageId);
          resolve({ text, modified: false, error: "timeout" });
        }
      }, 8000);
    });
  }

  // Listen for responses from content script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== `${MSG_PREFIX}_FROM_BACKGROUND`) return;

    const { messageId, response } = event.data;
    const pending = pendingRequests.get(messageId);
    if (pending) {
      pendingRequests.delete(messageId);
      pending(response);
    }
  });

  // ==========================================================================
  // Monkey-patch: fetch
  // ==========================================================================

  const originalFetch = window.fetch;

  window.fetch = async function () {
    try {
      // Extract URL and method WITHOUT constructing a Request (avoids consuming body)
      // Same approach as Prompt Security — inspect arguments first, only build Request for matches
      const input = arguments[0];
      const init = arguments[1];
      let url, method;

      if (input instanceof Request) {
        url = input.url;
        method = input.method;
      } else {
        url = String(input);
        method = init?.method || "GET";
      }

      // Only POST/PUT — pass GETs through untouched
      if (method !== "POST" && method !== "PUT") {
        return originalFetch.apply(this, arguments);
      }

      if (!isMessageEndpoint(url)) {
        return originalFetch.apply(this, arguments);
      }

      // NOW it's safe to construct a Request (only for matching endpoints)
      const request = new Request(input, init);

      // Clone to read body without consuming the original
      const bodyText = await request.clone().text();
      if (!bodyText || bodyText.length < 10) {
        return originalFetch.call(this, request);
      }

      console.log(`[PII Guard] Intercepted: POST ${new URL(url).pathname} (${bodyText.length} chars)`);

      // Extract ONLY user text from JSON body, anonymize it, put it back.
      // Sending the full body to Presidio causes false positives on timestamps,
      // model names, UUIDs, etc. Platform-specific extraction is required.
      const extracted = extractUserText(bodyText);
      if (!extracted || !extracted.text || extracted.text.length < 3) {
        return originalFetch.call(this, request);
      }

      const result = await sendToProxy(extracted.text);

      if (result.modified && result.text !== extracted.text) {
        const finalBody = extracted.replaceWith(result.text);
        console.log(`[PII Guard] Redacted ${result.count || "?"} PII entities`);
        const modified = new Request(request, { body: finalBody });
        return originalFetch.call(this, modified);
      }

      // No PII found or proxy down — send original
      return originalFetch.call(this, request);
    } catch (e) {
      console.warn("[PII Guard] fetch error (fail-open):", e.message);
      return originalFetch.apply(this, arguments);
    }
  };

  // ==========================================================================
  // Monkey-patch: XMLHttpRequest
  // ==========================================================================

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._pgMethod = method;
    this._pgURL = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const method = (this._pgMethod || "GET").toUpperCase();
    if (method !== "POST" && method !== "PUT" || !body || !this._pgURL) {
      return originalXHRSend.call(this, body);
    }

    let resolved;
    try {
      resolved = new URL(this._pgURL, window.location.origin).href;
    } catch {
      return originalXHRSend.call(this, body);
    }

    if (!isMessageEndpoint(resolved)) {
      return originalXHRSend.call(this, body);
    }

    const xhr = this;
    const bodyStr = typeof body === "string" ? body : new TextDecoder().decode(body);
    if (!bodyStr || bodyStr.length < 10) {
      return originalXHRSend.call(xhr, body);
    }

    console.log(`[PII Guard] Intercepted: XHR POST ${new URL(resolved).pathname}`);

    const xhrExtracted = extractUserText(bodyStr);
    if (!xhrExtracted || !xhrExtracted.text || xhrExtracted.text.length < 3) {
      return originalXHRSend.call(xhr, body);
    }

    sendToProxy(xhrExtracted.text)
      .then((result) => {
        if (result.modified) {
          originalXHRSend.call(xhr, xhrExtracted.replaceWith(result.text));
        } else {
          originalXHRSend.call(xhr, body);
        }
      })
      .catch(() => originalXHRSend.call(xhr, body));
  };

  // ==========================================================================
  // Monkey-patch: WebSocket
  // ==========================================================================

  const originalWSSend = WebSocket.prototype.send;

  WebSocket.prototype.send = function (data) {
    if (typeof data !== "string" || data.length < 10 || !isMessageEndpoint(this.url || "")) {
      return originalWSSend.call(this, data);
    }

    const ws = this;
    const wsExtracted = extractUserText(data);
    if (!wsExtracted || !wsExtracted.text || wsExtracted.text.length < 3) {
      return originalWSSend.call(ws, data);
    }

    sendToProxy(wsExtracted.text)
      .then((result) => {
        if (result.modified) {
          console.log(`[PII Guard] WS: redacted ${result.count || "?"} PII entities`);
          originalWSSend.call(ws, wsExtracted.replaceWith(result.text));
        } else {
          originalWSSend.call(ws, data);
        }
      })
      .catch(() => originalWSSend.call(ws, data));
  };

  console.log("[PII Guard] Request interception active");
})();
