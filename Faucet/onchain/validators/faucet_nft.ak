// faucet_nft — minting policy đúc POOL NFT (one-shot) + ACCT NFT (theo claim),
// và đốt ACCT NFT (theo thu hồi).
//
// ─────────────────────────────────────────────────────────────────────────
// VÌ SAO 1 POLICY 2 LOẠI TOKEN (POOL + ACCT)?
//   Pool validator nhận diện account qua "ACCT NFT cùng faucet_nft_policy".
//   Account validator nhận diện pool qua "POOL NFT cùng faucet_nft_policy".
//   Dùng CHUNG 1 policy id → cả hai chỉ cần 1 param `faucet_nft_policy` (tính từ
//   genesis_ref ở deploy) → không bên nào ôm script-hash bên kia.
//
// PHÂN VAI (không trùng kiểm):
//   - mint policy ép HÌNH DẠNG asset name ACCT (prefix + đúng 32 byte) và hình
//     dạng datum KHỞI TẠO của pool.
//   - `faucet_pool` ép name khớp DID (C-NAME-1) và mọi ràng buộc dòng tiền.
//
// MintPool (one-shot) — xem C-MP-1..7 trong thân hàm. Đây là cổng DUY NHẤT còn
// tồn tại để ép trạng thái khởi tạo của pool: sau tx này `faucet_pool` C-CFG-1
// đóng băng `cfg` vĩnh viễn (POOL NFT one-shot ⇒ không đúc lại datum được).
//
// MintAccount / BurnAccount: một policy chỉ có MỘT redeemer mint trong một tx
// (khoá redeemer là cặp (Mint, policyId)) ⇒ hai nhánh này không đứng chung tx,
// nên không ghép được một lượt đúc với một lượt đốt để ăn hai đầu.

// THÂN của handler nằm ở `lib/magiclamp/faucet/handlers.ak` → `nft_mint` (kèm
// toàn bộ chốt C-MP-* / C-MA-* / C-MB-*). Lý do tách: Aiken không xuất handler
// của validator ra ngoài module, mà lớp ca kiểm "hai validator một tx" bắt buộc
// phải gọi được nó từ `faucet_pool.ak`. Xem đầu `handlers.ak`.

use aiken/interval
use aiken/merkle_patricia_forestry as mpf
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use magiclamp/faucet/handlers
use magiclamp/faucet/ledger.{
  BurnAccount, FaucetConfig, FaucetNftRedeemer, MintAccount, MintPool, PoolDatum,
  did_key, did_leaf_value, empty_opened_root, max_claims_ceiling, pool_nft_name,
}
use magiclamp/faucet/util
use magiclamp/faucet/window_origin_fixtures

validator faucet_nft(
  genesis_ref: OutputReference,
  ms_per_epoch: Int,
  // THÊM 2026-10-02 (Specs/Window/CONTRACT.md v1.0, WIN-ORIGIN-3) — ĐẶT CUỐI theo khuôn các
  // tham số đã thêm trước. Gốc lưới cửa sổ: cửa sổ = (t − window_origin_ms) / ms_per_epoch,
  // nên chỉ số cửa sổ = số epoch Cardano của mạng. Đổi hash validator này.
  window_origin_ms: Int,
) {
  mint(redeemer: FaucetNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    handlers.nft_mint(genesis_ref, ms_per_epoch, window_origin_ms, redeemer, policy_id, tx)
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const fn_policy: PolicyId = #"facef00d"

const fn_ms_per_epoch: Int = 432_000_000

const fn_pool_sh: ByteArray = #"facade"

const fn_now: Int = 4143

/// ACCT name hợp lệ: prefix 4B + 28B = 32 byte.
const fn_acct_name: ByteArray =
  #"41434354aabbccddeeff00112233445566778899aabbccddeeff001122334455"

fn fn_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 5 }
}

fn fn_genesis_input() -> Input {
  util.mk_input(
    fn_genesis_ref(),
    util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
  )
}

fn fn_other_input() -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
  )
}

