// Giá trị neo CBOR suy từ AIKEN — không phải từ SDK.
//
// Cách sinh (2026-09-29, aiken v1.1.21+42babe5, onchain gov-v2 @ 46a3a36): chép `Governance/onchain`
// sang thư mục nháp, thêm MỘT module ca kiểm `validators/zz_cbor_probe.ak` dựng đúng các giá trị
// dưới đây bằng kiểu Aiken thật (import `governance`, `vote`, `tally`, `nullifier`, `tally_nft`,
// `weight_param_nft`, `types`, `mpf_fixtures`) rồi `trace bytearray.to_hex(cbor.serialise(x))`;
// chạy `aiken check -m "zz_cbor_probe.{..}"`, chép nguyên văn dòng trace (đổi sang chữ thường),
// xoá bản nháp. Không có tệp nào trong `Governance/onchain` bị sửa.
//
// Hằng dùng trong ca probe:
//   pid  = #"ab"×32 · did = #"cd"×32 · txid = #"ef"×32
//   wref = OutputReference{txid, 3} · seed0 = {txid, 0} · seed7 = {txid, 7}
//   nul  = nullifier_name(did, pid)
//   proof dùng lại `mpf_fixtures.ak` bộ `b`: ins_b1, ins_b2, mem_b1_2.

export const PID = "ab".repeat(32);
export const DID = "cd".repeat(32);
export const TXID = "ef".repeat(32);

export const AIKEN = {
  TALLY_DATUM:
    "d8799f5820ababababababababababababababababababababababababababababababababd87a80d8799f5820efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef03ff1b000000e8d4a51000070005039fd8799fc24d018ee90ff6c373e0ee4e3f0ad2d87980ffd8799f05d87a80ffff19038407000a145820e73e5abe12780226ab6b650792377ef625bf5771ea943bd674880c8aacc17cadff",
  VOTE_DATUM:
    "d8799f5820abababababababababababababababababababababababababababababababab5820cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd5820035a3e2fb57b8f36eaaebfb85d558f407958d9670163483fbdfebfcc96ca9e29d87b800000182a00ff",
  PROPOSAL_RESULT:
    "d8799f5820ababababababababababababababababababababababababababababababababd87b8040181900ff",
  PROPOSAL_DATUM:
    "d8799f5820ababababababababababababababababababababababababababababababababd87a800a140ad8799f5820efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef03ff42010203161864183209ff",
  WEIGHT_PARAM:
    "d8799f9fd8799f0000ffd8799f18641b000000174876e800ffff9fd8799f0000ffd8799f18191b000000012a05f200ffd8799f18641b00000002540be400ffff9fd8799f0000ffd8799f18641b000000174876e800ffff9fd8799f0000ffd8799f18191b000000012a05f200ffd8799f18641b00000002540be400ffff1501150203ff",
  R_OPEN:
    "d8799fd8799f5820efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef00ff0a14d8799f5820efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef03ffff",
  R_FINALIZE_PROPOSAL: "d87980",
  R_CONSUME:
    "d8799f9fd87b9f005820b4dd4eedb83933b6e013971585befe56e26e4f0a875aea0938f406563e53eadb5820f9dab211eabbd410aefff8ed09ffefbadb9888068fee80d03b9ea216f1c5b836ffffff",
  R_RETRACT: "d87a80",
  R_RECLAIM: "d87b80",
  R_SUMBATCH:
    "d8799f9f809fd87b9f0058204c54f47d69e097eed691c686ac18444a10d4abe934c311d0fffba9a3928f9e7158209cd469afb0031d5669e10b57e22f4482e767c526b56647cef44996e065e1bc8fffffffff",
  R_TALLY_FINALIZE: "d87a80",
  R_MINT_NULLIFIER:
    "d8799f5820cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd5820ababababababababababababababababababababababababababababababababff",
  R_BURN_NULLIFIER: "d87a80",
  R_MINT_TALLY:
    "d8799fd8799f5820efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef00ffff",
  R_MINT_WEIGHT_PARAM: "d87980",
  SEED7_CBOR:
    "d8799f5820efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef07ff",
  PROPOSAL_ID_SEED7: "992f4e6c1d80fd245f7dbcb41cc168f443bd9115f166f8aa3a3a04d4de900fb0",
  NULLIFIER_DID_PID: "035a3e2fb57b8f36eaaebfb85d558f407958d9670163483fbdfebfcc96ca9e29",
} as const;

/** Gốc sổ trong `onchain/lib/magiclamp/governance/mpf_fixtures.ak` (bộ a, b, c). */
export const MPF_FIXTURE_ROOTS = {
  a: [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "f61f4cedb818770b83c26787080e864e71ade8d71b0dc6bcbaeab561696ecba6",
    "a576dacd5d532cd6028c0bfe95802bad617032e570285fdf3786c68eed343f58",
    "f9f34a796a7a2ee867430a5e17988614099a04c699ba56953f91e1bb01cdc23f",
    "631a078e7b3e54f40ac894f76d39f5138b833dab9b4204f4b712421ab9ac63cc",
    "9b8fe54957710517289e7f802a363b0dfe5fa5bca0311191429f1ba4f6b0c33f",
    "630ce637953d81493830eef18f48103912ba79db3345872ba8ae0a1dfb3538f6",
  ],
  b: [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "48cdd42bab582a7042d063b1ba7c3aef48b2c6569229219be2e182387f48ee25",
    "e73e5abe12780226ab6b650792377ef625bf5771ea943bd674880c8aacc17cad",
  ],
  c: [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "231310334b733439f80491b9e40b861f89a93662df1f809f630640b7e0be8497",
  ],
} as const;

/** Giá trị lá của bộ `a` (val_a1..a6) — nullifier canonical H(did ‖ #"abcd"). */
export const MPF_FIXTURE_VALUES_A = [
  "5be9e373c645adedaca973f3de0223135aff7b00afd6985108fcd1bf95eb078e",
  "949913ec007f317797c9d4d0bb655f8fc4e975cd51e9287c1614de695243add8",
  "6d76b2dd94ece20602d4e0d4252e2fe101be7d4a27c29dbe7d9f4b903517143b",
  "13bfd9da089a430541ab1c2b836f3126538adedbb88479041eb17f308837b90b",
  "997e8c0ee634f0c4808d1b5211ab2a50e19db45281ab9ff93ab51c4113fee2e9",
  "56f5b94b58cf5861deac87736d94c44c488d323848651ce06220cb2c405da0c5",
] as const;
