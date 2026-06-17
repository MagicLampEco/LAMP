import { describe, it, expect } from "vitest";
import {
  type ValueUtxo,
  treasuryHeld, circulatingSupply, treasuryHeldByBucket, ledgerHeld,
  reconcileCustody, reconcileHeld, circulatingByAsset, utxoAssetAmount,
} from "../offchain/src/circulating.js";
import { assetKey } from "../offchain/src/collect.js";
import { planCollect } from "../offchain/src/collectBuilder.js";
import { assetsToMap } from "../offchain/src/collectBuilder.js";
import type { CollectItem, CustodyDatum } from "../offchain/src/types.js";

// ── Fixtures ───────────────────────────────────────────────────────────
const LAMP_POLICY = "aabb".repeat(14); // 56 hex = 28 byte
const LAMP_NAME = "4c414d50";          // "LAMP"
const LAMP_UNIT = `${LAMP_POLICY}${LAMP_NAME}`.toLowerCase();
const lampK = assetKey(LAMP_POLICY, LAMP_NAME);
const adaK = assetKey("", "");

// LAMP fixed-supply: 36 tỷ × 10^6 (6 decimals giả định cho fixture).
const TOTAL_SUPPLY = 36_000_000_000n * 1_000_000n;

const OTHER_POLICY = "ccdd".repeat(14);
const OTHER_NAME = "00";
const OTHER_UNIT = `${OTHER_POLICY}${OTHER_NAME}`.toLowerCase();

/** Dựng custody UTxO chỉ-value (ValueUtxo) — lovelace + (tuỳ chọn) LAMP + asset khác. */
function custodyUtxo(lovelace: bigint, lamp: bigint, other = 0n): ValueUtxo {
  const assets: Record<string, bigint> = { lovelace };
  if (lamp !== 0n) assets[LAMP_UNIT] = lamp;
  if (other !== 0n) assets[OTHER_UNIT] = other;
  return { assets };
}

function baseDatum(over: Partial<CustodyDatum> = {}): CustodyDatum {
  return {
    instance_id: "01",
    accepted_assets: [
      { policy: "", name: "" },
      { policy: LAMP_POLICY, name: LAMP_NAME },
    ],
    ledger: [],
    cut_bps: 1000n,
    governance_ref: "cafe",
    epoch: 5n,
    consumed_proposals: [],
    ...over,
  };
}

// ── treasuryHeld — Σ trên nhiều custody UTxO (đa shard) ─────────────────
describe("treasuryHeld — Σ LAMP trên mọi custody UTxO (đa shard)", () => {
  it("1 custody UTxO", () => {
    const utxos = [custodyUtxo(2_000_000n, 5_000n)];
    expect(treasuryHeld(utxos, LAMP_POLICY, LAMP_NAME)).toBe(5_000n);
  });

  it("nhiều shard cộng tổng", () => {
    const utxos = [
      custodyUtxo(2_000_000n, 5_000n),
      custodyUtxo(2_000_000n, 3_000n),
      custodyUtxo(1_500_000n, 1_000n),
    ];
    expect(treasuryHeld(utxos, LAMP_POLICY, LAMP_NAME)).toBe(9_000n);
  });

  it("không double-count đa-asset: chỉ cộng đúng LAMP, bỏ ADA + asset khác", () => {
    // UTxO mang lovelace + LAMP + OTHER cùng lúc.
    const utxos = [custodyUtxo(10_000_000n, 7_000n, 999n)];
    expect(treasuryHeld(utxos, LAMP_POLICY, LAMP_NAME)).toBe(7_000n);   // chỉ LAMP
    expect(treasuryHeld(utxos, "", "")).toBe(10_000_000n);             // lovelace riêng
    expect(treasuryHeld(utxos, OTHER_POLICY, OTHER_NAME)).toBe(999n);  // OTHER riêng
  });

  it("UTxO không chứa asset → 0 (không ném)", () => {
    const utxos = [custodyUtxo(2_000_000n, 0n)];
    expect(treasuryHeld(utxos, LAMP_POLICY, LAMP_NAME)).toBe(0n);
  });

  it("danh sách rỗng → 0", () => {
    expect(treasuryHeld([], LAMP_POLICY, LAMP_NAME)).toBe(0n);
  });

  it("utxoAssetAmount đọc đúng key, không nhầm asset", () => {
    const u = custodyUtxo(10_000_000n, 7_000n, 999n);
    expect(utxoAssetAmount(u, LAMP_POLICY, LAMP_NAME)).toBe(7_000n);
    expect(utxoAssetAmount(u, "", "")).toBe(10_000_000n);
  });
});

