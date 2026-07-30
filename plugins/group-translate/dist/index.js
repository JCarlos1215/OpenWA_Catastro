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

// group-translate/index.ts
var index_exports = {};
__export(index_exports, {
  TranslationPlugin: () => TranslationPlugin,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// group-translate/core/command.parser.ts
var COMMANDS = /* @__PURE__ */ new Set([
  "help",
  "status",
  "on",
  "off",
  "setlang",
  "auto",
  "ignore",
  "unignore",
  "grant",
  "revoke"
]);
var NEEDS_TARGET = /* @__PURE__ */ new Set(["setlang", "auto", "ignore", "unignore", "grant", "revoke"]);
function parseCommand(body, prefix) {
  const trimmed = body.trim();
  const lower = trimmed.toLowerCase();
  const matched = lower.startsWith("/translate") ? "/translate" : lower.startsWith(prefix.toLowerCase()) ? prefix : null;
  if (!matched) return null;
  const rest = trimmed.slice(matched.length).trim();
  if (!rest) return null;
  const tokens = rest.split(/\s+/);
  const verb = tokens[0].toLowerCase();
  if (!COMMANDS.has(verb)) return null;
  const name = verb;
  const args = tokens.slice(1);
  if (name === "setlang") {
    const lang = args[0]?.toLowerCase();
    if (!lang) return null;
    return { name, lang, target: parseTarget(args.slice(1)) };
  }
  if (NEEDS_TARGET.has(name)) {
    return { name, target: parseTarget(args) };
  }
  return { name };
}
function parseTarget(args) {
  const raw = args[0];
  if (!raw || raw.toLowerCase() === "me") return { kind: "me" };
  if (raw.startsWith("@")) return { kind: "mention" };
  return { kind: "number", number: raw.replace(/[^0-9]/g, "") };
}

// group-translate/core/reply.formatter.ts
var FLAGS = {
  en: "\u{1F1EC}\u{1F1E7}",
  es: "\u{1F1EA}\u{1F1F8}",
  fr: "\u{1F1EB}\u{1F1F7}",
  de: "\u{1F1E9}\u{1F1EA}",
  pt: "\u{1F1F5}\u{1F1F9}",
  it: "\u{1F1EE}\u{1F1F9}",
  nl: "\u{1F1F3}\u{1F1F1}",
  ru: "\u{1F1F7}\u{1F1FA}",
  ar: "\u{1F1F8}\u{1F1E6}",
  zh: "\u{1F1E8}\u{1F1F3}",
  ja: "\u{1F1EF}\u{1F1F5}"
};
function label(lang) {
  const flag = FLAGS[lang];
  return flag ? `${flag} ${lang.toUpperCase()}` : lang.toUpperCase();
}
function formatCombinedReply(translations) {
  return translations.map((t) => `${label(t.lang)}: ${t.text}`).join("\n");
}
function buildHelpText(prefix) {
  return [
    "\u{1F44B} Translation bot. I am OFF in this group until an admin runs `" + prefix + " on`.",
    "Commands:",
    `${prefix} on / ${prefix} off \u2014 enable/disable translation here`,
    `${prefix} setlang <code> [me|@user|number] \u2014 pin a language (default: you)`,
    `${prefix} auto [me|@user|number] \u2014 go back to auto-detect`,
    `${prefix} ignore <@user|number> / ${prefix} unignore <@user|number>`,
    `${prefix} grant <@user|number> / ${prefix} revoke <@user|number> \u2014 delegate control (admins)`,
    `${prefix} status \u2014 show settings`,
    `${prefix} help \u2014 this message`
  ].join("\n");
}
function formatStatus(state, translatorHealthy) {
  const lines = [];
  lines.push(`Translation: ${state.active ? "ACTIVE" : "inactive"}`);
  lines.push(`Translator: ${translatorHealthy ? "ok" : "unreachable"}`);
  const entries = Object.entries(state.participants);
  if (entries.length === 0) {
    lines.push("No participants learned yet.");
  } else {
    lines.push("Participants:");
    for (const [wid, p] of entries) {
      const lang = p.lang ?? "unknown";
      const flags = `${p.source}${p.enabled ? "" : ", ignored"}`;
      lines.push(`\u2022 ${wid}: ${lang} (${flags})`);
    }
  }
  if (state.delegatedControllers.length > 0) {
    lines.push(`Delegated controllers: ${state.delegatedControllers.join(", ")}`);
  }
  return lines.join("\n");
}

// group-translate/core/translation.coordinator.ts
var URL_OR_EMOJI_ONLY = new RegExp("^(?:\\s|\\p{Emoji}|https?:\\/\\/\\S+)+$", "u");
var UNSAFE_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var NOOP_LOGGER = { debug: () => {
}, info: () => {
}, warn: () => {
} };
function widEquals(a, b) {
  if (a === b) return true;
  const userPart = (w) => w.split("@")[0].split(":")[0];
  return userPart(a) === userPart(b);
}
var TranslationCoordinator = class {
  constructor(translator, store, gateway, opts, logger = NOOP_LOGGER) {
    this.translator = translator;
    this.store = store;
    this.gateway = gateway;
    this.opts = opts;
    this.logger = logger;
  }
  /** Per (session,chat) promise chain serializing the load→mutate→save cycle. Self-evicts when drained. */
  locks = /* @__PURE__ */ new Map();
  async handleMessage(sessionId, msg) {
    if (!msg.isGroup || msg.fromMe || !msg.author) return { swallow: false };
    const key = `${sessionId}:${msg.chatId}`;
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(() => this.handleMessageLocked(sessionId, msg));
    const tail = run.catch(() => {
    });
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
  async handleMessageLocked(sessionId, msg) {
    const state = await this.store.load(sessionId, msg.chatId);
    if (!state.announced) {
      await this.gateway.sendText(sessionId, msg.chatId, buildHelpText(this.opts.prefix));
      state.announced = true;
      await this.store.save(state);
    }
    const command = parseCommand(msg.body, this.opts.prefix);
    if (command) {
      await this.handleCommand(sessionId, msg, state, command);
      return { swallow: true };
    }
    if (!state.active) return { swallow: false };
    await this.translateMessage(sessionId, msg, state);
    return { swallow: false };
  }
  async translateMessage(sessionId, msg, state) {
    const text = msg.body.trim();
    if (text.length < this.opts.minLength || text.length > this.opts.maxLength || URL_OR_EMOJI_ONLY.test(text)) {
      return;
    }
    const senderKey = this.resolveSenderKey(state, msg);
    const sender = this.ensureParticipant(state, senderKey);
    if (msg.pushName && (sender.pushName === void 0 || sender.pushName === msg.pushName)) {
      sender.pushName = msg.pushName;
    }
    if (!sender.enabled) return;
    let detected;
    try {
      detected = (await this.translator.detect(text)).lang;
    } catch {
      return;
    }
    this.applyLearning(sender, detected);
    const knownLangs = this.knownLanguages(state);
    const source = knownLangs.includes(detected) ? detected : sender.lang ?? detected;
    let targets = this.targetLanguages(state, source, sender.lang);
    if (targets.length === 0) {
      const backstop = knownLangs.filter((l) => l !== source);
      if (backstop.length === 0) {
        this.logger.debug("no targets; group speaks only the source language", {
          action: "translation_no_targets",
          source
        });
        await this.store.save(state);
        return;
      }
      this.logger.warn("target backstop engaged (possible misroute or cross-language write)", {
        action: "translation_backstop",
        author: msg.author,
        pushName: msg.pushName,
        source,
        senderLang: sender.lang,
        targets: backstop
      });
      targets = backstop;
    }
    const settled = await Promise.allSettled(targets.map((t) => this.translator.translate(text, source, t)));
    const translations = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        translations.push({ lang: targets[i], text: r.value });
      } else {
        this.logger.warn("translate call failed", {
          action: "translation_translate_failed",
          source,
          target: targets[i],
          error: String(r.reason)
        });
      }
    });
    this.logger.debug("translate decision", {
      action: "translation_decision",
      author: msg.author,
      resolvedKey: senderKey,
      pushName: msg.pushName,
      detected,
      source,
      senderLang: sender.lang,
      knownLangs,
      targets,
      sent: translations.length
    });
    if (translations.length > 0) {
      await this.gateway.sendCombinedReply(sessionId, msg.chatId, msg.id, formatCombinedReply(translations));
    }
    await this.store.save(state);
  }
  /** Distinct languages currently spoken by enabled participants. */
  knownLanguages(state) {
    const langs = /* @__PURE__ */ new Set();
    for (const p of Object.values(state.participants)) {
      if (p.enabled && p.lang) langs.add(p.lang);
    }
    return [...langs];
  }
  /**
   * Distinct languages of enabled participants, excluding the message source language AND the
   * sender's own language — a sender never needs their own message translated back to themselves
   * (this also guards against a detection misfire leaving the source language in the target set).
   */
  targetLanguages(state, source, senderLang) {
    const langs = /* @__PURE__ */ new Set();
    for (const p of Object.values(state.participants)) {
      if (p.enabled && p.lang && p.lang !== source && p.lang !== senderLang) langs.add(p.lang);
    }
    return [...langs];
  }
  /** 2-message debounce: a learned language only switches after a new language is seen twice in a row. */
  applyLearning(p, detected) {
    p.samples++;
    if (p.source === "pinned") return;
    if (p.lang === detected) {
      p.pendingLang = void 0;
      return;
    }
    if (p.pendingLang === detected) {
      p.lang = detected;
      p.pendingLang = void 0;
    } else {
      p.pendingLang = detected;
      if (p.lang === null) p.lang = detected;
    }
    p.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  /**
   * Resolve which participant a message belongs to. whatsapp-web.js can misroute a group message's
   * `@lid` author after a reconnect; when the message's pushName uniquely identifies a DIFFERENT
   * known participant (and the author doesn't already own that pushName), trust the pushName.
   * Ambiguous (shared pushName) or no-match cases fall back to the raw author.
   */
  resolveSenderKey(state, msg) {
    const { author, pushName } = msg;
    if (!pushName) return author;
    if (state.participants[author]?.pushName === pushName) return author;
    const matches = Object.keys(state.participants).filter(
      (key) => key !== author && state.participants[key].pushName === pushName
    );
    if (matches.length === 1) {
      this.logger.info("sender reconciled by pushName", {
        action: "translation_sender_reconciled",
        author,
        resolvedKey: matches[0],
        pushName
      });
      return matches[0];
    }
    if (matches.length > 1) {
      this.logger.debug("ambiguous pushName; not reconciling", {
        action: "translation_pushname_ambiguous",
        author,
        pushName,
        matches
      });
    }
    return author;
  }
  ensureParticipant(state, wid) {
    if (UNSAFE_KEYS.has(wid)) {
      return { lang: null, source: "learned", enabled: true, samples: 0, updatedAt: "" };
    }
    if (!Object.prototype.hasOwnProperty.call(state.participants, wid)) {
      state.participants[wid] = { lang: null, source: "learned", enabled: true, samples: 0, updatedAt: "" };
    }
    return state.participants[wid];
  }
  async handleCommand(sessionId, msg, state, cmd) {
    if (cmd.name === "help") {
      await this.gateway.sendText(sessionId, msg.chatId, buildHelpText(this.opts.prefix));
      return;
    }
    if (cmd.name === "status") {
      await this.gateway.sendText(sessionId, msg.chatId, formatStatus(state, this.translator.isHealthy()));
      return;
    }
    const targetsSelf = cmd.target?.kind === "me";
    const isSelfServe = (cmd.name === "setlang" || cmd.name === "auto") && targetsSelf;
    if (!isSelfServe) {
      const admins = await this.gateway.getGroupAdmins(sessionId, msg.chatId);
      const isAdmin = admins.some((a) => widEquals(a, msg.author));
      const isController = isAdmin || state.delegatedControllers.some((c) => widEquals(c, msg.author));
      const adminOnly = cmd.name === "grant" || cmd.name === "revoke";
      if (adminOnly && !isAdmin || !adminOnly && !isController) {
        if (this.opts.denyReply) {
          await this.gateway.sendText(
            sessionId,
            msg.chatId,
            adminOnly ? "\u26D4 Only group admins can use that command." : "\u26D4 Only group admins or delegated users can use that command."
          );
        }
        return;
      }
    }
    const targetWid = this.resolveTarget(msg, cmd.target);
    switch (cmd.name) {
      case "on":
        state.active = true;
        await this.confirm(sessionId, msg, "\u2705 Translation activated.", state);
        return;
      case "off":
        state.active = false;
        await this.confirm(sessionId, msg, "\u2705 Translation deactivated.", state);
        return;
      case "setlang": {
        if (!targetWid || !cmd.lang)
          return this.replyError(sessionId, msg, "Usage: " + this.opts.prefix + " setlang <code> [me|@user|number]");
        const langs = await this.safeLanguages();
        if (langs && !langs.includes(cmd.lang)) {
          return this.replyError(sessionId, msg, `Unsupported language "${cmd.lang}". Supported: ${langs.join(", ")}`);
        }
        const p = this.ensureParticipant(state, targetWid);
        p.lang = cmd.lang;
        p.source = "pinned";
        p.pendingLang = void 0;
        p.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await this.confirm(sessionId, msg, `\u2705 Set ${targetWid} to ${cmd.lang}.`, state);
        return;
      }
      case "auto": {
        if (!targetWid) return this.replyError(sessionId, msg, this.targetHelp());
        const p = this.ensureParticipant(state, targetWid);
        p.source = "learned";
        p.pendingLang = void 0;
        await this.confirm(sessionId, msg, `\u2705 ${targetWid} set to auto-detect.`, state);
        return;
      }
      case "ignore":
      case "unignore": {
        if (!targetWid) return this.replyError(sessionId, msg, this.targetHelp());
        const p = this.ensureParticipant(state, targetWid);
        p.enabled = cmd.name === "unignore";
        await this.confirm(
          sessionId,
          msg,
          `\u2705 ${cmd.name === "ignore" ? "Ignoring" : "Including"} ${targetWid}.`,
          state
        );
        return;
      }
      case "grant":
      case "revoke": {
        if (!targetWid) return this.replyError(sessionId, msg, this.targetHelp());
        const set = new Set(state.delegatedControllers);
        if (cmd.name === "grant") set.add(targetWid);
        else set.delete(targetWid);
        state.delegatedControllers = [...set];
        await this.confirm(
          sessionId,
          msg,
          `\u2705 ${cmd.name === "grant" ? "Granted" : "Revoked"} control for ${targetWid}.`,
          state
        );
        return;
      }
    }
  }
  resolveTarget(msg, target) {
    if (!target || target.kind === "me") return msg.author;
    if (target.kind === "mention") return msg.mentionedIds[0] ?? null;
    return `${target.number}@c.us`;
  }
  async safeLanguages() {
    try {
      return await this.translator.languages();
    } catch {
      return null;
    }
  }
  async confirm(sessionId, msg, text, state) {
    await this.store.save(state);
    await this.gateway.sendText(sessionId, msg.chatId, text);
  }
  replyError(sessionId, msg, text) {
    return this.gateway.sendText(sessionId, msg.chatId, text);
  }
  targetHelp() {
    return "\u26A0\uFE0F Couldn't identify that user. Target them by @mention, by phone number, or use 'me' for yourself.";
  }
};

// group-translate/libretranslate.client.ts
var NOOP_LOGGER2 = { debug: () => {
}, info: () => {
}, warn: () => {
} };
var LibreTranslateClient = class {
  constructor(opts) {
    this.opts = opts;
    this.base = opts.url.replace(/\/+$/, "");
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 3e4;
    this.net = opts.net;
    this.logger = opts.logger ?? NOOP_LOGGER2;
  }
  base;
  failureThreshold;
  cooldownMs;
  net;
  logger;
  consecutiveFailures = 0;
  openUntil = 0;
  isHealthy() {
    return this.consecutiveFailures < this.failureThreshold;
  }
  async detect(text) {
    const data = await this.post("/detect", { q: text });
    const top = data[0];
    if (!top) throw new Error("LibreTranslate /detect returned no result");
    return { lang: top.language, confidence: top.confidence };
  }
  async translate(text, source, target) {
    const data = await this.post("/translate", { q: text, source, target, format: "text" });
    if (typeof data?.translatedText !== "string") {
      throw new Error("LibreTranslate /translate returned no translatedText");
    }
    return data.translatedText;
  }
  async languages() {
    const data = await this.post("/languages", {}, "GET");
    return data.map((l) => l.code);
  }
  async post(path, payload, method = "POST") {
    const now = Date.now();
    if (now < this.openUntil) {
      throw new Error("LibreTranslate circuit open");
    }
    const url = `${this.base}${path}`;
    try {
      const body = method === "POST" ? JSON.stringify({ ...payload, api_key: this.opts.apiKey }) : void 0;
      const res = await this.net.fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
        timeoutMs: this.opts.timeoutMs
      });
      if (!res.ok) {
        throw new Error(`LibreTranslate ${path} -> HTTP ${res.status}`);
      }
      const data = JSON.parse(res.body);
      this.consecutiveFailures = 0;
      return data;
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.openUntil = Date.now() + this.cooldownMs;
        this.logger.warn(`LibreTranslate circuit opened for ${this.cooldownMs}ms`, { action: "lt_circuit_open" });
      }
      throw err;
    }
  }
};

