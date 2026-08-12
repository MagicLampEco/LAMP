// merkle.ts — dựng cây Merkle + proof từ snapshot. KHỚP BYTE-PERFECT onchain
// merkle.ak (schema C / v2). Nguồn sự thật: SCHEMA-MERKLE-V2-Tech-Spec.md.
//
// ─────────────────────────────────────────────────────────────────────────
// LEAF ENCODING schema C (§1 — fixed-width, raw-concat, KHÔNG length-prefix)
//   leaf = blake2b_256( 0x00 ‖ campaign_id[32] ‖ epoch_be8[8] ‖ role[1]
//                            ‖ owner[28] ‖ amount_oildrop_be8[8] )   (78 byte gồm prefix)
//   node = blake2b_256( 0x01 ‖ left[32] ‖ right[32] )
//   slot = blake2b_256( epoch_be8[8] ‖ owner[28] )                   (36 byte, KHÔNG prefix)
//
//   owner[28] = credential-hash trích từ address theo VAI (§3). Delegator =
//     PAYMENT key-hash (getAddressDetails(addr).paymentCredential.hash). CLAIM vẫn
//     giữ full address (redeemer Claim{claimer,...}) — chỉ leaf dùng owner 28 byte.
//   prefix 0x00 leaf, 0x01 node → domain-separation (chống second-preimage).
//
//   THỨ TỰ LÁ (§2): sort TĂNG theo `slot` (ổn định khi amount đổi). Trùng slot
//   (cùng epoch+owner) → NÉM LỖI CỨNG (fail-closed) — có người sẽ mất tiền.
// ─────────────────────────────────────────────────────────────────────────

import { blake2b } from "@noble/hashes/blake2b";
import { Constr, Data, getAddressDetails } from "@lucid-evolution/lucid";
import { LEAF_PREFIX, NODE_PREFIX } from "./constants.js";
import type { SnapshotEntry, ProofStep, MerkleTree, MerkleParams } from "./types.js";

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

/** uint → big-endian 8 byte (u64). Khớp bytearray.from_int_big_endian(_, 8).
 *  Dùng cho cả epoch_be8 và amount_oildrop_be8 (schema C fixed-width). */
