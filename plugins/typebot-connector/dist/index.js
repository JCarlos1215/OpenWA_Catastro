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

// typebot-connector/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => TypebotConnector,
  readConfig: () => readConfig
});
module.exports = __toCommonJS(index_exports);

// typebot-connector/chat-lock.ts
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

// typebot-connector/session-store.ts
var SessionStore = class {
  constructor(storage) {
    this.storage = storage;
  }
  k(key) {
    return `sess:${key}`;
  }
  get(key) {
    return this.storage.get(this.k(key));
  }
  set(key, state) {
    return this.storage.set(this.k(key), state);
  }
  clear(key) {
    return this.storage.delete(this.k(key));
  }
};

// typebot-connector/typebot-client.ts
var import_node_crypto = require("node:crypto");

// typebot-connector/multipart.ts
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

// typebot-connector/typebot-client.ts
var TypebotHttpError = class extends Error {
  constructor(status, bodyText) {
    super(`Typebot HTTP ${status}`);
    this.status = status;
    this.bodyText = bodyText;
    this.name = "TypebotHttpError";
  }
};
var TypebotClient = class {
  constructor(fetchFn, cfg) {
    this.fetchFn = fetchFn;
    this.cfg = cfg;
  }
  headers() {
    const h = { "Content-Type": "application/json" };
    if (this.cfg.apiToken) h["Authorization"] = `Bearer ${this.cfg.apiToken}`;
    return h;
  }
  async postJson(url, payload) {
    const res = await this.fetchFn(url, { method: "POST", headers: this.headers(), body: JSON.stringify(payload) });
    if (!res.ok) throw new TypebotHttpError(res.status, res.body);
    return normalize(JSON.parse(res.body));
  }
  startChat(opts) {
    const url = `${this.cfg.apiHost}/api/v1/typebots/${encodeURIComponent(this.cfg.publicId)}/startChat`;
    return this.postJson(url, { isStreamEnabled: false, textBubbleContentFormat: "markdown", prefilledVariables: opts.prefilledVariables });
  }
  continueChat(sessionId, message) {
    const url = `${this.cfg.apiHost}/api/v1/sessions/${encodeURIComponent(sessionId)}/continueChat`;
    return this.postJson(url, { message, textBubbleContentFormat: "markdown" });
  }
  // Answer a file-input block: get an upload URL, PUT/POST the bytes, return the final fileUrl.
  async uploadFile(sessionId, blockId, file) {
    const bytes = Buffer.from(file.data, "base64");
    const gu = await this.fetchFn(`${this.cfg.apiHost}/api/v3/generate-upload-url`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ sessionId, blockId, fileName: file.filename, fileType: file.mime, fileSize: bytes.length })
    });
    if (!gu.ok) throw new TypebotHttpError(gu.status, gu.body);
    const { presignedUrl, formData, fileUrl } = JSON.parse(gu.body);
    const entries = Object.entries(formData ?? {});
    if (entries.length === 0) {
      const put = await this.fetchFn(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.mime, "Cache-Control": "public, max-age=86400" },
        body: bytes
      });
      if (!put.ok) throw new TypebotHttpError(put.status, put.body);
    } else {
      const boundary = `----typebot${(0, import_node_crypto.randomBytes)(16).toString("hex")}`;
      const body = buildMultipartBody(
        boundary,
        entries.map(([name, value]) => ({ name, value })),
        [{ name: "file", filename: file.filename, contentType: file.mime, data: bytes }]
      );
      const post = await this.fetchFn(presignedUrl, {
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body
      });
      if (!post.ok) throw new TypebotHttpError(post.status, post.body);
    }
    return fileUrl;
  }
};
function normalize(raw) {
  const bubbles = (raw?.messages ?? []).map(normalizeBubble).filter((b) => b !== null);
  const input = raw?.input ? normalizeInput(raw.input) : void 0;
  const redirect = (raw?.clientSideActions ?? []).find((a) => a?.redirect)?.redirect;
  return { sessionId: raw?.sessionId, bubbles, input, redirectUrl: redirect?.url };
}
function normalizeBubble(m) {
  switch (m?.type) {
    case "text":
      return { kind: "text", markdown: typeof m.content?.markdown === "string" ? m.content.markdown : richToText(m.content?.richText) };
    case "image":
      return m.content?.url ? { kind: "image", url: m.content.url } : null;
    case "audio":
      return m.content?.url ? { kind: "audio", url: m.content.url } : null;
    case "video":
      if (!m.content?.url) return null;
      return !m.content.type || m.content.type === "url" ? { kind: "video", url: m.content.url } : { kind: "link", url: m.content.url };
    case "embed":
    case "custom-embed":
      return m.content?.url ? { kind: "link", url: m.content.url } : null;
    default:
      return null;
  }
}
function richToText(rich) {
  return (rich ?? []).map((n) => (n?.children ?? []).map((c) => c?.text ?? "").join("")).join("\n");
}
function normalizeInput(inp) {
  const blockId = String(inp?.id ?? "");
  switch (inp?.type) {
    case "choice input":
    case "picture choice input": {
      const items = (inp.items ?? []).map((it) => ({
        id: String(it?.id ?? ""),
        content: String(it?.content ?? it?.title ?? it?.value ?? "")
      }));
      return { kind: "choice", blockId, items, multiple: !!inp.options?.isMultipleChoice };
    }
    case "rating input":
      return { kind: "rating", blockId, max: typeof inp.options?.length === "number" ? inp.options.length : void 0 };
    case "file input":
      return { kind: "file", blockId };
    case "text input":
      return {
        kind: "text",
        blockId,
        placeholder: inp.options?.labels?.placeholder,
        attachmentsEnabled: !!(inp.options?.attachments?.isEnabled || inp.options?.audioClip?.isEnabled)
      };
    case "number input":
    case "email input":
    case "url input":
    case "date input":
    case "time input":
    case "phone number input":
      return { kind: "text", blockId, placeholder: inp.options?.labels?.placeholder, attachmentsEnabled: false };
    default:
      return { kind: "unsupported", blockId, typeLabel: String(inp?.type ?? "unknown") };
  }
}

