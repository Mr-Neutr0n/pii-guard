/**
 * PII Guard Lite — Background Service Worker
 *
 * Same interception/injection logic as Full version, but routes
 * anonymization to an offscreen document (in-browser NER + regex)
 * instead of the Go proxy.
 *
 * No backend dependency. Everything runs locally in the browser.
 */

let enabled = true;
let totalRedactions = 0;
let redactionLog = [];
let detectorReady = false;
const injectedTabs = new Set();

// ==========================================================================
// 1. Offscreen document lifecycle
// ==========================================================================

const OFFSCREEN_URL = "src/offscreen.html";

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });

  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS"],
    justification: "PII detection using NER model inference and regex matching",
  });
}

// Create offscreen document on startup
ensureOffscreenDocument().then(() => {
  // Check detector status after a moment
  setTimeout(async () => {
    try {
      const status = await chrome.runtime.sendMessage({ action: "getDetectorStatus" });
      detectorReady = true;
      console.log("[PII Guard Lite] Detector status:", status?.mode || "unknown");
    } catch {
      console.warn("[PII Guard Lite] Could not reach offscreen detector");
    }
    updateBadge();
  }, 2000);
});

// ==========================================================================
// 2. Inject page script into MAIN world (same as Full version)
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
// 3. Handle messages from content script
// ==========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "anonymize") {
    handleAnonymize(message.text).then(sendResponse);
    return true; // async
  }

  if (message.action === "getState") {
    sendResponse({
      enabled,
      proxyHealthy: detectorReady, // reuse field for popup compatibility
      totalRedactions,
      redactionLog: redactionLog.slice(-50),
    });
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
    // Ensure offscreen document is alive
    await ensureOffscreenDocument();

    // Send to offscreen document for detection
    const result = await chrome.runtime.sendMessage({
      action: "detect",
      text,
    });

    if (!result) {
      return { text, modified: false, error: "no_response" };
    }

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
    // Fail-open: if detector is unavailable, let the request through
    console.warn("[PII Guard Lite] Detection failed (fail-open):", e.message);
    return { text, modified: false, error: e.message };
  }
}

// ==========================================================================
// 4. Badge
// ==========================================================================

function updateBadge() {
  if (!enabled) {
    chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
    chrome.action.setBadgeText({ text: "OFF" });
  } else if (!detectorReady) {
    chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
    chrome.action.setBadgeText({ text: "..." });
  } else if (totalRedactions > 0) {
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
    chrome.action.setBadgeText({ text: totalRedactions > 99 ? "99+" : String(totalRedactions) });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

updateBadge();
