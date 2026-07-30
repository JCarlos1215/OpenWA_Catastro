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

// http-action/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => HttpActionPlugin,
  handleMessage: () => handleMessage
});
module.exports = __toCommonJS(index_exports);

// http-action/config.ts
var MAX_ACTIONS = 25;
var DANGEROUS_HEADERS = /* @__PURE__ */ new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "expect",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-forwarded-server",
  "x-real-ip"
]);
var ACTION_ID_RE = /^[A-Za-z0-9_-]+$/;
function fail(field, why) {
  throw new Error(`http-action: invalid config \u2014 ${field}: ${why}`);
}
function isDangerousHeader(name) {
  return DANGEROUS_HEADERS.has(name.toLowerCase().trim());
}
function isAllowedMethod(m) {
  return m === "GET" || m === "POST";
}
function validatePath(path, field) {
  if (typeof path !== "string" || path.length === 0) fail(field, "path is required");
  if (!path.startsWith("/")) fail(field, "path must be relative and start with /");
  if (path.startsWith("//")) fail(field, "path must not be protocol-relative (//)");
  if (path.includes("#")) fail(field, "path must not contain a fragment (#)");
  if (/[\r\n\t\0]/.test(path)) fail(field, "path must not contain control/null characters");
  return path;
}
function validateStringMap(v, field, isHeaders) {
  const out = {};
  if (v === void 0 || v === null) return out;
  if (typeof v !== "object") fail(field, "must be an object");
  for (const [k, val] of Object.entries(v)) {
    const ks = String(k);
    const vs = String(val);
    if (/[\r\n]/.test(ks) || /[\r\n]/.test(vs)) fail(field, "entry contains CR/LF (header injection)");
    if (isHeaders && isDangerousHeader(ks)) fail(`${field}.${ks}`, "reserved/dangerous header is not allowed");
    out[ks] = vs;
  }
  return out;
}
function validateAction(a, idx) {
  const field = `actions[${idx}]`;
  if (typeof a !== "object" || a === null) fail(field, "action must be an object");
  const o = a;
  const id = String(o.id ?? "").trim();
  if (!id) fail(`${field}.id`, "id is required");
  if (!ACTION_ID_RE.test(id)) fail(`${field}.id`, "id may only contain A-Z a-z 0-9 _ -");
  const m = o.match;
  if (typeof m !== "object" || m === null) fail(`${field}.match`, "match is required");
  const mm = m;
  if (mm.type !== "exact" && mm.type !== "prefix") fail(`${field}.match.type`, "type must be 'exact' or 'prefix'");
  const matchValue = typeof mm.value === "string" ? mm.value : "";
  if (matchValue.length === 0) fail(`${field}.match.value`, "value is required and must be non-empty");
  const r = o.request;
  if (typeof r !== "object" || r === null) fail(`${field}.request`, "request is required");
  const rr = r;
  if (!isAllowedMethod(rr.method)) fail(`${field}.request.method`, "method must be 'GET' or 'POST'");
  const path = validatePath(rr.path, `${field}.request.path`);
  const headers = validateStringMap(rr.headers, `${field}.request.headers`, true);
  const query = validateStringMap(rr.query, `${field}.request.query`, false);
  if (rr.bodyTemplate !== void 0 && typeof rr.bodyTemplate !== "string") {
    fail(`${field}.request.bodyTemplate`, "must be a string (a JSON template)");
  }
  const bodyTemplate = typeof rr.bodyTemplate === "string" ? rr.bodyTemplate : void 0;
  const replyTemplate = typeof o.replyTemplate === "string" ? o.replyTemplate : "";
  if (replyTemplate.length === 0) fail(`${field}.replyTemplate`, "replyTemplate is required");
  return {
    id,
    match: { type: mm.type, value: matchValue, caseSensitive: mm.caseSensitive === true },
    request: {
      method: rr.method,
      path,
      query: Object.keys(query).length ? query : void 0,
      headers: Object.keys(headers).length ? headers : void 0,
      bodyTemplate
    },
    replyTemplate,
    notFoundTemplate: typeof o.notFoundTemplate === "string" && o.notFoundTemplate ? o.notFoundTemplate : void 0,
    errorTemplate: typeof o.errorTemplate === "string" && o.errorTemplate ? o.errorTemplate : void 0
  };
}
function readConfig(raw) {
  const baseUrlRaw = String(raw.baseUrl ?? "").trim();
  if (!baseUrlRaw) fail("baseUrl", "is required (allowConfigHosts key \u2014 no code default)");
  let origin;
  try {
    origin = new URL(baseUrlRaw);
  } catch {
    fail("baseUrl", "must be a valid URL");
  }
  if (origin.protocol !== "https:") fail("baseUrl", "must be https");
  if (origin.username || origin.password) fail("baseUrl", "must not contain embedded credentials");
  if (origin.hash) fail("baseUrl", "must not contain a fragment");
  if (origin.search) fail("baseUrl", "must not contain a query string (origin/path only)");
  const baseUrl = baseUrlRaw.replace(/\/+$/, "");
  const authType = raw.authType === "bearer" || raw.authType === "apikey" ? raw.authType : "none";
  const authToken = raw.authToken ? String(raw.authToken) : void 0;
  if (authType !== "none" && !authToken) fail("authToken", `is required when authType='${authType}'`);
  const apiKeyHeader = String(raw.apiKeyHeader ?? "X-API-Key").trim() || "X-API-Key";
  if (/[\r\n]/.test(apiKeyHeader)) fail("apiKeyHeader", "must not contain CR/LF");
  if (isDangerousHeader(apiKeyHeader)) fail("apiKeyHeader", "must not be a reserved/dangerous header (host/connection/x-forwarded-*/\u2026)");
  const timeoutNum = Number(raw.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutNum) && timeoutNum >= 500 ? timeoutNum : 3e3;
  const cooldownNum = Number(raw.cooldownSeconds);
  const cooldownSeconds = Number.isFinite(cooldownNum) && cooldownNum >= 0 ? cooldownNum : 3;
  let actionsRaw = raw.actions;
  if (typeof actionsRaw === "string") {
    const trimmed = actionsRaw.trim();
    if (!trimmed) fail("actions", "is required (a JSON array)");
    try {
      actionsRaw = JSON.parse(trimmed);
    } catch (e) {
      fail("actions", `JSON parse failed: ${e.message}`);
    }
  }
  if (!Array.isArray(actionsRaw)) fail("actions", "must be a JSON array");
  if (actionsRaw.length < 1) fail("actions", "must contain at least one action");
  if (actionsRaw.length > MAX_ACTIONS) fail("actions", `must contain at most ${MAX_ACTIONS} actions`);
  const actions = actionsRaw.map((a, i) => validateAction(a, i));
  return {
    baseUrl,
    authType,
    authToken,
    apiKeyHeader,
    respondInGroups: raw.respondInGroups === true,
    timeoutMs,
    cooldownSeconds,
    actions
  };
}