// typebot-connector/filters.ts
function inScope(msg, source, respondInGroups) {
  if (source !== "Engine") return false;
  if (msg.fromMe) return false;
  if (!msg.chatId) return false;
  if (msg.isGroup && !respondInGroups) return false;
  return true;
}
function sessionKey(sessionId, msg) {
  if (!msg.isGroup) return `${sessionId}:${msg.chatId}`;
  const who = msg.author ?? msg.senderPhone ?? "unknown";
  return `${sessionId}:${msg.chatId}:${who}`;
}

// typebot-connector/md-to-wa.ts
function mdToWhatsApp(md) {
  let s = md;
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  s = s.replace(/(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, "_$1_");
  s = s.replace(/\*\*([^*]+?)\*\*/g, "*$1*");
  s = s.replace(/__([^_]+?)__/g, "*$1*");
  s = s.replace(/~~(.+?)~~/g, "~$1~");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  return s;
}

// typebot-connector/render.ts
function renderResponse(resp) {
  const parts = [];
  for (const b of resp.bubbles) {
    if (b.kind === "text") parts.push({ type: "text", text: mdToWhatsApp(b.markdown) });
    else if (b.kind === "link") parts.push({ type: "text", text: b.url });
    else parts.push({ type: b.kind, mediaUrl: b.url });
  }
  if (resp.input) {
    const prompt = renderInputPrompt(resp.input);
    if (prompt) parts.push(prompt);
  }
  if (resp.redirectUrl) parts.push({ type: "text", text: resp.redirectUrl });
  return parts;
}
function renderInputPrompt(input) {
  switch (input.kind) {
    case "choice": {
      const lines = input.items.map((it, i) => `${i + 1}. ${it.content}`).join("\n");
      const hint = input.multiple ? "\n\n(You can pick more than one, separated by commas.)" : "";
      return { type: "text", text: lines + hint };
    }
    case "rating":
      return { type: "text", text: `Reply with a number${input.max ? ` from 1 to ${input.max}` : ""}.` };
    case "file":
      return { type: "text", text: "Send a file or photo \u2014 or type your answer to continue." };
    case "text":
      return input.placeholder ? { type: "text", text: input.placeholder } : null;
    case "unsupported":
      return { type: "text", text: `This step (${input.typeLabel}) can't be shown on WhatsApp.` };
  }
}

// typebot-connector/reply-map.ts
function mapReply(awaiting, msg) {
  const text = (msg.body ?? "").trim();
  if (awaiting.kind === "file" || awaiting.kind === "text" && awaiting.attachmentsEnabled) {
    if (msg.media?.data && !msg.media.omitted) {
      return { kind: "file", mime: msg.media.mimetype, filename: msg.media.filename ?? "file", data: msg.media.data };
    }
    if (msg.media?.omitted) {
      return { kind: "fallback", text: "That file is too large to accept here. Please send a smaller file or type to continue." };
    }
    if (awaiting.kind === "text") return { kind: "text", message: text };
    return { kind: "fallback", text: "Please send a file or photo to continue." };
  }
  if (awaiting.kind === "choice") {
    if (awaiting.multiple) {
      const picks = text.split(/[,\s]+/).map((t) => Number.parseInt(t, 10)).filter((n2) => Number.isInteger(n2) && n2 >= 1 && n2 <= awaiting.items.length);
      if (picks.length) return { kind: "text", message: picks.map((i) => awaiting.items[i - 1].content).join(", ") };
      return { kind: "text", message: text };
    }
    const n = Number.parseInt(text, 10);
    if (Number.isInteger(n) && String(n) === text && n >= 1 && n <= awaiting.items.length) {
      return { kind: "text", message: awaiting.items[n - 1].content };
    }
    return { kind: "text", message: text };
  }
  return { kind: "text", message: text };
}

// typebot-connector/turn.ts
async function handleTurn(deps, sessionId, source, msg) {
  if (!inScope(msg, source, deps.cfg.respondInGroups)) return;
  const key = sessionKey(sessionId, msg);
  await deps.lock.run(key, async () => {
    let state = await deps.store.get(key);
    if (state && deps.now() - state.lastActivity > deps.cfg.sessionTimeoutMinutes * 6e4) state = null;
    const prefilled = deps.cfg.passContactVariables ? contactVars(msg) : void 0;
    let resp;
    if (!state) {
      resp = await deps.client.startChat({ prefilledVariables: prefilled });
    } else {
      const intent = mapReply(state.awaiting, msg);
      if (intent.kind === "fallback") {
        await send(deps, sessionId, msg, { type: "text", text: intent.text });
        return;
      }
      let message;
      if (intent.kind === "file") {
        let url;
        try {
          url = await deps.client.uploadFile(state.sessionId, state.awaiting.blockId, {
            mime: intent.mime,
            filename: intent.filename,
            data: intent.data
          });
        } catch (e) {
          deps.log("typebot upload failed", e);
          await send(deps, sessionId, msg, { type: "text", text: "Sorry, that upload failed \u2014 please try sending the file again." });
          return;
        }
        message = { type: "text", text: "", attachedFileUrls: [url] };
      } else {
        message = intent.message;
      }
      try {
        resp = await deps.client.continueChat(state.sessionId, message);
      } catch (e) {
        if (e instanceof TypebotHttpError && (e.status === 400 || e.status === 404)) {
          await deps.store.clear(key);
          resp = await deps.client.startChat({ prefilledVariables: prefilled });
        } else {
          throw e;
        }
      }
    }
    const sid = resp.sessionId ?? state?.sessionId;
    if (resp.input && sid) {
      await deps.store.set(key, { sessionId: sid, awaiting: resp.input, lastActivity: deps.now() });
    } else {
      await deps.store.clear(key);
    }
    for (const part of renderResponse(resp)) await send(deps, sessionId, msg, part);
  });
}
function contactVars(msg) {
  return {
    waNumber: msg.senderPhone ?? "",
    waName: msg.contact?.pushName ?? msg.contact?.name ?? "",
    waChatId: msg.chatId
  };
}
async function send(deps, sessionId, msg, part) {
  const env = { sessionId, chatId: msg.chatId, ...part };
  if (msg.isGroup && part.type === "text") env.replyTo = msg.id;
  await deps.conversations.send(env);
}

// typebot-connector/index.ts
function readConfig(raw) {
  const apiHost = String(raw.apiHost ?? "").trim();
  const publicId = String(raw.publicId ?? "").trim();
  if (!publicId) throw new Error("typebot-connector: publicId is required");
  if (!apiHost) throw new Error("typebot-connector: apiHost is required");
  let parsed;
  try {
    parsed = new URL(apiHost);
  } catch {
    throw new Error("typebot-connector: apiHost must be a valid URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("typebot-connector: apiHost must be an https URL without embedded credentials");
  }
  const timeout = Number(raw.sessionTimeoutMinutes);
  return {
    apiHost: apiHost.replace(/\/+$/, ""),
    publicId,
    apiToken: raw.apiToken ? String(raw.apiToken) : void 0,
    respondInGroups: raw.respondInGroups !== false,
    sessionTimeoutMinutes: Number.isFinite(timeout) && timeout > 0 ? timeout : 30,
    passContactVariables: raw.passContactVariables !== false
  };
}
var TypebotConnector = class {
  async onEnable(ctx) {
    readConfig(ctx.config);
    const lock = new KeyedAsyncLock();
    const store = new SessionStore(ctx.storage);
    ctx.registerHook("message:received", async (h) => {
      const sessionId = h.sessionId;
      const msg = h.data;
      if (sessionId && msg) {
        const cfg = readConfig(ctx.config);
        const client = new TypebotClient(ctx.net.fetch.bind(ctx.net), cfg);
        void handleTurn(
          { cfg, client, store, lock, conversations: ctx.conversations, now: () => Date.now(), log: (m, e) => ctx.logger.error(m, e) },
          sessionId,
          h.source,
          msg
        ).catch((e) => ctx.logger.error("typebot turn failed", e));
      }
      return { continue: true };
    });
    ctx.logger.log("typebot-connector enabled");
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  readConfig
});
