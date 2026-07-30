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

// chatwoot-adapter/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => ChatwootAdapter
});
module.exports = __toCommonJS(index_exports);

// chatwoot-adapter/multipart.ts
function buildMultipartBody(boundary, fields, files) {
  const parts = [];
  for (const f of fields) {
    parts.push(Buffer.from(`--${boundary}\r
Content-Disposition: form-data; name="${f.name}"\r
\r
${f.value}\r
`));
  }
  for (const file of files) {
    const filename = file.filename.replace(/[\r\n"]/g, "");
    const contentType = file.contentType.replace(/[\r\n]/g, "");
    parts.push(
      Buffer.from(
        `--${boundary}\r
Content-Disposition: form-data; name="${file.name}"; filename="${filename}"\r
Content-Type: ${contentType}\r
\r
`
      )
    );
    parts.push(Buffer.from(file.data));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r
`));
  return Buffer.concat(parts);
}

// chatwoot-adapter/chatwoot-client.ts
var ChatwootClient = class {
  constructor(fetch, cfg) {
    this.fetch = fetch;
    this.cfg = cfg;
  }
  base() {
    return `${this.cfg.baseUrl.replace(/\/$/, "")}/api/v1/accounts/${this.cfg.accountId}`;
  }
  headers(extra) {
    return { api_access_token: this.cfg.apiToken, ...extra };
  }
  async json(url, init) {
    const res = await this.fetch(url, { ...init, headers: this.headers({ "Content-Type": "application/json", ...init?.headers }) });
    if (!res.ok) {
      const e = new Error(`Chatwoot ${init?.method ?? "GET"} ${url} -> ${res.status}: ${res.body.slice(0, 300)}`);
      e.status = res.status;
      throw e;
    }
    return { status: res.status, data: JSON.parse(res.body || "{}") };
  }
  async searchContact(identifier) {
    const { data } = await this.json(`${this.base()}/contacts/search?q=${encodeURIComponent(identifier)}`);
    const hit = (data.payload ?? []).find((c) => c.identifier === identifier);
    if (!hit) return null;
    return { id: hit.id, sourceId: hit.contact_inboxes?.find((ci) => ci.inbox?.id === this.cfg.inboxId)?.source_id };
  }
  async createContact(identifier, name, phone) {
    try {
      const { data } = await this.json(`${this.base()}/contacts`, {
        method: "POST",
        body: JSON.stringify({ inbox_id: this.cfg.inboxId, identifier, name, ...phone ? { phone_number: phone } : {} })
      });
      const contact = data.payload?.contact;
      if (!contact) throw new Error("Chatwoot createContact: no contact in response");
      const src = contact.contact_inboxes?.find((ci) => ci.inbox?.id === this.cfg.inboxId)?.source_id;
      return { id: contact.id, sourceId: src ?? await this.ensureContactInbox(contact.id) };
    } catch (err) {
      if (err.status === 422) {
        const found = await this.searchContact(identifier);
        if (found) return { id: found.id, sourceId: found.sourceId ?? await this.ensureContactInbox(found.id) };
      }
      throw err;
    }
  }
  async ensureContactInbox(contactId) {
    const { data } = await this.json(
      `${this.base()}/contacts/${contactId}/contact_inboxes`,
      { method: "POST", body: JSON.stringify({ inbox_id: this.cfg.inboxId }) }
    );
    const src = data.source_id ?? data.payload?.source_id;
    if (!src) throw new Error("Chatwoot ensureContactInbox: no source_id");
    return src;
  }
  async updateContact(contactId, name) {
    await this.json(`${this.base()}/contacts/${contactId}`, { method: "PUT", body: JSON.stringify({ name }) });
  }
  async findOpenConversation(contactId) {
    const { data } = await this.json(
      `${this.base()}/contacts/${contactId}/conversations`
    );
    const c = (data.payload ?? []).find((x) => x.inbox_id === this.cfg.inboxId && (x.status === "open" || x.status === "pending"));
    return c ? c.id : null;
  }
  async createConversation(contactId, sourceId) {
    const { data } = await this.json(`${this.base()}/conversations`, {
      method: "POST",
      body: JSON.stringify({ source_id: sourceId, inbox_id: this.cfg.inboxId, contact_id: contactId, status: "open" })
    });
    return data.id;
  }
  async postText(conversationId, content, opts = {}) {
    const payload = { content, message_type: opts.messageType ?? "incoming", private: false };
    if (opts.sourceId) payload.source_id = opts.sourceId;
    if (opts.inReplyToExternalId) payload.content_attributes = { in_reply_to_external_id: opts.inReplyToExternalId };
    const { data } = await this.json(`${this.base()}/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return data;
  }
  async postMedia(conversationId, content, file, opts = {}) {
    const boundary = `----cw${conversationId}${file.data.byteLength}`;
    const fields = [
      { name: "content", value: content },
      { name: "message_type", value: opts.messageType ?? "incoming" }
    ];
    if (opts.sourceId) fields.push({ name: "source_id", value: opts.sourceId });
    if (opts.inReplyToExternalId)
      fields.push({ name: "content_attributes[in_reply_to_external_id]", value: opts.inReplyToExternalId });
    if (opts.isVoiceMessage) fields.push({ name: "is_voice_message", value: "true" });
    const body = buildMultipartBody(
      boundary,
      fields,
      [{ name: "attachments[]", filename: file.filename, contentType: file.contentType, data: file.data }]
    );
    const res = await this.fetch(`${this.base()}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: this.headers({ "Content-Type": `multipart/form-data; boundary=${boundary}` }),
      body
    });
    if (!res.ok) throw new Error(`Chatwoot postMedia -> ${res.status}`);
    return JSON.parse(res.body || "{}");
  }
  async toggleStatusOpen(conversationId) {
    await this.json(`${this.base()}/conversations/${conversationId}/toggle_status`, {
      method: "POST",
      body: JSON.stringify({ status: "open" })
    });
  }
};

// chatwoot-adapter/mapping-store.ts
var SEEN_TTL_MS = 3 * 24 * 60 * 60 * 1e3;
var SEEN_PRUNE_INTERVAL_MS = 60 * 60 * 1e3;
var MappingStore = class {
  constructor(storage, mappings) {
    this.storage = storage;
    this.mappings = mappings;
  }
  fwdKey(sessionId, chatId) {
    return `conv:${sessionId}:${chatId}`;
  }
  revKey(sessionId, conversationId) {
    return `wa:${sessionId}:${conversationId}`;
  }
  legacyRevKey(conversationId) {
    return `wa:${conversationId}`;
  }
  seenKey(kind, id, scope) {
    return scope ? `seen:${scope}:${kind}:${id}` : `seen:${kind}:${id}`;
  }
  getByChat(sessionId, chatId) {
    return this.storage.get(this.fwdKey(sessionId, chatId));
  }
  // Resolve the WA chat for a Chatwoot conversation. With a `sessionId` (a delivery that carries its
  // session scope), the tenant-scoped key wins — isolating two accounts that share a conversation id.
  // Without one, fall back to the unscoped key (single-tenant / pre-scope data), same as before.
  async getByConversation(conversationId, sessionId) {
    if (sessionId) {
      const scoped = await this.storage.get(this.revKey(sessionId, conversationId));
      if (scoped) return scoped;
    }
    return this.storage.get(this.legacyRevKey(conversationId));
  }
  async link(sessionId, chatId, instanceId, link) {
    await this.storage.set(this.fwdKey(sessionId, chatId), link);
    const rev = { sessionId, chatId };
    await this.storage.set(this.revKey(sessionId, link.conversationId), rev);
    await this.storage.set(this.legacyRevKey(link.conversationId), rev);
    await this.mappings.upsert({ sessionId, chatId, instanceId }, String(link.conversationId));
  }
  async patch(sessionId, chatId, patch) {
    const existing = await this.getByChat(sessionId, chatId);
    if (!existing) return;
    await this.storage.set(this.fwdKey(sessionId, chatId), { ...existing, ...patch });
  }
  // Idempotency markers, split so the caller controls WHEN the mark lands (outbound marks only AFTER a
  // successful send, so a transient failure retries instead of silently dropping the reply). `scope`
  // isolates a tenant's markers; both sides of a given `kind` must pass the same scope.
  async hasSeen(kind, id, scope) {
    return Boolean(await this.storage.get(this.seenKey(kind, id, scope)));
  }
  async markSeen(kind, id, scope, nowMs = Date.now()) {
    await this.storage.set(this.seenKey(kind, id, scope), { t: nowMs });
  }
  // Prune expired `seen:` markers so ctx.storage doesn't grow without bound (one file per marker) and the
  // retry drain's directory scan stays cheap. Streams keys one at a time (matching the drain's OOM-safe
  // discipline). A pre-0.5.2 marker stored as a bare `1` has no timestamp: it is ADOPTED (stamped with the
  // current time) rather than deleted, so it can never re-post a duplicate and ages out one TTL from here.
  // Touches only `seen:`-prefixed keys — the list() prefix is filtered defensively (a fake ignoring the
  // arg would otherwise return every key).
  async pruneSeen(nowMs, ttlMs) {
    const keys = (await this.storage.list("seen:")).filter((k) => k.startsWith("seen:"));
    let pruned = 0;
    let adopted = 0;
    for (const key of keys) {
      const v = await this.storage.get(key);
      if (v == null) continue;
      const t = typeof v === "object" && v !== null && typeof v.t === "number" ? v.t : void 0;
      if (t === void 0) {
        await this.storage.set(key, { t: nowMs });
        adopted++;
      } else if (nowMs - t > ttlMs) {
        await this.storage.delete(key);
        pruned++;
      }
    }
    return { pruned, adopted };
  }
  // Durable run-once marker for the one-time bulk history sweep, per WA session.
  async isBulkBackfilled(sessionId) {
    return Boolean(await this.storage.get(`backfill:all:${sessionId}`));
  }
  async setBulkBackfilled(sessionId) {
    await this.storage.set(`backfill:all:${sessionId}`, 1);
  }
  // ---- Inbound retry queue (durable, over ctx.storage) --------------------------------------------
  // Individual keys `retry:<sessionId>:<msgId>` — one per failed relay — so concurrent enqueues never
  // read-modify-write a shared array. The list is filtered by the `retry:` prefix defensively (the host
  // list(prefix) already narrows, but a fake that ignores the arg would otherwise leak other keys).
  retryKey(sessionId, msgId) {
    return `retry:${sessionId}:${msgId}`;
  }
  async retryKeys() {
    return (await this.storage.list("retry:")).filter((k) => k.startsWith("retry:"));
  }
  async readRetries(keys) {
    const out = [];
    for (const key of keys) {
      const e = await this.storage.get(key);
      if (e) out.push({ ...e, key });
    }
    return out;
  }
  // Enqueue a failed inbound relay. No-op if this message id is already queued (never resets its attempt
  // count). When the queue is at `maxPending`, drop the OLDEST entry (returns its msg id so the caller can
  // log the loss) to bound storage. `attempts` starts at 0.
  async enqueueRetry(entry, maxPending) {
    const key = this.retryKey(entry.sessionId, entry.msg.id);
    if (await this.storage.get(key)) return null;
    const keys = await this.retryKeys();
    let oldestKey = null;
    let dropped = null;
    if (keys.length >= maxPending) {
      const pending = await this.readRetries(keys);
      if (pending.length) {
        const oldest = pending.reduce((a, b) => a.enqueuedAt <= b.enqueuedAt ? a : b);
        oldestKey = oldest.key;
        dropped = oldest.msg.id;
      }
    }
    await this.storage.set(key, { ...entry, attempts: 0 });
    if (oldestKey) await this.storage.delete(oldestKey);
    return dropped;
  }
  async listRetries() {
    return this.readRetries(await this.retryKeys());
  }
  // Streaming primitives for the drain: list keys (a directory scan, no value loads), then fetch one
  // entry at a time — so a saturated queue of media messages is never all resident in memory at once.
  listRetryKeys() {
    return this.retryKeys();
  }
  async getRetry(key) {
    const e = await this.storage.get(key);
    return e ? { ...e, key } : null;
  }
  async bumpRetryAttempts(key, attempts) {
    const e = await this.storage.get(key);
    if (e) await this.storage.set(key, { ...e, attempts });
  }
  async deleteRetry(key) {
    await this.storage.delete(key);
  }
  // Count by key only — never load the (media-bearing) values, so a large backlog can't spike memory.
  async countRetries() {
    return (await this.retryKeys()).length;
  }
};

// chatwoot-adapter/chat-lock.ts
var KeyedAsyncLock = class {
  tails = /* @__PURE__ */ new Map();
  run(key, fn) {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => void 0).then(fn);
    this.tails.set(key, next);
    void next.catch(() => void 0).finally(() => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    });
    return next;
  }
};

// chatwoot-adapter/filters.ts
function shouldRelayInbound(msg, source, relayGroups) {
  return source === "Engine" && !msg.fromMe && !!msg.chatId && (!msg.isGroup || relayGroups);
}
function shouldRelayOwn(msg, source, relayGroups) {
  return source === "Engine" && msg.fromMe && !!msg.chatId && (!msg.isGroup || relayGroups);
}
function shouldRelayOutbound(evt, inboxId) {
  return evt.inbox?.id === inboxId && evt.message_type === "outgoing" && evt.private === false;
}

// chatwoot-adapter/relay.ts
function senderLabel(msg) {
  return msg.contact?.pushName || msg.senderPhone || msg.author || "unknown";
}
function prefixSender(msg) {
  if (!msg.isGroup) return msg.body;
  return `*${senderLabel(msg)}:* ${msg.body}`;
}
function locationText(msg) {
  const loc = msg.location;
  const link = loc.url || `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
  const label = [loc.description, loc.address].filter(Boolean).join(" \u2014 ");
  const body = label ? `\u{1F4CD} ${label}
${link}` : `\u{1F4CD} ${link}`;
  return msg.isGroup ? `*${senderLabel(msg)}:* ${body}` : body;
}
function placeholderFor(msg) {
  if (msg.type === "voice") return "\u{1F3A4} Voice message";
  if (msg.type === "sticker") return "\u{1F3A8} Sticker";
  if (msg.type === "location") return "\u{1F4CD} Location";
  if (msg.type === "image") return "\u{1F4F7} Photo";
  if (msg.type === "video") return "\u{1F3A5} Video";
  if (msg.type === "audio") return "\u{1F3B5} Audio";
  if (msg.type === "contact") return "\u{1F464} Contact";
  if (msg.type === "document") return `\u{1F4CE} ${msg.media?.filename ?? "Document"}`;
  if (msg.media) return `\u{1F4CE} ${msg.media.filename ?? "Attachment"}`;
  return msg.body;
}
async function relayMessage(deps, sessionId, conversationId, msg, messageType) {
  await deps.lock.run(`${sessionId}:conv:${conversationId}`, async () => {
    const content = prefixSender(msg);
    const post = { sourceId: msg.id, inReplyToExternalId: msg.quotedMessage?.id, messageType };
    const isVoice = msg.type === "voice";
    const isSticker = msg.type === "sticker";
    let created;
    if (msg.type === "location" && msg.location) {
      created = await deps.client.postText(conversationId, locationText(msg), post);
    } else if (deps.relayMedia && msg.media?.data && !msg.media.omitted) {
      created = await deps.client.postMedia(
        conversationId,
        content,
        {
          filename: isVoice ? "voice.ogg" : isSticker ? "sticker.webp" : msg.media.filename ?? "file",
          contentType: msg.media.mimetype || (isVoice ? "audio/ogg" : isSticker ? "image/webp" : "application/octet-stream"),
          data: Buffer.from(msg.media.data, "base64")
        },
        { ...post, isVoiceMessage: isVoice }
      );
    } else {
      created = await deps.client.postText(conversationId, msg.body?.trim() ? content : placeholderFor(msg), post);
    }
    if (messageType === "outgoing") await deps.store.markSeen("cw", String(created.id), sessionId);
  });
}
function resolvePhone(msg, canonicalChatId) {
  if (msg.isGroup) return void 0;
  const e164 = (raw) => {
    const digits = raw.replace(/\D/g, "");
    return digits ? `+${digits}` : void 0;
  };
  if (msg.senderPhone) {
    const phone = e164(msg.senderPhone);
    if (phone) return phone;
  }
  if (canonicalChatId.endsWith("@c.us")) return e164(canonicalChatId.slice(0, -"@c.us".length));
  return void 0;
}
async function ensureConversation(deps, sessionId, chatId, meta) {
  const existing = await deps.store.getByChat(sessionId, chatId);
  if (existing) return existing.conversationId;
  const found = await deps.client.searchContact(chatId);
  const contact = found?.sourceId ? { id: found.id, sourceId: found.sourceId } : await deps.client.createContact(chatId, meta.name, meta.phone);
  const conversationId = await deps.client.findOpenConversation(contact.id) ?? await deps.client.createConversation(contact.id, contact.sourceId);
  await deps.store.link(sessionId, chatId, deps.instanceId, {
    conversationId,
    contactId: contact.id,
    sourceId: contact.sourceId,
    name: meta.name
  });
  return conversationId;
}
async function refreshContactName(deps, sessionId, msg, link, chatKey) {
  if (msg.isGroup) return;
  const desired = msg.contact?.pushName || msg.contact?.name;
  if (!desired || desired === link.name) return;
  try {
    await deps.client.updateContact(link.contactId, desired);
    await deps.store.patch(sessionId, chatKey, { name: desired });
  } catch (err) {
    deps.log("contact name refresh failed", err);
  }
}

// chatwoot-adapter/backfill.ts
async function fetchHistory(deps, sessionId, chatId) {
  try {
    const history = await deps.engine.getChatHistory(sessionId, chatId, deps.backfillLimit, true);
    return [...history].sort((a, b) => a.timestamp - b.timestamp);
  } catch (err) {
    deps.log(`history fetch failed for ${chatId}`, err);
    return [];
  }
}
async function replayHistory(deps, sessionId, conversationId, ordered) {
  for (const msg of ordered) {
    if (await deps.store.hasSeen("wa", msg.id, sessionId)) continue;
    try {
      await relayMessage(deps, sessionId, conversationId, msg, msg.fromMe ? "outgoing" : "incoming");
      await deps.store.markSeen("wa", msg.id, sessionId);
    } catch (err) {
      deps.log(`history message ${msg.id} failed`, err);
    }
  }
}
async function backfillHistory(deps, sessionId, chatId, conversationId) {
  await replayHistory(deps, sessionId, conversationId, await fetchHistory(deps, sessionId, chatId));
}
var bulkInFlight = /* @__PURE__ */ new Set();
async function backfillAllChats(deps, sessionId) {
  if (bulkInFlight.has(sessionId)) return;
  bulkInFlight.add(sessionId);
  try {
    if (await deps.store.isBulkBackfilled(sessionId)) return;
    const chats = await deps.engine.getChats(sessionId);
    for (const chat of chats) {
      if (chat.isGroup && !deps.relayGroups) continue;
      await deps.lock.run(`${sessionId}:${chat.id}`, async () => {
        try {
          const ordered = await fetchHistory(deps, sessionId, chat.id);
          if (!ordered.length) return;
          const conversationId = await ensureConversation(deps, sessionId, chat.id, {
            name: chat.name || chat.id,
            phone: resolvePhone(chat, chat.id)
          });
          await replayHistory(deps, sessionId, conversationId, ordered);
        } catch (err) {
          deps.log(`bulk backfill failed for ${chat.id}`, err);
        }
      });
    }
    await deps.store.setBulkBackfilled(sessionId);
  } catch (err) {
    deps.log("bulk backfill sweep failed", err);
  } finally {
    bulkInFlight.delete(sessionId);
  }
}

// chatwoot-adapter/retry.ts
var RETRY_INTERVAL_MS = 3e4;
var MAX_RETRY_ATTEMPTS = 5;
var MAX_PENDING_RETRIES = 500;
var RETRY_MAX_MEDIA_B64 = 7e5;
function slimForRetry(msg) {
  const media = msg.media;
  if (media?.data && media.data.length > RETRY_MAX_MEDIA_B64) {
    return { ...msg, media: { ...media, data: void 0, omitted: true } };
  }
  return msg;
}
async function drainRetries(deps, relay2, maxAttempts) {
  const keys = await deps.store.listRetryKeys();
  let deadLettered = 0;
  for (const key of keys) {
    const e = await deps.store.getRetry(key);
    if (!e) continue;
    await deps.lock.run(`${e.sessionId}:${e.chatId}`, async () => {
      let relayed = false;
      try {
        await relay2(e.sessionId, e.chatId, e.msg);
        relayed = true;
      } catch (err) {
        const attempts = e.attempts + 1;
        if (attempts >= maxAttempts) {
          deps.log(`inbound relay dead-lettered after ${attempts} attempts (chat ${e.chatId}, msg ${e.msg.id})`, err);
          await deps.store.deleteRetry(e.key);
          deadLettered++;
        } else {
          await deps.store.bumpRetryAttempts(e.key, attempts);
        }
      }
      if (relayed) {
        await deps.store.deleteRetry(e.key).catch((err) => deps.log("deleteRetry after a successful relay failed", err));
      }
    });
  }
  return { deadLettered };
}

// chatwoot-adapter/inbound.ts
async function relayInbound(deps, sessionId, msg) {
  let canonical = msg.chatId;
  try {
    canonical = await deps.engine.canonicalChatId(sessionId, msg.chatId);
  } catch {
  }
  const { conversationId, created } = await resolveConversation(deps, sessionId, msg, canonical);
  if (created && deps.backfillLimit > 0) {
    await backfillHistory(deps, sessionId, msg.chatId, conversationId);
  }
  await relayMessage(deps, sessionId, conversationId, msg, "incoming");
}
async function handleInbound(deps, sessionId, source, msg) {
  if (!shouldRelayInbound(msg, source, deps.relayGroups)) return;
  await deps.lock.run(`${sessionId}:${msg.chatId}`, async () => {
    if (await deps.store.hasSeen("wa", msg.id, sessionId)) return;
    await deps.store.markSeen("wa", msg.id, sessionId);
    try {
      await relayInbound(deps, sessionId, msg);
    } catch (err) {
      deps.log("inbound relay failed; queued for retry", err);
      const dropped = await deps.store.enqueueRetry({ sessionId, chatId: msg.chatId, msg: slimForRetry(msg), enqueuedAt: Date.now() }, MAX_PENDING_RETRIES).catch((e) => {
        deps.log("enqueue retry failed", e);
        return null;
      });
      if (dropped) deps.log(`retry queue full; dropped oldest pending inbound (msg ${dropped})`);
    }
  });
}
async function resolveConversation(deps, sessionId, msg, canonicalChatId) {
  let existing = await deps.store.getByChat(sessionId, msg.chatId);
  let foundKey = msg.chatId;
  if (!existing && canonicalChatId !== msg.chatId) {
    existing = await deps.store.getByChat(sessionId, canonicalChatId);
    foundKey = canonicalChatId;
  }
  if (existing) {
    await refreshContactName(deps, sessionId, msg, existing, foundKey);
    return { conversationId: existing.conversationId, created: false };
  }
  const name = msg.isGroup ? `Group ${msg.chatId}` : msg.contact?.pushName || msg.contact?.name || msg.senderPhone || msg.chatId;
  const conversationId = await ensureConversation(deps, sessionId, msg.chatId, {
    name,
    // Phone from the host-resolved sender (RESOLVE_LID_TO_PHONE), or the canonical chat id (warm lid→pn
    // cache / every plain @c.us chat); undefined when genuinely unknown so the contact still creates.
    phone: resolvePhone(msg, canonicalChatId)
  });
  return { conversationId, created: true };
}

// chatwoot-adapter/sent.ts
async function handleSent(deps, sessionId, source, msg) {
  if (!shouldRelayOwn(msg, source, deps.relayGroups)) return;
  const key = await deps.engine.canonicalChatId(sessionId, msg.chatId);
  await deps.lock.run(`${sessionId}:${key}`, async () => {
    try {
      const identifiable = Boolean(msg.id);
      if (identifiable && await deps.store.hasSeen("wa", msg.id, sessionId)) return;
      const conversationId = await findMappedConversation(deps, sessionId, msg, key);
      if (conversationId === null) return;
      if (identifiable) await deps.store.markSeen("wa", msg.id, sessionId);
      else deps.log("own send has no engine message id; relaying it without de-duplication");
      await relayMessage(deps, sessionId, conversationId, msg, "outgoing");
    } catch (err) {
      deps.log("own-send relay failed", err);
    }
  });
}
async function findMappedConversation(deps, sessionId, msg, canonicalChatId) {
  const existing = await deps.store.getByChat(sessionId, msg.chatId) ?? (canonicalChatId !== msg.chatId ? await deps.store.getByChat(sessionId, canonicalChatId) : null);
  return existing ? existing.conversationId : null;
}

// chatwoot-adapter/outbound.ts
async function handleOutbound(deps, req) {
  let evt;
  try {
    evt = JSON.parse(req.rawBody);
  } catch {
    return { status: 400 };
  }
  const sessionId = req.sessionId;
  try {
    if (evt.event === "conversation_updated") {
      await applyHandover(deps, sessionId, evt);
      return { status: 200 };
    }
    if (shouldRelayOutbound(evt, deps.inboxId)) await relay(deps, sessionId, evt);
  } catch (err) {
    deps.log("outbound failed", err);
    throw err;
  }
  return { status: 200 };
}
async function relay(deps, sessionId, evt) {
  const conversationId = evt.conversation?.id;
  const text = evt.content;
  const media = firstMediaAttachment(evt);
  if (!conversationId || !text && !media) return;
  const target = await deps.store.getByConversation(conversationId, sessionId);
  if (!target) {
    deps.log(`no WA mapping for conversation ${conversationId}`);
    return;
  }
  const lockKey = await deps.engine.canonicalChatId(target.sessionId, target.chatId);
  await deps.lock.run(`${target.sessionId}:${lockKey}`, async () => {
    await deps.lock.run(`${target.sessionId}:conv:${conversationId}`, async () => {
      const id = evt.id !== void 0 ? String(evt.id) : void 0;
      if (id && await deps.store.hasSeen("cw", id, target.sessionId)) return;
      let res;
      if (media) {
        res = await deps.conversations.send({
          sessionId: target.sessionId,
          chatId: target.chatId,
          type: media.type,
          mediaUrl: media.url,
          text: text || void 0
        });
      } else {
        res = await deps.conversations.send({ sessionId: target.sessionId, chatId: target.chatId, type: "text", text });
      }
      if (id) await deps.store.markSeen("cw", id, target.sessionId);
      const sentId = res?.messageId;
      if (sentId) {
        await deps.store.markSeen("wa", sentId, target.sessionId);
      } else {
        deps.log("conversation.send returned no message id; own-send echo guard skipped for this reply");
      }
    });
  });
}
function firstMediaAttachment(evt) {
  for (const a of evt.attachments ?? []) {
    if (!a?.data_url) continue;
    const type = a.file_type === "image" ? "image" : a.file_type === "video" ? "video" : a.file_type === "audio" ? "voice" : "file";
    return { type, url: a.data_url };
  }
  return void 0;
}
function assigneeChange(evt) {
  const attr = (evt.changed_attributes ?? []).find((a) => a != null && typeof a === "object" && "assignee_id" in a)?.["assignee_id"];
  const assignee = evt.conversation?.meta?.assignee?.id ?? attr?.current_value ?? void 0;
  return { changed: attr !== void 0, assignee };
}
async function applyHandover(deps, sessionId, evt) {
  const conversationId = evt.conversation?.id;
  if (conversationId === void 0) return;
  const target = await deps.store.getByConversation(conversationId, sessionId);
  if (!target) return;
  const status = evt.conversation?.status;
  const { changed, assignee } = assigneeChange(evt);
  let state = null;
  if (status === "resolved") state = "closed";
  else if (changed) state = assignee ? "human" : "bot";
  if (!state) return;
  const resolved = state;
  await deps.lock.run(
    `${target.sessionId}:${target.chatId}`,
    () => deps.handover.set({ sessionId: target.sessionId, chatId: target.chatId, instanceId: target.sessionId }, resolved)
  );
}

// chatwoot-adapter/index.ts
function readConfig(raw) {
  const baseUrl = String(raw.baseUrl ?? "");
  const apiToken = String(raw.apiToken ?? "");
  const accountId = Number(raw.accountId);
  const inboxId = Number(raw.inboxId);
  const missing = [
    !baseUrl && "baseUrl",
    !apiToken && "apiToken",
    !Number.isFinite(accountId) && "accountId",
    !Number.isFinite(inboxId) && "inboxId"
  ].filter(Boolean);
  if (missing.length) throw new Error(`chatwoot-adapter: missing/invalid config: ${missing.join(", ")}`);
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("chatwoot-adapter: baseUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("chatwoot-adapter: baseUrl must be an https URL without embedded credentials");
  }
  const rawLimit = Number(raw.backfillLimit);
  return {
    baseUrl,
    apiToken,
    accountId,
    inboxId,
    relayGroups: raw.relayGroups !== false,
    relayMedia: raw.relayMedia !== false,
    relayOwnMessages: raw.relayOwnMessages !== false,
    backfillLimit: Number.isFinite(rawLimit) ? Math.max(0, Math.trunc(rawLimit)) : 0,
    backfillAllOnce: raw.backfillAllOnce === true || raw.backfillAllOnce === "true"
  };
}
var ChatwootAdapter = class {
  retryTimer = null;
  store = null;
  deadLetterCount = 0;
  draining = false;
  lastSeenPruneAt = 0;
  seenPruning = false;
  async onEnable(ctx) {
    this.clearRetryTimer();
    readConfig(ctx.config);
    const lock = new KeyedAsyncLock();
    const store = new MappingStore(ctx.storage, ctx.mappings);
    this.store = store;
    const clientFor = () => new ChatwootClient(ctx.net.fetch.bind(ctx.net), readConfig(ctx.config));
    const buildDeps = (cfg, sessionId) => ({
      lock,
      client: clientFor(),
      store,
      engine: ctx.engine,
      instanceId: sessionId,
      relayGroups: cfg.relayGroups,
      relayMedia: cfg.relayMedia,
      backfillLimit: cfg.backfillLimit,
      backfillAllOnce: cfg.backfillAllOnce,
      log: (m, e) => ctx.logger.error(m, e)
    });
    ctx.registerHook("message:received", async (h) => {
      const sessionId = h.sessionId;
      const msg = h.data;
      if (sessionId && msg) {
        const cfg = readConfig(ctx.config);
        const deps = buildDeps(cfg, sessionId);
        void handleInbound(deps, sessionId, h.source, msg).catch((e) => ctx.logger.error("inbound hook failed", e));
        if (cfg.backfillAllOnce && cfg.backfillLimit > 0) {
          void backfillAllChats(deps, sessionId).catch((e) => ctx.logger.error("bulk backfill failed", e));
        }
      }
      return { continue: true };
    });
    ctx.registerHook("message:sent", async (h) => {
      const sessionId = h.sessionId;
      const msg = h.data;
      if (sessionId && msg) {
        const cfg = readConfig(ctx.config);
        if (cfg.relayOwnMessages) {
          void handleSent(buildDeps(cfg, sessionId), sessionId, h.source, msg).catch(
            (e) => ctx.logger.error("sent hook failed", e)
          );
        }
      }
      return { continue: true };
    });
    ctx.registerWebhook(
      "chatwoot",
      async (req) => handleOutbound(
        {
          lock,
          conversations: ctx.conversations,
          handover: ctx.handover,
          engine: ctx.engine,
          store,
          inboxId: readConfig(ctx.config).inboxId,
          log: (m, e) => ctx.logger.error(m, e)
        },
        req
      )
    );
    const drain = () => {
      if (this.draining) return Promise.resolve();
      try {
        readConfig(ctx.config);
      } catch {
        return Promise.resolve();
      }
      this.draining = true;
      return drainRetries(
        { store, lock, log: (m, e) => ctx.logger.error(m, e) },
        (sessionId, _chatId, msg) => relayInbound(buildDeps(readConfig(ctx.config), sessionId), sessionId, msg),
        MAX_RETRY_ATTEMPTS
      ).then(
        ({ deadLettered }) => void (this.deadLetterCount += deadLettered),
        (e) => ctx.logger.error("retry drain failed", e)
      ).finally(() => void (this.draining = false));
    };
    const maybePruneSeen = () => {
      if (this.seenPruning) return;
      const now = Date.now();
      if (now - this.lastSeenPruneAt < SEEN_PRUNE_INTERVAL_MS) return;
      this.lastSeenPruneAt = now;
      this.seenPruning = true;
      void store.pruneSeen(now, SEEN_TTL_MS).then(({ pruned, adopted }) => {
        if (pruned || adopted) {
          ctx.logger.log(`chatwoot-adapter: pruned ${pruned} expired seen-marker(s), adopted ${adopted} legacy`);
        }
      }).catch((e) => ctx.logger.error("seen-marker prune failed", e)).finally(() => void (this.seenPruning = false));
    };
    this.retryTimer = setInterval(() => {
      void drain();
      maybePruneSeen();
    }, RETRY_INTERVAL_MS);
    this.retryTimer.unref?.();
    ctx.logger.log("chatwoot-adapter enabled");
  }
  async onDisable() {
    this.clearRetryTimer();
  }
  async onUnload() {
    this.clearRetryTimer();
  }
  clearRetryTimer() {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }
  // Surface the retry backlog + permanent failures in the dashboard's plugin health. A saturated queue is
  // unhealthy: at capacity, every new failure drops the oldest pending message (active data loss).
  async healthCheck() {
    const pending = this.store ? await this.store.countRetries() : 0;
    const saturated = pending >= MAX_PENDING_RETRIES;
    const parts = [];
    if (pending > 0) parts.push(`${pending} inbound message(s) pending retry${saturated ? " \u2014 queue full, dropping oldest" : ""}`);
    if (this.deadLetterCount > 0) parts.push(`${this.deadLetterCount} dead-lettered after ${MAX_RETRY_ATTEMPTS} attempts`);
    return { healthy: this.deadLetterCount === 0 && !saturated, message: parts.join("; ") || void 0 };
  }
};
