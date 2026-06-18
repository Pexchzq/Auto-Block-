"use strict";

const state = {
  settings: null,
  currentJobId: null,
  polling: null,
  selectedReportName: null,
  selectedReport: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function setBusy(isBusy) {
  $("#validateBtn").disabled = isBusy;
  $("#planBtn").disabled = isBusy;
  $("#applyBtn").disabled = isBusy;
  $("#retryFailedBtn").disabled = isBusy || !state.selectedReportName;
}

function showTab(name) {
  $$(".nav").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.id === `tab-${name}`));
}

function renderSummary(summary) {
  const grid = $("#summaryGrid");
  if (!summary) {
    grid.innerHTML = "";
    return;
  }

  grid.innerHTML = Object.entries(summary)
    .map(([key, value]) => `
      <div class="summary-card">
        <strong>${escapeHtml(String(value))}</strong>
        <span>${escapeHtml(key)}</span>
      </div>
    `)
    .join("");
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

async function refreshStatus() {
  const data = await api("/api/status");
  state.settings = data.settings;
  $("#serverStatus").textContent = `${data.bind} | ${data.settings.authMode}`;
  fillSettings(data.settings);
  if (data.latestReport && data.latestReport.summary) {
    renderSummary(data.latestReport.summary);
    $("#lastReportName").textContent = data.latestReport.name;
  }
}

async function refreshAccounts() {
  const data = await api("/api/accounts");
  $("#accountCount").textContent = String(data.count || 0);
  const rows = data.accounts.map((account) => `
    <tr>
      <td>${account.lineNo}</td>
      <td>${escapeHtml(account.alias)}</td>
      <td>${account.cookieFormat}</td>
    </tr>
  `);
  const invalidRows = data.invalid.map((item) => `
    <tr>
      <td>${item.lineNo}</td>
      <td>${escapeHtml(item.alias || "-")}</td>
      <td>${escapeHtml(item.reason || item.status || "invalid")}</td>
    </tr>
  `);
  $("#accountsTable").innerHTML = [...rows, ...invalidRows].join("") || `
    <tr><td colspan="3" class="muted">No local cookie file loaded.</td></tr>
  `;
}

async function saveCookies() {
  const text = $("#cookieInput").value;
  await api("/api/accounts/save", {
    method: "POST",
    body: { text },
  });
  $("#cookieInput").value = "";
  $("#saveHint").textContent = "Saved locally and cleared from textarea.";
  await refreshAccounts();
}

async function clearCookies() {
  const ok = confirm("Clear local cookies.txt? This removes saved account lines from this machine.");
  if (!ok) return;
  await api("/api/accounts/clear", { method: "POST" });
  $("#cookieInput").value = "";
  await refreshAccounts();
}

async function runImmediate(action) {
  setBusy(true);
  $("#resultPreview").textContent = `${action} running...`;
  try {
    const data = await api(`/api/${action}`, {
      method: "POST",
      body: collectSettings(),
    });
    $("#lastReportName").textContent = data.reportName || "report";
    $("#resultPreview").textContent = pretty(data.report);
    renderSummary(data.report.summary);
    await refreshReports();
  } catch (error) {
    $("#resultPreview").textContent = `Error: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

async function confirmApply() {
  const dialog = $("#confirmDialog");
  const settings = collectSettings();
  const estimatedAccounts = settings.accountLimit > 0 ? settings.accountLimit : Number($("#accountCount").textContent || 0);
  $("#applyConfirmSummary").textContent = pretty({
    speedMode: settings.applyMode,
    accountConcurrency: settings.accountConcurrency,
    accountLimit: settings.accountLimit,
    estimatedAccounts,
    estimatedDirectedPairs: estimatedAccounts > 1 ? estimatedAccounts * (estimatedAccounts - 1) : 0,
    validateConcurrency: settings.validateConcurrency,
    allowUnverifiedBlockList: settings.allowUnverifiedBlockList,
    skipBlockListCheck: settings.skipBlockListCheck,
  });

  if (typeof dialog.showModal !== "function") {
    return confirm("Apply real block requests now?");
  }
  dialog.showModal();
  const result = await new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
  });
  return result === "apply";
}

async function startApply() {
  const ok = await confirmApply();
  if (!ok) return;

  setBusy(true);
  $("#jobLog").textContent = "";
  $("#jobState").textContent = "Starting";
  $("#progressBar").style.width = "0";

  try {
    const data = await api("/api/apply", {
      method: "POST",
      body: collectSettings(),
    });
    state.currentJobId = data.job.id;
    pollJob();
  } catch (error) {
    $("#jobState").textContent = `Error: ${error.message}`;
    setBusy(false);
  }
}

async function startRetryFailed() {
  if (!state.selectedReportName) return;
  const settings = collectSettings();
  const failedCount = state.selectedReport && Array.isArray(state.selectedReport.pairs)
    ? state.selectedReport.pairs.filter((pair) => pair.status === "failed").length
    : 0;
  const ok = confirm(`Retry ${failedCount} failed pair(s) from ${state.selectedReportName}?`);
  if (!ok) return;

  setBusy(true);
  $("#jobLog").textContent = "";
  $("#jobState").textContent = "Starting retry";
  $("#progressBar").style.width = "0";

  try {
    const data = await api("/api/retry-failed", {
      method: "POST",
      body: {
        ...settings,
        reportName: state.selectedReportName,
      },
    });
    state.currentJobId = data.job.id;
    pollJob();
  } catch (error) {
    $("#jobState").textContent = `Retry error: ${error.message}`;
    setBusy(false);
  }
}

async function cancelJob() {
  if (!state.currentJobId) return;
  $("#cancelJobBtn").disabled = true;
  try {
    const data = await api(`/api/jobs/${encodeURIComponent(state.currentJobId)}/cancel`, {
      method: "POST",
    });
    renderJob(data.job);
  } catch (error) {
    $("#jobState").textContent = `Cancel error: ${error.message}`;
  }
}

async function pollJob() {
  if (!state.currentJobId) return;

  try {
    const data = await api(`/api/jobs/${encodeURIComponent(state.currentJobId)}`);
    renderJob(data.job);

    if (data.job.status === "queued" || data.job.status === "running") {
      state.polling = setTimeout(pollJob, 1200);
    } else {
      setBusy(false);
      if (data.job.result) {
        $("#lastReportName").textContent = data.job.result.reportName;
        renderSummary(data.job.result.summary);
        await refreshReports();
      }
    }
  } catch (error) {
    $("#jobState").textContent = `Polling error: ${error.message}`;
    setBusy(false);
  }
}

function renderJob(job) {
  $("#jobState").textContent = `${job.status} | ${job.id}`;
  $("#cancelJobBtn").disabled = !(job.status === "queued" || job.status === "running");
  $("#jobLog").textContent = job.logs.map((entry) => `[${new Date(entry.at).toLocaleTimeString()}] ${entry.message}`).join("\n");

  const logs = job.logs.map((entry) => entry.message);
  const totalMatch = logs.join("\n").match(/(\d+) directed pairs/);
  const total = totalMatch ? Number(totalMatch[1]) : 0;
  const done = logs.filter((message) => /OK via|FAILED|ALREADY BLOCKED/.test(message)).length;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  $("#progressBar").style.width = `${percent}%`;

  if (job.result) {
    $("#resultPreview").textContent = pretty(job.result);
  }
  if (job.error) {
    $("#resultPreview").textContent = `Error: ${job.error}`;
  }
}

async function refreshReports() {
  const data = await api("/api/reports");
  $("#reportsList").innerHTML = data.reports.map((report) => `
    <div class="report-row" data-report="${escapeHtml(report.name)}">
      <strong>${escapeHtml(report.name)}</strong>
      <span class="muted">${escapeHtml(report.command || "-")} | ${escapeHtml(report.generatedAt || report.modifiedAt)}</span>
      <span class="muted">${escapeHtml(JSON.stringify(report.summary || {}))}</span>
    </div>
  `).join("") || `<div class="muted">No reports yet.</div>`;

  $$(".report-row").forEach((row) => {
    row.addEventListener("click", () => loadReport(row.dataset.report));
  });
}

async function loadReport(name) {
  const report = await api(`/api/reports/${encodeURIComponent(name)}`);
  state.selectedReportName = name;
  state.selectedReport = report;
  $("#retryFailedBtn").disabled = false;
  $("#exportReportBtn").disabled = false;
  $("#reportDetail").textContent = pretty(report);
}

function exportSelectedReport() {
  if (!state.selectedReportName || !state.selectedReport) return;
  const blob = new Blob([`${pretty(state.selectedReport)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = state.selectedReportName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function fillSettings(settings) {
  $("#applyMode").value = settings.applyMode || "balanced";
  $("#accountConcurrency").value = settings.accountConcurrency || 8;
  $("#validateConcurrency").value = settings.validateConcurrency || 10;
  $("#accountLimit").value = settings.accountLimit || 0;
  $("#delayMin").value = settings.requestDelayMinMs;
  $("#delayMax").value = settings.requestDelayMaxMs;
  $("#max429Retries").value = settings.max429Retries;
  $("#perAccountDelayMin").value = settings.perAccountDelayMinMs || 500;
  $("#perAccountDelayMax").value = settings.perAccountDelayMaxMs || 900;
  $("#cooldownOn429").value = settings.cooldownOn429Ms || 12000;
  $("#allowUnverified").checked = Boolean(settings.allowUnverifiedBlockList);
  $("#skipBlockListCheck").checked = Boolean(settings.skipBlockListCheck);
}

function collectSettings() {
  return {
    applyMode: $("#applyMode").value,
    accountConcurrency: Number($("#accountConcurrency").value),
    validateConcurrency: Number($("#validateConcurrency").value),
    accountLimit: Number($("#accountLimit").value),
    requestDelayMinMs: Number($("#delayMin").value),
    requestDelayMaxMs: Number($("#delayMax").value),
    max429Retries: Number($("#max429Retries").value),
    perAccountDelayMinMs: Number($("#perAccountDelayMin").value),
    perAccountDelayMaxMs: Number($("#perAccountDelayMax").value),
    cooldownOn429Ms: Number($("#cooldownOn429").value),
    allowUnverifiedBlockList: $("#allowUnverified").checked,
    skipBlockListCheck: $("#skipBlockListCheck").checked,
  };
}

async function saveSettings() {
  const settings = await api("/api/settings", {
    method: "POST",
    body: collectSettings(),
  });
  state.settings = settings.settings;
  fillSettings(settings.settings);
  $("#serverStatus").textContent = `127.0.0.1:3456 | ${settings.settings.authMode}`;
}

function bindEvents() {
  $$(".nav").forEach((button) => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });

  $("#refreshAccountsBtn").addEventListener("click", refreshAccounts);
  $("#saveCookiesBtn").addEventListener("click", saveCookies);
  $("#clearCookiesBtn").addEventListener("click", clearCookies);
  $("#validateBtn").addEventListener("click", () => runImmediate("validate"));
  $("#planBtn").addEventListener("click", () => runImmediate("plan"));
  $("#applyBtn").addEventListener("click", startApply);
  $("#cancelJobBtn").addEventListener("click", cancelJob);
  $("#refreshReportsBtn").addEventListener("click", refreshReports);
  $("#retryFailedBtn").addEventListener("click", startRetryFailed);
  $("#exportReportBtn").addEventListener("click", exportSelectedReport);
  $("#saveSettingsBtn").addEventListener("click", saveSettings);
}

async function boot() {
  bindEvents();
  await refreshStatus();
  await refreshAccounts();
  await refreshReports();
}

boot().catch((error) => {
  $("#serverStatus").textContent = `Error: ${error.message}`;
});
