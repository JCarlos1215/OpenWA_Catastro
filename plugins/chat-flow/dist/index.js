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

// chat-flow/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => ChatFlow,
  parseConfig: () => parseConfig,
  toFlowNodes: () => toFlowNodes
});
module.exports = __toCommonJS(index_exports);

// chat-flow/flow-engine.ts
var FlowEngine = class {
  static TIMEOUT_MS = 15 * 60 * 1e3;
  // 15 minutes state expiration
  static MAX_REPROCESS = 1;
  // bound the invalid-path reset (no unbounded recursion)
  /** Per (session,chat) promise chain serializing the state read→write. Self-evicts when drained. */
  static locks = /* @__PURE__ */ new Map();
  /**
   * Process an incoming message and send auto-replies according to `flow` (the resolved per-session
   * config). Returns true if a reply was sent, false otherwise. Serializes per (session, conversation)
   * so concurrent messages for the same conversation can't interleave the state read→write.
   *
   * `actor` scopes the flow state to a participant: in a group, pass the sender so each member walks
   * their own menu (a group chat is shared by many people); in a 1:1 chat leave it undefined so the
   * state key is just the chatId (unchanged). Replies always go to `chatId`.
   */
  static async processMessage(context, flow, sessionId, chatId, messageBody, messageId, actor) {
    const conversation = actor ? `${chatId}|${actor}` : chatId;
    const lockKey = `${sessionId}__${conversation}`;
    const prev = this.locks.get(lockKey) ?? Promise.resolve();
    const run = prev.then(
      () => this.processLocked(context, flow, sessionId, chatId, conversation, messageBody, messageId, 0)
    );
    const tail = run.catch(() => {
    });
    this.locks.set(lockKey, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(lockKey) === tail) this.locks.delete(lockKey);
    }
  }
  /** Delete persisted flow states whose last activity is older than the TTL. Lazy per-key expiry only
   *  runs when a conversation messages again, so an abandoned flow would otherwise linger forever; the
   *  plugin calls this periodically. Returns the number of entries removed. */
  static async sweepExpired(context) {
    const keys = (await context.storage.list("state__")).filter((k) => k.startsWith("state__"));
    const expired = (s) => !!s && Date.now() - s.lastActive > this.TIMEOUT_MS;
    let removed = 0;
    for (const k of keys) {
      if (!expired(await context.storage.get(k))) continue;
      if (expired(await context.storage.get(k))) {
        await context.storage.delete(k);
        removed++;
      }
    }
    return removed;
  }
  static async processLocked(context, flow, sessionId, chatId, conversation, messageBody, messageId, depth = 0) {
    context.logger.debug("[FlowEngine] Processing message", { sessionId, chatId, body: messageBody });
    const input = messageBody.trim();
    const stateKey = `state__${sessionId}__${conversation}`.replace(/:/g, "_");
    let state = await context.storage.get(stateKey);
    context.logger.debug("[FlowEngine] Loaded state", { stateKey, state });
    if (state && Date.now() - state.lastActive > this.TIMEOUT_MS) {
      context.logger.debug("[FlowEngine] Flow state expired", { stateKey });
      await context.storage.delete(stateKey);
      state = null;
    }
    const trigger = flow.trigger.trim();
    const isTriggerWord = trigger !== "" && input.toLowerCase() === trigger.toLowerCase();
    context.logger.debug("[FlowEngine] Trigger check", { trigger, input, isTriggerWord });
    if (!state) {
      if (trigger !== "" && !isTriggerWord) {
        context.logger.debug("[FlowEngine] No active state and input does not match trigger. Ignoring.");
        return false;
      }
      context.logger.debug("[FlowEngine] Starting new flow", { greeting: flow.greeting });
      await context.messages.reply(sessionId, chatId, messageId, flow.greeting);
      await context.storage.set(stateKey, { path: [], lastActive: Date.now() });
      return true;
    }
    if (isTriggerWord) {
      context.logger.debug("[FlowEngine] Trigger word received during active flow. Restarting flow.");
      await context.messages.reply(sessionId, chatId, messageId, flow.greeting);
      await context.storage.set(stateKey, { path: [], lastActive: Date.now() });
      return true;
    }
    let currentNode = { text: flow.greeting, options: flow.options };
    context.logger.debug("[FlowEngine] Traversing path", { path: state.path });
    for (const key of state.path) {
      if (currentNode && currentNode.options && Object.hasOwn(currentNode.options, key)) {
        currentNode = currentNode.options[key];
      } else {
        context.logger.debug("[FlowEngine] State path invalid (config mismatch). Resetting state.");
        await context.storage.delete(stateKey);
        if (depth >= this.MAX_REPROCESS) {
          context.logger.debug("[FlowEngine] Max reprocess depth reached; not recursing.", { depth });
          return false;
        }
        return this.processLocked(context, flow, sessionId, chatId, conversation, messageBody, messageId, depth + 1);
      }
    }
    context.logger.debug("[FlowEngine] Current node options", {
      options: currentNode.options ? Object.keys(currentNode.options) : null
    });
    const nextNode = currentNode.options && Object.hasOwn(currentNode.options, input) ? currentNode.options[input] : void 0;
    if (nextNode) {
      context.logger.debug("[FlowEngine] Input matched option", { input, text: nextNode.text });
      state.path.push(input);
      state.lastActive = Date.now();
      await context.messages.reply(sessionId, chatId, messageId, nextNode.text);
      if (nextNode.options && Object.keys(nextNode.options).length > 0) {
        context.logger.debug("[FlowEngine] Next node has sub-options. Saving updated path.");
        await context.storage.set(stateKey, state);
      } else {
        context.logger.debug("[FlowEngine] Leaf node reached. Clearing flow state.");
        await context.storage.delete(stateKey);
      }
      return true;
    } else if (!currentNode.options || Object.keys(currentNode.options).length === 0) {
      context.logger.debug("[FlowEngine] Resolved node is a dead leaf (config changed). Ending flow.");
      await context.storage.delete(stateKey);
      return false;
    } else {
      context.logger.debug("[FlowEngine] Input did not match any options. Replying with fallback.");
      const invalidMsg = `Invalid option. Please choose one of the available options:

${currentNode.text}`;
      await context.messages.reply(sessionId, chatId, messageId, invalidMsg);
      state.lastActive = Date.now();
      await context.storage.set(stateKey, state);
      return true;
    }
  }
};

