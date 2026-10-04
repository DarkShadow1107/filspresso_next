(() => {
  "use strict";

  const API_ROOT = "/api/v1";
  const TERMINAL = new Set(["completed", "incomplete", "failed", "cancelled"]);
  let organizationId = "";
  let eventSource = null;
  let runEventSource = null;
  let currentScanId = "";
  let currentRunId = "";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

  const api = async (path, options = {}) => {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    if (!response.ok) {
      let detail = response.statusText;
      try { detail = (await response.json()).detail || detail; } catch (_) {}
      throw new Error(detail);
    }
    return response.status === 204 ? null : response.json();
  };

  function addStyles() {
    if (document.getElementById("spectre-dashboard-styles")) return;
    const style = document.createElement("style");
    style.id = "spectre-dashboard-styles";
    style.textContent = `
      #codesentry-launcher { position: fixed; top: 1rem; right: 1rem; z-index: 9000; border: 1px solid rgba(129,140,248,.55); border-radius: 999px; padding: .55rem .9rem; color: #eef2ff; background: linear-gradient(135deg,#27245f,#111827); box-shadow: 0 10px 25px rgba(0,0,0,.35); font: 600 12px/1.2 system-ui,sans-serif; cursor: pointer; }
      #codesentry-launcher:hover { border-color: #a5b4fc; transform: translateY(-1px); }
      #codesentry-root { position: fixed; inset: 0; z-index: 10001; display: none; background: rgba(3,7,18,.76); backdrop-filter: blur(10px); font-family: Inter,ui-sans-serif,system-ui,sans-serif; color: #e5e7eb; }
      #codesentry-root.open { display: flex; justify-content: flex-end; }
      .cs-panel { width: min(44rem,100vw); height: 100%; overflow: auto; padding: 1.25rem; background: radial-gradient(circle at top right,rgba(49,46,129,.4),transparent 38%),#0b1020; border-left: 1px solid rgba(148,163,184,.18); box-shadow: -20px 0 60px rgba(0,0,0,.45); }
      .cs-header { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; margin-bottom:1.25rem; }
      .cs-kicker { color:#a5b4fc; text-transform:uppercase; letter-spacing:.14em; font-size:.65rem; font-weight:700; }
      .cs-title { margin:.25rem 0 0; font-size:1.45rem; letter-spacing:-.03em; color:#fff; }
      .cs-subtitle { color:#94a3b8; font-size:.78rem; line-height:1.5; margin:.35rem 0 0; }
      .cs-close { border:0; background:rgba(255,255,255,.06); color:#cbd5e1; width:2rem; height:2rem; border-radius:50%; cursor:pointer; }
      .cs-card { background:rgba(15,23,42,.78); border:1px solid rgba(148,163,184,.17); border-radius:1rem; padding:1rem; margin-bottom:.8rem; }
      .cs-label { display:block; color:#cbd5e1; font-size:.72rem; font-weight:700; margin-bottom:.35rem; }
       .cs-input,.cs-select { box-sizing:border-box; width:100%; border:1px solid rgba(148,163,184,.25); border-radius:.55rem; background:#090f1e; color:#f8fafc; padding:.7rem .75rem; font-size:.8rem; outline:none; }
       .cs-textarea { box-sizing:border-box; width:100%; min-height:4.5rem; resize:vertical; border:1px solid rgba(148,163,184,.25); border-radius:.55rem; background:#090f1e; color:#f8fafc; padding:.7rem .75rem; font: .8rem/1.45 system-ui,sans-serif; outline:none; }
       .cs-textarea:focus { border-color:#818cf8; box-shadow:0 0 0 3px rgba(99,102,241,.18); }
      .cs-input:focus,.cs-select:focus { border-color:#818cf8; box-shadow:0 0 0 3px rgba(99,102,241,.18); }
      .cs-row { display:grid; grid-template-columns:1fr 8rem; gap:.65rem; align-items:end; }
      .cs-actions { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; margin-top:.75rem; }
      .cs-button { border:1px solid rgba(129,140,248,.55); border-radius:.55rem; background:#4f46e5; color:#fff; padding:.65rem .85rem; font-size:.75rem; font-weight:700; cursor:pointer; }
      .cs-button.secondary { background:rgba(255,255,255,.06); border-color:rgba(148,163,184,.25); color:#cbd5e1; }
      .cs-button.danger { background:#7f1d1d; border-color:#ef4444; }
      .cs-button:disabled { cursor:wait; opacity:.55; }
      .cs-status { color:#a5b4fc; font-size:.75rem; min-height:1.1rem; }
      .cs-events { display:grid; gap:.4rem; max-height:16rem; overflow:auto; }
      .cs-event { display:grid; grid-template-columns:5rem 1fr; gap:.6rem; padding:.45rem .55rem; background:rgba(2,6,23,.55); border-radius:.45rem; font-size:.7rem; }
      .cs-event-time { color:#64748b; font-variant-numeric:tabular-nums; }
      .cs-event-message { color:#cbd5e1; line-height:1.4; }
      .cs-findings { display:grid; gap:.55rem; }
      .cs-finding { border-left:3px solid #64748b; border-radius:.5rem; background:rgba(2,6,23,.6); padding:.65rem .75rem; }
      .cs-finding.high,.cs-finding.critical { border-left-color:#f87171; }
      .cs-finding.medium { border-left-color:#fbbf24; }
      .cs-finding.low { border-left-color:#60a5fa; }
      .cs-finding-title { color:#fff; font-size:.78rem; font-weight:700; }
      .cs-finding-meta { color:#94a3b8; font-size:.67rem; margin-top:.2rem; }
      .cs-finding-evidence { color:#cbd5e1; background:#020617; border-radius:.35rem; padding:.45rem; margin:.45rem 0 0; white-space:pre-wrap; overflow-wrap:anywhere; font: .67rem/1.35 ui-monospace,SFMono-Regular,monospace; }
      .cs-report-links { display:flex; flex-wrap:wrap; gap:.45rem; }
      .cs-report-links a { color:#c4b5fd; font-size:.72rem; text-decoration:none; border-bottom:1px solid rgba(196,181,253,.4); }
      .cs-empty { color:#64748b; font-size:.75rem; }
      @media (max-width: 560px) { #codesentry-launcher { top:auto; bottom:1rem; right:1rem; } .cs-panel { padding:.85rem; } .cs-row { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }

  function renderShell() {
    if (document.getElementById("codesentry-root")) return;
    addStyles();
    const launcher = document.createElement("button");
    launcher.id = "codesentry-launcher";
    launcher.type = "button";
    launcher.textContent = "Spectre";
    launcher.setAttribute("aria-label", "Open Spectre security auditor");
    document.body.appendChild(launcher);

    const root = document.createElement("div");
    root.id = "codesentry-root";
    root.innerHTML = `
      <section class="cs-panel" role="dialog" aria-modal="true" aria-labelledby="cs-title">
        <header class="cs-header">
          <div><div class="cs-kicker">Local security lab</div><h1 class="cs-title" id="cs-title">Spectre</h1><p class="cs-subtitle">Repository evidence, deterministic scanners, Granite triage, and approval-gated PoCs. Nothing leaves this computer.</p></div>
          <button type="button" class="cs-close" id="cs-close" aria-label="Close">×</button>
        </header>
        <div class="cs-card">
          <form id="cs-form">
            <label class="cs-label" for="cs-repo-url">Authorized GitHub repository</label>
             <div class="cs-row"><input class="cs-input" id="cs-repo-url" type="url" required placeholder="https://github.com/owner/repository"><select class="cs-select" id="cs-tier"><option>T1</option><option>T2</option><option>T3</option></select></div>
             <label class="cs-label" for="cs-question" style="margin-top:.75rem">Audit question</label>
             <textarea class="cs-textarea" id="cs-question" minlength="10">Find known vulnerabilities, affected dependencies, and recent security discussions for this repository. Correlate public evidence with the checked-in source and run safe validation.</textarea>
             <div class="cs-actions"><button class="cs-button" id="cs-start" type="submit">Start scan</button><button class="cs-button secondary" id="cs-audit" type="button">Start web audit</button><button class="cs-button danger" id="cs-cancel-audit" type="button" hidden>Cancel audit</button><span class="cs-status" id="cs-status" role="status"></span></div>
          </form>
        </div>
        <div class="cs-card"><div class="cs-kicker">Activity</div><div class="cs-events" id="cs-events"><div class="cs-empty">No scan started.</div></div></div>
        <div class="cs-card"><div class="cs-kicker">Findings</div><div class="cs-findings" id="cs-findings"><div class="cs-empty">Findings appear after static analysis.</div></div></div>
        <div class="cs-card"><div class="cs-kicker">Reports</div><div class="cs-report-links" id="cs-reports"><span class="cs-empty">Reports appear when the scan finishes.</span></div></div>
        <div class="cs-card" id="cs-pocs-card" hidden><div class="cs-kicker">Reviewer queue</div><div id="cs-pocs"></div></div>
      </section>`;
    document.body.appendChild(root);
    launcher.onclick = () => root.classList.add("open");
    root.querySelector("#cs-close").onclick = () => root.classList.remove("open");
    root.onclick = (event) => { if (event.target === root) root.classList.remove("open"); };
    root.querySelector("#cs-form").addEventListener("submit", startScan);
    root.querySelector("#cs-audit").addEventListener("click", startAudit);
  }

  function setStatus(message, error = false) {
    const node = document.getElementById("cs-status");
    if (node) { node.textContent = message; node.style.color = error ? "#fca5a5" : "#a5b4fc"; }
  }

  function addEvent(event) {
    const list = document.getElementById("cs-events");
    if (!list) return;
    if (list.querySelector(".cs-empty")) list.textContent = "";
    const row = document.createElement("div");
    row.className = "cs-event";
    const time = event.created_at ? new Date(event.created_at).toLocaleTimeString() : "now";
    const stage = event.stage || event.event_type || "activity";
    const message = event.message || event.content || "";
    row.innerHTML = `<span class="cs-event-time">${escapeHtml(time)}</span><span class="cs-event-message"><strong>${escapeHtml(stage)}</strong><br>${escapeHtml(message)}</span>`;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }

  function renderFindings(findings) {
    const list = document.getElementById("cs-findings");
    if (!list) return;
    if (!findings.length) { list.innerHTML = '<div class="cs-empty">No normalized findings.</div>'; return; }
    list.innerHTML = findings.map((finding) => `
      <article class="cs-finding ${escapeHtml(finding.severity)}">
        <div class="cs-finding-title">${escapeHtml(finding.title)}</div>
        <div class="cs-finding-meta">${escapeHtml(finding.severity.toUpperCase())} · ${escapeHtml(finding.cwe || "CWE unknown")} · ${escapeHtml(finding.rule_id)} · ${escapeHtml(finding.raw_payload?.path || "unknown")} : ${escapeHtml(finding.line_start || 1)} · ${escapeHtml(finding.status)}</div>
        <div class="cs-finding-evidence">${escapeHtml(finding.evidence || finding.description)}</div>
      </article>`).join("");
  }

  function renderReports(reports) {
    const list = document.getElementById("cs-reports");
    if (!list) return;
    if (!reports.length) { list.innerHTML = '<span class="cs-empty">No reports generated.</span>'; return; }
    list.innerHTML = reports.map((report) => `<a href="${API_ROOT}/organizations/${organizationId}/reports/${report.id}/download" download>Download ${escapeHtml(report.format.toUpperCase())}</a>`).join("");
  }

  function renderPocs(pocs) {
    const card = document.getElementById("cs-pocs-card");
    const list = document.getElementById("cs-pocs");
    if (!card || !list || !pocs.length) { if (card) card.hidden = true; return; }
    card.hidden = false;
    list.innerHTML = pocs.map((poc) => `
      <article class="cs-finding"><div class="cs-finding-title">${escapeHtml(poc.title)}</div><div class="cs-finding-meta">${escapeHtml(poc.status)} · reviewer approval required</div><pre class="cs-finding-evidence">${escapeHtml(poc.code)}</pre>${poc.status === "pending" ? `<div class="cs-actions"><button class="cs-button" data-poc="${poc.id}" data-decision="approve" type="button">Approve offline run</button><button class="cs-button danger" data-poc="${poc.id}" data-decision="reject" type="button">Reject</button></div>` : ""}</article>`).join("");
    list.querySelectorAll("button[data-poc]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api(`/organizations/${organizationId}/pocs/${button.dataset.poc}/${button.dataset.decision}`, { method: "POST", body: JSON.stringify({}) });
        await refreshResults();
      } catch (error) { setStatus(error.message, true); button.disabled = false; }
    }));
  }

  async function refreshResults() {
    if (!currentScanId) return;
    try {
      const [findings, reports, pocs] = await Promise.all([
        api(`/organizations/${organizationId}/scans/${currentScanId}/findings`),
        api(`/organizations/${organizationId}/scans/${currentScanId}/reports`),
        api(`/organizations/${organizationId}/scans/${currentScanId}/pocs`)
      ]);
      renderFindings(findings); renderReports(reports); renderPocs(pocs);
    } catch (error) { setStatus(error.message, true); }
  }

  function finishStream() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    if (runEventSource) { runEventSource.close(); runEventSource = null; }
    refreshResults();
  }

  function consumeEvent(event, streamKind = "scan") {
    if (!event.data) return;
    let payload;
    try { payload = JSON.parse(event.data); } catch (_) { return; }
    addEvent(payload);
    const eventType = payload.event_type || event.type;
    const terminal = streamKind === "scan"
      ? ["scan_completed", "scan_failed", "scan_cancelled"].includes(eventType)
      : Boolean(payload.payload && TERMINAL.has(String(payload.payload.status || "")));
    if (terminal) {
      setStatus(payload.message || payload.content || eventType);
      if (payload.payload?.status) setStatus(`${streamKind === "run" ? "Audit" : "Scan"} ${payload.payload.status}.`);
      if (streamKind === "scan" && eventSource) { eventSource.close(); eventSource = null; }
      if (streamKind === "run" && runEventSource) { runEventSource.close(); runEventSource = null; }
      if (streamKind === "run") document.getElementById("cs-cancel-audit").hidden = true;
      refreshResults();
    }
  }

  function openStream() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`${API_ROOT}/organizations/${organizationId}/scans/${currentScanId}/events/stream`);
    eventSource.onmessage = (event) => consumeEvent(event, "scan");
    ["scan_started", "scan_queued", "snapshot_created", "stage_started", "findings_created", "finding_triaged", "repository_test_completed", "poc_started", "poc_completed", "poc_failed", "scan_completed", "scan_failed", "scan_cancelled"].forEach((name) => eventSource.addEventListener(name, (event) => consumeEvent(event, "scan")));
    eventSource.onerror = () => { if (eventSource && eventSource.readyState === EventSource.CLOSED) setStatus("Event stream closed; refresh the scan to inspect results.", true); };
  }

  function getChatId() {
    try {
      const session = window.SF?.session;
      if (session?.currentChatId) return String(session.currentChatId());
    } catch (_) {}
    return window.location.hash.match(/^#\/chat\/([^/?#]+)/)?.[1] || `home:${window.location.pathname}`;
  }

  function repositoryKey(value) {
    return String(value || "").trim().replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase();
  }

  async function findOrCreateRepository(url) {
    const repositories = await api(`/organizations/${organizationId}/repositories`);
    const existing = repositories.find((item) => repositoryKey(item.remote_url) === repositoryKey(url));
    if (existing) return existing;
    const name = url.split("/").filter(Boolean).pop().replace(/\.git$/i, "") || "repository";
    return api(`/organizations/${organizationId}/repositories`, {
      method: "POST",
      body: JSON.stringify({ name, remote_url: url })
    });
  }

  function openRunStream() {
    if (runEventSource) runEventSource.close();
    runEventSource = new EventSource(`${API_ROOT}/organizations/${organizationId}/runs/${currentRunId}/events/stream`);
    runEventSource.onmessage = (event) => consumeEvent(event, "run");
    ["plan", "status", "tool_call", "tool_result", "reasoning_summary", "observation", "action", "thought", "compaction", "error", "proposal_created", "artifact_created"].forEach((name) => runEventSource.addEventListener(name, (event) => consumeEvent(event, "run")));
    runEventSource.onerror = () => { if (runEventSource && runEventSource.readyState === EventSource.CLOSED) setStatus("Audit trace closed; persisted events remain available.", true); };
  }

  async function startScan(event) {
    event.preventDefault();
    const button = document.getElementById("cs-start");
    const url = document.getElementById("cs-repo-url").value.trim();
    const tier = document.getElementById("cs-tier").value;
    button.disabled = true;
    setStatus("Preparing repository…");
    try {
      if (!organizationId) {
        const organizations = await api("/organizations");
        organizationId = organizations[0]?.id || "";
      }
      if (!organizationId) throw new Error("Local Spectre workspace is not ready");
      const repository = await findOrCreateRepository(url);
      const scan = await api(`/organizations/${organizationId}/repositories/${repository.id}/scans`, { method: "POST", body: JSON.stringify({ tier, max_findings: 500, run_static_scanners: true, request_poc_proposals: true }) });
      currentScanId = scan.id;
      currentRunId = "";
      if (runEventSource) { runEventSource.close(); runEventSource = null; }
      document.getElementById("cs-events").innerHTML = "";
      document.getElementById("cs-findings").innerHTML = '<div class="cs-empty">Static analysis is running…</div>';
      document.getElementById("cs-reports").innerHTML = '<span class="cs-empty">Waiting for scan completion…</span>';
      setStatus(`Scan ${scan.id.slice(0, 8)} queued.`);
      openStream();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function startAudit() {
    const button = document.getElementById("cs-audit");
    const url = document.getElementById("cs-repo-url").value.trim();
    const question = document.getElementById("cs-question").value.trim();
    const tier = document.getElementById("cs-tier").value;
    button.disabled = true;
    setStatus("Queueing repository audit…");
    try {
      if (!organizationId) {
        const organizations = await api("/organizations");
        organizationId = organizations[0]?.id || "";
      }
      if (!organizationId) throw new Error("Local Spectre workspace is not ready");
      if (question.length < 10) throw new Error("Enter an audit question with at least 10 characters");
      const repository = await findOrCreateRepository(url);
      const run = await api(`/organizations/${organizationId}/repositories/${repository.id}/audits`, {
        method: "POST",
        body: JSON.stringify({
          question,
          title: `Security audit: ${repository.name}`,
          conversation_id: getChatId(),
          scan_tier: tier,
          run_static_scanners: true,
          run_repository_tests: true,
          request_poc_proposals: true
        })
      });
      currentRunId = run.id;
      currentScanId = run.blackboard?.codesentry_scan_id || "";
      document.getElementById("cs-cancel-audit").hidden = false;
      document.getElementById("cs-events").innerHTML = "";
      document.getElementById("cs-findings").innerHTML = '<div class="cs-empty">Repository scan is running…</div>';
      document.getElementById("cs-reports").innerHTML = '<span class="cs-empty">Waiting for audit completion…</span>';
      setStatus(`Audit ${run.id.slice(0, 8)} queued.`);
      openRunStream();
      if (currentScanId) openStream();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function cancelAudit() {
    if (!currentRunId) return;
    const button = document.getElementById("cs-cancel-audit");
    button.disabled = true;
    setStatus("Requesting audit cancellation…");
    try {
      await api(`/organizations/${organizationId}/runs/${currentRunId}/cancel`, { method: "POST" });
      setStatus("Cancellation recorded. The persisted trace will finish with a cancellation event.");
    } catch (error) {
      setStatus(error.message, true);
      button.disabled = false;
    }
  }

  async function loadConversationAudit() {
    try {
      const runs = await api(`/organizations/${organizationId}/runs?conversation_id=${encodeURIComponent(getChatId())}`);
      const run = runs[0];
      if (!run) return;
      currentRunId = run.id;
      currentScanId = run.blackboard?.codesentry_scan_id || "";
      document.getElementById("cs-events").innerHTML = "";
      document.getElementById("cs-cancel-audit").hidden = TERMINAL.has(String(run.status));
      addEvent({ event_type: "history", content: `Restored audit ${run.id.slice(0, 8)} (${run.status}, stage: ${run.current_stage}).` });
      openRunStream();
      if (currentScanId) {
        openStream();
        refreshResults();
      }
    } catch (_) {}
  }

  function init() {
    if (!document.body) return;
    renderShell();
    api("/organizations").then((organizations) => {
      organizationId = organizations[0]?.id || "";
      if (organizationId) loadConversationAudit();
    }).catch(() => {});
    document.getElementById("cs-cancel-audit")?.addEventListener("click", cancelAudit);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
