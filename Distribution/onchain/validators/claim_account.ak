// ClaimAccount validator — CONTRACT v3 "Capped Drop" (tất định).
// Per-wallet account UTxO. 2 redeemer:
//   Claim  — committee M-of-N cấp/tăng E; tài khoản được REBASE (E' = E − redeemed + amount,
//            redeemed' = 0, start' = cửa sổ này, index_at_start' = A(cửa sổ này)).
//   Redeem — permissionless. Người dựng tx XIN một `amount`, validator KẸP nó bằng hai tầng:
//              (1) TRẦN TÍCH LUỸ, dạng bình phương (không khai căn):
//                  (redeemed + amount)² ≤ dpe² · E · A_span²   ∧   redeemed + amount ≤ E
//              (2) CẮT NGỌN một lượt: amount ≤ max(trim_floor, total_redeemed · κ)
//            `A_span = A(bây giờ) − index_at_start`, `A` là chỉ số CỘNG DỒN của beacon.
//
// ĐỔI VAI so với v2, và đây là chỗ dễ hiện thực sai nhất: v2 để validator TỰ TÍNH `amount`
// rồi ép bằng, nên mọi trần phải nhét vào công thức tính. v3 chỉ chồng thêm bất đẳng thức.
// Vượt trần cắt ngọn phải CẮT, KHÔNG được TỪ CHỐI — "xin 3 triệu, nhận 1 triệu, phần thừa
// còn nguyên quyền và chờ lượt sau". Viết thành `expect amount <= trần` là đúng chữ nhưng
// sai hành vi: người dùng không có cách nào biết nên xin bao nhiêu, và mỗi lần đoán sai mất
// một khoản phí.

use aiken/collection/list
use aiken/crypto.{blake2b_256}
use aiken/interval
use cardano/address.{Address, Script}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/lampdist/constants
use magiclamp/lampdist/math
use magiclamp/lampdist/types.{
  BeaconDatum, Claim, ClaimAccountDatum, ClaimAccountRedeemer, DropParam, Redeem,
  TreasuryDatum,
}
use magiclamp/lampdist/util

