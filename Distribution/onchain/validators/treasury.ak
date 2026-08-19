// DistributionTreasury validator (SPEC §QĐ7, C-TRE-1/2, C-SOLV-*).
// Giữ LAMP pool + sổ cái solvency `outstanding_entitlement` = SỐ CÒN NỢ người dùng
// = Σ(entitlement − redeemed) toàn hệ thống. 2 redeemer:
//   ReleaseForRedeem — trả nợ: pool ↓ `released` VÀ sổ cái ↓ `released` (đi cặp).
//     KHÔNG cần committee — gate bởi 1 Redeem hợp lệ (đã verify vested ở claim_account).
//   GrantEntitlement — committee cấp E qua Claim cùng tx: pool LAMP BẤT BIẾN,
//     sổ cái += granted, ép outstanding_entitlement_out ≤ pool (SOLVENCY).
//     Treasury là singleton (1-in/1-out theo script hash) → sổ cái là biến toàn cục
//     serial-hoá MỌI Claim/Redeem → bất biến Σ(E−redeemed) ≤ pool ép được PER-TX.
//
// ⚠ SỬA 2026-08-12 — NGỮ NGHĨA SỔ CÁI (review PR #22, điểm 1).
// Bản đầu đặt sổ cái là `cumulative_entitlement` = TỔNG CẤP SUỐT VÒNG ĐỜI: chỉ tăng khi
// grant, BẤT BIẾN khi redeem. Nhưng pool thì GIẢM mỗi lần redeem, mà C-SOLV-2 lại so sổ
// cái với pool HIỆN TẠI ⇒ mỗi lần redeem lại siết cửa grant thêm một nấc, không có đường
// lùi (không mệnh đề nào cho sổ cái giảm).
// Hệ quả không phải bất tiện mà là BẾ TẮC: quỹ đã cấp 5000, người dùng rút hết 5000
// (nợ = 0), nạp lại 5000 LAMP — cấp thêm 1 đồng vẫn BỊ TỪ CHỐI vì 5000+1 > 5000. Quy ra
// phân phối thật, lần cấp CUỐI đòi pool ≥ 26,37 tỷ LAMP tại đúng thời điểm đó, trong khi
// mọi redeem trước đã rút LAMP ra khỏi quỹ — cung cố định nên KHÔNG nạp bù được.
// Tính chất an toàn muốn có (Σ(E−redeemed) ≤ pool) vốn đã được bảo toàn bởi phép kiểm
// YẾU HƠN: chỉ cần sổ cái theo dõi CÒN NỢ thay vì TỔNG CẤP. Nay đổi đúng thế, và đổi luôn
// TÊN trường (`cumulative_` → `outstanding_`) vì chính cái tên sai đã dẫn tới bất biến sai.
// Đổi lại: sổ cái không còn là "tổng đã cấp lịch sử" — muốn con số đó thì cộng off-chain.

use aiken/collection/list
use aiken/crypto.{blake2b_256}
use cardano/assets
use cardano/transaction.{
  DatumHash, InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
  placeholder,
}
use magiclamp/lampdist/types.{
  ClaimAccountDatum, GrantEntitlement, Refill, ReleaseForRedeem, TreasuryDatum,
  TreasuryRedeemer,
}
use magiclamp/lampdist/util

