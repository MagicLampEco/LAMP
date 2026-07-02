// server.ts — MagicLamp Launch API server.
//
// Routes:
//   PUBLIC (3 consumer đọc):
//     GET  /v1/campaigns                    list (filter: status, mechanism)
//     GET  /v1/campaigns/:id                single campaign
//     GET  /v1/campaigns/:id/phases         phases of campaign
//     GET  /v1/campaigns/:id/stats          live stats
//     GET  /events                          SSE stream (real-time updates)
//
//   ADMIN (MagicLamp team):
//     POST /admin/campaigns                 create campaign
//     PUT  /admin/campaigns/:id             full replace
//     PATCH /admin/campaigns/:id            partial update (+ auto-push)
//     PUT  /admin/campaigns/:id/stats       update stats (+ auto-push)
//     POST /admin/campaigns/:id/push        manual trigger push to all targets
//
// Auth: admin routes cần header  Authorization: Bearer <ADMIN_TOKEN>
// CORS: affiso.net, magiclamp.network, superapp (configurable)

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  listCampaigns, getCampaign, upsertCampaign, patchCampaign, updateStats,
} from "./content.js";
import {
  pushAll, verifyWebhookSignature, registerSseClient, unregisterSseClient, broadcastSse,
} from "./push.js";
import type { AdminUpdateRequest, ApiResponse, LaunchCampaign, LaunchStats } from "./types.js";
import { etdCheck } from "./etd.js";

const PORT = parseInt(process.env.PORT ?? "3210", 10);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "https://affiso.net,https://magiclamp.network")
  .split(",").map((s) => s.trim());

// ── Helpers ──────────────────────────────────────────────────────────────────

function cors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin ?? "";
  const allowed = ALLOWED_ORIGINS.some((o) => origin === o || origin.endsWith(o.replace("https://", ".")));
  if (allowed || origin === "") {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
}

