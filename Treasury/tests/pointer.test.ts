// NFT con trỏ governance — codec + plan* (Treasury/GovernancePointer.md v0.1).
// Đối chiếu byte với on-chain: vector `pointer_spec_hash` cùng hex với
// `governance_pointer_test.ak` ▸ `pointer_spec_hash_vector` (tính độc lập bằng hashlib:
// blake2b-256(04 ‖ 70×28 ‖ b0×28)).

import { describe, expect, it } from "vitest";
import { Constr, Data } from "@lucid-evolution/lucid";

import {
  POINTER_NAME, assertCommitteeWellformed, currentGovernance, decodePointerDatum,
  decodePointerRedeemer, encodePointerDatum, genesisPointerDatum, planApply, planCancel,
  planGovernanceSet, planPropose, planSeal, pointerDatumFromCbor, pointerDatumToCbor,
  pointerRedeemerToCbor, pointerSpecHash, type PointerDatum,
} from "../offchain/src/pointer.js";

const PTR = "70".repeat(28);
const GOV_A = "a0".repeat(28);
const GOV_B = "b0".repeat(28);
const C1 = "c1".repeat(28);
const C2 = "c2".repeat(28);

const d0: PointerDatum = {
  governance_hash: GOV_A, committee: [C1, C2], threshold: 2n, sealed: false, pending: null,
};