validator treasury(
  claim_account_hash : ByteArray,
  lamp_policy        : ByteArray,
  lamp_name          : ByteArray,
  committee          : List<ByteArray>,
  threshold          : Int,
  // ⚠ THÊM 2026-08-12 (vá review PR #22, điểm 1) — ĐẶT CUỐI để giữ nguyên vị trí 5 tham
  // số cũ trong chuỗi apply-param offchain. Chỉ dùng để NỚI ĐÚNG MỘT KHE của C-MINT-0
  // ở nhánh GrantEntitlement: tx mở tài khoản buộc phải đúc NFT tài khoản, mà C-MINT-0
  // cũ (`is_zero(tx.mint)` áp cho MỌI redeemer) chặn luôn đường đó.
  account_nft_policy : ByteArray,
) {
  spend(
    datum_opt : Option<TreasuryDatum>,
    redeemer  : TreasuryRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // ⚠ CẤU TRÚC 2026-08-12 (vá review PR #22, điểm 2): `expect Some(datum) = datum_opt`,
    // C-MINT-0 và C-TRE-1 trước đây nằm NGOÀI `when redeemer` — tức áp cho mọi nhánh.
    // `Refill` phải tiêu được UTxO KHÔNG datum (LAMP rót về kho qua A-DEST hạ cánh không
    // datum) và phải GỘP được N > 1 input, nên ba mệnh đề đó chuyển vào TỪNG nhánh.
    // Hai redeemer cũ giữ nguyên hành vi từng chữ.

    when redeemer is {
      // ── RELEASE (Redeem permissionless) ───────────────────────
      ReleaseForRedeem -> {
        expect Some(datum) = datum_opt

        // C-MINT-0 — GIỮ NGUYÊN Ở NHÁNH NÀY. Đường trả nợ không có lý do gì đụng tới
        // mint; nới ở đây là mở cửa cho tx vừa rút LAMP vừa đúc NFT tài khoản mới.
        expect assets.is_zero(tx.mint)

        let (tre_in, tre_out, out_datum) = singleton_io(tx, own_hash, datum)

        // Đúng 1 ClaimAccount input + output (cùng tx redeem) — chống batch nhập nhằng.
        expect
          list.count(tx.inputs, fn(i) { util.is_at_script(i.output.address, claim_account_hash) }) == 1
        expect
          list.count(tx.outputs, fn(o) { util.is_at_script(o.address, claim_account_hash) }) == 1

        // released = ClaimAccount.redeemed(out) − redeemed(in)
        let ca_in = find_claim_account_input(tx.inputs, claim_account_hash)
        let ca_out = find_claim_account_output(tx.outputs, claim_account_hash)
        let released = ca_out.redeemed - ca_in.redeemed
        expect released > 0

        // C-SOLV-3: redeem trả nợ ⇒ sổ cái GIẢM ĐÚNG `released`, song hành với pool.
        // (Bản đầu ép sổ cái BẤT BIẾN ở đây — xem ghi chú "SỬA 2026-08-12" đầu file: đó
        // chính là nguồn của bế tắc grant. Pool giảm mà sổ cái đứng yên thì `≤ pool` siết
        // dần tới mức không cấp được nữa dù quỹ không nợ ai.)
        expect out_datum.outstanding_entitlement == datum.outstanding_entitlement - released

        // Sổ cái không bao giờ âm — chốt số học, cũng là canh cho `released` không vượt nợ.
        expect out_datum.outstanding_entitlement >= 0

        // C-TRE-1 + C-VAL-0: output == input value với LAMP giảm ĐÚNG released.
        // Bảo toàn TUYỆT ĐỐI mọi asset khác (ADA, token) — chống drain ADA (audit M1).
        expect tre_out.value == assets.add(tre_in.value, lamp_policy, lamp_name, -released)

        True
      }

      // ── GRANT (Claim cấp entitlement — committee) ─────────────
      GrantEntitlement -> {
        expect Some(datum) = datum_opt

        // C-MINT-1 (2026-08-12, vá review PR #22 điểm 1) — NỚI ĐÚNG MỘT KHE của C-MINT-0.
        // Mở tài khoản = đúc NFT tài khoản, mà `is_zero(tx.mint)` cũ chặn đứng đường đó
        // ⇒ hoặc bỏ cổng NFT, hoặc nới ở đây. Nới CHẶT: tập policy xuất hiện trong
        // `tx.mint` phải ⊆ {account_nft_policy}. Không policy nào khác — kể cả LAMP —
        // được nhúng ké vào tx cấp entitlement. Chính `claim_account_nft` mới là chỗ ép
        // shape của lần đúc đó (đúng 1 tên, qty +1, hạ cánh ở script, tên = hash owner).
        expect list.all(assets.policies(tx.mint), fn(p) { p == account_nft_policy })

        let (tre_in, tre_out, out_datum) = singleton_io(tx, own_hash, datum)
        let pool_in = assets.quantity_of(tre_in.value, lamp_policy, lamp_name)

        // C-CLAIM-1 (mirror): treasury cũng ép ngưỡng committee → CREATE path
        // (không có claim_account input → claim_account validator KHÔNG chạy) vẫn
        // được treasury gác chữ ký + solvency.
        expect util.committee_approved(committee, threshold, tx.extra_signatories)

        // Đúng 1 ClaimAccount OUTPUT (account được cấp). INPUT ∈ {0 (CREATE), 1 (UPDATE)}.
        let ca_in_count =
          list.count(tx.inputs, fn(i) { util.is_at_script(i.output.address, claim_account_hash) })
        let ca_out_count =
          list.count(tx.outputs, fn(o) { util.is_at_script(o.address, claim_account_hash) })
        expect ca_out_count == 1
        expect ca_in_count <= 1

        // granted = entitlement(out) − entitlement(in_or_0).
        let ca_out = find_claim_account_output(tx.outputs, claim_account_hash)
        let ent_in =
          if ca_in_count == 1 {
            let ca_in = find_claim_account_input(tx.inputs, claim_account_hash)
            // CREATE-vs-UPDATE rạch ròi: nếu có input thì redeemed bảo toàn (claim_account
            // validator đã ép); ở đây chỉ cần entitlement cũ để tính granted.
            ca_in.entitlement
          } else {
            // CREATE: account mới, entitlement cũ = 0, redeemed PHẢI = 0 (no double-count
            // redeemed làm lệch cumulative; claim_account validator KHÔNG chạy nên ép tại đây).
            expect ca_out.redeemed == 0

            // C-ACC-1 (2026-08-12, khép nốt vá điểm 1): đường CREATE BẮT BUỘC đúc NFT tài
            // khoản cho ĐÚNG ví này. Không có dòng này thì cổng NFT chỉ là "được phép",
            // chưa phải "bắt buộc": committee tạo được output ở `claim_account_hash` KHÔNG
            // kèm NFT ⇒ khoản nợ VÀO SỔ nhưng tài khoản VĨNH VIỄN không tiêu được (spend
            // đòi NFT) ⇒ `outstanding_entitlement` phình mãi mãi, và vì nó chỉ giảm qua
            // `ReleaseForRedeem` — vốn cần một tài khoản tiêu được — nên phần phình đó
            // KHÔNG CÓ ĐƯỜNG LÙI, siết dần trần cấp phát về sau qua C-SOLV-2.
            // Không phải bề mặt bên-thứ-ba (đòi đủ chữ ký committee), nhưng là cái bẫy
            // một-chiều nên chặn ngay lúc ghi thay vì tin vào kỷ luật vận hành.
            expect
              assets.quantity_of(
                tx.mint,
                account_nft_policy,
                blake2b_256(ca_out.owner),
              ) == 1
            0
          }
        let granted = ca_out.entitlement - ent_in
        expect granted > 0

        // C-SOLV-1: outstanding_entitlement += granted (sổ cái dồn đúng amount cấp).
        expect out_datum.outstanding_entitlement == datum.outstanding_entitlement + granted

        // C-SOLV-2 (BẤT BIẾN SOLVENCY): outstanding_entitlement_out ≤ pool LAMP.
        // Quỹ KHÔNG cấp E vượt số dư → redeem không bao giờ kẹt vì cạn pool.
        expect out_datum.outstanding_entitlement <= pool_in

        // C-VAL-0: pool LAMP + mọi asset BẤT BIẾN khi grant (chỉ datum đổi).
        expect tre_out.value == tre_in.value

        True
      }

      // ── REFILL (gộp UTxO ở kho + nạp thêm LAMP — committee) ───
      // Thêm 2026-08-12 (vá review PR #22, điểm 2). KỊCH BẢN HỎNG được vá: kho CHỈ-GIẢM.
      // Grant ép `tre_out.value == tre_in.value`, Release chỉ cho LAMP GIẢM, và
      // `count_inputs_at_script == 1` chặn luôn đường gộp ⇒ KHÔNG redeemer nào làm pool
      // TĂNG ⇒ tổng cấp phát suốt vòng đời ≤ số dư genesis, và mọi LAMP rót về kho sau
      // này (A-DEST hạ cánh thành UTxO RIÊNG, thường KHÔNG datum) nằm chết tại địa chỉ
      // script, không đường nào đưa vào pool đang được C-SOLV-2 đo.
      Refill -> {
        // KHÔNG dùng `datum_opt`: nhánh này PHẢI chạy được cho input KHÔNG datum.
        // (Sổ cái của riêng input đó bị bỏ qua — xem `fold_ledger` — nhưng MỌI mệnh đề
        // toàn-tx bên dưới vẫn chạy đủ.)

        // Không permissionless: singleton kho là UTxO đơn, ai cũng gộp được thì kẻ phá
        // quấy chiếm nó liên tục (churn UTxO, đua chèn tx) mà không tốn gì ngoài phí.
        expect util.committee_approved(committee, threshold, tx.extra_signatories)

        // Refill KHÔNG có lý do đụng mint (không tạo tài khoản, không đúc TRSY).
        expect assets.is_zero(tx.mint)

        // GỘP: N ≥ 1 input ở script → ĐÚNG 1 output ở script. Kho lại về singleton.
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
        let tre_out = util.output_at_script(tx.outputs, own_hash)
        expect InlineDatum(od) = tre_out.datum
        expect out_datum: TreasuryDatum = od

        let ins =
          list.filter(
            tx.inputs,
            fn(i) { util.is_at_script(i.output.address, own_hash) },
          )

        // Σ value của MỌI input ở script.
        let value_in =
          list.foldl(ins, assets.zero, fn(i, acc) { assets.merge(acc, i.output.value) })

        // Σ sổ cái + committee_hash — chỉ trên input CÓ TreasuryDatum.
        let (ledger_in, ch_opt) = fold_ledger(ins)

        // Phải có ÍT NHẤT một input mang datum, nếu không `committee_hash` của output
        // không được ràng vào bất cứ đâu (committee tự đặt giá trị mới). Không bao giờ
        // gây kẹt: carrier TRSY luôn có datum (ép từ genesis `treasury_nft.ak`), nên mọi
        // Refill thật — gộp tiền rót VÀO kho — đều có nó trong tập input.
        expect Some(ch) = ch_opt
        expect out_datum.committee_hash == ch

        // Gộp KHÔNG tạo và KHÔNG xoá nợ: sổ ra = tổng sổ vào.
        expect out_datum.outstanding_entitlement == ledger_in

        // Giá trị: mọi asset khác bảo toàn TUYỆT ĐỐI (chống rút ADA và chống đánh cắp
        // NFT "TRSY" ra ngoài), CHỈ LAMP được phép TĂNG một lượng `deposited >= 0`.
        let lamp_in = assets.quantity_of(value_in, lamp_policy, lamp_name)
        let lamp_out = assets.quantity_of(tre_out.value, lamp_policy, lamp_name)
        let deposited = lamp_out - lamp_in
        expect deposited >= 0
        expect tre_out.value == assets.add(value_in, lamp_policy, lamp_name, deposited)

        // C-SOLV-2 MỞ RỘNG SANG REFILL — mệnh đề này KHÔNG có trong đặc tả được giao,
        // em thêm vào vì tìm được đường phá; báo rõ chứ không lặng lẽ:
        //   Refill gộp Σ sổ cái của mọi input. Ai cũng đỗ được một UTxO ở địa chỉ kho
        //   (Cardano không chạy validator lúc TẠO) mang `TreasuryDatum` khai nợ khống.
        //   Không có dòng này, một tx { Refill(kho thật + UTxO-khai-khống-N), Claim(N) }
        //   thoả CẢ Refill (sổ ra = tổng vào) LẪN C-SOLV-1 phía `claim_account`
        //   (`trsy_out == trsy_in + amount`) ⇒ cấp entitlement N mà KHÔNG hề đi qua
        //   `GrantEntitlement`, tức KHÔNG qua cửa `nợ ≤ pool`. Với dòng này, nợ khống
        //   phải nằm dưới pool thật ⇒ không vượt được trần mà GrantEntitlement đã đặt.
        // Không làm kẹt vận hành hợp lệ: bất biến `nợ ≤ pool` đã đúng trước khi gộp
        // (genesis 0, Grant ép ≤, Release trừ đều hai vế), gộp chỉ cộng hai vế lại và
        // `deposited >= 0` chỉ làm vế phải to thêm.
        expect out_datum.outstanding_entitlement <= lamp_out

        // ── DOUBLE-SATISFACTION: vì sao chạy N lần vẫn kết luận như nhau ───────────
        // `Refill` chạy MỘT LẦN CHO MỖI input ở script. Hai thứ khác nhau giữa các lần
        // chạy là `own_ref` và `datum_opt`. `datum_opt` KHÔNG được đọc ở nhánh này.
        // `own_ref` chỉ dùng để lấy `own_hash` — mà mọi input ở đây có CÙNG payment
        // credential, nên `own_hash` y hệt. Toàn bộ phần còn lại là mệnh đề TOÀN TX
        // (đếm output, tổng vào/ra, chữ ký, mint) ⇒ mọi lần chạy đánh giá ĐÚNG CÙNG một
        // biểu thức ⇒ hoặc tất cả PASS hoặc tất cả FAIL. Không có "một output thoả cho
        // nhiều input" vì output chỉ có ĐÚNG MỘT và nó bị ép bằng TỔNG mọi input.
        // Trộn redeemer trong cùng tx cũng không mở được gì: nếu một input khác dùng
        // `ReleaseForRedeem`/`GrantEntitlement` thì hai redeemer ấy đòi
        // `count_inputs_at_script == 1`, mà đã có ≥ 2 input ở script ⇒ tx chết.
        // Kèm Redeem của `claim_account` cũng bất khả: Redeem đòi sổ cái GIẢM đúng
        // `amount > 0`, Refill đòi sổ ra = tổng sổ vào ⇒ mâu thuẫn.
        True
      }
    }
  }

  else(_) {
    fail
  }
}

