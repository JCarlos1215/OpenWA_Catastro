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

// faq-bot/index.ts
var index_exports = {};
__export(index_exports, {
  allowFallback: () => allowFallback,
  default: () => FaqBot,
  parseConfig: () => parseConfig
});
module.exports = __toCommonJS(index_exports);

// faq-bot/rules.ts
var MODES = ["contains", "exact", "regex"];
var MAX_REGEX_INPUT = 1e3;
var MAX_PATTERN_LENGTH = 1e3;
function atomAt(p, i) {
  const c = p[i];
  if (c === "\\") return { key: p.slice(i, i + 2), len: 2 };
  if (c === "[") {
    let j = i + 1;
    if (p[j] === "^") j++;
    while (j < p.length && p[j] !== "]") {
      if (p[j] === "\\") j++;
      j++;
    }
    const end = j < p.length ? j + 1 : p.length;
    return { key: p.slice(i, end), len: end - i };
  }
  if (c === ".") return { key: "ANY", len: 1 };
  return { key: c, len: 1 };
}
function quantifierAt(p, i) {
  const none = { present: false, len: 0, min: 1, count: 1, unbounded: false, variable: false };
  const lazy = (len) => p[i + len] === "?" ? len + 1 : len;
  const c = p[i];
  if (c === "*") return { present: true, len: lazy(1), min: 0, count: Infinity, unbounded: true, variable: true };
  if (c === "+") return { present: true, len: lazy(1), min: 1, count: Infinity, unbounded: true, variable: true };
  if (c === "?") return { present: true, len: lazy(1), min: 0, count: 1, unbounded: false, variable: true };
  if (c === "{") {
    const close = p.indexOf("}", i);
    if (close === -1) return none;
    const m = /^(\d+)(,(\d*))?$/.exec(p.slice(i + 1, close));
    if (!m) return none;
    const min = Number(m[1]);
    const len = lazy(close - i + 1);
    if (m[2] === void 0) return { present: true, len, min, count: min, unbounded: false, variable: false };
    if ((m[3] ?? "") === "") return { present: true, len, min, count: Infinity, unbounded: true, variable: true };
    const max = Number(m[3]);
    return { present: true, len, min, count: max, unbounded: false, variable: max > min };
  }
  return none;
}
var overlaps = (a, b) => a === "ANY" || b === "ANY" || a === b;
var REPEAT_THRESHOLD = 10;
function isSafeRegexPattern(p) {
  if (p.length > MAX_PATTERN_LENGTH) return false;
  const stack = [];
  let prevUnbounded = null;
  let adjacentRun = 0;
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === "|") {
      prevUnbounded = null;
      adjacentRun = 0;
      i++;
      continue;
    }
    if (c === "(") {
      stack.push({ hasUnbounded: false, hasVariable: false });
      prevUnbounded = null;
      adjacentRun = 0;
      i++;
      if (p[i] === "?") {
        i++;
        if (p[i] === "<") i++;
        if (p[i] === ":" || p[i] === "=" || p[i] === "!") i++;
      }
      continue;
    }
    if (c === ")") {
      const frame = stack.pop() ?? { hasUnbounded: false, hasVariable: false };
      const q2 = quantifierAt(p, i + 1);
      if (q2.unbounded && frame.hasUnbounded) return false;
      if (q2.count >= REPEAT_THRESHOLD && frame.hasVariable) return false;
      if (stack.length) {
        if (q2.unbounded || frame.hasUnbounded) stack[stack.length - 1].hasUnbounded = true;
        if (q2.variable || frame.hasVariable) stack[stack.length - 1].hasVariable = true;
      }
      prevUnbounded = null;
      adjacentRun = 0;
      i += 1 + q2.len;
      continue;
    }
    const atom = atomAt(p, i);
    const q = quantifierAt(p, i + atom.len);
    if (stack.length && q.variable) stack[stack.length - 1].hasVariable = true;
    if (q.unbounded) {
      if (stack.length) stack[stack.length - 1].hasUnbounded = true;
      if (prevUnbounded !== null && overlaps(prevUnbounded, atom.key)) {
        if (++adjacentRun >= 3) return false;
      } else {
        adjacentRun = 1;
      }
      prevUnbounded = atom.key;
    } else if (!q.present || q.min >= 1) {
      prevUnbounded = null;
      adjacentRun = 0;
    }
    i += atom.len + q.len;
  }
  return true;
}
function parseRules(json) {
  let parsed = JSON.parse(json);
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    parsed = [parsed];
  }
  if (!Array.isArray(parsed)) throw new Error('rules must be a JSON array (e.g. [{"mode":"contains","pattern":"hi","reply":"hello"}])');
  const rules = [];
  const skipped = [];
  parsed.forEach((raw, i) => {
    const r = raw ?? {};
    const mode = r.mode;
    if (!MODES.includes(mode)) throw new Error(`rule ${i}: invalid mode (${String(r.mode)})`);
    if (typeof r.pattern !== "string" || r.pattern.length === 0) {
      throw new Error(`rule ${i}: pattern must be a non-empty string`);
    }
    if (typeof r.reply !== "string" || r.reply.length === 0) {
      throw new Error(`rule ${i}: reply must be a non-empty string`);
    }
    if (mode === "regex") {
      if (!isSafeRegexPattern(r.pattern)) {
        skipped.push(r.pattern);
        return;
      }
      try {
        rules.push({ mode: "regex", pattern: r.pattern, reply: r.reply, regex: new RegExp(r.pattern, "i") });
      } catch {
        skipped.push(r.pattern);
      }
    } else {
      rules.push({ mode, pattern: r.pattern, reply: r.reply });
    }
  });
  if (rules.length === 0) throw new Error("rules has no usable entries");
  return { rules, skipped };
}
function matchRule(rules, text) {
  const lower = text.toLowerCase();
  const trimmedLower = text.trim().toLowerCase();
  for (const rule of rules) {
    if (rule.mode === "contains" && lower.includes(rule.pattern.toLowerCase())) return rule;
    if (rule.mode === "exact" && trimmedLower === rule.pattern.toLowerCase()) return rule;
    if (rule.mode === "regex" && rule.regex && rule.regex.test(text.slice(0, MAX_REGEX_INPUT))) return rule;
  }
  return null;
}

