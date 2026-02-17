/**
 * PII Guard — Background Service Worker
 *
 * Responsibilities:
 * 1. Inject inject.js into MAIN world on target sites (bypasses CSP)
 * 2. Relay anonymization requests from content.js to localhost:9400
 * 3. Manage badge and popup state
 */

const PROXY_URL = "http://localhost:9400";

let proxyHealthy = false;
let enabled = true;
let totalRedactions = 0;
let redactionLog = [];
const injectedTabs = new Set();

// ==========================================================================
// 1. Inject page script into MAIN world (bypasses CSP)
// ==========================================================================

async function injectPageScript(tabId) {
  if (injectedTabs.has(tabId)) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["src/inject.js"],
      world: "MAIN",
      injectImmediately: true,
    });
    injectedTabs.add(tabId);
  } catch (e) {
    // Tab might not be ready yet, or URL doesn't match permissions
  }
}

chrome.webNavigation.onCommitted.addListener(
  (details) => {
    if (details.frameId === 0) {
      injectedTabs.delete(details.tabId);
      injectPageScript(details.tabId);
    }
  },
  {
    url: [
      { hostEquals: "chatgpt.com" },
      { hostEquals: "claude.ai" },
      { hostEquals: "gemini.google.com" },
    ],
  }
);

chrome.tabs.onRemoved.addListener((tabId) => injectedTabs.delete(tabId));

// ==========================================================================
// 2. Handle messages from content script
// ==========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "anonymize") {
    handleAnonymize(message.text).then(sendResponse);
    return true; // async
  }

  if (message.action === "getState") {
    sendResponse({ enabled, proxyHealthy, totalRedactions, redactionLog: redactionLog.slice(-50) });
    return false;
  }

  if (message.action === "setEnabled") {
    enabled = message.enabled;
    updateBadge();
    sendResponse({ enabled });
    return false;
  }

  if (message.action === "clearLog") {
    redactionLog = [];
    totalRedactions = 0;
    updateBadge();
    sendResponse({ ok: true });
    return false;
  }
});

async function handleAnonymize(text) {
  if (!enabled) {
    return { text, modified: false, error: "disabled" };
  }

  try {
    const resp = await fetch(`${PROXY_URL}/anonymize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      return { text, modified: false, error: `proxy_${resp.status}` };
    }

    const result = await resp.json();

    if (result.count > 0) {
      totalRedactions += result.count;
      redactionLog.push({
        timestamp: Date.now(),
        entities: result.entities,
        count: result.count,
      });
      if (redactionLog.length > 200) redactionLog = redactionLog.slice(-100);
      updateBadge();
    }

    return {
      text: result.text,
      modified: result.count > 0,
      count: result.count,
      entities: result.entities,
    };
  } catch (e) {
    return { text, modified: false, error: e.message };
  }
}

// ==========================================================================
// 3. Proxy health check & badge
// ==========================================================================

async function checkProxyHealth() {
  try {
    const resp = await fetch(`${PROXY_URL}/health`, { signal: AbortSignal.timeout(2000) });
    proxyHealthy = resp.ok;
  } catch {
    proxyHealthy = false;
  }
  updateBadge();
}

function updateBadge() {
  if (!enabled) {
    chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
    chrome.action.setBadgeText({ text: "OFF" });
  } else if (!proxyHealthy) {
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    chrome.action.setBadgeText({ text: "!" });
  } else if (totalRedactions > 0) {
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
    chrome.action.setBadgeText({ text: totalRedactions > 99 ? "99+" : String(totalRedactions) });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

checkProxyHealth();
setInterval(checkProxyHealth, 30000);