/// Bộ khung SINGLETON dùng chung cho hai redeemer cũ (C-TRE-1 + C-TRE-2):
/// đúng 1 treasury input + 1 output theo SCRIPT HASH trên toàn tx (chống N× release /
/// split sổ cái qua nhiều treasury UTxO), datum ra decode được, `committee_hash` bảo toàn.
/// Tách thành hàm khi `Refill` buộc phần này rời khỏi thân chung — giữ NGUYÊN từng mệnh đề.
fn singleton_io(
  tx       : Transaction,
  own_hash : ByteArray,
  in_datum : TreasuryDatum,
) -> (Output, Output, TreasuryDatum) {
  expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
  expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

  let tre_in = util.input_at_script(tx.inputs, own_hash)
  let tre_out = util.output_at_script(tx.outputs, own_hash)

  expect InlineDatum(od) = tre_out.datum
  expect out_datum: TreasuryDatum = od
  expect out_datum.committee_hash == in_datum.committee_hash

  (tre_in, tre_out, out_datum)
}

/// (Σ outstanding_entitlement, committee_hash chung) trên các input ở script treasury.
/// Input KHÔNG datum bị BỎ QUA phần sổ cái (đó là hình dạng của LAMP rót về kho qua
/// A-DEST) — value của nó vẫn được cộng ở chỗ khác. Input mang datum-hash bị TỪ CHỐI:
/// datum thật nằm ngoài `Output`, không đọc được ở đây, nên fail-closed thay vì âm thầm
/// coi như nợ 0. Mọi input có datum phải khai CÙNG một `committee_hash`.
fn fold_ledger(ins: List<Input>) -> (Int, Option<ByteArray>) {
  list.foldl(
    ins,
    (0, None),
    fn(i, acc) {
      let (sum, ch) = acc
      when i.output.datum is {
        NoDatum -> acc
        DatumHash(_) -> fail @"treasury input dùng datum-hash: không xác thực được sổ cái"
        InlineDatum(d) -> {
          expect td: TreasuryDatum = d
          when ch is {
            None -> (sum + td.outstanding_entitlement, Some(td.committee_hash))
            Some(h) -> {
              expect h == td.committee_hash
              (sum + td.outstanding_entitlement, ch)
            }
          }
        }
      }
    },
  )
}

