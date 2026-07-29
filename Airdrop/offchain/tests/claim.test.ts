// Claim logic — snapshot → tree → proof → marker leaf. Đối chiếu bất biến:
// marker NFT name == leaf == leafHash(claimer, amount), và proof verify đúng root.
// (Không dựng tx thật vì cần provider; test logic thuần builder phụ thuộc.)

import { describe, it, expect } from "vitest";
import { credentialToAddress, keyHashToCredential, scriptHashToCredential, toUnit } from "@lucid-evolution/lucid";
import {
  parseSnapshot, buildSnapshotTree, totalOildrop, exportClaims,
  type RawSnapshotRow,
} from "../src/snapshotTool.js";
import { buildProofForAddress, verifyProof, leafHash } from "../src/merkle.js";
import { lampToOildrop, AIRDROP_TOTAL_OILDROP, OILDROP_PER_LAMP } from "../src/constants.js";

function previewAddr(pkhHex: string): string {
  return credentialToAddress("Preview", keyHashToCredential(pkhHex));
}

const ADDR_A = previewAddr("00000000000000000000000000000000000000000000000000000a01");
const ADDR_B = previewAddr("00000000000000000000000000000000000000000000000000000b02");
const ADDR_C = previewAddr("00000000000000000000000000000000000000000000000000000c03");

const NFT_POLICY = "facade01".padEnd(56, "0");

describe("parseSnapshot — đơn vị oildrop", () => {
  const rows: RawSnapshotRow[] = [
    { address: ADDR_A, amount: 100 }, // 100 LAMP
    { address: ADDR_B, amount: "250" }, // 250 LAMP
  ];

  it("unit=lamp → ×10^6 ra oildrop", () => {
    const e = parseSnapshot(rows, { unit: "lamp" });
    expect(e[0]!.amount).toBe(lampToOildrop(100n));
    expect(e[1]!.amount).toBe(lampToOildrop(250n));
  });

  it("unit=oildrop → giữ nguyên", () => {
    const e = parseSnapshot([{ address: ADDR_A, amount: 100_000_000 }], { unit: "oildrop" });
    expect(e[0]!.amount).toBe(100_000_000n);
  });

  it("amount ≤ 0 → throw", () => {
    expect(() => parseSnapshot([{ address: ADDR_A, amount: 0 }])).toThrow(/≤ 0/);
  });

  it("totalOildrop cộng đúng", () => {
    const e = parseSnapshot(rows, { unit: "lamp" });
    expect(totalOildrop(e)).toBe(lampToOildrop(350n));
  });
});

describe("buildSnapshotTree + exportClaims", () => {
  const rows: RawSnapshotRow[] = [
    { address: ADDR_A, amount: 10 },
    { address: ADDR_B, amount: 20 },
    { address: ADDR_C, amount: 30 },
  ];

  it("exportClaims: mọi record proof verify đúng root", () => {
    const tree = buildSnapshotTree(rows);
    const claims = exportClaims(tree);
    expect(claims).toHaveLength(3);
    for (const c of claims) {
      const ok = verifyProof(tree.root, { address: c.address, amount: c.amount }, c.proof);
      expect(ok).toBe(true);
      // leaf khớp leafHash(address, amount).
      expect(c.leaf).toBe(leafHash({ address: c.address, amount: c.amount }));
    }
  });

  it("amount trong claim = oildrop (×10^6 từ LAMP)", () => {
    const tree = buildSnapshotTree(rows);
    const claims = exportClaims(tree);
    const a = claims.find((c) => c.address === ADDR_A)!;
    expect(a.amount).toBe(lampToOildrop(10n));
  });
});

describe("slot leaf consistency (spend-once nullifier đầu vào)", () => {
  const rows: RawSnapshotRow[] = [
    { address: ADDR_A, amount: 1000 },
    { address: ADDR_B, amount: 2000 },
  ];

  it("slot unit name == leaf == leafHash(claimer, amount)", () => {
    const tree = buildSnapshotTree(rows);
    const { entry, leaf } = buildProofForAddress(tree, ADDR_A);
    const slotUnit = toUnit(NFT_POLICY, leaf);
    // unit = policyId(56 hex) + name(leaf). Tách name phải == leaf.
    expect(slotUnit.slice(0, 56)).toBe(NFT_POLICY);
    expect(slotUnit.slice(56)).toBe(leaf);
    expect(leaf).toBe(leafHash(entry));
  });

  it("2 claimer khác leaf → 2 slot khác name (nullifier riêng)", () => {
    const tree = buildSnapshotTree(rows);
    const la = buildProofForAddress(tree, ADDR_A).leaf;
    const lb = buildProofForAddress(tree, ADDR_B).leaf;
    expect(la).not.toBe(lb);
  });
});

describe("snapshot 0,1 tỷ LAMP — đối chiếu tổng allocation", () => {
  it("AIRDROP_TOTAL_OILDROP = 100_000_000 LAMP × 10^6", () => {
    expect(AIRDROP_TOTAL_OILDROP).toBe(100_000_000n * OILDROP_PER_LAMP);
    expect(AIRDROP_TOTAL_OILDROP).toBe(100_000_000_000_000n);
  });

  it("snapshot tổng = AIRDROP_TOTAL_OILDROP khi chia đủ", () => {
    // ví dụ 2 ví chia đôi 0,1 tỷ.
    const rows: RawSnapshotRow[] = [
      { address: ADDR_A, amount: 50_000_000 },
      { address: ADDR_B, amount: 50_000_000 },
    ];
    const e = parseSnapshot(rows, { unit: "lamp" });
    expect(totalOildrop(e)).toBe(AIRDROP_TOTAL_OILDROP);
  });
});
