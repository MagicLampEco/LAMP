// Custody seed — minting policy ONE-SHOT ép BẤT BIẾN NỀN tại GENESIS.
//
// VẤN ĐỀ (audit major): custody validator (custody.ak) chỉ chạy khi SPEND một
// custody đã tồn tại (nhánh Collect, kiểm INCREMENTAL Δsổ==Δvalue). Custody UTxO
// ĐẦU TIÊN (seed) do ví thường tạo với inline CustodyDatum TÙY Ý → bất biến nền
//   ∀a  Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a)   (types.ak)
// KHÔNG được ép ở đâu on-chain. Sổ ≠ value lúc seed → sổ sai vĩnh viễn; Release
// (v1.x) đọc sổ sai sẽ over/under-draw. v1 chỉ Collect nên value vẫn bảo toàn
// (Σout=Σin, không leak), NHƯNG kế toán có thể SINH RA đã hỏng.
//
// FIRST-PRINCIPLES — one-shot (mirror Distribution beacon_nft.ak):
//   Policy parameterized bởi 1 genesis OutputReference. Mint chỉ hợp lệ khi tx
//   CONSUME đúng UTxO genesis đó. 1 UTxO spend được đúng 1 lần trong lịch sử
//   chain → policy chạy đúng 1 lần → đúng 1 instance NFT, KHÔNG re-mint.
//   NFT này là authenticity token của custody (giống beacon NFT): chỉ UTxO mang
//   nó mới là custody "thật" của instance; mọi validator/offchain phụ thuộc chỉ
//   tin custody mang NFT đúng policy.
//
// GENESIS ÉP (đây là nhánh duy nhất ép bất biến nền — phần còn lại incremental):
//   S-MINT-1  mint ĐÚNG 1 token của policy này (name = instance_id), qty +1.
//   S-OUT-1   có ĐÚNG 1 output custody (theo SCRIPT HASH tham số) mang NFT đó +
//             inline CustodyDatum.
//   S-SEED-0  seed_value_ok: value == ledger_value(ledger) ⊕ reserved_min_ada
//             — ÉP ∀a Σ_b ledger[(b,a)] == value(a) − reserved_min_ada (NỀN).
//   S-LEDGER-0 sổ KHÔNG dòng trùng khóa (no_dup_lines) — chống nhồi 2 dòng cùng
//             (bucket,asset) để né incremental về sau.
//   S-ACC-0   mọi dòng sổ thuộc accepted_assets (đa thuê bao nhất quán).
//   S-PARAM-0 NFT name == instance_id (buộc datum khai báo đúng định danh đã mint).
//
// BURN — CẤM hoàn toàn (else fail): NFT authenticity sống suốt vòng đời instance.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use magiclamp/treasury/collect
use magiclamp/treasury/types.{AssetKey, CustodyDatum, LedgerEntry}
use magiclamp/treasury/util

/// Redeemer minting policy. Chỉ một action; KHÔNG có Burn (else fail chặn mint âm).
pub type CustodySeedRedeemer {
  // reserved_min_ada: phần lovelace giữ cho min-UTxO, KHÔNG ghi sổ (≥ 0).
  SeedGenesis { reserved_min_ada: Int }
}

/// Mọi dòng sổ thuộc accepted_assets.
fn all_lines_accepted(ledger: List<LedgerEntry>, accepted: List<AssetKey>) -> Bool {
  list.all(
    ledger,
    fn(e) {
      list.any(accepted, fn(a) { a.policy == e.policy && a.name == e.name })
    },
  )
}

/// custody_seed parameterized bởi (genesis_ref, custody_script_hash).
/// custody_script_hash = payment script hash của custody.ak instance (để chọn
/// đúng output custody trong tx genesis theo SCRIPT HASH — chống double-satisfaction).
validator custody_seed(
  genesis_ref         : OutputReference,
  custody_script_hash : ByteArray,
) {
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

    // ── S-OUT-1: đúng 1 output custody theo SCRIPT HASH ─────────────────────
    expect util.count_outputs_at_script(tx.outputs, custody_script_hash) == 1
    let cust_out = util.output_at_script(tx.outputs, custody_script_hash)

    expect InlineDatum(od) = cust_out.datum
    expect seed_datum: CustodyDatum = od

    // ── S-PARAM-0: NFT name == instance_id (buộc datum khai báo đúng định danh) ─
    expect assets.quantity_of(tx.mint, policy_id, seed_datum.instance_id) == 1

    // ── S-SEED-0: ÉP bất biến nền sổ↔value tại seed ─────────────────────────
    expect
      collect.seed_value_ok(cust_out.value, seed_datum.ledger, reserved_min_ada)

    // ── S-LEDGER-0: sổ không dòng trùng khóa (chống né incremental về sau) ──
    expect collect.no_dup_lines(seed_datum.ledger)

    // ── S-ACC-0: mọi dòng sổ thuộc accepted_assets ─────────────────────────
    expect all_lines_accepted(seed_datum.ledger, seed_datum.accepted_assets)

    // ── S-CONSUMED-0: genesis CHƯA chi proposal nào (single-use marker C-REL-9
    //    bắt đầu rỗng). Chống seed pre-mark né replay-guard về sau.
    expect seed_datum.consumed_proposals == []

    True
  }

  else(_) {
    fail
  }
}
