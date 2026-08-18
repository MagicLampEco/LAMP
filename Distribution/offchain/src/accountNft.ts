// Account authenticity NFT — tên tài sản + redeemer đúc.
//
// Validator `claim_account_nft` (3 tham số: committee, threshold, treasury_nft_policy) đúc
// ĐÚNG 1 NFT cho mỗi ClaimAccount, tên = blake2b_256(owner_pkh):
//
//   A-ACC-2  đúng một asset name trong policy này, số lượng == 1
//   A-ACC-3  NFT phải nằm ở output là Script, mang ClaimAccountDatum
//   A-ACC-4  nft_name == blake2b_256(cad.owner)
//   A-ACC-5  cad.redeemed == 0 (chỉ account mới)
//   A-ACC-6  đúng 1 input mang TRSY NFT (ép treasury.GrantEntitlement cùng chạy)
//
// Và `claim_account` (C-ACC-0) đòi NFT ĐÚNG TÊN ĐÓ có mặt ở cả input lẫn output mỗi lần
// spend. Tên sai một bit ⇒ account đúc ra KHÔNG BAO GIỜ spend được: LAMP là hệ KHÔNG BURN,
// nên NFT sai tên và mọi thứ khoá theo nó nằm chết vĩnh viễn ở địa chỉ script.

import { Constr, Data, toUnit } from "@lucid-evolution/lucid";
import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

/** Strip leading `0x` + lowercase (Plutus bytes là hex trần). */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

/**
 * Tên NFT account = blake2b_256(owner_pkh) — PHẢI khớp `blake2b_256` của Aiken
 * (blake2b digest 32 byte, không key, không salt).
 */
export function accountNftName(ownerPkh: string): string {
  const h = normHex(ownerPkh);
  if (h.length === 0 || h.length % 2 !== 0 || !/^[0-9a-f]*$/.test(h)) {
    throw new Error(`ACCNFT-001: ownerPkh không phải hex hợp lệ: '${ownerPkh}'`);
  }
  return bytesToHex(blake2b(hexToBytes(h), { dkLen: 32 }));
}

/** Unit (policyId + assetName) của NFT account cho owner này. */
export function accountNftUnit(policyId: string, ownerPkh: string): string {
  return toUnit(normHex(policyId), accountNftName(ownerPkh));
}

/** ClaimAccountNftRedeemer: MintAccount = Constr(0, []). */
export function encodeMintAccountRedeemer(): Constr<Data> {
  return new Constr(0, []);
}

export function mintAccountRedeemerToCbor(): string {
  return Data.to(encodeMintAccountRedeemer());
}