// chat-flow/index.ts
function toFlowNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return void 0;
  const out = {};
  for (const raw of nodes) {
    if (!raw || typeof raw !== "object") throw new Error("chat-flow: each option must be an object");
    const n = raw;
    const key = String(n.key ?? "").trim();
    const text = String(n.text ?? "");
    if (!key) throw new Error('chat-flow: each option needs a non-empty "key"');
    if (key === "__proto__") throw new Error('chat-flow: option key "__proto__" is not allowed');
    if (!text) throw new Error(`chat-flow: option "${key}" needs "text"`);
    if (Object.hasOwn(out, key)) throw new Error(`chat-flow: duplicate option key "${key}"`);
    out[key] = { text, options: toFlowNodes(n.options) };
  }
  return out;
}
function parseConfig(raw) {
  const greeting = String(raw.greeting ?? "");
  if (!greeting) throw new Error("chat-flow: greeting is required");
  const options = toFlowNodes(raw.options);
  if (!options) throw new Error("chat-flow: at least one menu option is required");
  const trigger = String(raw.trigger ?? "").trim();
  return { flow: { trigger, greeting, options }, respondInGroups: raw.respondInGroups === true };
}
var SWEEP_INTERVAL_MS = 30 * 60 * 1e3;
var ChatFlow = class {
  sweepTimer = null;
  async onEnable(ctx) {
    parseConfig(ctx.config);
    ctx.registerHook(
      "message:received",
      (hook) => this.onMessage(ctx, hook)
    );
    void FlowEngine.sweepExpired(ctx).catch(() => {
    });
    this.stopSweep();
    this.sweepTimer = setInterval(() => void FlowEngine.sweepExpired(ctx).catch(() => {
    }), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }
  // The platform passes the new config as the 2nd arg, but for a sessionScoped plugin ctx.config is already
  // the resolved per-session slice — read that (re-parsing _newConfig would lose the per-session merge).
  async onConfigChange(ctx, _newConfig) {
    parseConfig(ctx.config);
  }
  async onDisable() {
    this.stopSweep();
  }
  async onUnload() {
    this.stopSweep();
  }
  stopSweep() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
  async onMessage(ctx, hook) {
    if (hook.source !== "Engine" || !hook.sessionId) return { continue: true };
    const m = hook.data;
    if (m.fromMe || typeof m.body !== "string" || !m.chatId || !m.id) return { continue: true };
    let liveCfg;
    try {
      liveCfg = parseConfig(ctx.config);
    } catch (e) {
      ctx.logger.warn(`chat-flow: skipping message, config invalid: ${e instanceof Error ? e.message : String(e)}`);
      return { continue: true };
    }
    if (m.isGroup && !liveCfg.respondInGroups) return { continue: true };
    try {
      const actor = m.isGroup ? m.author : void 0;
      const handled = await FlowEngine.processMessage(ctx, liveCfg.flow, hook.sessionId, m.chatId, m.body, m.id, actor);
      return { continue: !handled };
    } catch (err) {
      ctx.logger.error("chat-flow: flow processing failed", err);
      return { continue: true };
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  parseConfig,
  toFlowNodes
});