export function uintToBe8(n: bigint): Uint8Array {
  if (n < 0n) throw new Error("MERKLE-020: giá trị âm (uint be8)");
  if (n >= 1n << 64n) throw new Error("MERKLE-021: giá trị vượt u64 (uint be8)");
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** @deprecated tên cũ — dùng uintToBe8. Giữ export để không vỡ import lịch sử. */
export const amountToBe8 = uintToBe8;

/** role (0..255) → 1 byte. Khớp bytearray.from_int_big_endian(role, 1) onchain. */
function roleByte(role: number): Uint8Array {
  if (!Number.isInteger(role) || role < 0 || role > 255) {
    throw new Error(`MERKLE-022: role phải là số nguyên 0..255, nhận ${role}`);
  }
  return new Uint8Array([role]);
}

/** campaign_id (hex 32 byte) → bytes. Ép đúng 32 byte (fixed-width leaf). */
function campaignIdBytes(campaignId: string): Uint8Array {
  const b = hexToBytes(campaignId);
  if (b.length !== 32) {
    throw new Error(`MERKLE-023: campaign_id phải 32 byte (64 hex), nhận ${b.length} byte`);
  }
  return b;
}

/** owner[28] = credential-hash trích từ address theo VAI. Delegator = PAYMENT
 *  key-hash (§3). Ném lỗi nếu address không có payment credential, credential là
 *  SCRIPT, hoặc hash ≠ 28 byte.
 *
 *  Vì sao loại Script (đối xứng on-chain `util.payment_credential_hash`): owner[28]
 *  là hash trần, không phân biệt tier. Nhận address script ở đây sẽ sinh lá mà
 *  validator không bao giờ cho claim (validator ép `VerificationKey`) → phần LAMP
 *  đó kẹt trong pool tới hạn quét. Loại NGAY lúc dựng snapshot để người đăng ký
 *  biết mà khai lại địa chỉ, thay vì phát hiện lúc claim hỏng. */
export function ownerBytes(entry: SnapshotEntry): Uint8Array {
  const d = getAddressDetails(entry.address);
  if (!d.paymentCredential) {
    throw new Error(`MERKLE-024: address không có payment credential: ${entry.address}`);
  }
  if (d.paymentCredential.type === "Script") {
    throw new Error(
      `MERKLE-026: owner phải là payment KEY-hash, nhận địa chỉ SCRIPT: ${entry.address} — ` +
        `validator airdrop_pool chỉ cho claim từ VerificationKey; lá script sẽ không bao giờ claim được`,
    );
  }
  const b = hexToBytes(d.paymentCredential.hash);
  if (b.length !== 28) {
    throw new Error(`MERKLE-025: owner (payment key-hash) phải 28 byte, nhận ${b.length}: ${entry.address}`);
  }
  return b;
}

// ── leaf / node / slot hashing (schema C) ──────────────────────────────────

/** leaf = blake2b_256(0x00 ‖ campaign_id[32] ‖ epoch_be8 ‖ role[1] ‖ owner[28]
 *  ‖ amount_oildrop_be8). Khớp merkle.ak::leaf_hash_v2 byte-perfect. */
export function leafHash(entry: SnapshotEntry, params: MerkleParams): string {
  const payload = concat(
    campaignIdBytes(params.campaignId),
    uintToBe8(params.epoch),
    roleByte(params.role),
    ownerBytes(entry),
    uintToBe8(entry.amount),
  );
  return blake256(concat(hexToBytes(LEAF_PREFIX), payload));
}

/** slot = blake2b_256(epoch_be8 ‖ owner[28]). Định danh 1 (epoch, owner) trong pot —
 *  dùng để dedup + sắp lá + tên claim-slot NFT. KHÔNG prefix. */
export function slot(entry: SnapshotEntry, epoch: bigint): string {
  return blake256(concat(uintToBe8(epoch), ownerBytes(entry)));
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

/** Chuẩn hoá snapshot theo schema C (§2):
 *  - dedup theo `slot` (blake2b(epoch ‖ owner)). Trùng slot = cùng (epoch, owner) →
 *    NÉM LỖI CỨNG (fail-closed): 2 địa chỉ khác nhau nhưng cùng payment-cred cũng
 *    đụng slot → không được lặng lẽ bỏ (có người mất tiền).
 *  - sort TĂNG theo `slot` (byte-lexicographic hex) — ổn định khi amount đổi.
 *  - giữ check amount > 0. */
export function normalizeSnapshot(entries: SnapshotEntry[], params: MerkleParams): SnapshotEntry[] {
  const seen = new Map<string, string>(); // slot → address giữ chỗ (để log xung đột)
  const dedup: { entry: SnapshotEntry; slot: string }[] = [];
  for (const e of entries) {
    if (e.amount <= 0n) throw new Error(`MERKLE-031: amount ≤ 0 cho ${e.address}`);
    const s = slot(e, params.epoch);
    const prev = seen.get(s);
    if (prev !== undefined) {
      throw new Error(
        `MERKLE-030: slot trùng (cùng epoch+owner) — epoch=${params.epoch} slot=${s}; ` +
        `địa chỉ mới ${e.address} đụng ${prev}. Fail-closed: 2 payment_address cùng ` +
        `payment-cred KHÔNG được gộp im lặng. Loại thủ công ở tầng builder trước khi dựng cây.`,
      );
    }
    seen.set(s, e.address);
    dedup.push({ entry: { address: e.address, amount: e.amount }, slot: s });
  }
  // sort TĂNG theo slot → thứ tự xác định, độc lập amount.
  dedup.sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  return dedup.map((d) => d.entry);
}

/** Một tầng lên tầng cha: ghép đôi; node lẻ cuối CARRY nguyên vẹn (không tự-hash). */
function nextLayer(level: string[]): string[] {
  const next: string[] = [];
  for (let i = 0; i < level.length; i += 2) {
    next.push(i + 1 < level.length ? nodeHash(level[i]!, level[i + 1]!) : level[i]!);
  }
  return next;
}

/** Dựng cây Merkle từ snapshot. Trả root + leaves + entries (đã chuẩn hoá) + layers. */
export function buildTree(rawEntries: SnapshotEntry[], params: MerkleParams): MerkleTree {
  if (rawEntries.length === 0) throw new Error("MERKLE-040: snapshot rỗng");
  const entries = normalizeSnapshot(rawEntries, params);
  const leaves = entries.map((e) => leafHash(e, params));

  // Băm cả cây ĐÚNG 1 LẦN, giữ lại mọi tầng → buildProof chỉ còn index vào layers.
  const layers: string[][] = [leaves];
  while (layers[layers.length - 1]!.length > 1) {
    layers.push(nextLayer(layers[layers.length - 1]!));
  }
  return { root: layers[layers.length - 1]![0]!, leaves, entries, layers };
}

/** Sinh Merkle proof cho leaf tại index (trong cây đã dựng). */
export function buildProof(tree: MerkleTree, leafIndex: number): ProofStep[] {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new Error(`MERKLE-050: leafIndex ngoài phạm vi: ${leafIndex}`);
  }
  const proof: ProofStep[] = [];
  let idx = leafIndex;

  for (const level of tree.layers) {
    if (level.length <= 1) break;
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
  params: MerkleParams,
): boolean {
  let cur = leafHash(entry, params);
  for (const step of proof) {
    cur = step.is_left ? nodeHash(step.hash, cur) : nodeHash(cur, step.hash);
  }
  return cur === root;
}
