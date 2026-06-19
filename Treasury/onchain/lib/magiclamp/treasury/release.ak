// Logic thuần cho nhánh RELEASE — chi qua cổng Governance (CONTRACT §4, §9 T1/T5;
// TECH §7 C-REL-*). Tách khỏi validator để test đơn vị + giữ validator mỏng,
// mirror collect.ak.
//
// MODEL A (CHỐT T1): Treasury KHÔNG tự tính ngưỡng vote. Cổng release = ĐỌC kết
// quả Governance qua REFERENCE INPUT mang Proposal NFT one-shot; validator chỉ ép
// 5 cờ (status==Executed + spend_spec_hash khớp + execute_after_epoch + NFT +
// proposal Ở ĐÚNG địa chỉ governance_ref). Mọi ngưỡng (clamp BFT, sàn DID) do
// Governance ép TRƯỚC ở tx ExecuteProposal riêng.
//
// BẤT BIẾN ÉP (TECH §7):
//   C-REL-1  proposal Ở ĐÚNG governance_ref (payment_credential == Script(governance_ref))
//            ∧ mang ĐÚNG 1 Proposal NFT (chống NFT dời sang datum giả / replay chéo instance)
//   C-REL-3  hash canonical (bucket,asset,amount,to) của draws == spend_spec_hash   (khóa đích chi)
//   C-REL-5  ∀a custody_out.value(a) == custody_in.value(a) − Σ draw(a)   (Σout=Σin, KHÔNG burn/drain)
//   C-REL-6  ledger_out[(b,a)] == ledger_in[(b,a)] − Σ draw(b,a) ∧ draw ≤ số dư bucket  (sổ↔value)
//   C-REL-7  Σ output tới `to` value(a) ≥ Σ draw(to,a) ∧ to ≠ custody  (tổng-khớp, chống double-sat)
//   sổ out CANONICAL: strict-sorted ∧ mọi dòng > 0 (dòng cạn về 0 bị prune — ledger.ak)
//
// spend_spec_hash = blake2b_256(0x02 ‖ cbor.serialise(draws)) — canonical CBOR Plutus
// (mẫu compute_batch_id Distribution). Proposal cam kết hash này; Release tái dựng từ
// draws THỰC rồi so. Domain tag 0x02 tách khỏi merkle leaf(0x00)/node(0x01).

use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}
use magiclamp/treasury/ledger
use magiclamp/treasury/types.{LedgerEntry, ProposalResult, ReleaseDraw}

// ── C-REL-1: đọc beacon ProposalResult qua REFERENCE INPUT mang Proposal NFT ──
// Tìm reference input tại proposal_ref; ép (a) UTxO Ở ĐÚNG địa chỉ Governance của
// instance (payment_credential == Script(governance_ref)) — chống NFT proposal bị
// dời sang UTxO datum giả ở script lạ + chống replay chéo instance khác governance;
// (b) value chứa ĐÚNG 1 token policy proposal_policy (NFT one-shot chứng thực);
// decode ProposalResult từ inline datum. KHÔNG tiêu proposal (nhiều release đọc song song).

/// Tìm + xác thực + decode ProposalResult. Fail (expect) nếu thiếu ref / sai địa chỉ
/// Governance / sai NFT / sai datum.
pub fn read_proposal(
  reference_inputs : List<Input>,
  proposal_ref     : OutputReference,
  proposal_policy  : PolicyId,
  governance_ref   : ByteArray,
) -> ProposalResult {
  expect Some(ref) =
    list.find(reference_inputs, fn(i) { i.output_reference == proposal_ref })
  // (a) proposal UTxO PHẢI ở đúng Governance script của instance này (C-REL-1).
  expect Script(ph) = ref.output.address.payment_credential
  expect ph == governance_ref
  // (b) ĐÚNG 1 token của proposal_policy (NFT authenticity one-shot).
  let proposal_tokens = assets.tokens(ref.output.value, proposal_policy)
  expect dict.size(proposal_tokens) == 1
  expect [Pair(nft_name, qty)] = dict.to_pairs(proposal_tokens)
  expect qty == 1
  expect InlineDatum(d) = ref.output.datum
  expect result: ProposalResult = d
  // (c) F1: tên NFT PHẢI == proposal_id — khóa replay-marker (C-REL-9) vào DANH TÍNH
  // mật mã của NFT, KHÔNG phải field datum tự-khai. Không có vế này, một NFT có thể
  // phơi N datum khác proposal_id (cùng spec_hash) → consumed_proposals không chặn được.
  expect nft_name == result.proposal_id
  result
}

// ── C-REL-3: hash canonical danh sách draw == spend_spec_hash ──

