// PlatformKit registry datum/redeemer codec — Plutus Data (Lucid Evolution).
//
// PHẢI khớp byte-perfect với onchain platform.ak. Constr index = thứ tự khai báo
// (Aiken đánh số constructor từ 0 theo thứ tự xuất hiện).
//
//   PlatformStatus: Active=Constr(0,[]), Paused=Constr(1,[]), Retired=Constr(2,[])
//   PlatformEntry = Constr(0, [
//       platform_id:bytes, instance_id:bytes, custody_hash:bytes, seed_policy:bytes,
//       governance_ref:bytes, accepted_assets:List<AssetKey>, cut_bps:int,
//       created_epoch:int, status:PlatformStatus ])
//   RegisterPlatform = Constr(0, [])   (RegistryBeaconRedeemer)
//   UpdateEntry      = Constr(0, [])   (RegistryRedeemer)
//
// TÁI DÙNG encode/decodeAssetKey từ Treasury datum.ts (cùng codec AssetKey, byte-perfect).
// Dùng duck-type Constr (asConstr) để robust với 2 bản @lucid-evolution/lucid khác class.

import { Constr, Data } from "@lucid-evolution/lucid";
import type { AssetKey, PlatformEntry, PlatformStatus } from "./types.js";

// ── AssetKey codec — MIRROR y hệt Treasury datum.ts (byte-perfect) ──────────
// KHÔNG import encodeAssetKey từ Treasury: Treasury dựng Constr bằng BẢN lucid của nó;
// PlatformKit dùng BẢN lucid riêng → Data.to(...) không nhận ra Constr "lạ class"
// ("Unsupported type"). Mirror tại đây để Constr cùng class với Data.to của PlatformKit.
// Constr(0, [policy:bytes, name:bytes]) — khớp AssetKey on-chain + Treasury.
function encodeAssetKey(a: AssetKey): Constr<Data> {
  return new Constr(0, [normHex(a.policy), normHex(a.name)]);
}

function decodeAssetKey(d: Data): AssetKey {
  const c = asConstr(d, "AssetKey");
  if (c.index !== 0) throw new Error(`RDATUM-005: AssetKey expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 2) throw new Error(`RDATUM-006: AssetKey expects 2 fields, got ${c.fields.length}`);
  return {
    policy: asBytes(c.fields[0]!, "AssetKey.policy"),
    name:   asBytes(c.fields[1]!, "AssetKey.name"),
  };
}

// ── Redeemer constructor index map (mirror platform.ak) ────────────────────
export const REGISTRY_BEACON_REDEEMER = {
  RegisterPlatform: 0,
} as const;

export const REGISTRY_REDEEMER = {
  UpdateEntry: 0,
} as const;

// ── PlatformStatus index map (theo thứ tự khai báo platform.ak) ────────────
export const PLATFORM_STATUS = {
  Active:  0,
  Paused:  1,
  Retired: 2,
} as const;

const STATUS_BY_INDEX: PlatformStatus[] = ["Active", "Paused", "Retired"];

// ── helpers (mirror Treasury datum.ts — duck-type Constr) ──────────────────

/** Strip leading `0x` + lowercase (Plutus bytes là hex trần). */
function normHex(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return h.toLowerCase();
}

function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  // Robust với 2 bản @lucid-evolution/lucid (khác class identity) — duck-type.
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`RDATUM-000: expected Constr for ${ctx}`);
}

function asBytes(d: Data, ctx: string): string {
  if (typeof d !== "string") throw new Error(`RDATUM-001: expected bytes for ${ctx}`);
  return d;
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`RDATUM-002: expected int for ${ctx}`);
  return d;
}

function asList(d: Data, ctx: string): Data[] {
  if (!Array.isArray(d)) throw new Error(`RDATUM-003: expected list for ${ctx}`);
  return d;
}

// ── PlatformStatus ─────────────────────────────────────────────────────────
// Active=Constr(0,[]), Paused=Constr(1,[]), Retired=Constr(2,[])

export function encodePlatformStatus(s: PlatformStatus): Constr<Data> {
  return new Constr(PLATFORM_STATUS[s], []);
}

export function decodePlatformStatus(d: Data): PlatformStatus {
  const c = asConstr(d, "PlatformStatus");
  if (c.fields.length !== 0) {
    throw new Error(`RDATUM-010: PlatformStatus expects 0 fields, got ${c.fields.length}`);
  }
  const s = STATUS_BY_INDEX[c.index];
  if (s === undefined) throw new Error(`RDATUM-011: PlatformStatus unknown Constr ${c.index}`);
  return s;
}

// ── PlatformEntry ────────────────────────────────────────────────────────
// Constr(0, [platform_id, instance_id, custody_hash, seed_policy, governance_ref,
//            accepted_assets:List, cut_bps:int, created_epoch:int, status])

export function encodePlatformEntry(e: PlatformEntry): Constr<Data> {
  return new Constr(0, [
    normHex(e.platform_id),
    normHex(e.instance_id),
    normHex(e.custody_hash),
    normHex(e.seed_policy),
    normHex(e.governance_ref),
    e.accepted_assets.map(encodeAssetKey),
    e.cut_bps,
    e.created_epoch,
    encodePlatformStatus(e.status),
  ]);
}

export function decodePlatformEntry(d: Data): PlatformEntry {
  const c = asConstr(d, "PlatformEntry");
  if (c.index !== 0) throw new Error(`RDATUM-020: PlatformEntry expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 9) {
    throw new Error(`RDATUM-021: PlatformEntry expects 9 fields, got ${c.fields.length}`);
  }
  const accepted: AssetKey[] = asList(c.fields[5]!, "PlatformEntry.accepted_assets").map(decodeAssetKey);
  return {
    platform_id:     asBytes(c.fields[0]!, "PlatformEntry.platform_id"),
    instance_id:     asBytes(c.fields[1]!, "PlatformEntry.instance_id"),
    custody_hash:    asBytes(c.fields[2]!, "PlatformEntry.custody_hash"),
    seed_policy:     asBytes(c.fields[3]!, "PlatformEntry.seed_policy"),
    governance_ref:  asBytes(c.fields[4]!, "PlatformEntry.governance_ref"),
    accepted_assets: accepted,
    cut_bps:         asInt(c.fields[6]!, "PlatformEntry.cut_bps"),
    created_epoch:   asInt(c.fields[7]!, "PlatformEntry.created_epoch"),
    status:          decodePlatformStatus(c.fields[8]!),
  };
}

export function platformEntryToCbor(e: PlatformEntry): string {
  return Data.to(encodePlatformEntry(e));
}

export function platformEntryFromCbor(cbor: string): PlatformEntry {
  return decodePlatformEntry(Data.from(cbor));
}

// ── Redeemers ──────────────────────────────────────────────────────────────
// RegisterPlatform = Constr(0, []) ; UpdateEntry = Constr(0, []).

export function encodeRegisterPlatformRedeemer(): Constr<Data> {
  return new Constr(REGISTRY_BEACON_REDEEMER.RegisterPlatform, []);
}

export function registerPlatformRedeemerToCbor(): string {
  return Data.to(encodeRegisterPlatformRedeemer());
}

export function encodeUpdateEntryRedeemer(): Constr<Data> {
  return new Constr(REGISTRY_REDEEMER.UpdateEntry, []);
}

export function updateEntryRedeemerToCbor(): string {
  return Data.to(encodeUpdateEntryRedeemer());
}
