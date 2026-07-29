// accountNft — off-chain derivation của NFT xác thực per-account (C-ACC-1).
//
// BYTE-PERFECT với on-chain `util.account_nft_name` (Aiken blake2b_256 ∘ concat).
// CLAUDE.md invariant #1: đổi derivation → sửa cả 2 phía + vector cross-check.
//
//   name = blake2b_256( owner_pkh ‖ channel_id )   (dkLen 32)

import { blake2b } from "@noble/hashes/blake2b";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";

/** owner/channel là hex string (không 0x). Trả hex 64 ký tự (32 byte). */
export function accountNftName(ownerHex: string, channelHex: string): string {
  const bytes = hexToBytes(ownerHex + channelHex);
  return bytesToHex(blake2b(bytes, { dkLen: 32 }));
}
