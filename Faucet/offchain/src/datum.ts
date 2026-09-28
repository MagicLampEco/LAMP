// Faucet datum/redeemer codec (v3) — Plutus Data (Lucid Evolution).
// PHẢI khớp byte-perfect onchain `magiclamp/faucet/ledger.ak`. Constr index = thứ tự khai
// báo enum on-chain — ĐỌC từ `onchain/plutus.json` `definitions`, không đoán:
//
//   FaucetConfig  = Constr(0, [drip_oildrop, cooldown_epochs, max_claims_per_window])
//   PoolDatum     = Constr(0, [FaucetConfig, window_epoch, claims_in_window, opened_root])
//   FaucetAccount = Constr(0, [did_name, last_claim_epoch, last_touch_epoch])
//
//   PoolRedeemer      0=ClaimOpen{proof}  1=ClaimAgain  2=Reclaim{proof}  3=TopUpPool
//   Proof (MPF)       List<ProofStep>; 0=Branch{skip,neighbors} 1=Fork{skip,Neighbor}
//                     2=Leaf{skip,key,value}; Neighbor = Constr(0,[nibble,prefix,root])
//   AccountRedeemer   0=Use        1=TopUp       2=ReclaimIdle
//   FaucetNftRedeemer 0=MintPool   1=MintAccount 2=BurnAccount
//
// v1 (`faucet.ak`, FaucetDatum) và v2 (Claim/Reclaim=Constr0/1 không tách Open/Again, index
// ReclaimIdle=1) đã XOÁ khỏi on-chain — không còn hàm codec nào cho hai bản đó ở đây.

import { Constr, Data } from "@lucid-evolution/lucid";
import type {
  FaucetConfig, PoolDatum, FaucetAccount, MpfProof, MpfProofStep, PoolRedeemer,
} from "./types.js";

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

/** Bytes hex có ĐÚNG `n` byte — ép cả chiều mã hoá lẫn giải mã. */
function assertHexBytes(hex: string, n: number | null, ctx: string): string {
  if (typeof hex !== "string" || !/^([0-9a-f]{2})*$/.test(hex)) {
    throw new Error(`FAUCET-DATUM-004: ${ctx} phải là hex thường độ dài chẵn, nhận '${String(hex)}'`);
  }
  if (n !== null && hex.length !== 2 * n) {
    throw new Error(`FAUCET-DATUM-005: ${ctx} phải đúng ${n} byte, nhận ${hex.length / 2}`);
  }
  return hex;
}

/** Số tự nhiên (≥ 0) — skip/nibble của bằng chứng MPF không bao giờ âm. */
function assertNat(v: bigint, ctx: string): bigint {
  if (typeof v !== "bigint" || v < 0n) {
    throw new Error(`FAUCET-DATUM-006: ${ctx} phải là bigint ≥ 0, nhận ${String(v)}`);
  }
  return v;
}

/** Độ dài gốc MPF — `mpf.from_root` on-chain tự ép đúng 32 byte. */
const MPF_ROOT_BYTES = 32;

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
  return new Constr(0, [
    encodeFaucetConfig(pd.cfg),
    pd.window_epoch,
    pd.claims_in_window,
    assertHexBytes(pd.opened_root, MPF_ROOT_BYTES, "PoolDatum.opened_root"),
  ]);
}

