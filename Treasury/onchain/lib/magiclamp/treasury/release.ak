// Logic thuần cho nhánh RELEASE — chi qua cổng Governance (CONTRACT §4, §9 T1/T5;
// TECH §7 C-REL-*). Tách khỏi validator để test đơn vị + giữ validator mỏng,
// mirror collect.ak.
//
// MODEL A (CHỐT T1): Treasury KHÔNG tự tính ngưỡng vote. Cổng release = ĐỌC kết
// quả Governance qua REFERENCE INPUT mang Proposal NFT one-shot; validator chỉ ép
// 5 cờ (status==Executed + spend_spec_hash khớp + execute_after_epoch + NFT +
// proposal Ở ĐÚNG địa chỉ Governance hiện hành g). Mọi ngưỡng (clamp BFT, sàn DID) do
// Governance ép TRƯỚC ở tx ExecuteProposal riêng.
//
// `g` KHÔNG phải `CustodyDatum.governance_ref`. Từ con trỏ governance
// (Treasury/GovernancePointer.md), `governance_ref` là policy id của NFT con trỏ;
// `custody.ak` nhánh Release đọc g = PointerDatum.governance_hash qua reference input
// (`pointer.read_governance`) rồi gọi `read_proposal(…, g, g)`. Tham số thứ tư của
// `read_proposal` dưới đây vì vậy mang g, dù tên của nó là `governance_ref`.
//
// BẤT BIẾN ÉP (TECH §7):
//   C-REL-1  proposal Ở ĐÚNG Governance g (payment_credential == Script(g); g đọc từ con trỏ)
//            ∧ mang ĐÚNG 1 Proposal NFT (chống NFT dời sang datum giả / replay chéo instance)
//   C-REL-3  hash canonical (seed_policy, instance_id, draws) == spend_spec_hash   (khóa đích chi + kho)
//   C-REL-5  ∀a custody_out.value(a) == custody_in.value(a) − Σ draw(a)   (Σout=Σin, KHÔNG burn/drain)
//   C-REL-6  ledger_out[(b,a)] == ledger_in[(b,a)] − Σ draw(b,a) ∧ draw ≤ số dư bucket  (sổ↔value)
//   C-REL-7  Σ output tới `to` value(a) − Σ input cùng payment credential với `to` value(a)
//            ≥ Σ draw(to,a) ∧ to ≠ custody  (đo RÒNG, chống double-sat qua UTxO tái tạo tại `to`)
//   C-REL-SOLE  tx chạy đúng MỘT script Plutus (|tx.redeemers| ≤ 1 = chính custody) — chống
//            hai kho / một validator khác cùng chấm MỘT output người nhận
//   sổ out CANONICAL: strict-sorted ∧ mọi dòng > 0 (dòng cạn về 0 bị prune — ledger.ak)
//
// spend_spec_hash = blake2b_256(0x03 ‖ blake2b(seed_policy) ‖ blake2b(instance_id) ‖
// blake2b(cbor.serialise(draws))) — canonical CBOR Plutus (mẫu compute_batch_id Distribution).
// Proposal cam kết hash này; Release tái dựng từ draws THỰC rồi so. Domain tag 0x03 tách khỏi
// merkle leaf(0x00)/node(0x01) và khỏi bản trước (0x02, chưa gắn seed_policy) — xem hàm.

use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto
use aiken/primitive/bytearray
use cardano/address.{Address, PaymentCredential, Script}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose,
}
use magiclamp/treasury/ledger
use magiclamp/treasury/types.{LedgerEntry, ProposalResult, ReleaseDraw}

// ── C-REL-1: đọc beacon ProposalResult qua REFERENCE INPUT mang Proposal NFT ──
// Tìm reference input tại proposal_ref; ép (a) UTxO Ở ĐÚNG địa chỉ Governance hiện hành
// (payment_credential == Script(g), g do custody đọc từ con trỏ) — chống NFT proposal bị
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