// group-translate/plugin-chat.gateway.ts
var PluginChatGateway = class {
  constructor(messages, engine) {
    this.messages = messages;
    this.engine = engine;
  }
  async sendText(sessionId, chatId, text) {
    await this.messages.sendText(sessionId, chatId, text);
  }
  async sendCombinedReply(sessionId, chatId, quotedMessageId, text) {
    await this.messages.reply(sessionId, chatId, quotedMessageId, text);
  }
  async getGroupAdmins(sessionId, chatId) {
    const info = await this.engine.getGroupInfo(sessionId, chatId);
    if (!info || !Array.isArray(info.participants)) return [];
    const admins = info.participants.filter((p) => p?.isAdmin || p?.isSuperAdmin).map((p) => p?.id).filter((id) => typeof id === "string" && id.length > 0);
    if (typeof info.owner === "string" && info.owner) admins.push(info.owner);
    return [...new Set(admins)];
  }
};

// group-translate/plugin-config.store.ts
var PluginConfigStore = class {
  constructor(storage) {
    this.storage = storage;
  }
  key(sessionId, chatId) {
    return `group:${sessionId}:${chatId}`;
  }
  async load(sessionId, chatId) {
    const stored = await this.storage.get(this.key(sessionId, chatId));
    return stored ?? {
      sessionId,
      chatId,
      active: false,
      participants: {},
      delegatedControllers: [],
      announced: false
    };
  }
  async save(state) {
    await this.storage.set(this.key(state.sessionId, state.chatId), state);
  }
};

