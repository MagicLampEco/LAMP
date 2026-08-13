// ClaimAccount authenticity NFT — minting policy = CỔNG DUY NHẤT ĐỂ MỞ TÀI KHOẢN.
// Thêm 2026-08-12 (vá review PR #22, điểm 1).
//
// KỊCH BẢN HỎNG mà file này chặn — trước bản vá KHÔNG có cổng nào cho việc TẠO tài khoản:
//   Cardano KHÔNG chạy validator lúc TẠO output. Địa chỉ script `claim_account` là công
//   khai (chỉ là một hash), nên bất kỳ ai cũng trả 2 ADA vào đó kèm `ClaimAccountDatum`
//   TỰ CHẾ: `owner` = mình, `entitlement` = con số bất kỳ, `redeemed = 0`. Treasury chưa
//   từng ghi khoản đó vào `outstanding_entitlement`. Kẻ đó chờ hết vesting rồi chạy
//   `Redeem`: `claim_account` kiểm vesting (đúng, vì datum do nó tự viết), rồi
//   `treasury.ReleaseForRedeem` trả LAMP và trừ sổ cái đúng `released`. Chốt duy nhất còn
//   lại là `outstanding_entitlement >= 0`, nên TRẦN TRỘM = đúng bằng số ĐANG NỢ người dùng
//   thật ⇒ cướp trọn phần đã cam kết cho người dùng thật, quỹ vẫn "đúng sổ" theo chính nó.
//
// CÁCH VÁ — mỗi tài khoản phải mang một NFT do policy này đúc, và `claim_account.spend`
// từ chối mọi UTxO không có NFT đó. Ba mệnh đề tạo nên giá trị của cổng:
//   (1) committee M-of-N ký  ⇒ không ai tự mở tài khoản;
//   (2) tên NFT == blake2b_256(datum.owner) ⇒ NFT dính chặt vào ví chủ (binding A-1,
//       cùng khuôn với `registry_write` bên Genesis) — không tái dùng NFT cho ví khác;
//   (3) TRONG CÙNG TX phải có ĐÚNG 1 input mang NFT "TRSY" ⇒ treasury bị SPEND ⇒
//       `treasury.spend` BẮT BUỘC chạy. Mà hai redeemer còn lại của treasury đều ép
//       `assets.is_zero(tx.mint)`, nên tx có mint tài khoản CHỈ đi lọt qua
//       `GrantEntitlement` ⇒ khoản nợ LUÔN được ghi sổ + qua cửa solvency `nợ ≤ pool`.
//   Mệnh đề (3) là cả lý do tồn tại của bản vá; bỏ nó đi thì cổng chỉ còn là "committee
//   mở tài khoản", vẫn cấp được entitlement KHÔNG ghi sổ.
//
// KHÔNG ép được carrier ở ĐÚNG hash `claim_account` — vòng tham số:
//   claim_account(…, account_nft_policy) ⇒ hash claim_account cần policy này
//   claim_account_nft(…) ⇒ nếu bake claim_account_hash thì policy cần hash kia
// khép kín, không có nghiệm blake2b. Nên chỉ ép "phải là MỘT Script" (giết ca đúc thẳng
// vào ví). Ca "đúc vào script KHÁC" không bị chặn nhưng vô hại: NFT nằm ngoài
// `claim_account` thì không validator nào tiêu nó ra LAMP được — đó là tự khoá tiền của
// kẻ dựng tx, không phải bề mặt tấn công. Cùng loại đánh đổi đã ghi ở C-SOLV-5
// (`claim_account.ak`) và `treasury_nft.ak`.
//
// MINT shape: đúng 1 asset name chuyển động dưới policy, qty +1. BURN cấm (qty phải == 1).

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{blake2b_256}
use cardano/address.{Script}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, Output, Transaction, placeholder}
use magiclamp/lampdist/types.{ClaimAccountDatum, TreasuryDatum}
use magiclamp/lampdist/util

/// Redeemer minting policy. Chỉ MintAccount — không có nhánh burn: NFT tài khoản phải
/// sống suốt vòng đời tài khoản, burn được = mở lại đúng lỗ vừa vá.
pub type ClaimAccountNftRedeemer {
  MintAccount
}