// ── circulatingSupply = total − held ────────────────────────────────────
describe("circulatingSupply = totalSupply − treasuryHeld (KẾ TOÁN, KHÔNG burn)", () => {
  it("held = 0 → circulating = total", () => {
    expect(circulatingSupply(TOTAL_SUPPLY, [], LAMP_POLICY, LAMP_NAME)).toBe(TOTAL_SUPPLY);
  });

  it("held > 0 → circulating giảm đúng lượng held", () => {
    const held = 10_000_000n;
    const utxos = [custodyUtxo(2_000_000n, held)];
    expect(circulatingSupply(TOTAL_SUPPLY, utxos, LAMP_POLICY, LAMP_NAME))
      .toBe(TOTAL_SUPPLY - held);
  });

  it("đa shard: circulating = total − Σ held, không âm", () => {
    const utxos = [
      custodyUtxo(2_000_000n, 1_000_000_000n),
      custodyUtxo(2_000_000n, 2_000_000_000n),
      custodyUtxo(2_000_000n, 3_000_000_000n),
    ];
    const held = 6_000_000_000n;
    const circ = circulatingSupply(TOTAL_SUPPLY, utxos, LAMP_POLICY, LAMP_NAME);
    expect(circ).toBe(TOTAL_SUPPLY - held);
    expect(circ >= 0n).toBe(true);
  });

  it("held == total → circulating = 0 (biên, không ném)", () => {
    const utxos = [custodyUtxo(2_000_000n, TOTAL_SUPPLY)];
    expect(circulatingSupply(TOTAL_SUPPLY, utxos, LAMP_POLICY, LAMP_NAME)).toBe(0n);
  });
});

// ── held > total → ném (bất biến tổng vỡ) ───────────────────────────────
describe("circulatingSupply ném khi bất biến vỡ", () => {
  it("treasuryHeld > totalSupply → ném CIRC-002 (không trả âm im lặng)", () => {
    const utxos = [custodyUtxo(2_000_000n, TOTAL_SUPPLY + 1n)];
    expect(() => circulatingSupply(TOTAL_SUPPLY, utxos, LAMP_POLICY, LAMP_NAME))
      .toThrow(/CIRC-002/);
  });

  it("đa shard cộng vượt total → ném", () => {
    const half = TOTAL_SUPPLY / 2n;
    const utxos = [
      custodyUtxo(2_000_000n, half),
      custodyUtxo(2_000_000n, half),
      custodyUtxo(2_000_000n, 1n),   // vượt 1 đơn vị
    ];
    expect(() => circulatingSupply(TOTAL_SUPPLY, utxos, LAMP_POLICY, LAMP_NAME))
      .toThrow(/CIRC-002/);
  });

  it("totalSupply âm → ném CIRC-001", () => {
    expect(() => circulatingSupply(-1n, [], LAMP_POLICY, LAMP_NAME)).toThrow(/CIRC-001/);
  });
});