// group-translate/index.ts
function readString(cfg, key, fallback) {
  const v = cfg[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}
function readOptionalString(cfg, key) {
  const v = cfg[key];
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function readNumber(cfg, key, fallback) {
  const v = cfg[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function readBool(cfg, key, fallback) {
  const v = cfg[key];
  return typeof v === "boolean" ? v : fallback;
}
var TranslationPlugin = class {
  coordinator = null;
  // Signature of the coordinator-affecting config last used to build `this.coordinator`. The hook
  // recomputes this per event and rebuilds the coordinator only when it changes — so a per-session
  // override (resolved by the host for the firing session) takes effect, WITHOUT resetting the
  // LibreTranslate client's circuit breaker on every message (a per-event rebuild would open/close the
  // backend anew on each call and defeat the breaker's purpose).
  coordinatorSignature = "";
  onEnable(context) {
    this.coordinator = this.buildCoordinator(context);
    this.coordinatorSignature = this.configSignature(context.config);
    context.registerHook(
      "message:received",
      (ctx) => this.onMessage(context, ctx)
    );
    context.logger.log("Translation plugin enabled", {
      action: "translation_enabled"
    });
    return Promise.resolve();
  }
  onConfigChange(context) {
    this.coordinator = this.buildCoordinator(context);
    this.coordinatorSignature = this.configSignature(context.config);
    context.logger.log("Translation plugin config updated", {
      action: "translation_config_changed"
    });
    return Promise.resolve();
  }
  /** Stable signature of only the config fields that affect the coordinator's behavior. Two configs
   *  with the same signature produce equivalent coordinators (same backend, same opts), so the circuit
   *  breaker state can be safely reused across them. */
  configSignature(cfg) {
    return JSON.stringify([
      readString(cfg, "libretranslateUrl", "http://localhost:7001"),
      readOptionalString(cfg, "libretranslateApiKey") ?? "",
      readNumber(cfg, "timeoutMs", 4e3),
      readString(cfg, "commandPrefix", "/tr"),
      readNumber(cfg, "minLength", 2),
      readNumber(cfg, "maxLength", 2e3),
      readBool(cfg, "denyReply", false)
    ]);
  }
  buildCoordinator(context) {
    const cfg = context.config;
    const logger = {
      debug: (m, meta) => context.logger.debug(m, meta),
      info: (m, meta) => context.logger.log(m, meta),
      warn: (m, meta) => context.logger.warn(m, meta)
    };
    const translator = new LibreTranslateClient({
      url: readString(cfg, "libretranslateUrl", "http://localhost:7001"),
      apiKey: readOptionalString(cfg, "libretranslateApiKey"),
      timeoutMs: readNumber(cfg, "timeoutMs", 4e3),
      net: context.net,
      logger
    });
    const store = new PluginConfigStore(context.storage);
    const gateway = new PluginChatGateway(context.messages, context.engine);
    const opts = {
      prefix: readString(cfg, "commandPrefix", "/tr"),
      minLength: readNumber(cfg, "minLength", 2),
      maxLength: readNumber(cfg, "maxLength", 2e3),
      denyReply: readBool(cfg, "denyReply", false)
    };
    return new TranslationCoordinator(translator, store, gateway, opts, logger);
  }
  onDisable(context) {
    this.coordinator = null;
    context.logger.log("Translation plugin disabled", {
      action: "translation_disabled"
    });
    return Promise.resolve();
  }
  async onMessage(context, ctx) {
    const msg = ctx.data;
    if (ctx.source !== "Engine" || !ctx.sessionId) {
      return { continue: true };
    }
    const sig = this.configSignature(context.config);
    if (sig !== this.coordinatorSignature || !this.coordinator) {
      this.coordinator = this.buildCoordinator(context);
      this.coordinatorSignature = sig;
    }
    if (!this.coordinator) return { continue: true };
    try {
      const inbound = {
        id: msg.id,
        chatId: msg.chatId,
        body: msg.body,
        author: msg.author ?? "",
        isGroup: msg.isGroup,
        fromMe: msg.fromMe,
        mentionedIds: msg.mentionedIds ?? [],
        pushName: msg.contact?.pushName
      };
      const { swallow } = await this.coordinator.handleMessage(
        ctx.sessionId,
        inbound
      );
      return { continue: !swallow };
    } catch (error) {
      context.logger.error("Translation hook failed", error, {
        sessionId: ctx.sessionId,
        action: "translation_hook_error"
      });
      return { continue: true };
    }
  }
};
var index_default = TranslationPlugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TranslationPlugin
});
