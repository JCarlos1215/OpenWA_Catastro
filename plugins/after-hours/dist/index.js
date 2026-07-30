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

// after-hours/index.ts
var index_exports = {};
__export(index_exports, {
  allowReply: () => allowReply,
  default: () => AfterHours,
  parseConfig: () => parseConfig
});
module.exports = __toCommonJS(index_exports);

// after-hours/schedule.ts
var DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
var WEEKDAY_TO_KEY = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun"
};
function parseHHMM(s) {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
function parseSchedule(json) {
  const parsed = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("schedule must be a JSON object mapping days to windows");
  }
  const schedule = {};
  for (const [key, value] of Object.entries(parsed)) {
    const day = key.toLowerCase();
    if (!DAYS.includes(day)) throw new Error(`schedule: unknown day "${key}"`);
    if (value === null) continue;
    if (typeof value !== "string") throw new Error(`schedule: ${day} must be "HH:MM-HH:MM" or null`);
    const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(value);
    const openMin = m ? parseHHMM(m[1]) : null;
    const closeMin = m ? parseHHMM(m[2]) : null;
    if (openMin === null || closeMin === null) {
      throw new Error(`schedule: ${day} window "${value}" is not "HH:MM-HH:MM"`);
    }
    if (openMin >= closeMin) throw new Error(`schedule: ${day} open must be before close ("${value}")`);
    schedule[day] = { openMin, closeMin };
  }
  if (Object.keys(schedule).length === 0) throw new Error("schedule has no open days");
  return schedule;
}
function assertValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`invalid timezone "${tz}"`);
  }
}
function isAfterHours(date, schedule, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const day = WEEKDAY_TO_KEY[get("weekday")];
  const minutes = Number(get("hour")) % 24 * 60 + Number(get("minute"));
  const window = day ? schedule[day] : void 0;
  if (!window) return true;
  return minutes < window.openMin || minutes >= window.closeMin;
}

// after-hours/index.ts
var MAX_COOLDOWN_ENTRIES = 5e3;
function parseConfig(raw) {
  const scheduleJson = String(raw.schedule ?? "").trim();
  if (!scheduleJson) throw new Error("after-hours: schedule is required (a JSON object)");
  let schedule;
  try {
    schedule = parseSchedule(scheduleJson);
  } catch (err) {
    throw new Error(`after-hours: invalid schedule \u2014 ${err instanceof Error ? err.message : String(err)}`);
  }
  const awayMessage = String(raw.awayMessage ?? "");
  if (!awayMessage) throw new Error("after-hours: awayMessage is required");
  const timezone = String(raw.timezone ?? "UTC") || "UTC";
  assertValidTimezone(timezone);
  const cooldown = Number(raw.cooldownSec ?? 3600);
  return {
    schedule,
    config: {
      timezone,
      awayMessage,
      cooldownSec: Number.isFinite(cooldown) ? cooldown : 3600,
      respondInGroups: raw.respondInGroups === true
    }
  };
}
function allowReply(map, key, nowMs, cooldownMs) {
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
var AfterHours = class {
  repliedAt = /* @__PURE__ */ new Map();
  async onEnable(ctx) {
    parseConfig(ctx.config);
    ctx.registerHook("message:received", async (hook) => {
      await this.onMessage(ctx, hook);
      return { continue: true };
    });
  }
  async onConfigChange(ctx, _newConfig) {
    parseConfig(ctx.config);
  }
  async onMessage(ctx, hook) {
    if (hook.source !== "Engine" || !hook.sessionId) return;
    const m = hook.data ?? {};
    if (m.fromMe || typeof m.body !== "string" || !m.chatId || !m.id) return;
    let cfg;
    try {
      cfg = parseConfig(ctx.config);
    } catch (e) {
      ctx.logger.warn(`after-hours: skipping message, config invalid: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (m.isGroup && !cfg.config.respondInGroups) return;
    if (!isAfterHours(/* @__PURE__ */ new Date(), cfg.schedule, cfg.config.timezone)) return;
    const sessionId = hook.sessionId;
    const key = `${sessionId}:${m.chatId}`;
    const cooldownMs = Math.max(0, cfg.config.cooldownSec) * 1e3;
    if (!allowReply(this.repliedAt, key, Date.now(), cooldownMs)) return;
    try {
      await ctx.messages.reply(sessionId, m.chatId, m.id, cfg.config.awayMessage);
    } catch (err) {
      ctx.logger.error("after-hours: reply failed", err);
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  allowReply,
  parseConfig
});
