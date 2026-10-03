// NFT con trỏ governance — codec + phép dựng datum thuần (Treasury/GovernancePointer.md v0.1).
//
// PHẢI khớp byte-perfect với `Treasury/onchain/lib/magiclamp/treasury/types.ak`:
//   Pending{new_hash, effective_after_ms}           = Constr(0, [bytes, int])
//   PointerDatum{governance_hash, committee, threshold, sealed, pending}
//                                                   = Constr(0, [bytes, List<bytes>, int, Bool, Option<Pending>])
//   Bool: False = Constr(0, []), True = Constr(1, [])
//   Option: Some(x) = Constr(0, [x]), None = Constr(1, [])
//   PointerRedeemer:
//     CommitteePropose{new_hash}                    = Constr(0, [bytes])
//     ApplyPending                                  = Constr(1, [])
//     CommitteeCancel                               = Constr(2, [])
//     Seal                                          = Constr(3, [])
//     GovernanceSet{new_hash, proposal_ref}         = Constr(4, [bytes, OutputReference])
//
// Các hàm `plan*` dựng datum ra đúng như validator `governance_pointer.ak` đòi và NÉM khi
// tiền điều kiện của nhánh không thoả — fail-fast trước khi trả phí.

import { Constr, Data } from "@lucid-evolution/lucid";
import { blake2b } from "@noble/hashes/blake2b";

import type { OutputReference } from "./types.js";
import { decodeOutputReference, encodeOutputReference } from "./datum.js";
import { bytesToHex, hexToBytes } from "./release.js";

/** Tên asset NFT con trỏ: "GOVPOINTER" (hex). Khớp `pointer.pointer_name`. */
export const POINTER_NAME = "474f56504f494e544552";

/** Trần cỡ committee — khớp `pointer.max_committee`. */
export const POINTER_MAX_COMMITTEE = 16;

/** Domain tag hash đổi con trỏ — tách khỏi 0x03 của Release (`SPEND_SPEC_PREFIX`). */
export const POINTER_SPEC_PREFIX = 0x04;

export interface Pending {
  new_hash: string;
  effective_after_ms: bigint;
}

export interface PointerDatum {
  governance_hash: string;   // 56 hex, hoặc "" khi chưa có governance chạy được
  committee: string[];       // pkh 56 hex, không trùng
  threshold: bigint;
  sealed: boolean;
  pending: Pending | null;
}

export type PointerRedeemer =
  | { kind: "CommitteePropose"; new_hash: string }
  | { kind: "ApplyPending" }
  | { kind: "CommitteeCancel" }
  | { kind: "Seal" }
  | { kind: "GovernanceSet"; new_hash: string; proposal_ref: OutputReference };

export const POINTER_REDEEMER = {
  CommitteePropose: 0,
  ApplyPending: 1,
  CommitteeCancel: 2,
  Seal: 3,
  GovernanceSet: 4,
} as const;

const HASH28 = /^[0-9a-f]{56}$/;

function normHex(h: string): string {
  return (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
}

function asConstr(d: Data, ctx: string): Constr<Data> {
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`PTR-DATUM-000: cần Constr cho ${ctx}`);
}

function asBytes(d: Data, ctx: string): string {
  if (typeof d !== "string") throw new Error(`PTR-DATUM-001: cần bytes cho ${ctx}`);
  return d;
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`PTR-DATUM-002: cần int cho ${ctx}`);
  return d;
}

// ── codec ─────────────────────────────────────────────────────────────────

export function encodePointerDatum(d: PointerDatum): Constr<Data> {
  return new Constr(0, [
    normHex(d.governance_hash),
    d.committee.map(normHex),
    d.threshold,
    new Constr(d.sealed ? 1 : 0, []),
    d.pending === null
      ? new Constr(1, [])
      : new Constr(0, [new Constr(0, [normHex(d.pending.new_hash), d.pending.effective_after_ms])]),
  ]);
}