fn find_claim_account_input(inputs: List<Input>, script_hash: ByteArray) -> ClaimAccountDatum {
  expect Some(i) = list.find(inputs, fn(x) { util.is_at_script(x.output.address, script_hash) })
  expect InlineDatum(d) = i.output.datum
  expect ca: ClaimAccountDatum = d
  ca
}

fn find_claim_account_output(outputs: List<Output>, script_hash: ByteArray) -> ClaimAccountDatum {
  expect Some(o) = list.find(outputs, fn(x) { util.is_at_script(x.address, script_hash) })
  expect InlineDatum(d) = o.datum
  expect ca: ClaimAccountDatum = d
  ca
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction) — chứng minh fix C2 + M1
// ══════════════════════════════════════════════════════════════

const tt_tre_sh: ByteArray = #"77777777"

const tt_ca_sh: ByteArray = #"a1a1a1a1"

const tt_lamp_policy: ByteArray = #"1a3b"

const tt_lamp_name: ByteArray = #"744c414d50"

const tt_owner: ByteArray = #"0a0a"

const tt_committee: List<ByteArray> = [#"c1", #"c2", #"c3"]

const tt_threshold: Int = 2

const tt_acct_nft_policy: ByteArray = #"acac"

fn tt_tre_d(cum: Int) -> TreasuryDatum {
  TreasuryDatum { committee_hash: #"cccc", outstanding_entitlement: cum }
}

fn tt_ca_d(entitlement: Int, redeemed: Int) -> ClaimAccountDatum {
  ClaimAccountDatum {
    owner: tt_owner,
    entitlement: entitlement,
    redeemed: redeemed,
    start_epoch: 0,
    drops_per_epoch: 1,
  }
}

fn tt_lamp_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(lovelace), tt_lamp_policy, tt_lamp_name, lamp)
}

