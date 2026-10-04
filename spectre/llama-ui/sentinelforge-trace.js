(() => {
  "use strict";

  const TRACE_KEY = "spectre.chat.trace.v1:";
  const SETTINGS_KEY = "spectre.ui.settings.v1";
  const MAX_ENTRIES = 80;
  const MAX_TEXT = 120000;
  const MAX_TOOL_TEXT = 40000;

  let activeKey = "";
  let state = { entries: [] };
  let panel = null;
  let entryList = null;
  let renderQueued = false;
  let saveTimer = 0;
  let entrySequence = 0;

  function getChatId() {
    try {
      const session = window.SF?.session;
      if (session?.currentChatId) return String(session.currentChatId());
    } catch (_) {}
    const match = window.location.pathname.match(/\/chat\/([^/?#]+)/)
      || window.location.hash.match(/^#\/chat\/([^/?#]+)/);
    return match?.[1] || `home:${window.location.pathname}`;
  }

  function storageKey() {
    return `${TRACE_KEY}${encodeURIComponent(getChatId())}`;
  }

  function safeJson(value) {
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  function textOf(value) {
    if (typeof value === "string") return value;
    if (value == null) return "";
    if (Array.isArray(value)) {
      return value.map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return safeJson(part);
      }).join("\n");
    }
    return safeJson(value);
  }

  function clipped(value, limit = MAX_TEXT) {
    const text = textOf(value);
    return text.length <= limit ? text : `${text.slice(0, limit)}\n[trace output truncated]`;
  }

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      const context = Number(saved.context_size);
      return { context_size: [32768, 65536, 131072].includes(context) ? context : 32768 };
    } catch (_) {
      return { context_size: 32768 };
    }
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey()) || "{}");
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      return { entries: entries.filter((entry) => entry && typeof entry === "object").slice(-MAX_ENTRIES) };
    } catch (_) {
      return { entries: [] };
    }
  }

  function ensureState() {
    const key = storageKey();
    if (key === activeKey) return state;
    activeKey = key;
    state = loadState();
    entrySequence = state.entries.reduce((max, entry) => Math.max(max, Number(entry.sequence) || 0), 0);
    return state;
  }

  function saveState() {
    ensureState();
    state.entries = state.entries.slice(-MAX_ENTRIES);
    const serializable = {
      entries: state.entries.map(({ signal, ...entry }) => entry)
    };
    try {
      localStorage.setItem(activeKey, JSON.stringify(serializable));
    } catch (_) {
      state.entries = state.entries.slice(-20);
      try {
        localStorage.setItem(activeKey, JSON.stringify({ entries: state.entries.map(({ signal, ...entry }) => entry) }));
      } catch (_) {}
    }
  }

  function scheduleUpdate(immediate = false) {
    if (immediate) {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
      saveState();
      render();
      return;
    }
    if (!saveTimer) {
      saveTimer = window.setTimeout(() => {
        saveTimer = 0;
        saveState();
      }, 120);
    }
    if (renderQueued) return;
    renderQueued = true;
    const paint = () => {
      renderQueued = false;
      render();
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(paint);
    else window.setTimeout(paint, 0);
  }

  function appendText(target, field, value, limit = MAX_TEXT) {
    const addition = textOf(value);
    if (!addition) return;
    const current = String(target[field] || "");
    if (current.length >= limit) return;
    target[field] = current + addition.slice(0, limit - current.length);
  }

  function newId() {
    try { return crypto.randomUUID(); } catch (_) { return `${Date.now()}-${Math.random()}`; }
  }

  function newEntry(messages, signal) {
    const user = [...messages].reverse().find((message) => message?.role === "user");
    return {
      id: newId(),
      sequence: ++entrySequence,
      started_at: new Date().toISOString(),
      finished_at: null,
      status: "running",
      context_size: readSettings().context_size,
      input: clipped(user?.content || "", 20000),
      reasoning: "",
      output: "",
      tools: [],
      tool_results: [],
      usage: null,
      finish_reason: null,
      error: null,
      signal
    };
  }

  function findToolInEntry(entry, callId, index) {
    const tools = Array.isArray(entry?.tools) ? entry.tools : [];
    return tools.find((tool) => (callId && tool.id === callId) || (index != null && tool.index === index)) || null;
  }

  function findTool(callId, index) {
    if (!callId && index == null) return null;
    for (let i = state.entries.length - 1; i >= 0; i -= 1) {
      const tools = Array.isArray(state.entries[i].tools) ? state.entries[i].tools : [];
      const found = tools.find((tool) => (callId && tool.id === callId) || (index != null && tool.index === index));
      if (found) return found;
    }
    return null;
  }

  function mergeToolCall(entry, call) {
    const fn = call?.function && typeof call.function === "object" ? call.function : call || {};
    const index = Number.isInteger(call?.index) ? call.index : 0;
    const suppliedId = typeof call?.id === "string" ? call.id : "";
    let tool = findToolInEntry(entry, suppliedId, index);
    if (!tool && suppliedId) tool = findTool(suppliedId, null);
    if (!tool) {
      tool = {
        id: suppliedId || `index:${index}`,
        index,
        name: "",
        arguments: "",
        result: "",
        status: "called"
      };
      entry.tools.push(tool);
    }
    if (suppliedId) tool.id = suppliedId;
    if (typeof fn.name === "string") tool.name = fn.name;
    if (fn.arguments != null) appendText(tool, "arguments", fn.arguments, MAX_TOOL_TEXT);
    tool.status = "called";
    return tool;
  }

  function recordRequestHistory(entry, messages) {
    if (!Array.isArray(messages)) return;
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      if (message.role === "tool") {
        const callId = typeof message.tool_call_id === "string" ? message.tool_call_id : "";
        const tool = findTool(callId, null);
        if (tool) {
          appendText(tool, "result", message.content, MAX_TOOL_TEXT);
          tool.status = "completed";
        } else {
          entry.tool_results.push({
            call_id: callId,
            name: typeof message.name === "string" ? message.name : "tool",
            content: clipped(message.content, MAX_TOOL_TEXT)
          });
        }
      } else if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
        message.tool_calls.forEach((call) => mergeToolCall(entry, call));
      }
    }
  }

  function applyPayload(entry, payload) {
    if (!payload || typeof payload !== "object") return;
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
    const delta = choice?.delta || choice?.message || {};
    const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking
      ?? payload.reasoning_content ?? payload.reasoning;
    if (reasoning != null) appendText(entry, "reasoning", reasoning);

    const content = delta.content ?? choice?.text ?? payload.content;
    if (content != null) {
      const contentString = textOf(content);
      const thinking = contentString.match(/<think>([\s\S]*?)<\/think>/i);
      if (thinking?.[1]) appendText(entry, "reasoning", thinking[1]);
      appendText(entry, "output", contentString);
    }

    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.forEach((call) => mergeToolCall(entry, call));
    }
    if (delta.function_call && typeof delta.function_call === "object") {
      mergeToolCall(entry, { index: 0, function: delta.function_call });
    }
    if (Array.isArray(delta.tools)) delta.tools.forEach((call) => mergeToolCall(entry, call));
    if (choice?.finish_reason != null) entry.finish_reason = choice.finish_reason;
    if (payload.usage && typeof payload.usage === "object") entry.usage = payload.usage;
  }

  function finish(entry, status, error) {
    if (entry.status === "cancelled" && status !== "cancelled") return;
    entry.status = status;
    entry.finished_at = new Date().toISOString();
    if (error) entry.error = clipped(error.message || error, 2000);
    delete entry.signal;
    scheduleUpdate(true);
  }

  function processSseBlock(entry, block) {
    const lines = block.split(/\r?\n/);
    const data = lines.filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!data) return;
    if (data === "[DONE]") {
      entry.saw_done = true;
      return;
    }
    try {
      applyPayload(entry, JSON.parse(data));
      scheduleUpdate();
    } catch (_) {
      // Ignore non-JSON server comments while keeping the original response intact.
    }
  }

  async function observeStream(stream, entry) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let separator = buffer.match(/\r?\n\r?\n/);
        while (separator && separator.index != null) {
          processSseBlock(entry, buffer.slice(0, separator.index));
          buffer = buffer.slice(separator.index + separator[0].length);
          separator = buffer.match(/\r?\n\r?\n/);
        }
        scheduleUpdate();
      }
      buffer += decoder.decode();
      if (buffer.trim()) processSseBlock(entry, buffer);
      if (entry.signal?.aborted) finish(entry, "cancelled");
      else finish(entry, "completed");
    } catch (error) {
      const cancelled = entry.signal?.aborted || error?.name === "AbortError";
      finish(entry, cancelled ? "cancelled" : "error", error);
    }
  }

  async function observeJson(response, entry) {
    try {
      applyPayload(entry, await response.clone().json());
      finish(entry, "completed");
    } catch (error) {
      finish(entry, "error", error);
    }
  }

  function isChatRequest(url) {
    try { return /\/v1\/chat\/completions(?:\/|\?|$)/.test(new URL(url, location.href).pathname); }
    catch (_) { return /\/v1\/chat\/completions(?:\/|\?|$)/.test(String(url)); }
  }

  function requestMessages(init) {
    try {
      const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      return Array.isArray(payload.messages) ? payload.messages : [];
    } catch (_) {
      return [];
    }
  }

  function observeRequest(init, signal) {
    ensureState();
    const messages = requestMessages(init);
    const entry = newEntry(messages, signal || init?.signal);
    recordRequestHistory(entry, messages);
    state.entries.push(entry);
    state.entries = state.entries.slice(-MAX_ENTRIES);
    scheduleUpdate(true);
    return entry;
  }

  function installFetchObserver() {
    if (window.fetch.sentinelForgeTraceWrapped) return;
    const originalFetch = window.fetch.bind(window);
    const wrappedFetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input?.url || "";
      if (!isChatRequest(url)) return originalFetch(input, init);

      const entry = observeRequest(init, init?.signal || input?.signal);
      let response;
      try {
        response = await originalFetch(input, init);
      } catch (error) {
        const cancelled = init?.signal?.aborted || error?.name === "AbortError";
        finish(entry, cancelled ? "cancelled" : "error", error);
        throw error;
      }
      if (!response.ok) {
        finish(entry, "error", new Error(`Model request failed (${response.status})`));
        return response;
      }
      if (response.body && typeof response.body.tee === "function") {
        const [uiStream, traceStream] = response.body.tee();
        void observeStream(traceStream, entry);
        return new Response(uiStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
      void observeJson(response, entry);
      return response;
    };
    wrappedFetch.sentinelForgeTraceWrapped = true;
    window.fetch = wrappedFetch;
  }

  function addTextSection(parent, label, value, className = "") {
    if (!value) return;
    const section = document.createElement("section");
    section.className = `sf-trace-section ${className}`.trim();
    const heading = document.createElement("div");
    heading.className = "sf-trace-label";
    heading.textContent = label;
    const body = document.createElement("pre");
    body.className = "sf-trace-pre";
    body.textContent = value;
    section.append(heading, body);
    parent.append(section);
  }

  function renderTool(parent, tool, index) {
    const section = document.createElement("section");
    section.className = "sf-trace-tool";
    const heading = document.createElement("div");
    heading.className = "sf-trace-label";
    heading.textContent = `Tool ${index + 1}: ${tool.name || "pending"} (${tool.status || "called"})`;
    section.append(heading);
    addTextSection(section, "Arguments", tool.arguments);
    addTextSection(section, "Result", tool.result, "sf-trace-result");
    parent.append(section);
  }

  function render() {
    ensureState();
    if (!panel || !entryList) return;
    entryList.replaceChildren();
    if (!state.entries.length) {
      const empty = document.createElement("div");
      empty.className = "sf-trace-empty";
      empty.textContent = "Reasoning and tool activity will appear here.";
      entryList.append(empty);
      return;
    }
    for (const entry of state.entries) {
      const details = document.createElement("details");
      details.className = `sf-trace-entry is-${entry.status || "completed"}`;
      details.open = true;
      const summary = document.createElement("summary");
      const title = document.createElement("span");
      title.textContent = `Turn ${entry.sequence || "?"}`;
      const status = document.createElement("span");
      status.className = "sf-trace-status";
      status.textContent = String(entry.status || "completed");
      summary.append(title, status);
      details.append(summary);
      const body = document.createElement("div");
      body.className = "sf-trace-entry-body";
      if (entry.input) addTextSection(body, "Request", entry.input, "sf-trace-request");
      addTextSection(body, "Reasoning", entry.reasoning, "sf-trace-reasoning");
      if (Array.isArray(entry.tools)) entry.tools.forEach((tool, index) => renderTool(body, tool, index));
      if (Array.isArray(entry.tool_results)) {
        entry.tool_results.forEach((result, index) => {
          addTextSection(body, `Tool result ${index + 1}: ${result.name || "tool"}`, result.content, "sf-trace-result");
        });
      }
      addTextSection(body, "Assistant output", entry.output, "sf-trace-output");
      if (entry.error) addTextSection(body, "Error", entry.error, "sf-trace-error");
      if (entry.usage) addTextSection(body, "Usage", safeJson(entry.usage));
      if (!body.children.length) addTextSection(body, "Status", "No streamed content received.");
      details.append(body);
      entryList.append(details);
    }
    entryList.scrollTop = entryList.scrollHeight;
  }

  function ensurePanel() {
    if (panel || !document.body) return;
    panel = document.createElement("aside");
    panel.id = "sf-agent-trace";
    panel.innerHTML = `
      <header class="sf-trace-header">
        <div>
          <strong>Agent trace</strong>
        </div>
        <div class="sf-trace-actions">
          <button type="button" class="sf-trace-clear">Clear</button>
          <button type="button" class="sf-trace-collapse" aria-label="Collapse agent trace">-</button>
        </div>
      </header>
      <div class="sf-trace-list"></div>`;
    document.body.append(panel);
    entryList = panel.querySelector(".sf-trace-list");
    panel.querySelector(".sf-trace-clear").addEventListener("click", () => {
      ensureState();
      state = { entries: [] };
      saveState();
      render();
    });
    panel.querySelector(".sf-trace-collapse").addEventListener("click", () => {
      panel.classList.toggle("is-collapsed");
    });
    render();
  }

  function injectStyles() {
    if (document.getElementById("sf-agent-trace-styles")) return;
    const style = document.createElement("style");
    style.id = "sf-agent-trace-styles";
    style.textContent = `
      #sf-agent-trace { position:fixed; top:5.25rem; right:1rem; z-index:55; display:flex; flex-direction:column; width:min(29rem,calc(100vw - 2rem)); max-height:calc(100vh - 7rem); color:#e5e7eb; background:rgba(11,16,29,.96); border:1px solid rgba(129,140,248,.35); border-radius:.85rem; box-shadow:0 20px 50px rgba(0,0,0,.45); font:12px/1.45 system-ui,sans-serif; overflow:hidden; }
      #sf-agent-trace.is-collapsed { width:auto; max-height:none; }
      #sf-agent-trace.is-collapsed .sf-trace-list { display:none; }
      .sf-trace-header { display:flex; align-items:center; justify-content:space-between; gap:.75rem; padding:.7rem .8rem; background:rgba(99,102,241,.13); border-bottom:1px solid rgba(148,163,184,.18); }
      .sf-trace-header strong { display:block; color:#f8fafc; font-size:.78rem; letter-spacing:.02em; }
      .sf-trace-actions { display:flex; align-items:center; gap:.35rem; }
      .sf-trace-actions button { padding:.25rem .45rem; color:#cbd5e1; background:rgba(255,255,255,.06); border:1px solid rgba(148,163,184,.25); border-radius:.35rem; cursor:pointer; font:inherit; }
      .sf-trace-actions button:hover { color:#fff; background:rgba(129,140,248,.25); }
      .sf-trace-list { padding:.55rem; overflow:auto; }
      .sf-trace-empty { padding:1rem .6rem; color:#94a3b8; text-align:center; }
      .sf-trace-entry { margin-bottom:.5rem; border:1px solid rgba(148,163,184,.2); border-radius:.55rem; background:rgba(15,23,42,.75); overflow:hidden; }
      .sf-trace-entry.is-running { border-color:rgba(129,140,248,.65); }
      .sf-trace-entry.is-cancelled { border-color:rgba(251,191,36,.55); }
      .sf-trace-entry.is-error { border-color:rgba(248,113,113,.65); }
      .sf-trace-entry summary { display:flex; align-items:center; justify-content:space-between; gap:.5rem; padding:.5rem .6rem; color:#f8fafc; cursor:pointer; list-style:none; }
      .sf-trace-entry summary::-webkit-details-marker { display:none; }
      .sf-trace-status { color:#a5b4fc; font-size:.65rem; text-transform:uppercase; }
      .is-cancelled .sf-trace-status { color:#fbbf24; }
      .is-error .sf-trace-status { color:#fca5a5; }
      .sf-trace-entry-body { padding:0 .6rem .6rem; }
      .sf-trace-section { margin-top:.55rem; }
      .sf-trace-label { margin-bottom:.2rem; color:#a5b4fc; font-size:.65rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
      .sf-trace-pre { max-height:14rem; margin:0; padding:.5rem; color:#dbeafe; background:rgba(2,6,23,.72); border:1px solid rgba(148,163,184,.12); border-radius:.35rem; white-space:pre-wrap; overflow:auto; font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .sf-trace-reasoning .sf-trace-pre { color:#c4b5fd; }
      .sf-trace-output .sf-trace-pre { color:#e2e8f0; }
      .sf-trace-result .sf-trace-pre { color:#bbf7d0; }
      .sf-trace-error .sf-trace-pre { color:#fecaca; }
      .sf-trace-tool { margin-top:.55rem; padding:.45rem; border-left:2px solid #818cf8; background:rgba(30,41,59,.5); }
      @media (max-width:40rem) { #sf-agent-trace { top:auto; right:.75rem; bottom:5.5rem; left:.75rem; width:auto; max-height:45vh; } }
    `;
    document.head.append(style);
  }

  function initialize() {
    ensureState();
    injectStyles();
    ensurePanel();
    window.addEventListener("popstate", () => { ensureState(); render(); });
    window.addEventListener("hashchange", () => { ensureState(); render(); });
    installFetchObserver();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
