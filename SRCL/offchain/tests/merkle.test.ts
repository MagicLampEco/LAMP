// SRCL Merkle off-chain tests (SCHEMA C) — round-trip + ĐỐI CHIẾU vector onchain merkle.ak.

import { describe, it, expect } from "vitest";
import {
  intToBe8, intToBe1, leafHash, nodeHash, markerName, buildTree, verifyProof,
  bytesToHex, hexToBytes,
} from "../src/merkle.js";
import { SRCL_CAMPAIGN_ID, SRCL_CAMPAIGN_NAME, ROLE_SPO } from "../src/constants.js";
import { blake2b } from "@noble/hashes/blake2b";

// campaign + role dùng chung cho các cây test (khớp onchain tc/tr).
const C = SRCL_CAMPAIGN_ID;
const R = ROLE_SPO; // = 4

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

describe("intToBe1 — khớp onchain merkle.int_to_be1 (role tag)", () => {
  it("role SPO = 4 → 0x04; role 1 → 0x01", () => {
    expect(bytesToHex(intToBe1(4))).toBe("04");
    expect(bytesToHex(intToBe1(1))).toBe("01");
  });
  it("từ chối role ngoài [0,255]", () => {
    expect(() => intToBe1(256)).toThrow(/role/);
    expect(() => intToBe1(-1)).toThrow(/role/);
  });
});

describe("campaign_id — bake khớp blake2b_256(tên chiến dịch)", () => {
  it('SRCL_CAMPAIGN_ID == blake2b_256("LAMP-SRCL-1")', () => {
    const utf8 = new TextEncoder().encode(SRCL_CAMPAIGN_NAME);
    expect(bytesToHex(blake2b(utf8, { dkLen: 32 }))).toBe(SRCL_CAMPAIGN_ID);
  });
});

describe("leaf/node hash — domain-separated blake2b-256 (schema C)", () => {
  it("leaf = blake2b(0x00 ++ campaign_id ++ epoch_be8 ++ role ++ owner ++ amount_be8)", () => {
    // tái dựng độc lập để chắc công thức.
    const epoch = 0n, owner = "aa", amount = 100n;
    const manual = bytesToHex(
      blake2b(
        Uint8Array.from([
          0x00,
          ...hexToBytes(C),
          ...hex8(epoch),
          R,
          0xaa,
          ...hex8(amount),
        ]),
        { dkLen: 32 },
      ),
    );
    expect(leafHash(C, epoch, R, owner, amount)).toBe(manual);
  });

  it("node ≠ leaf (domain tag khác nhau)", () => {
    const l = leafHash(C, 0n, R, "aa", 1n);
    // node(l, l) dùng tag 0x01 → khác hash của leaf cùng nội dung.
    expect(nodeHash(l, l)).not.toBe(l);
  });

  it("campaign khác → leaf khác (cô lập chiến dịch)", () => {
    const other = "00".repeat(32);
    expect(leafHash(other, 0n, R, "aa", 100n)).not.toBe(leafHash(C, 0n, R, "aa", 100n));
  });

  it("role khác → leaf khác (cô lập vai)", () => {
    expect(leafHash(C, 0n, 1, "aa", 100n)).not.toBe(leafHash(C, 0n, R, "aa", 100n));
  });
});