// ── RELEASE (ReleaseForRedeem) ────────────────────────────────
fn release_tx(
  tre_in_val  : assets.Value,
  tre_out_val : assets.Value,
  cum_in      : Int,
  cum_out     : Int,
  redeemed_in : Int,
  redeemed_out: Int,
  extra_tre   : List<Input>,
) -> Transaction {
  let tre_addr = util.script_address(tt_tre_sh)
  let ca_addr = util.script_address(tt_ca_sh)
  let tre_in = util.mk_input(util.mk_ref(0), util.mk_output(tre_addr, tre_in_val, tt_tre_d(cum_in)))
  let tre_out = util.mk_output(tre_addr, tre_out_val, tt_tre_d(cum_out))
  let ca_in =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(1000, redeemed_in)),
    )
  let ca_out = util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(1000, redeemed_out))
  Transaction {
    ..placeholder,
    inputs: list.concat([tre_in, ca_in], extra_tre),
    outputs: [tre_out, ca_out],
    mint: assets.zero,
  }
}

fn release(cum_in: Int, tx: Transaction) -> Bool {
  treasury.spend(
    tt_ca_sh, tt_lamp_policy, tt_lamp_name, tt_committee, tt_threshold,
    tt_acct_nft_policy,
    Some(tt_tre_d(cum_in)), ReleaseForRedeem, util.mk_ref(0), tx,
  )
}

test treasury_happy() {
  // released = 100; treasury LAMP 1000 → 900, ADA giữ nguyên, sổ cái nợ 500 → 400.
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 500, 400, 0, 100, []))
}

test treasury_double_release() fail {
  // C2: 2 treasury input cùng script hash, KHÁC stake cred → count == 2 → reject
  let tre_addr2 = util.script_address_staked(tt_tre_sh, #"5742")
  let extra =
    util.mk_input(util.mk_ref(9), util.mk_output(tre_addr2, tt_lamp_val(5_000_000, 1000), tt_tre_d(500)))
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 500, 400, 0, 100, [extra]))
}

test treasury_ada_drain() fail {
  // M1: LAMP delta đúng nhưng rút bớt ADA (5M→2M) → value sai → reject
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(2_000_000, 900), 500, 400, 0, 100, []))
}

test treasury_zero_release() fail {
  // released = 0 → expect released > 0 fail → reject
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 1000), 500, 500, 100, 100, []))
}

test treasury_release_ledger_frozen_fails() fail {
  // C-SOLV-3 (ngữ nghĩa MỚI): pool giảm 100 mà sổ cái nợ đứng yên (500→500) → reject.
  // Đây CHÍNH LÀ hành vi bản đầu ÉP PHẢI có, và là nguồn bế tắc grant.
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 500, 500, 0, 100, []))
}

test treasury_release_ledger_overpay_fails() fail {
  // Sổ cái giảm 200 trong khi pool chỉ giảm 100 → lệch → reject (không xoá nợ khống).
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 500, 300, 0, 100, []))
}

test treasury_release_ledger_never_negative() fail {
  // Nợ mở 50 nhưng release 100 → sổ cái ra −50 → reject (chốt số học C-SOLV-3).
  release(50, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 50, -50, 0, 100, []))
}

test treasury_grant_after_full_redeem_ok() {
  // HỒI QUY điểm 1 review: đã cấp 5000, người dùng rút HẾT (nợ 0), quỹ còn/nạp lại 5000.
  // Cấp thêm 1000 cho account MỚI phải PASS. Bản đầu TỪ CHỐI ca này (5000+1000 > 5000)
  // dù quỹ không nợ ai — chính là bế tắc.
  grant(0, grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"]))
}

// ── GRANT (GrantEntitlement — Claim cấp E) ────────────────────
// CREATE: 0 ca input, 1 ca output (entitlement = granted, redeemed=0).
// UPDATE: 1 ca input + 1 ca output (granted = ent_out − ent_in).
fn grant_tx(
  pool        : Int,
  cum_in      : Int,
  cum_out     : Int,
  ent_in_opt  : Option<Int>,   // None = CREATE (no ca input)
  ent_out     : Int,
  redeemed_out: Int,
  sigs        : List<ByteArray>,
) -> Transaction {
  let tre_addr = util.script_address(tt_tre_sh)
  let ca_addr = util.script_address(tt_ca_sh)
  let val = tt_lamp_val(5_000_000, pool)
  let tre_in = util.mk_input(util.mk_ref(0), util.mk_output(tre_addr, val, tt_tre_d(cum_in)))
  let tre_out = util.mk_output(tre_addr, val, tt_tre_d(cum_out))
  let ca_out =
    util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(ent_out, redeemed_out))
  let base_inputs =
    when ent_in_opt is {
      Some(ent_in) -> {
        let ca_in =
          util.mk_input(
            util.mk_ref(1),
            util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(ent_in, 0)),
          )
        [tre_in, ca_in]
      }
      None -> [tre_in]
    }
  Transaction {
    ..placeholder,
    inputs: base_inputs,
    outputs: [tre_out, ca_out],
    extra_signatories: sigs,
    // C-ACC-1: đường CREATE (không có ca input) BẮT BUỘC đúc NFT tài khoản cho đúng ví.
    // Đường UPDATE thì không đúc gì — C-MINT-1 chỉ NỚI chứ không ĐÒI.
    mint: when ent_in_opt is {
      None -> assets.add(assets.zero, tt_acct_nft_policy, tt_acct_nft_name(), 1)
      Some(_) -> assets.zero
    },
  }
}

