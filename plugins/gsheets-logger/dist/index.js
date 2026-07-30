"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// gsheets-logger/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => GSheetsLogger,
  flushBuffer: () => flushBuffer,
  parseConfig: () => parseConfig
});
module.exports = __toCommonJS(index_exports);

// gsheets-logger/sheets-client.ts
var import_node_crypto = require("node:crypto");
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var SCOPE = "https://www.googleapis.com/auth/spreadsheets";
function b64url(input) {
  return Buffer.from(input).toString("base64url");
}
function buildJwt(sa, now) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const signingInput = `${header}.${claims}`;
  const signature = (0, import_node_crypto.createSign)("RSA-SHA256").update(signingInput).sign(sa.private_key, "base64url");
  return `${signingInput}.${signature}`;
}
var SheetsClient = class {
  // epoch seconds
  constructor(fetch, sa, spreadsheetId, sheetTab) {
    this.fetch = fetch;
    this.sa = sa;
    this.spreadsheetId = spreadsheetId;
    this.sheetTab = sheetTab;
  }
  token = null;
  tokenExp = 0;
  async getToken() {
    const now = Math.floor(Date.now() / 1e3);
    if (this.token && now < this.tokenExp - 60) return this.token;
    const assertion = buildJwt(this.sa, now);
    const res = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: String(new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }))
    });
    if (!res.ok) throw new Error(`Token request failed: ${res.status} ${res.body.slice(0, 300)}`);
    const json = JSON.parse(res.body || "{}");
    if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") {
      throw new Error("Token response missing access_token/expires_in");
    }
    this.token = json.access_token;
    this.tokenExp = now + json.expires_in;
    return this.token;
  }
  async appendRows(rows) {
    if (rows.length === 0) return;
    const token = await this.getToken();
    const range = encodeURIComponent(`${this.sheetTab}!A1`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const res = await this.fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ values: rows })
    });
    if (!res.ok) {
      if (res.status === 401) this.token = null;
      throw new Error(`Append failed: ${res.status} ${res.body.slice(0, 300)}`);
    }
  }
};