// http-action/matcher.ts
function parseArgs(s) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push(m[1] ?? m[2]);
  return out;
}
function matchAction(actions, body) {
  for (const action of actions) {
    const { type, value, caseSensitive } = action.match;
    const hay = caseSensitive ? body : body.toLowerCase();
    const needle = caseSensitive ? value : value.toLowerCase();
    if (type === "exact") {
      if (hay === needle) return { action, args: [] };
    } else if (hay.startsWith(needle)) {
      return { action, args: parseArgs(body.slice(value.length)) };
    }
  }
  return null;
}

// http-action/url-template.ts
var PROTOTYPE_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var MAX_DEPTH = 12;
var MAX_PLACEHOLDERS = 64;
var PLACEHOLDER_RE = /\{\{(.*?)\}\}/g;
var TemplateError = class extends Error {
  constructor(msg) {
    super(`http-action: template error \u2014 ${msg}`);
    this.name = "TemplateError";
  }
};
function toStr(v) {
  if (v === null || v === void 0) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}
function getPath(root, dotted) {
  const segs = dotted.split(".");
  if (segs.length > MAX_DEPTH) throw new TemplateError(`path too deep (>${MAX_DEPTH}): ${dotted}`);
  let cur = root;
  for (const seg of segs) {
    if (PROTOTYPE_KEYS.has(seg)) throw new TemplateError(`prototype key forbidden in path: ${dotted}`);
    if (cur === null || cur === void 0) return void 0;
    if (typeof cur !== "object") return void 0;
    cur = cur[seg];
  }
  return cur;
}
function renderText(template, ctx) {
  return render(template, ctx, toStr);
}
function renderPath(template, ctx) {
  return render(template, ctx, (v) => {
    const s = toStr(v);
    if (s.includes("..")) throw new TemplateError('path segment contains ".." (traversal blocked)');
    return encodeURIComponent(s);
  });
}
function renderHeader(template, ctx) {
  return render(template, ctx, (v) => {
    const s = toStr(v);
    if (/[\r\n\0]/.test(s)) throw new TemplateError("header value contains CR/LF/NUL");
    return s;
  });
}
function renderJson(template, ctx) {
  return render(template, ctx, (v) => JSON.stringify(toStr(v)).slice(1, -1));
}
function render(template, ctx, encode) {
  let count = 0;
  return template.replace(PLACEHOLDER_RE, (_m, innerRaw) => {
    if (++count > MAX_PLACEHOLDERS) throw new TemplateError(`too many placeholders (>${MAX_PLACEHOLDERS})`);
    const inner = String(innerRaw).trim();
    if (!inner) return "";
    return encode(getPath(ctx, inner));
  });
}

