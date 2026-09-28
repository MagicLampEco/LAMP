// Faucet datum/redeemer codec (v3) — Plutus Data (Lucid Evolution).
// PHẢI khớp byte-perfect onchain `magiclamp/faucet/ledger.ak`. Constr index = thứ tự khai
// báo enum on-chain — ĐỌC từ `onchain/plutus.json` `definitions`, không đoán:
//
//   FaucetConfig  = Constr(0, [drip_oildrop, cooldown_epochs, max_claims_per_window])
//   PoolDatum     = Constr(0, [FaucetConfig, window_epoch, claims_in_window])
//   FaucetAccount = Constr(0, [did_name, last_claim_epoch, last_touch_epoch])
//
//   PoolRedeemer      0=ClaimOpen  1=ClaimAgain  2=Reclaim  3=TopUpPool
//   AccountRedeemer   0=Use        1=TopUp       2=ReclaimIdle
//   FaucetNftRedeemer 0=MintPool   1=MintAccount 2=BurnAccount
//
// v1 (`faucet.ak`, FaucetDatum) và v2 (Claim/Reclaim=Constr0/1 không tách Open/Again, index
// ReclaimIdle=1) đã XOÁ khỏi on-chain — không còn hàm codec nào cho hai bản đó ở đây.

import { Constr, Data } from "@lucid-evolution/lucid";
import type { FaucetConfig, PoolDatum, FaucetAccount } from "./types.js";

function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`FAUCET-DATUM-000: expected Constr for ${ctx}`);
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`FAUCET-DATUM-002: expected int for ${ctx}`);
  return d;
}

function asBytes(d: Data, ctx: string): string {
  if (typeof d !== "string") throw new Error(`FAUCET-DATUM-003: expected bytes for ${ctx}`);
  return d;
}

// ── FaucetConfig ───────────────────────────────────────────────────────

export function encodeFaucetConfig(c: FaucetConfig): Constr<Data> {
  return new Constr(0, [c.drip_oildrop, c.cooldown_epochs, c.max_claims_per_window]);
}

export function decodeFaucetConfig(d: Data): FaucetConfig {
  const c = asConstr(d, "FaucetConfig");
  if (c.index !== 0) throw new Error(`FAUCET-DATUM-030: FaucetConfig expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 3) throw new Error(`FAUCET-DATUM-031: FaucetConfig expects 3 fields, got ${c.fields.length}`);
  return {
    drip_oildrop: asInt(c.fields[0]!, "drip_oildrop"),
    cooldown_epochs: asInt(c.fields[1]!, "cooldown_epochs"),
    max_claims_per_window: asInt(c.fields[2]!, "max_claims_per_window"),
  };
}

export function faucetConfigToCbor(c: FaucetConfig): string {
  return Data.to(encodeFaucetConfig(c));
}

export function faucetConfigFromCbor(cbor: string): FaucetConfig {
  return decodeFaucetConfig(Data.from(cbor));
}

// ── PoolDatum (datum của POOL UTxO) ─────────────────────────────────────

export function encodePoolDatum(pd: PoolDatum): Constr<Data> {
  return new Constr(0, [encodeFaucetConfig(pd.cfg), pd.window_epoch, pd.claims_in_window]);
}

export function decodePoolDatum(d: Data): PoolDatum {
  const c = asConstr(d, "PoolDatum");
  if (c.index !== 0) throw new Error(`FAUCET-DATUM-050: PoolDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 3) throw new Error(`FAUCET-DATUM-051: PoolDatum expects 3 fields, got ${c.fields.length}`);
  return {
    cfg: decodeFaucetConfig(c.fields[0]!),
    window_epoch: asInt(c.fields[1]!, "window_epoch"),
    claims_in_window: asInt(c.fields[2]!, "claims_in_window"),
  };
}

export function poolDatumToCbor(pd: PoolDatum): string {
  return Data.to(encodePoolDatum(pd));
}

export function poolDatumFromCbor(cbor: string): PoolDatum {
  return decodePoolDatum(Data.from(cbor));
}

// ── FaucetAccount (datum faucet-account per-DID) ─────────────────────────

export function encodeFaucetAccount(a: FaucetAccount): Constr<Data> {
  return new Constr(0, [a.did_name, a.last_claim_epoch, a.last_touch_epoch]);
}

export function decodeFaucetAccount(d: Data): FaucetAccount {
  const c = asConstr(d, "FaucetAccount");
  if (c.index !== 0) throw new Error(`FAUCET-DATUM-040: FaucetAccount expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 3) throw new Error(`FAUCET-DATUM-041: FaucetAccount expects 3 fields, got ${c.fields.length}`);
  return {
    did_name: asBytes(c.fields[0]!, "did_name"),
    last_claim_epoch: asInt(c.fields[1]!, "last_claim_epoch"),
    last_touch_epoch: asInt(c.fields[2]!, "last_touch_epoch"),
  };
}

export function faucetAccountToCbor(a: FaucetAccount): string {
  return Data.to(encodeFaucetAccount(a));
}

export function faucetAccountFromCbor(cbor: string): FaucetAccount {
  return decodeFaucetAccount(Data.from(cbor));
}

// ── Redeemers ──────────────────────────────────────────────────────────

/** TLampRedeemer::MintGenesis = Constr(0, []) — validator `tlamp_policy`, KHÔNG đổi ở bản vá này. */
export function mintGenesisRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}

// PoolRedeemer (v3): ClaimOpen=0, ClaimAgain=1, Reclaim=2, TopUpPool=3.
export function poolClaimOpenRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}
export function poolClaimAgainRedeemerToCbor(): string {
  return Data.to(new Constr(1, []));
}
export function poolReclaimRedeemerToCbor(): string {
  return Data.to(new Constr(2, []));
}
export function poolTopUpPoolRedeemerToCbor(): string {
  return Data.to(new Constr(3, []));
}

// AccountRedeemer (v3): Use=0, TopUp=1, ReclaimIdle=2.
export function accountUseRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}
export function accountTopUpRedeemerToCbor(): string {
  return Data.to(new Constr(1, []));
}
export function accountReclaimIdleRedeemerToCbor(): string {
  return Data.to(new Constr(2, []));
}

// FaucetNftRedeemer (v3): MintPool=0, MintAccount=1, BurnAccount=2 (BurnAccount MỚI so với v2).
export function mintPoolRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}
export function mintAccountRedeemerToCbor(): string {
  return Data.to(new Constr(1, []));
}
export function burnAccountRedeemerToCbor(): string {
  return Data.to(new Constr(2, []));
}
