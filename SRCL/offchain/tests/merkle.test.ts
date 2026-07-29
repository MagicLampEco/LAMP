// SRCL Merkle off-chain tests — round-trip + ĐỐI CHIẾU vector onchain merkle.ak.

import { describe, it, expect } from "vitest";
import {
  intToBe8, leafHash, nodeHash, markerName, buildTree, verifyProof, bytesToHex,
} from "../src/merkle.js";
import { blake2b } from "@noble/hashes/blake2b";

describe("intToBe8 — khớp onchain merkle.int_to_be8", () => {
  it("0 → 8 byte zero", () => {
    expect(bytesToHex(intToBe8(0n))).toBe("0000000000000000");
  });
  it("1", () => {
    expect(bytesToHex(intToBe8(1n))).toBe("0000000000000001");
  });
  it("256", () => {
    expect(bytesToHex(intToBe8(256n))).toBe("0000000000000100");
  });
  it("27_780_000 oildrop (vector onchain int_to_be8_big)", () => {
    // onchain test khẳng định = 0x0000000001a7e3a0.
    expect(bytesToHex(intToBe8(27_780_000n))).toBe("0000000001a7e3a0");
  });
  it("từ chối int âm", () => {
    expect(() => intToBe8(-1n)).toThrow(/âm/);
  });
});

describe("leaf/node hash — domain-separated blake2b-256", () => {
  it("leaf = blake2b(0x00 ++ epoch_be8 ++ owner ++ amount_be8)", () => {
    // tái dựng độc lập để chắc công thức.
    const epoch = 0n, owner = "aa", amount = 100n;
    const manual = bytesToHex(
      blake2b(
        Uint8Array.from([
          0x00,
          ...hex8(epoch), 0xaa, ...hex8(amount),
        ]),
        { dkLen: 32 },
      ),
    );
    expect(leafHash(epoch, owner, amount)).toBe(manual);
  });

  it("node ≠ leaf (domain tag khác nhau)", () => {
    const l = leafHash(0n, "aa", 1n);
    // node(l, l) dùng tag 0x01 → khác hash của leaf cùng nội dung.
    expect(nodeHash(l, l)).not.toBe(l);
  });
});

describe("MerkleTree — proof xác định, khớp on-chain verify", () => {
  it("cây 2 leaf — proof cả 2 hướng verify đúng", () => {
    // L0 = leaf(0,aa,100), L1 = leaf(0,bb,200) — KHỚP onchain verify_two_leaf_*.
    const tree = buildTree([
      { epoch: 0n, owner: "aa", amount: 100n },
      { epoch: 0n, owner: "bb", amount: 200n },
    ]);
    const root = tree.root;
    // root phải == node(L0, L1).
    expect(root).toBe(nodeHash(leafHash(0n, "aa", 100n), leafHash(0n, "bb", 200n)));

    const pA = tree.proofFor(0n, "aa");
    expect(pA).toEqual([{ hash: leafHash(0n, "bb", 200n), left: false }]);
    expect(verifyProof(root, 0n, "aa", 100n, pA)).toBe(true);

    const pB = tree.proofFor(0n, "bb");
    expect(pB).toEqual([{ hash: leafHash(0n, "aa", 100n), left: true }]);
    expect(verifyProof(root, 0n, "bb", 200n, pB)).toBe(true);
  });

  it("proof sai amount → verify false", () => {
    const tree = buildTree([
      { epoch: 0n, owner: "aa", amount: 100n },
      { epoch: 0n, owner: "bb", amount: 200n },
    ]);
    const pA = tree.proofFor(0n, "aa");
    expect(verifyProof(tree.root, 0n, "aa", 999n, pA)).toBe(false);
  });

  it("proof epoch khác → verify false (cross-epoch replay chặn)", () => {
    const tree = buildTree([
      { epoch: 0n, owner: "aa", amount: 100n },
      { epoch: 0n, owner: "bb", amount: 200n },
    ]);
    const pA = tree.proofFor(0n, "aa");
    expect(verifyProof(tree.root, 1n, "aa", 100n, pA)).toBe(false);
  });

  it("cây 4 leaf — proof 2 bước verify đúng", () => {
    const entries = [
      { epoch: 3n, owner: "a1", amount: 10n },
      { epoch: 3n, owner: "b2", amount: 20n },
      { epoch: 3n, owner: "c3", amount: 30n },
      { epoch: 3n, owner: "d4", amount: 40n },
    ];
    const tree = buildTree(entries);
    for (const e of entries) {
      const p = tree.proofFor(e.epoch, e.owner);
      expect(verifyProof(tree.root, e.epoch, e.owner, e.amount, p)).toBe(true);
    }
  });

  it("cây lẻ (5 leaf) — carry, mọi proof vẫn verify", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      epoch: 7n,
      owner: i.toString(16).padStart(2, "0"),
      amount: BigInt((i + 1) * 1000),
    }));
    const tree = buildTree(entries);
    for (const e of entries) {
      expect(verifyProof(tree.root, e.epoch, e.owner, e.amount, tree.proofFor(e.epoch, e.owner))).toBe(true);
    }
  });

  it("cây 1 leaf — root = leaf, proof rỗng", () => {
    const tree = buildTree([{ epoch: 1n, owner: "0a0a", amount: 500n }]);
    expect(tree.root).toBe(leafHash(1n, "0a0a", 500n));
    expect(tree.proofFor(1n, "0a0a")).toEqual([]);
    expect(verifyProof(tree.root, 1n, "0a0a", 500n, [])).toBe(true);
  });
});

describe("markerName — khớp onchain merkle.marker_name", () => {
  it("thuần hàm (epoch, owner)", () => {
    expect(markerName(5n, "abcd")).toBe(markerName(5n, "abcd"));
  });
  it("khác epoch → khác name", () => {
    expect(markerName(5n, "abcd")).not.toBe(markerName(6n, "abcd"));
  });
  it("= blake2b(epoch_be8 ++ owner)", () => {
    const manual = bytesToHex(blake2b(Uint8Array.from([...hex8(5n), 0xab, 0xcd]), { dkLen: 32 }));
    expect(markerName(5n, "abcd")).toBe(manual);
  });
});

// helper: bigint → 8 byte big-endian (độc lập với src để cross-check).
function hex8(n: bigint): number[] {
  const out: number[] = new Array(8).fill(0);
  let v = n;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
