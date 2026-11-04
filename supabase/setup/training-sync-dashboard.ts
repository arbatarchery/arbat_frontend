// @ts-nocheck
// ARBAT: JavaScript autocontenido para pegar en index.ts del editor de Supabase.
// Generado desde fuentes revisables; no editar a mano. Sin secretos incluidos.
// Desactivado por defecto: no configurar TRAINING_SYNC_ENABLED=true todavia.
// functions/training-sync/index.ts: 51925a24880370cade03364c9e2554997bedb1450341b728e3fdacb506cff82c
// functions/_shared/training-handler.mjs: dc3cf971868fec16ef5583c3cd98c9169378752195c0f602725b288552c14589
// functions/_shared/buddy-identity.mjs: 6bd873ddb4e20fca1ae33d80327932b8ed7b9fc78819d2db7756072b8e6cce86
// functions/_shared/buddy-principal.mjs: 609259968e489ab62bb565deb2705b5d8798abf83a9e536ff6cd0caf2879cfba
// functions/_shared/location-proof.mjs: eca51fc43af0fe9224c42395cb06bb82965c3e0fd7798e463c26f8458c3aa72f

// supabase/functions/_shared/location-proof.mjs
var USAGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var encoder = new TextEncoder();
var decode = (value) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function key(secret) {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) throw new Error("usage_disabled");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function verifyLocation(proof, secret, now = Date.now()) {
  try {
    if (typeof proof !== "string" || proof.length > 4096 || !/^[-\w]+\.[-\w]{43}$/.test(proof)) throw 0;
    const [text, signature] = proof.split(".");
    if (!await crypto.subtle.verify("HMAC", await key(secret), decode(signature), encoder.encode("proof:" + text))) throw 0;
    const p = JSON.parse(new TextDecoder().decode(decode(text)));
    if (!p || Object.keys(p).sort().join(",") !== "approximate,aud,browser_id,city,country,event_id,event_kind,observed_at,rate_key,region,v" || p.v !== 1 || p.aud !== "arbat-training-usage" || p.approximate !== true || ![p.event_id, p.browser_id].every((v) => typeof v === "string" && USAGE_UUID.test(v)) || !["history_open", "end_location"].includes(p.event_kind) || !/^[-\w]{43}$/.test(p.rate_key) || ![p.city, p.region].every((v) => v === null || typeof v === "string" && v.length > 0 && v.length <= 120) || !(p.country === null || /^[A-Z]{2}$/.test(p.country))) throw 0;
    const age = now - Date.parse(p.observed_at);
    if (!Number.isFinite(age) || age < -6e4 || age > 7 * 864e5) throw new Error("location_proof_expired");
    return p;
  } catch (error) {
    if (error?.message === "usage_disabled" || error?.message === "location_proof_expired") throw error;
    throw new Error("location_proof_invalid");
  }
}

// supabase/functions/_shared/buddy-principal.mjs
async function resolveBuddyPrincipal(subject, { url, serverKey, fetchImpl, readJson, timeoutMs = 5e3 }) {
  const headers = { apikey: serverKey, "Content-Type": "application/json" };
  if (serverKey.startsWith("eyJ")) headers.Authorization = `Bearer ${serverKey}`;
  const call = async (path, body, method = "POST") => {
    const response = await fetchImpl(`${url}${path}`, { method, headers, ...body ? { body: JSON.stringify(body) } : {}, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    const data = await readJson(response.body, 16384, timeoutMs);
    return { ok: response.ok, status: response.status, data };
  };
  const lookup = async () => {
    const r = await call("/rest/v1/rpc/training_buddy_lookup", { p_subject: subject });
    if (!r.ok || r.data.status !== "accepted") throw new Error("buddy_bridge_unavailable");
    return r.data.principal_id;
  };
  let id = await lookup();
  if (id) return id;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`arbat-buddy-v1:https://api.statetty.com:${subject}`)));
  hash[6] = hash[6] & 15 | 128;
  hash[8] = hash[8] & 63 | 128;
  const hex = Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const marker = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  let user = await call(`/auth/v1/admin/users/${id}`, null, "GET");
  if (user.status === 404) {
    user = await call("/auth/v1/admin/users", { id, email: `${crypto.randomUUID()}@buddy.arbat.invalid`, password: `${crypto.randomUUID()}Aa1!`, email_confirm: true, app_metadata: { arbat_buddy_bridge: marker } });
    if (!user.ok) user = await call(`/auth/v1/admin/users/${id}`, null, "GET");
  }
  if (!user.ok || user.data.id !== id || user.data.app_metadata?.arbat_buddy_bridge !== marker) throw new Error("buddy_bridge_unavailable");
  await call("/rest/v1/rpc/training_claim", { p_principal: id, p_buddy_subject: subject, p_proof_hash: marker });
  const canonical = await lookup();
  if (canonical) return canonical;
  throw new Error("buddy_bridge_unavailable");
}

