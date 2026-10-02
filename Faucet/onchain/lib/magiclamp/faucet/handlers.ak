// handlers — thân của `faucet_account.spend` và `faucet_nft.mint`, tách ra thành
// hàm `pub` để ca kiểm ở module KHÁC gọi được.
//
// VÌ SAO TỒN TẠI TỆP NÀY (đừng gộp lại): Aiken KHÔNG xuất handler của validator
// ra ngoài module — `use faucet_account` rồi gọi `faucet_account.spend` trả lỗi
// `aiken::check::unknown::module_value`. Nhưng lớp ca kiểm quan trọng nhất của
// Faucet là lớp gọi HAI script trên CÙNG một `Transaction`: nó là phép đo duy
// nhất bắt được "hai validator đòi hai điều trái nhau", thứ mà mọi bài đơn vị
// vẫn xanh đúng tên nó. Không có tệp này thì lớp ca đó không viết được, và một
// luồng có thể là mã chết mà 100% bộ kiểm vẫn xanh.
//
// `faucet_pool` KHÔNG nằm ở đây: ca kiểm hai-validator sống trong
// `faucet_pool.ak` (nơi có sẵn bộ builder của pool), nên nó gọi pool trong-module
// và gọi hai hàm dưới đây qua module. Đưa pool vào đây không thêm phép đo nào,
// chỉ thêm một lớp gián tiếp.

use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use magiclamp/faucet/ledger.{
  AccountRedeemer, BurnAccount, FaucetAccount, FaucetNftRedeemer, MintAccount,
  MintPool, PoolDatum, ReclaimIdle, TopUp, Use, acct_name, acct_name_prefix,
  empty_opened_root, max_claims_ceiling, pool_nft_name,
}
use magiclamp/faucet/util

/// Ngưỡng reclaim, tính bằng CỬA SỔ — hằng protocol = 72 cửa sổ. Độ dài thật phụ
/// thuộc tham số `ms_per_epoch` của mạng: ≈ **1 năm** với cửa sổ 5 ngày
/// (Preprod/Mainnet), ≈ **72 ngày** với cửa sổ 1 ngày (Preview). Con số chọn theo
/// một khoảng thời gian thật: một account bỏ không tròn một năm thì tLAMP trong
/// nó nên quay về pool, vì `tlamp_policy` là one-shot nên pool cạn là bất khả hồi.
/// Hằng compile-time ở đây là NGUỒN DUY NHẤT — `FaucetConfig` KHÔNG còn bản sao
/// `reclaim_epochs` (bản sao đó trước đây không được cưỡng chế ở đâu cả).
const reclaim_epochs_const: Int = 72