validator claim_account(
  committee           : List<ByteArray>,
  threshold           : Int,
  ms_per_epoch        : Int,
  lamp_policy         : ByteArray,
  lamp_name           : ByteArray,
  beacon_nft_policy   : ByteArray,
  treasury_nft_policy : ByteArray,
  // ⚠ THÊM 2026-08-12 (vá review PR #22, điểm 1) — ĐẶT CUỐI để không xáo trộn thứ tự 7
  // tham số cũ trong chuỗi apply-param offchain. Policy của NFT tài khoản; xem
  // `validators/claim_account_nft.ak` cho toàn bộ lý do tồn tại.
  account_nft_policy  : ByteArray,
) {
  spend(
    datum_opt : Option<ClaimAccountDatum>,
    redeemer  : ClaimAccountRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // C-MINT-0: account validator không liên quan mint
    expect assets.is_zero(tx.mint)

    // C-CLAIM-5 / C-RDM-7: đúng 1 account input + 1 output theo SCRIPT HASH
    // (chống double-satisfaction qua stake credential — audit C1).
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

    let acc_in = util.input_at_script(tx.inputs, own_hash)
    let acc_out = util.output_at_script(tx.outputs, own_hash)
    expect InlineDatum(d) = acc_out.datum
    expect out_datum: ClaimAccountDatum = d

    // Account UTxO chỉ giữ min-ADA + NFT tài khoản (không LAMP) — value bảo toàn
    // tuyệt đối, chống chèn/rút asset lạ (C-VAL-0).
    expect acc_out.value == acc_in.value

    // ── C-ACC-0 (2026-08-12, vá review PR #22 điểm 1): TÀI KHOẢN PHẢI CÓ NFT ────────
    // Cardano KHÔNG chạy validator lúc TẠO output, nên trước bản vá bất kỳ ai cũng trả
    // 2 ADA vào địa chỉ script này kèm `ClaimAccountDatum` tự chế (`entitlement` = con
    // số bất kỳ, `redeemed = 0`) mà treasury chưa từng ghi khoản đó vào sổ nợ. Chờ hết
    // vesting rồi `Redeem`: mọi phép kiểm dưới đây ĐỀU ĐÚNG (datum do chính kẻ đó
    // viết), treasury trừ sổ đúng `released`, và chốt `outstanding_entitlement >= 0`
    // chỉ giới hạn mức trộm bằng ĐÚNG SỐ ĐANG NỢ NGƯỜI DÙNG THẬT. Tức là: cướp trọn
    // phần đã cam kết cho người dùng thật.
    // Nay tài khoản chỉ tiêu được khi mang NFT do `claim_account_nft` đúc — mà lối vào
    // duy nhất của NFT đó là một tx có committee ký VÀ có input TRSY, tức có
    // `treasury.GrantEntitlement` chạy, tức khoản nợ ĐÃ VÀO SỔ.
    // Tên NFT dính vào `owner` (blake2b_256) nên không mượn NFT của ví khác được.
    // `acc_out.value == acc_in.value` ở trên đã giữ NFT ở lại; mệnh đề trên `acc_out`
    // dưới đây do đó là ràng buộc THẬT theo chiều khác: `out_datum.owner` không được
    // đổi sang ví khác (belt cho các mệnh đề `out_datum.owner == datum.owner` ở hai
    // nhánh — nếu một nhánh tương lai quên, chỗ này vẫn chặn).
    expect
      assets.quantity_of(acc_in.value, account_nft_policy, blake2b_256(datum.owner)) == 1
    expect
      assets.quantity_of(acc_out.value, account_nft_policy, blake2b_256(out_datum.owner)) == 1

    when redeemer is {
      // ── CLAIM (committee cấp/tăng entitlement) ─────────────
      Claim { amount } -> {
        // ⚠ Đánh số theo `capped-drop/Tech-Spec.md §3.3`, KHÔNG theo thứ tự xuất hiện ở
        // đây. Bản trước đánh số theo dòng và lệch hẳn một bậc so với đặc tả: chốt mà đặc
        // tả gọi `C-CLAIM-5` (redeemed bất biến) thì mã gọi `C-CLAIM-4`, và mã dùng lại
        // `C-CLAIM-5` cho một chốt khác. Cùng một mã, hai nghĩa, và cả hai chỗ tra ra một
        // dòng có thật — hỏng ở chiều im lặng nhất.
        // C-CLAIM-1
        expect amount > 0
        // C-CLAIM-2
        expect util.committee_approved(committee, threshold, tx.extra_signatories)
        // C-CLAIM-4 (owner) · C-CLAIM-3 · C-CLAIM-5 · C-CLAIM-6 (2026-09-17): cấp thêm = REBASE.
        //
        //     E' = (E − redeemed) + amount      redeemed' = 0      start' = cửa sổ này
        //
        // Bản trước giữ `redeemed` và mốc cũ (rồi dời mốc theo bình quân gia quyền) — cả
        // hai đều để tuổi tài khoản mang sang lô mới, và tài khoản đủ già rút trọn phần vừa
        // cấp ngay giao dịch kế. Lý do đầy đủ + vì sao bình quân không đóng được lỗ: xem
        // `treasury.ak` C-ACC-3.
        //
        // Ép ĐỦ ba đẳng thức ở đây, không dựa vào treasury: C-SOLV-1 dưới chỉ ép có
        // co-spend kho, KHÔNG ép kho chạy nhánh `GrantEntitlement` — kho chạy `Refill` thì
        // không mệnh đề C-ACC-3 nào chạy. `treasury.ak` C-REF-ACC chặn cặp đó từ phía kho;
        // ba dòng dưới chặn nó từ phía tài khoản.
        //
        // `start' == get_epoch_strict` là cận HAI phía: không lùi (mang tuổi sang) và không
        // tiến (bẫy một chiều — tài khoản không bao giờ vest mà nợ đã vào sổ).
        expect out_datum.owner == datum.owner
        expect out_datum.entitlement == datum.entitlement - datum.redeemed + amount
        expect out_datum.redeemed == 0
        expect out_datum.start_epoch == util.get_epoch_strict(tx, ms_per_epoch)
        // C-CLAIM-7
        expect out_datum.drops_per_epoch == datum.drops_per_epoch

        // C-SOLV-1 (binding): MỌI Claim PHẢI co-spend treasury (GrantEntitlement) và
        // dồn outstanding_entitlement đúng `amount`. Ngăn committee tăng E mà KHÔNG
        // cập nhật sổ cái solvency (bypass bất biến cum ≤ pool). Treasury authenticity
        // qua NFT "TRSY" → chống treasury giả. treasury validator độc lập ép cum ≤ pool
        // + value bảo toàn (C-SOLV-2/C-VAL-0); ở đây chỉ ràng buộc amount nhất quán.
        let (tre_in_addr, tre_in_d) = find_treasury_in(tx.inputs, treasury_nft_policy)
        let (tre_out_addr, tre_out_d) = find_treasury_out(tx.outputs, treasury_nft_policy)
        // C-SOLV-5: TRSY KHÔNG đổi nhà trong tx (và cả hai đầu đều ở script — helper ép).
        expect tre_in_addr == tre_out_addr
        expect
          tre_out_d.outstanding_entitlement == tre_in_d.outstanding_entitlement + amount

        // `total_redeemed` là sổ ĐÃ PHÁT RA — cấp thêm không phát ra đồng nào.
        // Ghim ĐỨNG YÊN chứ không bỏ trống: đây là mẫu số của phép cắt ngọn, và một nhánh
        // không ghi vào nó là một cửa nạp tự do (datum output do người dựng tx đặt).
        expect tre_out_d.total_redeemed == tre_in_d.total_redeemed

        // ⚠ `index_at_start` KHÔNG được ép ở đây, và đó là một lựa chọn phải nói ra.
        // Ghim nó đòi `A(cửa sổ này)`, tức đòi một reference input beacon trong MỌI tx cấp
        // phát — mà cổng ấy đã có ở `treasury.ak` ▸ GrantEntitlement (C-CLAIM-8), nơi DUY
        // NHẤT chạy được cả đường CREATE (không có input tài khoản ⇒ validator này không
        // chạy). Cái giữ cho hai đường không tách rời: `Claim` bắt buộc co-spend kho
        // (ngay trên), và kho chỉ có ba nhánh — `Refill` bị C-REF-ACC chặn khi tx chạm tài
        // khoản, `ReleaseForRedeem` đòi `redeemed` TĂNG trong khi `Claim` ép nó về 0.
        // Còn đúng `GrantEntitlement`, và nhánh đó ghim `index_at_start`.
        True
      }

      // ── REDEEM (permissionless: XIN một `amount`, validator KẸP) ────────────
      Redeem { amount: requested } -> {
        // C-RDM-6: owner ký
        expect list.has(tx.extra_signatories, datum.owner)

        // C-RDM-BCN: đọc TRỌN BeaconDatum qua reference input mang NFT "DROP".
        let bcn = util.find_beacon(tx.reference_inputs, beacon_nft_policy)
        expect datum.drops_per_epoch > 0

        // C-RDM-EPOCH: `get_epoch` (chỉ đầu dưới) là ĐỦ ở nhánh này — cửa sổ nhỏ đi thì
        // `A_span` nhỏ đi, tức chính người dựng tx thiệt. Mọi chỗ GHI một mốc thời gian
        // thì phải là `get_epoch_strict` (xem `util.ak` "Luật 2b").
        let current_epoch = util.get_epoch(tx, ms_per_epoch)

        // C-RDM-A + C-RDM-SPAN: chỉ số cộng dồn, dạng đóng.
        let a_now = util.beacon_index_at(bcn, current_epoch)
        let a_span = a_now - datum.index_at_start
        expect a_span >= 0

        // C-SOLV-3/4 (TRSY binding redeem): treasury co-spend PHẢI là treasury canonical
        // mang đúng 1 NFT "TRSY" — chống redeem rút từ treasury giả.
        let (trsy_in_addr, trsy_in_d) = find_treasury_in(tx.inputs, treasury_nft_policy)
        let (trsy_out_addr, trsy_out_d) = find_treasury_out(tx.outputs, treasury_nft_policy)
        // C-SOLV-5: TRSY KHÔNG đổi nhà trong tx.
        expect trsy_in_addr == trsy_out_addr

        // ── C-RDM-TRIM: CẮT NGỌN THEO LƯU HÀNH ────────────────────────────────────
        //   trần = max( trim_floor , total_redeemed · trim_num / trim_den )
        //
        // `trim_floor` là HẰNG trong `constants.ak`, KHÔNG đọc từ datum nào
        // (C-RDM-TRIM-FLOOR). Nó BẮT BUỘC phải có: thiếu nó thì `total_redeemed = 0` là một
        // ĐIỂM HẤP THỤ — trần 0 ⇒ không ai rút được ⇒ `total_redeemed` mãi bằng 0 ⇒ hệ
        // không bao giờ khởi động được.
        //
        // `total_redeemed` đọc từ chính UTxO kho đang bị co-spend, nên nó KHÔNG tốn thêm
        // carrier nào. Mẫu số phải là một đại lượng CHỈ TĂNG; đổi nó sang thứ giảm được
        // (vd "lưu hành trừ tồn kho") làm trần CO LẠI theo thời gian thay vì nở ra.
        let trim_cap =
          math.max(
            constants.trim_floor,
            trsy_in_d.total_redeemed * bcn.trim_num / bcn.trim_den,
          )

        // CẮT, không TỪ CHỐI. Đây là toàn bộ ngữ nghĩa của cắt ngọn: phần thừa KHÔNG mất,
        // nó còn nguyên quyền và chờ lượt sau (`Math-Spec.md` v3 §5 — xong sau ≤ ⌈E/F⌉ lượt).
        let amount = math.min(requested, trim_cap)

        // C-RDM-2
        expect amount > 0

        let new_redeemed = datum.redeemed + amount

        // C-RDM-CAP: tổng nhận không vượt entitlement.
        expect new_redeemed <= datum.entitlement

        // ── C-RDM-VEST: TRẦN TÍCH LUỸ, DẠNG BÌNH PHƯƠNG ───────────────────────────
        //   (redeemed + amount)² ≤ dpe² · E · A_span²
        // tương đương `redeemed + amount ≤ dpe · √E · A_span` trên ℤ₊ (y ↦ y² đơn điệu
        // tăng nghiêm ngặt), nên KHÔNG có `√` nào phải tính on-chain. Biên đo được là 105
        // bit ở `dpe = 1` với pot 6 tỷ LAMP — Plutus dùng số nguyên độ chính xác tuỳ ý nên
        // không tràn; con số đó để định cỡ ExUnits. `Math-Spec.md` v3 §6.
        //
        // Tốc độ LÕM theo cỡ (`√E`, không phải `E`) là thứ làm trần kháng tách tài khoản:
        // tách một pot thành `n` phần chỉ nhanh gấp `√n` thay vì gấp `n`.
        expect
          new_redeemed * new_redeemed <= datum.drops_per_epoch * datum.drops_per_epoch * datum.entitlement * a_span * a_span

        // C-SOLV-3: redeem = TRẢ NỢ ⇒ sổ nợ GIẢM đúng `amount`, song hành với pool.
        expect
          trsy_out_d.outstanding_entitlement == trsy_in_d.outstanding_entitlement - amount

        // C-RDM-TOTAL: sổ ĐÃ PHÁT RA tăng đúng `amount`. Đi CẶP với dòng trên — hai vế cùng
        // một `amount`, hai chiều ngược nhau. Thiếu một vế là mẫu số của phép cắt ngọn trôi
        // khỏi sự thật mà không dòng nào kêu.
        expect trsy_out_d.total_redeemed == trsy_in_d.total_redeemed + amount

        // C-RDM-4 + C-RDM-4a: chỉ `redeemed` đổi; NĂM trường kia bất biến.
        // `index_at_start` PHẢI nằm trong danh sách này, không được để suy ra là bất biến vì
        // "không ai đụng tới nó" — datum output do người dựng tx đặt, nên ghi đè được nó
        // nghĩa là người rút tự đặt lại GỐC THỜI GIAN của chính mình, và bất biến trung tâm
        // (`vested` không giảm) mất một trong ba chân.
        expect out_datum.owner == datum.owner
        expect out_datum.entitlement == datum.entitlement
        expect out_datum.redeemed == new_redeemed
        expect out_datum.start_epoch == datum.start_epoch
        expect out_datum.drops_per_epoch == datum.drops_per_epoch
        expect out_datum.index_at_start == datum.index_at_start

        // C-RDM-3: owner nhận ĐÚNG (≥) amount LAMP. Bảo toàn value treasury do
        // treasury.ak ép tre_out = tre_in − (redeemed_out − redeemed_in); chống
        // double-satisfaction theo payment script hash ở cả 2 validator.
        expect util.lamp_to_owner(tx.outputs, datum.owner, lamp_policy, lamp_name) >= amount

        True
      }
    }
  }

  else(_) {
    fail
  }
}

