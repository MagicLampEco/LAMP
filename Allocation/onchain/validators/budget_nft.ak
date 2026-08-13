// Budget beacon authenticity NFT — minting policy ONE-SHOT, name = channel_id.
//
// Mỗi kênh có đúng 1 ChannelBudget beacon. NFT này chứng thực beacon đó:
// channel_budget validator + claim_account chỉ tin UTxO mang NFT name = channel_id
// → chống datum hijacking (kẻ tấn công tạo budget giả với remaining khống).
//
// FIRST-PRINCIPLES — one-shot:
//   Policy parameterized bởi (genesis_ref, channel_id). Mint chỉ hợp lệ khi tx
//   CONSUME đúng UTxO genesis. 1 UTxO spend được 1 lần → policy chạy 1 lần →
//   supply 1 NFT cố định per kênh, KHÔNG re-mint, KHÔNG burn (else fail).
//
// PHÁ VÒNG PHỤ THUỘC HASH (DAG):
//   TRƯỚC: budget_nft(genesis_ref, channel_id, CHANNEL_BUDGET_HASH) — ép NFT ra
//   channel_budget script bằng SCRIPT-HASH param chéo. channel_budget lại tham chiếu
//   budget_nft_policy, claim_account tham chiếu cả hai → đồ thị param VÒNG TRÒN,
//   không apply-param được (demo Preview fail đúng bước này).
//   NAY: BỎ channel_budget_hash. budget_nft CHỈ phụ thuộc genesis_ref (+ lamp_policy,
//   lamp_name cho VIỆC 2) → ĐÁY của DAG, không tham chiếu script nào khác.
//   Authenticity beacon KHÔNG còn dựa "NFT ra đúng channel_budget script" lúc mint;
//   thay vào đó channel_budget TỰ ÉP nó giữ NFT (input mang NFT + re-output mang NFT
//   về chính nó) → authenticity tự thân. budget_nft chỉ cần ép NFT ra ĐÚNG 1 output
//   MANG ChannelBudget datum (beacon), KHÔNG cần biết hash của script đó.
//
// VIỆC 2 — ÉP Lớp A == Lớp B lúc genesis (per-channel):
//   Lúc mint budget NFT (= lúc setup kênh), ép tx có:
//     - đúng 1 output MANG NFT vừa mint + ChannelBudgetDatum {channel_id, remaining_oildrop=R}
//     - đúng 1 treasury con output: TreasuryDatum cùng channel_id, value LAMP == R.
//   → Lớp A (remaining beacon) == Lớp B (LAMP vật lý) NGAY TỪ GENESIS. Bịt audit #2
//   (dist_authority seed treasury ≠ remaining). Đối xứng custody_seed S-SEED-0 của Treasury.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction, placeholder}
use magiclamp/allocation/types.{ChannelBudgetDatum, TreasuryDatum}
use magiclamp/allocation/util

pub type BudgetNftRedeemer {
  MintGenesis
}

validator budget_nft(
  genesis_ref : OutputReference,
  channel_id  : AssetName,
  lamp_policy : ByteArray,   // VIỆC 2: đo LAMP nạp treasury con (Lớp B).
  lamp_name   : AssetName,   // VIỆC 2: asset-name LAMP.
) {
  mint(_redeemer: BudgetNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── ONE-SHOT: phải consume đúng UTxO genesis ──────────────────────────
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── Mint chứa ĐÚNG 1 token của policy này, name = channel_id, qty +1 ──
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1
    expect assets.quantity_of(tx.mint, policy_id, channel_id) == 1

    // ── Beacon output: ĐÚNG 1 output mang NFT vừa mint + ChannelBudgetDatum ──
    // Không cần channel_budget_hash (phá vòng): nhận diện beacon = output MANG NFT
    // one-shot. NFT one-shot duy nhất → bất kỳ output nào giữ nó là beacon chính danh.
    // channel_budget.ak tự ép nó GIỮ NFT vĩnh viễn (b_out.value == b_in.value) → NFT
    // không bao giờ rời beacon. Nên "output mang NFT lúc genesis" = beacon thật.
    let nft_outs =
      list.filter(
        tx.outputs,
        fn(o) { assets.quantity_of(o.value, policy_id, channel_id) == 1 },
      )
    expect [beacon] = nft_outs
    expect InlineDatum(bd) = beacon.datum
    expect budget_datum: ChannelBudgetDatum = bd
    // beacon.channel_id PHẢI khớp NFT name (= channel_id param) — chống beacon lệch kênh.
    expect budget_datum.channel_id == channel_id
    let r = budget_datum.remaining_oildrop
    expect r > 0

    // ── GENESIS HARDENING: beacon PHẢI ở Script credential (không ví thường) ──
    // Khởi đúng invariant "NFT đóng băng trong channel_budget script" mà cross-lock SPEND
    // dựa vào. Nếu beacon đặt ở vk_address lúc genesis → NFT không bị script khoá →
    // có thể chuyển tự do → over-allocation. KHÔNG ép đúng script-hash cụ thể (sẽ tái
    // sinh vòng phụ thuộc) — chỉ ép LOẠI credential là Script(_).
    expect util.is_at_script_cred(beacon.address)

    // ── VIỆC 2: ÉP Lớp A == Lớp B — đúng 1 treasury con LAMP == R, cùng kênh ──
    // Nhận diện treasury output = output MANG TreasuryDatum cùng channel_id (đọc được).
    // KHÔNG dùng treasury_hash param (sẽ tái sinh vòng: budget_nft→treasury→claim_account
    // →budget_nft_policy). Ép quantity_of(LAMP) == remaining_oildrop của beacon.
    let treasury_outs =
      list.filter(tx.outputs, fn(o) { is_treasury_for_channel(o, channel_id) })
    expect [treasury_out] = treasury_outs
    expect assets.quantity_of(treasury_out.value, lamp_policy, lamp_name) == r

    // ── GENESIS HARDENING: treasury con PHẢI ở Script credential (không ví thường) ──
    // Lớp B (LAMP vật lý) phải bị script khoá ngay từ genesis; nếu đặt ở vk_address →
    // LAMP rút tự do bằng chữ ký, hard-cap vật lý vô hiệu. Chỉ ép Script(_), KHÔNG pin hash.
    expect util.is_at_script_cred(treasury_out.address)

    True
  }

  else(_) {
    fail
  }
}

