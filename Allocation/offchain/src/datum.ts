// LAMP Allocation datum/redeemer codec — Plutus Data (Lucid Evolution).
// HARD-CAP per-channel. PHẢI khớp BYTE-PERFECT với onchain `types.ak`.
// Constr index = thứ tự khai báo trong types.ak (Aiken đánh số constructor từ 0).
// Field order = thứ tự khai báo trong record (sai = tx fail on-chain).
//
//   ── DATUM ──────────────────────────────────────────────────────────────
//   ClaimAccountDatum{owner, entitlement, redeemed, start_epoch, drops_per_epoch, channel_id}
//     = Constr(0, [bytes, int, int, int, int, bytes])    ← channel_id field CUỐI
//   ChannelBudgetDatum{channel_id, remaining_oil}
//     = Constr(0, [bytes, int])
//   TreasuryDatum{committee_hash, channel_id}
//     = Constr(0, [bytes, bytes])
//
//   ── REDEEMER ───────────────────────────────────────────────────────────
//   ClaimAccountRedeemer:  Claim{amount}=Constr(0,[int]);  Redeem=Constr(1,[])
//   ChannelBudgetRedeemer: Decrement{amount}=Constr(0,[int])
//   TreasuryRedeemer:      ReleaseForRedeem=Constr(0,[])
//   BudgetNftRedeemer:     MintGenesis=Constr(0,[])
//
// Duck-type Constr (như Distribution/Genesis datum.ts): tránh lỗi `instanceof` khi
// có 2 bản @lucid-evolution/lucid khác class identity (offchain vs scripts).

import { Constr, Data } from "@lucid-evolution/lucid";
import type {
  ChannelBudgetDatum, ClaimAccountDatum, TreasuryDatum,
} from "./types.js";

// ── Constructor index map (mirror types.ak declaration order) ──────────
export const CLAIM_ACCOUNT_REDEEMER = { Claim: 0, Redeem: 1 } as const;
export const CHANNEL_BUDGET_REDEEMER = { Decrement: 0 } as const;

// ── helpers ────────────────────────────────────────────────────────────

/** Strip leading `0x` + lowercase (Plutus bytes là hex trần). */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

/** Duck-type {index:number, fields:[]} — robust qua 2 bản lucid khác class. */
function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`TDATUM-000: expected Constr for ${ctx}`);
}

function asBytes(d: Data, ctx: string): string {
  if (typeof d !== "string") throw new Error(`TDATUM-001: expected bytes for ${ctx}`);
  return d;
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`TDATUM-002: expected int for ${ctx}`);
  return d;
}

// ── ClaimAccountDatum ───────────────────────────────────────────────────
// Constr(0, [owner:bytes, entitlement:int, redeemed:int, start_epoch:int,
//            drops_per_epoch:int, channel_id:bytes])

export function encodeClaimAccountDatum(d: ClaimAccountDatum): Constr<Data> {
  return new Constr(0, [
    normHex(d.owner),
    d.entitlement,
    d.redeemed,
    d.start_epoch,
    d.drops_per_epoch,
    normHex(d.channel_id),
  ]);
}

