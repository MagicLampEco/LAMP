// accountNft — off-chain derivation của NFT xác thực per-account (C-ACC-1).
//
// BYTE-PERFECT với on-chain `util.account_nft_name` (Aiken blake2b_256 ∘ concat).
// CLAUDE.md invariant #1: đổi derivation → sửa cả 2 phía + vector cross-check.
//
//   name = blake2b_256( owner_pkh ‖ channel_id )   (dkLen 32)

import { blake2b } from "@noble/hashes/blake2b";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";

/**
 * Ghim owner = 28 byte, KHỚP `expect bytearray.length(ad.owner) == 28` ở cổng mint
 * (`account_nft.ak`). Bắt buộc vì derivation nối THẲNG owner ‖ channel: owner độ dài tự do
 * thì biên mập mờ và hai cặp (owner, channel) khác nhau băm ra CÙNG một tên — NFT của
 * account này xác thực được UTxO của account kia. Ném ở đây để lỗi lộ lúc dựng tx, chứ
 * không phải sau khi đã ký và bị validator từ chối.
 */
export function accountNftName(ownerHex: string, channelHex: string): string {
  if (ownerHex.length !== 56)
    throw new Error(
      `ACC-NFT-001: owner phải là pkh 28 byte (56 ký tự hex), nhận ${ownerHex.length}. ` +
      `Derivation nối thẳng owner ‖ channel nên owner sai độ dài làm biên hai trường mập mờ.`,
    );
  const bytes = hexToBytes(ownerHex + channelHex);
  return bytesToHex(blake2b(bytes, { dkLen: 32 }));
}
