// Validator tests cho nhánh STAKE-REWARD-IN (mock Transaction) — C-STK-0..9.
//
// Nhánh này là chỗ phần thưởng uỷ quyền của kho ĐI VÀO SỔ kho. Giá trị của nó nằm ở chỗ
// nó TỪ CHỐI, nên bộ kiểm dưới đây có ít ca dương và phần lớn là ca âm, mỗi chốt C-STK-*
// ít nhất một ca.
//
// KỶ LUẬT DỰNG CA ÂM (mirror migrate_test.ak): mỗi ca âm lệch khỏi ca dương ĐÚNG MỘT chỗ
// (trừ các ca ghi rõ lý do phải lệch hai chỗ). Lệch hai chỗ thì bài chết ở cổng sớm hơn và
// không đo cổng nó khai.
//
// VÀ CÂU HỎI ĐẶT TRƯỚC "xanh hay đỏ": đầu vào của ca này có PHÂN BIỆT ĐƯỢC hai cực của
// chốt nó khai không? Với C-STK-7 điều đó có nghĩa: phải có CẢ ca thiếu (Δ khai lớn hơn
// thực nhận) LẪN ca thừa (thực nhận lớn hơn Δ khai) — chỉ một bên thì `>=` cũng xanh, và
// `>=` chính là cái lỗ "ADA ngoài sổ" mà nhánh này sinh ra để không lặp lại.

use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Credential, Inline, Script}
use cardano/assets
use cardano/transaction.{InlineDatum, Input, Output, Transaction, placeholder}
use custody
use magiclamp/treasury/migrate
use magiclamp/treasury/stake_reward
use magiclamp/treasury/types.{
  AssetKey, CustodyDatum, LedgerEntry, StakeRewardIn,
}
use magiclamp/treasury/util
use treasury_stake

// ── Hằng số test (soi gương migrate_test.ak) ──
const cust_sh: ByteArray = #"c0c0c0c0"

/// stake credential của kho = script hash `treasury_stake` sau apply.
const stake_sh: ByteArray = #"57ac"

const seed_policy: assets.PolicyId = #"5eed"

const instance_id: ByteArray = #"abcd"

const ms_per_epoch: Int = 432_000_000

/// LAMP — chỉ dùng làm "asset khác" để ghim vế NGUYÊN VẸN của C-STK-7.
const lamp_policy: assets.PolicyId = #"1a3b"

const lamp_name: ByteArray = #"4c414d50"

/// bucket vận hành của instance — KHÁC bucket thưởng uỷ quyền.
const bucket_ops: Int = 1

const cut_bps_10: Int = 1000

const gov_sh: ByteArray = #"9999"

const in_epoch: Int = 10

const out_epoch: Int = 11

/// Δ thưởng uỷ quyền của ca dương (lovelace).
const delta: Int = 4_000_000

/// ADA ĐÃ ghi sổ trước lượt nạp.
const ada_booked: Int = 3_000_000

/// ADA giữ cho min-UTxO — KHÔNG ghi sổ (ứng xử `reserved_min_ada` của seed).
const reserved_ada: Int = 2_000_000

/// lovelace của UTxO kho trước lượt nạp.
const lovelace_in: Int = ada_booked + reserved_ada

/// LAMP kho đang giữ (asset phải NGUYÊN qua nhánh này).
const held_lamp: Int = 5000

/// ví của người crank (nhận thưởng thay kho ở ca âm tích hợp).
const crank_pkh: ByteArray = #"beef01"

fn accepted() -> List<AssetKey> {
  [
    // ADA — C-STK-9 đòi dòng này có mặt (điều kiện gieo G3 của treasury_stake.ak).
    AssetKey { policy: #"", name: #"" },
    AssetKey { policy: lamp_policy, name: lamp_name },
  ]
}

fn base_datum(
  ledger  : List<LedgerEntry>,
  epoch   : Int,
  accepts : List<AssetKey>,
) -> CustodyDatum {
  CustodyDatum {
    instance_id: instance_id,
    accepted_assets: accepts,
    ledger: ledger,
    cut_bps: cut_bps_10,
    governance_ref: gov_sh,
    epoch: epoch,
    consumed_proposals: [],
  }
}

/// Địa chỉ kho THẬT: payment = Script(custody), stake = Script(treasury_stake).
/// Đây là hình dạng mà cả nhánh này lẫn `treasury_stake` được thiết kế cho.
fn cust_addr() -> Address {
  Address {
    payment_credential: Script(cust_sh),
    stake_credential: Some(Inline(Script(stake_sh))),
  }
}

fn cust_cred() -> Credential {
  Script(cust_sh)
}

fn stake_cred() -> Credential {
  Script(stake_sh)
}

fn val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(lovelace), lamp_policy, lamp_name, lamp)
}

