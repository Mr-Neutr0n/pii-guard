/**
 * LLM platform target definitions.
 * Each target defines how to match URLs, extract user text from request bodies,
 * and replace user text with anonymized versions.
 */

// Exported for use in inject.js (inlined at build time since inject.js runs in page context)
const TARGETS = [
  {
    name: "ChatGPT Web",
    match: (url) => url.includes("chatgpt.com/backend-api/conversation"),
    extract: (body) => {
      try {
        const parsed = JSON.parse(body);
        const messages = parsed?.messages;
        if (!messages || messages.length === 0) return null;
        const last = messages[messages.length - 1];
        const parts = last?.content?.parts;
        if (parts && parts.length > 0) {
          // Filter to string parts only (images/files are objects)
          const textParts = parts.filter((p) => typeof p === "string");
          return textParts.length > 0 ? textParts.join("\n") : null;
        }
        return null;
      } catch {
        return null;
      }
    },
    replace: (body, newText) => {
      try {
        const parsed = JSON.parse(body);
        const last = parsed.messages[parsed.messages.length - 1];
        const parts = last.content.parts;
        // Replace only string parts, preserve non-string (image/file) parts
        let replaced = false;
        for (let i = 0; i < parts.length; i++) {
          if (typeof parts[i] === "string" && !replaced) {
            parts[i] = newText;
            replaced = true;
          } else if (typeof parts[i] === "string") {
            parts[i] = "";
          }
        }
        return JSON.stringify(parsed);
      } catch {
        return body;
      }
    },
  },

  {
    name: "Claude Web",
    match: (url) =>
      /claude\.ai\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/.test(url) ||
      url.includes("claude.ai/api/append_message"),
    extract: (body) => {
      try {
        const parsed = JSON.parse(body);
        return parsed?.prompt || null;
      } catch {
        return null;
      }
    },
    replace: (body, newText) => {
      try {
        const parsed = JSON.parse(body);
        parsed.prompt = newText;
        return JSON.stringify(parsed);
      } catch {
        return body;
      }
    },
  },

  {
    name: "Gemini Web",
    match: (url) =>
      url.includes("gemini.google.com") &&
      (url.includes("BardChatUi") || url.includes("StreamGenerate")),
    extract: (body) => {
      // Gemini uses a complex nested array structure.
      // The user prompt is typically in the first deeply nested string.
      try {
        // Gemini sends form-encoded data with f.req parameter
        // which contains a JSON-encoded nested array
        if (body.startsWith("f.req=") || body.includes("&f.req=")) {
          const params = new URLSearchParams(body);
          const freq = params.get("f.req");
          if (freq) {
            const parsed = JSON.parse(freq);
            // Navigate to find the user text (usually at [0][0][0] or similar)
            return findUserText(parsed);
          }
        }
        const parsed = JSON.parse(body);
        return findUserText(parsed);
      } catch {
        return null;
      }
    },
    replace: (body, newText) => {
      try {
        if (body.startsWith("f.req=") || body.includes("&f.req=")) {
          const params = new URLSearchParams(body);
          const freq = params.get("f.req");
          if (freq) {
            const parsed = JSON.parse(freq);
            replaceUserText(parsed, newText);
            params.set("f.req", JSON.stringify(parsed));
            return params.toString();
          }
        }
        const parsed = JSON.parse(body);
        replaceUserText(parsed, newText);
        return JSON.stringify(parsed);
      } catch {
        return body;
      }
    },
  },

  {
    name: "OpenAI API",
    match: (url) =>
      url.includes("api.openai.com/v1/chat/completions") ||
      url.includes("api.openai.com/v1/completions"),
    extract: (body) => {
      try {
        const parsed = JSON.parse(body);
        const messages = parsed?.messages;
        if (!messages) return parsed?.prompt || null;
        const userMsgs = messages.filter((m) => m.role === "user");
        if (userMsgs.length === 0) return null;
        const last = userMsgs[userMsgs.length - 1];
        if (typeof last.content === "string") return last.content;
        if (Array.isArray(last.content)) {
          return last.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
        }
        return null;
      } catch {
        return null;
      }
    },
    replace: (body, newText) => {
      try {
        const parsed = JSON.parse(body);
        if (parsed.prompt) {
          parsed.prompt = newText;
          return JSON.stringify(parsed);
        }
        const userMsgs = parsed.messages.filter((m) => m.role === "user");
        const last = userMsgs[userMsgs.length - 1];
        if (typeof last.content === "string") {
          last.content = newText;
        } else if (Array.isArray(last.content)) {
          const textParts = last.content.filter((c) => c.type === "text");
          if (textParts.length > 0) textParts[0].text = newText;
          // Remove other text parts
          last.content = last.content.filter(
            (c) => c.type !== "text" || c === textParts[0]
          );
        }
        return JSON.stringify(parsed);
      } catch {
        return body;
      }
    },
  },

  {
    name: "Anthropic API",
    match: (url) => url.includes("api.anthropic.com/v1/messages"),
    extract: (body) => {
      try {
        const parsed = JSON.parse(body);
        const messages = parsed?.messages;
        if (!messages) return null;
        const userMsgs = messages.filter((m) => m.role === "user");
        if (userMsgs.length === 0) return null;
        const last = userMsgs[userMsgs.length - 1];
        if (typeof last.content === "string") return last.content;
        if (Array.isArray(last.content)) {
          return last.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
        }
        return null;
      } catch {
        return null;
      }
    },
    replace: (body, newText) => {
      try {
        const parsed = JSON.parse(body);
        const userMsgs = parsed.messages.filter((m) => m.role === "user");
        const last = userMsgs[userMsgs.length - 1];
        if (typeof last.content === "string") {
          last.content = newText;
        } else if (Array.isArray(last.content)) {
          const textParts = last.content.filter((c) => c.type === "text");
          if (textParts.length > 0) textParts[0].text = newText;
          last.content = last.content.filter(
            (c) => c.type !== "text" || c === textParts[0]
          );
        }
        return JSON.stringify(parsed);
      } catch {
        return body;
      }
    },
  },

  {
    name: "Gemini API",
    match: (url) =>
      url.includes("generativelanguage.googleapis.com") &&
      url.includes("generateContent"),
    extract: (body) => {
      try {
        const parsed = JSON.parse(body);
        const contents = parsed?.contents;
        if (!contents) return null;
        const userContents = contents.filter((c) => c.role === "user");
        if (userContents.length === 0) return null;
        const last = userContents[userContents.length - 1];
        const textParts = last.parts?.filter((p) => p.text !== undefined);
        if (textParts && textParts.length > 0) {
          return textParts.map((p) => p.text).join("\n");
        }
        return null;
      } catch {
        return null;
      }
    },
    replace: (body, newText) => {
      try {
        const parsed = JSON.parse(body);
        const userContents = parsed.contents.filter((c) => c.role === "user");
        const last = userContents[userContents.length - 1];
        const textParts = last.parts.filter((p) => p.text !== undefined);
        if (textParts.length > 0) textParts[0].text = newText;
        last.parts = last.parts.filter(
          (p) => p.text === undefined || p === textParts[0]
        );
        return JSON.stringify(parsed);
      } catch {
        return body;
      }
    },
  },
];

// Helper: recursively find the first substantial string in a nested structure (for Gemini Web)
function findUserText(obj) {
  if (typeof obj === "string" && obj.length > 2) return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findUserText(item);
      if (found) return found;
    }
  }
  return null;
}

// Helper: recursively replace the first substantial string in a nested structure (for Gemini Web)
function replaceUserText(obj, newText) {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === "string" && obj[i].length > 2) {
        obj[i] = newText;
        return true;
      }
      if (replaceUserText(obj[i], newText)) return true;
    }
  }
  return false;
}