// http-action/client.ts
var MAX_RESPONSE_BYTES = 256 * 1024;
var HttpActionClient = class {
  constructor(fetch, cfg) {
    this.fetch = fetch;
    this.cfg = cfg;
  }
  async run(action, ctx) {
    const { url, init } = this.buildRequest(action, ctx);
    const res = await this.fetch(url, init);
    if (res.body.length > MAX_RESPONSE_BYTES) {
      throw new Error("http-action: upstream response too large (RESPONSE_TOO_LARGE)");
    }
    let data;
    try {
      data = res.body.length ? JSON.parse(res.body) : void 0;
    } catch {
      if (res.ok) throw new Error("http-action: upstream returned invalid JSON (UPSTREAM_INVALID_JSON)");
      data = void 0;
    }
    return { status: res.status, data };
  }
  buildRequest(action, ctx) {
    const path = renderPath(action.request.path, ctx);
    let url = this.cfg.baseUrl + path;
    if (action.request.query) {
      const qs = Object.entries(action.request.query).map(([k, v]) => [k, renderText(v, ctx)]).filter(([, val]) => val !== "").map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join("&");
      if (qs) url += `?${qs}`;
    }
    const headers = {};
    if (action.request.headers) {
      for (const [k, v] of Object.entries(action.request.headers)) headers[k] = renderHeader(v, ctx);
    }
    if (this.cfg.authType === "bearer") headers["Authorization"] = `Bearer ${this.cfg.authToken}`;
    else if (this.cfg.authType === "apikey") headers[this.cfg.apiKeyHeader] = this.cfg.authToken ?? "";
    const init = { method: action.request.method, headers, timeoutMs: this.cfg.timeoutMs };
    if (action.request.method === "POST") {
      headers["Content-Type"] = "application/json";
      if (action.request.bodyTemplate) {
        const rendered = renderJson(action.request.bodyTemplate, ctx);
        try {
          JSON.parse(rendered);
        } catch {
          throw new Error("http-action: rendered request body is not valid JSON");
        }
        init.body = rendered;
      }
    }
    return { url, init };
  }
};

// http-action/cooldown.ts
var MAX_COOLDOWN_ENTRIES = 5e3;
function allowCooldown(map, key, nowMs, cooldownMs) {
  const last = map.get(key);
  if (last !== void 0 && nowMs - last < cooldownMs) return false;
  map.delete(key);
  map.set(key, nowMs);
  if (map.size > MAX_COOLDOWN_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== void 0) map.delete(oldest);
  }
  return true;
}

// http-action/reliability.ts
var KEY_PREFIX = "dedup:";
var PRUNE_KEY = "dedup:__prune__";
var DEDUP_TTL_MS = 3 * 24 * 60 * 60 * 1e3;
var PRUNE_INTERVAL_MS = 60 * 60 * 1e3;
var dedupKey = (sessionId, msgId) => `${KEY_PREFIX}${sessionId}:${msgId}`;
async function hasSeen(storage, sessionId, msgId) {
  try {
    const v = await storage.get(dedupKey(sessionId, msgId));
    return v !== null && v !== void 0;
  } catch {
    return true;
  }
}
async function markSeen(storage, sessionId, msgId, now) {
  try {
    await storage.set(dedupKey(sessionId, msgId), { t: now });
  } catch {
  }
}
async function prune(storage, now, ttlMs, intervalMs) {
  let last;
  try {
    last = await storage.get(PRUNE_KEY);
  } catch {
    last = null;
  }
  if (last !== null && typeof last.t === "number" && now - last.t < intervalMs) {
    return { ran: false, pruned: 0 };
  }
  try {
    await storage.set(PRUNE_KEY, { t: now });
  } catch {
  }
  let keys;
  try {
    keys = (await storage.list(KEY_PREFIX)).filter((k) => k.startsWith(KEY_PREFIX) && k !== PRUNE_KEY);
  } catch {
    return { ran: true, pruned: 0 };
  }
  let pruned = 0;
  for (const k of keys) {
    let m;
    try {
      m = await storage.get(k);
    } catch {
      continue;
    }
    if (m !== null && typeof m.t === "number" && now - m.t > ttlMs) {
      try {
        await storage.delete(k);
        pruned++;
      } catch {
      }
    }
  }
  return { ran: true, pruned };
}

