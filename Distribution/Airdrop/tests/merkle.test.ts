// Merkle airdrop — root tất định, proof verify, phát hiện giả mạo, byte-edge.
import { describe, it, expect } from "vitest";
import {
  buildMerkleTree, verifyClaim, verifyProof, leafHash, uint64BE, bytesToHex,
} from "../offchain/src/merkle.js";

const pkh = (b: string): string => b.repeat(28);
const A = pkh("a1"), B = pkh("b2"), C = pkh("c3"), D = pkh("d4");

describe("Airdrop Merkle", () => {
  const leaves = [
    { owner: A, wonCumulative: 100n },
    { owner: B, wonCumulative: 250n },
    { owner: C, wonCumulative: 999n },
    { owner: D, wonCumulative: 1n },
  ];

  it("mỗi owner verify được với proof + won_cumulative đúng", () => {
    const tree = buildMerkleTree(leaves);
    for (const l of leaves) {
      const proof = tree.proofs.get(l.owner)!;
      expect(verifyClaim(tree.rootHex, l.owner, l.wonCumulative, proof)).toBe(true);
    }
  });

  it("won_cumulative SAI ⇒ verify fail (chống claim nhiều hơn được)", () => {
    const tree = buildMerkleTree(leaves);
    const proof = tree.proofs.get(A)!;
    expect(verifyClaim(tree.rootHex, A, 101n, proof)).toBe(false);
  });

  it("root tất định bất kể thứ tự input", () => {
    const r1 = buildMerkleTree(leaves).rootHex;
    const r2 = buildMerkleTree([...leaves].reverse()).rootHex;
    expect(r1).toBe(r2);
  });

  it("owner trùng ⇒ throw (MERKLE-005)", () => {
    expect(() => buildMerkleTree([{ owner: A, wonCumulative: 1n }, { owner: A, wonCumulative: 2n }]))
      .toThrow(/MERKLE-005/);
  });

  it("1 leaf: root == leafHash, proof rỗng", () => {
    const tree = buildMerkleTree([{ owner: A, wonCumulative: 42n }]);
    expect(tree.proofs.get(A)).toEqual([]);
    expect(tree.rootHex).toBe(bytesToHex(leafHash(A, 42n)));
    expect(verifyProof(tree.rootHex, leafHash(A, 42n), [])).toBe(true);
  });

  it("uint64BE: biên 8 byte + chặn âm/tràn", () => {
    expect(bytesToHex(uint64BE(0n))).toBe("0000000000000000");
    expect(bytesToHex(uint64BE(1n))).toBe("0000000000000001");
    expect(() => uint64BE(-1n)).toThrow(/MERKLE-002/);
    expect(() => uint64BE(1n << 64n)).toThrow(/MERKLE-003/);
  });
});
