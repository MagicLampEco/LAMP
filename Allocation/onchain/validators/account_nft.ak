// account_nft — minting policy XÁC THỰC per-account (C-ACC).
//
// Vá CRITICAL giả mạo account: một ClaimAccount UTxO chỉ hợp lệ khi mang NFT do
// COMMITTEE bảo chứng lúc genesis. Khác budget_nft (gate one-shot), account_nft gate
// bằng committee threshold — vì initial entitlement/vesting của account phải được
// committee duyệt (one-shot đơn thuần: ai chọn genesis_ref của mình cũng mint account
// entitlement khủng). NFT là bằng chứng bền "account này đã qua genesis committee".
//
//   C-ACC-2  mint ⇒ committee threshold (⌈2N/3⌉) ký.
//   C-ACC-1  name = blake2b_256(owner ‖ channel_id) — 1 account / (owner, kênh).
//   C-ACC-3  NFT vào đúng 1 output ở Script credential, ClaimAccountDatum redeemed==0.
//
// ponytail: committee "bless" 2 account cùng owner/kênh = vấn đề governance của committee
// (M-of-N là trust anchor), KHÔNG chống ở đây. Nâng cấp: registry chống double-bless nếu cần.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Transaction, placeholder}
use magiclamp/allocation/types.{ClaimAccountDatum}
use magiclamp/allocation/util

pub type AccountNftRedeemer {
  MintAccount
}

validator account_nft(committee: List<ByteArray>, threshold: Int) {
  mint(_redeemer: AccountNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── C-ACC-2: committee threshold ký (thứ chặn giả mạo) ──
    expect util.count_committee_sigs(committee, tx.extra_signatories) >= threshold

    // ── Mint ĐÚNG 1 token của policy này, qty +1 ──
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1
    expect [Pair(mint_name, mint_qty)] = dict.to_pairs(own_tokens)
    expect mint_qty == 1

    // ── NFT vào ĐÚNG 1 output ở Script credential (C-ACC-3) ──
    let nft_outs =
      list.filter(
        tx.outputs,
        fn(o) { assets.quantity_of(o.value, policy_id, mint_name) == 1 },
      )
    expect [acc_out] = nft_outs
    expect util.is_at_script_cred(acc_out.address)
    expect InlineDatum(d) = acc_out.datum
    expect ad: ClaimAccountDatum = d

    // ── C-ACC-1: name buộc owner ‖ channel ──
    expect mint_name == util.account_nft_name(ad.owner, ad.channel_id)

    // ── C-ACC-3: account mới sạch ──
    expect ad.redeemed == 0

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

const t_committee: List<ByteArray> = [#"c1", #"c2", #"c3"]

const t_threshold: Int = 2

const t_policy: ByteArray = #"acac"

const t_owner: ByteArray = #"0a0a"

const t_channel: ByteArray = #"5445414d"

fn genesis_datum(redeemed: Int, channel: ByteArray) -> ClaimAccountDatum {
  ClaimAccountDatum {
    owner: t_owner,
    entitlement: 1000,
    redeemed: redeemed,
    start_epoch: 0,
    drops_per_epoch: 1,
    channel_id: channel,
  }
}

/// Genesis tx: mint 1 NFT name=hash(owner‖channel) → 1 output script-cred mang datum.
fn genesis_tx(
  name    : ByteArray,
  datum   : ClaimAccountDatum,
  sigs    : List<ByteArray>,
  at_script: Bool,
) -> Transaction {
  let addr =
    if at_script {
      util.script_address(#"a1a1a1a1")
    } else {
      util.vk_address(t_owner)
    }
  let val = assets.add(assets.from_lovelace(2_000_000), t_policy, name, 1)
  let out = util.mk_output(addr, val, datum)
  Transaction {
    ..placeholder,
    outputs: [out],
    extra_signatories: sigs,
    mint: assets.add(assets.zero, t_policy, name, 1),
  }
}

fn run_mint(tx: Transaction) -> Bool {
  account_nft.mint(t_committee, t_threshold, MintAccount, t_policy, tx)
}

test account_nft_name_xcheck_offchain() {
  // BYTE-PERFECT với off-chain (@noble/hashes blake2b, dkLen 32). CLAUDE.md invariant #1.
  // Vector: owner=#"0a0a", channel=#"5445414d" (TEAM). Đổi derivation → sửa cả 2 phía + vector.
  util.account_nft_name(#"0a0a", #"5445414d") == #"75b5f639e77e2233a728fb07499d76b8931597dd836dca9de3d87a6e6f9b6847"
}

test mint_requires_committee() fail {
  // Genesis không đủ committee sig → mint PHẢI bị từ chối (C-ACC-2).
  let d = genesis_datum(0, t_channel)
  let tx = genesis_tx(util.account_nft_name(t_owner, t_channel), d, [#"c1"], True)
  run_mint(tx)
}

test mint_happy() {
  // committee đủ + name khớp owner‖channel + redeemed==0 + script-cred → OK.
  let d = genesis_datum(0, t_channel)
  let tx = genesis_tx(util.account_nft_name(t_owner, t_channel), d, [#"c1", #"c2"], True)
  run_mint(tx)
}

test mint_wrong_name_rejected() fail {
  // NFT name KHÔNG = blake2b(owner‖channel) → từ chối (C-ACC-1).
  let d = genesis_datum(0, t_channel)
  let tx = genesis_tx(#"deadbeef", d, [#"c1", #"c2"], True)
  run_mint(tx)
}

test mint_redeemed_nonzero_rejected() fail {
  // Account genesis phải sạch (redeemed==0) → redeemed=5 bị từ chối (C-ACC-3).
  let d = genesis_datum(5, t_channel)
  let tx = genesis_tx(util.account_nft_name(t_owner, t_channel), d, [#"c1", #"c2"], True)
  run_mint(tx)
}

test mint_to_wallet_rejected() fail {
  // NFT vào ví thường (không Script credential) → từ chối (C-ACC-3).
  let d = genesis_datum(0, t_channel)
  let tx = genesis_tx(util.account_nft_name(t_owner, t_channel), d, [#"c1", #"c2"], False)
  run_mint(tx)
}