export function decodePointerDatum(d: Data): PointerDatum {
  const c = asConstr(d, "PointerDatum");
  if (c.index !== 0 || c.fields.length !== 5) {
    throw new Error(`PTR-DATUM-010: PointerDatum cần Constr 0 với 5 trường, nhận Constr ${c.index}/${c.fields.length}`);
  }
  const committeeRaw = c.fields[1];
  if (!Array.isArray(committeeRaw)) throw new Error("PTR-DATUM-011: committee phải là list");
  const sealedC = asConstr(c.fields[3]!, "PointerDatum.sealed");
  if (sealedC.fields.length !== 0 || (sealedC.index !== 0 && sealedC.index !== 1)) {
    throw new Error(`PTR-DATUM-012: sealed không phải Bool (Constr ${sealedC.index})`);
  }
  const optC = asConstr(c.fields[4]!, "PointerDatum.pending");
  let pending: Pending | null;
  if (optC.index === 1 && optC.fields.length === 0) {
    pending = null;
  } else if (optC.index === 0 && optC.fields.length === 1) {
    const p = asConstr(optC.fields[0]!, "Pending");
    if (p.index !== 0 || p.fields.length !== 2) throw new Error("PTR-DATUM-013: Pending cần Constr 0 với 2 trường");
    pending = {
      new_hash: asBytes(p.fields[0]!, "Pending.new_hash"),
      effective_after_ms: asInt(p.fields[1]!, "Pending.effective_after_ms"),
    };
  } else {
    throw new Error(`PTR-DATUM-014: pending không phải Option (Constr ${optC.index})`);
  }
  return {
    governance_hash: asBytes(c.fields[0]!, "PointerDatum.governance_hash"),
    committee: committeeRaw.map((k, i) => asBytes(k, `PointerDatum.committee[${i}]`)),
    threshold: asInt(c.fields[2]!, "PointerDatum.threshold"),
    sealed: sealedC.index === 1,
    pending,
  };
}

export function pointerDatumToCbor(d: PointerDatum): string {
  return Data.to(encodePointerDatum(d));
}

export function pointerDatumFromCbor(cbor: string): PointerDatum {
  return decodePointerDatum(Data.from(cbor));
}

export function encodePointerRedeemer(r: PointerRedeemer): Constr<Data> {
  switch (r.kind) {
    case "CommitteePropose":
      return new Constr(POINTER_REDEEMER.CommitteePropose, [normHex(r.new_hash)]);
    case "ApplyPending":
      return new Constr(POINTER_REDEEMER.ApplyPending, []);
    case "CommitteeCancel":
      return new Constr(POINTER_REDEEMER.CommitteeCancel, []);
    case "Seal":
      return new Constr(POINTER_REDEEMER.Seal, []);
    case "GovernanceSet":
      return new Constr(POINTER_REDEEMER.GovernanceSet, [
        normHex(r.new_hash), encodeOutputReference(r.proposal_ref),
      ]);
  }
}

export function decodePointerRedeemer(d: Data): PointerRedeemer {
  const c = asConstr(d, "PointerRedeemer");
  switch (c.index) {
    case 0: return { kind: "CommitteePropose", new_hash: asBytes(c.fields[0]!, "new_hash") };
    case 1: return { kind: "ApplyPending" };
    case 2: return { kind: "CommitteeCancel" };
    case 3: return { kind: "Seal" };
    case 4: return {
      kind: "GovernanceSet",
      new_hash: asBytes(c.fields[0]!, "new_hash"),
      proposal_ref: decodeOutputReference(c.fields[1]!),
    };
    default: throw new Error(`PTR-REDEEMER-000: Constr ${c.index} không thuộc PointerRedeemer`);
  }
}

export function pointerRedeemerToCbor(r: PointerRedeemer): string {
  return Data.to(encodePointerRedeemer(r));
}

// ── hash cam kết đổi con trỏ ─────────────────────────────────────────────

/** blake2b_256(0x04 ‖ pointer_policy ‖ new_hash) — khớp `pointer.pointer_spec_hash`. */
export function pointerSpecHash(pointerPolicy: string, newHash: string): string {
  const p = normHex(pointerPolicy);
  const h = normHex(newHash);
  if (!HASH28.test(p)) throw new Error(`PTR-SPEC-001: pointer_policy cần 28 byte, nhận "${pointerPolicy}"`);
  if (!HASH28.test(h)) throw new Error(`PTR-SPEC-002: new_hash cần 28 byte, nhận "${newHash}"`);
  const pre = new Uint8Array(1 + 28 + 28);
  pre[0] = POINTER_SPEC_PREFIX;
  pre.set(hexToBytes(p), 1);
  pre.set(hexToBytes(h), 29);
  return bytesToHex(blake2b(pre, { dkLen: 32 }));
}

// ── datum lúc đúc + phép dựng datum theo nhánh ───────────────────────────