/// Input mang POOL NFT (pool đang spend).
fn fn_pool_input() -> Input {
  let v = assets.from_lovelace(5_000_000) |> assets.add(fn_policy, pool_nft_name, 1)
  util.mk_input(util.mk_ref(1), util.mk_output_no_datum(util.vk_address(#"b0"), v))
}

fn fn_mint(name: ByteArray, qty: Int) -> Value {
  assets.zero |> assets.add(fn_policy, name, qty)
}

fn fn_cfg(max_claims: Int) -> FaucetConfig {
  FaucetConfig {
    drip_oildrop: 1_001_000_000,
    cooldown_epochs: 36,
    max_claims_per_window: max_claims,
  }
}

fn fn_pool_datum_root(
  max_claims: Int,
  window: Int,
  claims: Int,
  root: ByteArray,
) -> PoolDatum {
  PoolDatum {
    cfg: fn_cfg(max_claims),
    window_epoch: window,
    claims_in_window: claims,
    opened_root: root,
  }
}

/// Datum khởi tạo HỢP LỆ: sổ `opened_root` RỖNG (C-MP-8).
fn fn_pool_datum(max_claims: Int, window: Int, claims: Int) -> PoolDatum {
  fn_pool_datum_root(max_claims, window, claims, empty_opened_root())
}

fn fn_pool_val() -> Value {
  assets.from_lovelace(10_000_000) |> assets.add(fn_policy, pool_nft_name, 1)
}

/// validity range NEO: cả hai cận trong CÙNG bucket `epoch`.
fn fn_tx_at(epoch: Int, base: Transaction) -> Transaction {
  let lo = epoch * fn_ms_per_epoch
  Transaction {
    ..base,
    validity_range: interval.between(lo, lo + fn_ms_per_epoch - 1),
  }
}

/// tx MintPool chuẩn, pool_out dựng từ tham số — mọi ca âm dưới đây đổi ĐÚNG
/// một thứ so với ca dương `mint_pool_happy`.
fn fn_mintpool_tx(pool_out: Output) -> Transaction {
  fn_tx_at(
    fn_now,
    Transaction {
      ..placeholder,
      inputs: [fn_other_input(), fn_genesis_input()],
      outputs: [pool_out],
      mint: fn_mint(pool_nft_name, 1),
    },
  )
}

fn fn_pool_out_ok() -> Output {
  util.mk_output(
    util.script_address(fn_pool_sh),
    fn_pool_val(),
    fn_pool_datum(20, fn_now, 0),
  )
}

test mint_pool_happy() {
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(fn_pool_out_ok()),
  )
}

test mint_pool_without_genesis() fail {
  // KHÔNG consume genesis → one-shot reject.
  let tx =
    fn_tx_at(
      fn_now,
      Transaction {
        ..placeholder,
        inputs: [fn_other_input()],
        outputs: [fn_pool_out_ok()],
        mint: fn_mint(pool_nft_name, 1),
      },
    )
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, MintPool, fn_policy, tx)
}

test mint_pool_wrong_qty() fail {
  // mint 2 POOL → reject (one-shot supply = 1).
  let tx =
    fn_tx_at(
      fn_now,
      Transaction {
        ..placeholder,
        inputs: [fn_genesis_input()],
        outputs: [fn_pool_out_ok()],
        mint: fn_mint(pool_nft_name, 2),
      },
    )
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, MintPool, fn_policy, tx)
}

test mint_pool_with_extra_acct() fail {
  // deploy mà đúc kèm ACCT → dict.size == 2 → reject.
  let mint =
    assets.zero
      |> assets.add(fn_policy, pool_nft_name, 1)
      |> assets.add(fn_policy, fn_acct_name, 1)
  let tx =
    fn_tx_at(
      fn_now,
      Transaction {
        ..placeholder,
        inputs: [fn_genesis_input()],
        outputs: [fn_pool_out_ok()],
        mint: mint,
      },
    )
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, MintPool, fn_policy, tx)
}

/// C-MP-1: POOL NFT đúc thẳng vào VÍ ⇒ `faucet_pool.spend` không bao giờ chạy.
test mintpool_nft_vao_vi() fail {
  let pool_out =
    util.mk_output(
      util.vk_address(#"a77ac6"),
      fn_pool_val(),
      fn_pool_datum(20, fn_now, 0),
    )
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(pool_out),
  )
}

/// C-MP-2: cùng script hash, khác stake credential.
test mintpool_stake_credential() fail {
  let pool_out =
    util.mk_output(
      util.script_address_staked(fn_pool_sh, #"a77ac6"),
      fn_pool_val(),
      fn_pool_datum(20, fn_now, 0),
    )
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(pool_out),
  )
}

/// C-MP-3: pool khởi tạo mang reference script.
test mintpool_script_carrier() fail {
  let pool_out =
    util.mk_output_with_ref_script(
      util.script_address(fn_pool_sh),
      fn_pool_val(),
      fn_pool_datum(20, fn_now, 0),
      #"beef",
    )
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(pool_out),
  )
}

