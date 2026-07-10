// merkle.ts — dựng cây Merkle + proof từ snapshot. KHỚP BYTE-PERFECT onchain
// merkle.ak (leaf = blake2b_256(0x00 ++ cbor(address) ++ amount_be_8); node =
// blake2b_256(0x01 ++ left ++ right)).
//
// ─────────────────────────────────────────────────────────────────────────
// LEAF ENCODING (đối chiếu merkle.ak::leaf_hash)
//   cbor(address) = Data.to(addressToPlutusData(addr)) = Plutus-Data canonical
//     CBOR của Aiken `Address` Constr → KHỚP cbor.serialise(address) onchain.
//   amount_be_8 = amount (oil) big-endian 8 byte.
//   prefix 0x00 leaf, 0x01 node → domain-separation (chống second-preimage).
// ─────────────────────────────────────────────────────────────────────────

import { blake2b } from "@noble/hashes/blake2b";
import { Constr, Data, getAddressDetails } from "@lucid-evolution/lucid";
import { LEAF_PREFIX, NODE_PREFIX } from "./constants.js";
import type { SnapshotEntry, ProofStep, MerkleTree } from "./types.js";

// ── hex helpers ────────────────────────────────────────────────────────

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`MERKLE-001: hex lẻ độ dài: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** blake2b-256 (32 byte) → hex. */
function blake256(bytes: Uint8Array): string {
  return bytesToHex(blake2b(bytes, { dkLen: 32 }));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ── Address → Plutus Data (khớp Aiken cardano/address.Address) ──────────
//
// Aiken Address = Constr(0, [payment_credential, stake_credential]).
//   credential: VerificationKey(h) = Constr(0,[h]); Script(h) = Constr(1,[h]).
//   stake: None = Constr(1,[]); Some(Inline(cred)) = Constr(0,[Constr(0,[cred])]).
//   (Pointer stake KHÔNG hỗ trợ — airdrop chỉ nhận key/script address.)

function credentialToData(hash: string, isScript: boolean): Constr<Data> {
  return new Constr(isScript ? 1 : 0, [hash]);
}

/** bech32/hex address → Plutus Data Constr khớp Aiken Address. */
export function addressToPlutusData(address: string): Constr<Data> {
  const d = getAddressDetails(address);
  if (!d.paymentCredential) {
    throw new Error(`MERKLE-010: address không có payment credential: ${address}`);
  }
  const payment = credentialToData(
    d.paymentCredential.hash,
    d.paymentCredential.type === "Script",
  );

  let stake: Constr<Data>;
  if (d.stakeCredential) {
    const sc = credentialToData(
      d.stakeCredential.hash,
      d.stakeCredential.type === "Script",
    );
    // Some(Inline(sc)) = Constr(0, [ Constr(0, [ sc ]) ]).
    stake = new Constr(0, [new Constr(0, [sc])]);
  } else {
    // None = Constr(1, []).
    stake = new Constr(1, []);
  }

  return new Constr(0, [payment, stake]);
}

/** CBOR (Plutus-Data) của address = cbor.serialise(address) onchain. */
export function addressToCborBytes(address: string): Uint8Array {
  return hexToBytes(Data.to(addressToPlutusData(address)));
}

/** amount (oil) → big-endian 8 byte (u64). Khớp bytearray.from_int_big_endian(_, 8). */
export function amountToBe8(amount: bigint): Uint8Array {
  if (amount < 0n) throw new Error("MERKLE-020: amount âm");
  if (amount >= 1n << 64n) throw new Error("MERKLE-021: amount vượt u64");
  const out = new Uint8Array(8);
  let v = amount;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// ── leaf / node hashing ─────────────────────────────────────────────────

/** leaf = blake2b_256(0x00 ++ cbor(address) ++ amount_be_8). Khớp merkle.ak. */
export function leafHash(entry: SnapshotEntry): string {
  const payload = concat(addressToCborBytes(entry.address), amountToBe8(entry.amount));
  return blake256(concat(hexToBytes(LEAF_PREFIX), payload));
}

/** node = blake2b_256(0x01 ++ left ++ right). Khớp merkle.ak::node_hash. */
export function nodeHash(left: string, right: string): string {
  return blake256(concat(hexToBytes(NODE_PREFIX), hexToBytes(left), hexToBytes(right)));
}

// ── dựng cây + proof ─────────────────────────────────────────────────────
//
// Cây nhị phân đầy theo cặp; tầng lẻ → leaf cuối "kết đôi với chính nó"
// (promote): parent = leaf (KHÔNG hash lại) → ổn định + khớp proof rỗng cho 1-leaf.
// Để onchain & offchain nhất quán: nếu số node lẻ, node cuối được ĐẨY LÊN tầng trên
// nguyên vẹn (carry) thay vì tự-hash → tránh phải mã hoá quy ước tự-hash onchain.

/** Chuẩn hoá snapshot: bỏ trùng address (giữ bản đầu), sort theo leaf hash
 *  (tất định, không phụ thuộc thứ tự nhập). */
export function normalizeSnapshot(entries: SnapshotEntry[]): SnapshotEntry[] {
  const seen = new Set<string>();
  const dedup: SnapshotEntry[] = [];
  for (const e of entries) {
    const key = getAddressDetails(e.address).address.hex; // canonical
    if (seen.has(key)) throw new Error(`MERKLE-030: địa chỉ trùng trong snapshot: ${e.address}`);
    seen.add(key);
    if (e.amount <= 0n) throw new Error(`MERKLE-031: amount ≤ 0 cho ${e.address}`);
    dedup.push({ address: e.address, amount: e.amount });
  }
  // sort theo leaf hash → thứ tự xác định.
  return dedup.sort((a, b) => (leafHash(a) < leafHash(b) ? -1 : leafHash(a) > leafHash(b) ? 1 : 0));
}

/** Dựng cây Merkle từ snapshot. Trả root + leaves + entries (đã chuẩn hoá). */
export function buildTree(rawEntries: SnapshotEntry[]): MerkleTree {
  if (rawEntries.length === 0) throw new Error("MERKLE-040: snapshot rỗng");
  const entries = normalizeSnapshot(rawEntries);
  const leaves = entries.map(leafHash);

  let level = leaves.slice();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(nodeHash(level[i]!, level[i + 1]!));
      } else {
        // node lẻ cuối → carry lên nguyên vẹn (không tự-hash).
        next.push(level[i]!);
      }
    }
    level = next;
  }
  return { root: level[0]!, leaves, entries };
}

/** Sinh Merkle proof cho leaf tại index (trong cây đã dựng). */
export function buildProof(tree: MerkleTree, leafIndex: number): ProofStep[] {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new Error(`MERKLE-050: leafIndex ngoài phạm vi: ${leafIndex}`);
  }
  const proof: ProofStep[] = [];
  let idx = leafIndex;
  let level = tree.leaves.slice();

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(nodeHash(level[i]!, level[i + 1]!));
      } else {
        next.push(level[i]!);
      }
    }
    // tìm sibling của idx ở tầng hiện tại.
    if (idx % 2 === 0) {
      // node hiện tại là TRÁI → sibling là phải (nếu tồn tại). is_left=false.
      if (idx + 1 < level.length) {
        proof.push({ is_left: false, hash: level[idx + 1]! });
      }
      // nếu lẻ cuối (không sibling) → carry, không thêm bước.
    } else {
      // node hiện tại là PHẢI → sibling là trái. is_left=true.
      proof.push({ is_left: true, hash: level[idx - 1]! });
    }
    idx = Math.floor(idx / 2);
    level = next;
  }
  return proof;
}

/** Sinh proof theo address (tiện cho claimBuilder). */
export function buildProofForAddress(
  tree: MerkleTree,
  address: string,
): { entry: SnapshotEntry; proof: ProofStep[]; leaf: string } {
  const targetHex = getAddressDetails(address).address.hex;
  const idx = tree.entries.findIndex(
    (e) => getAddressDetails(e.address).address.hex === targetHex,
  );
  if (idx < 0) throw new Error(`MERKLE-060: address không có trong snapshot: ${address}`);
  return { entry: tree.entries[idx]!, proof: buildProof(tree, idx), leaf: tree.leaves[idx]! };
}

/** Verify proof off-chain (đối chiếu logic onchain root_from_proof). */
export function verifyProof(
  root: string,
  entry: SnapshotEntry,
  proof: ProofStep[],
): boolean {
  let cur = leafHash(entry);
  for (const step of proof) {
    cur = step.is_left ? nodeHash(step.hash, cur) : nodeHash(cur, step.hash);
  }
  return cur === root;
}