// supabase/functions/_shared/buddy-identity.mjs
var SESSION_URL = "https://api.statetty.com/api/buddy/auth/session";
var MAX_RESPONSE_BYTES = 16384;
var BuddyIdentityError = class extends Error {
  constructor() {
    super("Buddy session could not be verified");
    this.name = "BuddyIdentityError";
  }
};
async function verifyBuddyAccessToken(token, { fetchImpl = globalThis.fetch, timeoutMs = 5e3, includeProfile = false } = {}) {
  if (typeof token !== "string" || token.length > 8192 || !/^[A-Za-z0-9._~-]+$/.test(token)) {
    throw new BuddyIdentityError();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await fetchImpl(SESSION_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json") || !response.body) {
      throw new BuddyIdentityError();
    }
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new BuddyIdentityError();
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const subject = data?.user?.id;
    if (data?.ok !== true || data?.authenticated !== true || typeof subject !== "string" || !subject.trim() || subject.length > 256) {
      throw new BuddyIdentityError();
    }
    return Object.freeze({ issuer: "https://api.statetty.com", subject, ...includeProfile ? { displayName: typeof data.user.name === "string" ? data.user.name.trim().slice(0, 200) : null, verifiedEmail: typeof data.user.email === "string" ? data.user.email.trim().toLowerCase().slice(0, 254) : null } : {} });
  } catch {
    throw new BuddyIdentityError();
  } finally {
    clearTimeout(timer);
    if (reader) {
      try {
        await reader.cancel();
      } catch {
      }
    }
  }
}

