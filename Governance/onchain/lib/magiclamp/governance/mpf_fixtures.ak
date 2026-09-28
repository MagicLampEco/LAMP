// SINH TỰ ĐỘNG — KHÔNG SỬA TAY.
// Bộ sinh: package `off-chain` của aiken-lang/merkle-patricia-forestry (proof.toAiken()).
// Khoá MPF = did_commit, giá trị = nullifier = blake2b_256(did_commit ‖ proposal_id).
// Chỉ dùng trong ca kiểm: gốc và chứng minh phải do bên dựng giao dịch sinh off-chain.

use aiken/merkle_patricia_forestry.{Branch, Leaf, Proof}

// ═══ bộ `a`: proposal_id = #"abcd", did_commit = #"11", #"12", #"13", #"14", #"15", #"16" ═══

/// Gốc sổ sau khi ghi 0 DID đầu.
pub const root_a0: ByteArray = #"0000000000000000000000000000000000000000000000000000000000000000"

/// Gốc sổ sau khi ghi 1 DID đầu.
pub const root_a1: ByteArray = #"f61f4cedb818770b83c26787080e864e71ade8d71b0dc6bcbaeab561696ecba6"

/// Gốc sổ sau khi ghi 2 DID đầu.
pub const root_a2: ByteArray = #"a576dacd5d532cd6028c0bfe95802bad617032e570285fdf3786c68eed343f58"

/// Gốc sổ sau khi ghi 3 DID đầu.
pub const root_a3: ByteArray = #"f9f34a796a7a2ee867430a5e17988614099a04c699ba56953f91e1bb01cdc23f"

/// Gốc sổ sau khi ghi 4 DID đầu.
pub const root_a4: ByteArray = #"631a078e7b3e54f40ac894f76d39f5138b833dab9b4204f4b712421ab9ac63cc"

/// Gốc sổ sau khi ghi 5 DID đầu.
pub const root_a5: ByteArray = #"9b8fe54957710517289e7f802a363b0dfe5fa5bca0311191429f1ba4f6b0c33f"

/// Gốc sổ sau khi ghi 6 DID đầu.
pub const root_a6: ByteArray = #"630ce637953d81493830eef18f48103912ba79db3345872ba8ae0a1dfb3538f6"

/// Chứng minh CHÈN did #1 vào sổ đang có 0 DID.
pub fn ins_a1() -> Proof {
  []
}