fn grant(cum_in: Int, tx: Transaction) -> Bool {
  treasury.spend(
    tt_ca_sh, tt_lamp_policy, tt_lamp_name, tt_committee, tt_threshold,
    tt_acct_nft_policy,
    Some(tt_tre_d(cum_in)), GrantEntitlement, util.mk_ref(0), tx,
  )
}

test grant_create_happy() {
  // CREATE: cấp E=1000, cum 0→1000 ≤ pool 5000, pool bất biến.
  grant(0, grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"]))
}

/// C-ACC-1: CREATE mà KHÔNG đúc NFT tài khoản → chặn. Không có mệnh đề này thì cổng NFT
/// chỉ "được phép" chứ chưa "bắt buộc": nợ vào sổ mà tài khoản vĩnh viễn không tiêu được
/// (spend đòi NFT), và phần sổ phình đó KHÔNG có đường lùi vì `ReleaseForRedeem` cần một
/// tài khoản tiêu được mới giảm sổ được.
test grant_create_without_minting_account_nft_rejected() fail {
  let tx = Transaction { ..grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"]), mint: assets.zero }
  grant(0, tx)
}

/// Và đúc NFT cho VÍ KHÁC cũng không qua — tên phải là blake2b_256 của đúng owner ghi
/// trong datum tài khoản được cấp.
test grant_create_minting_nft_for_other_owner_rejected() fail {
  let tx =
    Transaction {
      ..grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"]),
      mint: assets.add(assets.zero, tt_acct_nft_policy, blake2b_256(#"beef"), 1),
    }
  grant(0, tx)
}

test grant_update_happy() {
  // UPDATE: E 1000→1600 (granted 600), cum 1000→1600 ≤ pool 5000.
  grant(1000, grant_tx(5000, 1000, 1600, Some(1000), 1600, 0, [#"c1", #"c2"]))
}

test grant_over_fund_rejected() fail {
  // C-SOLV-2: cấp E=6000 > pool 5000 → cum 0→6000 > pool → reject (over-grant vượt quỹ).
  grant(0, grant_tx(5000, 0, 6000, None, 6000, 0, [#"c1", #"c2"]))
}

test grant_over_fund_accumulated_rejected() fail {
  // C-SOLV-2: cum cũ 4500 + granted 1000 = 5500 > pool 5000 → reject (vượt quỹ tích lũy).
  grant(4500, grant_tx(5000, 4500, 5500, Some(4500), 5500, 0, [#"c1", #"c2"]))
}

test grant_at_fund_boundary_ok() {
  // biên: cum_out == pool 5000 → solvent (over-collateral biên), pass.
  grant(4000, grant_tx(5000, 4000, 5000, Some(4000), 5000, 0, [#"c1", #"c2"]))
}

test grant_cum_mismatch_rejected() fail {
  // C-SOLV-1: granted (ent 0→1000=1000) ≠ cum delta (0→900=900) → reject.
  grant(0, grant_tx(5000, 0, 900, None, 1000, 0, [#"c1", #"c2"]))
}

test grant_pool_drained_rejected() fail {
  // C-VAL-0: grant KHÔNG được rút LAMP pool. out pool 4000 ≠ in 5000 → reject.
  let tre_addr = util.script_address(tt_tre_sh)
  let ca_addr = util.script_address(tt_ca_sh)
  let tre_in = util.mk_input(util.mk_ref(0), util.mk_output(tre_addr, tt_lamp_val(5_000_000, 5000), tt_tre_d(0)))
  let tre_out = util.mk_output(tre_addr, tt_lamp_val(5_000_000, 4000), tt_tre_d(1000))
  let ca_out = util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(1000, 0))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tre_in],
      outputs: [tre_out, ca_out],
      extra_signatories: [#"c1", #"c2"],
      mint: assets.zero,
    }
  grant(0, tx)
}

test grant_insufficient_committee_rejected() fail {
  // C-CLAIM-1: chỉ 1 sig < threshold 2 → reject (treasury gác CREATE path).
  grant(0, grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1"]))
}

test grant_create_nonzero_redeemed_rejected() fail {
  // CREATE: redeemed ≠ 0 trên account mới → double-count sai cumulative → reject.
  grant(0, grant_tx(5000, 0, 1000, None, 1000, 50, [#"c1", #"c2"]))
}

// ══════════════════════════════════════════════════════════════
// VÁ 2026-08-12 — điểm 1: C-MINT-1 (khe mint cho NFT tài khoản)
// ══════════════════════════════════════════════════════════════

const tt_trsy_policy: ByteArray = #"7235"

fn tt_acct_nft_name() -> ByteArray {
  blake2b_256(tt_owner)
}

/// grant_tx nhưng gắn thêm một `tx.mint` tuỳ ý (đường CREATE thật luôn có mint NFT).
fn grant_tx_minting(mint: assets.Value) -> Transaction {
  let base = grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"])
  Transaction { ..base, mint: mint }
}

test grant_with_account_nft_mint_ok() {
  // (đối chứng dương của C-MINT-1) Đường TẠO tài khoản: tx đúc NFT tài khoản dưới ĐÚNG
  // `account_nft_policy`. C-MINT-0 cũ (`is_zero`) đã chặn thẳng ca này ⇒ cổng NFT tài
  // khoản sẽ không deploy được nếu không nới đúng khe này.
  grant(
    0,
    grant_tx_minting(assets.add(assets.zero, tt_acct_nft_policy, tt_acct_nft_name(), 1)),
  )
}

test grant_with_foreign_mint_rejected() fail {
  // (h) mint policy LẠ trong tx cấp entitlement → reject. Khe nới là DUY NHẤT cho
  // `account_nft_policy`, không phải "cho phép mint nói chung".
  grant(0, grant_tx_minting(assets.add(assets.zero, #"dead", #"beef", 1)))
}

test grant_with_lamp_mint_rejected() fail {
  // Cùng lớp với (h) nhưng đáng gọi tên riêng: LAMP cũng KHÔNG được đúc kèm — nếu lọt,
  // pool tự phình và C-SOLV-2 đo trên một con số bịa.
  grant(0, grant_tx_minting(assets.add(assets.zero, tt_lamp_policy, tt_lamp_name, 1_000_000)))
}

test grant_with_mixed_mint_rejected() fail {
  // NFT tài khoản hợp lệ + kèm một policy lạ → vẫn reject (tập policy ⊄ {account_nft}).
  let m =
    assets.zero
      |> assets.add(tt_acct_nft_policy, tt_acct_nft_name(), 1)
      |> assets.add(#"dead", #"beef", 1)
  grant(0, grant_tx_minting(m))
}

test release_with_mint_rejected() fail {
  // (i) ReleaseForRedeem GIỮ NGUYÊN C-MINT-0: tx trả nợ mà có mint → reject. Nhờ đó,
  // tx mở tài khoản (bắt buộc có mint) KHÔNG thể mượn nhánh này để thoả điều kiện
  // "có input TRSY" của `claim_account_nft` mà né đường ghi sổ.
  let base =
    release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 500, 400, 0, 100, [])
  let tx =
    Transaction {
      ..base,
      mint: assets.add(assets.zero, tt_acct_nft_policy, tt_acct_nft_name(), 1),
    }
  release(500, tx)
}

// ══════════════════════════════════════════════════════════════
// VÁ 2026-08-12 — điểm 2: REFILL (gộp + nạp thêm LAMP)
// ══════════════════════════════════════════════════════════════

/// Value của một UTxO kho: ADA + LAMP (+ NFT "TRSY" nếu là carrier canonical).
fn tt_val(lovelace: Int, lamp: Int, trsy: Bool) -> assets.Value {
  let v = tt_lamp_val(lovelace, lamp)
  if trsy {
    assets.add(v, tt_trsy_policy, util.treasury_nft_name(), 1)
  } else {
    v
  }
}

fn tre_in_d(ix: Int, lovelace: Int, lamp: Int, cum: Int, trsy: Bool) -> Input {
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output(util.script_address(tt_tre_sh), tt_val(lovelace, lamp, trsy), tt_tre_d(cum)),
  )
}

/// UTxO ở địa chỉ kho nhưng KHÔNG datum — đúng hình dạng LAMP rót về qua A-DEST.
fn tre_in_bare(ix: Int, lovelace: Int, lamp: Int) -> Input {
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output_no_datum(util.script_address(tt_tre_sh), tt_val(lovelace, lamp, False)),
  )
}

fn tre_out_d(lovelace: Int, lamp: Int, cum: Int, trsy: Bool) -> Output {
  util.mk_output(util.script_address(tt_tre_sh), tt_val(lovelace, lamp, trsy), tt_tre_d(cum))
}

fn refill_tx(ins: List<Input>, outs: List<Output>, sigs: List<ByteArray>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: ins,
    outputs: outs,
    extra_signatories: sigs,
    mint: assets.zero,
  }
}

/// Chạy Refill trên input số `own_ix`. `datum_opt` truyền đúng như ledger sẽ truyền.
fn refill(own_ix: Int, datum_opt: Option<TreasuryDatum>, tx: Transaction) -> Bool {
  treasury.spend(
    tt_ca_sh, tt_lamp_policy, tt_lamp_name, tt_committee, tt_threshold,
    tt_acct_nft_policy,
    datum_opt, Refill, util.mk_ref(own_ix), tx,
  )
}

test refill_merge_two_and_deposit_ok() {
  // (j) Gộp 2 UTxO kho + nạp thêm 400 LAMP từ ví.
  //   vào: A(TRSY, 5 ADA, 1000 LAMP, nợ 300) + B(2 ADA, 500 LAMP, nợ 200)
  //   ra : 1 UTxO (TRSY, 7 ADA, 1900 LAMP, nợ 500 = 300+200)
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1900, 500, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_merge_two_second_input_same_verdict() {
  // Đối chứng double-satisfaction: CÙNG tx trên, chạy cho input THỨ HAI → cùng kết luận.
  // (Mọi mệnh đề của Refill là mệnh đề toàn-tx nên hai lần chạy không thể lệch nhau.)
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1900, 500, True)
  refill(1, Some(tt_tre_d(200)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_absorb_no_datum_utxo_ok() {
  // (k) Hút một UTxO KHÔNG datum (LAMP rót về kho qua A-DEST) vào carrier canonical.
  //   vào: A(TRSY, 5 ADA, 1000 LAMP, nợ 300) + bare(2 ADA, 700 LAMP, KHÔNG datum)
  //   ra : 1 UTxO (TRSY, 7 ADA, 1700 LAMP, nợ 300 — sổ cái của bare bị bỏ qua)
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let bare = tre_in_bare(1, 2_000_000, 700)
  let o = tre_out_d(7_000_000, 1700, 300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, bare], [o], [#"c1", #"c2"]))
}

test refill_run_on_no_datum_input_ok() {
  // Chính input KHÔNG datum là input đang chạy (`datum_opt == None`). Trước bản vá,
  // `expect Some(datum) = datum_opt` nằm NGOÀI `when` nên ca này crash ngay dòng đầu.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let bare = tre_in_bare(1, 2_000_000, 700)
  let o = tre_out_d(7_000_000, 1700, 300, True)
  refill(1, None, refill_tx([a, bare], [o], [#"c1", #"c2"]))
}

test refill_ada_skim_rejected() fail {
  // (l) Rút bớt ADA (7 → 6) trong lúc gộp → reject. Mọi asset ≠ LAMP bảo toàn tuyệt đối.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(6_000_000, 1500, 500, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_lamp_decrease_rejected() fail {
  // (m) LAMP ra 1400 < tổng vào 1500 → `deposited < 0` → reject. Refill KHÔNG phải cửa rút.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1400, 500, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_trsy_stolen_rejected() fail {
  // Cùng họ với (l): bỏ NFT "TRSY" khỏi output (đem ra ví) → value ra ≠ Σ vào → reject.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1500, 500, False)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_ledger_mismatch_rejected() fail {
  // (n) Sổ cái ra 400 ≠ tổng vào 500 → reject. Gộp không được xoá nợ (ở đây xoá 100).
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1500, 400, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_insufficient_committee_rejected() fail {
  // (o) 1 chữ ký < ngưỡng 2 → reject. Refill permissionless = mời kẻ phá quấy chiếm
  // UTxO singleton của kho liên tục.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1900, 500, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1"]))
}

test refill_two_script_outputs_rejected() fail {
  // (p) Ra 2 output ở script → reject. Gộp phải TRẢ VỀ singleton, nếu không sổ cái
  // (biến toàn cục serial-hoá mọi Claim/Redeem) bị chia đôi.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o1 = tre_out_d(5_000_000, 1000, 300, True)
  let o2 = tre_out_d(2_000_000, 900, 200, False)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o1, o2], [#"c1", #"c2"]))
}

test refill_committee_hash_mismatch_rejected() fail {
  // Hai input khai `committee_hash` khác nhau → reject. Nếu không, kẻ đỗ sẵn một UTxO ở
  // địa chỉ kho mang committee_hash của mình có thể "bỏ phiếu" đổi chủ sở hữu sổ cái.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(
        util.script_address(tt_tre_sh),
        tt_val(2_000_000, 500, False),
        TreasuryDatum { committee_hash: #"dddd", outstanding_entitlement: 200 },
      ),
    )
  let o = tre_out_d(7_000_000, 1500, 500, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_no_datum_input_at_all_rejected() fail {
  // Chỉ toàn input KHÔNG datum → `committee_hash` của output không neo vào đâu → reject.
  let b1 = tre_in_bare(0, 5_000_000, 1000)
  let b2 = tre_in_bare(1, 2_000_000, 500)
  let o = tre_out_d(7_000_000, 1500, 0, False)
  refill(0, None, refill_tx([b1, b2], [o], [#"c1", #"c2"]))
}

test refill_fake_debt_injection_rejected() fail {
  // ĐƯỜNG PHÁ em tìm được (không có trong đặc tả được giao): ai cũng đỗ được một UTxO ở
  // địa chỉ kho mang `TreasuryDatum` KHAI NỢ KHỐNG. Gộp nó vào, sổ cái phình lên đúng số
  // khống ⇒ một tx { Refill(kho + UTxO khống N), Claim(N) } cấp entitlement N mà KHÔNG
  // đi qua `GrantEntitlement`, tức né cửa `nợ ≤ pool`. Mệnh đề C-SOLV-2 mở rộng ở nhánh
  // Refill chặn: nợ ra 1_000_300 > pool ra 1500.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let fake = tre_in_d(1, 2_000_000, 500, 1_000_000, False)
  let o = tre_out_d(7_000_000, 1500, 1_000_300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, fake], [o], [#"c1", #"c2"]))
}

test refill_single_utxo_noop_ok() {
  // N = 1: gộp một mình (tự chuẩn hoá kho, nạp thêm 500 LAMP). Vẫn phải PASS — nếu không,
  // đường nạp LAMP vào carrier canonical mà không có UTxO rời sẽ chết.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let o = tre_out_d(5_000_000, 1500, 300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a], [o], [#"c1", #"c2"]))
}