validator claim_account_nft(
  committee           : List<ByteArray>,
  threshold           : Int,
  treasury_nft_policy : ByteArray,
) {
  mint(_redeemer: ClaimAccountNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── A-ACC-1: committee M-of-N ─────────────────────────────────────────
    // Mở tài khoản = cấp quyền rút LAMP của quỹ ⇒ không bao giờ permissionless.
    expect util.count_committee_sigs(committee, tx.extra_signatories) >= threshold

    // ── A-ACC-2: đúng 1 asset name dưới policy này, qty +1 ─────────────────
    // Danh sách 1 phần tử ⇒ không gộp nhiều tài khoản trong 1 tx (mỗi lần mở phải đi
    // qua đúng 1 `GrantEntitlement`, xem A-ACC-6). qty == 1 ⇒ cấm burn và cấm đúc
    // nhiều đơn vị cùng tên (2 đơn vị = 2 UTxO tài khoản cùng NFT, sổ chỉ ghi 1).
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect [Pair(nft_name, qty)] = dict.to_pairs(own_tokens)
    expect qty == 1

    // ── A-ACC-3: nơi hạ cánh phải là MỘT Script mang ClaimAccountDatum ─────
    // Đúc vào ví thường = tài khoản mà không validator nào gác datum ⇒ chủ ví tự viết
    // lại `entitlement` mỗi lần muốn, rồi mới re-home về địa chỉ claim_account.
    expect [carrier] =
      list.filter(
        tx.outputs,
        fn(o) { assets.quantity_of(o.value, policy_id, nft_name) == 1 },
      )
    expect Script(_) = carrier.address.payment_credential
    expect InlineDatum(d) = carrier.datum
    expect cad: ClaimAccountDatum = d

    // ── A-ACC-4: tên NFT == blake2b_256(owner) — một tài khoản một ví ──────
    // Không có mệnh đề này thì NFT là "vé vào cửa" đục, dùng lại được cho ví bất kỳ:
    // committee ký mở tài khoản cho A, builder đặt `owner` = B trong datum.
    expect nft_name == blake2b_256(cad.owner)

    // ── A-ACC-5: mở sổ với `redeemed == 0` ────────────────────────────────
    // `redeemed > 0` lúc mở = khai khống "đã rút sẵn": `treasury.GrantEntitlement` tính
    // granted theo `entitlement` nên sổ nợ vẫn ghi đủ, nhưng `Redeem` sau đó lấy
    // `vested − redeemed` ⇒ chênh lệch thành LAMP không ai đòi lại được. Chặn ngay ở đây.
    expect cad.redeemed == 0

    // ── A-ACC-6: CÙNG TX phải có ĐÚNG 1 input mang NFT "TRSY" ─────────────
    // Đây là bản lề của cả bản vá: treasury bị SPEND ⇒ `treasury.spend` chạy ⇒ khoản nợ
    // được ghi sổ. "ĐÚNG 1" (không phải ">= 1") để không có hai carrier TRSY nhập nhằng.
    let trsy = util.treasury_nft_name()
    expect [_trsy_in] =
      list.filter(
        tx.inputs,
        fn(i) {
          assets.quantity_of(i.output.value, treasury_nft_policy, trsy) == 1
        },
      )

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const an_policy: PolicyId = #"acac"

const an_trsy_policy: PolicyId = #"7235"

const an_committee: List<ByteArray> = [#"c1", #"c2", #"c3"]

const an_threshold: Int = 2

const an_owner: ByteArray = #"0a0a"

const an_ca_sh: ByteArray = #"a1a1a1a1"

const an_tre_sh: ByteArray = #"77777777"

fn an_mint(name: ByteArray, qty: Int) -> Value {
  assets.zero |> assets.add(an_policy, name, qty)
}

fn an_ca_datum(entitlement: Int, redeemed: Int) -> ClaimAccountDatum {
  ClaimAccountDatum {
    owner: an_owner,
    entitlement: entitlement,
    redeemed: redeemed,
    start_epoch: 0,
    drops_per_epoch: 1,
  }
}

/// Carrier hợp lệ: ở script claim_account, mang NFT tên `name`, datum sạch.
fn an_carrier(name: ByteArray, redeemed: Int) -> Output {
  let v = assets.from_lovelace(2_000_000) |> assets.add(an_policy, name, 1)
  util.mk_output(util.script_address(an_ca_sh), v, an_ca_datum(1000, redeemed))
}

/// Input treasury mang NFT "TRSY" (kho canonical).
fn an_trsy_input() -> Input {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(an_trsy_policy, util.treasury_nft_name(), 1)
  util.mk_input(
    util.mk_ref(8),
    util.mk_output(
      util.script_address(an_tre_sh),
      v,
      TreasuryDatum { committee_hash: #"cccc", outstanding_entitlement: 0 },
    ),
  )
}

fn an_run(tx: Transaction) -> Bool {
  claim_account_nft.mint(
    an_committee,
    an_threshold,
    an_trsy_policy,
    MintAccount,
    an_policy,
    tx,
  )
}

fn an_tx(
  name    : ByteArray,
  qty     : Int,
  outs    : List<Output>,
  ins     : List<Input>,
  sigs    : List<ByteArray>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: ins,
    outputs: outs,
    extra_signatories: sigs,
    mint: an_mint(name, qty),
  }
}

// (b) mint tài khoản đúng luật → PASS
test acct_nft_mint_happy() {
  let name = blake2b_256(an_owner)
  an_run(
    an_tx(name, 1, [an_carrier(name, 0)], [an_trsy_input()], [#"c1", #"c2"]),
  )
}

// (c) thiếu chữ ký committee → FAIL
test acct_nft_mint_insufficient_committee_fails() fail {
  let name = blake2b_256(an_owner)
  an_run(an_tx(name, 1, [an_carrier(name, 0)], [an_trsy_input()], [#"c1"]))
}

// (d) asset name ≠ blake2b_256(owner) → FAIL
test acct_nft_mint_wrong_name_fails() fail {
  // Tên tuỳ chọn 32 byte, KHÔNG phải hash của owner ⇒ NFT không dính vào ví nào.
  let bogus =
    #"1111111111111111111111111111111111111111111111111111111111111111"
  an_run(an_tx(bogus, 1, [an_carrier(bogus, 0)], [an_trsy_input()], [#"c1", #"c2"]))
}

// (e) tx KHÔNG có input TRSY → FAIL (mệnh đề bản lề)
test acct_nft_mint_without_trsy_input_fails() fail {
  let name = blake2b_256(an_owner)
  // input là UTxO ví thường, không NFT TRSY ⇒ treasury không bị spend ⇒ nợ không vào sổ.
  let plain =
    util.mk_input(
      util.mk_ref(3),
      util.mk_output_no_datum(util.vk_address(#"badbad"), assets.from_lovelace(2_000_000)),
    )
  an_run(an_tx(name, 1, [an_carrier(name, 0)], [plain], [#"c1", #"c2"]))
}

// (f) redeemed != 0 → FAIL
test acct_nft_mint_prefilled_redeemed_fails() fail {
  let name = blake2b_256(an_owner)
  an_run(
    an_tx(name, 1, [an_carrier(name, 500)], [an_trsy_input()], [#"c1", #"c2"]),
  )
}

// (g) mint vào VÍ thay vì script → FAIL
test acct_nft_mint_to_wallet_fails() fail {
  let name = blake2b_256(an_owner)
  let v = assets.from_lovelace(2_000_000) |> assets.add(an_policy, name, 1)
  let to_wallet = util.mk_output(util.vk_address(an_owner), v, an_ca_datum(1000, 0))
  an_run(an_tx(name, 1, [to_wallet], [an_trsy_input()], [#"c1", #"c2"]))
}

// BURN cấm: qty −1 → FAIL (không có nhánh nào cho qty ≠ +1).
test acct_nft_burn_fails() fail {
  let name = blake2b_256(an_owner)
  let v = assets.from_lovelace(2_000_000) |> assets.add(an_policy, name, 1)
  let out = util.mk_output(util.script_address(an_ca_sh), v, an_ca_datum(1000, 0))
  an_run(an_tx(name, -1, [out], [an_trsy_input()], [#"c1", #"c2"]))
}

// Đúc 2 đơn vị cùng tên → FAIL (2 UTxO tài khoản chung 1 lần ghi sổ).
test acct_nft_mint_two_units_fails() fail {
  let name = blake2b_256(an_owner)
  an_run(an_tx(name, 2, [an_carrier(name, 0)], [an_trsy_input()], [#"c1", #"c2"]))
}

// Hai TRSY input (hai kho nhập nhằng) → FAIL.
test acct_nft_two_trsy_inputs_fails() fail {
  let name = blake2b_256(an_owner)
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(an_trsy_policy, util.treasury_nft_name(), 1)
  let second =
    util.mk_input(
      util.mk_ref(9),
      util.mk_output(
        util.script_address_staked(an_tre_sh, #"5742"),
        v,
        TreasuryDatum { committee_hash: #"cccc", outstanding_entitlement: 0 },
      ),
    )
  an_run(
    an_tx(name, 1, [an_carrier(name, 0)], [an_trsy_input(), second], [#"c1", #"c2"]),
  )
}