/// C-STK-2: NFT authenticity (seed_policy, instance_id) qty 1 trên MỌI value custody.
fn with_nft(value: assets.Value) -> assets.Value {
  assets.add(value, seed_policy, instance_id, 1)
}

// ── Fixture ca DƯƠNG ──

/// Sổ vào: hai dòng cùng bucket vận hành (ADA + LAMP), strict-sorted vì #"" < #"1a3b".
/// Có dòng thứ hai để ca "dòng sổ KHÁC bị đổi" phân biệt được hai cực.
fn ledger_in_ok() -> List<LedgerEntry> {
  [
    LedgerEntry { bucket_id: bucket_ops, policy: #"", name: #"", amount: ada_booked },
    LedgerEntry {
      bucket_id: bucket_ops,
      policy: lamp_policy,
      name: lamp_name,
      amount: held_lamp,
    },
  ]
}

/// Sổ ra: hai dòng cũ NGUYÊN + dòng thưởng mới đúng Δ (bucket hằng > bucket_ops ⇒ sorted).
fn ledger_out_ok() -> List<LedgerEntry> {
  list.concat(
    ledger_in_ok(),
    [
      LedgerEntry {
        bucket_id: stake_reward.stake_reward_bucket_id,
        policy: stake_reward.reward_policy,
        name: stake_reward.reward_name,
        amount: delta,
      },
    ],
  )
}

/// Sổ ĐÃ có dòng thưởng với số dư `amount` — fixture cho lượt thứ hai trở đi.
///
/// Cần thiết để cô lập C-STK-6: khi dòng thưởng CHƯA tồn tại, mọi Δ ≤ 0 đã bị C-STK-8
/// (`target_line_present` / `all_positive`) chặn rồi, nên ca dựng trên sổ ban đầu xanh ở
/// cả hai cực của `amount > 0` và không đo được gì. Trên sổ đã có dòng thưởng thì Δ = 0 và
/// Δ < 0 đều thoả HẾT các chốt khác — chỉ còn `amount > 0` đứng chắn.
fn ledger_with_reward(amount: Int) -> List<LedgerEntry> {
  list.concat(
    ledger_in_ok(),
    [
      LedgerEntry {
        bucket_id: stake_reward.stake_reward_bucket_id,
        policy: stake_reward.reward_policy,
        name: stake_reward.reward_name,
        amount: amount,
      },
    ],
  )
}

/// số dư dòng thưởng đã tích trước lượt đang xét.
const prev_reward: Int = 1_000_000

fn d_in_ok() -> CustodyDatum {
  base_datum(ledger_in_ok(), in_epoch, accepted())
}

fn d_out_ok() -> CustodyDatum {
  base_datum(ledger_out_ok(), out_epoch, accepted())
}

fn in_val_ok() -> assets.Value {
  with_nft(val(lovelace_in, held_lamp))
}

fn out_val_ok() -> assets.Value {
  with_nft(val(lovelace_in + delta, held_lamp))
}

// C-STK-4: interval GỌN trong 1 epoch (get_epoch_bounded đòi lower & upper cùng epoch).
fn epoch_range(lower_ms: Int) -> interval.Interval {
  interval.between(lower_ms, lower_ms + ms_per_epoch - 1)
}

/// Dựng tx StakeRewardIn. Mọi ca âm gọi hàm này và đổi ĐÚNG một tham số so với `happy_tx`.
fn tx_of(
  in_val       : assets.Value,
  out_val      : assets.Value,
  d_in         : CustodyDatum,
  d_out        : CustodyDatum,
  lower_ms     : Int,
  mint         : assets.Value,
  extra_inputs : List<Input>,
  extra_outputs: List<Output>,
) -> Transaction {
  let cust_in = util.mk_input(util.mk_ref(0), util.mk_output(cust_addr(), in_val, d_in))
  let cust_out = util.mk_output(cust_addr(), out_val, d_out)
  Transaction {
    ..placeholder,
    inputs: list.concat([cust_in], extra_inputs),
    outputs: list.concat([cust_out], extra_outputs),
    mint: mint,
    validity_range: epoch_range(lower_ms),
  }
}

/// Biến thể cho phép đổi RIÊNG hình dạng output kho (địa chỉ / reference_script).
/// Mọi thứ khác giữ y hệt ca dương → ca âm lệch đúng một chỗ.
fn tx_with_custody_output(cust_out: Output) -> Transaction {
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr(), in_val_ok(), d_in_ok()))
  Transaction {
    ..placeholder,
    inputs: [cust_in],
    outputs: [cust_out],
    mint: assets.zero,
    validity_range: epoch_range(out_epoch * ms_per_epoch),
  }
}

