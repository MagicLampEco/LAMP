// Tên tài sản canonical của đường biểu quyết — bản chiếu `onchain/lib/magiclamp/governance/names.ak`.
//
//   proposal_id_of(seed)            = blake2b_256(cbor.serialise(seed))
//   nullifier_name(did, proposal)   = blake2b_256(did_commit ‖ proposal_id)
//
// `cbor.serialise` phía Aiken = builtin `serialiseData`. Phía này dùng `Data.to` của Lucid;
// hai bộ mã hoá cho CÙNG byte với `OutputReference` là điều được KIỂM bằng giá trị neo suy từ
// Aiken (`tests/names.test.ts`), không phải điều được giả định.

import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { Data } from "@lucid-evolution/lucid";

import { HASH32_BYTES, assertHex, encodeOutputRef } from "./datum.js";
import type { OutputRef } from "./types.js";

export function blake2b256Hex(hex: string): string {
  return bytesToHex(blake2b(hexToBytes(assertHex(hex, null, "blake2b256 input")), { dkLen: 32 }));
}

/** names.ak ▸ proposal_id_of — danh tính proposal = tên token proposal = tên token tally. */
export function proposalIdOf(seed: OutputRef): string {
  return blake2b256Hex(Data.to(encodeOutputRef(seed)));
}

/**
 * names.ak ▸ nullifier_name. SDK đòi cả hai vế đúng 32 byte: phép ghép không dấu phân cách
 * chỉ không nhập nhằng khi độ dài cố định (xem ca `nl_name_ghep_khong_nhap_nhang_...` trong
 * names.ak). Dạng thô không kiểm độ dài ở `nullifierNameRaw` — chỉ dùng cho vector kiểm.
 */
export function nullifierName(didCommit: string, proposalId: string): string {
  assertHex(didCommit, HASH32_BYTES, "nullifierName.did_commit");
  assertHex(proposalId, HASH32_BYTES, "nullifierName.proposal_id");
  return nullifierNameRaw(didCommit, proposalId);
}

export function nullifierNameRaw(didCommit: string, proposalId: string): string {
  return blake2b256Hex(assertHex(didCommit, null, "did_commit") + assertHex(proposalId, null, "proposal_id"));
}