// ─────────────────────────────────────────────────────────────────────────
// USE (chủ DID dùng tLAMP test):
//   - C-USE-NOPOOL-1 tx KHÔNG có POOL NFT input. `Use` và `TopUp` phải RỜI NHAU:
//     `Use` cấm tLAMP tăng, `TopUp` bắt buộc tăng. Không rời nhau thì một tx
//     `pool.ClaimAgain` chọn được nhánh sai và cả hai chốt cùng mất nghĩa.
//   - C-USE-EPOCH-1 `now` neo vào thời gian thật (không dùng cận dưới).
//   - chủ DID chứng minh bằng DID NFT trong input.
//   - `last_claim_epoch` BẤT BIẾN; `last_touch_epoch == now` và KHÔNG LÙI.
//
// TOPUP (account nhận thêm drip trong tx `pool.ClaimAgain`):
//   - số tiền KHÔNG để bên pool tự khai: đọc `drip_oildrop` từ datum của POOL
//     input, định vị bằng POOL NFT. Thiếu dòng đó, một tx `pool.Reclaim` +
//     `acct.TopUp` rút sạch tLAMP của account mà không cần DID NFT.
//
// RECLAIM IDLE (permissionless thu hồi account chết):
//   - now ≥ last_touch_epoch + reclaim_epochs_const → ai cũng spend.
//   - `now` ở nhánh này CỐ Ý dùng cận dưới: lùi thời gian chỉ làm người thu hồi
//     tự mình không đủ điều kiện, không ai khác thiệt.
//   - TOÀN BỘ tLAMP của account PHẢI về pool; ACCT NFT PHẢI bị đốt (C-BURN-1).
pub fn account_spend(
  faucet_nft_policy: ByteArray,
  did_nft_policy: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
  ms_per_epoch: Int,
  window_origin_ms: Int,
  datum_opt: Option<FaucetAccount>,
  redeemer: AccountRedeemer,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  expect Some(acct) = datum_opt
  let own_addr = util.own_address(own_ref, tx.inputs)
  let own_hash = util.own_script_hash(own_addr)

  // Đúng 1 account input (theo SCRIPT HASH) — chống double-satisfaction qua
  // stake credential.
  expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
  let acct_in = util.input_at_script(tx.inputs, own_hash)

  let acct_lamp = assets.quantity_of(acct_in.value, lamp_policy, lamp_name)
  let an = acct_name(acct.did_name)

  when redeemer is {
    // ── USE (chủ DID gia hạn + dùng tLAMP) ───────────────────────────────
    Use -> {
      // ── C-USE-NOPOOL-1: hai nhánh RỜI NHAU ──────────────────────────────
      // Ghim bởi `again_account_dung_redeemer_Use` · `use_co_pool_input`.
      expect
        util.count_inputs_with_nft(tx.inputs, faucet_nft_policy, pool_nft_name) == 0

      // ── C-USE-EPOCH-1: mốc neo vào thời gian thật ────────────────────────
      // Với cận dưới, chủ DID viết `last_*` về một bucket rất xa rồi thoả
      // cooldown ngay tx sau — né cooldown trên chính đường hợp lệ.
      let now = util.get_epoch_pinned(tx, ms_per_epoch, window_origin_ms)

      // đúng 1 account output cùng script.
      expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
      let acct_out = util.output_at_script(tx.outputs, own_hash)

      // ── C-ACCT-ADDR-1: acct_out ở ĐÚNG địa chỉ của acct_in ───────────────
      // `count/output_at_script` chỉ so PAYMENT credential ⇒ stake credential
      // là trường TỰ DO nếu không ghim: cùng script hash + khác stake cred =
      // Address khác nhưng cùng validator, phần thưởng uỷ quyền trên ADA của
      // account chảy về khoá stake kẻ dựng tx và bên index mất dấu.
      // Ghim bởi `use_acct_out_stake_hijack`.
      expect acct_out.address == acct_in.address

      // ── C-ACCT-REF-1: account KHÔNG biến thành script-carrier ────────────
      // Ghim bởi `use_acct_out_script_carrier`.
      expect acct_out.reference_script == None

      expect InlineDatum(od) = acct_out.datum
      expect out_acct: FaucetAccount = od

      // Chủ DID: tx mang DID NFT (did_nft_policy, acct.did_name) qty ≥1.
      expect
        util.count_inputs_with_nft(tx.inputs, did_nft_policy, acct.did_name) >= 1

      expect out_acct.did_name == acct.did_name
      // C-USE-CLAIMFIX-1: `Use` KHÔNG đụng mốc cooldown. Không có dòng này, ai
      // dùng tLAMP đúng cách lại bị đẩy cooldown ra xa, còn kẻ chỉ claim rồi bỏ
      // đó thì không chịu gì — và cooldown reset được bằng một lượt `Use`.
      expect out_acct.last_claim_epoch == acct.last_claim_epoch
      // C-USE-TOUCH-1: gia hạn mốc idle = now.
      expect out_acct.last_touch_epoch == now
      // C-USE-MONO-1: mốc idle KHÔNG LÙI. Ghim bởi `use_lui_moc_ve_qua_khu`.
      expect out_acct.last_touch_epoch >= acct.last_touch_epoch

      // C-USE-NAME-1: ACCT NFT ở lại account, và tên nó neo vào ĐÚNG DID này.
      expect util.has_nft(acct_out, faucet_nft_policy, an)
      // C-USE-2: `Use` không đúc, không đốt.
      expect assets.quantity_of(tx.mint, faucet_nft_policy, an) == 0

      // Account KHÔNG được tăng tLAMP lén (chống bơm), được GIẢM (chủ DID rút
      // ra dùng — đúng mục đích faucet).
      let out_lamp = assets.quantity_of(acct_out.value, lamp_policy, lamp_name)
      expect out_lamp >= 0
      expect out_lamp <= acct_lamp
      True
    }

    // ── TOPUP (account nhận thêm drip trong tx pool.ClaimAgain) ───────────
    TopUp -> {
      let now = util.get_epoch_pinned(tx, ms_per_epoch, window_origin_ms)

      expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
      let acct_out = util.output_at_script(tx.outputs, own_hash)
      // C-TOP-ADDR-1 / C-TOP-REF-1 — cùng lý do với C-ACCT-ADDR-1/REF-1.
      expect acct_out.address == acct_in.address
      expect acct_out.reference_script == None

      expect InlineDatum(od) = acct_out.datum
      expect out_acct: FaucetAccount = od

      // ── C-TOP-DID-1: chủ DID phải có mặt ────────────────────────────────
      // Cùng khuôn với `Use`. C-TOP-5 đã khoá dòng tiền (không ai RÚT được tLAMP
      // của account khác), nhưng nhánh này còn GHI `last_claim_epoch` — và một
      // cổng chỉ canh tiền thì không canh mốc. Không có dòng này, bất kỳ ai cũng
      // tiêu được account UTxO của người khác bằng `TopUp`, tự bỏ `drip` tLAMP
      // của mình vào, và đẩy mốc cooldown của nạn nhân lên `now` (hoãn lần claim
      // kế tiếp thêm `cooldown_epochs` cửa sổ) cộng với hoãn `ReclaimIdle`. Hình
      // dạng tx khả thi: pool `Reclaim` + account `TopUp` — `Reclaim` chỉ đòi
      // đúng 1 account input, `lamp_out >= lamp_in` và bộ đếm bảo toàn, tất cả
      // đều thoả. Giá cho kẻ griefing = 1 phí tx + `drip`, nhắm vào người thật.
      // Chi phí thực tế của dòng này bằng 0: tx `ClaimAgain` ĐÃ phải mang DID NFT
      // (pool C-DID-1). Ghim bởi `topup_khong_did_nft` · `topup_griefing_hai_validator`.
      expect
        util.count_inputs_with_nft(tx.inputs, did_nft_policy, acct.did_name) >= 1

      // C-TOP-2
      expect out_acct.did_name == acct.did_name
      // C-TOP-6 / C-TOP-7: cả hai mốc về now (claim vừa xảy ra).
      expect out_acct.last_claim_epoch == now
      expect out_acct.last_touch_epoch == now
      // C-TOP-3 / C-TOP-4
      expect util.has_nft(acct_out, faucet_nft_policy, an)
      expect assets.quantity_of(tx.mint, faucet_nft_policy, an) == 0

      // ── C-TOP-POOL-1 + C-TOP-5 ──────────────────────────────────────────
      // Số tiền đọc từ datum của POOL input (định vị bằng POOL NFT ⇒ không ôm
      // hash pool ⇒ không vòng). KHÔNG để bên pool tự khai qua đường nào khác:
      // thiếu dòng này, một tx `pool.Reclaim` + `acct.TopUp` rút sạch tLAMP của
      // account mà KHÔNG cần DID NFT.
      expect
        util.count_inputs_with_nft(tx.inputs, faucet_nft_policy, pool_nft_name) == 1
      let pool_in = util.input_with_nft(tx.inputs, faucet_nft_policy, pool_nft_name)
      expect InlineDatum(pdr) = pool_in.datum
      expect pd: PoolDatum = pdr
      expect
        assets.quantity_of(acct_out.value, lamp_policy, lamp_name) == acct_lamp + pd.cfg.drip_oildrop
      True
    }

    // ── RECLAIM IDLE (permissionless) ────────────────────────────────────
    ReclaimIdle -> {
      // CỐ Ý dùng cận dưới ở nhánh này: người thu hồi lùi thời gian thì chỉ tự
      // mình không đủ điều kiện. Mọi nhánh khác dùng `get_epoch_pinned`.
      let now = util.get_epoch(tx, ms_per_epoch, window_origin_ms)

      // Idle đủ lâu, đọc mốc IDLE (không phải mốc cooldown).
      expect now >= acct.last_touch_epoch + reclaim_epochs_const

      // POOL phải có mặt trong tx (đúng 1 POOL input + 1 POOL output).
      expect
        util.count_inputs_with_nft(tx.inputs, faucet_nft_policy, pool_nft_name) == 1
      expect
        util.count_outputs_with_nft(tx.outputs, faucet_nft_policy, pool_nft_name) == 1
      let pool_in = util.input_with_nft(tx.inputs, faucet_nft_policy, pool_nft_name)
      let pool_out = util.output_with_nft(tx.outputs, faucet_nft_policy, pool_nft_name)

      // ── C-ACCT-POOLADDR-1: pool_out ở ĐÚNG địa chỉ của pool_in ───────────
      // KHÔNG trùng với `faucet_pool` C-POOL-OUT-1: dòng bên kia chỉ chạy khi
      // pool CÒN ở script pool. Nếu POOL NFT đã lạc ra ví, `faucet_pool.spend`
      // không được gọi và nhánh này là cổng DUY NHẤT còn đứng.
      // Ghim bởi `reclaim_idle_pool_to_wallet` · `reclaim_idle_pool_stake_hijack`.
      expect pool_out.address == pool_in.address

      // TOÀN BỘ tLAMP account PHẢI về pool. So DELTA (out − in) chứ không so
      // tuyệt đối → keeper không "đếm sẵn" tLAMP có trong pool để né.
      let pool_lamp_in = assets.quantity_of(pool_in.value, lamp_policy, lamp_name)
      let pool_lamp_out = assets.quantity_of(pool_out.value, lamp_policy, lamp_name)
      expect pool_lamp_out - pool_lamp_in >= acct_lamp

      // ── C-BURN-1: ACCT NFT PHẢI bị đốt ──────────────────────────────────
      // Không có dòng này, ACCT NFT ra khỏi script và thành vé tái dùng vĩnh
      // viễn: ai giữ nó dựng được một UTxO "account" ở ví với datum tự đặt.
      // Ghim bởi `reclaim_idle_khong_burn_acct` · `reclaim_idle_burn_name_khac`.
      expect assets.quantity_of(tx.mint, faucet_nft_policy, an) == -1
      True
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PHÂN VAI (không trùng kiểm):
//   - mint policy ép HÌNH DẠNG asset name ACCT (prefix + đúng 32 byte) và hình
//     dạng datum KHỞI TẠO của pool.
//   - `faucet_pool` ép name khớp DID (C-NAME-1) và mọi ràng buộc dòng tiền.
//
// MintAccount / BurnAccount: một policy chỉ có MỘT redeemer mint trong một tx
// (khoá redeemer là cặp (Mint, policyId)) ⇒ hai nhánh này không đứng chung tx,
// nên không ghép được một lượt đúc với một lượt đốt để ăn hai đầu.
pub fn nft_mint(
  genesis_ref: OutputReference,
  ms_per_epoch: Int,
  window_origin_ms: Int,
  redeemer: FaucetNftRedeemer,
  policy_id: PolicyId,
  tx: Transaction,
) -> Bool {
  let own_tokens = assets.tokens(tx.mint, policy_id)

  when redeemer is {
    // ── MintPool: one-shot POOL NFT + ép datum khởi tạo ──────────────────
    MintPool -> {
      // one-shot: consume genesis_ref → policy chạy tối đa 1 lần.
      expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })
      // ĐÚNG 1 loại asset của policy này (POOL), qty +1.
      expect dict.size(own_tokens) == 1
      expect assets.quantity_of(tx.mint, policy_id, pool_nft_name) == 1

      // ── C-MP-1..7 ──────────────────────────────────────────────────────
      // Sau tx này KHÔNG còn cổng nào ép được datum pool (C-CFG-1 đóng băng nó
      // vĩnh viễn, POOL NFT one-shot nên không đúc lại được), nên mọi ràng buộc
      // về trạng thái khởi tạo phải đứng ở ĐÂY. Bốn đường phá mà nhóm này đóng,
      // tất cả bất khả hồi: POOL NFT đúc thẳng vào ví (pool validator không bao
      // giờ chạy) · datum sai hình dạng (prelude của pool gãy với MỌI redeemer
      // ⇒ khoá chết toàn bộ tLAMP) · `window_epoch` khởi tạo ở quá khứ (mỗi
      // bucket chưa dùng là một quota cộng dồn) · một con số
      // `max_claims_per_window` gõ nhầm (trần tốc độ thành số trang trí).
      expect util.count_outputs_with_nft(tx.outputs, policy_id, pool_nft_name) == 1
      let pool_out = util.output_with_nft(tx.outputs, policy_id, pool_nft_name)
      // C-MP-1: không đúc vào ví. `faucet_nft` KHÔNG kiểm được pool_out đúng là
      // script pool — đó mới là vòng hash. `Script(_)` là mức chặt nhất đo được
      // ở đây; phần dư đóng bằng đối chiếu datum on-chain sau deploy.
      expect Script(_) = pool_out.address.payment_credential
      // C-MP-2: enterprise (không stake credential lạ).
      expect pool_out.address.stake_credential == None
      // C-MP-3: không script-carrier.
      expect pool_out.reference_script == None
      expect InlineDatum(d) = pool_out.datum
      // C-MP-4: datum parse được thành PoolDatum.
      expect pd: PoolDatum = d
      // C-MP-5: bộ đếm khởi tạo sạch.
      expect pd.claims_in_window == 0
      // C-MP-6: cửa sổ khởi tạo = bucket THẬT. Không có dòng này thì
      // `window_epoch = 0` (giá trị mặc định tự nhiên nhất khi viết builder)
      // cho sẵn hàng nghìn bậc thang quota dùng được ngay sau deploy.
      expect pd.window_epoch == util.get_epoch_pinned(tx, ms_per_epoch, window_origin_ms)
      expect pd.cfg.drip_oildrop > 0
      expect pd.cfg.cooldown_epochs >= 0
      expect pd.cfg.max_claims_per_window > 0
      // C-MP-7: trần compile-time.
      expect pd.cfg.max_claims_per_window <= max_claims_ceiling
      // ── C-MP-8: sổ `opened_root` khởi tạo phải RỖNG ─────────────────────
      // Đây là NEO của phép quy nạp giữ INV-ONE-ACCT. Không có dòng này, người
      // deploy đặt được một gốc bất kỳ: gốc của một cây do chính họ dựng cho
      // sẵn "đã có account" cho mọi DID họ chọn (khoá những DID đó khỏi faucet
      // vĩnh viễn, vì `ClaimOpen` đòi chứng minh VẮNG), hoặc một gốc rác 32 byte
      // không ứng với cây nào — lúc đó KHÔNG ai dựng nổi bằng chứng và cả
      // `ClaimOpen` lẫn `Reclaim` chết cùng lúc. POOL NFT one-shot ⇒ không đúc
      // lại được ⇒ cả hai đường đều bất khả hồi.
      expect pd.opened_root == empty_opened_root()
      True
    }

    // ── MintAccount: ủy quyền cho pool validator ─────────────────────────
    MintAccount -> {
      // tx phải có input mang POOL NFT → pool đang được spend → pool validator
      // đã chạy và kiểm soát toàn bộ ràng buộc account.
      expect util.count_inputs_with_nft(tx.inputs, policy_id, pool_nft_name) >= 1
      // KHÔNG đụng POOL NFT trong mint (pool NFT chỉ luân chuyển, bất biến).
      expect assets.quantity_of(tx.mint, policy_id, pool_nft_name) == 0
      // C-MA-1: đúng MỘT asset name của policy này trong tx.
      expect dict.size(own_tokens) == 1
      expect [Pair(name, qty)] = dict.to_pairs(own_tokens)
      // C-MA-2: đúng 1 đơn vị (`dict.size == 1` nói "một TÊN", không nói "một
      // token" — số lượng nằm ở GIÁ TRỊ của cặp).
      expect qty == 1
      // C-MA-3/4: hình dạng name = prefix "ACCT" + 28 byte hash = 32 byte.
      expect bytearray.take(name, 4) == acct_name_prefix
      expect bytearray.length(name) == 32
      True
    }

    // ── BurnAccount: đốt ACCT NFT khi thu hồi account ─────────────────────
    BurnAccount -> {
      expect dict.size(own_tokens) == 1
      expect [Pair(name, qty)] = dict.to_pairs(own_tokens)
      // C-MB-1: đúng 1 đơn vị bị đốt.
      expect qty == -1
      // C-MB-2/3: prefix + độ dài. POOL name dài 4 byte ⇒ không burn POOL NFT
      // qua nhánh này được.
      expect bytearray.take(name, 4) == acct_name_prefix
      expect bytearray.length(name) == 32
      True
    }
  }
}
