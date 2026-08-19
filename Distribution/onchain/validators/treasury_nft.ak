// Treasury authenticity NFT — minting policy ONE-SHOT (CONTRACT v2, C-SOLV-*).
//
// Treasury UTxO giữ sổ cái solvency (outstanding_entitlement) + LAMP pool. claim_account
// đọc treasury qua reference/co-spend để ép outstanding_entitlement ≤ pool. Nếu treasury
// KHÔNG có authenticity NFT, kẻ tấn công tạo treasury giả (cùng datum shape, pool LAMP
// fake lớn) tại cùng address → bypass solvency. NFT "TRSY" duy nhất chứng thực treasury
// canonical → singleton TUYỆT ĐỐI toàn cục (không chỉ per-tx).
//
// FIRST-PRINCIPLES — one-shot: policy parameterized bởi 1 genesis OutputReference. Mint
//   chỉ hợp lệ khi tx CONSUME đúng UTxO genesis đó → policy chạy đúng 1 lần → supply 1
//   NFT cố định, KHÔNG re-mint. Bất biến mạnh nhất không cần state on-chain.
//
// MINT shape: (TRSY, +1) đúng 1, không hơn không kém. BURN cấm (else fail).

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/lampdist/types.{TreasuryDatum}
use magiclamp/lampdist/util

/// Redeemer minting policy. Chỉ MintGenesis (cấm burn — authenticity sống suốt vòng đời).
pub type TreasuryNftRedeemer {
  MintGenesis
}

validator treasury_nft(genesis_ref: OutputReference) {
  mint(_redeemer: TreasuryNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── ONE-SHOT: phải consume đúng UTxO genesis ───────────────────────────
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── Mint chứa ĐÚNG 1 token của policy này, qty +1 ───────────────────────
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1

    let nft_name = util.treasury_nft_name()
    expect assets.quantity_of(tx.mint, policy_id, nft_name) == 1

    // ── ĐÍCH ĐẾN: NFT phải hạ cánh ở MỘT SCRIPT, mang TreasuryDatum, sổ cái mở = 0 ──
    // Thêm 2026-08-12 (review PR #22, điểm 2). Trước đó policy chỉ ép "đúc đúng 1 lần",
    // KHÔNG một chữ nào về nơi NFT hạ cánh — nên toàn bộ tính đúng đắn của sổ cái
    // solvency treo vào việc `03_genesis.ts` đặt NFT đúng chỗ. Nếu genesis dựng sai một
    // lần (NFT vào ví), `claim_account` — vốn tìm treasury THUẦN THEO NFT — sẽ đọc sổ cái
    // do chính kẻ dựng tx viết, và `treasury.ak` không bao giờ chạy ⇒ C-SOLV-2 chết câm.
    // Không ràng ĐÚNG hash treasury được (vòng tham số, xem C-SOLV-5 ở claim_account.ak),
    // nhưng "phải là script + đúng datum + nợ mở = 0" giết trọn ca thực tế.
    expect [carrier] =
      list.filter(tx.outputs, fn(o) { assets.quantity_of(o.value, policy_id, nft_name) == 1 })
    expect Script(_) = carrier.address.payment_credential
    expect InlineDatum(d) = carrier.datum
    expect td: TreasuryDatum = d
    // Quỹ mở sổ với nợ 0 — không ai "khai sẵn" một khoản nợ để lách C-SOLV-2 về sau.
    expect td.outstanding_entitlement == 0

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const nt_policy: PolicyId = #"7235"

fn nt_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 7 }
}

fn nt_mint(qty: Int) -> Value {
  assets.zero
    |> assets.add(nt_policy, util.treasury_nft_name(), qty)
}

fn nt_genesis_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(nt_genesis_ref(), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

fn nt_other_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(util.mk_ref(0), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

const nt_treasury_sh: ByteArray = #"77777777"

/// Output kho hợp lệ: ở SCRIPT, mang TRSY, TreasuryDatum nợ mở = 0.
fn nt_carrier(outstanding: Int) -> Output {
  let v = assets.from_lovelace(2_000_000) |> assets.add(nt_policy, util.treasury_nft_name(), 1)
  util.mk_output(
    util.script_address(nt_treasury_sh),
    v,
    TreasuryDatum { committee_hash: #"cccc", outstanding_entitlement: outstanding },
  )
}

test trnft_mint_happy() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_other_input(), nt_genesis_input()],
      outputs: [nt_carrier(0)],
      mint: nt_mint(1),
    }
  treasury_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}

test trnft_mint_to_wallet_fails() fail {
  // Ca sinh ra bản vá: đúc TRSY thẳng vào VÍ. Trước đây PASS — và sổ cái solvency từ đó
  // do người dựng tx viết, `treasury.ak` không bao giờ chạy, C-SOLV-2 chết câm.
  let v = assets.from_lovelace(2_000_000) |> assets.add(nt_policy, util.treasury_nft_name(), 1)
  let to_wallet =
    util.mk_output(
      util.vk_address(#"badbad"),
      v,
      TreasuryDatum { committee_hash: #"cccc", outstanding_entitlement: 0 },
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_genesis_input()],
      outputs: [to_wallet],
      mint: nt_mint(1),
    }
  treasury_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}

test trnft_mint_no_datum_fails() fail {
  let v = assets.from_lovelace(2_000_000) |> assets.add(nt_policy, util.treasury_nft_name(), 1)
  let bare = util.mk_output_no_datum(util.script_address(nt_treasury_sh), v)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_genesis_input()],
      outputs: [bare],
      mint: nt_mint(1),
    }
  treasury_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}

test trnft_mint_prefilled_debt_fails() fail {
  // Mở sổ với nợ sẵn 5000 → lách được C-SOLV-2 về sau. Chặn ngay tại genesis.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_genesis_input()],
      outputs: [nt_carrier(5000)],
      mint: nt_mint(1),
    }
  treasury_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}

test trnft_mint_without_genesis() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_other_input()],
      outputs: [nt_carrier(0)],
      mint: nt_mint(1),
    }
  treasury_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}

test trnft_mint_wrong_quantity() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_genesis_input()],
      outputs: [nt_carrier(0)],
      mint: nt_mint(2),
    }
  treasury_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}
