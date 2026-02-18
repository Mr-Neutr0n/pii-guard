document.addEventListener("DOMContentLoaded", async () => {
  const state = await chrome.runtime.sendMessage({ action: "getState" });

  // Status
  const dot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");

  if (!state.enabled) {
    dot.className = "status-dot disabled";
    statusText.textContent = "Disabled";
  } else if (state.proxyHealthy) {
    dot.className = "status-dot healthy";
    statusText.textContent = "Protected — proxy running";
  } else {
    dot.className = "status-dot unhealthy";
    statusText.textContent = "Proxy offline — requests pass through";
  }

  // Toggle
  const toggle = document.getElementById("enableToggle");
  toggle.checked = state.enabled;
  toggle.addEventListener("change", async (e) => {
    await chrome.runtime.sendMessage({
      action: "setEnabled",
      enabled: e.target.checked,
    });
    // Refresh state
    window.location.reload();
  });

  // Stats
  document.getElementById("totalCount").textContent = state.totalRedactions;

  // Redaction log
  const logEl = document.getElementById("redactionLog");
  if (state.redactionLog && state.redactionLog.length > 0) {
    logEl.innerHTML = "";
    const entries = [...state.redactionLog].reverse();
    for (const entry of entries) {
      const item = document.createElement("div");
      item.className = "log-item";
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const types = entry.entities
        .map((e) => formatEntityType(e.entity_type))
        .join(", ");
      item.innerHTML = `
        <span class="log-time">${time}</span>
        <span class="log-count">${entry.count}</span>
        <span class="log-types">${types}</span>
      `;
      logEl.appendChild(item);
    }
  }

  // Clear button
  document.getElementById("clearBtn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ action: "clearLog" });
    window.location.reload();
  });
});

function formatEntityType(type) {
  return type
    .replace(/^IN_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
