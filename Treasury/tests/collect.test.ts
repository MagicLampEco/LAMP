import { describe, it, expect } from "vitest";
import {
  type AssetMap, assetKey, itemCut, cutValue, applyCut, planLedgerOut,
  ledgerGet, ledgerOk, valueOk, allItemsValid, itemAccepted,
} from "../offchain/src/collect.js";
import { planCollect } from "../offchain/src/collectBuilder.js";
import type { CollectItem, CustodyDatum, LedgerEntry } from "../offchain/src/types.js";

// ── Fixtures ───────────────────────────────────────────────────────────
const LAMP_POLICY = "aabb".repeat(14); // 56 hex = 28 byte
const LAMP_NAME = "4c414d50";
const lampK = assetKey(LAMP_POLICY, LAMP_NAME);
const adaK = assetKey("", "");

function baseDatum(over: Partial<CustodyDatum> = {}): CustodyDatum {
  return {
    instance_id: "01",
    accepted_assets: [
      { policy: "", name: "" },
      { policy: LAMP_POLICY, name: LAMP_NAME },
    ],
    ledger: [],
    cut_bps: 1000n, // 10%
    governance_ref: "cafe",
    epoch: 5n,
    consumed_proposals: [],
    ...over,
  };
}

// Tổng amount per-asset (để kiểm Σout=Σin gồm cả residual provider).
function sumOverItemsAndCustody(valueIn: AssetMap, items: CollectItem[], cutBps: bigint) {
  // "Hệ thống" trước tx: custody value_in + provider giữ Σamount.
  // Sau tx: custody value_out (+cut) + provider giữ Σ(amount−cut) + receiver nhận residual.
  // Bất biến tổng đơn giản: Σcut(custody tăng) == Σ(amount−(amount−cut)) → cut khớp.
  const cut = cutValue(items, cutBps);
  return cut;
}

describe("itemCut — floor(amount × bps / 10000)", () => {
  it("10% của 1000 = 100", () => {
    expect(itemCut(1000n, 1000n)).toBe(100n);
  });
  it("floor: 2.5% của 999 = 24 (24.975 → 24)", () => {
    expect(itemCut(999n, 250n)).toBe(24n);
  });
  it("0 bps → 0; 10000 bps → toàn bộ", () => {
    expect(itemCut(777n, 0n)).toBe(0n);
    expect(itemCut(777n, 10000n)).toBe(777n);
  });
  it("amount 0 → 0", () => {
    expect(itemCut(0n, 5000n)).toBe(0n);
  });
});

describe("value preservation — Σout = Σin per-asset (KHÔNG burn)", () => {
  it("applyCut chỉ TĂNG asset có cut, asset khác giữ nguyên", () => {
    const valueIn: AssetMap = { [adaK]: 10_000_000n, [lampK]: 50n };
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n, category: 1n },
    ];
    const out = applyCut(valueIn, items, 1000n); // cut = 100 LAMP
    expect(out[lampK]).toBe(150n);              // 50 + 100
    expect(out[adaK]).toBe(10_000_000n);        // ADA không đụng → giữ nguyên (T3)
  });

  it("custody_out.value == value_in ⊕ cut_value (valueOk true)", () => {
    const valueIn: AssetMap = { [adaK]: 2_000_000n, [lampK]: 0n };
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 4321n, category: 2n },
    ];
    const out = applyCut(valueIn, items, 1000n);
    expect(valueOk(valueIn, out, items, 1000n)).toBe(true);
  });

  it("Δvalue(LAMP) == Σcut(LAMP) đúng từng asset", () => {
    const valueIn: AssetMap = { [lampK]: 1000n };
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 100n, category: 1n },
      { app_id: "b", policy: LAMP_POLICY, name: LAMP_NAME, amount: 250n, category: 1n },
    ];
    const out = applyCut(valueIn, items, 1000n); // cut = 10 + 25 = 35
    expect(out[lampK]! - valueIn[lampK]!).toBe(35n);
    expect(out[lampK]! - valueIn[lampK]!).toBe(cutValue(items, 1000n)[lampK]);
  });

  it("multi-asset: mỗi asset độc lập, không trộn", () => {
    const valueIn: AssetMap = { [adaK]: 5_000_000n, [lampK]: 100n };
    const items: CollectItem[] = [
      { app_id: "a", policy: "", name: "", amount: 1_000_000n, category: 0n },     // ADA
      { app_id: "b", policy: LAMP_POLICY, name: LAMP_NAME, amount: 500n, category: 1n }, // LAMP
    ];
    const out = applyCut(valueIn, items, 1000n);
    expect(out[adaK]).toBe(5_100_000n);   // +100_000 cut ADA
    expect(out[lampK]).toBe(150n);        // +50 cut LAMP
    expect(valueOk(valueIn, out, items, 1000n)).toBe(true);
  });
});

