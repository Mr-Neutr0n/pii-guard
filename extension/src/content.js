/**
 * PII Guard — Content Script (ISOLATED world)
 *
 * Bridges inject.js (MAIN world) ↔ background.js (service worker).
 * Same pattern as Prompt Security: FROM_PAGE / FROM_BACKGROUND message relay.
 *
 * Primary path: chrome.runtime.sendMessage → background → proxy
 * Fallback path: direct fetch to localhost:9400 (if extension context invalidated)
 */

const MSG_PREFIX = "PII_GUARD";
const PROXY_URL = "http://localhost:9400";

// ==========================================================================
// Bridge: inject.js (page) → background.js (service worker)
// ==========================================================================

window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== `${MSG_PREFIX}_FROM_PAGE`) return;

  const { messageId, payload } = event.data;
  let response;

  try {
    // Primary: relay through background service worker
    response = await chrome.runtime.sendMessage(payload);
  } catch (e) {
    // Fallback: if extension context invalidated (happens during dev reloads),
    // call the proxy directly. Content scripts in MV3 can fetch host_permissions URLs.
    console.warn("[PII Guard] Background unreachable, trying direct proxy:", e.message);
    try {
      response = await directProxyCall(payload);
    } catch (e2) {
      console.error("[PII Guard] Direct proxy also failed:", e2.message);
      response = { text: payload.text, modified: false, error: e2.message };
    }
  }

  // Send response back to inject.js
  window.postMessage({
    type: `${MSG_PREFIX}_FROM_BACKGROUND`,
    messageId,
    response: response || { text: payload.text, modified: false, error: "no_response" },
  }, "*");
});

// ==========================================================================
// Direct proxy fallback (bypasses background service worker)
// ==========================================================================

async function directProxyCall(payload) {
  if (payload.action !== "anonymize") {
    return { text: payload.text, modified: false };
  }

  const resp = await fetch(`${PROXY_URL}/anonymize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: payload.text }),
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    return { text: payload.text, modified: false, error: `proxy_${resp.status}` };
  }

  const result = await resp.json();
  return {
    text: result.text,
    modified: result.count > 0,
    count: result.count,
    entities: result.entities,
  };
}

console.log("[PII Guard] Content script loaded on", window.location.hostname);
