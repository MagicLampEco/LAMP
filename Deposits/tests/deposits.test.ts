import { describe, it, expect } from "vitest";
import {
  type AssetMap, assetKey, lineKey, findLine, lineAmount,
  noDupLines, allLinesPositive, assetAccepted, potValue, potValueOk,
  planDepositLedger, applyDepositValue, depositLedgerOk, depositValueOk,
  planRefundLedger, applyRefundValue, refundLedgerOk, refundValueOk,
} from "../offchain/src/ledger.js";
import { planDeposit, planRefund } from "../offchain/src/builder.js";
import {
  potDatumToCbor, potDatumFromCbor, depositsRedeemerToCbor, decodeDepositsRedeemer,
} from "../offchain/src/datum.js";
import { Data } from "@lucid-evolution/lucid";
import type { PotDatum, DepositLine } from "../offchain/src/types.js";

// ── Fixtures ──
const LAMP_POLICY = "aabb".repeat(14); // 56 hex = 28 byte
const LAMP_NAME = "744c414d50";        // "LAMP"
const lampK = assetKey(LAMP_POLICY, LAMP_NAME);
const adaK = assetKey("", "");
const ALICE = "a11ce0";
const BOB = "b0b0";
const COUNCIL = "c011c1";
const E1 = "e1";
const E2 = "e2";
const RESERVED = 2_000_000n;

function baseDatum(over: Partial<PotDatum> = {}): PotDatum {
  return {
    instance_id: "01",
    accepted_assets: [{ policy: "", name: "" }, { policy: LAMP_POLICY, name: LAMP_NAME }],
    lifecycle_authority: { kind: "VerificationKey", hash: COUNCIL },
    reserved_min_ada: RESERVED,
    ledger: [],
    epoch: 10n,
    ...over,
  };
}

function lampLine(entity: string, depositor: string, amount: bigint): DepositLine {
  return { entity_id: entity, depositor, policy: LAMP_POLICY, name: LAMP_NAME, amount, epoch: 10n };
}

// pot value = reserved + lamp bond.
function potVal(lamp: bigint): AssetMap {
  const m: AssetMap = { [adaK]: RESERVED };
  if (lamp !== 0n) m[lampK] = lamp;
  return m;
}

