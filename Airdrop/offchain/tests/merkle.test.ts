// Merkle round-trip + leaf encoding sanity (off-chain) — SCHEMA C (v2).
// Đối chiếu logic onchain merkle.ak::leaf_hash_v2:
//   leaf = blake2b(0x00 ‖ campaign_id[32] ‖ epoch_be8 ‖ role[1] ‖ owner[28] ‖ amount_be8).

import { describe, it, expect } from "vitest";
import { blake2b } from "@noble/hashes/blake2b";
import {
  leafHash, nodeHash, buildTree, buildProof, buildProofForAddress,
  verifyProof, slot, uintToBe8, amountToBe8, bytesToHex, addressToCborBytes,
} from "../src/merkle.js";
import { lampToOildrop, DELEGATOR_CAMPAIGN, DELEGATOR_CAMPAIGN_ID, ROLE_DELEGATOR } from "../src/constants.js";
import type { SnapshotEntry, MerkleParams } from "../src/types.js";

// Địa chỉ Preview thật (enterprise key address) để getAddressDetails parse được.
// Sinh tất định từ payment key hash (dùng credentialToAddress dưới).
import { credentialToAddress, keyHashToCredential } from "@lucid-evolution/lucid";

function previewAddr(pkhHex: string): string {
  return credentialToAddress("Preview", keyHashToCredential(pkhHex));
}
/** base addr (payment + stake) — payment-cred TRÙNG previewAddr(pkh) → cùng owner/slot. */
function previewBaseAddr(pkhHex: string, stakeHex: string): string {
  return credentialToAddress("Preview", keyHashToCredential(pkhHex), keyHashToCredential(stakeHex));
}

const ADDR_A = previewAddr("00000000000000000000000000000000000000000000000000000a01");
const ADDR_B = previewAddr("00000000000000000000000000000000000000000000000000000b02");
const ADDR_C = previewAddr("00000000000000000000000000000000000000000000000000000c03");
const ADDR_D = previewAddr("00000000000000000000000000000000000000000000000000000d04");

// params schema C dùng chung cho test dựng cây.
const P: MerkleParams = { campaignId: DELEGATOR_CAMPAIGN_ID, epoch: 637n, role: ROLE_DELEGATOR };

describe("uintToBe8 (alias amountToBe8)", () => {
  it("mã hoá big-endian 8 byte", () => {
    expect(bytesToHex(uintToBe8(0n))).toBe("0000000000000000");
    expect(bytesToHex(uintToBe8(1n))).toBe("0000000000000001");
    expect(bytesToHex(uintToBe8(1_000_000n))).toBe("00000000000f4240");
    expect(bytesToHex(uintToBe8(637n))).toBe("000000000000027d"); // epoch_be8 vector
    expect(bytesToHex(uintToBe8(27_780_000n))).toBe("0000000001a7e3a0"); // amount_be8 vector (27_780_000 = 0x1a7e3a0)
    expect(amountToBe8).toBe(uintToBe8); // alias giữ tương thích
  });
  it("từ chối âm + vượt u64", () => {
    expect(() => uintToBe8(-1n)).toThrow();
    expect(() => uintToBe8(1n << 64n)).toThrow();
  });
});

describe("campaign_id = blake2b_256(utf8(tên chiến dịch))", () => {
  it("DELEGATOR_CAMPAIGN_ID khớp hash tên", () => {
    const h = bytesToHex(blake2b(new TextEncoder().encode(DELEGATOR_CAMPAIGN), { dkLen: 32 }));
    expect(h).toBe(DELEGATOR_CAMPAIGN_ID);
    expect(DELEGATOR_CAMPAIGN_ID).toBe(
      "f5beb28d9ac6330b590fd5cc060d7e7fdbe2433130a4f1ffe93bb0deeb72db54",
    );
  });
});

describe("leafHash (schema C)", () => {
  it("tất định + 32 byte (64 hex)", () => {
    const e: SnapshotEntry = { address: ADDR_A, amount: lampToOildrop(100n) };
    const h = leafHash(e, P);
    expect(h).toHaveLength(64);
    expect(leafHash(e, P)).toBe(h);
  });
  it("đổi amount → đổi leaf", () => {
    expect(leafHash({ address: ADDR_A, amount: 100n }, P)).not.toBe(
      leafHash({ address: ADDR_A, amount: 101n }, P));
  });
  it("đổi owner (address khác payment-cred) → đổi leaf", () => {
    expect(leafHash({ address: ADDR_A, amount: 100n }, P)).not.toBe(
      leafHash({ address: ADDR_B, amount: 100n }, P));
  });
  it("đổi epoch / role / campaign → đổi leaf (cô lập)", () => {
    const e = { address: ADDR_A, amount: 100n };
    expect(leafHash(e, P)).not.toBe(leafHash(e, { ...P, epoch: 638n }));
    expect(leafHash(e, P)).not.toBe(leafHash(e, { ...P, role: 2 }));
    expect(leafHash(e, P)).not.toBe(leafHash(e, { ...P, campaignId: "ab".repeat(32) }));
  });
  it("từ chối role ngoài 0..255 + campaign_id sai độ dài", () => {
    expect(() => leafHash({ address: ADDR_A, amount: 1n }, { ...P, role: 256 })).toThrow(/role/);
    expect(() => leafHash({ address: ADDR_A, amount: 1n }, { ...P, campaignId: "ab" })).toThrow(/campaign_id/);
  });
});

