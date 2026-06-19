// PlatformKit collectAdapter — cầu nối CHUNG sự kiện platform → Treasury Collect.
//
// Mỗi platform phát sinh "sự kiện chịu phí" (FeeEvent). Adapter dịch event → CollectItem
// (khớp Treasury collectBuilder) qua hàm định giá PLUGGABLE do platform cấp. Treasury KHÔNG
// định giá — amount đã được app tính. Adapter chỉ: (1) gọi priceFn → amount + asset +
// category (bucket đích cut); (2) gói thành CollectItem; (3) gọi Treasury buildCollectTx.
//
// PLUGGABLE: priceFn nhận FeeEvent → PricedItem. Mỗi platform định nghĩa pricing riêng
// (xem examples/: phí cố định theo sự kiện, value-based theo giá trị, ... — tùy platform).
// Adapter trung lập với chính sách giá — chỉ điều phối.

import type { CollectItem } from "../../../Treasury/offchain/src/types.js";
import type { AssetKey } from "./types.js";

function normHex(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return h.toLowerCase();
}

/**
 * Một sự kiện chịu phí phía platform (trung lập domain).
 * eventType định danh loại sự kiện (vd "createDID", "animal.enroll"). payer là app_id (hex)
 * — AI trả. extra mang ngữ cảnh định giá (declaredValue, species, ...) để priceFn dùng.
 */
export interface FeeEvent {
  /** Loại sự kiện — khóa định giá (priceFn switch theo đây). */
  eventType: string;
  /** app_id (hex) — ai trả phí (= CollectItem.app_id). */
  payer: string;
  /** Ngữ cảnh định giá tuỳ platform (declaredValueUsd, species, lifecycleEvents, ...). */
  extra?: Record<string, unknown>;
}

/**
 * Kết quả định giá 1 event: asset + amount + bucket đích cut.
 * priceFn trả về cái này; adapter gói thành CollectItem.
 */
export interface PricedItem {
  /** Asset thu (policy/name hex; ADA = {policy:"",name:""}). */
  asset: AssetKey;
  /** Số đã định giá (đơn vị nhỏ nhất: lovelace / nanogic / oil). BigInt — không Number. */
  amount: bigint;
  /** bucket_id đích cho phần cut (= CollectItem.category). */
  bucketCategory: bigint;
}

/** Hàm định giá PLUGGABLE — platform cấp. Trả null = event KHÔNG thu phí (bỏ qua). */
export type PriceFn = (event: FeeEvent) => PricedItem | null;

/**
 * Dịch 1 FeeEvent → CollectItem (hoặc null nếu priceFn bỏ qua).
 * CollectItem = { app_id, policy, name, amount, category } (mirror Treasury types.ts).
 */
export function eventToCollectItem(event: FeeEvent, priceFn: PriceFn): CollectItem | null {
  const priced = priceFn(event);
  if (priced === null) return null;
  if (priced.amount < 0n) {
    throw new Error(`COLLECT-ADAPTER: amount âm cho event '${event.eventType}' (${priced.amount})`);
  }
  return {
    app_id:   normHex(event.payer),
    policy:   normHex(priced.asset.policy),
    name:     normHex(priced.asset.name),
    amount:   priced.amount,
    category: priced.bucketCategory,
  };
}

/** Dịch một lô FeeEvent → CollectItem[] (lọc bỏ event priceFn trả null). */
export function eventsToCollectItems(events: FeeEvent[], priceFn: PriceFn): CollectItem[] {
  const out: CollectItem[] = [];
  for (const ev of events) {
    const item = eventToCollectItem(ev, priceFn);
    if (item !== null) out.push(item);
  }
  return out;
}

// ── Cầu nối tới Treasury collectBuilder ──────────────────────────────────────
// buildCollectFromEvents: lô event → CollectItem[] → buildCollectTx (Treasury).
// Import động collectBuilder để giữ adapter thuần khi chỉ cần eventsToCollectItems trong test.

import type {
  CollectParams, CollectResult,
} from "../../../Treasury/offchain/src/collectBuilder.js";

/** Tham số build collect từ events (mọi tham số tx của Treasury trừ items — adapter sinh items). */
export type CollectFromEventsParams = Omit<CollectParams, "items"> & {
  events: FeeEvent[];
  priceFn: PriceFn;
};

/**
 * Build tx collect từ một lô FeeEvent: priceFn định giá → CollectItem[] → Treasury buildCollectTx.
 * Trả CollectResult của Treasury (tx + cutValue + newDatum + custodyAfter + summary).
 */
export async function buildCollectFromEvents(
  params: CollectFromEventsParams,
): Promise<CollectResult> {
  const { events, priceFn, ...txParams } = params;
  const items = eventsToCollectItems(events, priceFn);
  // Import động — chỉ nạp builder (cần lucid) khi build tx thật.
  const { buildCollectTx } = await import("../../../Treasury/offchain/src/collectBuilder.js");
  return buildCollectTx({ ...txParams, items });
}
