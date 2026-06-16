import { describe, it, expect } from "vitest";
import {
  type AssetMap, assetKey, lineKey, findLine, lineAmount,
  noDupLines, allLinesPositive, assetAccepted, potValue, potValueOk,
  planDepositLedger, applyDepositValue, depositLedgerOk, depositValueOk,
  planRefundLedger, applyRefundValue, refundLedgerOk, refundValueOk,
} from "../offchain/src/ledger.js";
import { planDeposit, planRefund, planEscheat } from "../offchain/src/builder.js";
import { validParam, requiredFor, lookupBase, Q } from "../offchain/src/schedule.js";
import {
  potDatumToCbor, potDatumFromCbor, depositsRedeemerToCbor, decodeDepositsRedeemer,
  depositParamToCbor, depositParamFromCbor,
} from "../offchain/src/datum.js";
import { Data } from "@lucid-evolution/lucid";
import type { PotDatum, DepositLine, DepositParam } from "../offchain/src/types.js";

// ── Fixtures ──
const LAMP_POLICY = "aabb".repeat(14); // 56 hex = 28 byte
const LAMP_NAME = "744c414d50";        // "LAMP"
const lampK = assetKey(LAMP_POLICY, LAMP_NAME);
const adaK = assetKey("", "");
const ALICE = "a11ce0";
const BOB = "b0b0";
const COUNCIL = "c011c1";
const TREASURY = "7a5c0001";
const E1 = "e1";
const E2 = "e2";
const RESERVED = 2_000_000n;
// phân loại demo.
const AT_CATTLE = 0n, VT_HIGH = 2n, LC_LONG = 2n;
const AT_PLANT = 1n, VT_LOW = 0n, LC_SHORT = 0n;
const ESCHEAT_AFTER = 6n;
const MS_PER_EPOCH = 86_400_000n;
// LỖ-2 — sàn freshness beacon. beacon() demo dùng epoch 5 → min = 5 (happy qua).
const MIN_PARAM_EPOCH = 5n;

function baseDatum(over: Partial<PotDatum> = {}): PotDatum {
  return {
    instance_id: "01",
    accepted_assets: [{ policy: "", name: "" }, { policy: LAMP_POLICY, name: LAMP_NAME }],
    lifecycle_authority: { kind: "VerificationKey", hash: COUNCIL },
    reserved_min_ada: RESERVED,
    deposit_param_policy: "9999",
    deposit_param_name: "5041524d",
    deposit_param_script_hash: "feed",
    treasury_credential: { kind: "VerificationKey", hash: TREASURY },
    escheat_after_epoch: ESCHEAT_AFTER,
    ms_per_epoch: MS_PER_EPOCH,
    min_param_epoch: MIN_PARAM_EPOCH,
    ledger: [],
    epoch: 10n,
    ...over,
  };
}

function lampLine(entity: string, depositor: string, amount: bigint, epoch = 10n): DepositLine {
  return {
    entity_id: entity, depositor, policy: LAMP_POLICY, name: LAMP_NAME, amount, epoch,
    asset_type: AT_CATTLE, value_tier: VT_HIGH, lifecycle_class: LC_LONG,
  };
}