describe("parity BYTE-PERFECT với on-chain (golden vector — schema C)", () => {
  // Vector chuẩn vàng aiken-dev chốt (SCHEMA-MERKLE-V2-Tech-Spec §5). Lệch =
  // proof off-chain KHÔNG verify on-chain.
  it("leaf(campaign=Delegator, epoch=637, role=1, owner=a0×28, amount=27_780_000) == vector", () => {
    const addr = previewAddr("a0".repeat(28)); // payment key-hash = a0×28
    expect(leafHash({ address: addr, amount: 27_780_000n }, P)).toBe(
      "5f254c5f27c62040e8b4e23793368afb807ccf58c0cd69fe681a358cca3b7cc7",
    );
  });
  it("slot(epoch=637, owner=a0×28) == vector", () => {
    const addr = previewAddr("a0".repeat(28));
    expect(slot({ address: addr, amount: 27_780_000n }, 637n)).toBe(
      "bfc18829cdf063850a82d88b5e8a6a8161fe480630a5d12c6381b657521ce45b",
    );
  });
});

describe("buildTree + proof round-trip (schema C)", () => {
  const entries: SnapshotEntry[] = [
    { address: ADDR_A, amount: lampToOildrop(10n) },
    { address: ADDR_B, amount: lampToOildrop(20n) },
    { address: ADDR_C, amount: lampToOildrop(30n) },
    { address: ADDR_D, amount: lampToOildrop(40n) },
  ];

  it("root ổn định + 32 byte, độc lập thứ tự nhập (sort theo slot)", () => {
    const t1 = buildTree(entries, P);
    const t2 = buildTree([...entries].reverse(), P);
    expect(t1.root).toHaveLength(64);
    expect(t1.root).toBe(t2.root);
  });

  it("proof mọi leaf verify đúng root", () => {
    const tree = buildTree(entries, P);
    for (let i = 0; i < tree.entries.length; i++) {
      expect(verifyProof(tree.root, tree.entries[i]!, buildProof(tree, i), P)).toBe(true);
    }
  });

  it("proof sai amount → verify false", () => {
    const tree = buildTree(entries, P);
    const proof = buildProof(tree, 0);
    const tampered = { ...tree.entries[0]!, amount: tree.entries[0]!.amount + 1n };
    expect(verifyProof(tree.root, tampered, proof, P)).toBe(false);
  });

  it("proof sai sibling → verify false", () => {
    const tree = buildTree(entries, P);
    const proof = buildProof(tree, 0);
    const bad = proof.map((p, i) => (i === 0 ? { ...p, hash: "de".repeat(32) } : p));
    expect(verifyProof(tree.root, tree.entries[0]!, bad, P)).toBe(false);
  });

  it("proof đúng nhưng params khác (epoch) → verify false (cô lập)", () => {
    const tree = buildTree(entries, P);
    const proof = buildProof(tree, 0);
    expect(verifyProof(tree.root, tree.entries[0]!, proof, { ...P, epoch: 999n })).toBe(false);
  });

  it("buildProofForAddress khớp entry + verify", () => {
    const tree = buildTree(entries, P);
    const { entry, proof, leaf } = buildProofForAddress(tree, ADDR_C);
    expect(leaf).toBe(leafHash(entry, P));
    expect(verifyProof(tree.root, entry, proof, P)).toBe(true);
  });

  it("address ngoài snapshot → throw", () => {
    const tree = buildTree(entries, P);
    const outsider = previewAddr("00000000000000000000000000000000000000000000000000009999");
    expect(() => buildProofForAddress(tree, outsider)).toThrow(/không có trong snapshot/);
  });
});

describe("tree 1 leaf + 3 leaf (lẻ → carry)", () => {
  it("1 leaf: proof rỗng, root = leaf", () => {
    const tree = buildTree([{ address: ADDR_A, amount: 1n }], P);
    expect(tree.root).toBe(tree.leaves[0]);
    const proof = buildProof(tree, 0);
    expect(proof).toHaveLength(0);
    expect(verifyProof(tree.root, tree.entries[0]!, proof, P)).toBe(true);
  });

  it("3 leaf (số lẻ): mọi proof verify đúng", () => {
    const tree = buildTree([
      { address: ADDR_A, amount: 10n },
      { address: ADDR_B, amount: 20n },
      { address: ADDR_C, amount: 30n },
    ], P);
    for (let i = 0; i < 3; i++) {
      expect(verifyProof(tree.root, tree.entries[i]!, buildProof(tree, i), P)).toBe(true);
    }
  });
});

describe("nodeHash domain-separation + dedup theo slot (fail-closed)", () => {
  it("node ≠ leaf, không giao hoán", () => {
    const a = "ab".repeat(32);
    const b = "cd".repeat(32);
    expect(nodeHash(a, b)).toHaveLength(64);
    expect(nodeHash(a, b)).not.toBe(nodeHash(b, a));
  });

  it("cbor(address) khác nhau theo address (helper redeemer)", () => {
    expect(bytesToHex(addressToCborBytes(ADDR_A))).not.toBe(bytesToHex(addressToCborBytes(ADDR_B)));
  });

  it("cùng address (trùng owner) → slot trùng → throw", () => {
    expect(() =>
      buildTree([
        { address: ADDR_A, amount: 1n },
        { address: ADDR_A, amount: 2n },
      ], P),
    ).toThrow(/slot trùng/);
  });

  it("2 ĐỊA CHỈ KHÁC NHAU cùng payment-cred (enterprise vs base) → slot trùng → throw", () => {
    const pkh = "00000000000000000000000000000000000000000000000000000a01";
    const ent = previewAddr(pkh);
    const base = previewBaseAddr(pkh, "b".repeat(56));
    expect(ent).not.toBe(base); // chuỗi bech32 khác nhau
    expect(() =>
      buildTree([
        { address: ent, amount: 1n },
        { address: base, amount: 2n },
      ], P),
    ).toThrow(/slot trùng/);
  });
});