/// output có phải treasury con của kênh channel không (TreasuryDatum.channel_id khớp).
fn is_treasury_for_channel(o: Output, channel: ByteArray) -> Bool {
  when o.datum is {
    InlineDatum(d) ->
      if d is td: TreasuryDatum {
        td.channel_id == channel
      } else {
        False
      }
    _ -> False
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const bn_policy: PolicyId = #"b00d"

const bn_channel: AssetName = #"5445414d"  // "TEAM"

const bn_other_channel: AssetName = #"5245534552564500"  // "RESERVE"

const bn_cb_hash: ByteArray = #"b1b1b1b1"  // channel_budget script hash (đích beacon)

const bn_tre_hash: ByteArray = #"77777777"  // treasury script hash

const bn_lamp_policy: ByteArray = #"1a3b"

const bn_lamp_name: AssetName = #"4c414d50"

const bn_remaining: Int = 1000

fn bn_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 7 }
}

fn bn_mint(name: AssetName, qty: Int) -> assets.Value {
  assets.zero |> assets.add(bn_policy, name, qty)
}

fn bn_genesis_input() -> transaction.Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(bn_genesis_ref(), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

fn bn_other_input() -> transaction.Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(util.mk_ref(0), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

fn bn_budget_d(channel: ByteArray, remaining: Int) -> ChannelBudgetDatum {
  ChannelBudgetDatum { channel_id: channel, remaining_oildrop: remaining }
}

fn bn_tre_d(channel: ByteArray) -> TreasuryDatum {
  TreasuryDatum { committee_hash: #"cccc", channel_id: channel }
}

/// beacon output: NFT name=channel + ChannelBudgetDatum (remaining=R), ở channel_budget script.
fn bn_beacon_out(channel: ByteArray, remaining: Int) -> Output {
  let val = assets.add(assets.from_lovelace(2_000_000), bn_policy, channel, 1)
  util.mk_output(util.script_address(bn_cb_hash), val, bn_budget_d(channel, remaining))
}

/// treasury con output: TreasuryDatum cùng kênh + lamp LAMP, ở treasury script.
fn bn_treasury_out(channel: ByteArray, lamp: Int) -> Output {
  let val = assets.add(assets.from_lovelace(2_000_000), bn_lamp_policy, bn_lamp_name, lamp)
  util.mk_output(util.script_address(bn_tre_hash), val, bn_tre_d(channel))
}

fn bn_run(tx: Transaction) -> Bool {
  budget_nft.mint(
    bn_genesis_ref(), bn_channel, bn_lamp_policy, bn_lamp_name,
    MintGenesis, bn_policy, tx,
  )
}

// happy: consume genesis + mint 1 NFT + beacon(R) + treasury(LAMP==R) cùng kênh.
test budget_nft_mint_happy() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_other_input(), bn_genesis_input()],
      outputs: [bn_beacon_out(bn_channel, bn_remaining), bn_treasury_out(bn_channel, bn_remaining)],
      mint: bn_mint(bn_channel, 1),
    }
  bn_run(tx)
}

test budget_nft_mint_without_genesis() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_other_input()],
      outputs: [bn_beacon_out(bn_channel, bn_remaining), bn_treasury_out(bn_channel, bn_remaining)],
      mint: bn_mint(bn_channel, 1),
    }
  bn_run(tx)
}

