// LampDistribution datum/redeemer codec — Plutus Data (Lucid Evolution).
// CONTRACT v2 "Capped Drop". PHẢI khớp byte-perfect với onchain `types.ak`.
// Constr index = thứ tự khai báo trong types.ak (Aiken đánh số constructor từ 0).
//
//   ClaimAccountDatum{owner, entitlement, redeemed, start_epoch, drops_per_epoch}
//     = Constr(0, [bytes, int, int, int, int])
//
//   ClaimAccountRedeemer:
//     Claim { amount } = Constr(0, [int])
//     Redeem           = Constr(1, [])        // tất định: user tự tính vested on-chain
//
//   BeaconKind:  DropParam = Constr(0, [])
//   BeaconDatum{epoch, kind, drop_value} = Constr(0, [int, kind, int])
//   BeaconRedeemer: PostBeacon            = Constr(0, [])
//
//   TreasuryDatum{committee_hash, outstanding_entitlement} = Constr(0, [bytes, int])
//   TreasuryRedeemer:
//     ReleaseForRedeem = Constr(0, [])   // redeem: pool ↓ và sổ cái nợ ↓ (đi cặp)
//     GrantEntitlement = Constr(1, [])   // claim: pool bất biến, nợ += granted ≤ pool
//     Refill           = Constr(2, [])   // gộp N UTxO kho → 1 + nạp thêm LAMP (committee)

import { Constr, Data } from "@lucid-evolution/lucid";
import type { BeaconDatum, BeaconKind, ClaimAccountDatum, TreasuryDatum } from "./types.js";

// ── Constructor index map (mirror types.ak declaration order) ──────────

/** ClaimAccountRedeemer variants. */
export const CLAIM_ACCOUNT_REDEEMER = { Claim: 0, Redeem: 1 } as const;

/** BeaconKind variants (DropParam only ở v2). */
export const BEACON_KIND_INDEX: Record<BeaconKind, number> = {
  DropParam: 0,
};

const BEACON_KIND_FROM_INDEX: Record<number, BeaconKind> = {
  0: "DropParam",
};

// ── helpers ────────────────────────────────────────────────────────────

/** Strip leading `0x` and lowercase a hex string (Plutus bytes are bare hex). */
function normHex(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return h.toLowerCase();
}

/**
 * Robust với trường hợp có 2 bản @lucid-evolution/lucid khác nhau (offchain vs scripts):
 * `instanceof` fail vì khác class identity, dù object đúng cấu trúc Constr {index, fields}.
 * Duck-type theo {index:number, fields:[]}.
 */
function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`DATUM-000: expected Constr for ${ctx}`);
}

function asBytes(d: Data, ctx: string): string {
  if (typeof d !== "string") throw new Error(`DATUM-001: expected bytes for ${ctx}`);
  return d;
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`DATUM-002: expected int for ${ctx}`);
  return d;
}

// ── BeaconKind ─────────────────────────────────────────────────────────

export function encodeBeaconKind(kind: BeaconKind): Constr<Data> {
  return new Constr(BEACON_KIND_INDEX[kind], []);
}

export function decodeBeaconKind(d: Data): BeaconKind {
  const c = asConstr(d, "BeaconKind");
  if (c.fields.length !== 0) throw new Error("DATUM-010: BeaconKind takes no fields");
  const kind = BEACON_KIND_FROM_INDEX[c.index];
  if (kind === undefined) throw new Error(`DATUM-011: unknown BeaconKind index ${c.index}`);
  return kind;
}

// ── ClaimAccountDatum ──────────────────────────────────────────────────
// Constr(0, [owner:bytes, entitlement:int, redeemed:int, start_epoch:int, drops_per_epoch:int])

export function encodeClaimAccountDatum(d: ClaimAccountDatum): Constr<Data> {
  return new Constr(0, [
    normHex(d.owner),
    d.entitlement,
    d.redeemed,
    d.start_epoch,
    d.drops_per_epoch,
  ]);
}