/// Hash canonical của (instance_id, danh sách draw). Khóa đích chi (bucket,asset,amount,to)
/// VÀ instance đích (F10/#1B — chống replay chéo giữa các instance CÙNG governance_ref).
///
/// Tiền ảnh = 0x02 ‖ blake2b(instance_id) ‖ blake2b(cbor(draws)). Hai thành phần đều
/// 32 byte cố định → ghép KHÔNG nhập nhằng biên byte (dễ mirror off-chain byte-perfect,
/// tránh bẫy P8 khi nối instance_id độ dài thay đổi với cbor thô).
/// Governance KHI tạo proposal PHẢI tính spec_hash với ĐÚNG instance_id đích.
pub fn spend_spec_hash(instance_id: ByteArray, draws: List<ReleaseDraw>) -> ByteArray {
  let id_h = crypto.blake2b_256(instance_id)
  let draws_h = crypto.blake2b_256(cbor.serialise(draws))
  crypto.blake2b_256(#"02" |> bytearray.concat(id_h) |> bytearray.concat(draws_h))
}

// ── C-REL-5/6: Σ draw per-asset + per-(bucket,asset) ──

/// Tổng rút của 1 asset trên mọi draw (per-asset, gộp mọi bucket).
pub fn drawn_of_asset(draws: List<ReleaseDraw>, policy: ByteArray, name: ByteArray) -> Int {
  list.foldl(
    draws,
    0,
    fn(d, acc) {
      if d.policy == policy && d.name == name {
        acc + d.amount
      } else {
        acc
      }
    },
  )
}

/// Tổng rút của (bucket, asset) — Δ kỳ vọng cho 1 dòng sổ.
pub fn drawn_of_line(
  draws     : List<ReleaseDraw>,
  bucket_id : Int,
  policy    : ByteArray,
  name      : ByteArray,
) -> Int {
  list.foldl(
    draws,
    0,
    fn(d, acc) {
      if d.bucket_id == bucket_id && d.policy == policy && d.name == name {
        acc + d.amount
      } else {
        acc
      }
    },
  )
}

/// Value gồm đúng Σ draw per-asset (để dựng đẳng thức value). policy=#"" name=#"" = lovelace.
pub fn drawn_value(draws: List<ReleaseDraw>) -> Value {
  list.foldl(
    draws,
    assets.zero,
    fn(d, acc) { assets.add(acc, d.policy, d.name, d.amount) },
  )
}

// ── C-REL-5: value bảo toàn ĐÚNG số rút (đẳng thức tuyệt đối, KHÔNG burn/drain) ──
// custody_out.value == custody_in.value ⊖ drawn_value(draws). Một đẳng thức Value
// khóa CẢ hai chiều: asset bị rút giảm ĐÚNG Σdraw; asset không đụng giữ nguyên.

/// custody_out KHỚP TUYỆT ĐỐI custody_in − Σdraw. Khóa Σout=Σin per-asset (no drain M1).
pub fn value_ok(v_in: Value, v_out: Value, draws: List<ReleaseDraw>) -> Bool {
  v_out == assets.merge(v_in, assets.negate(drawn_value(draws)))
}

// ── C-REL-6: sổ giảm đúng bucket + draw ≤ số dư bucket, CANONICAL ──
// Mọi draw.amount ≥ 0 (chống "rút âm" để bơm sổ). Cấu trúc mirror collect.ledger_ok:
//   (1) all_draws_nonneg — không rút âm.
//   (2) ledger.is_canonical(out) — strict-sorted (loại trùng) ∧ mọi dòng > 0
//       (dòng cạn về 0 bị prune; chống nhồi/bơm/giữ dòng rác).
//   (3) each_out_line_ok — mỗi dòng out == get(in) − Δrút(draws).
//   (4) each_in_line_settled — mọi dòng in còn trong out, TRỪ khi số dư mới == 0 (prune).
//   (5) draws_within_balance — Σ rút (bucket,asset) ≤ số dư bucket (không over-draw).

pub fn all_draws_nonneg(draws: List<ReleaseDraw>) -> Bool {
  list.all(draws, fn(d) { d.amount >= 0 })
}

/// Mỗi dòng OUT == get(IN) − Σ draw đúng (bucket,asset). Vì draw ≤ in (kiểm riêng) +
/// is_canonical ép out > 0 → over-draw bị chặn cả ở giá trị lẫn ở dấu.
pub fn each_out_line_ok(
  ledger_in  : List<LedgerEntry>,
  ledger_out : List<LedgerEntry>,
  draws      : List<ReleaseDraw>,
) -> Bool {
  list.all(
    ledger_out,
    fn(e) {
      let want =
        ledger.get(ledger_in, e.bucket_id, e.policy, e.name) - drawn_of_line(
          draws,
          e.bucket_id,
          e.policy,
          e.name,
        )
      e.amount == want
    },
  )
}

/// Mọi dòng IN còn hiện diện trong OUT, TRỪ khi số dư mới (in − draw) == 0 thì prune.
pub fn each_in_line_settled(
  ledger_in  : List<LedgerEntry>,
  ledger_out : List<LedgerEntry>,
  draws      : List<ReleaseDraw>,
) -> Bool {
  list.all(
    ledger_in,
    fn(e) {
      let new_bal =
        e.amount - drawn_of_line(draws, e.bucket_id, e.policy, e.name)
      if new_bal == 0 {
        True
      } else {
        ledger.line_present(ledger_out, e)
      }
    },
  )
}

/// Mọi draw rút KHÔNG quá số dư bucket: draw_total(b,a) ≤ ledger_in[(b,a)].
/// Gộp theo (bucket,asset) để 2 draw cùng dòng cộng dồn rồi mới so số dư.
pub fn draws_within_balance(
  ledger_in : List<LedgerEntry>,
  draws     : List<ReleaseDraw>,
) -> Bool {
  list.all(
    draws,
    fn(d) {
      drawn_of_line(draws, d.bucket_id, d.policy, d.name) <= ledger.get(
        ledger_in,
        d.bucket_id,
        d.policy,
        d.name,
      )
    },
  )
}

pub fn ledger_ok(
  ledger_in  : List<LedgerEntry>,
  ledger_out : List<LedgerEntry>,
  draws      : List<ReleaseDraw>,
) -> Bool {
  all_draws_nonneg(draws) && ledger.is_canonical(ledger_out) && each_out_line_ok(
    ledger_in,
    ledger_out,
    draws,
  ) && each_in_line_settled(ledger_in, ledger_out, draws) && draws_within_balance(
    ledger_in,
    draws,
  )
}

// ── C-REL-7: người nhận đúng (tổng-khớp per (to,asset), chống double-satisfaction) ──
// KHÔNG dùng "tồn tại MỘT output ≥ amount" cho TỪNG draw: hai draw cùng (to,asset)
// có thể cùng khớp MỘT output → chi 1 lần, trừ sổ 2 lần (double-sat kinh điển).
// Đúng: gộp draw theo (to,asset) rồi so Σ output value(asset) tới `to` ≥ Σ draw.
// Kết hợp C-REL-5 (value rời custody == Σdraw, đẳng thức) khóa CẢ hai đầu.

/// Tổng value(asset) của mọi output GỬI tới address `to`.
pub fn output_sum_to(outputs: List<Output>, to: Address, policy: ByteArray, name: ByteArray) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if o.address == to {
        acc + assets.quantity_of(o.value, policy, name)
      } else {
        acc
      }
    },
  )
}

