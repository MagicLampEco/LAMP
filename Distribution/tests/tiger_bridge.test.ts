// Bridge ETD ↔ Distribution — chứng minh entitlement + drip kiểu B (ETD) khớp
// BYTE/BIT-PERFECT với cơ chế vested + datum codec của claim_account (Distribution).
//
// Đây là hợp đồng liên-module mà 05_tiger_redeem.ts dựa vào: account ETD-shaped
// (drops_per_epoch = ceil(E/N), start_epoch = cliff) khi redeem qua Distribution
// builder với beacon D = 1 phải cho vested ĐÚNG bằng ETD vestedAt. Chạy off-chain,
// không cần mạng — verify local TRƯỚC khi tốn tx Preview.
//
// PREMISE (audit HIGH, xem ETD/README): bit-identity CHỈ đúng khi D = DROP_VALUE_OIL = 1.

import { describe, it, expect } from "vitest";

// ── ETD (off-chain engine) ──────────────────────────────────────────────
import { computeEntitlements } from "../ETD/offchain/src/entitlement.js";
import { tigerDatum, vestedAt as tigerVestedAt, ceilDiv } from "../ETD/offchain/src/dripB.js";
import {
  TIGER_TOTAL_OIL, DROP_VALUE_OIL, DRIP_EPOCHS_DEFAULT, lampToOil,
} from "../ETD/offchain/src/constants.js";
import type { SnapshotSet } from "../ETD/offchain/src/types.js";

// ── Distribution (on-chain mirror) ──────────────────────────────────────
import { vested as distVested } from "../offchain/src/vested.js";
import {
  claimAccountDatumToCbor, claimAccountDatumFromCbor,
} from "../offchain/src/datum.js";

/** Owner PKH hợp lệ (28-byte = 56 hex) từ 1 byte lặp. */
const pkh = (b: string): string => b.repeat(28);
const O1 = pkh("11");
const O2 = pkh("22");
const O3 = pkh("33");
const FOUNDER = pkh("ff"); // self-dealing → excluded

const N = DRIP_EPOCHS_DEFAULT; // 36

describe("ETD↔Distribution bridge — bit-identity vested (D=1)", () => {
  // Snapshot 2 epoch; accStake: O1=2000, O2=6000, O3=12000 (founder loại).
  const snapshots: SnapshotSet = [
    [{ owner: O1, stake: 1_000n }, { owner: O2, stake: 3_000n }, { owner: O3, stake: 6_000n }, { owner: FOUNDER, stake: 9_999n }],
    [{ owner: O1, stake: 1_000n }, { owner: O2, stake: 3_000n }, { owner: O3, stake: 6_000n }, { owner: FOUNDER, stake: 9_999n }],
  ];

  const result = computeEntitlements(snapshots, { excluded: new Set([FOUNDER]) });
  const cliff = 10n; // cliff khác 0 để bắt lỗi off-by-one

  it("bất biến ngân sách: Σ E_i + leftover == budget (cap=null ⇒ leftover 0)", () => {
    const sum = result.entitlements.reduce((s, e) => s + e.amount, 0n);
    expect(sum + result.leftover).toBe(TIGER_TOTAL_OIL);
    expect(result.leftover).toBe(0n); // không cap → chia hết qua dust
  });

  it("loại ví self-dealing: FOUNDER không nhận entitlement", () => {
    expect(result.entitlements.find((e) => e.owner === FOUNDER)).toBeUndefined();
  });

  it("vested ETD == vested Distribution tại mọi epoch mốc (D=1)", () => {
    const ts = (start: bigint): bigint[] => [
      0n, start - 1n, start, start + 1n, start + N / 2n, start + N, start + N + 5n,
    ];
    for (const e of result.entitlements) {
      const d = tigerDatum(e.owner, e.amount, N, cliff);
      const dpe = ceilDiv(e.amount, N);
      expect(d.drops_per_epoch).toBe(dpe);
      expect(d.start_epoch).toBe(cliff);
      for (const t of ts(cliff)) {
        const fromDist = distVested(d.entitlement, DROP_VALUE_OIL, d.drops_per_epoch, d.start_epoch, t);
        const fromEtd = tigerVestedAt(d, t);
        expect(fromDist).toBe(fromEtd); // P8 bit-identity
      }
    }
  });

  it("full vest ĐÚNG N epoch: vested(cliff+N) == E; ≤ E mọi t; đơn điệu", () => {
    for (const e of result.entitlements) {
      const d = tigerDatum(e.owner, e.amount, N, cliff);
      expect(tigerVestedAt(d, cliff + N)).toBe(e.amount); // ceil(E/N)·N ≥ E
      let prev = -1n;
      for (let t = cliff; t <= cliff + N + 2n; t++) {
        const v = tigerVestedAt(d, t);
        expect(v).toBeLessThanOrEqual(e.amount); // cap E
        expect(v).toBeGreaterThanOrEqual(prev);  // đơn điệu
        prev = v;
      }
    }
  });

  it("cliff: t ≤ cliff ⇒ vested == 0", () => {
    const e = result.entitlements[0]!;
    const d = tigerDatum(e.owner, e.amount, N, cliff);
    expect(tigerVestedAt(d, cliff)).toBe(0n);
    expect(tigerVestedAt(d, cliff - 5n)).toBe(0n);
  });

  it("datum ETD round-trip qua codec Distribution (CBOR byte-perfect)", () => {
    for (const e of result.entitlements) {
      const d = tigerDatum(e.owner, e.amount, N, cliff);
      const back = claimAccountDatumFromCbor(claimAccountDatumToCbor(d));
      expect(back).toEqual(d);
    }
  });
});

describe("ETD↔Distribution bridge — có cap (water-filling) vẫn bảo toàn", () => {
  const snapshots: SnapshotSet = [
    [{ owner: O1, stake: 1n }, { owner: O2, stake: 10n }, { owner: O3, stake: 1_000_000n }],
  ];
  const cap = lampToOil(1_000_000n); // 1M LAMP/ví → cá voi O3 bị ghim

  it("Σ E_i + leftover == budget; mọi E_i ≤ cap; vested vẫn bit-identical", () => {
    const r = computeEntitlements(snapshots, { capOil: cap });
    const sum = r.entitlements.reduce((s, e) => s + e.amount, 0n);
    expect(sum + r.leftover).toBe(TIGER_TOTAL_OIL);
    for (const e of r.entitlements) {
      expect(e.amount).toBeLessThanOrEqual(cap);
      const d = tigerDatum(e.owner, e.amount, N, 0n);
      for (const t of [0n, 1n, N / 2n, N, N + 3n]) {
        expect(distVested(d.entitlement, DROP_VALUE_OIL, d.drops_per_epoch, d.start_epoch, t))
          .toBe(tigerVestedAt(d, t));
      }
    }
  });
});