// gsheets-logger/row.ts
var MAX_CELL = 5e4;
var cap = (s) => s.length > MAX_CELL ? s.slice(0, MAX_CELL) : s;
function strId(value) {
  const s = value == null ? "" : String(value);
  return cap(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
}
function strText(value) {
  const s = value == null ? "" : String(value);
  return cap(/^[=@\t\r]/.test(s) || /^[+\-](?![\d.])/.test(s) ? `'${s}` : s);
}
function buildRow(ctx) {
  const event = ctx.event;
  const timestamp = new Date(ctx.timestamp ?? Date.now()).toISOString();
  const sessionId = strId(ctx.sessionId);
  const direction = event === "message:received" ? "in" : "out";
  if (event === "message:failed") {
    const p = ctx.data ?? {};
    return [
      timestamp,
      sessionId,
      event,
      direction,
      strId(p.input?.chatId),
      "",
      strId(p.input?.chatId),
      "",
      "",
      "text",
      strText(p.input?.text),
      "",
      "",
      strText(p.error)
    ];
  }
  if (event === "message:ack") {
    const p = ctx.data ?? {};
    return [timestamp, sessionId, event, direction, "", "", "", "", "", "", "", strId(p.messageId), strId(p.status), ""];
  }
  const m = ctx.data ?? {};
  const senderName = m.contact?.pushName || m.contact?.name || "";
  return [
    timestamp,
    sessionId,
    event,
    direction,
    strId(m.chatId),
    strId(m.from),
    strId(m.to),
    strText(senderName),
    strId(m.isGroup),
    strId(m.type),
    strText(m.body),
    strId(m.id),
    "",
    ""
  ];
}

// gsheets-logger/index.ts
var LOGGED_EVENTS = ["message:received", "message:sent", "message:failed", "message:ack"];
var BUFFER_KEY = "buffer";
var MAX_BUFFER = 5e3;
var PLUGIN_VERSION = true ? "0.3.0" : "0.0.0-dev";
function parseConfig(raw) {
  const serviceAccountJson = String(raw.serviceAccountJson ?? "");
  const spreadsheetId = String(raw.spreadsheetId ?? "");
  if (!spreadsheetId) throw new Error("gsheets-logger: spreadsheetId is required");
  let sa;
  try {
    sa = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("gsheets-logger: serviceAccountJson is not valid JSON");
  }
  if (!sa || !sa.client_email || !sa.private_key) {
    throw new Error("gsheets-logger: serviceAccountJson missing client_email/private_key");
  }
  const flushIntervalSec = Number(raw.flushIntervalSec ?? 5);
  const flushBatchSize = Number(raw.flushBatchSize ?? 20);
  return {
    config: {
      serviceAccountJson,
      spreadsheetId,
      sheetTab: String(raw.sheetTab ?? "Logs"),
      flushIntervalSec: Number.isFinite(flushIntervalSec) && flushIntervalSec > 0 ? Math.max(1, flushIntervalSec) : 5,
      flushBatchSize: Number.isFinite(flushBatchSize) && flushBatchSize >= 1 ? flushBatchSize : 20
    },
    sa
  };
}
async function flushBuffer(buffer, append) {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await append(batch);
  } catch (err) {
    buffer.unshift(...batch);
    throw err;
  }
}
var GSheetsLogger = class {
  buffer = [];
  client = null;
  timer = null;
  flushingPromise = null;
  ctx = null;
  batchSize = 20;
  async onEnable(ctx) {
    this.ctx = ctx;
    const { config, sa } = parseConfig(ctx.config);
    this.client = new SheetsClient(ctx.net.fetch.bind(ctx.net), sa, config.spreadsheetId, config.sheetTab);
    this.batchSize = config.flushBatchSize;
    const restored = await ctx.storage.get(BUFFER_KEY);
    if (Array.isArray(restored)) this.buffer = restored;
    for (const event of LOGGED_EVENTS) {
      ctx.registerHook(event, async (hook) => {
        this.enqueue(hook);
        return { continue: true };
      });
    }
    this.startTimer(config.flushIntervalSec);
    ctx.logger.log(`gsheets-logger v${PLUGIN_VERSION} enabled \u2192 sheet ${config.spreadsheetId} (tab "${config.sheetTab}")`);
  }
  async onConfigChange(ctx, _newConfig) {
    await this.flush();
    this.ctx = ctx;
    const { config, sa } = parseConfig(ctx.config);
    this.client = new SheetsClient(ctx.net.fetch.bind(ctx.net), sa, config.spreadsheetId, config.sheetTab);
    this.batchSize = config.flushBatchSize;
    this.startTimer(config.flushIntervalSec);
  }
  async onDisable() {
    this.stopTimer();
    await this.flush();
    await this.ctx?.storage.set(BUFFER_KEY, this.buffer);
  }
  async onUnload() {
    this.stopTimer();
  }
  async healthCheck() {
    return { healthy: this.client !== null, message: `v${PLUGIN_VERSION} \u2014 ${this.buffer.length} rows buffered` };
  }
  startTimer(intervalSec) {
    this.stopTimer();
    this.timer = setInterval(() => void this.flush(), intervalSec * 1e3);
    this.timer.unref?.();
  }
  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  enqueue(hook) {
    this.buffer.push(buildRow(hook));
    if (this.buffer.length > MAX_BUFFER) {
      const dropped = this.buffer.length - MAX_BUFFER;
      this.buffer.splice(0, dropped);
      this.ctx?.logger.warn(`gsheets-logger: buffer cap ${MAX_BUFFER} exceeded, dropped ${dropped} oldest rows`);
    }
    if (this.buffer.length >= this.batchSize) void this.flush();
  }
  // Returns the in-flight flush when one is running, so onDisable can `await this.flush()` and wait
  // for it before persisting. The guard must be a Promise, not a boolean: with a boolean, a disable
  // racing a failing in-flight flush would persist the post-splice (empty) buffer at the same moment
  // flushBuffer restores the rows in memory — losing them. Awaiting the real promise closes that race.
  flush() {
    if (this.flushingPromise) return this.flushingPromise;
    if (!this.client || this.buffer.length === 0) return Promise.resolve();
    const client = this.client;
    this.flushingPromise = (async () => {
      try {
        await flushBuffer(this.buffer, (rows) => client.appendRows(rows));
        await this.ctx?.storage.set(BUFFER_KEY, this.buffer);
      } catch (err) {
        this.ctx?.logger.error("gsheets-logger: flush failed, will retry next tick", err);
      } finally {
        this.flushingPromise = null;
      }
    })();
    return this.flushingPromise;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  flushBuffer,
  parseConfig
});
