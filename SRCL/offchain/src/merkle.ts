// SRCL Merkle (off-chain) — PHẢI khớp BYTE-PERFECT onchain merkle.ak.
//
// SƠ ĐỒ HASH (đồng nhất với Aiken):
//   leaf   = blake2b_256( 0x00 ++ epoch_be8 ++ owner ++ amount_be8 )
//   node   = blake2b_256( 0x01 ++ left ++ right )
//   marker_name = blake2b_256( epoch_be8 ++ owner )
//
// - epoch + amount mã hoá big-endian 8 byte (cố định) — KHÔNG nhập nhằng độ dài.
// - KHÔNG sort cặp: vị trí trái/phải giữ nguyên theo thứ tự leaf → on-chain rẻ.
// - Cây đầy đủ; nếu số leaf lẻ ở 1 tầng, leaf cuối được "thăng" lên tầng trên
//   (carry) — quy ước phổ biến, vẫn xác định và proof vẫn đúng.

import { blake2b } from "@noble/hashes/blake2b";
import type { MerkleStep } from "./types.js";

const LEAF_TAG = new Uint8Array([0x00]);
const NODE_TAG = new Uint8Array([0x01]);

/** hex → bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`SRCL-MERKLE-000: hex độ dài lẻ: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** bytes → hex. */
export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** Int (bigint, 0 ≤ n < 2^64) → big-endian 8 byte. Khớp merkle.int_to_be8. */
export function intToBe8(n: bigint): Uint8Array {
  if (n < 0n) throw new Error(`SRCL-MERKLE-001: int âm không hỗ trợ: ${n}`);
  if (n >= 1n << 64n) throw new Error(`SRCL-MERKLE-002: int vượt 2^64: ${n}`);
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function b2b256(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 });
}

/** Hash leaf (epoch, owner, amount). Trả hex. Khớp merkle.leaf_hash. */
export function leafHash(epoch: bigint, owner: string, amount: bigint): string {
  return bytesToHex(
    b2b256(concat(LEAF_TAG, intToBe8(epoch), hexToBytes(owner), intToBe8(amount))),
  );
}

/** Hash node cha từ 2 con (hex). Khớp merkle.node_hash. */
export function nodeHash(left: string, right: string): string {
  return bytesToHex(b2b256(concat(NODE_TAG, hexToBytes(left), hexToBytes(right))));
}

/** Asset name MARKER NFT cho (epoch, owner). Trả hex. Khớp merkle.marker_name. */
export function markerName(epoch: bigint, owner: string): string {
  return bytesToHex(b2b256(concat(intToBe8(epoch), hexToBytes(owner))));
}

/** 1 leaf đã hash (giữ kèm khoá để tra proof). */
export interface MerkleLeaf {
  epoch: bigint;
  owner: string;
  amount: bigint;
  hash: string;
}

/** Cây Merkle dựng từ list leaf (giữ THỨ TỰ truyền vào → proof xác định). */
export class MerkleTree {
  readonly leaves: MerkleLeaf[];
  readonly root: string;
  /** Các tầng từ leaf (layers[0]) lên root (layers[last] = [root]). */
  private readonly layers: string[][];

  constructor(leaves: MerkleLeaf[]) {
    if (leaves.length === 0) throw new Error("SRCL-MERKLE-010: cây rỗng");
    this.leaves = leaves;
    this.layers = [leaves.map((l) => l.hash)];
    while (this.layers[this.layers.length - 1]!.length > 1) {
      const cur = this.layers[this.layers.length - 1]!;
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        if (i + 1 < cur.length) {
          next.push(nodeHash(cur[i]!, cur[i + 1]!));
        } else {
          // số lẻ: thăng leaf cuối (carry) lên tầng trên.
          next.push(cur[i]!);
        }
      }
      this.layers.push(next);
    }
    this.root = this.layers[this.layers.length - 1]![0]!;
  }

  /** Proof cho leaf tại index. */
  proofAt(index: number): MerkleStep[] {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`SRCL-MERKLE-011: index ngoài phạm vi: ${index}`);
    }
    const steps: MerkleStep[] = [];
    let idx = index;
    for (let layer = 0; layer < this.layers.length - 1; layer++) {
      const cur = this.layers[layer]!;
      const isRight = idx % 2 === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      if (sibIdx < cur.length) {
        // anh-em ở BÊN TRÁI nếu node hiện tại là con PHẢI.
        steps.push({ hash: cur[sibIdx]!, left: isRight });
      }
      // node được carry (không có anh-em) → bỏ qua bước, lên tầng trên.
      idx = Math.floor(idx / 2);
    }
    return steps;
  }

  /** Proof cho (epoch, owner) — tra leaf đầu tiên khớp. */
  proofFor(epoch: bigint, owner: string): MerkleStep[] {
    const i = this.leaves.findIndex((l) => l.epoch === epoch && l.owner === owner);
    if (i < 0) throw new Error(`SRCL-MERKLE-012: không thấy leaf (epoch=${epoch}, owner=${owner})`);
    return this.proofAt(i);
  }
}

/** Xác thực 1 proof off-chain (đối chiếu với on-chain). */
export function verifyProof(
  root: string,
  epoch: bigint,
  owner: string,
  amount: bigint,
  proof: MerkleStep[],
): boolean {
  let cur = leafHash(epoch, owner, amount);
  for (const step of proof) {
    cur = step.left ? nodeHash(step.hash, cur) : nodeHash(cur, step.hash);
  }
  return cur === root;
}

/** Dựng cây từ list (epoch, owner, amount). */
export function buildTree(
  entries: { epoch: bigint; owner: string; amount: bigint }[],
): MerkleTree {
  return new MerkleTree(
    entries.map((e) => ({
      ...e,
      hash: leafHash(e.epoch, e.owner, e.amount),
    })),
  );
}
