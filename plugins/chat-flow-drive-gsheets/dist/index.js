"use strict";

const crypto = require("node:crypto");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const BACK_TO_MAIN_MENU_INPUTS = new Set(["0", "volver", "menu", "menú", "inicio"]);
const BACK_TO_MAIN_MENU_LABEL = "↩️ 0. Volver al menú principal";
const DEFAULT_TRACKING_SPREADSHEET_ID = "1Cn1C_GoON1640ne-W2rE3opt5pnO4rido3wlVU7dK0k";
const DEFAULT_TRACKING_SHEET_TAB = "Hoja 1";
// "* > 2" is a special path: option 2 selected from any submenu, regardless
// of how many levels deep that submenu is.
const DEFAULT_TRACKING_MENU_PATHS = ["* > 2"];
const LEGACY_DEFAULT_TRACKING_MENU_PATHS = ["1 > 2", "2 > 2"];

function withBackToMainMenu(text) {
  const message = String(text ?? "").trim();
  return message ? `${message}\n\n${BACK_TO_MAIN_MENU_LABEL}` : BACK_TO_MAIN_MENU_LABEL;
}

/**
 * Converts Google Drive viewer/sharing URLs into direct file download URLs
 * so WhatsApp engine can fetch and send the document/media attachment.
 */
function normalizeDriveUrl(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();

  // The WhatsApp media sender only accepts remote HTTP(S) URLs. Reject other
  // schemes here instead of passing a potentially unsafe or unusable value on.
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";

  // Pattern 1: https://drive.google.com/file/d/{FILE_ID}/...
  const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch && fileMatch[1]) {
    return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
  }

  // Pattern 2: https://drive.google.com/open?id={FILE_ID} or uc?id={FILE_ID}
  const idMatch = trimmed.match(/drive\.google\.com\/(?:open|uc)\?.*id=([a-zA-Z0-9_-]+)/);
  if (idMatch && idMatch[1]) {
    return `https://drive.google.com/uc?export=download&id=${idMatch[1]}`;
  }

  // Pattern 3: Google Docs/Sheets/Slides export link (PDF by default)
  const docMatch = trimmed.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch && docMatch[1] && docMatch[2]) {
    const docType = docMatch[1];
    const docId = docMatch[2];
    if (docType === "document") {
      return `https://docs.google.com/document/d/${docId}/export?format=pdf`;
    } else if (docType === "spreadsheets") {
      return `https://docs.google.com/spreadsheets/d/${docId}/export?format=pdf`;
    } else if (docType === "presentation") {
      return `https://docs.google.com/presentation/d/${docId}/export/pdf`;
    }
  }

  return parsed.toString();
}

/**
 * Validates an operator-uploaded data URL and returns its real MIME type.
 * The configuration UI stores attachments inline, so the MIME type must travel
 * with the data URL rather than being guessed from the filename at send time.
 */
function normalizeUploadedMedia(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^data:([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+%-]+)*);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(trimmed);
  if (!match || !match[2]) return null;
  return { data: trimmed, mimetype: match[1].toLowerCase() };
}

function mediaTypeForMimetype(mimetype) {
  if (typeof mimetype !== "string") return "file";
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "file";
}

function mediaSendErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/Either url or base64 must be provided/i.test(message)) return "MEDIA-SOURCE-MISSING";
  if (/mimetype is required/i.test(message)) return "MEDIA-MIMETYPE-MISSING";
  if (/maximum allowed size|exceeds.*size/i.test(message)) return "MEDIA-TOO-LARGE";
  if (/conversation:send/i.test(message)) return "MEDIA-PERMISSION-DENIED";
  if (/session.*(active|allowed)|not permitted/i.test(message)) return "MEDIA-SESSION-DENIED";
  return "MEDIA-SEND-FAILED";
}

/**
 * Base64 URL Encoder
 */
function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

/**
 * Builds JWT for Google Service Account authentication
 */
function buildJwt(sa, now) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(sa.private_key, "base64url");
  return `${signingInput}.${signature}`;
}

/**
 * Google Sheets API Client
 */
