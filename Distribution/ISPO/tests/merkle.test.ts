// ISPO Merkle — root tất định, proof verify, phát hiện giả mạo, byte-edge.
import { describe, it, expect } from "vitest";
import {
  buildMerkleTree, verifyClaim, verifyProof, leafHash, uint64BE, bytesToHex,
} from "../offchain/src/merkle.js";

const pkh = (b: string): string => b.repeat(28);
const A = pkh("a1"), B = pkh("b2"), C = pkh("c3");

describe("ISPO Merkle", () => {
  const leaves = [
    { owner: A, wonCumulative: 100n },
    { owner: B, wonCumulative: 250n },
    { owner: C, wonCumulative: 999n },
  ];

  it("mỗi owner verify được với proof đúng", () => {
    const tree = buildMerkleTree(leaves);
    for (const l of leaves) {
      expect(verifyClaim(tree.rootHex, l.owner, l.wonCumulative, tree.proofs.get(l.owner)!)).toBe(true);
    }
  });

  it("won_cumulative SAI ⇒ verify fail", () => {
    const tree = buildMerkleTree(leaves);
    expect(verifyClaim(tree.rootHex, A, 101n, tree.proofs.get(A)!)).toBe(false);
  });

  it("root tất định bất kể thứ tự", () => {
    expect(buildMerkleTree(leaves).rootHex).toBe(buildMerkleTree([...leaves].reverse()).rootHex);
  });

  it("owner trùng ⇒ throw", () => {
    expect(() => buildMerkleTree([{ owner: A, wonCumulative: 1n }, { owner: A, wonCumulative: 2n }]))
      .toThrow(/MERKLE-005/);
  });

  it("xcheck canonical leaf vector (byte-perfect on/off-chain)", () => {
    // leafHash("aa", 100) — pin từ merkle.ak leaf_hash_xcheck_offchain.
    expect(bytesToHex(leafHash("aa", 100n)))
      .toBe("758af0ead989e9c0e45001a317e85be8645e1a89637499c87d5c86a53ddeaac7");
  });

  it("uint64BE biên + chặn âm/tràn", () => {
    expect(bytesToHex(uint64BE(0n))).toBe("0000000000000000");
    expect(() => uint64BE(-1n)).toThrow(/MERKLE-002/);
    expect(() => uint64BE(1n << 64n)).toThrow(/MERKLE-003/);
    expect(verifyProof(bytesToHex(leafHash(A, 5n)), leafHash(A, 5n), [])).toBe(true);
  });
});