// ── per-bucket ──────────────────────────────────────────────────────────
describe("treasuryHeldByBucket — cộng đúng theo bucket, đa shard", () => {
  it("1 datum, nhiều bucket cùng asset", () => {
    const datum = baseDatum({
      ledger: [
        { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 100n },
        { bucket_id: 2n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 250n },
      ],
    });
    const m = treasuryHeldByBucket([datum], LAMP_POLICY, LAMP_NAME);
    expect(m.get(1n)).toBe(100n);
    expect(m.get(2n)).toBe(250n);
    expect(ledgerHeld([datum], LAMP_POLICY, LAMP_NAME)).toBe(350n);
  });

  it("đa shard: cùng bucket cộng dồn qua các datum", () => {
    const d1 = baseDatum({
      ledger: [{ bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 100n }],
    });
    const d2 = baseDatum({
      ledger: [{ bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 40n }],
    });
    const m = treasuryHeldByBucket([d1, d2], LAMP_POLICY, LAMP_NAME);
    expect(m.get(1n)).toBe(140n);
  });

  it("đa-asset trong sổ: chỉ cộng đúng asset hỏi, bỏ asset khác", () => {
    const datum = baseDatum({
      ledger: [
        { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 100n },
        { bucket_id: 1n, policy: "", name: "", amount: 5_000_000n },          // ADA cùng bucket
      ],
    });
    const lampB = treasuryHeldByBucket([datum], LAMP_POLICY, LAMP_NAME);
    const adaB = treasuryHeldByBucket([datum], "", "");
    expect(lampB.get(1n)).toBe(100n);          // không trộn ADA vào LAMP
    expect(adaB.get(1n)).toBe(5_000_000n);
  });
});

// ── reconcile sổ ↔ value ────────────────────────────────────────────────
describe("reconcileCustody — phát hiện lệch sổ ↔ value (bất biến nền)", () => {
  it("khớp: Σ ledger(LAMP) == value(LAMP), diff=0, ok", () => {
    const datum = baseDatum({
      ledger: [
        { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 600n },
        { bucket_id: 2n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 400n },
      ],
    });
    const utxo = custodyUtxo(2_000_000n, 1_000n);   // value LAMP == 1000 == 600+400
    const r = reconcileCustody(utxo, datum, LAMP_POLICY, LAMP_NAME);
    expect(r.ledgerTotal).toBe(1_000n);
    expect(r.valueNet).toBe(1_000n);
    expect(r.diff).toBe(0n);
    expect(r.ok).toBe(true);
  });

  it("lệch: value LAMP > sổ → diff > 0, ok=false (phát hiện)", () => {
    const datum = baseDatum({
      ledger: [{ bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 600n }],
    });
    const utxo = custodyUtxo(2_000_000n, 1_000n);   // value 1000 ≠ sổ 600
    const r = reconcileCustody(utxo, datum, LAMP_POLICY, LAMP_NAME);
    expect(r.diff).toBe(400n);
    expect(r.ok).toBe(false);
  });

  it("lovelace: trừ reserved_min_ada trước khi so sổ", () => {
    // sổ ADA = 0 (toàn bộ lovelace là reserved min-UTxO, không ghi sổ).
    const datum = baseDatum();   // ledger rỗng
    const utxo = custodyUtxo(2_000_000n, 0n);
    const r = reconcileCustody(utxo, datum, "", "", 2_000_000n);
    expect(r.valueNet).toBe(0n);
    expect(r.ledgerTotal).toBe(0n);
    expect(r.ok).toBe(true);
  });

  it("reconcileHeld đa shard: Σvalue khớp Σsổ", () => {
    const d1 = baseDatum({
      ledger: [{ bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 500n }],
    });
    const d2 = baseDatum({
      ledger: [{ bucket_id: 2n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 300n }],
    });
    const u1 = custodyUtxo(2_000_000n, 500n);
    const u2 = custodyUtxo(2_000_000n, 300n);
    const r = reconcileHeld([u1, u2], [d1, d2], LAMP_POLICY, LAMP_NAME);
    expect(r.valueNet).toBe(800n);
    expect(r.ledgerTotal).toBe(800n);
    expect(r.ok).toBe(true);
  });
});

// ── circulatingByAsset (snapshot đa-asset) ──────────────────────────────
describe("circulatingByAsset — per-asset độc lập", () => {
  it("LAMP + ADA mỗi cái trừ đúng held của chính nó", () => {
    const utxos = [custodyUtxo(50_000_000n, 1_000_000n)];
    const totals = { [lampK]: TOTAL_SUPPLY, [adaK]: 45_000_000_000n };
    const circ = circulatingByAsset(totals, utxos);
    expect(circ[lampK]).toBe(TOTAL_SUPPLY - 1_000_000n);
    expect(circ[adaK]).toBe(45_000_000_000n - 50_000_000n);
  });
});