describe("MerkleTree — proof xác định, khớp on-chain verify", () => {
  it("cây 2 leaf — proof cả 2 hướng verify đúng (sort theo slot)", () => {
    const tree = buildTree(C, R, [
      { epoch: 0n, owner: "aa", amount: 100n },
      { epoch: 0n, owner: "bb", amount: 200n },
    ]);
    // thứ tự lá do slot quyết định → tính order kỳ vọng độc lập.
    const sAA = markerName(0n, "aa"), sBB = markerName(0n, "bb");
    const [first, second] = sAA < sBB
      ? [leafHash(C, 0n, R, "aa", 100n), leafHash(C, 0n, R, "bb", 200n)]
      : [leafHash(C, 0n, R, "bb", 200n), leafHash(C, 0n, R, "aa", 100n)];
    expect(tree.root).toBe(nodeHash(first, second));

    const pA = tree.proofFor(0n, "aa");
    expect(verifyProof(tree.root, C, 0n, R, "aa", 100n, pA)).toBe(true);
    const pB = tree.proofFor(0n, "bb");
    expect(verifyProof(tree.root, C, 0n, R, "bb", 200n, pB)).toBe(true);
  });

  it("proof sai amount → verify false", () => {
    const tree = buildTree(C, R, [
      { epoch: 0n, owner: "aa", amount: 100n },
      { epoch: 0n, owner: "bb", amount: 200n },
    ]);
    const pA = tree.proofFor(0n, "aa");
    expect(verifyProof(tree.root, C, 0n, R, "aa", 999n, pA)).toBe(false);
  });

  it("proof epoch khác → verify false (cross-epoch replay chặn)", () => {
    const tree = buildTree(C, R, [
      { epoch: 0n, owner: "aa", amount: 100n },
      { epoch: 0n, owner: "bb", amount: 200n },
    ]);
    const pA = tree.proofFor(0n, "aa");
    expect(verifyProof(tree.root, C, 1n, R, "aa", 100n, pA)).toBe(false);
  });

  it("proof campaign/role khác → verify false (cross-pot replay chặn)", () => {
    const tree = buildTree(C, R, [
      { epoch: 0n, owner: "aa", amount: 100n },
      { epoch: 0n, owner: "bb", amount: 200n },
    ]);
    const pA = tree.proofFor(0n, "aa");
    expect(verifyProof(tree.root, "00".repeat(32), 0n, R, "aa", 100n, pA)).toBe(false);
    expect(verifyProof(tree.root, C, 0n, 1, "aa", 100n, pA)).toBe(false);
  });

  it("cây 4 leaf — proof 2 bước verify đúng", () => {
    const entries = [
      { epoch: 3n, owner: "a1", amount: 10n },
      { epoch: 3n, owner: "b2", amount: 20n },
      { epoch: 3n, owner: "c3", amount: 30n },
      { epoch: 3n, owner: "d4", amount: 40n },
    ];
    const tree = buildTree(C, R, entries);
    for (const e of entries) {
      const p = tree.proofFor(e.epoch, e.owner);
      expect(verifyProof(tree.root, C, e.epoch, R, e.owner, e.amount, p)).toBe(true);
    }
  });

  it("cây lẻ (5 leaf) — carry, mọi proof vẫn verify", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      epoch: 7n,
      owner: i.toString(16).padStart(2, "0"),
      amount: BigInt((i + 1) * 1000),
    }));
    const tree = buildTree(C, R, entries);
    for (const e of entries) {
      expect(verifyProof(tree.root, C, e.epoch, R, e.owner, e.amount, tree.proofFor(e.epoch, e.owner))).toBe(true);
    }
  });

  it("cây 1 leaf — root = leaf, proof rỗng", () => {
    const tree = buildTree(C, R, [{ epoch: 1n, owner: "0a0a", amount: 500n }]);
    expect(tree.root).toBe(leafHash(C, 1n, R, "0a0a", 500n));
    expect(tree.proofFor(1n, "0a0a")).toEqual([]);
    expect(verifyProof(tree.root, C, 1n, R, "0a0a", 500n, [])).toBe(true);
  });

  it("trùng slot (cùng epoch+owner) → NÉM LỖI cứng", () => {
    expect(() =>
      buildTree(C, R, [
        { epoch: 2n, owner: "aa", amount: 100n },
        { epoch: 2n, owner: "aa", amount: 200n },
      ]),
    ).toThrow(/trùng slot/);
  });
});

describe("markerName — khớp onchain merkle.marker_name (schema C GIỮ NGUYÊN)", () => {
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
  it("vector onchain marker_matches_offchain_vector", () => {
    expect(markerName(5n, "abcd")).toBe(
      "adaf6061f0752090bdbf0778255175cf02efa0b27b66351af8a70de586a2adbd",
    );
  });
});

describe("PARITY byte-perfect schema C — vector canonical từ onchain merkle.ak", () => {
  it("leaf_matches_offchain_vector: leaf(tc,0,4,aa,100)", () => {
    expect(leafHash(C, 0n, R, "aa", 100n)).toBe(
      "fbe7c0dcae6d34a785caac569c1fa8d0da5ed4dfc41ab99abc247937ad61dc52",
    );
  });
  it("node_matches_offchain_vector", () => {
    expect(nodeHash(leafHash(C, 0n, R, "aa", 100n), leafHash(C, 0n, R, "bb", 200n))).toBe(
      "a14cbb19a33fde70831c68ede724a160daf80432cbc9c2531f5e5b9b251f9362",
    );
  });
  it("parity_v2_leaf: campaign=LAMP-SRCL-1, epoch=100, role=4, owner=bb*28, amount=27_780_000", () => {
    const owner = "bb".repeat(28); // 28 byte stake key-hash mẫu (SRCL owner)
    expect(leafHash(C, 100n, 4, owner, 27_780_000n)).toBe(
      "e47d8183552d5c21de639b5ddf9a82bcc6d4648c3fad2bc0959e2cd1826f03ba",
    );
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
