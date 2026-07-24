// Custody seed — minting policy ONE-SHOT ép BẤT BIẾN NỀN tại GENESIS.
//
// VẤN ĐỀ (audit major): custody validator (custody.ak) chỉ chạy khi SPEND một
// custody đã tồn tại (kiểm INCREMENTAL Δsổ==Δvalue). Custody UTxO ĐẦU TIÊN (seed)
// do ví thường tạo với inline CustodyDatum TÙY Ý → bất biến nền
//   ∀a  Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a)   (types.ak)
// KHÔNG được ép ở đâu on-chain. Sổ ≠ value lúc seed → sổ sai vĩnh viễn.
//
// FIRST-PRINCIPLES — one-shot (mirror Distribution beacon_nft.ak):
//   Policy parameterized bởi 1 genesis OutputReference. Mint chỉ hợp lệ khi tx
//   CONSUME đúng UTxO genesis đó. 1 UTxO spend được đúng 1 lần → policy chạy đúng 1
//   lần → đúng 1 instance NFT, KHÔNG re-mint. NFT này là authenticity token của
//   custody: custody.ak (param seed_policy) ÉP NFT hiện diện khi spend → chỉ UTxO
//   mang nó mới là custody "thật" của instance.
//
// PHÁ VÒNG seed↔custody: seed KHÔNG param custody_script_hash (nếu có → vòng vì
//   custody hash phụ thuộc seed_policy phụ thuộc custody hash). Thay vào đó chọn
//   output custody bằng CHÍNH NFT vừa mint (self-reference), ÉP ở Script. seed_policy
//   khi đó CHỈ phụ thuộc genesis_ref → tính độc lập custody → custody param seed_policy.
//
// GENESIS ÉP (nhánh DUY NHẤT ép bất biến nền — phần còn lại incremental):
//   S-MINT-1  mint ĐÚNG 1 token của policy này, qty +1 (name = instance_id).
//   S-OUT-1   ĐÚNG 1 output mang NFT đó, Ở SCRIPT (self-ref) + inline CustodyDatum.
//   S-PARAM-0 datum.instance_id == NFT name (datum khai báo đúng định danh đã mint).
//   S-ID-0    instance_id != #"" (định danh đa thuê bao thật).
//   S-ACC-1   accepted_assets != [] (không instance "câm").
//   S-CUT-0   0 ≤ cut_bps ≤ 10000 (chống cut âm drain / cut > 100%). Bất biến đời
//             instance (không nhánh nào đổi ở v1) → ép một lần tại seed là đủ.
//   S-SEED-0  seed_value_ok: value == ledger.value_of(ledger) ⊕ reserved_min_ada (NỀN).
//   S-LEDGER-0 sổ CANONICAL: strict-sorted ∧ mọi dòng > 0 (no-dup O(n) + chống dòng
//             0/âm lọt qua seed — đặc biệt dòng ADA âm bù reserved).
//   S-ACC-0   mọi dòng sổ thuộc accepted_assets (đa thuê bao nhất quán).
//   S-CONSUMED-0 consumed_proposals == [] (chống seed pre-mark né replay-guard).
//
// BURN — CẤM hoàn toàn (else fail): NFT authenticity sống suốt vòng đời instance.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use magiclamp/treasury/collect
use magiclamp/treasury/ledger
use magiclamp/treasury/types.{AssetKey, CustodyDatum, LedgerEntry}
use magiclamp/treasury/util

/// Redeemer minting policy. Chỉ một action; KHÔNG có Burn (else fail chặn mint âm).
pub type CustodySeedRedeemer {
  // reserved_min_ada: phần lovelace giữ cho min-UTxO, KHÔNG ghi sổ (≥ 0).
  SeedGenesis { reserved_min_ada: Int }
}

/// Mọi dòng sổ thuộc accepted_assets.
fn all_lines_accepted(ledger_lines: List<LedgerEntry>, accepted: List<AssetKey>) -> Bool {
  list.all(
    ledger_lines,
    fn(e) {
      list.any(accepted, fn(a) { a.policy == e.policy && a.name == e.name })
    },
  )
}

/// custody_seed parameterized CHỈ bởi genesis_ref (one-shot). Output custody chọn
/// bằng self-reference NFT (không cần custody_script_hash → phá vòng seed↔custody).
validator custody_seed(genesis_ref: OutputReference) {
  mint(redeemer: CustodySeedRedeemer, policy_id: PolicyId, tx: Transaction) {
    let SeedGenesis { reserved_min_ada } = redeemer

    // reserved_min_ada không âm (lovelace giữ cho min-UTxO).
    expect reserved_min_ada >= 0

    // ── ONE-SHOT: phải consume đúng UTxO genesis ───────────────────────────
    // 1 UTxO spend được tối đa 1 lần → policy chạy được tối đa 1 lần.
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── S-MINT-1: mint ĐÚNG 1 token của policy này, qty +1 ──────────────────
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1
    expect [Pair(nft_name, qty)] = dict.to_pairs(own_tokens)
    expect qty == 1
    // S-MINT-2 (F5): seed KHÔNG gánh mint policy NGOÀI trong cùng tx (least-authority).
    expect list.length(assets.policies(tx.mint)) == 1

    // ── S-OUT-1: ĐÚNG 1 output mang NFT đó (self-ref), Ở SCRIPT ──────────────
    expect util.count_outputs_with_token(tx.outputs, policy_id, nft_name) == 1
    let cust_out = util.output_with_token(tx.outputs, policy_id, nft_name)
    // custody phải ở SCRIPT (két, không phải ví thường).
    expect !util.is_vk(cust_out.address)

    expect InlineDatum(od) = cust_out.datum
    expect seed_datum: CustodyDatum = od

    // ── S-PARAM-0: datum.instance_id == NFT name (buộc khai báo đúng định danh) ─
    expect seed_datum.instance_id == nft_name

    // ── S-ID-0 / S-ACC-1: định danh thật + có ít nhất 1 asset nhận ───────────
    expect seed_datum.instance_id != #""
    expect seed_datum.accepted_assets != []

    // ── S-CUT-0: cut_bps trong dải [0,10000] (chống cut âm drain / >100%) ────
    expect seed_datum.cut_bps >= 0 && seed_datum.cut_bps <= 10000

    // ── S-SEED-0: ÉP bất biến nền sổ↔value tại seed (gồm NFT authenticity) ──
    expect
      collect.seed_value_ok(
        cust_out.value,
        seed_datum.ledger,
        reserved_min_ada,
        policy_id,
        nft_name,
      )

    // ── S-LEDGER-0: sổ CANONICAL (strict-sorted ∧ mọi dòng > 0) ─────────────
    // chặn trùng khóa (O(n)) + dòng 0/âm (đặc biệt dòng ADA âm bù reserved).
    expect ledger.is_canonical(seed_datum.ledger)

    // ── S-ACC-0: mọi dòng sổ thuộc accepted_assets ─────────────────────────
    expect all_lines_accepted(seed_datum.ledger, seed_datum.accepted_assets)

    // ── S-CONSUMED-0: genesis CHƯA chi proposal nào (single-use marker rỗng) ─
    expect seed_datum.consumed_proposals == []

    True
  }

  else(_) {
    fail
  }
}