/// Chứng minh CHÈN did #2 vào sổ đang có 1 DID.
pub fn ins_a2() -> Proof {
  [
  Leaf { skip: 0, key: #"4c54f47d69e097eed691c686ac18444a10d4abe934c311d0fffba9a3928f9e71", value: #"a8e7b8891f4d086ba5dc7eb55d8981358e25758b8af2db0774c4bb1ad90faa63" },
]
}

/// Chứng minh CHÈN did #3 vào sổ đang có 2 DID.
pub fn ins_a3() -> Proof {
  [
  Branch { skip: 0, neighbors: #"73cc3bd422672cfe554897038778525842bf60da5c9df7d6864c8a14ecc7e79685c09af929492a871e4fae32d9d5c36e352471cd659bcdb61de08f1722acc3b10eb923b0cbd24df54401d998531feead35a47a99f4deed205de4af81120f976199f5ac8a08faca8352428cc684514a2eb24d8776688d59147f2899cd20c43955" },
]
}

/// Chứng minh CHÈN did #4 vào sổ đang có 3 DID.
pub fn ins_a4() -> Proof {
  [
  Branch { skip: 0, neighbors: #"5407b539c23b97b78cfcf7018fcc9c55bf5e29d99500a0c27f274c1f09a2564e85c09af929492a871e4fae32d9d5c36e352471cd659bcdb61de08f1722acc3b10eb923b0cbd24df54401d998531feead35a47a99f4deed205de4af81120f9761189ba7b9fd136ab37b0a1b669928887853213c6e2640f71ec497e8478f95b76e" },
]
}

/// Chứng minh CHÈN did #5 vào sổ đang có 4 DID.
pub fn ins_a5() -> Proof {
  [
  Branch { skip: 0, neighbors: #"c9ff834773d7728ce39fbbe1f4f612bf7007b9a50af1e216cb3fa6fc19cadef285c09af929492a871e4fae32d9d5c36e352471cd659bcdb61de08f1722acc3b1bb640e65fd69da73dfaa3fa9c4cae30db985f7049410764a9ec9641d177ebcd00000000000000000000000000000000000000000000000000000000000000000" },
]
}

/// Chứng minh CHÈN did #6 vào sổ đang có 5 DID.
pub fn ins_a6() -> Proof {
  [
  Branch { skip: 0, neighbors: #"c9ff834773d7728ce39fbbe1f4f612bf7007b9a50af1e216cb3fa6fc19cadef276d4ebb895728ce356d765be7865ff15b76965f50f32bc3937bf5ea513133f8c0eb923b0cbd24df54401d998531feead35a47a99f4deed205de4af81120f97610000000000000000000000000000000000000000000000000000000000000000" },
]
}

/// Chứng minh did #1 CÓ TRONG sổ 1 DID (gốc `root_a1`).
pub fn mem_a1_1() -> Proof {
  []
}

/// Chứng minh did #1 CÓ TRONG sổ 2 DID (gốc `root_a2`).
pub fn mem_a1_2() -> Proof {
  [
  Leaf { skip: 0, key: #"b4dd4eedb83933b6e013971585befe56e26e4f0a875aea0938f406563e53eadb", value: #"3f3a4aa4ace18d7163309110b75d689d729a6ef9ecfb1a324aa1f55bb73a200e" },
]
}

/// Chứng minh did #2 CÓ TRONG sổ 2 DID (gốc `root_a2`).
pub fn mem_a2_2() -> Proof {
  [
  Leaf { skip: 0, key: #"4c54f47d69e097eed691c686ac18444a10d4abe934c311d0fffba9a3928f9e71", value: #"a8e7b8891f4d086ba5dc7eb55d8981358e25758b8af2db0774c4bb1ad90faa63" },
]
}

// ═══ bộ `b`: proposal_id = #"22", did_commit = #"11", #"12" ═══

/// Gốc sổ sau khi ghi 0 DID đầu.
pub const root_b0: ByteArray = #"0000000000000000000000000000000000000000000000000000000000000000"

/// Gốc sổ sau khi ghi 1 DID đầu.
pub const root_b1: ByteArray = #"48cdd42bab582a7042d063b1ba7c3aef48b2c6569229219be2e182387f48ee25"

/// Gốc sổ sau khi ghi 2 DID đầu.
pub const root_b2: ByteArray = #"e73e5abe12780226ab6b650792377ef625bf5771ea943bd674880c8aacc17cad"

/// Chứng minh CHÈN did #1 vào sổ đang có 0 DID.
pub fn ins_b1() -> Proof {
  []
}

/// Chứng minh CHÈN did #2 vào sổ đang có 1 DID.
pub fn ins_b2() -> Proof {
  [
  Leaf { skip: 0, key: #"4c54f47d69e097eed691c686ac18444a10d4abe934c311d0fffba9a3928f9e71", value: #"9cd469afb0031d5669e10b57e22f4482e767c526b56647cef44996e065e1bc8f" },
]
}

/// Chứng minh did #1 CÓ TRONG sổ 1 DID (gốc `root_b1`).
pub fn mem_b1_1() -> Proof {
  []
}

/// Chứng minh did #1 CÓ TRONG sổ 2 DID (gốc `root_b2`).
pub fn mem_b1_2() -> Proof {
  [
  Leaf { skip: 0, key: #"b4dd4eedb83933b6e013971585befe56e26e4f0a875aea0938f406563e53eadb", value: #"f9dab211eabbd410aefff8ed09ffefbadb9888068fee80d03b9ea216f1c5b836" },
]
}

/// Chứng minh did #2 CÓ TRONG sổ 2 DID (gốc `root_b2`).
pub fn mem_b2_2() -> Proof {
  [
  Leaf { skip: 0, key: #"4c54f47d69e097eed691c686ac18444a10d4abe934c311d0fffba9a3928f9e71", value: #"9cd469afb0031d5669e10b57e22f4482e767c526b56647cef44996e065e1bc8f" },
]
}