fn happy_tx() -> Transaction {
  tx_of(
    in_val_ok(),
    out_val_ok(),
    d_in_ok(),
    d_out_ok(),
    out_epoch * ms_per_epoch,
    assets.zero,
    [],
    [],
  )
}

/// Chạy validator. `#"feed"` = proposal_policy dummy (chỉ nhánh Release dùng).
fn run(tx: Transaction, d_in: CustodyDatum, amount: Int) -> Bool {
  custody.custody.spend(
    #"feed", seed_policy, ms_per_epoch, lamp_policy, lamp_name,
    Some(d_in), StakeRewardIn { amount }, util.mk_ref(0), tx,
  )
}

fn run_ok(tx: Transaction) -> Bool {
  run(tx, d_in_ok(), delta)
}

// ════════════════════════════════════════════════════════════
// CA DƯƠNG
// ════════════════════════════════════════════════════════════

test stake_reward_happy() {
  // spend custody (mang NFT) + không mint + custody output mang NFT, datum đúng,
  // lovelace +Δ ĐÚNG BẰNG, sổ +Δ tại bucket thưởng × ADA.
  run_ok(happy_tx())
}

test stake_reward_happy_accumulates_into_existing_line() {
  // Lượt thứ HAI: dòng thưởng ĐÃ tồn tại (số dư cũ `prev`), Δ mới cộng dồn vào chính nó.
  // Ca này phân biệt được "cộng dồn" với "ghi đè": bản ghi đè sẽ ra `delta` chứ không
  // `prev + delta` và bài đỏ.
  let prev = 1_000_000
  let l_in =
    list.concat(
      ledger_in_ok(),
      [
        LedgerEntry {
          bucket_id: stake_reward.stake_reward_bucket_id,
          policy: stake_reward.reward_policy,
          name: stake_reward.reward_name,
          amount: prev,
        },
      ],
    )
  let l_out =
    list.concat(
      ledger_in_ok(),
      [
        LedgerEntry {
          bucket_id: stake_reward.stake_reward_bucket_id,
          policy: stake_reward.reward_policy,
          name: stake_reward.reward_name,
          amount: prev + delta,
        },
      ],
    )
  let d_in = base_datum(l_in, in_epoch, accepted())
  let d_out = base_datum(l_out, out_epoch, accepted())
  let v_in = with_nft(val(lovelace_in + prev, held_lamp))
  let v_out = with_nft(val(lovelace_in + prev + delta, held_lamp))
  run(
    tx_of(
      v_in, v_out, d_in, d_out,
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
    d_in,
    delta,
  )
}

// ════════════════════════════════════════════════════════════
// TÍCH HỢP — custody.StakeRewardIn ⟷ treasury_stake.withdraw trong CÙNG một tx
//   Đây là lý do nhánh này tồn tại: `reward_cred` == payment credential của kho
//   (treasury_stake.ak ▸ G1). Hai bài dưới ghim hai cực của chính chỗ ăn khớp đó.
// ════════════════════════════════════════════════════════════

/// tx ca dương + một withdrawal Δ của stake credential kho.
fn happy_tx_with_withdrawal() -> Transaction {
  Transaction { ..happy_tx(), withdrawals: [Pair(stake_cred(), delta)] }
}

test stake_reward_integration_custody_side_ok() {
  // Phía custody: tx có withdrawal vẫn hợp lệ (nhánh này không đọc `tx.withdrawals`;
  // nó đo ĐỘ TĂNG của chính UTxO kho).
  run_ok(happy_tx_with_withdrawal())
}

test stake_reward_integration_stake_side_ok() {
  // Phía stake: cùng MỘT tx ấy, `net_to_cred(reward_cred = kho)` == Δ ≥ Σ withdrawals.
  // Hai validator ăn khớp không cần bên thứ ba.
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    cust_cred(),
    #"a0a0",
    Void,
    stake_cred(),
    happy_tx_with_withdrawal(),
  )
}

