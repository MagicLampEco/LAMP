// delegatorCrypto.ts — crypto CHUNG cho luồng đăng ký/verify delegator.
//
// MỘT NGUỒN cho verify Ed25519 + suy stake address từ pubkey. Kết quả byte-perfect
// với bản đã chốt trong scripts/delegator_register.ts (cùng blake2b-28 → reward addr
// header). verify_delegator.ts + build_delegator_snapshot.ts dùng lại đây thay vì mỗi
// script tự chép — chống lệch giữa lúc ĐĂNG KÝ và lúc VERIFY.
//
// NODE-FREE có chủ đích (giống merkle.ts): dùng WebCrypto global + @noble/hashes +
// @scure/base + Uint8Array, KHÔNG node:crypto/Buffer — để offchain/src typecheck sạch
// không cần @types/node và chạy được cả ngoài Node.
//
// (spo_register.ts / delegator_register.ts / verify_registration.ts hiện vẫn giữ bản
//  chép riêng bằng node:crypto — di dời chúng sang module này là việc dọn dẹp tách riêng.)

import { blake2b } from "@noble/hashes/blake2b";
import { bech32 } from "@scure/base";
import { hexToBytes } from "./merkle.js";

// WebCrypto subtle — global trong Node ≥ 18 và trình duyệt. Khai báo tối giản để
// typecheck không cần lib DOM/@types/node.
declare const crypto: {
  subtle: {
    importKey(
      format: "raw",
      keyData: Uint8Array,
      algorithm: { name: string },
      extractable: boolean,
      keyUsages: string[],
    ): Promise<unknown>;
    verify(
      algorithm: { name: string },
      key: unknown,
      signature: Uint8Array,
      data: Uint8Array,
    ): Promise<boolean>;
  };
};

/** Verify Ed25519 với raw pubkey (32 byte hex). Sai định dạng / sai chữ ký → false. */
export async function verifyEd25519(
  messageHex: string,
  signatureHex: string,
  pubkeyHex: string,
): Promise<boolean> {
  try {
    const pub = hexToBytes(pubkeyHex);
    if (pub.length !== 32) return false;
    const sig = hexToBytes(signatureHex);
    if (sig.length !== 64) return false;
    const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, hexToBytes(messageHex));
  } catch {
    return false;
  }
}

/** stake credential hash (28 byte hex) → reward (stake) address bech32. */
export function stakeAddrFromCred(
  hashHex: string,
  isScript: boolean,
  network: string,
): string {
  const keyHash = hexToBytes(hashHex);
  if (keyHash.length !== 28) throw new Error(`DELEG-CRYPTO-001: cred hash phải 28 byte, nhận ${keyHash.length}`);
  const isMainnet = network === "Mainnet";
  // header: reward addr = 0b1110 (key) / 0b1111 (script) ++ network id.
  const typeNibble = isScript ? 0xf0 : 0xe0;
  const header = typeNibble | (isMainnet ? 0x01 : 0x00);
  const addrBytes = new Uint8Array(29);
  addrBytes[0] = header;
  addrBytes.set(keyHash, 1);
  const prefix = isMainnet ? "stake" : "stake_test";
  return bech32.encode(prefix, bech32.toWords(addrBytes), 1000);
}

/** Raw Ed25519 pubkey (32 byte hex) → stake address (reward addr, key credential). */
export function pubkeyToStakeAddr(pubkeyHex: string, network: string): string {
  const keyHash = blake2b(hexToBytes(pubkeyHex), { dkLen: 28 });
  let hex = "";
  for (const b of keyHash) hex += b.toString(16).padStart(2, "0");
  return stakeAddrFromCred(hex, false, network);
}