// ⚠ ĐÃ BỎ 2026-09-22 (v3): `find_drop_value`. Nó trả đúng MỘT trường và **cố ý bỏ qua**
// `BeaconDatum.epoch`. Ở v3 `epoch` ĐI VÀO phép tính (`A_now = index + rate_root · (cửa_sổ
// − epoch)`), nên hàm đọc beacon phải trả TRỌN BỘ. Thay bằng `util.find_beacon` — dùng
// chung với `treasury.ak` ▸ GrantEntitlement, vì hai đường đọc cùng một sự thật phải đi
// qua cùng một mệnh đề xác thực.

// ─── TRSY carrier (sổ cái solvency) ────────────────────────────────────────
//
// C-SOLV-5 — VÌ SAO CHỈ ÉP "ở MỘT script" CHỨ KHÔNG ÉP "ĐÚNG script treasury":
// ràng đúng hash treasury ở ĐÂY là BẤT KHẢ THI vì vòng tham số —
//   treasury(claim_account_hash, …)  ⇒ hash treasury cần hash claim_account
//   claim_account(…, treasury_nft_policy) ⇒ hash claim_account cần policy TRSY
//   treasury_nft(genesis_ref, treasury_hash) ⇒ policy TRSY cần hash treasury
// khép kín, không bake được. Nên phòng thủ chia hai tầng, cả hai đều KHÔNG cần vòng:
//   (a) GENESIS — `treasury_nft.ak` ép NFT mint ra phải nằm ở một Script mang
//       TreasuryDatum hợp lệ với outstanding = 0. Giết ca "đúc TRSY thẳng vào ví".
//   (b) VÒNG ĐỜI — ở đây: carrier phải ngụ tại Script (không phải ví) VÀ đầu ra phải
//       về ĐÚNG địa chỉ đầu vào. TRSY không đổi nhà được nữa.
// Trước bản vá, hai hàm này lọc THUẦN THEO NFT, không một chữ nào về địa chỉ. Nếu TRSY
// từng ngụ ở ví (chỉ cần 03_genesis dựng sai một lần), Claim sẽ đọc sổ cái do CHÍNH kẻ
// dựng tx viết, treasury.ak KHÔNG chạy, và C-SOLV-2 không bao giờ được kiểm — cấp E vô
// hạn trên một quỹ rỗng. Cùng loại phụ thuộc mà `registry.ak:118-131` đã cảnh báo.

/// (địa chỉ, TreasuryDatum) của treasury INPUT mang NFT "TRSY".
/// Đúng 1 carrier theo NFT (chống treasury giả + chống 2 sổ cái nhập nhằng), và carrier
/// PHẢI ngụ tại một script — ví thường bị loại ngay (C-SOLV-5).
///
/// v3 trả TRỌN datum thay vì một trường: `total_redeemed` (mẫu số cắt ngọn) nằm ở cùng UTxO
/// và cùng lượt đọc, nên trả hai trường rời sẽ đẻ hai đường đọc cho một sự thật.
fn find_treasury_in(
  inputs: List<Input>,
  treasury_nft_policy: ByteArray,
) -> (Address, TreasuryDatum) {
  let name = util.treasury_nft_name()
  expect [i] =
    list.filter(
      inputs,
      fn(x) { assets.quantity_of(x.output.value, treasury_nft_policy, name) == 1 },
    )
  expect Script(_) = i.output.address.payment_credential
  expect InlineDatum(d) = i.output.datum
  expect td: TreasuryDatum = d
  (i.output.address, td)
}