/// Hash canonical của (định danh custody, danh sách draw). Khóa đích chi
/// (bucket,asset,amount,to) VÀ ĐÚNG MỘT custody instance.
///
/// Tiền ảnh = 0x03 ‖ blake2b(seed_policy) ‖ blake2b(instance_id) ‖ blake2b(cbor(draws)).
/// Ba thành phần đều 32 byte cố định → ghép KHÔNG nhập nhằng biên byte (mirror off-chain
/// byte-perfect, tránh bẫy P8 khi nối trường độ dài thay đổi với cbor thô).
///
/// VÌ SAO PHẢI CÓ `seed_policy`, không chỉ `instance_id` (P7, 2026-09-27):
///   `instance_id` do người gieo TỰ ĐẶT — `custody_seed` chỉ ép nó khác rỗng, không ép nó
///   duy nhất. Hai instance gieo từ hai hạt giống khác nhau vẫn trùng được `instance_id`, và
///   khi ấy một proposal Executed khớp spec_hash ở CẢ HAI. Mỗi validator chỉ đếm input của
///   script CHÍNH NÓ (C-REL-4 thấy đúng 1) và `consumed_proposals` là hai danh sách tách
///   rời ⇒ một tx tiêu cả hai kho, chi 2× điều Governance đã duyệt, mỗi kho tự thấy hợp lệ.
///   `seed_policy` thì DUY NHẤT theo hạt giống: `custody_seed` là policy one-shot tham số
///   hoá bằng `genesis_ref`, một UTxO tiêu được đúng một lần ⇒ đúng một NFT, đúng một kho.
///
/// VÌ SAO `seed_policy` mà không phải script hash của chính custody: cả hai đều duy nhất theo
///   kho, nhưng `seed_policy` là định danh GỐC — custody hash được suy RA từ nó (cộng
///   `ms_per_epoch`, `lamp_policy`, `token_name`). Governance dựng proposal chỉ cần biết
///   NFT của kho đích (thứ đã công khai trên chuỗi), không cần biết cả bộ tham số apply của
///   validator; và định danh không trôi khi một tham số khác của custody đổi. Nó cũng đã sẵn
///   trong validator (tham số apply), không phải đọc thêm gì từ tx.
///
/// Giữ `instance_id` trong tiền ảnh dù `seed_policy` đã đủ duy nhất: cặp (seed_policy,
///   instance_id) là ĐÚNG danh tính NFT của kho, nên hash nói đúng điều nó cam kết.
///
/// Governance KHI tạo proposal PHẢI tính spec_hash với ĐÚNG (seed_policy, instance_id) đích.
pub fn spend_spec_hash(
  seed_policy : ByteArray,
  instance_id : ByteArray,
  draws       : List<ReleaseDraw>,
) -> ByteArray {
  let custody_h = crypto.blake2b_256(seed_policy)
  let id_h = crypto.blake2b_256(instance_id)
  let draws_h = crypto.blake2b_256(cbor.serialise(draws))
  crypto.blake2b_256(
    #"03"
      |> bytearray.concat(custody_h)
      |> bytearray.concat(id_h)
      |> bytearray.concat(draws_h),
  )
}

// ── C-REL-6: Σ draw per-(bucket,asset) ──
// (C-REL-5 không cần tổng theo asset: nó ép bằng phép bảo toàn value bên dưới.)

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
//
// ĐO RÒNG, không đo gộp (vá `recipient-gross-sum`, CONTRACT §17). Tổng GỘP output tại `to`
// bị lách khi `to` là script có UTxO mà người ngoài tiêu-rồi-tái-tạo được trong cùng tx
// (claim permissionless, Collect…): output tái tạo mang sẵn số dư cũ ⇒ "đủ" mà người nhận
// không được thêm đồng nào, phần rút đi ví kẻ dựng tx. Nên trừ Σ MỌI input có cùng payment
// credential với `to` — theo credential, KHÔNG theo địa chỉ đầy đủ: input ở cùng script nhưng
// stake credential khác vẫn là tiền của bên nhận, tái tạo nó sang địa chỉ `to` cũng là lách.

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

/// Tổng value(asset) của mọi input có payment credential == `cred` (mọi stake credential).
pub fn input_sum_at_credential(
  inputs: List<Input>,
  cred: PaymentCredential,
  policy: ByteArray,
  name: ByteArray,
) -> Int {
  list.foldl(
    inputs,
    0,
    fn(i, acc) {
      if i.output.address.payment_credential == cred {
        acc + assets.quantity_of(i.output.value, policy, name)
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

/// Mỗi draw: lượng RÒNG tới `to` đủ Σ (tổng-khớp) ∧ `to` ≠ custody script hash
/// (tiền THẬT rời treasury, không gửi vòng lại chính custody để né).
/// Ròng = Σ output tại địa chỉ `to` − Σ input cùng payment credential với `to`.
pub fn recipients_ok(
  inputs      : List<Input>,
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
      to_not_custody && output_sum_to(outputs, d.to, d.policy, d.name) - input_sum_at_credential(
        inputs,
        d.to.payment_credential,
        d.policy,
        d.name,
      ) >= drawn_to(draws, d.to, d.policy, d.name)
    },
  )
}

// ── C-REL-SOLE: tx Release chạy đúng MỘT script Plutus ──
// Đo ròng không đóng được biến thể HAI KHO: kho A và kho B (khác script hash) cùng chi 300
// tới alice trong một tx, một output 300 tại alice thoả cả hai lượt chấm (mỗi kho chỉ thấy
// draws của chính nó). Gắn thẻ datum lên output người nhận thì đóng được nhưng đổi HÌNH DẠNG
// output (kho nhận đòi datum riêng sẽ không tiêu lại được). Thay vào đó: mọi script Plutus
// khác chạy trong tx (tiêu kho khác, đúc, rút thưởng, chứng chỉ, phiếu) đều PHẢI có một mục
// trong `tx.redeemers`; ledger luôn có mục của chính custody ⇒ |redeemers| ≤ 1 nghĩa là không
// validator nào khác cùng chấm các output của tx này. Script native (multisig ví hội đồng)
// không có redeemer nên vẫn trả phí được. Viết "≤ 1" thay "== 1" để fixture `placeholder`
// (redeemers rỗng) dùng được; trên chuỗi ledger không bao giờ cho tập rỗng ở tx tiêu script.
pub fn sole_plutus_script(redeemers: Pairs<ScriptPurpose, Redeemer>) -> Bool {
  when redeemers is {
    [_, _, ..] -> False
    _ -> True
  }
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