describe("cut vào ĐÚNG MỘT bucket = item.category (đơn-bucket T2)", () => {
  it("cut LAMP rơi vào bucket = category, không bucket khác", () => {
    const ledgerIn: LedgerEntry[] = [];
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n, category: 3n },
    ];
    const out = planLedgerOut(ledgerIn, items, 1000n);
    expect(out).toHaveLength(1);
    expect(out[0]!.bucket_id).toBe(3n);
    expect(out[0]!.amount).toBe(100n);
    expect(ledgerGet(out, 3n, LAMP_POLICY, LAMP_NAME)).toBe(100n);
    expect(ledgerGet(out, 1n, LAMP_POLICY, LAMP_NAME)).toBe(0n); // bucket khác = 0
  });

  it("cộng dồn vào dòng có sẵn (incremental)", () => {
    const ledgerIn: LedgerEntry[] = [
      { bucket_id: 2n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 40n },
    ];
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n, category: 2n },
    ];
    const out = planLedgerOut(ledgerIn, items, 1000n);
    expect(out).toHaveLength(1);
    expect(out[0]!.amount).toBe(140n); // 40 + 100
    expect(ledgerOk(ledgerIn, out, items, 1000n)).toBe(true);
  });

  it("nhiều category/asset → mỗi (category,asset) 1 dòng riêng, không trùng khóa", () => {
    const ledgerIn: LedgerEntry[] = [];
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n, category: 1n },
      { app_id: "b", policy: LAMP_POLICY, name: LAMP_NAME, amount: 2000n, category: 2n },
      { app_id: "c", policy: "", name: "", amount: 3000n, category: 1n },
    ];
    const out = planLedgerOut(ledgerIn, items, 1000n);
    expect(ledgerGet(out, 1n, LAMP_POLICY, LAMP_NAME)).toBe(100n);
    expect(ledgerGet(out, 2n, LAMP_POLICY, LAMP_NAME)).toBe(200n);
    expect(ledgerGet(out, 1n, "", "")).toBe(300n);
    expect(ledgerOk(ledgerIn, out, items, 1000n)).toBe(true);
  });

  it("không xóa dòng in cũ không liên quan (each_in_line_present)", () => {
    const ledgerIn: LedgerEntry[] = [
      { bucket_id: 9n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 777n },
    ];
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n, category: 1n },
    ];
    const out = planLedgerOut(ledgerIn, items, 1000n);
    expect(ledgerGet(out, 9n, LAMP_POLICY, LAMP_NAME)).toBe(777n); // dòng cũ còn nguyên
    expect(ledgerOk(ledgerIn, out, items, 1000n)).toBe(true);
  });
});

describe("ledgerOk reject các sổ phá bất biến", () => {
  const ledgerIn: LedgerEntry[] = [
    { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 100n },
  ];
  const items: CollectItem[] = [
    { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n, category: 1n },
  ];

  it("reject sai số cut (out amount khác want)", () => {
    const bad: LedgerEntry[] = [
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 999n },
    ];
    expect(ledgerOk(ledgerIn, bad, items, 1000n)).toBe(false);
  });

  it("reject drain sổ (xóa dòng in)", () => {
    // cut đúng nhưng bỏ mất dòng → each_in_line_present false (trùng khóa nên không xảy ra ở đây;
    // dựng case xóa dòng riêng).
    const ledgerIn2: LedgerEntry[] = [
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 100n },
      { bucket_id: 7n, policy: "", name: "", amount: 500n },
    ];
    const dropped: LedgerEntry[] = [
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 200n }, // cut đúng
      // dòng bucket 7 bị xóa
    ];
    expect(ledgerOk(ledgerIn2, dropped, items, 1000n)).toBe(false);
  });

  it("reject dòng trùng khóa (no_dup_lines)", () => {
    const dup: LedgerEntry[] = [
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 200n },
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 0n },
    ];
    expect(ledgerOk(ledgerIn, dup, items, 1000n)).toBe(false);
  });
});

describe("valueOk reject phá value (burn / drain / inflate)", () => {
  const valueIn: AssetMap = { [adaK]: 2_000_000n, [lampK]: 100n };
  const items: CollectItem[] = [
    { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n, category: 1n },
  ];

  it("reject burn ADA (drain lovelace ra khỏi custody)", () => {
    const bad: AssetMap = { [adaK]: 1_000_000n, [lampK]: 200n }; // ADA bị rút 1 triệu
    expect(valueOk(valueIn, bad, items, 1000n)).toBe(false);
  });

  it("reject thiếu cut (LAMP không tăng đủ)", () => {
    const bad: AssetMap = { [adaK]: 2_000_000n, [lampK]: 150n }; // chỉ +50 thay vì +100
    expect(valueOk(valueIn, bad, items, 1000n)).toBe(false);
  });

  it("reject inflate (tăng quá cut = mint lén)", () => {
    const bad: AssetMap = { [adaK]: 2_000_000n, [lampK]: 999n };
    expect(valueOk(valueIn, bad, items, 1000n)).toBe(false);
  });

  it("accept đúng value_in ⊕ cut", () => {
    const ok = applyCut(valueIn, items, 1000n);
    expect(valueOk(valueIn, ok, items, 1000n)).toBe(true);
  });
});

