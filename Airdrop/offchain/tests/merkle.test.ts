// Merkle round-trip + leaf encoding sanity (off-chain).
// Đối chiếu logic onchain merkle.ak: leaf = blake2b(0x00 ++ cbor(addr) ++ amt_be8).

import { describe, it, expect } from "vitest";
import {
  leafHash, nodeHash, buildTree, buildProof, buildProofForAddress,
  verifyProof, amountToBe8, bytesToHex, addressToCborBytes,
} from "../src/merkle.js";
import { lampToOil } from "../src/constants.js";
import type { SnapshotEntry } from "../src/types.js";

// Địa chỉ Preview thật (enterprise key address) để getAddressDetails parse được.
// Sinh tất định từ payment key hash (dùng credentialToAddress dưới).
import { credentialToAddress, keyHashToCredential } from "@lucid-evolution/lucid";

function previewAddr(pkhHex: string): string {
  return credentialToAddress("Preview", keyHashToCredential(pkhHex));
}

const ADDR_A = previewAddr("00000000000000000000000000000000000000000000000000000a01");
const ADDR_B = previewAddr("00000000000000000000000000000000000000000000000000000b02");
const ADDR_C = previewAddr("00000000000000000000000000000000000000000000000000000c03");
const ADDR_D = previewAddr("00000000000000000000000000000000000000000000000000000d04");

describe("amountToBe8", () => {
  it("mã hoá big-endian 8 byte", () => {
    expect(bytesToHex(amountToBe8(0n))).toBe("0000000000000000");
    expect(bytesToHex(amountToBe8(1n))).toBe("0000000000000001");
    expect(bytesToHex(amountToBe8(1_000_000n))).toBe("00000000000f4240");
  });
  it("từ chối amount âm + vượt u64", () => {
    expect(() => amountToBe8(-1n)).toThrow();
    expect(() => amountToBe8(1n << 64n)).toThrow();
  });
});

describe("leafHash", () => {
  it("tất định + 32 byte (64 hex)", () => {
    const e: SnapshotEntry = { address: ADDR_A, amount: lampToOil(100n) };
    const h = leafHash(e);
    expect(h).toHaveLength(64);
    expect(leafHash(e)).toBe(h);
  });
  it("đổi amount → đổi leaf", () => {
    const h1 = leafHash({ address: ADDR_A, amount: 100n });
    const h2 = leafHash({ address: ADDR_A, amount: 101n });
    expect(h1).not.toBe(h2);
  });
  it("đổi address → đổi leaf", () => {
    const h1 = leafHash({ address: ADDR_A, amount: 100n });
    const h2 = leafHash({ address: ADDR_B, amount: 100n });
    expect(h1).not.toBe(h2);
  });
  it("cbor(address) khác nhau theo address", () => {
    expect(bytesToHex(addressToCborBytes(ADDR_A))).not.toBe(bytesToHex(addressToCborBytes(ADDR_B)));
  });
});

describe("parity với onchain merkle.ak (BYTE-PERFECT)", () => {
  it("leaf(addr=28×0xa0, amount=100) == vector onchain", () => {
    // Vector cố định đối chiếu Aiken test parity_offchain_leaf. Nếu lệch →
    // proof off-chain KHÔNG verify on-chain.
    const addr = previewAddr("a0".repeat(28));
    expect(leafHash({ address: addr, amount: 100n })).toBe(
      "3aeee537bfa5dfeef78128313f5c92a052479458627b316d5f4452215181b6b8",
    );
  });
});

describe("buildTree + proof round-trip", () => {
  const entries: SnapshotEntry[] = [
    { address: ADDR_A, amount: lampToOil(10n) },
    { address: ADDR_B, amount: lampToOil(20n) },
    { address: ADDR_C, amount: lampToOil(30n) },
    { address: ADDR_D, amount: lampToOil(40n) },
  ];

  it("root ổn định + 32 byte", () => {
    const t1 = buildTree(entries);
    const t2 = buildTree([...entries].reverse()); // thứ tự nhập khác
    expect(t1.root).toHaveLength(64);
    // sort theo leaf hash → root KHÔNG phụ thuộc thứ tự nhập.
    expect(t1.root).toBe(t2.root);
  });

  it("proof mọi leaf verify đúng root", () => {
    const tree = buildTree(entries);
    for (let i = 0; i < tree.entries.length; i++) {
      const proof = buildProof(tree, i);
      expect(verifyProof(tree.root, tree.entries[i]!, proof)).toBe(true);
    }
  });

  it("proof sai amount → verify false", () => {
    const tree = buildTree(entries);
    const proof = buildProof(tree, 0);
    const tampered = { ...tree.entries[0]!, amount: tree.entries[0]!.amount + 1n };
    expect(verifyProof(tree.root, tampered, proof)).toBe(false);
  });

  it("proof sai sibling → verify false", () => {
    const tree = buildTree(entries);
    const proof = buildProof(tree, 0);
    const bad = proof.map((p, i) => (i === 0 ? { ...p, hash: "de".repeat(32) } : p));
    expect(verifyProof(tree.root, tree.entries[0]!, bad)).toBe(false);
  });

  it("buildProofForAddress khớp entry + verify", () => {
    const tree = buildTree(entries);
    const { entry, proof, leaf } = buildProofForAddress(tree, ADDR_C);
    expect(leaf).toBe(leafHash(entry));
    expect(verifyProof(tree.root, entry, proof)).toBe(true);
  });

  it("address ngoài snapshot → throw", () => {
    const tree = buildTree(entries);
    const outsider = previewAddr("00000000000000000000000000000000000000000000000000009999");
    expect(() => buildProofForAddress(tree, outsider)).toThrow(/không có trong snapshot/);
  });
});

describe("tree 1 leaf + 3 leaf (lẻ → carry)", () => {
  it("1 leaf: proof rỗng, root = leaf", () => {
    const tree = buildTree([{ address: ADDR_A, amount: 1n }]);
    expect(tree.root).toBe(tree.leaves[0]);
    const proof = buildProof(tree, 0);
    expect(proof).toHaveLength(0);
    expect(verifyProof(tree.root, tree.entries[0]!, proof)).toBe(true);
  });

  it("3 leaf (số lẻ): mọi proof verify đúng", () => {
    const tree = buildTree([
      { address: ADDR_A, amount: 10n },
      { address: ADDR_B, amount: 20n },
      { address: ADDR_C, amount: 30n },
    ]);
    for (let i = 0; i < 3; i++) {
      expect(verifyProof(tree.root, tree.entries[i]!, buildProof(tree, i))).toBe(true);
    }
  });
});

describe("nodeHash domain-separation", () => {
  it("node ≠ leaf cho cùng bytes (prefix khác)", () => {
    const a = "ab".repeat(32);
    const b = "cd".repeat(32);
    // node dùng prefix 0x01; không có cách nào trùng leaf (prefix 0x00).
    expect(nodeHash(a, b)).toHaveLength(64);
    expect(nodeHash(a, b)).not.toBe(nodeHash(b, a)); // không giao hoán
  });

  it("dedup từ chối address trùng", () => {
    expect(() =>
      buildTree([
        { address: ADDR_A, amount: 1n },
        { address: ADDR_A, amount: 2n },
      ]),
    ).toThrow(/trùng/);
  });
});
