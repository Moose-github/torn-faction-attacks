// ==UserScript==
// @name         Torn Retaliation Checker
// @namespace    torn-faction-attacks
// @version      0.1.0
// @description  Checks whether the current Torn attack target has an available faction retaliation.
// @author       Dara
// @include      https://www.torn.com/page.php?sid=attack*
// @run-at       document-idle
// @connect      torn-faction-attacks.moose-3065754.workers.dev
// @connect      *
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  "use strict";

  const DEFAULT_WORKER_URL = "https://torn-faction-attacks.moose-3065754.workers.dev";
  const STORAGE_PREFIX = "tornRetaliationChecker:";
  const WORKER_URL_KEY = `${STORAGE_PREFIX}workerUrl`;
  const SESSION_KEY = `${STORAGE_PREFIX}session`;
  const BADGE_ID = "torn-retaliation-checker";
  const CHECK_INTERVAL_MS = 20000;
  const PAGE_POLL_MS = 1000;

  let lastPageKey = "";
  let lastTargetId = null;
  let checkTimer = null;
  let authPromptSuppressedUntil = 0;

  registerMenuCommands();
  installStyles();
  startPageWatcher();

  function startPageWatcher() {
    void inspectPage();
    window.setInterval(() => {
      void inspectPage();
    }, PAGE_POLL_MS);
  }

  async function inspectPage() {
    if (!isAttackPage()) {
      lastPageKey = "";
      lastTargetId = null;
      clearCheckTimer();
      removeBadge();
      return;
    }

    const targetId = extractTargetId();
    const pageKey = `${location.href}:${targetId || "unknown"}`;
    if (pageKey === lastPageKey) {
      return;
    }

    lastPageKey = pageKey;
    lastTargetId = targetId;
    clearCheckTimer();

    if (!targetId) {
      setBadge("error", "Retal check", "Target ID not found");
      return;
    }

    await runCheck(targetId);
    checkTimer = window.setInterval(() => {
      if (lastTargetId) {
        void runCheck(lastTargetId);
      }
    }, CHECK_INTERVAL_MS);
  }

  async function runCheck(targetId) {
    if (!targetId) {
      setBadge("error", "Retal check", "Target ID not found");
      return;
    }

    setBadge("checking", "Retal check", `Checking ${targetId}`);

    try {
      const session = await ensureSession();
      const workerUrl = normalizedWorkerUrl(getWorkerUrl());
      const data = await fetchJson(`${workerUrl}/api/retaliations/check?target_id=${encodeURIComponent(String(targetId))}`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });

      renderResult(data);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      if (/auth|required|cancelled|unauthorized/i.test(message)) {
        setBadge("auth", "Retal auth needed", "Use userscript menu to sign in");
      } else {
        setBadge("error", "Retal check failed", message.slice(0, 140));
      }
    }
  }

  function renderResult(data) {
    const enemyAttack = data.enemy_attack || null;
    const ageText = enemyAttack ? `${formatAge(data.checked_at - (enemyAttack.attack_at || enemyAttack.ended || enemyAttack.started || data.checked_at))} ago` : "";
    const freshness = data.fresh ? "" : (data.sync && data.sync.warning ? data.sync.warning : "Stored data");

    if (data.available) {
      const defender = cleanName(enemyAttack && enemyAttack.defender_name) || "a faction member";
      setBadge("available", "Retal available", `Hit ${defender} ${ageText}`.trim(), freshness);
      return;
    }

    if (data.reason === "claimed") {
      setBadge("claimed", "Retal claimed", "Outgoing retal hosp found", freshness);
      return;
    }

    setBadge("unavailable", "No retal", enemyAttack ? `Expired ${ageText}` : "No recent qualifying attack", freshness);
  }

  async function ensureSession() {
    const stored = getJsonValue(SESSION_KEY);
    const now = Math.floor(Date.now() / 1000);
    if (stored && stored.token && stored.expires_at && stored.expires_at > now + 60) {
      return stored;
    }

    if (Date.now() < authPromptSuppressedUntil) {
      throw new Error("Auth required");
    }

    const key = window.prompt("Paste your Torn API key to sign in to the retaliation checker. The key is sent to your Worker once and is not stored.");
    if (!key || !key.trim()) {
      authPromptSuppressedUntil = Date.now() + 10 * 60 * 1000;
      throw new Error("Auth cancelled");
    }

    const workerUrl = normalizedWorkerUrl(getWorkerUrl());
    const session = await fetchJson(`${workerUrl}/api/auth/torn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key: key.trim() }),
    });

    if (!session || !session.token || !session.expires_at) {
      throw new Error("Worker did not return a usable session");
    }

    setJsonValue(SESSION_KEY, {
      token: session.token,
      expires_at: session.expires_at,
      access_level: session.access_level,
      user: session.user,
    });

    return session;
  }

  async function fetchJson(url, init) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);

    try {
      const response = await window.fetch(url, {
        ...init,
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `Request failed: ${response.status}`);
      }
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function isAttackPage() {
    try {
      return new URL(location.href).searchParams.get("sid") === "attack";
    } catch {
      return false;
    }
  }

  function extractTargetId() {
    const params = new URL(location.href).searchParams;
    const paramNames = ["user2ID", "user2Id", "userID", "userId", "playerID", "playerId", "target_id", "targetId", "ID"];
    for (const name of paramNames) {
      const id = positiveId(params.get(name));
      if (id) {
        return id;
      }
    }

    const selectors = [
      "a[href*='profiles.php?XID=']",
      "a[href*='loader.php?sid=attack']",
      "[data-user]",
      "[data-user-id]",
      "[data-player-id]",
    ];
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        const id = positiveId(node.getAttribute("data-user"))
          || positiveId(node.getAttribute("data-user-id"))
          || positiveId(node.getAttribute("data-player-id"))
          || extractIdFromText(node.getAttribute("href") || "");
        if (id) {
          return id;
        }
      }
    }

    return extractIdFromText(document.body ? document.body.innerHTML.slice(0, 200000) : "");
  }

  function extractIdFromText(text) {
    const patterns = [
      /[?&]user2ID=(\d+)/i,
      /[?&]user2Id=(\d+)/i,
      /[?&]XID=(\d+)/i,
      /\/profiles\.php\?XID=(\d+)/i,
      /"user(?:2)?ID"\s*:\s*"?(\d+)"?/i,
      /"target(?:_id|Id)"\s*:\s*"?(\d+)"?/i,
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      const id = positiveId(match && match[1]);
      if (id) {
        return id;
      }
    }

    return null;
  }

  function positiveId(value) {
    const parsed = Math.floor(Number(value));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function setBadge(status, title, detail, note) {
    const badge = ensureBadge();
    badge.className = `trc-badge trc-${status}`;
    badge.innerHTML = "";

    const titleEl = document.createElement("div");
    titleEl.className = "trc-title";
    titleEl.textContent = title;
    badge.appendChild(titleEl);

    if (detail) {
      const detailEl = document.createElement("div");
      detailEl.className = "trc-detail";
      detailEl.textContent = detail;
      badge.appendChild(detailEl);
    }

    if (note) {
      const noteEl = document.createElement("div");
      noteEl.className = "trc-note";
      noteEl.textContent = note;
      badge.appendChild(noteEl);
    }
  }

  function ensureBadge() {
    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
      badge = document.createElement("div");
      badge.id = BADGE_ID;
      badge.className = "trc-badge trc-checking";
      document.body.appendChild(badge);
    }
    return badge;
  }

  function removeBadge() {
    const badge = document.getElementById(BADGE_ID);
    if (badge) {
      badge.remove();
    }
  }

  function installStyles() {
    if (document.getElementById(`${BADGE_ID}-styles`)) {
      return;
    }

    const style = document.createElement("style");
    style.id = `${BADGE_ID}-styles`;
    style.textContent = `
      .trc-badge {
        position: fixed;
        top: 86px;
        right: 14px;
        z-index: 999999;
        width: min(260px, calc(100vw - 28px));
        box-sizing: border-box;
        padding: 9px 11px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-left-width: 5px;
        border-radius: 7px;
        background: rgba(18, 20, 24, 0.94);
        color: #f6f8fb;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12px;
        line-height: 1.25;
      }
      .trc-title {
        font-weight: 700;
        font-size: 13px;
      }
      .trc-detail {
        margin-top: 3px;
        color: rgba(246, 248, 251, 0.86);
        overflow-wrap: anywhere;
      }
      .trc-note {
        margin-top: 4px;
        color: rgba(246, 248, 251, 0.64);
        font-size: 11px;
      }
      .trc-available { border-left-color: #43d17c; }
      .trc-unavailable { border-left-color: #94a3b8; }
      .trc-claimed { border-left-color: #f5b84b; }
      .trc-checking { border-left-color: #4da3ff; }
      .trc-auth { border-left-color: #f5b84b; }
      .trc-error { border-left-color: #ff5f57; }
      @media (max-width: 700px) {
        .trc-badge {
          top: auto;
          right: 8px;
          bottom: 10px;
          width: min(240px, calc(100vw - 16px));
        }
      }
    `;
    document.head.appendChild(style);
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") {
      return;
    }

    GM_registerMenuCommand("Retal checker: sign in", () => {
      authPromptSuppressedUntil = 0;
      deleteValue(SESSION_KEY);
      void runCheck(lastTargetId || extractTargetId());
    });

    GM_registerMenuCommand("Retal checker: set Worker URL", () => {
      const current = getWorkerUrl();
      const next = window.prompt("Worker URL", current);
      if (next && next.trim()) {
        setValue(WORKER_URL_KEY, normalizedWorkerUrl(next.trim()));
        deleteValue(SESSION_KEY);
        void inspectPage();
      }
    });

    GM_registerMenuCommand("Retal checker: clear session", () => {
      deleteValue(SESSION_KEY);
      setBadge("auth", "Retal session cleared", "Sign in again to check retals");
    });

    GM_registerMenuCommand("Retal checker: recheck", () => {
      void runCheck(lastTargetId || extractTargetId());
    });
  }

  function clearCheckTimer() {
    if (checkTimer !== null) {
      window.clearInterval(checkTimer);
      checkTimer = null;
    }
  }

  function getWorkerUrl() {
    return getValue(WORKER_URL_KEY, DEFAULT_WORKER_URL) || DEFAULT_WORKER_URL;
  }

  function normalizedWorkerUrl(value) {
    return String(value || DEFAULT_WORKER_URL).trim().replace(/\/+$/, "");
  }

  function formatAge(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    if (value < 60) {
      return `${value}s`;
    }
    const minutes = Math.floor(value / 60);
    const remainder = value % 60;
    return `${minutes}m ${remainder}s`;
  }

  function cleanName(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function getJsonValue(key) {
    const raw = getValue(key, null);
    if (!raw) {
      return null;
    }
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      deleteValue(key);
      return null;
    }
  }

  function setJsonValue(key, value) {
    setValue(key, JSON.stringify(value));
  }

  function getValue(key, fallback) {
    if (typeof GM_getValue === "function") {
      return GM_getValue(key, fallback);
    }
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw;
  }

  function setValue(key, value) {
    if (typeof GM_setValue === "function") {
      GM_setValue(key, value);
      return;
    }
    window.localStorage.setItem(key, value);
  }

  function deleteValue(key) {
    if (typeof GM_deleteValue === "function") {
      GM_deleteValue(key);
      return;
    }
    window.localStorage.removeItem(key);
  }
})();