/// Tổng draw tới (to,asset).
pub fn drawn_to(draws: List<ReleaseDraw>, to: Address, policy: ByteArray, name: ByteArray) -> Int {
  list.foldl(
    draws,
    0,
    fn(d, acc) {
      if d.to == to && d.policy == policy && d.name == name {
        acc + d.amount
      } else {
        acc
      }
    },
  )
}

/// Mỗi draw: output tới `to` đủ Σ (tổng-khớp) ∧ `to` ≠ custody script hash
/// (tiền THẬT rời treasury, không gửi vòng lại chính custody để né).
pub fn recipients_ok(
  outputs     : List<Output>,
  draws       : List<ReleaseDraw>,
  custody_hash: ByteArray,
) -> Bool {
  list.all(
    draws,
    fn(d) {
      // to KHÔNG phải chính custody (chống "rút" vòng về kho né C-REL-5).
      let to_not_custody =
        when d.to.payment_credential is {
          Script(h) -> h != custody_hash
          _ -> True
        }
      to_not_custody && output_sum_to(outputs, d.to, d.policy, d.name) >= drawn_to(
        draws,
        d.to,
        d.policy,
        d.name,
      )
    },
  )
}

// ── C-REL-9: SINGLE-USE proposal (chống replay / chi vượt ngưỡng duyệt) ──
// HARD BLOCKER finding 7 (TECH §7.2). Model A đọc proposal qua reference input → đọc
// lại được VÔ HẠN; cap duy nhất của value_ok/ledger_ok là số dư bucket, KHÔNG phải
// lượng governance duyệt → cùng 1 proposal Executed có thể dựng N tx Release liên tiếp,
// rút draws×N tới khi cạn bucket. Khắc phục: custody NHỚ proposal_id đã chi:
//   (1) proposal_id CHƯA có trong consumed_proposals_in   (mỗi proposal chi đúng 1 lần).
//   (2) consumed_proposals_out == [proposal_id, ..consumed_proposals_in]   (append, monotone).
// v1 KHÔNG vesting → "một Release dùng hết proposal": spend_spec_hash khóa CHÍNH XÁC
// danh sách draw (C-REL-3) → Σ draws CỐ ĐỊNH = toàn bộ lượng duyệt. Marker chặn tx thứ 2.
// (v1.x: đưa marker RA KHỎI custody datum — proposal beacon đổi Executed→Spent — để
//  datum custody hằng số theo N; consumed_proposals list hiện O(N), đặt+đo trần N_max.)

/// proposal_id CHƯA nằm trong danh sách đã chi (chống replay).
pub fn proposal_is_fresh(consumed_in: List<ByteArray>, proposal_id: ByteArray) -> Bool {
  !list.has(consumed_in, proposal_id)
}

/// out == [proposal_id, ..in] — append ĐÚNG id mới lên đầu, giữ NGUYÊN phần còn lại
/// (không xóa id cũ = không "quên" proposal đã dùng để replay vòng sau).
pub fn consumed_appended_ok(
  consumed_in  : List<ByteArray>,
  consumed_out : List<ByteArray>,
  proposal_id  : ByteArray,
) -> Bool {
  consumed_out == [proposal_id, ..consumed_in]
}