export function decodeClaimAccountDatum(d: Data): ClaimAccountDatum {
  const c = asConstr(d, "ClaimAccountDatum");
  if (c.index !== 0) throw new Error(`DATUM-020: ClaimAccountDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 5) throw new Error(`DATUM-021: ClaimAccountDatum expects 5 fields, got ${c.fields.length}`);
  return {
    owner:           asBytes(c.fields[0]!, "owner"),
    entitlement:     asInt(c.fields[1]!, "entitlement"),
    redeemed:        asInt(c.fields[2]!, "redeemed"),
    start_epoch:     asInt(c.fields[3]!, "start_epoch"),
    drops_per_epoch: asInt(c.fields[4]!, "drops_per_epoch"),
  };
}

/** CBOR datum hex string (inline datum). */
export function claimAccountDatumToCbor(d: ClaimAccountDatum): string {
  return Data.to(encodeClaimAccountDatum(d));
}

export function claimAccountDatumFromCbor(cbor: string): ClaimAccountDatum {
  return decodeClaimAccountDatum(Data.from(cbor));
}

// ── ClaimAccountRedeemer ───────────────────────────────────────────────

/** Claim { amount } = Constr(0, [int]). */
export function encodeClaimRedeemer(amount: bigint): Constr<Data> {
  return new Constr(CLAIM_ACCOUNT_REDEEMER.Claim, [amount]);
}

/** Redeem = Constr(1, []) — tất định, không field (user tự tính vested on-chain). */
export function encodeRedeemRedeemer(): Constr<Data> {
  return new Constr(CLAIM_ACCOUNT_REDEEMER.Redeem, []);
}

export function claimRedeemerToCbor(amount: bigint): string {
  return Data.to(encodeClaimRedeemer(amount));
}

export function redeemRedeemerToCbor(): string {
  return Data.to(encodeRedeemRedeemer());
}

// ── BeaconDatum ────────────────────────────────────────────────────────
// Constr(0, [epoch:int, kind:BeaconKind, drop_value:int])

export function encodeBeaconDatum(d: BeaconDatum): Constr<Data> {
  return new Constr(0, [d.epoch, encodeBeaconKind(d.kind), d.drop_value]);
}

export function decodeBeaconDatum(d: Data): BeaconDatum {
  const c = asConstr(d, "BeaconDatum");
  if (c.index !== 0) throw new Error(`DATUM-030: BeaconDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 3) throw new Error(`DATUM-031: BeaconDatum expects 3 fields, got ${c.fields.length}`);
  return {
    epoch:      asInt(c.fields[0]!, "epoch"),
    kind:       decodeBeaconKind(c.fields[1]!),
    drop_value: asInt(c.fields[2]!, "drop_value"),
  };
}

export function beaconDatumToCbor(d: BeaconDatum): string {
  return Data.to(encodeBeaconDatum(d));
}

export function beaconDatumFromCbor(cbor: string): BeaconDatum {
  return decodeBeaconDatum(Data.from(cbor));
}

/** BeaconRedeemer: PostBeacon = Constr(0, []). */
export function encodeBeaconRedeemer(): Constr<Data> {
  return new Constr(0, []);
}

export function beaconRedeemerToCbor(): string {
  return Data.to(encodeBeaconRedeemer());
}

// ── TreasuryDatum ──────────────────────────────────────────────────────
// Constr(0, [committee_hash:bytes, outstanding_entitlement:int])

export function encodeTreasuryDatum(d: TreasuryDatum): Constr<Data> {
  return new Constr(0, [normHex(d.committee_hash), d.outstanding_entitlement]);
}

export function decodeTreasuryDatum(d: Data): TreasuryDatum {
  const c = asConstr(d, "TreasuryDatum");
  if (c.index !== 0) throw new Error(`DATUM-040: TreasuryDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 2) throw new Error(`DATUM-041: TreasuryDatum expects 2 fields, got ${c.fields.length}`);
  return {
    committee_hash:         asBytes(c.fields[0]!, "committee_hash"),
    outstanding_entitlement: asInt(c.fields[1]!, "outstanding_entitlement"),
  };
}

export function treasuryDatumToCbor(d: TreasuryDatum): string {
  return Data.to(encodeTreasuryDatum(d));
}

export function treasuryDatumFromCbor(cbor: string): TreasuryDatum {
  return decodeTreasuryDatum(Data.from(cbor));
}

/**
 * TreasuryRedeemer variants (mirror types.ak declaration order).
 *
 * `Refill` = 2 vì nó được khai CUỐI trong `types.ak` (chủ ý: giữ nguyên index 0/1 của hai
 * redeemer cũ mà offchain đang neo theo). Thiếu nó thì SDK KHÔNG dựng nổi tx nạp LAMP vào
 * kho — mà không redeemer nào khác làm pool TĂNG, nên tổng cấp phát suốt vòng đời sẽ bị
 * chặn cứng ở số dư genesis và LAMP rót về kho qua A-DEST nằm chết tại địa chỉ script.
 */
export const TREASURY_REDEEMER = {
  ReleaseForRedeem: 0,
  GrantEntitlement: 1,
  Refill:           2,
} as const;

/** TreasuryRedeemer: ReleaseForRedeem = Constr(0, []). */
export function encodeTreasuryRedeemer(): Constr<Data> {
  return new Constr(TREASURY_REDEEMER.ReleaseForRedeem, []);
}

export function treasuryRedeemerToCbor(): string {
  return Data.to(encodeTreasuryRedeemer());
}

/** TreasuryRedeemer: GrantEntitlement = Constr(1, []) — Claim cấp E co-spend treasury. */
export function encodeGrantEntitlementRedeemer(): Constr<Data> {
  return new Constr(TREASURY_REDEEMER.GrantEntitlement, []);
}

export function grantEntitlementRedeemerToCbor(): string {
  return Data.to(encodeGrantEntitlementRedeemer());
}

/**
 * TreasuryRedeemer: Refill = Constr(2, []) — gộp N ≥ 1 UTxO ở địa chỉ kho vào ĐÚNG 1
 * output + cho phép nạp thêm LAMP (committee ký). Đây là đường DUY NHẤT làm pool TĂNG.
 */
export function encodeRefillRedeemer(): Constr<Data> {
  return new Constr(TREASURY_REDEEMER.Refill, []);
}

export function refillRedeemerToCbor(): string {
  return Data.to(encodeRefillRedeemer());
}