// beacon: bò = `base` ở mult 1.0×; dưa leo = 0.
function beacon(base: bigint, mult: bigint = Q): DepositParam {
  return {
    tiers: [
      { asset_type: AT_PLANT, value_tier: VT_LOW, lifecycle_class: LC_SHORT, base_deposit: 0n },
      { asset_type: AT_CATTLE, value_tier: VT_HIGH, lifecycle_class: LC_LONG, base_deposit: base },
    ],
    demand_mult: mult, m_min: 0n, m_max: 2_000_000_000n, epoch: 5n,
  };
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
// DEPOSIT v2 — amount LẤY TỪ beacon (KHÔNG client mớm). planDeposit nhận beacon +
// phân loại; trả amount đã ÉP. depositLedgerOk/Value vẫn nhận amount để tự kiểm.
describe("DEPOSIT — plan động (beacon) + bất biến", () => {
  it("deposit bò: amount = beacon(1 LAMP), sổ +1 dòng, value +amount", () => {
    const d = baseDatum();
    const { newDatum, potAfter, amount } =
      planDeposit(d, potVal(0n), beacon(1_000_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, AT_CATTLE, VT_HIGH, LC_LONG, 11n);
    expect(amount).toBe(1_000_000n);
    expect(newDatum.ledger).toHaveLength(1);
    expect(lineAmount(newDatum.ledger, E1, ALICE, LAMP_POLICY, LAMP_NAME)).toBe(1_000_000n);
    expect(potAfter[lampK]).toBe(1_000_000n);
    expect(potAfter[adaK]).toBe(RESERVED); // ADA giữ nguyên
    expect(depositLedgerOk(d.ledger, newDatum.ledger, E1, ALICE, LAMP_POLICY, LAMP_NAME, 1_000_000n)).toBe(true);
    expect(depositValueOk(potVal(0n), potAfter, LAMP_POLICY, LAMP_NAME, 1_000_000n)).toBe(true);
  });

  it("deposit dưa leo: amount = 0 (cọc ≈ 0), KHÔNG ghi dòng (sổ giữ nguyên)", () => {
    const d = baseDatum();
    const { newDatum, potAfter, amount } =
      planDeposit(d, potVal(0n), beacon(1_000_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, AT_PLANT, VT_LOW, LC_SHORT, 11n);
    expect(amount).toBe(0n);
    expect(newDatum.ledger).toHaveLength(0);  // không ghi dòng
    expect(potAfter[lampK] ?? 0n).toBe(0n);   // value không tăng
  });

  it("deposit demand 2.0×: bò → 2 LAMP (DAO scale toàn bảng)", () => {
    const d = baseDatum();
    const { amount, potAfter } =
      planDeposit(d, potVal(0n), beacon(1_000_000n, 2_000_000_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, AT_CATTLE, VT_HIGH, LC_LONG, 11n);
    expect(amount).toBe(2_000_000n);
    expect(potAfter[lampK]).toBe(2_000_000n);
  });

  it("deposit cộng dồn cùng khóa: 1 dòng, không tách", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n)] });
    const { newDatum, potAfter } =
      planDeposit(d, potVal(1_000_000n), beacon(500_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, AT_CATTLE, VT_HIGH, LC_LONG, 11n);
    expect(newDatum.ledger).toHaveLength(1);
    expect(lineAmount(newDatum.ledger, E1, ALICE, LAMP_POLICY, LAMP_NAME)).toBe(1_500_000n);
    expect(potAfter[lampK]).toBe(1_500_000n);
  });

  it("deposit giữ NGUYÊN dòng người khác", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n)] });
    const { newDatum } =
      planDeposit(d, potVal(1_000_000n), beacon(700_000n), E2, BOB, LAMP_POLICY, LAMP_NAME, AT_CATTLE, VT_HIGH, LC_LONG, 11n);
    expect(newDatum.ledger).toHaveLength(2);
    expect(lineAmount(newDatum.ledger, E1, ALICE, LAMP_POLICY, LAMP_NAME)).toBe(1_000_000n);
    expect(lineAmount(newDatum.ledger, E2, BOB, LAMP_POLICY, LAMP_NAME)).toBe(700_000n);
  });

  it("ATK: phân loại không có trong bảng → ném DEP-007 (chống tier giả né phí)", () => {
    const d = baseDatum();
    expect(() => planDeposit(d, potVal(0n), beacon(1_000_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 9n, 9n, 9n, 11n)).toThrow(/DEP-007/);
  });

  it("ATK: beacon clamp sai (mult > m_max) → ném DEP-006", () => {
    const d = baseDatum();
    const bad: DepositParam = { ...beacon(1_000_000n), demand_mult: 3_000_000_000n };
    expect(() => planDeposit(d, potVal(0n), bad, E1, ALICE, LAMP_POLICY, LAMP_NAME, AT_CATTLE, VT_HIGH, LC_LONG, 11n)).toThrow(/DEP-006/);
  });

  it("deposit asset không accepted ném lỗi", () => {
    const d = baseDatum();
    expect(() => planDeposit(d, potVal(0n), beacon(100n), E1, ALICE, "dead", "beef", AT_CATTLE, VT_HIGH, LC_LONG, 11n)).toThrow(/DEP-002/);
  });

  it("LỖ-2 ATK: beacon stale (epoch < min_param_epoch) → ném DEP-010", () => {
    const d = baseDatum({ min_param_epoch: 5n });
    // beacon epoch 4 < min 5 → bind bảng phí cũ → reject.
    const stale: DepositParam = { ...beacon(1_000_000n), epoch: 4n };
    expect(() => planDeposit(d, potVal(0n), stale, E1, ALICE, LAMP_POLICY, LAMP_NAME, AT_CATTLE, VT_HIGH, LC_LONG, 11n)).toThrow(/DEP-010/);
  });

  it("LỖ-2 HAPPY: beacon epoch == min_param_epoch → fresh → qua", () => {
    const d = baseDatum({ min_param_epoch: 5n });
    const fresh: DepositParam = { ...beacon(1_000_000n), epoch: 5n };
    const { amount } = planDeposit(d, potVal(0n), fresh, E1, ALICE, LAMP_POLICY, LAMP_NAME, AT_CATTLE, VT_HIGH, LC_LONG, 11n);
    expect(amount).toBe(1_000_000n);
  });

  it("deposit epoch lùi ném lỗi", () => {
    const d = baseDatum();
    expect(() => planDeposit(d, potVal(0n), beacon(100n), E1, ALICE, LAMP_POLICY, LAMP_NAME, AT_CATTLE, VT_HIGH, LC_LONG, 9n)).toThrow(/DEP-003/);
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

  it("cọc 0 mà ghi dòng khống → depositLedgerOk false (V2-ATK-5)", () => {
    const d = baseDatum();
    const phantom = [lampLine(E1, ALICE, 1n)];
    expect(depositLedgerOk(d.ledger, phantom, E1, ALICE, LAMP_POLICY, LAMP_NAME, 0n)).toBe(false);
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
// SCHEDULE v2 — phí cọc từ beacon (mirror schedule.ak)
describe("SCHEDULE — required từ DepositParam beacon", () => {
  it("dưa leo → 0 ở mọi mult", () => {
    expect(requiredFor(beacon(50_000_000n), AT_PLANT, VT_LOW, LC_SHORT)).toBe(0n);
    expect(requiredFor(beacon(50_000_000n, 2_000_000_000n), AT_PLANT, VT_LOW, LC_SHORT)).toBe(0n);
  });
  it("bò mult 1.0× → base; mult 2.0× → 2×base", () => {
    expect(requiredFor(beacon(50_000_000n), AT_CATTLE, VT_HIGH, LC_LONG)).toBe(50_000_000n);
    expect(requiredFor(beacon(50_000_000n, 2_000_000_000n), AT_CATTLE, VT_HIGH, LC_LONG)).toBe(100_000_000n);
  });
  it("phân loại không có trong bảng → undefined", () => {
    expect(requiredFor(beacon(1n), 9n, 9n, 9n)).toBeUndefined();
    expect(lookupBase(beacon(1n).tiers, 9n, 9n, 9n)).toBeUndefined();
  });
  it("validParam: clamp + base ≥ 0", () => {
    expect(validParam(beacon(1_000_000n))).toBe(true);
    expect(validParam({ ...beacon(1n), demand_mult: 3_000_000_000n })).toBe(false);
    expect(validParam({ ...beacon(1n), tiers: [{ asset_type: 0n, value_tier: 0n, lifecycle_class: 0n, base_deposit: -1n }] })).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// ESCHEAT v2 — DID mồ côi quá hạn → value về Treasury
describe("ESCHEAT — plan + bất biến", () => {
  it("escheat đủ hạn: dòng XÓA, value −amount (về Treasury)", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n, 10n)] });
    const { newDatum, potAfter, escheatAmount } =
      planEscheat(d, potVal(1_000_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 16n, 16n);  // 16 = 10+6
    expect(escheatAmount).toBe(1_000_000n);
    expect(newDatum.ledger).toHaveLength(0);
    expect(potAfter[lampK] ?? 0n).toBe(0n);
  });

  it("escheat giữ NGUYÊN dòng người khác", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n, 5n), lampLine(E2, BOB, 700_000n, 5n)] });
    const { newDatum } = planEscheat(d, potVal(1_700_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 20n, 20n);
    expect(newDatum.ledger).toHaveLength(1);
    expect(lineAmount(newDatum.ledger, E2, BOB, LAMP_POLICY, LAMP_NAME)).toBe(700_000n);
  });

  it("ATK: escheat SỚM (cur < dep+after) → ném ESC-004", () => {
    const d = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n, 10n)] });
    expect(() => planEscheat(d, potVal(1_000_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 15n, 15n)).toThrow(/ESC-004/);
  });

  it("ATK: escheat dòng không tồn tại (phantom) → ném ESC-001", () => {
    const d = baseDatum();
    expect(() => planEscheat(d, potVal(0n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 99n, 99n)).toThrow(/ESC-001/);
  });

  it("ATK: escheat-then-refund double → refund dòng đã xóa ném REF-001", () => {
    const d0 = baseDatum({ ledger: [lampLine(E1, ALICE, 1_000_000n, 10n)] });
    const { newDatum } = planEscheat(d0, potVal(1_000_000n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 16n, 16n);
    const d1 = { ...d0, ledger: newDatum.ledger };
    expect(() => planRefund(d1, potVal(0n), E1, ALICE, LAMP_POLICY, LAMP_NAME, 17n)).toThrow(/REF-001/);
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

  it("Deposit redeemer round-trip + Constr index 0 (v2: phân loại + deposit_ref)", () => {
    const r = {
      kind: "Deposit" as const, entity_id: E1, depositor: ALICE, policy: LAMP_POLICY, name: LAMP_NAME,
      asset_type: AT_CATTLE, value_tier: VT_HIGH, lifecycle_class: LC_LONG,
      deposit_ref: { txHash: "bb".repeat(32), index: 9n },
    };
    const cbor = depositsRedeemerToCbor(r);
    expect(decodeDepositsRedeemer(Data.from(cbor))).toEqual(r);
  });

  it("Refund redeemer round-trip + Constr index 1", () => {
    const r = { kind: "Refund" as const, entity_id: E1, depositor: ALICE, policy: LAMP_POLICY, name: LAMP_NAME };
    const cbor = depositsRedeemerToCbor(r);
    expect(decodeDepositsRedeemer(Data.from(cbor))).toEqual(r);
  });

  it("Escheat redeemer round-trip + Constr index 2", () => {
    const r = { kind: "Escheat" as const, entity_id: E1, depositor: ALICE, policy: LAMP_POLICY, name: LAMP_NAME };
    const cbor = depositsRedeemerToCbor(r);
    expect(decodeDepositsRedeemer(Data.from(cbor))).toEqual(r);
  });

  it("DepositParam beacon round-trip (tiers + clamp)", () => {
    const p = beacon(50_000_000n, 1_500_000_000n);
    expect(depositParamFromCbor(depositParamToCbor(p))).toEqual(p);
  });
});