// supabase/functions/_shared/training-handler.mjs
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var TOKEN = /^[A-Za-z0-9._~-]+$/;
var KINDS = /* @__PURE__ */ new Set(["session.upsert", "session.close", "end.upsert", "arrow.upsert", "arrow.delete"]);
var HttpError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
};
async function readJsonLimited(body, limit, timeoutMs = 5e3) {
  if (!body) throw new HttpError(400, "invalid_json");
  const reader = body.getReader();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const chunks = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > limit) throw new HttpError(413, "payload_too_large");
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const value of chunks) {
          bytes.set(value, offset);
          offset += value.byteLength;
        }
        try {
          return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new HttpError(400, "invalid_json");
        }
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new HttpError(408, "read_timeout")), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {
    });
  }
}
function validateOperation(op) {
  if (!op || Array.isArray(op) || typeof op !== "object" || Object.keys(op).some((k) => !["operation_id", "session_id", "entity_id", "kind", "base_revision", "payload"].includes(k)) || ![op.operation_id, op.session_id, op.entity_id].every((x) => typeof x === "string" && UUID.test(x)) || !KINDS.has(op.kind) || !Number.isSafeInteger(op.base_revision) || op.base_revision < 0 || !op.payload || Array.isArray(op.payload) || typeof op.payload !== "object" || new TextEncoder().encode(JSON.stringify(op)).length > 32768) throw new HttpError(400, "invalid_operation");
}
function createTrainingHandler({ url, publicKey, serverKey, allowedOrigins = [], enabled = false, locationSigningSecret, fetchImpl = globalThis.fetch, timeoutMs = 5e3 } = {}) {
  const origins = new Set(allowedOrigins);
  return async (request) => {
    const origin = request.headers.get("origin");
    const cors = origins.has(origin) ? {
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-buddy-access-token",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    } : { "Vary": "Origin" };
    const reply = (status, data, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...cors, ...extra, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    try {
      if (!enabled || !url || !publicKey || !serverKey || !url.startsWith("https://")) throw new HttpError(503, "sync_disabled");
      if (!origins.has(origin)) throw new HttpError(403, "origin_denied");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "json_required");
      const bearer = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]+)$/i)?.[1];
      if (!bearer || bearer.length > 8192) throw new HttpError(401, "supabase_session_required");
      const body = await readJsonLimited(request.body, 131072, timeoutMs);
      if (!body || Array.isArray(body) || body.schema_version !== 1 || !["sync", "claim", "history.list", "history.detail", "history.context", "history.coach", "buddy.session", "usage.record", "usage.summary"].includes(body.action)) throw new HttpError(400, "invalid_request");
      const keys = body.action === "usage.record" ? ["schema_version", "action", "event"] : body.action === "usage.summary" ? ["schema_version", "action", "from", "to"] : body.action === "history.coach" ? ["schema_version", "action", "from", "to", "cursor", "scope_hash"] : body.action === "sync" ? ["schema_version", "action", "operations"] : body.action === "history.list" ? ["schema_version", "action", "from", "to", "cursor", "target_subject"] : body.action === "history.detail" ? ["schema_version", "action", "session_id", "revision", "collection", "cursor"] : ["schema_version", "action"];
      if (Object.keys(body).some((k) => !keys.includes(k))) throw new HttpError(400, "unknown_request_fields");
      if (body.action === "sync") {
        if (!Array.isArray(body.operations) || !body.operations.length || body.operations.length > 32) throw new HttpError(400, "invalid_batch");
        body.operations.forEach(validateOperation);
        if (body.operations.some((op) => op.session_id !== body.operations[0].session_id)) throw new HttpError(400, "invalid_batch_sessions");
      }
      if (["history.list", "history.coach", "usage.summary"].includes(body.action) && (!/^\d{4}-\d{2}-\d{2}$/.test(body.from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(body.to || "") || body.target_subject != null && (typeof body.target_subject !== "string" || !body.target_subject.trim() || body.target_subject.length > 256))) throw new HttpError(400, "invalid_history_range");
      if (body.action.startsWith("history.") && body.cursor != null && (typeof body.cursor !== "string" || !UUID.test(body.cursor))) throw new HttpError(400, "invalid_cursor");
      if (body.action === "history.detail" && (!UUID.test(body.session_id || "") || !Number.isSafeInteger(body.revision) || body.revision < 1 || !["ends", "arrows"].includes(body.collection))) throw new HttpError(400, "invalid_history_detail");
      if (body.action === "history.coach" && body.scope_hash != null && (typeof body.scope_hash !== "string" || !/^[a-f0-9]{32}$/.test(body.scope_hash))) throw new HttpError(400, "invalid_scope");
      const rpc = async (name, args, maxBytes = 16384) => {
        const headers = { apikey: serverKey, "Content-Type": "application/json" };
        if (serverKey.startsWith("eyJ")) headers.Authorization = `Bearer ${serverKey}`;
        const response = await fetchImpl(`${url}/rest/v1/rpc/${name}`, {
          method: "POST",
          headers,
          body: JSON.stringify(args),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs)
        });
        const result = await readJsonLimited(response.body, maxBytes, timeoutMs);
        if (!response.ok) {
          const status = result?.code === "28000" ? 401 : result?.code === "42501" ? 403 : /^(22|23)/.test(result?.code) ? 422 : 503;
          throw new HttpError(status, status === 401 ? "claim_or_buddy_required" : status === 403 ? "not_owner" : status === 422 ? "operation_rejected" : "server_unavailable");
        }
        if (name === "training_apply_batch") {
          if (!Array.isArray(result?.results) || result.results.length !== args.p_operations.length) throw new HttpError(503, "invalid_server_result");
          return result;
        }
        if (!["accepted", "conflict", "rate_limited", "quota_exceeded", "changed", "gone", "session_pending"].includes(result?.status)) throw new HttpError(503, "invalid_server_result");
        return result;
      };
      let usageEvent = null, location = null;
      if (body.action === "usage.record") {
        const e = body.event;
        if (!e || Array.isArray(e) || typeof e !== "object" || Object.keys(e).some((k) => !["event_id", "browser_id", "kind", "occurred_at", "session_id", "end_id", "proof"].includes(k)) || ![e.event_id, e.browser_id].every((v) => typeof v === "string" && USAGE_UUID.test(v)) || !["history_open", "end_location"].includes(e.kind) || typeof e.occurred_at !== "string" || !Number.isFinite(Date.parse(e.occurred_at)) || e.kind === "end_location" && ![e.session_id, e.end_id].every((v) => typeof v === "string" && USAGE_UUID.test(v)) || e.kind === "history_open" && (e.session_id != null || e.end_id != null)) throw new HttpError(400, "invalid_usage_event");
        try {
          location = await verifyLocation(e.proof, locationSigningSecret);
        } catch (error) {
          throw new HttpError(error.message === "usage_disabled" ? 503 : 400, error.message);
        }
        if (location.event_id !== e.event_id || location.browser_id !== e.browser_id || location.event_kind !== e.kind) throw new HttpError(400, "location_event_mismatch");
        usageEvent = {
          event_id: e.event_id,
          browser_id: e.browser_id,
          kind: e.kind,
          occurred_at: e.occurred_at,
          session_id: e.session_id ?? null,
          end_id: e.end_id ?? null,
          observed_at: location.observed_at,
          city: location.city,
          region: location.region,
          country: location.country
        };
      }
      const buddyToken = request.headers.get("x-buddy-access-token");
      if (buddyToken !== null && (!TOKEN.test(buddyToken) || buddyToken.length > 8192)) throw new HttpError(401, "buddy_session_unverified");
      let identity = null, user;
      if (bearer === publicKey) {
        if (!buddyToken) {
          if (usageEvent?.kind === "history_open") {
            const result = await rpc("training_record_usage", { p_principal: null, p_buddy_subject: null, p_event: usageEvent, p_rate_key: location.rate_key });
            return reply(result.status === "rate_limited" ? 429 : 200, result);
          }
          throw new HttpError(401, "buddy_session_required");
        }
        identity = await verifyBuddyAccessToken(buddyToken, { fetchImpl, timeoutMs, includeProfile: true });
        const id = await resolveBuddyPrincipal(identity.subject, { url, serverKey, fetchImpl, readJson: readJsonLimited, timeoutMs });
        if (!UUID.test(id || "")) throw new HttpError(503, "buddy_bridge_unavailable");
        user = { id };
      } else {
        const auth = await fetchImpl(`${url}/auth/v1/user`, {
          method: "GET",
          headers: { apikey: publicKey, Authorization: `Bearer ${bearer}` },
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!auth.ok) throw new HttpError(auth.status >= 500 ? 503 : 401, "supabase_session_unverified");
        user = await readJsonLimited(auth.body, 16384, timeoutMs);
        if (typeof user?.id !== "string" || !UUID.test(user.id)) throw new HttpError(401, "supabase_session_unverified");
        identity = buddyToken ? await verifyBuddyAccessToken(buddyToken, { fetchImpl, timeoutMs, includeProfile: true }) : null;
      }
      if (usageEvent) {
        const result = await rpc("training_record_usage", { p_principal: user.id, p_buddy_subject: identity?.subject ?? null, p_event: usageEvent, p_rate_key: location.rate_key });
        return reply(result.status === "rate_limited" ? 429 : 200, result);
      }
      if (body.action === "usage.summary") {
        const result = await rpc("training_usage_summary", { p_principal: user.id, p_buddy_subject: identity?.subject ?? null, p_from: body.from, p_to: body.to }, 1048576);
        return reply(result.status === "rate_limited" ? 429 : 200, result);
      }
      if (body.action === "buddy.session") {
        if (!identity) throw new HttpError(401, "buddy_session_required");
        return reply(200, { status: "accepted", principal_id: user.id, subject: identity.subject });
      }
      if (body.action === "claim" && !identity) throw new HttpError(401, "buddy_session_required");
      if (body.action.startsWith("history.")) {
        if (body.action === "history.context") {
          const result2 = await rpc("training_history_context", { p_principal: user.id, p_buddy_subject: identity?.subject ?? null, p_display_name: identity?.displayName ?? null, p_verified_email: identity?.verifiedEmail ?? null });
          return reply(result2.status === "rate_limited" ? 429 : 200, result2);
        }
        if (body.action === "history.coach") {
          const result2 = await rpc("training_coach_overview", { p_principal: user.id, p_buddy_subject: identity?.subject ?? null, p_from: body.from, p_to: body.to, p_after: body.cursor ?? null, p_scope_hash: body.scope_hash ?? null }, 1048576);
          return reply(result2.status === "rate_limited" ? 429 : 200, result2);
        }
        const args = { p_principal: user.id, p_buddy_subject: identity?.subject ?? null, p_after: body.cursor ?? null };
        const result = body.action === "history.list" ? await rpc("training_history_list", { ...args, p_from: body.from, p_to: body.to, p_target_subject: body.target_subject ?? null }, 1048576) : await rpc("training_history_detail", { ...args, p_session: body.session_id, p_revision: body.revision, p_collection: body.collection }, 1048576);
        return reply(result.status === "rate_limited" ? 429 : 200, result, result.status === "rate_limited" ? { "Retry-After": "60" } : {});
      }
      if (body.action === "claim") {
        const proof = crypto.randomUUID();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof))), (b) => b.toString(16).padStart(2, "0")).join("");
        const result = await rpc("training_claim", { p_principal: user.id, p_buddy_subject: identity.subject, p_proof_hash: hash });
        if (result.status === "accepted") try {
          await rpc("training_history_context", { p_principal: user.id, p_buddy_subject: identity.subject, p_display_name: identity.displayName ?? null, p_verified_email: identity.verifiedEmail ?? null });
        } catch {
        }
        return reply(result.status === "rate_limited" ? 429 : 200, result, result.status === "rate_limited" ? { "Retry-After": "60" } : {});
      }
      if (body.operations.length > 1) {
        return reply(200, await rpc("training_apply_batch", { p_principal: user.id, p_buddy_subject: identity?.subject ?? null, p_operations: body.operations }));
      }
      const results = [];
      let stopped = false;
      for (const op of body.operations) {
        if (stopped) {
          results.push({ operation_id: op.operation_id, status: "not_attempted" });
          continue;
        }
        try {
          const result = await rpc("training_apply_operation", { p_principal: user.id, p_buddy_subject: identity?.subject ?? null, p_operation: op });
          results.push({ operation_id: op.operation_id, ...result });
          stopped = result.status !== "accepted";
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          if ([401, 403, 503].includes(error.status)) {
            results.push({ operation_id: op.operation_id, status: "retry_or_auth_required", code: error.code });
          } else results.push({ operation_id: op.operation_id, status: "rejected", code: error.code });
          stopped = true;
        }
      }
      return reply(200, { results });
    } catch (error) {
      if (error instanceof BuddyIdentityError) return reply(401, { error: "buddy_session_unverified" });
      if (error instanceof HttpError) return reply(error.status, { error: error.code });
      return reply(503, { error: "server_unavailable" });
    }
  };
}

// supabase/functions/training-sync/index.ts
Deno.serve(createTrainingHandler({
  url: Deno.env.get("SUPABASE_URL"),
  locationSigningSecret: Deno.env.get("TRAINING_LOCATION_SIGNING_SECRET"),
  publicKey: Deno.env.get("TRAINING_PUBLIC_KEY"),
  serverKey: Deno.env.get("TRAINING_SERVER_KEY"),
  allowedOrigins: (Deno.env.get("TRAINING_ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  enabled: Deno.env.get("TRAINING_SYNC_ENABLED") === "true"
}));