// faq-bot/index.ts
var MAX_COOLDOWN_ENTRIES = 5e3;
function parseConfig(raw) {
  const rulesJson = String(raw.rules ?? "").trim();
  if (!rulesJson) throw new Error("faq-bot: rules is required (a JSON array)");
  let parsed;
  try {
    parsed = parseRules(rulesJson);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `faq-bot: invalid rules \u2014 ${detail}. Expected a JSON array like [{"mode":"contains","pattern":"openwa","reply":"yes?"}] \u2014 use double quotes, not single.`
    );
  }
  const cooldown = Number(raw.fallbackCooldownSec ?? 600);
  return {
    rules: parsed.rules,
    skipped: parsed.skipped,
    config: {
      fallbackReply: String(raw.fallbackReply ?? ""),
      fallbackCooldownSec: Number.isFinite(cooldown) ? cooldown : 600,
      respondInGroups: raw.respondInGroups === true
    }
  };
}
function allowFallback(map, key, nowMs, cooldownMs) {
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
var FaqBot = class {
  fallbackAt = /* @__PURE__ */ new Map();
  async onEnable(ctx) {
    this.warnSkipped(ctx);
    ctx.registerHook("message:received", async (hook) => {
      await this.onMessage(ctx, hook);
      return { continue: true };
    });
  }
  async onConfigChange(ctx) {
    this.warnSkipped(ctx);
  }
  warnSkipped(ctx) {
    const { skipped } = parseConfig(ctx.config);
    if (skipped.length) {
      ctx.logger.warn(`faq-bot: skipped ${skipped.length} rule(s) with an invalid regex: ${skipped.join(", ")}`);
    }
  }
  async onMessage(ctx, hook) {
    if (hook.source !== "Engine" || !hook.sessionId) return;
    const m = hook.data ?? {};
    if (m.fromMe || typeof m.body !== "string" || !m.chatId || !m.id) return;
    let cfg;
    try {
      cfg = parseConfig(ctx.config);
    } catch (e) {
      ctx.logger.warn(`faq-bot: skipping message, config invalid: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (m.isGroup && !cfg.config.respondInGroups) return;
    const sessionId = hook.sessionId;
    const rule = matchRule(cfg.rules, m.body);
    try {
      if (rule) {
        await ctx.messages.reply(sessionId, m.chatId, m.id, rule.reply);
        return;
      }
      if (cfg.config.fallbackReply) {
        const key = `${sessionId}:${m.chatId}`;
        const cooldownMs = Math.max(0, cfg.config.fallbackCooldownSec) * 1e3;
        if (allowFallback(this.fallbackAt, key, Date.now(), cooldownMs)) {
          await ctx.messages.reply(sessionId, m.chatId, m.id, cfg.config.fallbackReply);
        }
      }
    } catch (err) {
      ctx.logger.error("faq-bot: reply failed", err);
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  allowFallback,
  parseConfig
});