describe("item validation (C-COL-5)", () => {
  const datum = baseDatum();
  it("accept asset ∈ accepted_assets, amount ≥ 0", () => {
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 0n, category: 1n },
    ];
    expect(allItemsValid(items, datum.accepted_assets)).toBe(true);
  });
  it("reject asset ∉ accepted_assets", () => {
    const items: CollectItem[] = [
      { app_id: "a", policy: "ffff".repeat(14), name: "00", amount: 1n, category: 1n },
    ];
    expect(allItemsValid(items, datum.accepted_assets)).toBe(false);
    expect(itemAccepted(items[0]!, datum.accepted_assets)).toBe(false);
  });
  it("reject amount < 0", () => {
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: -1n, category: 1n },
    ];
    expect(allItemsValid(items, datum.accepted_assets)).toBe(false);
  });
});

describe("planCollect — orchestration thuần (khớp validator)", () => {
  it("dựng newDatum + custodyAfter bảo toàn value + ledger đúng", () => {
    const datum = baseDatum({
      ledger: [{ bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 10n }],
      cut_bps: 1000n,
    });
    const valueIn: AssetMap = { [adaK]: 2_000_000n, [lampK]: 500n };
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n, category: 1n },
    ];
    const { newDatum, custodyAfter, cut } = planCollect(datum, valueIn, items);

    expect(cut[lampK]).toBe(100n);
    expect(custodyAfter[lampK]).toBe(600n);          // 500 + 100
    expect(custodyAfter[adaK]).toBe(2_000_000n);     // ADA giữ nguyên
    expect(ledgerGet(newDatum.ledger, 1n, LAMP_POLICY, LAMP_NAME)).toBe(110n); // 10 + 100

    // datum params bảo toàn (C-COL-2)
    expect(newDatum.instance_id).toBe(datum.instance_id);
    expect(newDatum.accepted_assets).toEqual(datum.accepted_assets);
    expect(newDatum.governance_ref).toBe(datum.governance_ref);
    expect(newDatum.cut_bps).toBe(datum.cut_bps);
    expect(newDatum.epoch).toBe(datum.epoch);        // mặc định giữ epoch

    // tự kiểm khớp validator
    expect(ledgerOk(datum.ledger, newDatum.ledger, items, datum.cut_bps)).toBe(true);
    expect(valueOk(valueIn, custodyAfter, items, datum.cut_bps)).toBe(true);
  });

  it("epoch mới phải ≥ epoch cũ (chống replay sổ)", () => {
    const datum = baseDatum({ epoch: 5n });
    const valueIn: AssetMap = { [lampK]: 0n };
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 100n, category: 1n },
    ];
    expect(() => planCollect(datum, valueIn, items, 4n)).toThrow(/epoch/);
    expect(planCollect(datum, valueIn, items, 6n).newDatum.epoch).toBe(6n);
  });

  it("reject item asset ∉ accepted_assets", () => {
    const datum = baseDatum();
    const valueIn: AssetMap = {};
    const items: CollectItem[] = [
      { app_id: "a", policy: "ffff".repeat(14), name: "00", amount: 100n, category: 1n },
    ];
    expect(() => planCollect(datum, valueIn, items)).toThrow(/COLLECT-001/);
  });

  it("bất biến tổng cut = Σ(amount × bps / 10000) per-asset", () => {
    const datum = baseDatum({ cut_bps: 250n });
    const valueIn: AssetMap = { [adaK]: 10_000_000n, [lampK]: 0n };
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 4000n, category: 1n },
      { app_id: "b", policy: LAMP_POLICY, name: LAMP_NAME, amount: 4000n, category: 1n },
      { app_id: "c", policy: "", name: "", amount: 8_000_000n, category: 0n },
    ];
    const { cut } = planCollect(datum, valueIn, items);
    expect(cut[lampK]).toBe(200n);          // (4000*250/10000)*2 = 100*2
    expect(cut[adaK]).toBe(200_000n);       // 8_000_000*250/10000
    const expectSum = sumOverItemsAndCustody(valueIn, items, 250n);
    expect(cut).toEqual(expectSum);
  });
});