export function decodePoolDatum(d: Data): PoolDatum {
  const c = asConstr(d, "PoolDatum");
  if (c.index !== 0) throw new Error(`FAUCET-DATUM-050: PoolDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 4) throw new Error(`FAUCET-DATUM-051: PoolDatum expects 4 fields, got ${c.fields.length}`);
  return {
    cfg: decodeFaucetConfig(c.fields[0]!),
    window_epoch: asInt(c.fields[1]!, "window_epoch"),
    claims_in_window: asInt(c.fields[2]!, "claims_in_window"),
    // Gốc không đủ 32 byte thì `mpf.from_root` on-chain đánh trượt MỌI lượt spend pool — ném
    // ngay khi đọc, đừng để builder dựng tiếp trên một datum mà chuỗi sẽ không nhận.
    opened_root: assertHexBytes(asBytes(c.fields[3]!, "opened_root"), MPF_ROOT_BYTES, "PoolDatum.opened_root"),
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

// ── Bằng chứng MPF (aiken-lang/merkle-patricia-forestry v2.1.0) ────────────

/** Độ dài `neighbors` của bước Branch = 4 nút láng giềng × 32 byte (cây Merkle nhị phân
 *  thưa trên 16 con, xem `do_branch` của thư viện on-chain). */
const MPF_BRANCH_NEIGHBORS_BYTES = 128;
/** Khoá (đường đi) và giá trị lá trong bước Leaf là digest blake2b-256. */
const MPF_DIGEST_BYTES = 32;

export function encodeMpfProofStep(step: MpfProofStep): Constr<Data> {
  switch (step.kind) {
    case "Branch":
      return new Constr(0, [
        assertNat(step.skip, "Branch.skip"),
        assertHexBytes(step.neighbors, MPF_BRANCH_NEIGHBORS_BYTES, "Branch.neighbors"),
      ]);
    case "Fork":
      return new Constr(1, [
        assertNat(step.skip, "Fork.skip"),
        new Constr(0, [
          assertNat(step.neighbor.nibble, "Fork.neighbor.nibble"),
          assertHexBytes(step.neighbor.prefix, null, "Fork.neighbor.prefix"),
          assertHexBytes(step.neighbor.root, MPF_DIGEST_BYTES, "Fork.neighbor.root"),
        ]),
      ]);
    case "Leaf":
      return new Constr(2, [
        assertNat(step.skip, "Leaf.skip"),
        assertHexBytes(step.key, MPF_DIGEST_BYTES, "Leaf.key"),
        assertHexBytes(step.value, MPF_DIGEST_BYTES, "Leaf.value"),
      ]);
    default: {
      const never: never = step;
      throw new Error(`FAUCET-DATUM-070: ProofStep kind lạ ${JSON.stringify(never)}`);
    }
  }
}

export function decodeMpfProofStep(d: Data): MpfProofStep {
  const c = asConstr(d, "ProofStep");
  // Branch{skip,neighbors} = 2 · Fork{skip,neighbor} = 2 · Leaf{skip,key,value} = 3.
  const want = c.index === 2 ? 3 : 2;
  if (c.index < 0 || c.index > 2) throw new Error(`FAUCET-DATUM-071: ProofStep expects Constr 0..2, got ${c.index}`);
  if (c.fields.length !== want) {
    throw new Error(`FAUCET-DATUM-072: ProofStep Constr ${c.index} expects ${want} fields, got ${c.fields.length}`);
  }
  const skip = assertNat(asInt(c.fields[0]!, "ProofStep.skip"), "ProofStep.skip");
  if (c.index === 0) {
    return {
      kind: "Branch", skip,
      neighbors: assertHexBytes(asBytes(c.fields[1]!, "Branch.neighbors"), MPF_BRANCH_NEIGHBORS_BYTES, "Branch.neighbors"),
    };
  }
  if (c.index === 1) {
    const n = asConstr(c.fields[1]!, "Neighbor");
    if (n.index !== 0) throw new Error(`FAUCET-DATUM-073: Neighbor expects Constr 0, got ${n.index}`);
    if (n.fields.length !== 3) throw new Error(`FAUCET-DATUM-074: Neighbor expects 3 fields, got ${n.fields.length}`);
    return {
      kind: "Fork", skip,
      neighbor: {
        nibble: assertNat(asInt(n.fields[0]!, "Neighbor.nibble"), "Neighbor.nibble"),
        prefix: assertHexBytes(asBytes(n.fields[1]!, "Neighbor.prefix"), null, "Neighbor.prefix"),
        root: assertHexBytes(asBytes(n.fields[2]!, "Neighbor.root"), MPF_DIGEST_BYTES, "Neighbor.root"),
      },
    };
  }
  return {
    kind: "Leaf", skip,
    key: assertHexBytes(asBytes(c.fields[1]!, "Leaf.key"), MPF_DIGEST_BYTES, "Leaf.key"),
    value: assertHexBytes(asBytes(c.fields[2]!, "Leaf.value"), MPF_DIGEST_BYTES, "Leaf.value"),
  };
}

/** Proof = List<ProofStep>. Danh sách RỖNG là hợp lệ (ClaimOpen trên sổ rỗng; Reclaim trên
 *  sổ đúng một khoá). */
export function encodeMpfProof(proof: MpfProof): Data[] {
  if (!Array.isArray(proof)) throw new Error("FAUCET-DATUM-075: MPF proof phải là mảng ProofStep");
  return proof.map(encodeMpfProofStep);
}

export function decodeMpfProof(d: Data): MpfProof {
  if (!Array.isArray(d)) throw new Error("FAUCET-DATUM-076: MPF proof expects a list");
  return d.map(decodeMpfProofStep);
}

// ── PoolRedeemer (v3.1): ClaimOpen{proof}=0, ClaimAgain=1, Reclaim{proof}=2, TopUpPool=3 ──

export function encodePoolRedeemer(r: PoolRedeemer): Constr<Data> {
  switch (r.kind) {
    case "ClaimOpen": return new Constr(0, [encodeMpfProof(r.proof)]);
    case "ClaimAgain": return new Constr(1, []);
    case "Reclaim": return new Constr(2, [encodeMpfProof(r.proof)]);
    case "TopUpPool": return new Constr(3, []);
    default: {
      const never: never = r;
      throw new Error(`FAUCET-DATUM-060: PoolRedeemer kind lạ ${JSON.stringify(never)}`);
    }
  }
}

export function decodePoolRedeemer(d: Data): PoolRedeemer {
  const c = asConstr(d, "PoolRedeemer");
  const withProof = c.index === 0 || c.index === 2;
  if (c.index < 0 || c.index > 3) throw new Error(`FAUCET-DATUM-061: PoolRedeemer expects Constr 0..3, got ${c.index}`);
  if (c.fields.length !== (withProof ? 1 : 0)) {
    throw new Error(`FAUCET-DATUM-062: PoolRedeemer Constr ${c.index} expects ${withProof ? 1 : 0} fields, got ${c.fields.length}`);
  }
  switch (c.index) {
    case 0: return { kind: "ClaimOpen", proof: decodeMpfProof(c.fields[0]!) };
    case 1: return { kind: "ClaimAgain" };
    case 2: return { kind: "Reclaim", proof: decodeMpfProof(c.fields[0]!) };
    default: return { kind: "TopUpPool" };
  }
}

export function poolRedeemerFromCbor(cbor: string): PoolRedeemer {
  return decodePoolRedeemer(Data.from(cbor));
}

/** `proof` = bằng chứng khoá DID CHƯA có trong `opened_root` (sinh bởi `OpenedLedger.planInsert`). */
export function poolClaimOpenRedeemerToCbor(proof: MpfProof): string {
  return Data.to(encodePoolRedeemer({ kind: "ClaimOpen", proof }));
}
export function poolClaimAgainRedeemerToCbor(): string {
  return Data.to(encodePoolRedeemer({ kind: "ClaimAgain" }));
}
/** `proof` = bằng chứng khoá DID ĐANG có trong `opened_root` (sinh bởi `OpenedLedger.planDelete`). */
export function poolReclaimRedeemerToCbor(proof: MpfProof): string {
  return Data.to(encodePoolRedeemer({ kind: "Reclaim", proof }));
}
export function poolTopUpPoolRedeemerToCbor(): string {
  return Data.to(encodePoolRedeemer({ kind: "TopUpPool" }));
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
