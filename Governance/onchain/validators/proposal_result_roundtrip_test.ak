// D10 round-trip — KHÓA byte-perfect Gov→Treasury (CONTRACT §5 D10).
//
// Governance phơi ProposalResult; Treasury release.ak decode ProposalResult. Test này
// MIRROR type Treasury (sao chép NGUYÊN VĂN từ Treasury/onchain/.../types.ak:67-84) rồi
// kiểm: serialise ProposalResult của Governance → decode bằng type mirror Treasury PHẢI
// KHỚP. status=Executed (index 2). KHÔNG có "Closed" → nếu Governance lệch thứ tự sẽ
// decode-fail trên UTxO thật.

use aiken/cbor
use magiclamp/governance/types as gov

// ── MIRROR Treasury types (sao y Treasury/onchain/lib/magiclamp/treasury/types.ak) ──
// THỨ TỰ field + biến thể PHẢI khớp Treasury byte-perfect. Đây là "bên kia" của interface.

type TreasuryProposalStatus {
  Open
  Tallied
  Executed
  Rejected
}

type TreasuryProposalResult {
  proposal_id: ByteArray,
  status: TreasuryProposalStatus,
  spend_spec_hash: ByteArray,
  execute_after_epoch: Int,
  released_cumulative: Int,
}

// ── Round-trip: serialise Gov.ProposalResult → decode TreasuryProposalResult ──

/// Dựng ProposalResult Governance với status Executed.
fn gov_result_executed() -> gov.ProposalResult {
  gov.ProposalResult {
    proposal_id: #"abcd",
    status: gov.Executed,
    spend_spec_hash: #"5ec0",
    execute_after_epoch: 22,
    released_cumulative: 0,
  }
}

test d10_roundtrip_executed_matches_treasury() {
  let g = gov_result_executed()
  // serialise bằng CBOR Plutus (deterministic) rồi decode bằng type mirror Treasury.
  let bytes = cbor.serialise(g)
  expect Some(data) = cbor.deserialise(bytes)
  expect t: TreasuryProposalResult = data
  and {
    t.proposal_id == #"abcd",
    t.status == Executed,
    t.spend_spec_hash == #"5ec0",
    t.execute_after_epoch == 22,
    t.released_cumulative == 0,
  }
}

test d10_status_executed_is_constr_index_2() {
  // Executed PHẢI là Constr index 2 (Open=0, Tallied=1, Executed=2, Rejected=3).
  // serialise gov.Executed và Treasury Executed → BYTE GIỐNG HỆT.
  let g_bytes = cbor.serialise(gov.Executed)
  let t_bytes = cbor.serialise(Executed)
  g_bytes == t_bytes
}

test d10_all_statuses_byte_match() {
  // Mọi biến thể status khớp byte (thứ tự index 0,1,2,3 đồng nhất hai bên).
  and {
    cbor.serialise(gov.Open) == cbor.serialise(Open),
    cbor.serialise(gov.Tallied) == cbor.serialise(Tallied),
    cbor.serialise(gov.Executed) == cbor.serialise(Executed),
    cbor.serialise(gov.Rejected) == cbor.serialise(Rejected),
  }
}

test d10_full_result_byte_identical() {
  // ProposalResult đầy đủ: bytes Gov == bytes mirror Treasury (cùng dữ liệu) → interface khớp.
  let g = gov_result_executed()
  let t =
    TreasuryProposalResult {
      proposal_id: #"abcd",
      status: Executed,
      spend_spec_hash: #"5ec0",
      execute_after_epoch: 22,
      released_cumulative: 0,
    }
  cbor.serialise(g) == cbor.serialise(t)
}

// NEGATIVE: nếu hai bên LỆCH thứ tự status (vd Governance dùng {Open,Closed,Tallied,
// Executed} như TECH draft cũ), Executed sẽ ở index 3 thay vì 2 → byte KHÁC Treasury
// index 2. Mô phỏng "bên lệch" để chứng minh test BẮT được lệch index.

type WrongStatus {
  WOpen
  // 0
  WClosed
  // 1  ← "Closed" chèn vào (TECH draft cũ — D10 cấm)
  WTallied
  // 2
  WExecuted
}

// 3  ← Executed bị đẩy xuống index 3, LỆCH Treasury index 2

test d10_wrong_order_detected() fail {
  // WExecuted (index 3) serialise KHÁC Treasury Executed (index 2) → nếu chúng bằng nhau
  // thì test này pass; ta expect chúng KHÁC nhau nên `expect ... ==` phải fail.
  expect cbor.serialise(WExecuted) == cbor.serialise(Executed)
  True
}

test d10_wrong_order_indices_proof() {
  // Chứng minh ánh xạ index của type LỆCH: WOpen=0, WClosed=1, WTallied=2, WExecuted=3.
  // WTallied (index 2) trùng byte Treasury Executed (index 2) — đúng là chỗ "Closed" đẩy
  // Executed lệch sang 3. Đây là bằng chứng vì sao D10 cấm chèn "Closed".
  and {
    cbor.serialise(WOpen) == cbor.serialise(Open),
    cbor.serialise(WClosed) == cbor.serialise(Tallied),
    cbor.serialise(WTallied) == cbor.serialise(Executed),
    cbor.serialise(WExecuted) == cbor.serialise(Rejected),
  }
}