// http-action/index.ts
var PLUGIN = "http-action";
var REPLY_MAX = 4e3;
var DEFAULT_NOT_FOUND = "Not found.";
var DEFAULT_ERROR = "Service is temporarily unavailable. Please try again later.";
function sanitize(s) {
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}
function truncate(s) {
  if (s.length <= REPLY_MAX) return s;
  let cut = REPLY_MAX - 1;
  if (cut > 0) {
    const code = s.charCodeAt(cut - 1);
    if (code >= 55296 && code <= 56319) cut -= 1;
  }
  return `${s.slice(0, cut)}\u2026`;
}
function buildCtx(msg, sessionId, args, response) {
  return {
    args,
    message: { id: msg.id, body: msg.body },
    chat: { id: msg.chatId },
    sender: { id: msg.from, phone: msg.senderPhone ?? "", name: msg.contact?.pushName ?? msg.contact?.name ?? "" },
    session: { id: sessionId },
    response
  };
}
async function handleMessage(deps, sessionId, msg) {
  const hit = matchAction(deps.cfg.actions, msg.body);
  if (!hit) return;
  if (await hasSeen(deps.storage, sessionId, msg.id)) return;
  void prune(deps.storage, deps.now(), DEDUP_TTL_MS, PRUNE_INTERVAL_MS).catch(
    (e) => deps.logger.error(`${PLUGIN}: prune failed`, e)
  );
  const cooldownMs = Math.max(0, deps.cfg.cooldownSeconds) * 1e3;
  if (!allowCooldown(deps.cooldown, `${sessionId}:${msg.chatId}`, deps.now(), cooldownMs)) return;
  const { action, args } = hit;
  const client = new HttpActionClient(deps.fetch, deps.cfg);
  const ctxWith = (response) => buildCtx(msg, sessionId, args, response);
  let text;
  try {
    const out = await client.run(action, ctxWith());
    if (out.status === 404) {
      text = renderText(action.notFoundTemplate ?? DEFAULT_NOT_FOUND, ctxWith(out.data));
    } else if (out.status >= 200 && out.status < 300) {
      text = renderText(action.replyTemplate, ctxWith(out.data));
    } else {
      text = renderText(action.errorTemplate ?? DEFAULT_ERROR, ctxWith(out.data));
    }
  } catch (e) {
    text = renderText(action.errorTemplate ?? DEFAULT_ERROR, ctxWith());
    deps.logger.error(`${PLUGIN}: request failed`, e);
  }
  await deps.conversations.send({
    sessionId,
    chatId: msg.chatId,
    type: "text",
    text: truncate(sanitize(text)),
    replyTo: msg.id
  });
  await markSeen(deps.storage, sessionId, msg.id, deps.now());
}
var HttpActionPlugin = class {
  ctx = null;
  async onEnable(ctx) {
    this.ctx = ctx;
    const cfg = readConfig(ctx.config);
    const cooldown = /* @__PURE__ */ new Map();
    ctx.registerHook("message:received", async (h) => {
      const sessionId = h.sessionId;
      const msg = h.data;
      if (!sessionId || !msg) return { continue: true };
      if (msg.fromMe) return { continue: true };
      if (typeof msg.body !== "string" || msg.body.length === 0) return { continue: true };
      if (!msg.chatId || !msg.id) return { continue: true };
      let liveCfg;
      try {
        liveCfg = readConfig(ctx.config);
      } catch (e) {
        ctx.logger.warn(`${PLUGIN}: skipping message, config invalid: ${e.message}`);
        return { continue: true };
      }
      if (msg.isGroup && !liveCfg.respondInGroups) return { continue: true };
      void handleMessage(
        {
          cfg: liveCfg,
          fetch: ctx.net.fetch.bind(ctx.net),
          conversations: ctx.conversations,
          storage: ctx.storage,
          cooldown,
          now: () => Date.now(),
          logger: ctx.logger
        },
        sessionId,
        msg
      ).catch((e) => ctx.logger.error(`${PLUGIN}: handler failed`, e));
      return { continue: true };
    });
    ctx.logger.log(`${PLUGIN} enabled (${cfg.actions.length} action(s), ${cfg.baseUrl})`);
  }
  async healthCheck() {
    if (!this.ctx) return { healthy: false, message: `${PLUGIN}: not loaded` };
    try {
      const cfg = readConfig(this.ctx.config);
      return { healthy: true, message: `${PLUGIN}: ${cfg.actions.length} action(s), baseUrl ${cfg.baseUrl}` };
    } catch (e) {
      return { healthy: false, message: e.message };
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handleMessage
});
