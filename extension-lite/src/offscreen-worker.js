/**
 * PII Guard Lite — Offscreen Worker
 *
 * Runs in an offscreen document (not the service worker).
 * Hosts both Tier 1 (regex) and Tier 2 (Transformers.js NER) detection.
 *
 * Communication: background.js → chrome.runtime.sendMessage → this worker.
 */

import { detect, detectWithRegex } from "./pii/detector.js";

let nerPipeline = null;
let nerLoading = false;
let nerReady = false;
let nerError = null;

/**
 * Load the NER model. Called once on startup.
 * Uses dynamic import so the build can tree-shake if needed.
 */
async function loadNerModel() {
  if (nerLoading || nerReady) return;
  nerLoading = true;

  try {
    const { pipeline, env } = await import("@xenova/transformers");

    // Use local WASM files bundled with the extension
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("wasm/");
    // Disable remote model fetching — use cached/local models
    env.allowRemoteModels = true;
    env.allowLocalModels = false;

    nerPipeline = await pipeline("token-classification", "Xenova/bert-base-NER", {
      quantized: true,
    });

    nerReady = true;
    nerLoading = false;
    console.log("[PII Guard Lite] NER model loaded successfully");
  } catch (err) {
    nerError = err.message;
    nerLoading = false;
    console.warn("[PII Guard Lite] NER model failed to load, using regex-only:", err.message);
  }
}

// Start loading the model immediately
loadNerModel();

/**
 * Handle detection requests from background.js.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "detect") return false;

  const text = message.text;
  if (!text || text.length < 3) {
    sendResponse({ text, entities: [], count: 0 });
    return false;
  }

  // If NER is ready, use full pipeline (async)
  if (nerReady && nerPipeline) {
    (async () => {
      try {
        const nerResults = await nerPipeline(text);
        const result = detect(text, nerResults);
        sendResponse(result);
      } catch (err) {
        console.warn("[PII Guard Lite] NER inference error, falling back to regex:", err.message);
        const result = detect(text, null);
        sendResponse(result);
      }
    })();
    return true; // async sendResponse
  }

  // NER not ready — use regex-only (sync)
  const result = detect(text, null);
  sendResponse(result);
  return false;
});

// Respond to status queries
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "getDetectorStatus") return false;
  sendResponse({
    nerReady,
    nerLoading,
    nerError,
    mode: nerReady ? "full" : "regex-only",
  });
  return false;
});