export function decodeClaimAccountDatum(d: Data): ClaimAccountDatum {
  const c = asConstr(d, "ClaimAccountDatum");
  if (c.index !== 0) throw new Error(`TDATUM-020: ClaimAccountDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 6) throw new Error(`TDATUM-021: ClaimAccountDatum expects 6 fields, got ${c.fields.length}`);
  return {
    owner:           asBytes(c.fields[0]!, "owner"),
    entitlement:     asInt(c.fields[1]!, "entitlement"),
    redeemed:        asInt(c.fields[2]!, "redeemed"),
    start_epoch:     asInt(c.fields[3]!, "start_epoch"),
    drops_per_epoch: asInt(c.fields[4]!, "drops_per_epoch"),
    channel_id:      asBytes(c.fields[5]!, "channel_id"),
  };
}

export function claimAccountDatumToCbor(d: ClaimAccountDatum): string {
  return Data.to(encodeClaimAccountDatum(d));
}

export function claimAccountDatumFromCbor(cbor: string): ClaimAccountDatum {
  return decodeClaimAccountDatum(Data.from(cbor));
}

// ── ClaimAccountRedeemer ────────────────────────────────────────────────

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

// ── ChannelBudgetDatum ──────────────────────────────────────────────────
// Constr(0, [channel_id:bytes, remaining_oil:int])

export function encodeChannelBudgetDatum(d: ChannelBudgetDatum): Constr<Data> {
  return new Constr(0, [normHex(d.channel_id), d.remaining_oil]);
}

export function decodeChannelBudgetDatum(d: Data): ChannelBudgetDatum {
  const c = asConstr(d, "ChannelBudgetDatum");
  if (c.index !== 0) throw new Error(`TDATUM-030: ChannelBudgetDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 2) throw new Error(`TDATUM-031: ChannelBudgetDatum expects 2 fields, got ${c.fields.length}`);
  return {
    channel_id:    asBytes(c.fields[0]!, "channel_id"),
    remaining_oil: asInt(c.fields[1]!, "remaining_oil"),
  };
}

export function channelBudgetDatumToCbor(d: ChannelBudgetDatum): string {
  return Data.to(encodeChannelBudgetDatum(d));
}

export function channelBudgetDatumFromCbor(cbor: string): ChannelBudgetDatum {
  return decodeChannelBudgetDatum(Data.from(cbor));
}

/** ChannelBudgetRedeemer: Decrement { amount } = Constr(0, [int]). */
export function encodeDecrementRedeemer(amount: bigint): Constr<Data> {
  return new Constr(CHANNEL_BUDGET_REDEEMER.Decrement, [amount]);
}

export function decrementRedeemerToCbor(amount: bigint): string {
  return Data.to(encodeDecrementRedeemer(amount));
}

// ── TreasuryDatum ───────────────────────────────────────────────────────
// Constr(0, [committee_hash:bytes, channel_id:bytes])

export function encodeTreasuryDatum(d: TreasuryDatum): Constr<Data> {
  return new Constr(0, [normHex(d.committee_hash), normHex(d.channel_id)]);
}

export function decodeTreasuryDatum(d: Data): TreasuryDatum {
  const c = asConstr(d, "TreasuryDatum");
  if (c.index !== 0) throw new Error(`TDATUM-040: TreasuryDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 2) throw new Error(`TDATUM-041: TreasuryDatum expects 2 fields, got ${c.fields.length}`);
  return {
    committee_hash: asBytes(c.fields[0]!, "committee_hash"),
    channel_id:     asBytes(c.fields[1]!, "channel_id"),
  };
}

export function treasuryDatumToCbor(d: TreasuryDatum): string {
  return Data.to(encodeTreasuryDatum(d));
}

export function treasuryDatumFromCbor(cbor: string): TreasuryDatum {
  return decodeTreasuryDatum(Data.from(cbor));
}

/** TreasuryRedeemer: ReleaseForRedeem = Constr(0, []). */
export function encodeTreasuryRedeemer(): Constr<Data> {
  return new Constr(0, []);
}

export function treasuryRedeemerToCbor(): string {
  return Data.to(encodeTreasuryRedeemer());
}

/** BudgetNftRedeemer: MintGenesis = Constr(0, []). */
export function encodeBudgetNftRedeemer(): Constr<Data> {
  return new Constr(0, []);
}

export function budgetNftRedeemerToCbor(): string {
  return Data.to(encodeBudgetNftRedeemer());
}

/** AccountNftRedeemer: MintAccount = Constr(0, []). */
export function encodeAccountNftRedeemer(): Constr<Data> {
  return new Constr(0, []);
}

export function accountNftRedeemerToCbor(): string {
  return Data.to(encodeAccountNftRedeemer());
}