/** Committee hợp lệ lúc ĐÚC — khớp `pointer.committee_wellformed`. Ném nếu sai. */
export function assertCommitteeWellformed(committee: string[], threshold: bigint): void {
  const ks = committee.map(normHex);
  if (ks.length < 1 || ks.length > POINTER_MAX_COMMITTEE) {
    throw new Error(`PTR-COMMITTEE-001: committee cần 1..${POINTER_MAX_COMMITTEE} khoá, có ${ks.length}`);
  }
  for (const k of ks) {
    if (!HASH28.test(k)) throw new Error(`PTR-COMMITTEE-002: khoá committee "${k}" không phải 28 byte`);
  }
  if (new Set(ks).size !== ks.length) throw new Error("PTR-COMMITTEE-003: committee có khoá trùng");
  if (threshold < 1n || threshold > BigInt(ks.length)) {
    throw new Error(`PTR-COMMITTEE-004: threshold ${threshold} ngoài [1, ${ks.length}]`);
  }
}

/**
 * Datum lúc đúc (Tx P genesis): con trỏ RỖNG, committee một khoá vận hành, chưa niêm phong,
 * không pending — đúng `GovernancePointer.md §Genesis`.
 */
export function genesisPointerDatum(committee: string[], threshold = 1n): PointerDatum {
  assertCommitteeWellformed(committee, threshold);
  return {
    governance_hash: "",
    committee: committee.map(normHex),
    threshold,
    sealed: false,
    pending: null,
  };
}

function need28(h: string, code: string, what: string): string {
  const n = normHex(h);
  if (!HASH28.test(n)) throw new Error(`${code}: ${what} cần 28 byte, nhận "${h}"`);
  return n;
}

/** CommitteePropose — hạn = CẬN TRÊN validity range + change_delay_ms (xem validator). */
export function planPropose(
  d: PointerDatum, newHash: string, validToMs: bigint, changeDelayMs: bigint,
): PointerDatum {
  if (d.sealed) throw new Error("PTR-PROPOSE-001: con trỏ đã niêm phong — committee hết quyền đề xuất");
  const h = need28(newHash, "PTR-PROPOSE-002", "new_hash");
  return { ...d, pending: { new_hash: h, effective_after_ms: validToMs + changeDelayMs } };
}

/** ApplyPending — ai cũng gọi; cận dưới validity range phải ≥ hạn. */
export function planApply(d: PointerDatum, validFromMs: bigint): PointerDatum {
  if (d.pending === null) throw new Error("PTR-APPLY-001: không có thay đổi đang chờ");
  if (validFromMs < d.pending.effective_after_ms) {
    throw new Error(
      `PTR-APPLY-002: chưa tới hạn — cận dưới ${validFromMs} < ${d.pending.effective_after_ms}`,
    );
  }
  return { ...d, governance_hash: d.pending.new_hash, pending: null };
}

export function planCancel(d: PointerDatum): PointerDatum {
  if (d.sealed) throw new Error("PTR-CANCEL-001: con trỏ đã niêm phong");
  if (d.pending === null) throw new Error("PTR-CANCEL-002: không có thay đổi đang chờ để huỷ");
  return { ...d, pending: null };
}

export function planSeal(d: PointerDatum): PointerDatum {
  if (d.sealed) throw new Error("PTR-SEAL-001: đã niêm phong");
  need28(d.governance_hash, "PTR-SEAL-002", "governance_hash (niêm phong con trỏ rỗng = khoá chết)");
  if (d.pending !== null) throw new Error("PTR-SEAL-003: còn thay đổi đang chờ — Apply hoặc Cancel trước");
  return { ...d, sealed: true };
}

export function planGovernanceSet(d: PointerDatum, newHash: string): PointerDatum {
  need28(d.governance_hash, "PTR-GOVSET-001", "governance_hash hiện hành");
  const h = need28(newHash, "PTR-GOVSET-002", "new_hash");
  return { ...d, governance_hash: h, pending: null };
}

/**
 * Governance hiện hành mà custody sẽ đọc (`pointer.read_governance`): 28 byte, hoặc ném.
 * Con trỏ rỗng ⇒ Release bị từ chối on-chain, nên ném sớm ở đây.
 */
export function currentGovernance(d: PointerDatum): string {
  return need28(d.governance_hash, "PTR-READ-001", "governance_hash (con trỏ rỗng ⇒ Release bị từ chối)");
}