test stake_reward_integration_reward_to_crank_wallet_rejected() {
  // Cực ĐỐI: thưởng chảy vào ví người crank, kho giữ nguyên lovelace. NET về kho == 0
  // < Σ withdrawals ⇒ `treasury_stake` từ chối. Không có bài này thì cặp trên xanh ở cả
  // hai cực và không chứng minh điều gì.
  let wallet =
    util.mk_output_no_datum(util.vk_address(crank_pkh), assets.from_lovelace(delta))
  let tx =
    Transaction {
      ..tx_of(
        in_val_ok(), in_val_ok(), d_in_ok(), d_out_ok(),
        out_epoch * ms_per_epoch, assets.zero, [], [wallet],
      ),
      withdrawals: [Pair(stake_cred(), delta)],
    }
  !treasury_stake.treasury_stake.withdraw(
    instance_id,
    cust_cred(),
    #"a0a0",
    Void,
    stake_cred(),
    tx,
  )
}

// ════════════════════════════════════════════════════════════
// C-STK-0 — KHÔNG mint/burn
// ════════════════════════════════════════════════════════════

test stake_reward_reject_mint_in_same_tx() fail {
  // Thưởng staking không đi kèm mint nào. Để `tx.mint` tự do thì nhánh này thành một cổng
  // mint kèm-theo: ai crank được thưởng cũng đúc được token lạ trong cùng tx.
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch,
      assets.add(assets.zero, #"bad0", #"9999", 1),
      [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-STK-6 — Δ khai phải DƯƠNG
// ════════════════════════════════════════════════════════════

// Cả hai ca dưới dựng trên sổ ĐÃ có dòng thưởng (`ledger_with_reward`) — xem ghi chú ở
// hàm đó. Trên sổ ban đầu, C-STK-8 chặn trước và bài không đo được `amount > 0`; phép đo
// đột biến xác nhận điều đó (gỡ `expect amount > 0` mà cả bộ kiểm vẫn xanh).

test stake_reward_reject_zero_delta() fail {
  // Δ == 0 ⇒ respend no-op miễn phí mỗi block (griefing: gây contention chặn settlement
  // thật). Value giữ nguyên, sổ giữ nguyên ⇒ C-STK-7 và C-STK-8 đều THOẢ; chỉ `amount > 0`
  // đứng chắn.
  let l = ledger_with_reward(prev_reward)
  let v = with_nft(val(lovelace_in + prev_reward, held_lamp))
  let d_in = base_datum(l, in_epoch, accepted())
  run(
    tx_of(
      v, v, d_in, base_datum(l, out_epoch, accepted()),
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
    d_in,
    0,
  )
}

test stake_reward_reject_negative_delta() fail {
  // Δ < 0 ⇒ đẳng thức C-STK-7 quay ngược thành "RÚT ADA khỏi kho" mà không qua cổng
  // Governance, và sổ giảm khớp nên C-STK-8 cũng thoả. Đây là ca nguy hiểm nhất của nhánh
  // này: một đường chi không cần proposal. `|Δ| < prev_reward` để dòng thưởng ra vẫn > 0
  // (không chạm vế canonical), nghĩa là KHÔNG chốt nào khác chặn.
  let take = 500_000
  let d_in = base_datum(ledger_with_reward(prev_reward), in_epoch, accepted())
  let d_out =
    base_datum(ledger_with_reward(prev_reward - take), out_epoch, accepted())
  run(
    tx_of(
      with_nft(val(lovelace_in + prev_reward, held_lamp)),
      with_nft(val(lovelace_in + prev_reward - take, held_lamp)),
      d_in, d_out,
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
    d_in,
    -take,
  )
}

// ════════════════════════════════════════════════════════════
// C-STK-1 — ĐÚNG 1 custody input + 1 custody output theo SCRIPT HASH
// ════════════════════════════════════════════════════════════

test stake_reward_reject_second_utxo_at_custody_address() fail {
  // UTxO THỨ HAI, KHÔNG DATUM, tại ĐỊA CHỈ custody — trong khi UTxO kho thật vẫn nhận đủ Δ
  // và ghi sổ đủ Δ. Đúng "địa chỉ", ngoài sổ, và tiêu lại không được (mọi nhánh đòi đúng 1
  // UTxO mang NFT + datum) ⇒ số ADA đó đốt trá hình.
  //
  // Ca này phải giữ output kho ĐÚNG ca dương mới cô lập được C-STK-1b: nếu output kho lệch
  // (vd không tăng Δ) thì `output_at_script` vẫn trả về nó và bài chết ở C-STK-7 —
  // đo được bằng đột biến, phiên bản trước của bài này sống sót đúng kiểu ấy.
  let stray = util.mk_output_no_datum(cust_addr(), assets.from_lovelace(delta))
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, assets.zero, [], [stray],
    ),
  )
}

test stake_reward_reject_two_custody_inputs() fail {
  // 2 custody input chia chung 1 custody output (double-satisfaction) → C-STK-1 reject.
  // Đây cũng là ca ghim vế NET: input kho thứ hai là đường "rút lại từ chính kho".
  let second =
    util.mk_input(util.mk_ref(1), util.mk_output(cust_addr(), in_val_ok(), d_in_ok()))
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, assets.zero, [second], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-STK-2 — cust_in/out mang đúng 1 NFT authenticity
// ════════════════════════════════════════════════════════════

test stake_reward_reject_custody_without_nft_both_sides() fail {
  // custody-GIẢ: một UTxO dựng tại địa chỉ script (địa chỉ CÔNG KHAI) với datum bịa, không
  // mang NFT authenticity — nạp vào rồi ra, value khớp hoàn hảo.
  //
  // LỆCH HAI CHỖ CÓ CHỦ Ý và đây là ca DUY NHẤT cô lập được C-STK-2: bỏ NFT ở MỘT bên làm
  // `without_lovelace` hai bên lệch nhau ⇒ C-STK-7 bắt trước, nên bài "một bên" đo C-STK-7
  // chứ không đo C-STK-2 (đã xác nhận bằng đột biến). Bỏ ở CẢ HAI bên thì C-STK-7 thoả và
  // chỉ còn C-STK-2 đứng chắn.
  run_ok(
    tx_of(
      val(lovelace_in, held_lamp),
      val(lovelace_in + delta, held_lamp),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_output_without_seed_nft() fail {
  // NFT bị gỡ khỏi output kho (kéo authenticity token ra ngoài nhân lượt nạp).
  // GHI CHÚ TRUNG THỰC: bài này chết ở C-STK-7 (vế phi-lovelace ĐẲNG THỨC), KHÔNG ở
  // C-STK-2 — đo bằng đột biến: gỡ riêng vế NFT-output mà bài vẫn xanh. Giữ lại vì hình
  // dạng tấn công là thật; đừng đọc nó thành bằng chứng cho C-STK-2.
  run_ok(
    tx_of(
      in_val_ok(),
      val(lovelace_in + delta, held_lamp),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_input_without_seed_nft() fail {
  // custody INPUT không mang NFT (UTxO rác tại địa chỉ script) — cùng ghi chú trung thực
  // như bài trên: chết ở C-STK-7, không ở C-STK-2.
  run_ok(
    tx_of(
      val(lovelace_in, held_lamp),
      out_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-STK-3 — tham số instance bảo toàn (một trường một bài)
// ════════════════════════════════════════════════════════════

test stake_reward_reject_cut_bps_mutated() fail {
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      CustodyDatum { ..d_out_ok(), cut_bps: 0 },
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_governance_ref_mutated() fail {
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      CustodyDatum { ..d_out_ok(), governance_ref: #"dead" },
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_instance_id_mutated() fail {
  // GHI CHÚ TRUNG THỰC: bài này chết ở C-STK-2 (NFT tên `#"beef"` không có trong value),
  // KHÔNG ở C-STK-3 — đo bằng đột biến: gỡ riêng `out_datum.instance_id == datum.instance_id`
  // mà bài vẫn xanh. Bài cô lập C-STK-3 cho trường này là bài ngay dưới.
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      CustodyDatum { ..d_out_ok(), instance_id: #"beef" },
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_instance_id_swapped_to_second_nft() fail {
  // ĐỔI DANH TÍNH kho: value mang SẴN hai NFT cùng `seed_policy` (NFT của instance này và
  // của một instance khác — `custody_seed` là one-shot per genesis_ref nên NFT instance
  // khác tồn tại thật), rồi datum ra khai `instance_id` của instance KIA. Sổ và quyền chi
  // của instance này bị gán sang định danh khác.
  //
  // Đây là ca DUY NHẤT cô lập C-STK-3 ▸ instance_id: cả hai vế C-STK-2 đều thoả (mỗi NFT
  // qty 1), C-STK-7 thoả (phi-lovelace hai bên bằng nhau vì NFT thứ hai có ở CẢ input lẫn
  // output). LỆCH HAI CHỖ CÓ CHỦ Ý: phải thêm NFT vào cả in lẫn out mới giữ được C-STK-7.
  let other_id = #"beef"
  let v_in = assets.add(in_val_ok(), seed_policy, other_id, 1)
  let v_out = assets.add(out_val_ok(), seed_policy, other_id, 1)
  run_ok(
    tx_of(
      v_in, v_out, d_in_ok(),
      CustodyDatum { ..d_out_ok(), instance_id: other_id },
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_accepted_assets_mutated() fail {
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      CustodyDatum {
        ..d_out_ok(),
        accepted_assets: [AssetKey { policy: #"", name: #"" }],
      },
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_consumed_proposals_touched() fail {
  // KHÔNG được dùng làm đường vòng cho Release: chạm marker single-use → reject.
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      CustodyDatum { ..d_out_ok(), consumed_proposals: [#"0001"] },
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-STK-4 — neo epoch
// ════════════════════════════════════════════════════════════

test stake_reward_reject_epoch_not_anchored() fail {
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      CustodyDatum { ..d_out_ok(), epoch: out_epoch + 1 },
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_epoch_regress() fail {
  // cur < datum.epoch (tua lùi). LỆCH HAI CHỖ CÓ CHỦ Ý: dời validity_range về epoch cũ thì
  // out.epoch phải theo, nếu không bài chết ở vế `out_datum.epoch == cur`.
  let back = in_epoch - 1
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      CustodyDatum { ..d_out_ok(), epoch: back },
      back * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-STK-5 — custody output ở SCRIPT, không ví thường
//   GHI CHÚ TRUNG THỰC: vế này là HỆ QUẢ của C-STK-1 (`output_at_script` lọc theo payment
//   credential Script) ⇒ KHÔNG dựng được ca âm cô lập; output ở ví thường làm
//   count_outputs_at_script == 0 và chết ở C-STK-1 trước. Bài dưới khẳng định trực tiếp
//   bất biến địa chỉ, không đi qua handler.
// ════════════════════════════════════════════════════════════

test stake_reward_custody_addr_is_not_vk() {
  !util.is_vk(cust_addr())
}

// ════════════════════════════════════════════════════════════
// C-STK-ADDR — địa chỉ kho GIỮ NGUYÊN, kể cả stake credential
//   Sống còn ở ĐÚNG nhánh này: stake credential là thứ sinh ra chính khoản thưởng đang nạp.
//   Hai ca dưới dùng ĐÚNG script hash payment, chỉ khác phần stake ⇒ `count_*_at_script`
//   (so theo payment credential) KHÔNG phân biệt được, chỉ C-STK-ADDR phân biệt được.
// ════════════════════════════════════════════════════════════

test stake_reward_reject_stake_part_dropped() fail {
  // base → enterprise, cùng script hash: kho mất luôn nguồn sinh thưởng ở mọi epoch sau.
  run_ok(
    tx_with_custody_output(
      util.mk_output(util.script_address(cust_sh), out_val_ok(), d_out_ok()),
    ),
  )
}

test stake_reward_reject_stake_part_hijacked() fail {
  // stake credential đổi sang khoá CỦA NGƯỜI CRANK: mọi epoch sau thưởng trên toàn bộ ADA
  // của kho chảy về hắn, chi phí một phí tx. `!is_vk` KHÔNG chặn được vì payment vẫn Script.
  run_ok(
    tx_with_custody_output(
      util.mk_output(
        util.script_address_staked(cust_sh, crank_pkh),
        out_val_ok(),
        d_out_ok(),
      ),
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-STK-REFSCRIPT — không đính script tham chiếu vào kho
// ════════════════════════════════════════════════════════════

test stake_reward_reject_reference_script_attached() fail {
  // Griefing: đính một script tham chiếu vào kho mỗi lượt, ăn dần dư địa min-ADA.
  run_ok(
    tx_with_custody_output(
      Output {
        address: cust_addr(),
        value: out_val_ok(),
        datum: InlineDatum(d_out_ok()),
        reference_script: Some(#"5c81"),
      },
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-STK-7 — value: lovelace +Δ ĐẲNG THỨC, mọi asset khác NGUYÊN
// ════════════════════════════════════════════════════════════

test stake_reward_reject_delta_overstated() fail {
  // Δ KHAI (4 ADA) LỚN HƠN lovelace thực nhận (4 ADA − 1): sổ ghi nhiều hơn tiền thật
  // ⇒ Release rút vượt số dư thật của kho.
  run_ok(
    tx_of(
      in_val_ok(),
      with_nft(val(lovelace_in + delta - 1, held_lamp)),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_delta_understated() fail {
  // Cực ĐỐI: lovelace thực nhận LỚN HƠN Δ khai. Đây là chỗ `>=` sẽ xanh — và phần chênh
  // là ADA nằm trong kho mà KHÔNG dòng sổ nào nhận, tức kẹt ngoài sổ vĩnh viễn (đúng cái
  // `migrate.value_ok` đã khai nhận phải trả giá). Cặp hai bài này là phép đo phân biệt
  // `==` với `>=`; thiếu bài này thì đột biến `==` → `>=` sống sót.
  run_ok(
    tx_of(
      in_val_ok(),
      with_nft(val(lovelace_in + delta + 1, held_lamp)),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_lamp_drained() fail {
  // Nhân lúc nạp thưởng thì rút bớt LAMP ra → C-STK-7 (phi-lovelace NGUYÊN) reject.
  run_ok(
    tx_of(
      in_val_ok(),
      with_nft(val(lovelace_in + delta, held_lamp - 1)),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_junk_token_added() fail {
  // Nhét token rác vào custody output (phình UTxO / vượt trần asset) → C-STK-7 reject.
  run_ok(
    tx_of(
      in_val_ok(),
      assets.add(out_val_ok(), #"7a17", #"4a554e4b", 1),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-STK-8 — sổ: +Δ tại ĐÚNG (bucket hằng, ADA), canonical
// ════════════════════════════════════════════════════════════

test stake_reward_reject_ledger_unchanged() fail {
  // VALUE tăng nhưng SỔ giữ nguyên: "đúng địa chỉ, ngoài sổ" — Release không rút lại được.
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      base_datum(ledger_in_ok(), out_epoch, accepted()),
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_ledger_wrong_bucket() fail {
  // Sổ tăng ĐÚNG Δ nhưng vào bucket VẬN HÀNH (luật chi khác) thay vì bucket thưởng.
  let l_out =
    [
      LedgerEntry {
        bucket_id: bucket_ops, policy: #"", name: #"", amount: ada_booked + delta,
      },
      LedgerEntry {
        bucket_id: bucket_ops,
        policy: lamp_policy,
        name: lamp_name,
        amount: held_lamp,
      },
    ]
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      base_datum(l_out, out_epoch, accepted()),
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_ledger_wrong_asset() fail {
  // Sổ tăng ĐÚNG Δ, ĐÚNG bucket thưởng, nhưng ghi vào dòng LAMP thay vì dòng ADA —
  // sổ khai một lượng LAMP không hề có trong value.
  let l_out =
    list.concat(
      ledger_in_ok(),
      [
        LedgerEntry {
          bucket_id: stake_reward.stake_reward_bucket_id,
          policy: lamp_policy,
          name: lamp_name,
          amount: delta,
        },
      ],
    )
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      base_datum(l_out, out_epoch, accepted()),
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_ledger_over_credited() fail {
  // Sổ ghi Δ+1 trong khi lovelace chỉ tăng Δ (sổ dối để Release rút vượt).
  let l_out =
    list.concat(
      ledger_in_ok(),
      [
        LedgerEntry {
          bucket_id: stake_reward.stake_reward_bucket_id,
          policy: stake_reward.reward_policy,
          name: stake_reward.reward_name,
          amount: delta + 1,
        },
      ],
    )
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      base_datum(l_out, out_epoch, accepted()),
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_other_ledger_line_mutated() fail {
  // DÒNG SỔ KHÁC bị đổi (số dư LAMP tự tăng 1) trong khi value LAMP không đổi.
  let l_out =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: #"", name: #"", amount: ada_booked },
      LedgerEntry {
        bucket_id: bucket_ops,
        policy: lamp_policy,
        name: lamp_name,
        amount: held_lamp + 1,
      },
      LedgerEntry {
        bucket_id: stake_reward.stake_reward_bucket_id,
        policy: stake_reward.reward_policy,
        name: stake_reward.reward_name,
        amount: delta,
      },
    ]
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      base_datum(l_out, out_epoch, accepted()),
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_ledger_line_dropped() fail {
  // Xoá lén dòng sổ cũ (số dư LAMP biến mất) → each_in_line_settled reject.
  let l_out =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: #"", name: #"", amount: ada_booked },
      LedgerEntry {
        bucket_id: stake_reward.stake_reward_bucket_id,
        policy: stake_reward.reward_policy,
        name: stake_reward.reward_name,
        amount: delta,
      },
    ]
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      base_datum(l_out, out_epoch, accepted()),
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_ledger_not_canonical() fail {
  // Sổ ra KHÔNG strict-sorted (đảo hai dòng đầu) → dòng trùng khoá lọt được nếu bỏ vế này.
  let l_out =
    [
      LedgerEntry {
        bucket_id: bucket_ops,
        policy: lamp_policy,
        name: lamp_name,
        amount: held_lamp,
      },
      LedgerEntry { bucket_id: bucket_ops, policy: #"", name: #"", amount: ada_booked },
      LedgerEntry {
        bucket_id: stake_reward.stake_reward_bucket_id,
        policy: stake_reward.reward_policy,
        name: stake_reward.reward_name,
        amount: delta,
      },
    ]
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      base_datum(l_out, out_epoch, accepted()),
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test stake_reward_reject_phantom_ledger_line() fail {
  // Nhồi dòng khống ở một bucket khác (không có ở sổ vào, không Δ nào nhắm tới).
  let l_out =
    list.concat(
      ledger_out_ok(),
      [
        LedgerEntry {
          bucket_id: stake_reward.stake_reward_bucket_id + 1,
          policy: #"",
          name: #"",
          amount: 999,
        },
      ],
    )
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(),
      base_datum(l_out, out_epoch, accepted()),
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-STK-9 — ADA phải nằm trong accepted_assets
// ════════════════════════════════════════════════════════════

test stake_reward_reject_ada_not_accepted() fail {
  // Instance KHÔNG khai nhận ADA → từ chối nạp (giữ bất biến S-ACC-0 của seed).
  // LỆCH HAI CHỖ CÓ CHỦ Ý: accepted_assets phải đổi ở CẢ datum vào lẫn datum ra, nếu không
  // bài chết ở C-STK-3 (bảo toàn params).
  let lamp_only = [AssetKey { policy: lamp_policy, name: lamp_name }]
  let d_in = base_datum(ledger_in_ok(), in_epoch, lamp_only)
  let d_out = base_datum(ledger_out_ok(), out_epoch, lamp_only)
  run(
    tx_of(
      in_val_ok(), out_val_ok(), d_in, d_out,
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
    d_in,
    delta,
  )
}

// ════════════════════════════════════════════════════════════
// BUCKET DÀNH RIÊNG — cưỡng chế ở hai đầu còn lại
//   Hằng `stake_reward_bucket_id` chỉ mua được tính chất "đọc kho đã thu bao nhiêu thưởng
//   bằng đúng một phép tra sổ" nếu KHÔNG đường nào khác ghi vào nó. Hai đầu kia là
//   `Collect` (item.category tự do) và `custody_seed` (sổ genesis tự do) — bài của chúng
//   nằm ở collect_test.ak / custody_seed_test.ak; ở đây chỉ ghim rằng hằng KHÔNG trùng
//   bucket Reserve (trùng thì cả hai tính chất kiểm toán nhập làm một mà không ai kêu).
// ════════════════════════════════════════════════════════════

test stake_reward_bucket_is_distinct() {
  stake_reward.stake_reward_bucket_id != migrate.reserve_inflow_bucket_id && stake_reward.stake_reward_bucket_id != bucket_ops
}