// ════════════════════════════════════════════════════════════
describe("itemCut/assetKey/lineKey helpers", () => {
  it("lineKey phân biệt entity + depositor + asset", () => {
    expect(lineKey(E1, ALICE, LAMP_POLICY, LAMP_NAME)).not.toBe(lineKey(E2, ALICE, LAMP_POLICY, LAMP_NAME));
    expect(lineKey(E1, ALICE, LAMP_POLICY, LAMP_NAME)).not.toBe(lineKey(E1, BOB, LAMP_POLICY, LAMP_NAME));
  });
  it("assetAccepted nhận đúng asset", () => {
    expect(assetAccepted(LAMP_POLICY, LAMP_NAME, baseDatum().accepted_assets)).toBe(true);
    expect(assetAccepted("dead", "beef", baseDatum().accepted_assets)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
describe("DEPOSIT — plan + bất biến", () => {
  it("deposit mới: sổ +1 dòng, value +amount", () => {
    const d = baseDatum();
    const { newDatum, potAfter } = planDeposit(d, potVal(0n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 1_000_000n, 11n);
    expect(newDatum.ledger).toHaveLength(1);
    expect(lineAmount(newDatum.ledger, E1, ALICE, LAMP_POLICY, LAMP_NAME)).toBe(1_000_000n);
    expect(potAfter[lampK]).toBe(1_000_000n);
    expect(potAfter[adaK]).toBe(RESERVED); // ADA giữ nguyên
    expect(depositLedgerOk(d.ledger, newDatum.ledger, E1, ALICE, LAMP_POLICY, LAMP_NAME, 1_000_000n)).toBe(true);
    expect(depositValueOk(potVal(0n), potAfter, LAMP_POLICY, LAMP_NAME, 1_000_000n)).toBe(true);
  });

  it("deposit cộng dồn cùng khóa: 1 dòng, không tách", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n)] });
    const { newDatum, potAfter } = planDeposit(d, potVal(1_000_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 500_000n, 11n);
    expect(newDatum.ledger).toHaveLength(1);
    expect(lineAmount(newDatum.ledger, E1, ALICE, LAMP_POLICY, LAMP_NAME)).toBe(1_500_000n);
    expect(potAfter[lampK]).toBe(1_500_000n);
  });

  it("deposit giữ NGUYÊN dòng người khác", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n)] });
    const { newDatum } = planDeposit(d, potVal(1_000_000n), E2, BOB, LAMP_POLICY, LAMP_NAME, 700_000n, 11n);
    expect(newDatum.ledger).toHaveLength(2);
    expect(lineAmount(newDatum.ledger, E1, ALICE, LAMP_POLICY, LAMP_NAME)).toBe(1_000_000n);
    expect(lineAmount(newDatum.ledger, E2, BOB, LAMP_POLICY, LAMP_NAME)).toBe(700_000n);
  });

  it("deposit amount ≤ 0 ném lỗi (A4)", () => {
    const d = baseDatum();
    expect(() => planDeposit(d, potVal(0n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 0n, 11n)).toThrow(/DEP-001/);
    expect(() => planDeposit(d, potVal(0n), E1, ALICE, LAMP_POLICY, LAMP_NAME, -5n, 11n)).toThrow(/DEP-001/);
  });

  it("deposit asset không accepted ném lỗi", () => {
    const d = baseDatum();
    expect(() => planDeposit(d, potVal(0n), E1, ALICE, "dead", "beef", 100n, 11n)).toThrow(/DEP-002/);
  });

  it("deposit epoch lùi ném lỗi", () => {
    const d = baseDatum();
    expect(() => planDeposit(d, potVal(0n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 100n, 9n)).toThrow(/DEP-003/);
  });

  it("phantom value: dòng +amount nhưng value không tăng → depositValueOk false (A5)", () => {
    const d = baseDatum();
    const ledgerOut = [lampLine(E1, ALICE, 1_000_000n)];
    // value KHÔNG tăng (vẫn potVal(0)).
    expect(depositValueOk(potVal(0n), potVal(0n), LAMP_POLICY, LAMP_NAME, 1_000_000n)).toBe(false);
    expect(depositLedgerOk(d.ledger, ledgerOut, E1, ALICE, LAMP_POLICY, LAMP_NAME, 1_000_000n)).toBe(true);
  });

  it("dup line: 2 dòng cùng khóa → depositLedgerOk false (A17)", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n)] });
    const bad = [lampLine(E1, ALICE, 1_000_000n), lampLine(E1, ALICE, 500_000n)];
    expect(depositLedgerOk(d.ledger, bad, E1, ALICE, LAMP_POLICY, LAMP_NAME, 500_000n)).toBe(false);
  });

  it("value tăng mà sổ không cập nhật → depositLedgerOk false (AUDIT-1)", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n)] });
    const unchanged = [lampLine(E1, ALICE, 1_000_000n)];
    expect(depositLedgerOk(d.ledger, unchanged, E1, ALICE, LAMP_POLICY, LAMP_NAME, 500_000n)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
describe("REFUND — plan + bất biến", () => {
  it("refund bởi depositor: dòng XÓA, value −amount", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n)] });
    const { newDatum, potAfter, refundAmount } = planRefund(d, potVal(1_000_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 11n);
    expect(refundAmount).toBe(1_000_000n);
    expect(newDatum.ledger).toHaveLength(0);
    expect(potAfter[lampK] ?? 0n).toBe(0n);
    expect(potAfter[adaK]).toBe(RESERVED);
    expect(refundLedgerOk(d.ledger, newDatum.ledger, E1, ALICE, LAMP_POLICY, LAMP_NAME)).toBe(true);
    expect(refundValueOk(potVal(1_000_000n), potAfter, LAMP_POLICY, LAMP_NAME, 1_000_000n)).toBe(true);
  });

  it("refund giữ NGUYÊN dòng người khác (A14)", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n), lampLine(E2, BOB, 700_000n)] });
    const { newDatum } = planRefund(d, potVal(1_700_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 11n);
    expect(newDatum.ledger).toHaveLength(1);
    expect(lineAmount(newDatum.ledger, E2, BOB, LAMP_POLICY, LAMP_NAME)).toBe(700_000n);
  });

  it("refund-chưa-deposit ném lỗi (A8)", () => {
    const d = baseDatum();
    expect(() => planRefund(d, potVal(0n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 11n)).toThrow(/REF-001/);
  });

  it("double-refund: dòng đã xóa → lần 2 ném REF-001 (A1)", () => {
    const d0 = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n)] });
    const { newDatum } = planRefund(d0, potVal(1_000_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 11n);
    const d1 = { ...d0, ledger: newDatum.ledger };
    expect(() => planRefund(d1, potVal(0n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 12n)).toThrow(/REF-001/);
  });

  it("refund không xóa dòng → refundLedgerOk false (A1b)", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n)] });
    const keep = [lampLine(E1, ALICE, 1_000_000n)];
    expect(refundLedgerOk(d.ledger, keep, E1, ALICE, LAMP_POLICY, LAMP_NAME)).toBe(false);
  });

  it("refund tamper dòng khác → refundLedgerOk false (A14)", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n), lampLine(E2, BOB, 700_000n)] });
    const tampered = [lampLine(E2, BOB, 9_000_000n)]; // bob bị bơm
    expect(refundLedgerOk(d.ledger, tampered, E1, ALICE, LAMP_POLICY, LAMP_NAME)).toBe(false);
  });

  it("refund over-amount → refundValueOk false khi value giảm > số dư (A3)", () => {
    // value giảm 2_000_000 nhưng refundAmount đọc từ sổ = 1_000_000.
    const after = applyRefundValue(potVal(2_000_000n), LAMP_POLICY, LAMP_NAME, 1_000_000n);
    // pot thực tế out = potVal(0) (giảm 2M) ≠ after (giảm 1M) → false.
    expect(refundValueOk(potVal(2_000_000n), potVal(0n), LAMP_POLICY, LAMP_NAME, 1_000_000n)).toBe(false);
    expect(after[lampK]).toBe(1_000_000n);
  });

  it("refund xóa sổ nhưng giữ value → refundValueOk false (AUDIT-3)", () => {
    expect(refundValueOk(potVal(1_000_000n), potVal(1_000_000n), LAMP_POLICY, LAMP_NAME, 1_000_000n)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
describe("value preservation — Σ bảo toàn (KHÔNG burn)", () => {
  it("deposit chỉ tăng asset đụng, asset khác giữ nguyên", () => {
    const valueIn: AssetMap = { [adaK]: RESERVED, [lampK]: 50n };
    const after = applyDepositValue(valueIn, LAMP_POLICY, LAMP_NAME, 100n);
    expect(after[lampK]).toBe(150n);
    expect(after[adaK]).toBe(RESERVED);
  });
  it("potValueOk: value == ledgerValue ⊕ reserved", () => {
    const ledger = [lampLine(E1, ALICE, 1_000_000n), lampLine(E2, BOB, 700_000n)];
    const v = potValue(ledger, RESERVED);
    expect(v[lampK]).toBe(1_700_000n);
    expect(potValueOk(v, ledger, RESERVED)).toBe(true);
    expect(potValueOk({ ...v, [lampK]: 999n }, ledger, RESERVED)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
describe("codec — round-trip byte-perfect (mirror onchain Constr)", () => {
  it("PotDatum round-trip", () => {
    const d = baseDatum({
      ledger: [lampLine(E1, ALICE, 1_000_000n)],
      lifecycle_authority: { kind: "Script", hash: "5c5c5c5c" },
    });
    const cbor = potDatumToCbor(d);
    const back = potDatumFromCbor(cbor);
    expect(back).toEqual(d);
  });

  it("PotDatum với authority VK round-trip", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n), lampLine(E2, BOB, 700_000n)] });
    expect(potDatumFromCbor(potDatumToCbor(d))).toEqual(d);
  });

  it("Deposit redeemer round-trip + Constr index 0", () => {
    const r = { kind: "Deposit" as const, entity_id: E1, depositor: ALICE, policy: LAMP_POLICY, name: LAMP_NAME, amount: 1_000_000n };
    const cbor = depositsRedeemerToCbor(r);
    expect(decodeDepositsRedeemer(Data.from(cbor))).toEqual(r);
  });

  it("Refund redeemer round-trip + Constr index 1", () => {
    const r = { kind: "Refund" as const, entity_id: E1, depositor: ALICE, policy: LAMP_POLICY, name: LAMP_NAME };
    const cbor = depositsRedeemerToCbor(r);
    expect(decodeDepositsRedeemer(Data.from(cbor))).toEqual(r);
  });
});