function json<T>(res: ServerResponse, data: ApiResponse<T>, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function err(res: ServerResponse, msg: string, status = 400): void {
  json(res, { ok: false, error: msg }, status);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "null")); } catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
  if (!ADMIN_TOKEN) return true; // dev mode: no auth
  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${ADMIN_TOKEN}`) {
    err(res, "unauthorized", 401);
    return false;
  }
  return true;
}

// ── Router ───────────────────────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method ?? "GET";

  cors(req, res);
  if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── SSE ───────────────────────────────────────────────────────────────────
  if (path === "/events" && method === "GET") {
    const campaignFilter = url.searchParams.get("campaign_id");
    const id = randomUUID();

    res.writeHead(200, {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`: connected ${id}\n\n`);

    const client = {
      id,
      campaignFilter,
      send: (data: string) => res.write(data),
      close: () => res.end(),
    };
    registerSseClient(client);

    const heartbeat = setInterval(() => {
      try { res.write(`:ping\n\n`); }
      catch { clearInterval(heartbeat); unregisterSseClient(id); }
    }, 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unregisterSseClient(id);
    });
    return;
  }

  // ── PUBLIC: /v1/launch/etd/check ──────────────────────────────────────────
  // Trang ETD: dán địa chỉ → lịch sử stake + lọc epoch TIGER + LAMP sẽ nhận.
  if (path === "/v1/launch/etd/check" && method === "GET") {
    const address = url.searchParams.get("address") ?? "";
    if (!address) return err(res, "thiếu ?address=", 400);
    try {
      const data = await etdCheck(address);
      return json(res, { ok: true, data });
    } catch (e) {
      return err(res, e instanceof Error ? e.message : "etd check lỗi", 502);
    }
  }

  // ── PUBLIC: /v1/campaigns ─────────────────────────────────────────────────

  if (path === "/v1/campaigns" && method === "GET") {
    const campaigns = await listCampaigns({
      status: url.searchParams.get("status") ?? undefined,
      mechanism: url.searchParams.get("mechanism") ?? undefined,
    });
    // Không expose push_targets (private webhook URLs) ra public
    const safe = campaigns.map(({ push_targets: _, ...c }) => c);
    return json(res, { ok: true, data: safe });
  }

  const campaignMatch = path.match(/^\/v1\/campaigns\/([^/]+)(?:\/(.+))?$/);
  if (campaignMatch && method === "GET") {
    const id = campaignMatch[1]!;
    const sub = campaignMatch[2];
    const c = await getCampaign(id);
    if (!c) return err(res, "campaign not found", 404);
    const { push_targets: _, ...safe } = c;

    if (sub === "phases") return json(res, { ok: true, data: safe.phases });
    if (sub === "stats")  return json(res, { ok: true, data: safe.stats ?? null });
    if (!sub)             return json(res, { ok: true, data: safe });
    return err(res, "not found", 404);
  }

  // ── ADMIN: /admin/* ───────────────────────────────────────────────────────

  if (path.startsWith("/admin/")) {
    if (!requireAdmin(req, res)) return;

    // POST /admin/campaigns — create
    if (path === "/admin/campaigns" && method === "POST") {
      const body = await readBody(req) as LaunchCampaign;
      if (!body?.id) return err(res, "missing id");
      const saved = await upsertCampaign({ ...body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return json(res, { ok: true, data: saved }, 201);
    }

    const adminMatch = path.match(/^\/admin\/campaigns\/([^/]+)(?:\/(.+))?$/);
    if (adminMatch) {
      const id = adminMatch[1]!;
      const sub = adminMatch[2];

      // PUT /admin/campaigns/:id — full replace
      if (!sub && method === "PUT") {
        const body = await readBody(req) as LaunchCampaign;
        if (!body?.id) return err(res, "missing id");
        const saved = await upsertCampaign({ ...body, id });
        const push = await pushAll(saved, "campaign.updated");
        broadcastSse({ event: "campaign.updated", campaign_id: id, campaign: saved, timestamp: new Date().toISOString() });
        return json(res, { ok: true, data: { campaign: saved, push } });
      }

      // PATCH /admin/campaigns/:id — partial update
      if (!sub && method === "PATCH") {
        const body = await readBody(req) as AdminUpdateRequest;
        const updated = await patchCampaign(id, body.campaign ?? {});
        if (!updated) return err(res, "not found", 404);
        const event = body.event ?? "campaign.updated";
        const push = await pushAll(updated, event, body.changed_fields);
        broadcastSse({ event, campaign_id: id, campaign: updated, changed_fields: body.changed_fields, timestamp: new Date().toISOString() });
        return json(res, { ok: true, data: { campaign: updated, push } });
      }

      // PUT /admin/campaigns/:id/stats — update stats
      if (sub === "stats" && method === "PUT") {
        const body = await readBody(req) as LaunchStats;
        const updated = await updateStats(id, body);
        if (!updated) return err(res, "not found", 404);
        const push = await pushAll(updated, "stats.updated");
        broadcastSse({ event: "stats.updated", campaign_id: id, campaign: updated, timestamp: new Date().toISOString() });
        return json(res, { ok: true, data: { stats: body, push } });
      }

      // POST /admin/campaigns/:id/push — manual push
      if (sub === "push" && method === "POST") {
        const c = await getCampaign(id);
        if (!c) return err(res, "not found", 404);
        const body = await readBody(req) as { event?: PushPayload["event"] } | null;
        const event = (body as { event?: PushPayload["event"] } | null)?.event ?? "campaign.updated";
        const push = await pushAll(c, event);
        broadcastSse({ event, campaign_id: id, campaign: c, timestamp: new Date().toISOString() });
        return json(res, { ok: true, data: push });
      }
    }

    return err(res, "admin route not found", 404);
  }

  // ── Health ────────────────────────────────────────────────────────────────
  if (path === "/health") {
    return json(res, { ok: true, data: { status: "ok", ts: new Date().toISOString() } });
  }

  err(res, "not found", 404);
}

// ── Start ─────────────────────────────────────────────────────────────────────

import type { PushPayload } from "./types.js";

const server = createServer((req, res) => {
  handleRequest(req, res).catch((e) => {
    console.error("[server] unhandled:", e);
    if (!res.headersSent) err(res, "internal error", 500);
  });
});

server.listen(PORT, () => {
  console.log(`[launch-api] listening on port ${PORT}`);
  console.log(`  Public:  GET http://localhost:${PORT}/v1/campaigns`);
  console.log(`  Admin:   POST http://localhost:${PORT}/admin/campaigns  (Bearer ${ADMIN_TOKEN ? "***" : "dev-no-auth"})`);
  console.log(`  SSE:     GET http://localhost:${PORT}/events`);
});