class SheetsClient {
  constructor(fetch, sa, spreadsheetId, sheetTab) {
    this.fetch = fetch;
    this.sa = sa;
    this.spreadsheetId = spreadsheetId;
    this.sheetTab = sheetTab || "Logs";
    this.token = null;
    this.tokenExp = 0;
  }

  async getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && now < this.tokenExp - 60) return this.token;

    const assertion = buildJwt(this.sa, now);
    const res = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: String(
        new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        })
      ),
    });

    if (!res.ok) {
      throw new Error(`Google OAuth2 token request failed: ${res.status} ${res.body ? res.body.slice(0, 300) : ''}`);
    }

    const json = JSON.parse(res.body || "{}");
    if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") {
      throw new Error("Token response missing access_token or expires_in");
    }

    this.token = json.access_token;
    this.tokenExp = now + json.expires_in;
    return this.token;
  }

  async appendRow(row) {
    const token = await this.getToken();
    const range = encodeURIComponent(`${this.sheetTab}!A1`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await this.fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ values: [row] }),
    });

    if (!res.ok) {
      if (res.status === 401) this.token = null;
      throw new Error(`Google Sheets append failed: ${res.status} ${res.body ? res.body.slice(0, 300) : ''}`);
    }
  }

  async getValues(range) {
    const token = await this.getToken();
    const encodedRange = encodeURIComponent(range);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodedRange}?majorDimension=ROWS`;
    const res = await this.fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      if (res.status === 401) this.token = null;
      throw new Error(`Google Sheets read failed: ${res.status} ${res.body ? res.body.slice(0, 300) : ""}`);
    }
    const json = JSON.parse(res.body || "{}");
    return Array.isArray(json.values) ? json.values : [];
  }
}

/**
 * Sanitize text cells for Google Sheets formula injection prevention
 */
function sanitizeCell(val) {
  const s = val == null ? "" : String(val);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function normalizeLookupValue(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeHeaderName(value) {
  // Column labels in the supplied sheet are numbered (for example
  // "2.- NÚMERO DE ORDEN"). The number is descriptive, not part of the key.
  return normalizeLookupValue(value).replace(/^\d+/, "");
}

function trackingMovementForOptionText(value) {
  const text = normalizeLookupValue(value);
  if (text.includes("transmisionpatrimon") || text.includes("transmision")) return "TRANSMISION";
  if (text.includes("avaluocatastral") || text.includes("avaluo")) return "AVALUO CATASTRAL";
  if (text.includes("manifestaciondevalorcatastral") || text.includes("manifestacion")) return "MANIFESTACION OFICIAL";
  if (text.includes("informacioncatastral") || text.includes("informe")) return "INFORME CATASTRAL";
  if (text.includes("subdivisionfusion") || text.includes("subdivision") || text.includes("fusion")) return "FUSION DE PREDIOS";
  if (text.includes("apeoydeslinde") || text.includes("apeo")) return "APEO Y DESLINDE";
  if (text.includes("altadecartografia") || text.includes("cartografia")) return "ALTA DE CARTOGRAFIA";
  if (text.includes("altadeclavealpadron") || text.includes("clavealpadron") || text.includes("padron")) return "ASIGNACION DE CLAVES";
  return "";
}

function parseTrackingMenuPaths(value) {
  const paths = String(value ?? "")
    .split(/[,\n]/)
    .map((path) => path.trim().replace(/\s*>\s*/g, " > "))
    .filter(Boolean);
  const uniquePaths = [...new Set(paths)];
  // Migrate configurations saved by versions that only watched two fixed
  // routes, so existing installations receive the corrected behaviour after
  // updating without requiring the operator to open and save the form.
  if (
    uniquePaths.length === LEGACY_DEFAULT_TRACKING_MENU_PATHS.length &&
    LEGACY_DEFAULT_TRACKING_MENU_PATHS.every((path) => uniquePaths.includes(path))
  ) {
    return DEFAULT_TRACKING_MENU_PATHS;
  }
  return uniquePaths.length ? uniquePaths : DEFAULT_TRACKING_MENU_PATHS;
}

function isTrackingMenuPath(menuPaths, selectedPath) {
  const selectedKeys = selectedPath.split(" > ");
  return menuPaths.some((path) => {
    if (path === "* > 2") {
      return selectedKeys.length >= 2 && selectedKeys[selectedKeys.length - 1] === "2";
    }
    return path === selectedPath;
  });
}

function trackingLookupErrorMessage(error, action) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  if (/No hay una cuenta de servicio/i.test(detail)) {
    return "Falta configurar el JSON de la cuenta de servicio de Google en el plugin.";
  }
  if (/\b403\b|permission|forbidden/i.test(detail)) {
    return "La cuenta de servicio no tiene acceso a la hoja servicios. Compártela con el client_email de la cuenta de servicio como Lector.";
  }
  if (/\b404\b|not found/i.test(detail)) {
    return "No encontré la hoja de seguimiento. Verifica el ID de todos_los_servicios y el nombre exacto de la pestaña servicios.";
  }
  if (/No se encontr/i.test(detail)) {
    return "La hoja servicios debe incluir las columnas No. Orden, Clave Catastral, Movimiento, Situación Actual y Estatus.";
  }
  return `No fue posible ${action} en este momento. Inténtalo nuevamente.`;
}

function findTrackingColumns(rows, expectedMovement) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No se encontraron filas en la hoja servicios. Verifica que la pestaña no esté vacía.");
  }

  const requiredHeaders = {
    orderNumber: ["noorden", "numerodeorden", "nodeorden", "orden", "norden", "numorden", "folio", "nofolio"],
    cadastralKey: ["clavecatastral", "claveid", "clave", "ccatastral", "clavecat", "clavepredial", "cuentacatastral"],
    currentStatus: ["situacionactual", "situacion", "estadoactual", "estado", "estatusactual", "situaciondeltramite", "proceso", "avance"],
    solution: ["estatus", "status", "estatusfinal", "solucion", "dictamen", "resultado", "respuesta", "observaciones"],
    movement: ["movimiento", "tipodemovimiento", "movimientobuscado", "servicio", "tipodeservicio", "tramite", "concepto"],
  };

  for (let headerRowIndex = 0; headerRowIndex < Math.min(rows.length, 30); headerRowIndex++) {
    const headers = rows[headerRowIndex] || [];
    if (!Array.isArray(headers) || headers.length === 0) continue;

    const indexes = Object.create(null);
    headers.forEach((header, index) => {
      const normalized = normalizeHeaderName(header);
      for (const [field, acceptedHeaders] of Object.entries(requiredHeaders)) {
        if (acceptedHeaders.some((ah) => normalized === ah || (normalized.length > 3 && (normalized.includes(ah) || ah.includes(normalized))))) {
          if (!Number.isInteger(indexes[field]) || acceptedHeaders[0] === normalized) {
            indexes[field] = index;
          }
        }
      }
    });

    const requiredFields = ["orderNumber", "cadastralKey", "currentStatus", "solution"];
    if (requiredFields.every((field) => Number.isInteger(indexes[field]))) {
      if (expectedMovement && !Number.isInteger(indexes.movement)) {
        throw new Error("No se encontró la columna Movimiento en la hoja servicios");
      }
      return { headerRowIndex, indexes };
    }
  }

  throw new Error("No se encontraron las columnas No. Orden, Clave Catastral, Situación Actual y Estatus en la hoja servicios");
}

function rowMatchesMovement(row, indexes, expectedMovement) {
  if (!expectedMovement) return true;
  const rowValue = normalizeLookupValue(row[indexes.movement]);
  const expValue = normalizeLookupValue(expectedMovement);
  if (!rowValue || !expValue) return true;
  return rowValue === expValue || rowValue.includes(expValue) || expValue.includes(rowValue);
}

function findTrackingOrder(rows, orderNumber, expectedMovement = "") {
  const { headerRowIndex, indexes } = findTrackingColumns(rows, expectedMovement);
  const normalizedOrder = normalizeLookupValue(orderNumber);
  return rows.slice(headerRowIndex + 1).some(
    (row) =>
      normalizeLookupValue(row[indexes.orderNumber]) === normalizedOrder &&
      rowMatchesMovement(row, indexes, expectedMovement)
  );
}

function findTrackingRecord(rows, orderNumber, cadastralKey, expectedMovement = "") {
  const { headerRowIndex, indexes } = findTrackingColumns(rows, expectedMovement);
  const normalizedOrder = normalizeLookupValue(orderNumber);
  const normalizedKey = normalizeLookupValue(cadastralKey);
  for (const row of rows.slice(headerRowIndex + 1)) {
    if (
      normalizeLookupValue(row[indexes.orderNumber]) === normalizedOrder &&
      normalizeLookupValue(row[indexes.cadastralKey]) === normalizedKey &&
      rowMatchesMovement(row, indexes, expectedMovement)
    ) {
      return {
        currentStatus: String(row[indexes.currentStatus] ?? "").trim(),
        solution: String(row[indexes.solution] ?? "").trim(),
      };
    }
  }
  return null;
}

/**
 * Parses and recursively validates option nodes tree
 */
function toFlowNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return undefined;
  const out = Object.create(null);
  for (const raw of nodes) {
    if (!raw || typeof raw !== "object") {
      throw new Error("chat-flow-drive-gsheets: cada opción debe ser un objeto");
    }
    const key = String(raw.key ?? "").trim();
    const text = String(raw.text ?? "").trim();
    // fileUrl remains supported for existing configurations, but new configurations use fileData.
    const fileUrl = String(raw.fileUrl ?? "").trim();
    const uploadedMedia = normalizeUploadedMedia(raw.fileData);
    const fileData = uploadedMedia ? uploadedMedia.data : "";
    const fileMimetype = uploadedMedia ? uploadedMedia.mimetype : "";
    const fileName = String(raw.fileName ?? "archivo-adjunto").trim() || "archivo-adjunto";

    if (!key) {
      throw new Error('chat-flow-drive-gsheets: cada opción requiere una clave ("key") no vacía');
    }
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new Error(`chat-flow-drive-gsheets: la clave de opción "${key}" no está permitida`);
    }
    if (fileUrl && !normalizeDriveUrl(fileUrl)) {
      throw new Error(`chat-flow-drive-gsheets: el enlace de archivo de la opción "${key}" debe ser una URL HTTP(S) válida`);
    }
    if (raw.fileData && !fileData) {
      throw new Error(`chat-flow-drive-gsheets: el archivo de la opción "${key}" debe ser un archivo válido codificado como data URL`);
    }
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      throw new Error(`chat-flow-drive-gsheets: clave de opción duplicada "${key}"`);
    }

    out[key] = {
      key,
      text,
      fileUrl,
      fileData,
      fileMimetype,
      fileName,
      options: toFlowNodes(raw.options),
    };
  }
  return out;
}

/**
 * Parses configuration and validates credentials/structure
 */
function parseConfig(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("chat-flow-drive-gsheets: configuración inválida");
  }

  const greeting = String(raw.greeting ?? "").trim();
  if (!greeting) {
    throw new Error("chat-flow-drive-gsheets: el mensaje de saludo ('greeting') es requerido");
  }

  const options = toFlowNodes(raw.options);
  if (!options) {
    throw new Error("chat-flow-drive-gsheets: se requiere al menos una opción en el menú");
  }

  const trigger = String(raw.trigger ?? "").trim();
  const respondInGroups = raw.respondInGroups === true;

  let serviceAccount = null;
  const saJsonStr = String(raw.serviceAccountJson ?? "").trim();
  if (saJsonStr) {
    try {
      serviceAccount = JSON.parse(saJsonStr);
      if (!serviceAccount.client_email || !serviceAccount.private_key) {
        throw new Error("Missing client_email or private_key in serviceAccountJson");
      }
    } catch (e) {
      throw new Error(`chat-flow-drive-gsheets: Service Account JSON inválido: ${e.message}`);
    }
  }

  const spreadsheetId = String(raw.spreadsheetId ?? "").trim();
  const sheetTab = String(raw.sheetTab ?? "Logs").trim();
  const trackingSpreadsheetId = String(raw.trackingSpreadsheetId ?? DEFAULT_TRACKING_SPREADSHEET_ID).trim();
  const trackingSheetTab = String(raw.trackingSheetTab ?? DEFAULT_TRACKING_SHEET_TAB).trim() || DEFAULT_TRACKING_SHEET_TAB;

  return {
    trigger,
    greeting,
    options,
    respondInGroups,
    serviceAccount,
    spreadsheetId,
    sheetTab,
    trackingLookup: {
      enabled: raw.trackingLookupEnabled !== false,
      spreadsheetId: trackingSpreadsheetId || DEFAULT_TRACKING_SPREADSHEET_ID,
      sheetTab: trackingSheetTab,
      menuPaths: parseTrackingMenuPaths(raw.trackingMenuPaths),
    },
  };
}

/**
 * Flow Engine for managing chat state, sending responses, files, and logging
 */
class FlowEngine {
  static TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes TTL
  static locks = new Map();

  static async processMessage(ctx, cfg, sessionId, chatId, messageBody, messageId, actor, pushName) {
    const conversation = actor ? `${chatId}|${actor}` : chatId;
    const lockKey = `${sessionId}__${conversation}`;

    const prev = this.locks.get(lockKey) || Promise.resolve();
    const run = prev.then(() =>
      this.processLocked(ctx, cfg, sessionId, chatId, conversation, messageBody, messageId, pushName)
    );
    const tail = run.catch(() => {});
    this.locks.set(lockKey, tail);

    try {
      return await run;
    } finally {
      if (this.locks.get(lockKey) === tail) {
        this.locks.delete(lockKey);
      }
    }
  }

  static async processLocked(ctx, cfg, sessionId, chatId, conversation, messageBody, messageId, pushName) {
    ctx.logger.debug("[FlowEngine] Processing message", { sessionId, chatId, body: messageBody });
    const input = messageBody.trim();
    const stateKey = `state__${sessionId}__${conversation}`.replace(/:/g, "_");

    let state = await ctx.storage.get(stateKey);

    // Check expiration
    if (state && Date.now() - state.lastActive > this.TIMEOUT_MS) {
      ctx.logger.debug("[FlowEngine] State expired, clearing state");
      await ctx.storage.delete(stateKey);
      state = null;
    }

    const trigger = cfg.trigger;
    const isTriggerWord = trigger !== "" && input.toLowerCase() === trigger.toLowerCase();

    // Start new flow if no active state
    if (!state) {
      if (trigger !== "" && !isTriggerWord) {
        return false; // ignore message if trigger word required and not matched
      }

      ctx.logger.debug("[FlowEngine] Starting new flow");
      await ctx.messages.reply(sessionId, chatId, messageId, cfg.greeting);
      await ctx.storage.set(stateKey, { path: [], lastActive: Date.now() });
      return true;
    }

    // Restart flow if trigger word sent while active
    if (isTriggerWord) {
      ctx.logger.debug("[FlowEngine] Trigger word matched during active flow, restarting");
      await ctx.messages.reply(sessionId, chatId, messageId, cfg.greeting);
      await ctx.storage.set(stateKey, { path: [], lastActive: Date.now() });
      return true;
    }

    // The return command is global while a flow is active, so it works from every
    // submenu without requiring each menu author to add a duplicate option node.
    if (BACK_TO_MAIN_MENU_INPUTS.has(input.toLocaleLowerCase("es"))) {
      ctx.logger.debug("[FlowEngine] Returning to main menu");
      await ctx.messages.reply(sessionId, chatId, messageId, cfg.greeting);
      await ctx.storage.set(stateKey, { path: [], lastActive: Date.now() });
      return true;
    }

    if (state.lookup) {
      return this.processTrackingLookup(ctx, cfg, sessionId, chatId, messageId, input, stateKey, state);
    }

    // Traverse current path in flow tree
    let currentNode = { text: cfg.greeting, options: cfg.options };
    for (const key of state.path) {
      if (currentNode && currentNode.options && Object.prototype.hasOwnProperty.call(currentNode.options, key)) {
        currentNode = currentNode.options[key];
      } else {
        // Mismatch / stale state reset
        ctx.logger.debug("[FlowEngine] Invalid path mismatch, resetting state");
        await ctx.storage.delete(stateKey);
        await ctx.messages.reply(sessionId, chatId, messageId, cfg.greeting);
        await ctx.storage.set(stateKey, { path: [], lastActive: Date.now() });
        return true;
      }
    }

    // Check if input matches next option
    const nextNode =
      currentNode.options && Object.prototype.hasOwnProperty.call(currentNode.options, input)
        ? currentNode.options[input]
        : undefined;

    if (nextNode) {
      ctx.logger.debug("[FlowEngine] Matched option key", { key: input });
      state.path.push(input);
      state.lastActive = Date.now();

      const newPathStr = state.path.join(" > ");
      const rawFileUrl = nextNode.fileUrl || "";
      const fileData = nextNode.fileData || "";
      const fileMimetype = nextNode.fileMimetype || "application/octet-stream";
      const directFileUrl = rawFileUrl ? normalizeDriveUrl(rawFileUrl) : "";
      const hasSubOptions = Boolean(nextNode.options && Object.keys(nextNode.options).length > 0);
      const responseText = hasSubOptions ? withBackToMainMenu(nextNode.text) : nextNode.text;

      // Submenus always present a consistent way back to the welcome message.
      if (responseText) {
        await ctx.messages.reply(sessionId, chatId, messageId, responseText);
      }

      // Send Google Drive file attachment if fileUrl exists
      let fileSent = false;
      if (directFileUrl || fileData) {
        try {
          const mediaType = fileData ? mediaTypeForMimetype(fileMimetype) : "file";
          ctx.logger.info("[FlowEngine] Sending media attachment", { source: fileData ? "uploaded-file" : "remote-url", mediaType, mimetype: fileData ? fileMimetype : undefined });
          if (ctx.conversations && typeof ctx.conversations.send === "function") {
            await ctx.conversations.send({
              sessionId,
              chatId,
              type: mediaType,
              ...(fileData
                ? { mediaBase64: fileData, mimetype: fileMimetype, filename: nextNode.fileName }
                : { mediaUrl: directFileUrl }),
              text: responseText ? undefined : `📎 Archivo adjunto: ${rawFileUrl}`,
            });
            fileSent = true;
          }
        } catch (fileErr) {
          const code = mediaSendErrorCode(fileErr);
          ctx.logger.error("[FlowEngine] Error sending media attachment", fileErr, { code });
          // An older URL configuration can fall back to its link. Never expose inline attachment data.
          await ctx.messages.sendText(
            sessionId,
            chatId,
            rawFileUrl
              ? `📎 Puedes descargar el archivo solicitado en el siguiente enlace:\n${rawFileUrl}`
              : `⚠️ No fue posible enviar el archivo adjunto. Código: ${code}`
          );
          fileSent = true;
        }
      }

      // Log selection to Google Sheets asynchronously
      this.logToSheets(ctx, cfg, {
        timestamp: new Date().toISOString(),
        sessionId,
        chatId,
        pushName: pushName || "",
        optionKey: input,
        optionText: nextNode.text || "(sin texto)",
        path: newPathStr,
        fileUrl: fileData ? `Archivo adjunto: ${nextNode.fileName} (${fileMimetype})` : rawFileUrl || "-",
      }).catch((err) => {
        ctx.logger.error("[FlowEngine] Error logging option to Google Sheets", err);
      });

      if (cfg.trackingLookup.enabled && isTrackingMenuPath(cfg.trackingLookup.menuPaths, newPathStr)) {
        state.lookup = {
          stage: "order",
          path: newPathStr,
          expectedMovement: trackingMovementForOptionText(nextNode.text),
        };
        await ctx.storage.set(stateKey, state);
        await ctx.messages.reply(
          sessionId,
          chatId,
          messageId,
          "Para consultar el seguimiento, escribe el No. Orden.\n\nPuedes responder 0 para volver al menú principal."
        );
        return true;
      }

      // Advance state or clear if leaf node
      if (hasSubOptions) {
        await ctx.storage.set(stateKey, state);
      } else {
        ctx.logger.debug("[FlowEngine] Leaf node reached, ending flow");
        await ctx.storage.delete(stateKey);
      }

      return true;
    } else {
      // Invalid input selection for current menu level
      ctx.logger.debug("[FlowEngine] Invalid option selected");
      const availableKeys = currentNode.options ? Object.keys(currentNode.options).join(", ") : "";
      const invalidMsg = `⚠️ Opción no válida. Por favor responde con una de las opciones disponibles (${availableKeys}) o escribe 0 para volver al menú principal:\n\n${currentNode.text}`;
      
      await ctx.messages.reply(sessionId, chatId, messageId, invalidMsg);
      state.lastActive = Date.now();
      await ctx.storage.set(stateKey, state);
      return true;
    }
  }

  static async processTrackingLookup(ctx, cfg, sessionId, chatId, messageId, input, stateKey, state) {
    const lookup = state.lookup;
    if (!input || input.length > 120) {
      await ctx.messages.reply(sessionId, chatId, messageId, "El dato no es válido. Escribe el valor tal como aparece en la hoja de cálculo.");
      return true;
    }

    if (lookup.stage === "order") {
      try {
        if (!cfg.serviceAccount) throw new Error("No hay una cuenta de servicio de Google configurada");
        const sheetsClient = new SheetsClient(
          ctx.net.fetch.bind(ctx.net),
          cfg.serviceAccount,
          cfg.trackingLookup.spreadsheetId,
          cfg.trackingLookup.sheetTab
        );
        const rows = await sheetsClient.getValues(`${cfg.trackingLookup.sheetTab}!A:Z`);
        if (!findTrackingOrder(rows, input, lookup.expectedMovement)) {
          await ctx.messages.reply(
            sessionId,
            chatId,
            messageId,
            "No encontré un No. Orden válido para ese seguimiento. Verifícalo y escríbelo nuevamente."
          );
          return true;
        }
        state.lookup = { ...lookup, stage: "cadastralKey", orderNumber: input };
        state.lastActive = Date.now();
        await ctx.storage.set(stateKey, state);
        await ctx.messages.reply(
          sessionId,
          chatId,
          messageId,
          "No. Orden confirmado. Ahora escribe la Clave Catastral sin guiones.\n\nPuedes responder 0 para volver al menú principal."
        );
        return true;
      } catch (err) {
        ctx.logger.error("[FlowEngine] Error validating tracking order", err);
        await ctx.messages.reply(sessionId, chatId, messageId, trackingLookupErrorMessage(err, "validar el No. Orden"));
        return true;
      }
    }

    if (input.includes("-")) {
      await ctx.messages.reply(
        sessionId,
        chatId,
        messageId,
        "La Clave Catastral debe escribirse sin guiones. Envíala nuevamente, por favor."
      );
      return true;
    }

    try {
      if (!cfg.serviceAccount) throw new Error("No hay una cuenta de servicio de Google configurada");
      const sheetsClient = new SheetsClient(
        ctx.net.fetch.bind(ctx.net),
        cfg.serviceAccount,
        cfg.trackingLookup.spreadsheetId,
        cfg.trackingLookup.sheetTab
      );
      const rows = await sheetsClient.getValues(`${cfg.trackingLookup.sheetTab}!A:Z`);
      const record = findTrackingRecord(rows, lookup.orderNumber, input, lookup.expectedMovement);
      if (!record) {
        state.lastActive = Date.now();
        await ctx.storage.set(stateKey, state);
        await ctx.messages.reply(
          sessionId,
          chatId,
          messageId,
          "No encontré una coincidencia con ese No. Orden y Clave Catastral. Verifica los datos y escríbelos nuevamente."
        );
        return true;
      }

      await ctx.messages.reply(
        sessionId,
        chatId,
        messageId,
        `📋 Situación Actual\n${record.currentStatus || "Sin información registrada."}\n\n✅ Estatus\n${record.solution || "Sin información registrada."}`
      );
      await ctx.storage.delete(stateKey);
      return true;
    } catch (err) {
      ctx.logger.error("[FlowEngine] Error consulting tracking sheet", err);
      await ctx.storage.delete(stateKey);
      await ctx.messages.reply(sessionId, chatId, messageId, trackingLookupErrorMessage(err, "consultar el seguimiento"));
      return true;
    }
  }

  static async logToSheets(ctx, cfg, data) {
    if (!cfg.serviceAccount || !cfg.spreadsheetId) {
      ctx.logger.debug("[FlowEngine] Google Sheets non-configured, skipping row log");
      return;
    }

    const sheetsClient = new SheetsClient(
      ctx.net.fetch.bind(ctx.net),
      cfg.serviceAccount,
      cfg.spreadsheetId,
      cfg.sheetTab
    );

    const row = [
      sanitizeCell(data.timestamp),
      sanitizeCell(data.sessionId),
      sanitizeCell(data.chatId),
      sanitizeCell(data.pushName),
      sanitizeCell(data.optionKey),
      sanitizeCell(data.optionText),
      sanitizeCell(data.path),
      sanitizeCell(data.fileUrl),
    ];

    await sheetsClient.appendRow(row);
    ctx.logger.info("[FlowEngine] Successfully logged option selection to Google Sheets", { path: data.path });
  }

  static async sweepExpired(ctx) {
    try {
      const keys = await ctx.storage.list("state__");
      const now = Date.now();
      let count = 0;
      for (const k of keys) {
        if (!k.startsWith("state__")) continue;
        const val = await ctx.storage.get(k);
        if (val && now - val.lastActive > this.TIMEOUT_MS) {
          await ctx.storage.delete(k);
          count++;
        }
      }
      if (count > 0) {
        ctx.logger.info(`[FlowEngine] Swept ${count} expired flow states`);
      }
    } catch (e) {
      // ignore storage sweep errors
    }
  }

  /** A changed menu can invalidate persisted paths (for example, a label key replaced by "1").
   * Clear those short-lived conversation states so the next message always starts at the new menu. */
  static async clearStates(ctx) {
    const keys = await ctx.storage.list("state__");
    let count = 0;
    for (const key of keys) {
      if (!key.startsWith("state__")) continue;
      await ctx.storage.delete(key);
      count++;
    }
    if (count > 0) {
      ctx.logger.info(`[FlowEngine] Cleared ${count} flow state(s) after a menu change`);
    }
  }
}

/**
 * Main Plugin Class for OpenWA
 */
class ChatFlowDriveGSheetsPlugin {
  constructor() {
    this.sweepTimer = null;
  }

  async onEnable(ctx) {
    parseConfig(ctx.config);
    await FlowEngine.clearStates(ctx);
    ctx.registerHook("message:received", (hook) => this.onMessage(ctx, hook));

    // Periodic cleanup of abandoned states
    this.stopSweep();
    this.sweepTimer = setInterval(() => {
      FlowEngine.sweepExpired(ctx).catch(() => {});
    }, 30 * 60 * 1000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  async onConfigChange(ctx) {
    parseConfig(ctx.config);
    await FlowEngine.clearStates(ctx);
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
    if (!m || m.fromMe || typeof m.body !== "string" || !m.chatId || !m.id) {
      return { continue: true };
    }

    let cfg;
    try {
      cfg = parseConfig(ctx.config);
    } catch (err) {
      ctx.logger.warn(`chat-flow-drive-gsheets: config invalid, skipping message: ${err.message}`);
      return { continue: true };
    }

    if (m.isGroup && !cfg.respondInGroups) {
      return { continue: true };
    }

    try {
      const actor = m.isGroup ? m.author : undefined;
      const pushName = m.contact?.pushName || m.contact?.name || "";

      const handled = await FlowEngine.processMessage(
        ctx,
        cfg,
        hook.sessionId,
        m.chatId,
        m.body,
        m.id,
        actor,
        pushName
      );

      return { continue: !handled };
    } catch (err) {
      ctx.logger.error("chat-flow-drive-gsheets: error processing message", err);
      return { continue: true };
    }
  }
}

module.exports = {
  default: ChatFlowDriveGSheetsPlugin,
  parseConfig,
  normalizeDriveUrl,
  normalizeUploadedMedia,
  mediaTypeForMimetype,
  mediaSendErrorCode,
  withBackToMainMenu,
  normalizeLookupValue,
  normalizeHeaderName,
  findTrackingRecord,
  findTrackingOrder,
  findTrackingColumns,
  trackingMovementForOptionText,
  parseTrackingMenuPaths,
  isTrackingMenuPath,
  trackingLookupErrorMessage,
  toFlowNodes,
};