test budget_nft_mint_wrong_qty() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_beacon_out(bn_channel, bn_remaining), bn_treasury_out(bn_channel, bn_remaining)],
      mint: bn_mint(bn_channel, 2),
    }
  bn_run(tx)
}

test budget_nft_mint_wrong_name() fail {
  // mint name khác channel_id → quantity_of(channel_id)==0 → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_beacon_out(bn_channel, bn_remaining), bn_treasury_out(bn_channel, bn_remaining)],
      mint: bn_mint(#"9999", 1),
    }
  bn_run(tx)
}

// beacon datum channel_id lệch NFT name → reject.
test budget_nft_beacon_channel_mismatch() fail {
  let beacon_val = assets.add(assets.from_lovelace(2_000_000), bn_policy, bn_channel, 1)
  // datum khai kênh RESERVE nhưng NFT name=TEAM.
  let beacon = util.mk_output(util.script_address(bn_cb_hash), beacon_val, bn_budget_d(bn_other_channel, bn_remaining))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [beacon, bn_treasury_out(bn_channel, bn_remaining)],
      mint: bn_mint(bn_channel, 1),
    }
  bn_run(tx)
}

// VIỆC 2 — seed A==B khớp: treasury LAMP == remaining → pass (đã cover ở happy).
test budget_nft_seed_AB_match_ok() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_beacon_out(bn_channel, 5000), bn_treasury_out(bn_channel, 5000)],
      mint: bn_mint(bn_channel, 1),
    }
  bn_run(tx)
}

// VIỆC 2 — treasury thiếu LAMP (< remaining) → Lớp B lệch Lớp A → reject.
test budget_nft_reject_treasury_underfunded() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_beacon_out(bn_channel, 1000), bn_treasury_out(bn_channel, 999)],
      mint: bn_mint(bn_channel, 1),
    }
  bn_run(tx)
}

// VIỆC 2 — treasury thừa LAMP (> remaining) → Lớp B lệch Lớp A → reject.
test budget_nft_reject_treasury_overfunded() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_beacon_out(bn_channel, 1000), bn_treasury_out(bn_channel, 1001)],
      mint: bn_mint(bn_channel, 1),
    }
  bn_run(tx)
}

// VIỆC 2 — không có treasury output cùng kênh → reject (Lớp B vắng).
test budget_nft_reject_no_treasury() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_beacon_out(bn_channel, 1000)],
      mint: bn_mint(bn_channel, 1),
    }
  bn_run(tx)
}

// VIỆC 2 — treasury output thuộc kênh KHÁC → không khớp channel → reject.
test budget_nft_reject_treasury_wrong_channel() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_beacon_out(bn_channel, 1000), bn_treasury_out(bn_other_channel, 1000)],
      mint: bn_mint(bn_channel, 1),
    }
  bn_run(tx)
}

// remaining_oildrop <= 0 (beacon khởi tạo rỗng) → reject (kênh phải có ngân sách > 0).
test budget_nft_reject_zero_remaining() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_beacon_out(bn_channel, 0), bn_treasury_out(bn_channel, 0)],
      mint: bn_mint(bn_channel, 1),
    }
  bn_run(tx)
}

// ── GENESIS-ADVERSARIAL: chặn đặt beacon/treasury ở ví thường ──────────────

/// beacon output ở ví thường (vk_address) thay vì script — vẫn mang NFT + datum đúng.
fn bn_beacon_out_at_wallet(channel: ByteArray, remaining: Int) -> Output {
  let val = assets.add(assets.from_lovelace(2_000_000), bn_policy, channel, 1)
  util.mk_output(util.vk_address(#"deadbeef"), val, bn_budget_d(channel, remaining))
}

/// treasury con output ở ví thường (vk_address) thay vì script — vẫn cùng kênh + đủ LAMP.
fn bn_treasury_out_at_wallet(channel: ByteArray, lamp: Int) -> Output {
  let val = assets.add(assets.from_lovelace(2_000_000), bn_lamp_policy, bn_lamp_name, lamp)
  util.mk_output(util.vk_address(#"cafebabe"), val, bn_tre_d(channel))
}

// GENESIS HARDENING — beacon (mang NFT) đặt ở ví thường → invariant đóng băng KHÔNG
// khởi đúng → reject (chống over-allocation kênh).
test budget_nft_reject_beacon_at_wallet() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_beacon_out_at_wallet(bn_channel, bn_remaining), bn_treasury_out(bn_channel, bn_remaining)],
      mint: bn_mint(bn_channel, 1),
    }
  bn_run(tx)
}

// GENESIS HARDENING — treasury con (LAMP vật lý) đặt ở ví thường → Lớp B không bị
// script khoá → reject (LAMP rút tự do bằng chữ ký = phá hard-cap vật lý).
test budget_nft_reject_treasury_at_wallet() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_beacon_out(bn_channel, bn_remaining), bn_treasury_out_at_wallet(bn_channel, bn_remaining)],
      mint: bn_mint(bn_channel, 1),
    }
  bn_run(tx)
}