/// (địa chỉ, TreasuryDatum) của treasury OUTPUT mang NFT "TRSY". Đúng 1.
fn find_treasury_out(
  outputs: List<Output>,
  treasury_nft_policy: ByteArray,
) -> (Address, TreasuryDatum) {
  let name = util.treasury_nft_name()
  expect [o] =
    list.filter(
      outputs,
      fn(x) { assets.quantity_of(x.value, treasury_nft_policy, name) == 1 },
    )
  expect Script(_) = o.address.payment_credential
  expect InlineDatum(d) = o.datum
  expect td: TreasuryDatum = d
  (o.address, td)
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const t_sh: ByteArray = #"a1a1a1a1"

const t_committee: List<ByteArray> = [#"c1", #"c2", #"c3"]

const t_threshold: Int = 2

const t_mspe: Int = 86_400_000

const t_lamp_policy: ByteArray = #"1a3b"

const t_lamp_name: ByteArray = #"744c414d50"

const t_beacon_policy: ByteArray = #"beac"

const t_treasury_nft_policy: ByteArray = #"7235"

const t_treasury_sh: ByteArray = #"77777777"

const t_owner: ByteArray = #"0a0a"

const t_acct_nft_policy: ByteArray = #"acac"

/// Value của một tài khoản HỢP LỆ: min-ADA + NFT tài khoản tên blake2b_256(owner).
/// Mọi fixture cũ phải đi qua đây, nếu không C-ACC-0 loại hết (đúng như thiết kế:
/// UTxO không NFT = tài khoản giả).
fn acc_value() -> assets.Value {
  assets.from_lovelace(2_000_000)
    |> assets.add(t_acct_nft_policy, blake2b_256(t_owner), 1)
}

fn ca_datum(
  entitlement: Int,
  redeemed: Int,
  start_epoch: Int,
  dpe: Int,
  index_at_start: Int,
) -> ClaimAccountDatum {
  ClaimAccountDatum {
    owner: t_owner,
    entitlement: entitlement,
    redeemed: redeemed,
    start_epoch: start_epoch,
    drops_per_epoch: dpe,
    index_at_start: index_at_start,
  }
}

fn tre_datum(outstanding: Int, total_redeemed: Int) -> TreasuryDatum {
  TreasuryDatum {
    committee_hash: #"cccc",
    outstanding_entitlement: outstanding,
    total_redeemed: total_redeemed,
  }
}

/// treasury UTxO mang NFT "TRSY" + hai sổ cái (CÒN NỢ · ĐÃ PHÁT RA).
fn treasury_io(
  outst_in  : Int,
  outst_out : Int,
  total_in  : Int,
  total_out : Int,
  pool      : Int,
) -> (Input, Output) {
  let addr = util.script_address(t_treasury_sh)
  let val =
    assets.from_lovelace(2_000_000)
      |> assets.add(t_treasury_nft_policy, util.treasury_nft_name(), 1)
      |> assets.add(t_lamp_policy, t_lamp_name, pool)
  let tre_in =
    util.mk_input(util.mk_ref(8), util.mk_output(addr, val, tre_datum(outst_in, total_in)))
  let tre_out = util.mk_output(addr, val, tre_datum(outst_out, total_out))
  (tre_in, tre_out)
}

// ══════════════════════════════════════════════════════════════
// CLAIM — committee cấp/tăng entitlement (tài khoản REBASE)
// ══════════════════════════════════════════════════════════════

/// Cửa sổ mà mọi tx `Claim` dựng sẵn chạy trong đó (C-CLAIM-6 ép `start' == cửa sổ này`).
const t_claim_window: Int = 5

fn t_claim_range() -> interval.Interval {
  interval.between(t_claim_window * t_mspe, t_claim_window * t_mspe + 1000)
}

// ── CLAIM tx: 1 account in/out + treasury co-spend (nợ += amount), committee sigs ──
fn claim_tx(
  in_d      : ClaimAccountDatum,
  out_d     : ClaimAccountDatum,
  sigs      : List<ByteArray>,
  out_value : assets.Value,
  outst_in  : Int,
  outst_out : Int,
  pool      : Int,
) -> Transaction {
  claim_tx_totals(in_d, out_d, sigs, out_value, outst_in, outst_out, pool, 0, 0)
}

fn claim_tx_totals(
  in_d      : ClaimAccountDatum,
  out_d     : ClaimAccountDatum,
  sigs      : List<ByteArray>,
  out_value : assets.Value,
  outst_in  : Int,
  outst_out : Int,
  pool      : Int,
  total_in  : Int,
  total_out : Int,
) -> Transaction {
  let acc_addr = util.script_address(t_sh)
  let in_val = acc_value()
  let acc_in = util.mk_input(util.mk_ref(0), util.mk_output(acc_addr, in_val, in_d))
  let acc_out = util.mk_output(acc_addr, out_value, out_d)
  let (tre_in, tre_out) = treasury_io(outst_in, outst_out, total_in, total_out, pool)
  Transaction {
    ..placeholder,
    inputs: [acc_in, tre_in],
    outputs: [acc_out, tre_out],
    extra_signatories: sigs,
    validity_range: t_claim_range(),
    mint: assets.zero,
  }
}

fn claim_run(in_d: ClaimAccountDatum, tx: Transaction) -> Bool {
  claim_run_amount(in_d, tx, 1000)
}

fn claim_run_amount(in_d: ClaimAccountDatum, tx: Transaction, amount: Int) -> Bool {
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy, t_acct_nft_policy, Some(in_d), Claim { amount: amount },
    util.mk_ref(0), tx,
  )
}

test claim_happy_path() {
  // cấp E: 0 → 1000; sổ nợ kho 0 → 1000 ≤ pool 5000.
  let in_d = ca_datum(0, 0, 5, 1, 0)
  let out_d = ca_datum(1000, 0, 5, 1, 0)
  claim_run(in_d, claim_tx(in_d, out_d, [#"c1", #"c2"], acc_value(), 0, 1000, 5000))
}

// ── Cấp thêm = REBASE (C-CLAIM-3/4/5/6, 2026-09-17) ───────────────────────────
// Tài khoản vào mang `redeemed = 150` và `start_epoch = 2` — CỐ Ý khác 0 và khác cửa sổ 5.
// Fixture để mặc định `redeemed = 0`, `start = cửa sổ` thì số hạng `− redeemed` và mệnh đề
// mốc bằng 0 ở cả hai cực đột biến, và không bài nào phân biệt được chúng có mặt hay không.

/// Đối chứng: E' = 400 − 150 + 1000 = 1250, redeemed' = 0, start' = 5; sổ nợ kho +1000.
test claim_topup_rebases_account_ok() {
  let in_d = ca_datum(400, 150, 2, 1, 0)
  let out_d = ca_datum(1250, 0, 5, 1, 0)
  claim_run(in_d, claim_tx(in_d, out_d, [#"c1", #"c2"], acc_value(), 250, 1250, 5000))
}

/// Công thức CŨ (E + amount, giữ redeemed) — chỉ sai đúng mệnh đề entitlement.
test claim_topup_entitlement_ignoring_redeemed_rejected() fail {
  let in_d = ca_datum(400, 150, 2, 1, 0)
  let out_d = ca_datum(1400, 0, 5, 1, 0)
  claim_run(in_d, claim_tx(in_d, out_d, [#"c1", #"c2"], acc_value(), 250, 1250, 5000))
}

/// Entitlement đúng, nhưng `redeemed` giữ nguyên — chỉ sai đúng mệnh đề `redeemed' = 0`.
test claim_topup_keeping_redeemed_rejected() fail {
  let in_d = ca_datum(400, 150, 2, 1, 0)
  let out_d = ca_datum(1250, 150, 5, 1, 0)
  claim_run(in_d, claim_tx(in_d, out_d, [#"c1", #"c2"], acc_value(), 250, 1250, 5000))
}

/// Mốc cũ giữ nguyên — đường mang tuổi tài khoản sang lô mới (lỗ Issue #72).
test claim_topup_keeping_old_start_rejected() fail {
  let in_d = ca_datum(400, 150, 2, 1, 0)
  let out_d = ca_datum(1250, 0, 2, 1, 0)
  claim_run(in_d, claim_tx(in_d, out_d, [#"c1", #"c2"], acc_value(), 250, 1250, 5000))
}

/// Mốc ở tương lai — bẫy một chiều (không bao giờ vest, nợ đã vào sổ).
test claim_topup_future_start_rejected() fail {
  let in_d = ca_datum(400, 150, 2, 1, 0)
  let out_d = ca_datum(1250, 0, 6, 1, 0)
  claim_run(in_d, claim_tx(in_d, out_d, [#"c1", #"c2"], acc_value(), 250, 1250, 5000))
}

/// Luật 2b, ĐẦU TRÊN: đầu dưới rơi cửa sổ 5 (khớp `start' = 5` nếu chỉ đọc `get_epoch`),
/// đầu trên rơi cửa sổ 6. `get_epoch_strict` từ chối; hạ về `get_epoch` thì tx này QUA.
test claim_topup_range_upper_bound_rejected() fail {
  let in_d = ca_datum(400, 150, 2, 1, 0)
  let out_d = ca_datum(1250, 0, 5, 1, 0)
  let tx =
    Transaction {
      ..claim_tx(in_d, out_d, [#"c1", #"c2"], acc_value(), 250, 1250, 5000),
      validity_range: interval.between(5 * t_mspe, 6 * t_mspe),
    }
  claim_run(in_d, tx)
}

test claim_insufficient_committee() fail {
  let in_d = ca_datum(0, 0, 5, 1, 0)
  let out_d = ca_datum(1000, 0, 5, 1, 0)
  claim_run(in_d, claim_tx(in_d, out_d, [#"c1"], acc_value(), 0, 1000, 5000))
}

test claim_value_tamper() fail {
  // output nhét token lạ → acc_out.value != acc_in.value → reject (C-VAL-0)
  let in_d = ca_datum(0, 0, 5, 1, 0)
  let out_d = ca_datum(1000, 0, 5, 1, 0)
  let tampered = assets.add(acc_value(), #"dead", #"beef", 1)
  claim_run(in_d, claim_tx(in_d, out_d, [#"c1", #"c2"], tampered, 0, 1000, 5000))
}

test claim_ledger_not_updated() fail {
  // C-SOLV-1: entitlement +1000 nhưng sổ nợ kho KHÔNG tăng (0→0) → bind reject.
  let in_d = ca_datum(0, 0, 5, 1, 0)
  let out_d = ca_datum(1000, 0, 5, 1, 0)
  claim_run(in_d, claim_tx(in_d, out_d, [#"c1", #"c2"], acc_value(), 0, 0, 5000))
}

test claim_ledger_wrong_delta() fail {
  // C-SOLV-1: sổ nợ tăng 999 ≠ amount 1000 → reject.
  let in_d = ca_datum(0, 0, 5, 1, 0)
  let out_d = ca_datum(1000, 0, 5, 1, 0)
  claim_run(in_d, claim_tx(in_d, out_d, [#"c1", #"c2"], acc_value(), 0, 999, 5000))
}

/// v3: `total_redeemed` là sổ ĐÃ PHÁT RA. Cấp thêm KHÔNG phát ra đồng nào, nên nó phải
/// đứng yên. Không có mệnh đề này thì mỗi lần cấp phát là một cơ hội bơm mẫu số của phép
/// cắt ngọn lên — trần một lượt rút nở ra, và không dòng nào kêu vì `outstanding` vẫn khớp.
/// Đầu vào phân biệt hai cực: `total_in` khác 0 (nếu để 0 thì "đứng yên" và "bằng 0" trùng
/// nhau, và một hiện thực ghim `== 0` cũng xanh).
test claim_topup_moving_total_redeemed_rejected() fail {
  let in_d = ca_datum(400, 150, 2, 1, 0)
  let out_d = ca_datum(1250, 0, 5, 1, 0)
  claim_run(
    in_d,
    claim_tx_totals(
      in_d, out_d, [#"c1", #"c2"], acc_value(), 250, 1250, 5000, 7_000, 7_001,
    ),
  )
}

/// Đối chứng PASS của bài trên: CÙNG `total_in` khác 0, giữ nguyên ⇒ qua.
test claim_topup_total_redeemed_untouched_ok() {
  let in_d = ca_datum(400, 150, 2, 1, 0)
  let out_d = ca_datum(1250, 0, 5, 1, 0)
  claim_run(
    in_d,
    claim_tx_totals(
      in_d, out_d, [#"c1", #"c2"], acc_value(), 250, 1250, 5000, 7_000, 7_000,
    ),
  )
}

// ══════════════════════════════════════════════════════════════
// REDEEM — người dựng tx XIN, validator KẸP
// ══════════════════════════════════════════════════════════════

/// Cấu hình một giao dịch `Redeem`. Gói thành record thay vì 15 tham số vị trí: mọi ca kiểm
/// dưới đây chỉ đổi 1-3 trường, và `RedeemFx { ..base, trường: v }` để lộ ĐÚNG cái đã đổi.
type RedeemFx {
  in_d       : ClaimAccountDatum,
  out_d      : ClaimAccountDatum,
  owner_lamp : Int,
  window     : Int,
  bcn_epoch  : Int,
  bcn_index  : Int,
  rate_root  : Int,
  trim_num   : Int,
  trim_den   : Int,
  outst_in   : Int,
  outst_out  : Int,
  total_in   : Int,
  total_out  : Int,
  pool       : Int,
  sigs       : List<ByteArray>,
  acc_val    : assets.Value,
  extra_outs : List<Output>,
  extra_refs : List<Input>,
  /// Địa chỉ ngụ của beacon tham chiếu. Để lộ ra vì C-BCN-GEN-6 (`util.find_beacon`) ép nó
  /// phải là một Script — và một khuôn cố định nó thì không bẻ được mệnh đề ấy.
  bcn_addr   : Address,
}

/// Sổ nợ + pool mở đủ rộng để C-SOLV-3 và LAMP trả về không bao giờ là lý do từ chối ở
/// các ca không nhắm vào chúng.
const t_ledger: Int = 100_000

/// Khung mặc định: beacon (epoch 0, index 0, rate_root 1), κ = 1/1000, kho chưa phát ra
/// đồng nào. `amount` là số THẬT SỰ chuyển — mọi sổ dựng quanh nó.
fn fx(
  in_d   : ClaimAccountDatum,
  out_d  : ClaimAccountDatum,
  amount : Int,
  window : Int,
) -> RedeemFx {
  RedeemFx {
    in_d: in_d,
    out_d: out_d,
    owner_lamp: amount,
    window: window,
    bcn_epoch: 0,
    bcn_index: 0,
    rate_root: 1,
    trim_num: 1,
    trim_den: 1000,
    outst_in: t_ledger,
    outst_out: t_ledger - amount,
    total_in: 0,
    total_out: amount,
    pool: t_ledger,
    sigs: [t_owner],
    acc_val: acc_value(),
    extra_outs: [],
    extra_refs: [],
    bcn_addr: util.script_address(#"bbbbbbbb"),
  }
}

fn redeem_tx(f: RedeemFx) -> Transaction {
  let acc_addr = util.script_address(t_sh)
  let acc_in = util.mk_input(util.mk_ref(0), util.mk_output(acc_addr, f.acc_val, f.in_d))
  let acc_out = util.mk_output(acc_addr, f.acc_val, f.out_d)
  let owner_val =
    assets.add(assets.from_lovelace(2_000_000), t_lamp_policy, t_lamp_name, f.owner_lamp)
  let owner_out = util.mk_output(util.vk_address(t_owner), owner_val, f.in_d)
  let beacon_val =
    assets.add(assets.from_lovelace(2_000_000), t_beacon_policy, util.beacon_name(DropParam), 1)
  let beacon_datum =
    BeaconDatum {
      epoch: f.bcn_epoch,
      kind: DropParam,
      index: f.bcn_index,
      rate_root: f.rate_root,
      trim_num: f.trim_num,
      trim_den: f.trim_den,
      speed_policies: [],
    }
  let beacon_ref =
    util.mk_input(
      util.mk_ref(5),
      util.mk_output(f.bcn_addr, beacon_val, beacon_datum),
    )
  let (tre_in, tre_out) =
    treasury_io(f.outst_in, f.outst_out, f.total_in, f.total_out, f.pool)
  Transaction {
    ..placeholder,
    inputs: [acc_in, tre_in],
    reference_inputs: list.concat([beacon_ref], f.extra_refs),
    outputs: list.concat([acc_out, owner_out, tre_out], f.extra_outs),
    extra_signatories: f.sigs,
    validity_range: interval.after(f.window * t_mspe),
    mint: assets.zero,
  }
}

/// `requested` là con số ĐI VÀO REDEEMER — cố ý tách khỏi `amount` của fixture, vì toàn bộ
/// ngữ nghĩa cắt ngọn nằm ở chỗ hai số đó ĐƯỢC PHÉP khác nhau.
fn redeem_run(f: RedeemFx, requested: Int) -> Bool {
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy, t_acct_nft_policy, Some(f.in_d), Redeem { amount: requested },
    util.mk_ref(0), redeem_tx(f),
  )
}

// ── Trần tích luỹ dạng bình phương (C-RDM-VEST) ──────────────────────────────
// E = 10.000, rate_root = 1, index_at_start = 0 ⇒ A_span = cửa sổ. Trần là
// `⌊A_span·√E⌋ = 100·A_span`, nên ở cửa sổ 3 nó rơi đúng 300 — một số tính nhẩm được, và
// cách xa E (10.000) nên ca biên dưới đây đo ĐÚNG phép kẹp bình phương chứ không đo cap E.

test redeem_happy() {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  redeem_run(fx(in_d, out_d, 200, 3), 200)
}

/// C-BCN-GEN-6 trên ĐƯỜNG REDEEM: beacon tham chiếu ngụ ở một VÍ. Mọi thứ khác giống
/// `redeem_happy` từng byte — cùng `rate_root`, cùng `index`, cùng κ, cùng sổ — nên lý do đỏ
/// duy nhất là nơi beacon ngụ. Trước 2026-09-26 tx này ĐƯỢC CHẤP NHẬN, và khi đó người giữ
/// ví đặt `rate_root`/`index` tuỳ ý cho chính lượt rút của mình: trần tích luỹ C-RDM-VEST
/// vẫn được kiểm, nhưng nó được kiểm bằng con số do kẻ rút cung cấp.
test redeem_beacon_at_wallet_rejected() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  let base = fx(in_d, out_d, 200, 3)
  redeem_run(RedeemFx { ..base, bcn_addr: util.vk_address(#"badbad") }, 200)
}

/// Biên CHẴN của phép kẹp: 300² = 90.000 = 1·10.000·3². Mệnh đề là `≤` nên nó PHẢI qua.
test redeem_vest_exactly_at_cap_ok() {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 300, 0, 1, 0)
  redeem_run(fx(in_d, out_d, 300, 3), 300)
}

/// Thêm MỘT đơn vị: 301² = 90.601 > 90.000 ⇒ từ chối. Cặp 300/301 là cặp duy nhất phân biệt
/// được phép kẹp bình phương với một phép kẹp lỏng hơn — và nó cố ý nằm xa cap E để chốt
/// `redeemed + amount ≤ E` không thể là lý do đỏ.
test redeem_vest_one_over_cap_rejected() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 301, 0, 1, 0)
  redeem_run(fx(in_d, out_d, 301, 3), 301)
}

test redeem_multi_claim_accumulate() {
  // Ba đợt trên cùng một tài khoản. E = 10.000, rate_root = 1, a₀ = 0.
  // Đợt 1: cửa sổ 3 → trần 300, redeemed 0 → 300.
  let d1_in = ca_datum(10_000, 0, 0, 1, 0)
  let d1_out = ca_datum(10_000, 300, 0, 1, 0)
  let r1 = redeem_run(fx(d1_in, d1_out, 300, 3), 300)
  // Đợt 2: cửa sổ 6 → trần 600, redeemed 300 → 300.
  let d2_in = ca_datum(10_000, 300, 0, 1, 0)
  let d2_out = ca_datum(10_000, 600, 0, 1, 0)
  let r2 = redeem_run(fx(d2_in, d2_out, 300, 6), 300)
  // Đợt 3: cửa sổ 100 → trần 10.000 = E, redeemed 600 → 9.400.
  let d3_in = ca_datum(10_000, 600, 0, 1, 0)
  let d3_out = ca_datum(10_000, 10_000, 0, 1, 0)
  let r3 = redeem_run(fx(d3_in, d3_out, 9_400, 100), 9_400)
  // Tổng nhận 300 + 300 + 9.400 = 10.000 = E (cap chính xác).
  r1 && r2 && r3
}

/// C-RDM-CAP một mình: cửa sổ 200 ⇒ phép kẹp bình phương cho tới 20.000, gấp đôi E. Lý do
/// đỏ duy nhất còn lại của ca dưới là `redeemed + amount ≤ E`.
test redeem_capped_at_entitlement_ok() {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 10_000, 0, 1, 0)
  redeem_run(fx(in_d, out_d, 10_000, 200), 10_000)
}

test redeem_one_over_entitlement_rejected() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 10_001, 0, 1, 0)
  redeem_run(fx(in_d, out_d, 10_001, 200), 10_001)
}

test redeem_zero_amount_rejected() fail {
  // Xin 0 ⇒ `amount = 0` ⇒ `expect amount > 0`.
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 0, 0, 1, 0)
  redeem_run(fx(in_d, out_d, 0, 3), 0)
}

test redeem_no_owner_sig() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  redeem_run(RedeemFx { ..fx(in_d, out_d, 200, 3), sigs: [] }, 200)
}

test redeem_double_satisfaction() fail {
  // 2 account output cùng script hash (khác stake cred) → count_outputs_at_script == 2.
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  let dup_addr = util.script_address_staked(t_sh, #"5742")
  let dup_out = util.mk_output(dup_addr, assets.from_lovelace(2_000_000), out_d)
  redeem_run(RedeemFx { ..fx(in_d, out_d, 200, 3), extra_outs: [dup_out] }, 200)
}

test redeem_mint_rejected() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  let base = redeem_tx(fx(in_d, out_d, 200, 3))
  let tx = Transaction { ..base, mint: assets.add(assets.zero, #"dead", #"beef", 1) }
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy, t_acct_nft_policy, Some(in_d), Redeem { amount: 200 },
    util.mk_ref(0), tx,
  )
}

// ── Chỉ số cộng dồn: `epoch` của beacon ĐI VÀO phép tính (C-RDM-A) ───────────
// Đây là bẫy hiện thực mà Tech-Spec v3 §3.3 gọi tên: hàm đọc beacon của v2 **cố ý bỏ qua**
// `epoch`. Giữ nguyên thói quen đó ở v3 làm `A_now = index` trần, và chỉ số ĐỨNG YÊN MÃI.

/// Beacon post ở cửa sổ 2 với `index = 2`; tx chạy ở cửa sổ 5 ⇒ A_now = 2 + 1·(5−2) = 5 ⇒
/// trần = 100·5 = 500. Nếu mã quên `epoch` thì A_now = 2 ⇒ trần 200 ⇒ ca này ĐỎ.
/// Khoảng cách 500 vs 200 không phải sai số làm tròn nào che được.
test redeem_uses_beacon_epoch_offset_ok() {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 500, 0, 1, 0)
  redeem_run(
    RedeemFx { ..fx(in_d, out_d, 500, 5), bcn_epoch: 2, bcn_index: 2 },
    500,
  )
}

/// Ca ĐỐI XỨNG: cùng beacon, xin 501 ⇒ vượt trần 500 ⇒ từ chối. Cặp 500/501 ghim cái trần
/// tại đúng giá trị mà `epoch` sinh ra, không phải "trần nào đó đủ lớn".
test redeem_beacon_epoch_offset_one_over_rejected() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 501, 0, 1, 0)
  redeem_run(
    RedeemFx { ..fx(in_d, out_d, 501, 5), bcn_epoch: 2, bcn_index: 2 },
    501,
  )
}

/// `rate_root` nhân vào nhịp chạy của chỉ số: w = 10 ở cửa sổ 3 ⇒ A_span = 30 ⇒ trần 3.000.
test redeem_rate_root_scales_the_span_ok() {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 3_000, 0, 1, 0)
  redeem_run(RedeemFx { ..fx(in_d, out_d, 3_000, 3), rate_root: 10 }, 3_000)
}

test redeem_rate_root_one_over_rejected() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 3_001, 0, 1, 0)
  redeem_run(RedeemFx { ..fx(in_d, out_d, 3_001, 3), rate_root: 10 }, 3_001)
}

// ── `index_at_start` (a₀): bất biến trọn đời, và là GỐC của A_span ───────────

/// C-RDM-4a. Không có mệnh đề ép nó thì người rút tự đặt lại gốc thời gian của chính mình,
/// và bất biến trung tâm (`vested` không giảm) mất một trong ba chân.
test redeem_index_at_start_mutated_rejected() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 1)
  redeem_run(fx(in_d, out_d, 200, 3), 200)
}

/// C-RDM-SPAN. Tài khoản mở ở một chỉ số CAO hơn chỉ số hiện tại (a₀ = 1000 > A_now = 3):
/// `A_span` âm ⇒ từ chối trước khi phép kẹp chạy. Cực đối xứng là `redeem_happy` (a₀ = 0).
test redeem_index_at_start_after_now_rejected() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 1000)
  let out_d = ca_datum(10_000, 200, 0, 1, 1000)
  redeem_run(fx(in_d, out_d, 200, 3), 200)
}

/// a₀ ĐÚNG BẰNG A_now ⇒ A_span = 0 ⇒ trần bằng 0 ⇒ không rút được gì. Đây là hình dạng của
/// một tài khoản VỪA được cấp: nó phải chờ ít nhất một cửa sổ. Ghi nhận hành vi, và nó cũng
/// là ca cho thấy `A_span ≥ 0` là `≥` chứ không phải `>`.
test redeem_right_after_rebase_gets_nothing_rejected() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 3)
  let out_d = ca_datum(10_000, 200, 0, 1, 3)
  redeem_run(fx(in_d, out_d, 200, 3), 200)
}

/// Đối chứng của bài trên: CÙNG tài khoản, một cửa sổ sau ⇒ A_span = 1 ⇒ trần 100 ⇒ qua.
/// Không có nó, bài trên có thể đỏ vì fixture hỏng chứ không vì `A_span = 0`.
test redeem_one_window_after_rebase_ok() {
  let in_d = ca_datum(10_000, 0, 0, 1, 3)
  let out_d = ca_datum(10_000, 100, 0, 1, 3)
  redeem_run(fx(in_d, out_d, 100, 4), 100)
}

// ── Sổ kho: hai vế đi CẶP (C-SOLV-3 ↔ C-RDM-TOTAL) ──────────────────────────

test redeem_ledger_frozen_rejected() fail {
  // Nợ đứng yên trong khi LAMP ra khỏi kho.
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  redeem_run(RedeemFx { ..fx(in_d, out_d, 200, 3), outst_out: t_ledger }, 200)
}

/// C-RDM-TOTAL, chiều THIẾU: `total_redeemed` đứng yên ⇒ mẫu số của phép cắt ngọn trôi khỏi
/// sự thật (trần một lượt rút không bao giờ nở ra) mà không dòng nào kêu.
test redeem_total_redeemed_frozen_rejected() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  redeem_run(RedeemFx { ..fx(in_d, out_d, 200, 3), total_out: 0 }, 200)
}

/// C-RDM-TOTAL, chiều THỪA: cộng dư một đơn vị ⇒ mẫu số bơm lên ⇒ trần nở nhanh hơn thật.
/// Mệnh đề là ĐẲNG THỨC, nên phải kiểm cả hai chiều — một `>=` cho lọt đúng chiều này.
test redeem_total_redeemed_over_incremented_rejected() fail {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  redeem_run(RedeemFx { ..fx(in_d, out_d, 200, 3), total_out: 201 }, 200)
}

// ── CẮT NGỌN (C-RDM-TRIM) — vượt trần thì CẮT, KHÔNG từ chối ─────────────────
// Số thật, đơn vị oildrop: trim_floor = 1.000.000.000 = 1.000 LAMP.

/// `total_redeemed = 0` ⇒ vế tỉ lệ bằng 0 ⇒ trần = SÀN. Ví 2.000 LAMP xin trọn, nhận
/// 1.000 LAMP, giao dịch THÀNH CÔNG. Đây là ca chặn ĐIỂM HẤP THỤ: bỏ `trim_floor` đi thì
/// trần bằng 0, `amount` bằng 0, `expect amount > 0` đỏ — và hệ không bao giờ khởi động.
test redeem_trim_floor_opens_the_system_at_zero_circulation_ok() {
  let in_d = ca_datum(2_000_000_000, 0, 0, 1, 0)
  let out_d = ca_datum(2_000_000_000, 1_000_000_000, 0, 1, 0)
  redeem_run(
    RedeemFx { ..fx(in_d, out_d, 1_000_000_000, 1), rate_root: 77_460 },
    2_000_000_000,
  )
}

/// Cùng ca trên với κ = 0/1 (tỉ lệ bị siết về 0 hoàn toàn): kết quả KHÔNG ĐỔI, vẫn rút được
/// đúng sàn. Tức cái sàn KHÔNG suy ra từ `trim_num`/`trim_den` trong datum.
///
/// ⚠ Phạm vi: nó canh "sàn không đến từ hai trường tỉ lệ", nó KHÔNG canh "không có trường
/// `trim_floor` trong datum" — điều đó do KIỂU `BeaconDatum` bảo đảm, không do mệnh đề nào.
test redeem_trim_floor_not_derived_from_datum_ratio_ok() {
  let in_d = ca_datum(2_000_000_000, 0, 0, 1, 0)
  let out_d = ca_datum(2_000_000_000, 1_000_000_000, 0, 1, 0)
  redeem_run(
    RedeemFx {
      ..fx(in_d, out_d, 1_000_000_000, 1),
      rate_root: 77_460,
      trim_num: 0,
      trim_den: 1,
    },
    2_000_000_000,
  )
}

/// XIN 3 TRIỆU, NHẬN 1 TRIỆU — ca trung tâm của ngữ nghĩa cắt ngọn.
/// Lưu hành 1 tỷ LAMP (`total_redeemed = 10¹⁵` oildrop), κ = 1/1000 ⇒ trần một lượt = 1
/// triệu LAMP = 10¹² oildrop. Người dựng tx XIN 3·10¹² và giao dịch THÀNH CÔNG với 10¹².
/// Phần thừa KHÔNG mất: `redeemed` chỉ cộng 10¹², quyền còn nguyên cho lượt sau.
fn trim_fx(out_redeemed: Int, granted: Int) -> RedeemFx {
  let e = 6_000_000_000_000_000
  let in_d = ca_datum(e, 0, 0, 1, 0)
  let out_d = ca_datum(e, out_redeemed, 0, 1, 0)
  RedeemFx {
    ..fx(in_d, out_d, granted, 1000),
    rate_root: 77_460,
    total_in: 1_000_000_000_000_000,
    total_out: 1_000_000_000_000_000 + granted,
    outst_in: e,
    outst_out: e - granted,
    pool: e,
  }
}

test redeem_asking_three_million_receives_one_million_ok() {
  redeem_run(trim_fx(1_000_000_000_000, 1_000_000_000_000), 3_000_000_000_000)
}

/// Ca ĐỐI XỨNG, và là ca phân biệt "CẮT" với "TỪ CHỐI": CÙNG redeemer xin 3·10¹², nhưng
/// datum ra ghi đã nhận trọn 3·10¹². Validator kẹp `amount` xuống 10¹² nên đẳng thức
/// `redeemed' = redeemed + amount` đứt ⇒ đỏ. Một hiện thực viết `expect amount <= trần`
/// làm ĐỎ CẢ HAI bài, tức nó xoá luôn ca trên — đó là cách phân biệt hai hiện thực.
test redeem_asking_three_million_claiming_three_million_rejected() fail {
  redeem_run(trim_fx(3_000_000_000_000, 3_000_000_000_000), 3_000_000_000_000)
}

/// Sát biên trần cắt ngọn: xin đúng trần + 1. Nhận trần, nên datum ghi trần + 1 là sai.
test redeem_one_over_trim_cap_is_cut_rejected() fail {
  redeem_run(
    trim_fx(1_000_000_000_001, 1_000_000_000_001),
    1_000_000_000_001,
  )
}

/// Sát biên phía trong: xin ĐÚNG trần ⇒ không bị cắt ⇒ qua.
test redeem_exactly_at_trim_cap_ok() {
  redeem_run(trim_fx(1_000_000_000_000, 1_000_000_000_000), 1_000_000_000_000)
}

// ── M-ROOT-CEIL: `w` là NGUYÊN THUỶ, và chênh MỘT đơn vị dời mốc ĐÚNG MỘT CỬA SỔ ──
//
// ⚠ Bài này PHẢI chạy tới đúng cửa sổ 1000. Ở `n` nhỏ hai giá trị `w` cho kết quả GIỐNG HỆT
// NHAU (chênh dưới 1,3·10⁻⁵ ở n = 1), nên một bài ngắn XANH Ở CẢ HAI CỰC và do đó không
// kiểm gì. Và đừng đọc bốn bài dưới thành "w = 77.459 không bao giờ chạm E" — điều đó SAI:
// `A_span` tăng tuyến tính không chặn, nên nó chạm, chỉ là chạm ở cửa sổ 1001.
//
// Phép đột biến đúng cho mục này: GIỮ NGUYÊN tên hằng, chỉ đổi GIÁ TRỊ 77460 → 77459, rồi
// đọc SỐ CỬA SỔ để chạm `E`. Đột biến xoá tên hằng làm hỏng chính phép đo.

/// Pot sáng lập 6 tỷ LAMP. `trim_num/trim_den = 1/1` và kho đã phát ra đúng 6·10¹⁵ ⇒ trần
/// cắt ngọn bằng E ⇒ nó KHÔNG phải lý do từ chối, và phép kẹp bình phương là ràng buộc ráo.
fn pot_fx(w: Int, n: Int) -> RedeemFx {
  let e = 6_000_000_000_000_000
  let in_d = ca_datum(e, 0, 0, 1, 0)
  let out_d = ca_datum(e, e, 0, 1, 0)
  RedeemFx {
    ..fx(in_d, out_d, e, n),
    rate_root: w,
    trim_num: 1,
    trim_den: 1,
    total_in: e,
    total_out: e + e,
    outst_in: e,
    outst_out: 0,
    pool: e,
  }
}

/// `w = 77.460` (= ⌈√W⌉): pot 6 tỷ chạm ĐÚNG `E` ở cửa sổ 1000 — mốc hiệu chỉnh.
test root_ceil_pot_reaches_entitlement_at_window_1000_ok() {
  redeem_run(pot_fx(77_460, 1000), 6_000_000_000_000_000)
}

/// …và KHÔNG chạm ở cửa sổ 999. Cặp 999/1000 ghim mốc ở đúng 1000, không phải "đâu đó ≤ 1000".
test root_ceil_pot_short_of_entitlement_at_window_999_rejected() fail {
  redeem_run(pot_fx(77_460, 999), 6_000_000_000_000_000)
}

/// `w = 77.459` (= ⌊√W⌋, chiều định nghĩa SAI): cửa sổ 1000 CHƯA chạm ⇒ mốc hiệu chỉnh trượt.
test root_floor_pot_short_of_entitlement_at_window_1000_rejected() fail {
  redeem_run(pot_fx(77_459, 1000), 6_000_000_000_000_000)
}

/// …và chạm ở cửa sổ 1001. Giá của chiều định nghĩa sai là ĐÚNG MỘT CỬA SỔ — không phải
/// một khoản khoá vốn vĩnh viễn. Bài này tồn tại để không ai đọc ba bài trên thành thế.
test root_floor_pot_reaches_entitlement_at_window_1001_ok() {
  redeem_run(pot_fx(77_459, 1001), 6_000_000_000_000_000)
}

// ── `speed_policies = []` ⇒ KHÔNG đòi reference input nào thêm ────────────────

/// Đo SỐ reference input, không đo kết quả rút. Một hiện thực vẫn đi tìm thread tiêu thụ
/// MAGIC khi danh sách rỗng sẽ qua được mọi ca đo kết quả, nhưng nó làm mọi giao dịch đắt
/// hơn và phụ thuộc một UTxO không cần thiết. Ở lượt đúc này con số đúng là 1 — đúng
/// beacon, không hơn.
test redeem_reference_inputs_is_beacon_only() {
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  let f = fx(in_d, out_d, 200, 3)
  let tx = redeem_tx(f)
  and {
    list.length(tx.reference_inputs) == 1,
    redeem_run(f, 200),
  }
}

// ── HỒI QUY C-ACC-0 (review PR #22, điểm 1) ───────────────────────

test redeem_fake_account_without_nft_rejected() fail {
  // (a) CA SINH RA BẢN VÁ. Trước 2026-08-12 test này PASS: kẻ tấn công tự đỗ một UTxO ở
  // địa chỉ `claim_account` với `entitlement` do chính mình viết — kho chưa từng ghi khoản
  // nợ đó — rồi rút. Nay UTxO không mang NFT tài khoản ⇒ không spend được.
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  let bare = assets.from_lovelace(2_000_000)
  redeem_run(RedeemFx { ..fx(in_d, out_d, 200, 3), acc_val: bare }, 200)
}

test redeem_account_nft_wrong_name_rejected() fail {
  // Biến thể của (a): CÓ token đúng policy nhưng tên KHÔNG phải blake2b_256(owner).
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  let wrong =
    assets.from_lovelace(2_000_000)
      |> assets.add(t_acct_nft_policy, blake2b_256(#"badbad"), 1)
  redeem_run(RedeemFx { ..fx(in_d, out_d, 200, 3), acc_val: wrong }, 200)
}

test redeem_account_nft_wrong_policy_rejected() fail {
  // Biến thể của (a): tên đúng nhưng POLICY lạ.
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  let wrong =
    assets.from_lovelace(2_000_000)
      |> assets.add(#"beef", blake2b_256(t_owner), 1)
  redeem_run(RedeemFx { ..fx(in_d, out_d, 200, 3), acc_val: wrong }, 200)
}

test claim_fake_account_without_nft_rejected() fail {
  // Đối xứng phía Claim: tài khoản giả (KHÔNG NFT ở CẢ input lẫn output) cũng không nhận
  // thêm entitlement được.
  let in_d = ca_datum(0, 0, 5, 1, 0)
  let out_d = ca_datum(1000, 0, 5, 1, 0)
  let acc_addr = util.script_address(t_sh)
  let bare = assets.from_lovelace(2_000_000)
  let acc_in = util.mk_input(util.mk_ref(0), util.mk_output(acc_addr, bare, in_d))
  let acc_out = util.mk_output(acc_addr, bare, out_d)
  let (tre_in, tre_out) = treasury_io(0, 1000, 0, 0, 5000)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [acc_in, tre_in],
      outputs: [acc_out, tre_out],
      extra_signatories: [#"c1", #"c2"],
      validity_range: t_claim_range(),
      mint: assets.zero,
    }
  claim_run(in_d, tx)
}

// ── HỒI QUY C-SOLV-4/5 (review PR #22, điểm 2) ────────────────────

test redeem_fake_treasury_no_trsy_rejected() fail {
  // C-SOLV-4: tx KHÔNG có UTxO kho mang NFT "TRSY" ⇒ `find_treasury_in` không tìm thấy
  // carrier nào ⇒ từ chối. Chống rút từ treasury giả (đối xứng Claim path).
  let in_d = ca_datum(10_000, 0, 0, 1, 0)
  let out_d = ca_datum(10_000, 200, 0, 1, 0)
  let f = fx(in_d, out_d, 200, 3)
  let base = redeem_tx(f)
  let no_trsy =
    list.filter(
      base.inputs,
      fn(i) {
        assets.quantity_of(i.output.value, t_treasury_nft_policy, util.treasury_nft_name()) != 1
      },
    )
  let outs_no_trsy =
    list.filter(
      base.outputs,
      fn(o) {
        assets.quantity_of(o.value, t_treasury_nft_policy, util.treasury_nft_name()) != 1
      },
    )
  let tx = Transaction { ..base, inputs: no_trsy, outputs: outs_no_trsy }
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy, t_acct_nft_policy, Some(in_d), Redeem { amount: 200 },
    util.mk_ref(0), tx,
  )
}

test claim_trsy_at_wallet_rejected() fail {
  // Ca sinh ra bản vá. Trước đây test này PASS: carrier TRSY là UTxO VÍ THƯỜNG, KHÔNG một
  // LAMP nào, sổ cái 0→1000 do chính kẻ dựng tx viết. Vì ví không phải script, spend nó
  // KHÔNG chạy treasury.ak ⇒ C-SOLV-2 không bao giờ được kiểm ⇒ cấp E vô hạn trên quỹ rỗng.
  let in_d = ca_datum(0, 0, 5, 1, 0)
  let out_d = ca_datum(1000, 0, 5, 1, 0)
  let acc_addr = util.script_address(t_sh)
  let acc_val = acc_value()
  let acc_in = util.mk_input(util.mk_ref(0), util.mk_output(acc_addr, acc_val, in_d))
  let acc_out = util.mk_output(acc_addr, acc_val, out_d)

  let vi = util.vk_address(#"badbad")
  let fake_val =
    assets.from_lovelace(2_000_000)
      |> assets.add(t_treasury_nft_policy, util.treasury_nft_name(), 1)
  let fake_in =
    util.mk_input(util.mk_ref(8), util.mk_output(vi, fake_val, tre_datum(0, 0)))
  let fake_out = util.mk_output(vi, fake_val, tre_datum(1000, 0))

  let tx =
    Transaction {
      ..placeholder,
      inputs: [acc_in, fake_in],
      outputs: [acc_out, fake_out],
      extra_signatories: [#"c1", #"c2"],
      validity_range: t_claim_range(),
      mint: assets.zero,
    }
  claim_run(in_d, tx)
}

test claim_trsy_moved_to_other_script_rejected() fail {
  // C-SOLV-5: TRSY vào từ script treasury nhưng ra ở script KHÁC → đổi nhà → reject.
  let in_d = ca_datum(0, 0, 5, 1, 0)
  let out_d = ca_datum(1000, 0, 5, 1, 0)
  let acc_addr = util.script_address(t_sh)
  let acc_val = acc_value()
  let acc_in = util.mk_input(util.mk_ref(0), util.mk_output(acc_addr, acc_val, in_d))
  let acc_out = util.mk_output(acc_addr, acc_val, out_d)

  let trsy_val =
    assets.from_lovelace(2_000_000)
      |> assets.add(t_treasury_nft_policy, util.treasury_nft_name(), 1)
      |> assets.add(t_lamp_policy, t_lamp_name, 5000)
  let tre_in =
    util.mk_input(
      util.mk_ref(8),
      util.mk_output(util.script_address(t_treasury_sh), trsy_val, tre_datum(0, 0)),
    )
  let tre_out =
    util.mk_output(util.script_address(#"deadbeef"), trsy_val, tre_datum(1000, 0))

  let tx =
    Transaction {
      ..placeholder,
      inputs: [acc_in, tre_in],
      outputs: [acc_out, tre_out],
      extra_signatories: [#"c1", #"c2"],
      validity_range: t_claim_range(),
      mint: assets.zero,
    }
  claim_run(in_d, tx)
}