/// C-MP-4: datum không parse được thành PoolDatum (ở đây: NoDatum).
test mintpool_khong_datum() fail {
  let pool_out =
    util.mk_output_no_datum(util.script_address(fn_pool_sh), fn_pool_val())
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(pool_out),
  )
}

/// C-MP-5: bộ đếm khởi tạo khác 0.
test mintpool_claims_khac_0() fail {
  let pool_out =
    util.mk_output(
      util.script_address(fn_pool_sh),
      fn_pool_val(),
      fn_pool_datum(20, fn_now, 3),
    )
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(pool_out),
  )
}

/// C-MP-6: `window_epoch` khởi tạo = 0 (mặc định tự nhiên của builder) trong khi
/// bucket thật là 4143 ⇒ 4143 bậc thang quota dùng được ngay sau deploy.
test mintpool_window_khong_phai_now() fail {
  let pool_out =
    util.mk_output(
      util.script_address(fn_pool_sh),
      fn_pool_val(),
      fn_pool_datum(20, 0, 0),
    )
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(pool_out),
  )
}

/// C-MP-7: một con số gõ nhầm vượt trần compile-time.
test mintpool_max_vuot_tran() fail {
  let pool_out =
    util.mk_output(
      util.script_address(fn_pool_sh),
      fn_pool_val(),
      fn_pool_datum(max_claims_ceiling + 1, fn_now, 0),
    )
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(pool_out),
  )
}

/// Ca dương song sinh của `mintpool_max_vuot_tran`: đúng TRẦN thì phải xanh.
test mintpool_max_bang_tran() {
  let pool_out =
    util.mk_output(
      util.script_address(fn_pool_sh),
      fn_pool_val(),
      fn_pool_datum(max_claims_ceiling, fn_now, 0),
    )
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(pool_out),
  )
}

/// `max_claims_per_window == 0` ở deploy ⇒ prelude của pool gãy với MỌI redeemer
/// ⇒ khoá chết toàn bộ tLAMP. Phải chặn ngay tại cổng đúc.
test mintpool_max_bang_0() fail {
  let pool_out =
    util.mk_output(
      util.script_address(fn_pool_sh),
      fn_pool_val(),
      fn_pool_datum(0, fn_now, 0),
    )
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(pool_out),
  )
}

// ── MintAccount ──────────────────────────────────────────────────

test mint_account_name_dung_32b() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [fn_pool_input()],
      mint: fn_mint(fn_acct_name, 1),
    }
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, MintAccount, fn_policy, tx)
}

test mint_account_no_pool_input() fail {
  // đúc ACCT mà KHÔNG có POOL NFT input → không ai ủy quyền → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [fn_other_input()],
      mint: fn_mint(fn_acct_name, 1),
    }
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, MintAccount, fn_policy, tx)
}

test mint_account_touches_pool_nft() fail {
  // mưu toan đúc thêm POOL NFT qua MintAccount → quantity_of(POOL)≠0 → reject.
  let mint =
    assets.zero
      |> assets.add(fn_policy, fn_acct_name, 1)
      |> assets.add(fn_policy, pool_nft_name, 1)
  let tx = Transaction { ..placeholder, inputs: [fn_pool_input()], mint: mint }
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, MintAccount, fn_policy, tx)
}

test mint_account_name_thieu_prefix() fail {
  let bad = #"deadbeefaabbccddeeff00112233445566778899aabbccddeeff001122334455"
  let tx =
    Transaction { ..placeholder, inputs: [fn_pool_input()], mint: fn_mint(bad, 1) }
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, MintAccount, fn_policy, tx)
}

test mint_account_name_31b() fail {
  let bad = #"41434354aabbccddeeff00112233445566778899aabbccddeeff0011223344"
  let tx =
    Transaction { ..placeholder, inputs: [fn_pool_input()], mint: fn_mint(bad, 1) }
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, MintAccount, fn_policy, tx)
}

test mint_account_qty_2() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [fn_pool_input()],
      mint: fn_mint(fn_acct_name, 2),
    }
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, MintAccount, fn_policy, tx)
}

test mint_account_hai_name() fail {
  // C-MA-1: hai ACCT name trong một tx đúc.
  let other = #"41434354ffeeddccbbaa00112233445566778899aabbccddeeff001122334455"
  let mint =
    assets.zero
      |> assets.add(fn_policy, fn_acct_name, 1)
      |> assets.add(fn_policy, other, 1)
  let tx = Transaction { ..placeholder, inputs: [fn_pool_input()], mint: mint }
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, MintAccount, fn_policy, tx)
}

