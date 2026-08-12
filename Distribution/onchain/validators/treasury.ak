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
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/lampdist/types.{
  ClaimAccountDatum, GrantEntitlement, ReleaseForRedeem, TreasuryDatum,
  TreasuryRedeemer,
}
use magiclamp/lampdist/util

validator treasury(
  claim_account_hash : ByteArray,
  lamp_policy        : ByteArray,
  lamp_name          : ByteArray,
  committee          : List<ByteArray>,
  threshold          : Int,
) {
  spend(
    datum_opt : Option<TreasuryDatum>,
    redeemer  : TreasuryRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // C-MINT-0
    expect assets.is_zero(tx.mint)

    // C-TRE-1: đúng 1 treasury input + output theo SCRIPT HASH trên toàn tx
    // (chống N× release / split sổ cái qua nhiều treasury UTxO — singleton bất biến).
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

    let tre_in = util.input_at_script(tx.inputs, own_hash)
    let tre_out = util.output_at_script(tx.outputs, own_hash)

    // C-TRE-2: committee_hash bảo toàn
    expect InlineDatum(od) = tre_out.datum
    expect out_datum: TreasuryDatum = od
    expect out_datum.committee_hash == datum.committee_hash

    let pool_in = assets.quantity_of(tre_in.value, lamp_policy, lamp_name)

    when redeemer is {
      // ── RELEASE (Redeem permissionless) ───────────────────────
      ReleaseForRedeem -> {
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
        // C-CLAIM-1 (mirror): treasury cũng ép ngưỡng committee → CREATE path
        // (không có claim_account input → claim_account validator KHÔNG chạy) vẫn
        // được treasury gác chữ ký + solvency.
        expect util.count_committee_sigs(committee, tx.extra_signatories) >= threshold

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
    }
  }

  else(_) {
    fail
  }
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
    mint: assets.zero,
  }
}

fn grant(cum_in: Int, tx: Transaction) -> Bool {
  treasury.spend(
    tt_ca_sh, tt_lamp_policy, tt_lamp_name, tt_committee, tt_threshold,
    Some(tt_tre_d(cum_in)), GrantEntitlement, util.mk_ref(0), tx,
  )
}

test grant_create_happy() {
  // CREATE: cấp E=1000, cum 0→1000 ≤ pool 5000, pool bất biến.
  grant(0, grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"]))
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
