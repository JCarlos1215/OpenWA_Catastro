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

// voice-transcription/index.ts
var index_exports = {};
__export(index_exports, {
  VoiceTranscriptionPlugin: () => VoiceTranscriptionPlugin,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// voice-transcription/multipart.ts
function buildMultipartBody(boundary, fields, files) {
  const parts = [];
  for (const field of fields) {
    parts.push(
      Buffer.from(`--${boundary}\r
Content-Disposition: form-data; name="${field.name}"\r
\r
${field.value}\r
`)
    );
  }
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r
Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r
Content-Type: ${file.contentType}\r
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

// voice-transcription/openai-stt.client.ts
function sanitizeContentType(mimetype) {
  const token = mimetype.split(";")[0].trim();
  return /^[\w.+-]+\/[\w.+-]+$/.test(token) ? token : "audio/ogg";
}
var OpenAiSttClient = class {
  constructor(opts) {
    this.opts = opts;
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 3e4;
    this.now = opts.now ?? (() => Date.now());
  }
  base;
  failureThreshold;
  cooldownMs;
  now;
  consecutiveFailures = 0;
  openUntil = 0;
  isHealthy() {
    return this.consecutiveFailures < this.failureThreshold;
  }
  async transcribe(audio, mimetype) {
    if (this.now() < this.openUntil) {
      throw new Error("STT circuit open");
    }
    try {
      const result = await this.doTranscribe(audio, mimetype);
      this.consecutiveFailures = 0;
      return result;
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.openUntil = this.now() + this.cooldownMs;
      }
      throw err;
    }
  }
  async doTranscribe(audio, mimetype) {
    const boundary = `----openwaFormBoundary${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    const fields = [
      { name: "model", value: this.opts.model },
      { name: "response_format", value: "json" }
    ];
    if (this.opts.language) fields.push({ name: "language", value: this.opts.language });
    const contentType = sanitizeContentType(mimetype);
    const formBody = buildMultipartBody(boundary, fields, [
      { name: "file", filename: "voice.ogg", contentType, data: audio }
    ]);
    const headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
    if (this.opts.apiKey) headers["authorization"] = `Bearer ${this.opts.apiKey}`;
    const response = await this.opts.net.fetch(`${this.base}/v1/audio/transcriptions`, {
      method: "POST",
      headers,
      body: formBody,
      timeoutMs: this.opts.timeoutMs
    });
    if (!response.ok) {
      throw new Error(`STT request failed: HTTP ${response.status}`);
    }
    const data = JSON.parse(response.body);
    if (typeof data?.text !== "string") {
      throw new Error("STT response contained no text");
    }
    return { text: data.text, language: typeof data.language === "string" ? data.language : void 0 };
  }
};

// voice-transcription/webhook.delivery.ts
var import_node_crypto = require("node:crypto");
var WebhookDelivery = class {
  constructor(opts) {
    this.opts = opts;
  }
  async deliver(payload) {
    const body = JSON.stringify(payload);
    const headers = { "content-type": "application/json" };
    if (this.opts.secret) {
      headers["X-OpenWA-Signature"] = `sha256=${(0, import_node_crypto.createHmac)("sha256", this.opts.secret).update(body).digest("hex")}`;
    }
    const response = await this.opts.net.fetch(this.opts.url, {
      method: "POST",
      headers,
      body,
      timeoutMs: this.opts.timeoutMs
    });
    if (!response.ok) {
      throw new Error(`transcription delivery failed: HTTP ${response.status}`);
    }
  }
};

// voice-transcription/transcription.coordinator.ts
var TranscriptionCoordinator = class {
  constructor(deps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }
  now;
  async handle(sessionId, msg) {
    const { config, store, logger } = this.deps;
    try {
      if (!config.enabledMessageTypes.includes(msg.type)) return;
      if (!msg.media) return;
      const seenKey = `seen:${sessionId}:${msg.id}`;
      if (await store.get(seenKey)) return;
      await store.set(seenKey, 1);
      const media = msg.media;
      if (media.omitted || !media.data) {
        await this.emit(sessionId, msg, { status: "skipped", reason: "media_unavailable" });
        return;
      }
      if (!media.mimetype || !media.mimetype.startsWith("audio/")) return;
      const audio = Buffer.from(media.data, "base64");
      if (audio.byteLength > config.maxSizeBytes) {
        await this.emit(sessionId, msg, { status: "skipped", reason: "too_large" });
        return;
      }
      const rateKey = `rate:${sessionId}:${Math.floor(this.now() / 36e5)}`;
      const count = await store.get(rateKey) ?? 0;
      if (count >= config.maxPerHour) {
        await this.emit(sessionId, msg, { status: "skipped", reason: "rate_limited" });
        return;
      }
      await store.set(rateKey, count + 1);
      let result;
      try {
        result = await this.deps.provider.transcribe(audio, media.mimetype);
      } catch (err) {
        await this.emit(sessionId, msg, { status: "failed", reason: err instanceof Error ? err.message : String(err) });
        return;
      }
      if (!result.text.trim()) {
        await this.emit(sessionId, msg, { status: "skipped", reason: "empty" });
        return;
      }
      await this.emit(sessionId, msg, {
        status: "completed",
        text: result.text,
        transcription: {
          text: result.text,
          language: result.language,
          provider: this.deps.providerLabel,
          model: this.deps.model
        }
      });
    } catch (err) {
      logger.warn("Transcription failed (skipped)", {
        messageId: msg.id,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  async emit(sessionId, msg, o) {
    if (o.status !== "completed") {
      this.deps.logger.warn(`Transcription ${o.status}: ${o.reason}`, { messageId: msg.id });
    }
    const payload = {
      event: "message.transcription",
      sessionId,
      messageId: msg.id,
      chatId: msg.chatId,
      status: o.status,
      source: "speech-to-text",
      untrusted: true,
      ...o.reason ? { reason: o.reason } : {},
      ...o.transcription ? { transcription: o.transcription } : {}
    };
    if (this.deps.delivery) {
      try {
        await this.deps.delivery.deliver(payload);
      } catch (err) {
        this.deps.logger.warn("Transcript webhook delivery failed", {
          messageId: msg.id,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    if (o.status === "completed" && o.text && this.deps.chat && this.deps.chatDelivery !== "off") {
      if (this.deps.chatDelivery === "self") await this.deps.chat.sendText(sessionId, msg.to, o.text);
      else await this.deps.chat.reply(sessionId, msg.chatId, msg.id, o.text);
    }
  }
};

// voice-transcription/index.ts
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
function readStringArray(cfg, key, fallback) {
  const v = cfg[key];
  return Array.isArray(v) && v.every((x) => typeof x === "string") && v.length > 0 ? v : fallback;
}
function readChatDelivery(cfg) {
  const v = cfg["chatDelivery"];
  return v === "self" || v === "reply" ? v : "off";
}
var VoiceTranscriptionPlugin = class {
  coordinator = null;
  ctxRef = null;
  // Signature of the coordinator-affecting config last used to build `this.coordinator`. The hook
  // recomputes this per event and rebuilds the coordinator only when it changes — so a per-session
  // override (resolved by the host for the firing session) takes effect, WITHOUT resetting the STT
  // provider's circuit breaker on every message (a per-event rebuild would open/close the backend anew
  // on each call and defeat the breaker's purpose).
  coordinatorSignature = "";
  onEnable(context) {
    this.ctxRef = context;
    this.coordinator = this.build(context);
    this.coordinatorSignature = this.configSignature(context.config);
    context.registerHook(
      "message:received",
      (ctx) => Promise.resolve(this.onMessage(ctx))
    );
    if (!readOptionalString(context.config, "deliveryWebhookUrl") && readChatDelivery(context.config) === "off") {
      context.logger.warn(
        "voice-transcription: no delivery configured \u2014 set deliveryWebhookUrl or chatDelivery, else transcripts have nowhere to go",
        { action: "transcription_no_delivery" }
      );
    }
    context.logger.log("Voice transcription plugin enabled", {
      action: "transcription_enabled"
    });
    return Promise.resolve();
  }
  onConfigChange(context) {
    this.ctxRef = context;
    this.coordinator = this.build(context);
    this.coordinatorSignature = this.configSignature(context.config);
    context.logger.log("Voice transcription config updated", {
      action: "transcription_config_changed"
    });
    return Promise.resolve();
  }
  /** Stable signature of only the config fields that affect the coordinator's behavior. Two configs
   *  with the same signature produce equivalent coordinators (same backend, same delivery, same guards),
   *  so the STT provider's circuit breaker state can be safely reused across them. */
  configSignature(cfg) {
    return JSON.stringify([
      readString(cfg, "sttBaseUrl", ""),
      readOptionalString(cfg, "sttApiKey") ?? "",
      readString(cfg, "model", "small"),
      readOptionalString(cfg, "language") ?? "",
      readNumber(cfg, "timeoutMs", 2e4),
      readString(cfg, "deliveryWebhookUrl", ""),
      readOptionalString(cfg, "deliverySecret") ?? "",
      readNumber(cfg, "deliveryTimeoutMs", 5e3),
      readChatDelivery(cfg),
      JSON.stringify(readStringArray(cfg, "enabledMessageTypes", ["voice"])),
      readNumber(cfg, "maxSizeBytes", 16 * 1024 * 1024),
      readNumber(cfg, "maxPerHour", 60),
      readString(cfg, "provider", "faster-whisper")
    ]);
  }
  onDisable(context) {
    this.coordinator = null;
    context.logger.log("Voice transcription plugin disabled", {
      action: "transcription_disabled"
    });
    return Promise.resolve();
  }
  build(context) {
    const cfg = context.config;
    const provider = new OpenAiSttClient({
      baseUrl: readString(cfg, "sttBaseUrl", ""),
      apiKey: readOptionalString(cfg, "sttApiKey"),
      model: readString(cfg, "model", "small"),
      language: readOptionalString(cfg, "language"),
      timeoutMs: readNumber(cfg, "timeoutMs", 2e4),
      net: context.net
    });
    const deliveryUrl = readString(cfg, "deliveryWebhookUrl", "");
    const delivery = deliveryUrl ? new WebhookDelivery({
      url: deliveryUrl,
      secret: readOptionalString(cfg, "deliverySecret"),
      timeoutMs: readNumber(cfg, "deliveryTimeoutMs", 5e3),
      net: context.net
    }) : void 0;
    const store = {
      get: (key) => context.storage.get(key),
      set: (key, value) => context.storage.set(key, value)
    };
    return new TranscriptionCoordinator({
      provider,
      delivery,
      chat: context.messages,
      // ChatSink — only used when chatDelivery !== 'off'
      chatDelivery: readChatDelivery(cfg),
      store,
      config: {
        enabledMessageTypes: readStringArray(cfg, "enabledMessageTypes", [
          "voice"
        ]),
        maxSizeBytes: readNumber(cfg, "maxSizeBytes", 16 * 1024 * 1024),
        maxPerHour: readNumber(cfg, "maxPerHour", 60)
      },
      providerLabel: readString(cfg, "provider", "faster-whisper"),
      model: readString(cfg, "model", "small"),
      logger: { warn: (m, meta) => context.logger.warn(m, meta) }
    });
  }
  /**
   * Synchronous hook body: return `{ continue: true }` immediately and run transcription off the
   * critical path. The coordinator is fail-open, so the floated promise needs no rejection handling.
   */
  onMessage(ctx) {
    if (ctx.source === "Engine" && ctx.sessionId) {
      const context = this.ctxRef;
      if (context) {
        const sig = this.configSignature(context.config);
        if (sig !== this.coordinatorSignature || !this.coordinator) {
          this.coordinator = this.build(context);
          this.coordinatorSignature = sig;
        }
      }
      if (this.coordinator) {
        void this.coordinator.handle(ctx.sessionId, ctx.data);
      }
    }
    return { continue: true };
  }
};
var index_default = VoiceTranscriptionPlugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  VoiceTranscriptionPlugin
});