describe("tên NFT con trỏ", () => {
  it("POINTER_NAME = hex của \"GOVPOINTER\"", () => {
    expect(POINTER_NAME).toBe([..."GOVPOINTER"].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
  });
});

describe("pointerSpecHash — khớp on-chain", () => {
  it("vector chung với aiken + hashlib", () => {
    expect(pointerSpecHash(PTR, GOV_B))
      .toBe("014cdd4971c8e4900a01b916cc2f0c5ade57a3fe5e39e98b95917f1cabf3907c");
  });
  it("ràng buộc cả policy lẫn hash mới", () => {
    expect(pointerSpecHash(PTR, GOV_B)).not.toBe(pointerSpecHash("de".repeat(28), GOV_B));
    expect(pointerSpecHash(PTR, GOV_B)).not.toBe(pointerSpecHash(PTR, GOV_A));
  });
  it("ĐỎ: hash không đủ 28 byte", () => {
    expect(() => pointerSpecHash(PTR, "b0".repeat(27))).toThrow(/PTR-SPEC-002/);
    expect(() => pointerSpecHash("", GOV_B)).toThrow(/PTR-SPEC-001/);
  });
});

describe("codec PointerDatum / PointerRedeemer", () => {
  it("hình Constr khớp types.ak (Bool = Constr 0/1, Option = Some 0 / None 1)", () => {
    const c = encodePointerDatum({ ...d0, sealed: true, pending: { new_hash: GOV_B, effective_after_ms: 7n } });
    expect(c.index).toBe(0);
    expect(c.fields.length).toBe(5);
    expect((c.fields[3] as Constr<Data>).index).toBe(1);
    const opt = c.fields[4] as Constr<Data>;
    expect(opt.index).toBe(0);
    const none = encodePointerDatum(d0).fields[4] as Constr<Data>;
    expect(none.index).toBe(1);
    expect((encodePointerDatum(d0).fields[3] as Constr<Data>).index).toBe(0);
  });
  it("khứ hồi CBOR giữ nguyên", () => {
    for (const d of [d0, genesisPointerDatum([C1]),
      { ...d0, sealed: true }, { ...d0, pending: { new_hash: GOV_B, effective_after_ms: 123n } }]) {
      expect(pointerDatumFromCbor(pointerDatumToCbor(d))).toEqual(d);
    }
  });
  it("redeemer: index theo thứ tự khai báo, khứ hồi đúng", () => {
    const rs = [
      { kind: "CommitteePropose", new_hash: GOV_B },
      { kind: "ApplyPending" },
      { kind: "CommitteeCancel" },
      { kind: "Seal" },
      { kind: "GovernanceSet", new_hash: GOV_B, proposal_ref: { transaction_id: "ab".repeat(32), output_index: 3n } },
    ] as const;
    rs.forEach((r, i) => {
      const d = Data.from(pointerRedeemerToCbor(r)) as Constr<Data>;
      expect(d.index).toBe(i);
      expect(decodePointerRedeemer(d)).toEqual(r);
    });
  });
  it("ĐỎ: datum sai hình (thiếu trường) ⇒ ném", () => {
    expect(() => decodePointerDatum(new Constr(0, [GOV_A]))).toThrow(/PTR-DATUM-010/);
  });
});

describe("genesisPointerDatum + committee", () => {
  it("con trỏ rỗng, 1 khoá, chưa niêm phong, không pending", () => {
    expect(genesisPointerDatum([C1])).toEqual({
      governance_hash: "", committee: [C1], threshold: 1n, sealed: false, pending: null,
    });
  });
  it("ĐỎ: committee rỗng / trùng / khoá ngắn / threshold ngoài khoảng", () => {
    expect(() => assertCommitteeWellformed([], 1n)).toThrow(/PTR-COMMITTEE-001/);
    expect(() => assertCommitteeWellformed([C1, C1], 1n)).toThrow(/PTR-COMMITTEE-003/);
    expect(() => assertCommitteeWellformed(["c1c1"], 1n)).toThrow(/PTR-COMMITTEE-002/);
    expect(() => assertCommitteeWellformed([C1], 0n)).toThrow(/PTR-COMMITTEE-004/);
    expect(() => assertCommitteeWellformed([C1], 2n)).toThrow(/PTR-COMMITTEE-004/);
  });
});

describe("plan* — mirror governance_pointer.ak", () => {
  it("Propose: hạn = cận TRÊN + delay, mọi trường khác giữ", () => {
    expect(planPropose(d0, GOV_B, 2_000n, 3_600_000n)).toEqual({
      ...d0, pending: { new_hash: GOV_B, effective_after_ms: 3_602_000n },
    });
  });
  it("ĐỎ: Propose khi đã niêm phong / hash ngắn", () => {
    expect(() => planPropose({ ...d0, sealed: true }, GOV_B, 1n, 1n)).toThrow(/PTR-PROPOSE-001/);
    expect(() => planPropose(d0, "b0", 1n, 1n)).toThrow(/PTR-PROPOSE-002/);
  });
  it("Apply: tới hạn ⇒ governance_hash = new_hash, pending = null", () => {
    const p = { ...d0, pending: { new_hash: GOV_B, effective_after_ms: 5_000n } };
    expect(planApply(p, 5_000n)).toEqual({ ...d0, governance_hash: GOV_B });
    expect(() => planApply(p, 4_999n)).toThrow(/PTR-APPLY-002/);
    expect(() => planApply(d0, 9n)).toThrow(/PTR-APPLY-001/);
  });
  it("Cancel / Seal / GovernanceSet", () => {
    const p = { ...d0, pending: { new_hash: GOV_B, effective_after_ms: 5n } };
    expect(planCancel(p)).toEqual(d0);
    expect(() => planCancel(d0)).toThrow(/PTR-CANCEL-002/);
    expect(planSeal(d0)).toEqual({ ...d0, sealed: true });
    expect(() => planSeal({ ...d0, governance_hash: "" })).toThrow(/PTR-SEAL-002/);
    expect(() => planSeal(p)).toThrow(/PTR-SEAL-003/);
    expect(() => planSeal({ ...d0, sealed: true })).toThrow(/PTR-SEAL-001/);
    expect(planGovernanceSet({ ...p, sealed: true }, GOV_B))
      .toEqual({ ...d0, sealed: true, governance_hash: GOV_B });
    expect(() => planGovernanceSet({ ...d0, governance_hash: "" }, GOV_B)).toThrow(/PTR-GOVSET-001/);
  });
  it("currentGovernance: con trỏ rỗng ⇒ ném (Release bị từ chối on-chain)", () => {
    expect(currentGovernance(d0)).toBe(GOV_A);
    expect(() => currentGovernance(genesisPointerDatum([C1]))).toThrow(/PTR-READ-001/);
  });
});