// ── LAMP fixed-supply: Collect KHÔNG đổi tổng cung, chỉ đổi circulating ──
describe("LAMP fixed-supply — Collect chuyển circulating, total BẤT BIẾN", () => {
  it("sau Collect: total giữ nguyên, circulating GIẢM đúng lượng cut vào custody", () => {
    // Trước: custody giữ 0 LAMP (chỉ min-ADA). Provider trả 1_000_000 LAMP, cut 10%.
    const datum = baseDatum({ cut_bps: 1000n, ledger: [] });
    const valueIn = assetsToMap({ lovelace: 2_000_000n });   // custody chưa giữ LAMP
    const items: CollectItem[] = [
      { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: 1_000_000n, category: 1n },
    ];

    const heldBefore = treasuryHeld([custodyUtxo(2_000_000n, 0n)], LAMP_POLICY, LAMP_NAME);
    const circBefore = circulatingSupply(
      TOTAL_SUPPLY, [custodyUtxo(2_000_000n, 0n)], LAMP_POLICY, LAMP_NAME,
    );

    const { custodyAfter, cut } = planCollect(datum, valueIn, items);
    expect(cut[lampK]).toBe(100_000n);   // 10% của 1_000_000

    // Dựng custody UTxO SAU từ custodyAfter (value bảo toàn ⊕ cut).
    const utxoAfter: ValueUtxo = {
      assets: {
        lovelace: custodyAfter[adaK]!,
        [LAMP_UNIT]: custodyAfter[lampK]!,
      },
    };
    const heldAfter = treasuryHeld([utxoAfter], LAMP_POLICY, LAMP_NAME);
    const circAfter = circulatingSupply(TOTAL_SUPPLY, [utxoAfter], LAMP_POLICY, LAMP_NAME);

    // total cung KHÔNG đổi (cùng TOTAL_SUPPLY truyền vào — không có nhánh burn/mint).
    // held tăng đúng cut; circulating giảm đúng cut.
    expect(heldAfter - heldBefore).toBe(100_000n);
    expect(circBefore - circAfter).toBe(100_000n);
    // circulating + held == total (định nghĩa kế toán, luôn đúng).
    expect(circAfter + heldAfter).toBe(TOTAL_SUPPLY);
  });

  it("nhiều Collect liên tiếp: total cố định, circulating đơn điệu giảm theo Σcut", () => {
    const datum0 = baseDatum({ cut_bps: 500n, ledger: [] });   // 5%
    let valueIn = assetsToMap({ lovelace: 2_000_000n });
    let totalCut = 0n;

    for (const amt of [2_000_000n, 4_000_000n, 6_000_000n]) {
      const items: CollectItem[] = [
        { app_id: "a", policy: LAMP_POLICY, name: LAMP_NAME, amount: amt, category: 1n },
      ];
      const { custodyAfter, cut } = planCollect({ ...datum0, ledger: [] }, valueIn, items);
      totalCut += cut[lampK] ?? 0n;
      valueIn = custodyAfter;   // gối tiếp cho lần sau
    }

    const utxoFinal: ValueUtxo = {
      assets: { lovelace: valueIn[adaK]!, [LAMP_UNIT]: valueIn[lampK]! },
    };
    const circ = circulatingSupply(TOTAL_SUPPLY, [utxoFinal], LAMP_POLICY, LAMP_NAME);
    const held = treasuryHeld([utxoFinal], LAMP_POLICY, LAMP_NAME);

    expect(held).toBe(totalCut);                 // custody giữ đúng Σcut
    expect(circ).toBe(TOTAL_SUPPLY - totalCut);  // circulating = total − Σcut
    expect(circ + held).toBe(TOTAL_SUPPLY);      // total bất biến
  });
});
