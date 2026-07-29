// push.ts — Webhook push tới 3 consumer: affiso, magiclamp-network, superapp.
//
// Mỗi lần admin update campaign → pushAll() → gửi POST tới mọi push_target.
// Payload ký HMAC-SHA256 (header X-Launch-Signature: sha256=<hex>).
// Consumer verify chữ ký trước khi xử lý để chặn fake push.

import { createHmac } from "node:crypto";
import type { LaunchCampaign, PushPayload, PushTarget } from "./types.js";

const PUSH_TIMEOUT_MS = 8_000;

// Ngoài webhook_secret per-target, cũng cho phép global env var.
const GLOBAL_SIGNING_SECRET = process.env.LAUNCH_SIGNING_SECRET ?? "";

function sign(payload: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

async function pushOne(target: PushTarget, payload: PushPayload): Promise<{
  name: string;
  ok: boolean;
  status?: number;
  error?: string;
}> {
  if (!target.enabled) return { name: target.name, ok: true };

  const body = JSON.stringify(payload);
  const secret = target.webhook_secret || GLOBAL_SIGNING_SECRET;
  const sig = secret ? sign(body, secret) : "";

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), PUSH_TIMEOUT_MS);
    const res = await fetch(target.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Launch-Event": payload.event,
        "X-Launch-Campaign": payload.campaign_id,
        ...(sig ? { "X-Launch-Signature": sig } : {}),
      },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    return { name: target.name, ok: res.ok, status: res.status };
  } catch (e) {
    return { name: target.name, ok: false, error: String(e) };
  }
}

export interface PushResult {
  campaign_id: string;
  event: PushPayload["event"];
  results: { name: string; ok: boolean; status?: number; error?: string }[];
}

/** Push cùng payload đến tất cả push_targets của campaign song song. */
export async function pushAll(
  campaign: LaunchCampaign,
  event: PushPayload["event"],
  changedFields?: string[],
): Promise<PushResult> {
  const targets = campaign.push_targets ?? [];

  // BỎ `push_targets` khỏi payload: nó chứa URL + webhook_secret của TẤT CẢ
  // consumer. Gửi nguyên đi thì consumer A đọc được secret của B và C, rồi ký
  // giả `X-Launch-Signature` tới họ. Mỗi target nhận đúng phần công khai.
  const { push_targets: _drop, ...publicCampaign } = campaign;
  const payload: PushPayload = {
    event,
    campaign_id: campaign.id,
    campaign: publicCampaign as typeof campaign,
    changed_fields: changedFields,
    timestamp: new Date().toISOString(),
  };

  const results = await Promise.all(targets.map((t) => pushOne(t, payload)));

  results.forEach((r) => {
    if (!r.ok) {
      console.error(`[push] FAIL ${r.name}: ${r.error ?? r.status}`);
    } else {
      console.log(`[push] OK   ${r.name}${r.status ? ` (${r.status})` : ""}`);
    }
  });

  return { campaign_id: campaign.id, event, results };
}

/** Verify chữ ký webhook (dùng ở consumer side để xác thực push từ LaunchAPI). */
export function verifyWebhookSignature(
  body: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = sign(body, secret);
  // Constant-time comparison
  if (expected.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return diff === 0;
}

// ── SSE (Server-Sent Events) cho real-time client subscriptions ─────────────
// Consumer (frontend) connect: GET /events?campaign_id=<id>
// Server push khi có update.

type SseClient = {
  id: string;
  campaignFilter: string | null;
  send: (data: string) => void;
  close: () => void;
};

const sseClients = new Map<string, SseClient>();

export function registerSseClient(client: SseClient): void {
  sseClients.set(client.id, client);
}

export function unregisterSseClient(id: string): void {
  sseClients.delete(id);
}

export function broadcastSse(payload: PushPayload): void {
  for (const client of sseClients.values()) {
    if (!client.campaignFilter || client.campaignFilter === payload.campaign_id) {
      try {
        client.send(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        sseClients.delete(client.id);
      }
    }
  }
}