// ── BurnAccount ──────────────────────────────────────────────────

test burn_account_happy() {
  let tx = Transaction { ..placeholder, mint: fn_mint(fn_acct_name, -1) }
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, BurnAccount, fn_policy, tx)
}

test burn_account_qty_minus_2() fail {
  let tx = Transaction { ..placeholder, mint: fn_mint(fn_acct_name, -2) }
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, BurnAccount, fn_policy, tx)
}

/// Đốt POOL NFT trá hình qua nhánh BurnAccount: POOL name dài 4 byte ⇒ gãy ở
/// prefix + độ dài.
test burn_account_lan_prefix_pool() fail {
  let tx = Transaction { ..placeholder, mint: fn_mint(pool_nft_name, -1) }
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, BurnAccount, fn_policy, tx)
}

/// Đúc (qty +1) qua nhánh BurnAccount → C-MB-1.
test burn_account_qty_duong() fail {
  let tx = Transaction { ..placeholder, mint: fn_mint(fn_acct_name, 1) }
  faucet_nft.mint(fn_genesis_ref(), fn_ms_per_epoch, 0, BurnAccount, fn_policy, tx)
}

// ── C-MP-8: sổ `opened_root` khởi tạo phải RỖNG ──────────────────
// `mint_pool_happy` là cực XANH (nó dùng `fn_pool_datum`, đã mang gốc rỗng). Hai ca
// dưới đây là hai cực ĐỎ của hai đường phá KHÁC NHAU — gộp làm một ca sẽ bỏ mất
// một đường, vì chúng hỏng theo hai chiều ngược nhau.

/// Deploy với sổ đã cài sẵn khoá của một DID: DID đó bị khoá khỏi faucet VĨNH VIỄN
/// (`ClaimOpen` đòi chứng minh VẮNG, không bao giờ thoả), và không ai nhìn datum mà
/// biết được — 32 byte nào cũng "trông đúng".
test mintpool_goc_khong_rong() fail {
  let root =
    mpf.insert(mpf.empty, did_key(#"a11ce0"), did_leaf_value, []) |> mpf.root
  let pool_out =
    util.mk_output(
      util.script_address(fn_pool_sh),
      fn_pool_val(),
      fn_pool_datum_root(20, fn_now, 0, root),
    )
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(pool_out),
  )
}

/// Deploy với 32 byte RÁC không ứng với cây nào: từ đó không ai dựng nổi bằng chứng,
/// nên CẢ `ClaimOpen` LẪN `Reclaim` chết cùng lúc. POOL NFT one-shot ⇒ không đúc lại
/// được ⇒ toàn bộ tLAMP trong pool kẹt vĩnh viễn.
test mintpool_goc_rac() fail {
  let pool_out =
    util.mk_output(
      util.script_address(fn_pool_sh),
      fn_pool_val(),
      fn_pool_datum_root(
        20,
        fn_now,
        0,
        #"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      ),
    )
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    fn_mintpool_tx(pool_out),
  )
}

// ── Gốc cửa sổ (Specs/Window/CONTRACT.md v1.0, WIN-ORIGIN-1..3) ─────────────────
/// `mint_pool_happy` dời sang gốc Mainnet: phải xanh như bản gốc 0.
test mint_pool_happy_origin_mainnet() {
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    window_origin_fixtures.mainnet_origin_ms,
    MintPool,
    fn_policy,
    window_origin_fixtures.shift_tx(fn_mintpool_tx(fn_pool_out_ok()), window_origin_fixtures.mainnet_origin_ms),
  )
}

/// `mint_pool_happy` dời sang gốc Preprod: phải xanh như bản gốc 0.
test mint_pool_happy_origin_preprod() {
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    window_origin_fixtures.preprod_origin_ms,
    MintPool,
    fn_policy,
    window_origin_fixtures.shift_tx(fn_mintpool_tx(fn_pool_out_ok()), window_origin_fixtures.preprod_origin_ms),
  )
}

/// Ca âm: tx đã dời sang lưới Mainnet nhưng validator nhận gốc 0 ⇒ phải bị chặn.
test mint_pool_happy_origin_forgotten() fail {
  faucet_nft.mint(
    fn_genesis_ref(),
    fn_ms_per_epoch,
    0,
    MintPool,
    fn_policy,
    window_origin_fixtures.shift_tx(fn_mintpool_tx(fn_pool_out_ok()), window_origin_fixtures.mainnet_origin_ms),
  )
}
