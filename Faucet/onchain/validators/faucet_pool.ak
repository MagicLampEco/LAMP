// faucet_pool — UTxO kho tLAMP + POOL NFT. Self-serve, DID-gated, rate-limited.
//
// ─────────────────────────────────────────────────────────────────────────
// PARAM
//   faucet_nft_policy   : policy id đúc POOL + ACCT NFT.
//   did_nft_policy      : policy id của DID NFT (testnet: DID test; mainnet: PhoenixKey).
//   lamp_policy         : policy id tLAMP.
//   lamp_name           : asset name tLAMP.
//   ms_per_epoch        : ms mỗi cửa sổ.
//   account_script_hash : script hash của `faucet_account` — nơi DUY NHẤT một
//                         account được nằm.
//
// VÌ SAO `account_script_hash` LÀ PARAM CHỨ KHÔNG PHẢI TRƯỜNG DATUM: đặt trong
// datum thì cổng duy nhất kiểm được nó là "đúng 28 byte" — một phép kiểm ĐỘ DÀI
// đứng thay cho phép kiểm ĐỊNH DANH. Một hash đủ 28 byte nhưng sai làm mọi drip
// rót vào địa chỉ không có script: không nhánh nào tiêu lại được, mất vĩnh viễn,
// và mọi kiểm tra on-chain vẫn xanh. Là param thì nó ĐÚNG script hay không là
// chuyện quyết ở lúc biên dịch, không quyết ở lúc gõ datum. Không sinh vòng:
// `faucet_account` nhận diện pool bằng POOL NFT, không ôm hash pool.
//
// ─────────────────────────────────────────────────────────────────────────
// BẤT BIẾN CHUNG cho MỌI redeemer (chạy trước when redeemer):
//   C-POOL-IN-1   POOL NFT input ở CHÍNH script đang chạy (own_addr == pool_in.address).
//   C-POOL-OUT-1  pool_out ở ĐÚNG ĐỊA CHỈ ĐẦY ĐỦ của pool_in.
//   C-POOL-OUT-2  pool_out.reference_script == None (không script-carrier).
//   C-CFG-1       out_pd.cfg == cfg (đóng băng cấu hình vĩnh viễn).
//   C-CFG-2/3     hằng hợp lệ.
//
// HAI TẦNG RATE-LIMIT, mục tiêu KHÁC NHAU — đừng đọc tầng (b) rộng hơn nó làm:
//   (a) TRẦN TỐC ĐỘ TOÀN CỤC — `PoolDatum{window_epoch, claims_in_window}` +
//       `cfg.max_claims_per_window`. Cưỡng chế CỨNG, không phụ thuộc số DID.
//       Đây là chốt DUY NHẤT chặn vét pool; `tlamp_policy` one-shot nên pool cạn
//       là bất khả hồi.
//   (b) COOLDOWN — `cfg.cooldown_epochs` giữa hai claim của cùng MỘT CHUỖI
//       ACCOUNT (`ClaimAgain`). Nó KHÔNG giới hạn số account mà một `did_name`
//       mở được, nên một DID chiếm được trọn quota của tầng (a) trong một cửa
//       sổ. Tầng (b) là tiện lợi kế toán, KHÔNG phải cơ chế công bằng.
//       Điểm treo: `[FAUCET-ACCT-UNIQUE]`.
//
// BỐN REDEEMER:
//   ClaimOpen  — mở account MỚI: đúc ACCT NFT, 0 account input.
//   ClaimAgain — nạp thêm drip vào account đã có: 1 account input, ép cooldown.
//   Reclaim    — nhận tLAMP từ account idle. ĐÒI đúng 1 account input (C-RECL-0):
//                không có dòng đó thì đây là cửa spend RỖNG permissionless trên
//                một singleton, tức DoS toàn phần giá một phí tx, và nó nuôi bậc
//                thang quota bằng cách giữ `window_epoch` đứng im.
//   TopUpPool  — nạp tLAMP vào pool (ops/deploy). Cấm account input, đòi nạp thật.

use aiken/interval
use cardano/assets
use cardano/transaction.{InlineDatum, Input, Output, OutputReference,
  Transaction, placeholder}
use magiclamp/faucet/ledger.{
  AccountRedeemer, ClaimAgain, ClaimOpen, FaucetAccount, FaucetConfig,
  MintAccount, PoolDatum, PoolRedeemer, Reclaim, ReclaimIdle, TopUp, TopUpPool,
  Use, acct_name, pool_nft_name,
}
use magiclamp/faucet/util

// Import dưới CHỈ phục vụ khối ca kiểm "HAI VALIDATOR MỘT TX" ở cuối tệp.
// Không có lớp ca đó thì cả một họ lỗi vô hình với bộ kiểm: hai validator đòi
// hai điều TRÁI NHAU trên cùng một giao dịch, mà mỗi bài đơn vị vẫn xanh đúng
// tên nó. `handlers` giữ THÂN của `faucet_account.spend` và `faucet_nft.mint`
// vì Aiken không xuất handler của validator ra ngoài module — xem `handlers.ak`.
use magiclamp/faucet/handlers

validator faucet_pool(
  faucet_nft_policy: ByteArray,
  did_nft_policy: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
  ms_per_epoch: Int,
  account_script_hash: ByteArray,
) {
  spend(
    datum_opt: Option<PoolDatum>,
    redeemer: PoolRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(pd) = datum_opt
    let cfg = pd.cfg

    // ── Bất biến chung: đúng 1 POOL input + 1 POOL output ─────────────────
    expect
      util.count_inputs_with_nft(tx.inputs, faucet_nft_policy, pool_nft_name) == 1
    expect
      util.count_outputs_with_nft(tx.outputs, faucet_nft_policy, pool_nft_name) == 1

    let pool_in = util.input_with_nft(tx.inputs, faucet_nft_policy, pool_nft_name)
    let pool_out = util.output_with_nft(tx.outputs, faucet_nft_policy, pool_nft_name)

    // ── C-POOL-IN-1: POOL NFT input phải ở CHÍNH script đang chạy ─────────
    // own_addr do LEDGER cấp ⇒ không giả được. Không có dòng này, nếu POOL NFT
    // nằm ở ví thì cặp (pool_in, pool_out) neo vào cái ví đó và mọi ràng buộc
    // địa chỉ bên dưới suy biến thành "ví == ví".
    // Ghim bởi `poc_pool_nft_input_not_at_own_script`.
    let own_addr = util.own_address(own_ref, tx.inputs)
    expect own_addr == pool_in.address

    // ── C-POOL-OUT-1: pool_out ở ĐÚNG địa chỉ của pool_in ─────────────────
    // `output_with_nft` định vị pool_out THUẦN bằng POOL NFT — nó không nói gì
    // về nơi đến. So ĐỊA CHỈ ĐẦY ĐỦ chứ không chỉ payment credential: cùng
    // script hash + khác stake credential là hai Address khác nhau nhưng CÙNG
    // validator. POOL NFT one-shot ⇒ gửi nhầm chỗ = giết kho vĩnh viễn.
    // Ghim bởi `poc_reclaim_pool_to_wallet` · `poc_claim_pool_to_wallet` ·
    // `poc_reclaim_pool_stake_hijack`.
    expect pool_out.address == pool_in.address

    // ── C-POOL-OUT-2: pool KHÔNG biến thành script-carrier ────────────────
    // Ghim bởi `poc_reclaim_pool_script_carrier`.
    expect pool_out.reference_script == None

    expect InlineDatum(od) = pool_out.datum
    expect out_pd: PoolDatum = od
    // C-CFG-1: cấu hình bất biến. MỘT đẳng thức, không nới thành nhiều dòng.
    expect out_pd.cfg == cfg

    // C-CFG-2 / C-CFG-3: hằng hợp lệ. Cả hai nằm ở prelude nên chúng gãy với
    // MỌI redeemer — đó là lý do `MintPool` phải ép chúng ngay lúc đúc
    // (C-MP-7 và bạn bè): một datum khởi tạo sai khoá chết toàn bộ tLAMP.
    expect cfg.drip_oildrop > 0
    expect cfg.cooldown_epochs >= 0
    expect cfg.max_claims_per_window > 0

    when redeemer is {
      // ── CLAIM OPEN: mở account MỚI ─────────────────────────────────────
      ClaimOpen -> {
        let ctx =
          check_claim(
            tx,
            pd,
            out_pd,
            pool_in,
            pool_out,
            faucet_nft_policy,
            did_nft_policy,
            lamp_policy,
            lamp_name,
            ms_per_epoch,
            account_script_hash,
          )
        // C-OPEN-1: đúc đúng ACCT NFT của DID này.
        expect assets.quantity_of(tx.mint, faucet_nft_policy, ctx.an) == 1
        // C-OPEN-2: KHÔNG có account input — `ClaimOpen` là đường mở mới.
        expect util.count_inputs_at_script(tx.inputs, account_script_hash) == 0
        // C-OPEN-3: account mới nhận ĐÚNG drip.
        expect
          assets.quantity_of(ctx.acct_out.value, lamp_policy, lamp_name) == cfg.drip_oildrop
        True
      }

      // ── CLAIM AGAIN: nạp thêm drip vào account đã có ────────────────────
      ClaimAgain -> {
        let ctx =
          check_claim(
            tx,
            pd,
            out_pd,
            pool_in,
            pool_out,
            faucet_nft_policy,
            did_nft_policy,
            lamp_policy,
            lamp_name,
            ms_per_epoch,
            account_script_hash,
          )
        // C-AGAIN-1: không đúc thêm ACCT NFT (chuỗi account cũ đi tiếp).
        expect assets.quantity_of(tx.mint, faucet_nft_policy, ctx.an) == 0
        // ── C-AGAIN-2: đúng 1 account input ────────────────────────────────
        // Đây là chốt làm cooldown có nghĩa. Không có nó, kẻ xấu chỉ cần KHÔNG
        // đưa account cũ vào input là cooldown biến mất.
        expect util.count_inputs_at_script(tx.inputs, account_script_hash) == 1
        let acct_in = util.input_at_script(tx.inputs, account_script_hash)
        // C-AGAIN-3: account input mang ĐÚNG ACCT NFT của DID này.
        expect util.has_nft(acct_in, faucet_nft_policy, ctx.an)
        expect InlineDatum(aid) = acct_in.datum
        expect old: FaucetAccount = aid
        // C-AGAIN-4
        expect old.did_name == ctx.acct.did_name
        // C-COOL-1: đọc mốc COOLDOWN (không phải mốc idle).
        expect ctx.now >= old.last_claim_epoch + cfg.cooldown_epochs
        // C-AGAIN-5: account CỘNG THÊM đúng drip, không bỏ rơi số cũ.
        expect
          assets.quantity_of(ctx.acct_out.value, lamp_policy, lamp_name) == assets.quantity_of(
            acct_in.value,
            lamp_policy,
            lamp_name,
          ) + cfg.drip_oildrop
        True
      }

      // ── RECLAIM (nhận tLAMP từ account idle) ───────────────────────────
      Reclaim -> {
        // ── C-RECL-0: đang THU HỒI một account, không phải spend rỗng ──────
        // Ghim bởi `reclaim_spend_rong`.
        expect util.count_inputs_at_script(tx.inputs, account_script_hash) == 1

        let lamp_in = assets.quantity_of(pool_in.value, lamp_policy, lamp_name)
        let lamp_out = assets.quantity_of(pool_out.value, lamp_policy, lamp_name)
        expect lamp_out >= lamp_in
        expect
          pool_out.value == assets.add(
            pool_in.value,
            lamp_policy,
            lamp_name,
            lamp_out - lamp_in,
          )
        // ── C-RECL-1 / C-RECL-2: bộ đếm tốc độ BẢO TOÀN ────────────────────
        // Không có hai dòng này, xen một `Reclaim` reset bộ đếm miễn phí và
        // trần tốc độ — chốt duy nhất chặn vét pool — thành vô hiệu.
        // Ghim bởi `reclaim_doi_window` · `reclaim_reset_bo_dem`.
        expect out_pd.window_epoch == pd.window_epoch
        expect out_pd.claims_in_window == pd.claims_in_window
        True
      }

      // ── TOPUPPOOL (nạp tLAMP vào pool) ─────────────────────────────────
      TopUpPool -> {
        // Tách khỏi `Reclaim`: hai ý định khác nhau, và cả hai phải tốn thứ gì
        // đó. Cấm account input để nhánh này không mượn đường thu hồi.
        expect util.count_inputs_at_script(tx.inputs, account_script_hash) == 0
        let lamp_in = assets.quantity_of(pool_in.value, lamp_policy, lamp_name)
        let lamp_out = assets.quantity_of(pool_out.value, lamp_policy, lamp_name)
        // C-TUP-1: nạp THẬT, không phải spend rỗng.
        expect lamp_out - lamp_in >= cfg.drip_oildrop
        expect
          pool_out.value == assets.add(
            pool_in.value,
            lamp_policy,
            lamp_name,
            lamp_out - lamp_in,
          )
        // C-TUP-2 / C-TUP-3: nạp tiền KHÔNG được đụng bộ đếm tốc độ.
        expect out_pd.window_epoch == pd.window_epoch
        expect out_pd.claims_in_window == pd.claims_in_window
        True
      }
    }
  }

  else(_) {
    fail
  }
}

/// Những gì `ClaimOpen` và `ClaimAgain` kiểm GIỐNG NHAU, trả về phần hai nhánh
/// còn dùng tiếp. Gộp một chỗ để hai nhánh không trôi khỏi nhau qua các lần sửa.
type ClaimCtx {
  now: Int,
  acct_out: Output,
  acct: FaucetAccount,
  an: ByteArray,
}

fn check_claim(
  tx: Transaction,
  pd: PoolDatum,
  out_pd: PoolDatum,
  pool_in: Output,
  pool_out: Output,
  faucet_nft_policy: ByteArray,
  did_nft_policy: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
  ms_per_epoch: Int,
  account_script_hash: ByteArray,
) -> ClaimCtx {
  let cfg = pd.cfg

  // ── C-RATE-0: `now` NEO VÀO THỜI GIAN THẬT ──────────────────────────────
  // `get_epoch` (cận dưới) KHÔNG dùng được ở đây. Cận dưới do người dựng tx đặt
  // và ledger chỉ đòi `lower_bound ≤ slot hiện tại` ⇒ `now` đặt nhỏ tuỳ ý. Với
  // `now` lùi được, mỗi bucket quá khứ là một quota mới: chuỗi tx nối nhau trong
  // CÙNG một cửa sổ thật leo thang theo bậc thang và vượt trần tuyệt đối. Cùng
  // một trường đó cũng vô hiệu cooldown, vì account sinh ra đã mang mốc quá khứ.
  // Ghim bởi `rate_upper_bound_vo_han` · `rate_leo_thang_bac_thang`.
  let now = util.get_epoch_pinned(tx, ms_per_epoch)

  // C-RATE-1: cửa sổ đơn điệu (chỉ chặn chiều lùi SO VỚI DATUM; chiều lùi so
  // với thời gian thật do C-RATE-0 chặn).
  expect now >= pd.window_epoch
  let used =
    if now == pd.window_epoch {
      pd.claims_in_window
    } else {
      0
    }
  // C-RATE-2: trần tốc độ.
  expect used + 1 <= cfg.max_claims_per_window
  // C-RATE-3 / C-RATE-4: bộ đếm tiến đúng một bước, cửa sổ ghi đúng now.
  expect out_pd.window_epoch == now
  expect out_pd.claims_in_window == used + 1

  // C-DRIP-1: pool.value = pool_in − drip tLAMP (giữ POOL NFT + ADA + mọi asset
  // khác). Đẳng thức value, không phải bất đẳng thức trên một asset.
  expect
    pool_out.value == assets.add(
      pool_in.value,
      lamp_policy,
      lamp_name,
      -cfg.drip_oildrop,
    )

  // ── C-ACCTOUT-1..3: drip đi đúng ĐỊA CHỈ, và địa chỉ đó có script ────────
  // Không ghim thì account đặt được ở ví: né cooldown, VÀ `ReclaimIdle` không
  // bao giờ chạm được số tLAMP đó ⇒ pool cạn một chiều. `tlamp_policy` one-shot
  // nên không mint lại được.
  // Ghim bởi `claim_acct_out_ra_vi` · `claim_acct_out_script_khac` ·
  // `claim_acct_out_stake_hijack` · `claim_acct_out_script_carrier`.
  expect util.count_outputs_at_script(tx.outputs, account_script_hash) == 1
  let acct_out = util.output_at_script(tx.outputs, account_script_hash)
  expect acct_out.address == util.script_address(account_script_hash)
  expect acct_out.reference_script == None

  expect InlineDatum(ad) = acct_out.datum
  expect acct: FaucetAccount = ad
  // C-ACCTOUT-4 / C-ACCTOUT-5: cả hai mốc về now.
  expect acct.last_claim_epoch == now
  expect acct.last_touch_epoch == now

  // ── C-NAME-1 / C-NAME-2: ACCT NFT neo vào ĐÚNG DID, và chỉ MỘT bản ──────
  let an = acct_name(acct.did_name)
  expect util.has_nft(acct_out, faucet_nft_policy, an)
  expect util.count_outputs_with_nft(tx.outputs, faucet_nft_policy, an) == 1

  // C-DID-1: tx có input mang DID NFT khớp `did_name` của account.
  expect util.count_inputs_with_nft(tx.inputs, did_nft_policy, acct.did_name) >= 1

  ClaimCtx { now, acct_out, acct, an }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const fp_nft_policy: ByteArray = #"facade01"

const fp_did_policy: ByteArray = #"d1dd1d"

const fp_lamp_policy: ByteArray = #"1a3b"

const fp_lamp_name: ByteArray = #"744c414d50"

const fp_pool_sh: ByteArray = #"facade"

const fp_acct_sh: ByteArray = #"acc0"

const fp_ms_per_epoch: Int = 432_000_000

const fp_drip: Int = 1_001_000_000

const fp_cooldown: Int = 36

const fp_max_claims: Int = 20

const fp_did_name: ByteArray = #"a11ce0"

const fp_other_did: ByteArray = #"b0b0b0"

const fp_thief_pkh: ByteArray = #"a77ac6"

const fp_pool_lamp: Int = 5_000_000_000

fn fp_cfg() -> FaucetConfig {
  FaucetConfig {
    drip_oildrop: fp_drip,
    cooldown_epochs: fp_cooldown,
    max_claims_per_window: fp_max_claims,
  }
}

fn fp_pd(window: Int, claims: Int) -> PoolDatum {
  PoolDatum { cfg: fp_cfg(), window_epoch: window, claims_in_window: claims }
}

fn fp_acct_datum(name: ByteArray, claim_ep: Int, touch_ep: Int) -> FaucetAccount {
  FaucetAccount {
    did_name: name,
    last_claim_epoch: claim_ep,
    last_touch_epoch: touch_ep,
  }
}

/// pool value: lovelace + POOL NFT + tLAMP qty.
fn fp_pool_val(lovelace: Int, tlamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(fp_nft_policy, pool_nft_name, 1)
    |> assets.add(fp_lamp_policy, fp_lamp_name, tlamp)
}

/// account value: lovelace + ACCT NFT (tên neo vào DID) + tLAMP qty.
fn fp_acct_val(did: ByteArray, lovelace: Int, tlamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(fp_nft_policy, acct_name(did), 1)
    |> assets.add(fp_lamp_policy, fp_lamp_name, tlamp)
}

fn fp_did_val(name: ByteArray) -> assets.Value {
  assets.from_lovelace(2_000_000) |> assets.add(fp_did_policy, name, 1)
}

fn fp_did_input(name: ByteArray) -> Input {
  util.mk_input(
    util.mk_ref(7),
    util.mk_output_no_datum(util.vk_address(#"c1"), fp_did_val(name)),
  )
}

fn fp_mint(did: ByteArray, qty: Int) -> assets.Value {
  assets.zero |> assets.add(fp_nft_policy, acct_name(did), qty)
}

/// validity range NEO: cả hai cận trong CÙNG bucket.
fn fp_tx_at(epoch: Int, base: Transaction) -> Transaction {
  let lo = epoch * fp_ms_per_epoch
  Transaction {
    ..base,
    validity_range: interval.between(lo, lo + fp_ms_per_epoch - 1),
  }
}

/// validity range cận trên VÔ HẠN — `now` do người dựng tx chọn. Ca âm.
fn fp_tx_open(epoch: Int, base: Transaction) -> Transaction {
  let lo = epoch * fp_ms_per_epoch
  Transaction { ..base, validity_range: interval.entirely_after(lo) }
}

/// validity range TRẢI HAI BUCKET: `lo` ở bucket `epoch`, `hi` ở `epoch+1`. Đây
/// là hình dạng DUY NHẤT mà ledger còn chấp nhận khi kẻ tấn công muốn khai một
/// bucket quá khứ ở thời điểm thật `epoch+1` (một khoảng nằm TRỌN trong quá khứ
/// bị chính ledger từ chối, không phải bị validator từ chối). Ca âm.
fn fp_tx_span(epoch: Int, base: Transaction) -> Transaction {
  let lo = epoch * fp_ms_per_epoch
  Transaction {
    ..base,
    validity_range: interval.between(lo, lo + fp_ms_per_epoch + 1),
  }
}

fn fp_pool_input(pd: PoolDatum) -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(
      util.script_address(fp_pool_sh),
      fp_pool_val(10_000_000, fp_pool_lamp),
      pd,
    ),
  )
}

fn fp_pool_output(pd: PoolDatum, tlamp: Int) -> Output {
  util.mk_output(
    util.script_address(fp_pool_sh),
    fp_pool_val(10_000_000, tlamp),
    pd,
  )
}

fn fp_acct_output(did: ByteArray, claim_ep: Int, touch_ep: Int, tlamp: Int) -> Output {
  util.mk_output(
    util.script_address(fp_acct_sh),
    fp_acct_val(did, 2_000_000, tlamp),
    fp_acct_datum(did, claim_ep, touch_ep),
  )
}

fn fp_run(pd: PoolDatum, r: PoolRedeemer, tx: Transaction) -> Bool {
  faucet_pool.spend(
    fp_nft_policy,
    fp_did_policy,
    fp_lamp_policy,
    fp_lamp_name,
    fp_ms_per_epoch,
    fp_acct_sh,
    Some(pd),
    r,
    util.mk_ref(0),
    tx,
  )
}

// ── CLAIM OPEN ───────────────────────────────────────────────────
// Một builder dùng chung cho ca dương và mọi ca âm; hai cực chỉ khác đúng phần
// đang kiểm.

fn fp_used(now: Int, window: Int, claims: Int) -> Int {
  if now == window {
    claims
  } else {
    0
  }
}

fn open_tx_with(
  now: Int,
  window: Int,
  claims: Int,
  acct_out: Output,
  mint: assets.Value,
  extra_inputs: List<Input>,
  extra_outputs: List<Output>,
) -> Transaction {
  let pd_out = fp_pd(now, fp_used(now, window, claims) + 1)
  fp_tx_at(
    now,
    Transaction {
      ..placeholder,
      inputs: list_concat(
        [fp_pool_input(fp_pd(window, claims)), fp_did_input(fp_did_name)],
        extra_inputs,
      ),
      outputs: list_concat(
        [fp_pool_output(pd_out, fp_pool_lamp - fp_drip), acct_out],
        extra_outputs,
      ),
      mint: mint,
    },
  )
}

fn list_concat(a: List<x>, b: List<x>) -> List<x> {
  when a is {
    [] -> b
    [h, ..t] -> [h, ..list_concat(t, b)]
  }
}

fn open_std(now: Int, window: Int, claims: Int) -> Transaction {
  open_tx_with(
    now,
    window,
    claims,
    fp_acct_output(fp_did_name, now, now, fp_drip),
    fp_mint(fp_did_name, 1),
    [],
    [],
  )
}

test open_happy() {
  fp_run(fp_pd(100, 0), ClaimOpen, open_std(100, 100, 0))
}

/// C-OPEN-1: `ClaimOpen` mà không đúc ACCT NFT — account "mới" dùng lại một NFT
/// đã tồn tại.
test open_khong_mint() fail {
  let tx =
    open_tx_with(
      100,
      100,
      0,
      fp_acct_output(fp_did_name, 100, 100, fp_drip),
      assets.zero,
      [],
      [],
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-OPEN-2: đúc ACCT thứ hai cùng name TRONG KHI account cũ có trong input —
/// đường "mở mới" bị dùng để đi vòng cooldown.
test poc_duc_account_thu_hai_cung_name() fail {
  let old_acct =
    util.mk_input(
      util.mk_ref(3),
      util.mk_output(
        util.script_address(fp_acct_sh),
        fp_acct_val(fp_did_name, 2_000_000, fp_drip),
        fp_acct_datum(fp_did_name, 90, 90),
      ),
    )
  let tx =
    open_tx_with(
      100,
      100,
      0,
      fp_acct_output(fp_did_name, 100, 100, fp_drip),
      fp_mint(fp_did_name, 1),
      [old_acct],
      [],
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-OPEN-3: account mới nhận khác drip.
test claim_wrong_drip() fail {
  let tx =
    open_tx_with(
      100,
      100,
      0,
      fp_acct_output(fp_did_name, 100, 100, 500_000_000),
      fp_mint(fp_did_name, 1),
      [],
      [],
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-DRIP-1: pool nhả nhiều hơn drip.
test claim_pool_drain_extra() fail {
  let pd_out = fp_pd(100, 1)
  let tx =
    fp_tx_at(
      100,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(fp_pd(100, 0)), fp_did_input(fp_did_name)],
        outputs: [
          fp_pool_output(pd_out, fp_pool_lamp - 2 * fp_drip),
          fp_acct_output(fp_did_name, 100, 100, fp_drip),
        ],
        mint: fp_mint(fp_did_name, 1),
      },
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-ACCTOUT-4
test claim_last_epoch_not_now() fail {
  let tx =
    open_tx_with(
      100,
      100,
      0,
      fp_acct_output(fp_did_name, 50, 100, fp_drip),
      fp_mint(fp_did_name, 1),
      [],
      [],
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-ACCTOUT-5
test claim_touch_epoch_not_now() fail {
  let tx =
    open_tx_with(
      100,
      100,
      0,
      fp_acct_output(fp_did_name, 100, 50, fp_drip),
      fp_mint(fp_did_name, 1),
      [],
      [],
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-DID-1: không có DID NFT input.
test claim_no_did_nft() fail {
  let pd_out = fp_pd(100, 1)
  let tx =
    fp_tx_at(
      100,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(fp_pd(100, 0))],
        outputs: [
          fp_pool_output(pd_out, fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 100, 100, fp_drip),
        ],
        mint: fp_mint(fp_did_name, 1),
      },
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-ACCTOUT-1: acct_out ở VÍ — value + datum ĐÚNG y hệt ca happy, chỉ đổi địa
/// chỉ. Đây là đường làm drip bay khỏi hệ vĩnh viễn.
test claim_acct_out_ra_vi() fail {
  let acct_out =
    util.mk_output(
      util.vk_address(fp_thief_pkh),
      fp_acct_val(fp_did_name, 2_000_000, fp_drip),
      fp_acct_datum(fp_did_name, 100, 100),
    )
  fp_run(fp_pd(100, 0), ClaimOpen, open_tx_with(100, 100, 0, acct_out, fp_mint(fp_did_name, 1), [], []))
}

/// C-ACCTOUT-1: acct_out ở một script hash KHÁC.
test claim_acct_out_script_khac() fail {
  let acct_out =
    util.mk_output(
      util.script_address(#"dead01"),
      fp_acct_val(fp_did_name, 2_000_000, fp_drip),
      fp_acct_datum(fp_did_name, 100, 100),
    )
  fp_run(fp_pd(100, 0), ClaimOpen, open_tx_with(100, 100, 0, acct_out, fp_mint(fp_did_name, 1), [], []))
}

/// C-ACCTOUT-2: cùng script hash, khác stake credential.
test claim_acct_out_stake_hijack() fail {
  let acct_out =
    util.mk_output(
      util.script_address_staked(fp_acct_sh, fp_thief_pkh),
      fp_acct_val(fp_did_name, 2_000_000, fp_drip),
      fp_acct_datum(fp_did_name, 100, 100),
    )
  fp_run(fp_pd(100, 0), ClaimOpen, open_tx_with(100, 100, 0, acct_out, fp_mint(fp_did_name, 1), [], []))
}

/// C-ACCTOUT-3: account khởi tạo mang reference script.
test claim_acct_out_script_carrier() fail {
  let acct_out =
    util.mk_output_with_ref_script(
      util.script_address(fp_acct_sh),
      fp_acct_val(fp_did_name, 2_000_000, fp_drip),
      fp_acct_datum(fp_did_name, 100, 100),
      #"beef",
    )
  fp_run(fp_pd(100, 0), ClaimOpen, open_tx_with(100, 100, 0, acct_out, fp_mint(fp_did_name, 1), [], []))
}

/// C-NAME-1: acct_out mang ACCT NFT với name của DID KHÁC, datum ghi did_name
/// của mình.
test claim_name_khong_khop_did() fail {
  let acct_out =
    util.mk_output(
      util.script_address(fp_acct_sh),
      fp_acct_val(fp_other_did, 2_000_000, fp_drip),
      fp_acct_datum(fp_did_name, 100, 100),
    )
  fp_run(fp_pd(100, 0), ClaimOpen, open_tx_with(100, 100, 0, acct_out, fp_mint(fp_did_name, 1), [], []))
}

/// C-NAME-2: hai output cùng mang ACCT NFT một name.
test claim_hai_acct_nft_cung_name() fail {
  let extra =
    util.mk_output_no_datum(
      util.vk_address(fp_thief_pkh),
      assets.from_lovelace(2_000_000)
        |> assets.add(fp_nft_policy, acct_name(fp_did_name), 1),
    )
  let tx =
    open_tx_with(
      100,
      100,
      0,
      fp_acct_output(fp_did_name, 100, 100, fp_drip),
      fp_mint(fp_did_name, 2),
      [],
      [extra],
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-CFG-1: cấu hình bị đổi ở output.
test cfg_bi_doi_o_output() fail {
  let bad_cfg =
    FaucetConfig {
      drip_oildrop: 1,
      cooldown_epochs: 0,
      max_claims_per_window: 999,
    }
  let pd_out =
    PoolDatum { cfg: bad_cfg, window_epoch: 100, claims_in_window: 1 }
  let tx =
    fp_tx_at(
      100,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(fp_pd(100, 0)), fp_did_input(fp_did_name)],
        outputs: [
          fp_pool_output(pd_out, fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 100, 100, fp_drip),
        ],
        mint: fp_mint(fp_did_name, 1),
      },
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-CFG-3: `max_claims_per_window == 0` ⇒ prelude gãy với MỌI redeemer (pool
/// khoá chết). Ca này ghim rằng cổng ĐÚNG LÀ ở prelude.
test cfg_max_claims_khong_duong() fail {
  let bad_cfg =
    FaucetConfig {
      drip_oildrop: fp_drip,
      cooldown_epochs: fp_cooldown,
      max_claims_per_window: 0,
    }
  let pd_in = PoolDatum { cfg: bad_cfg, window_epoch: 100, claims_in_window: 0 }
  let pd_out = PoolDatum { cfg: bad_cfg, window_epoch: 100, claims_in_window: 1 }
  let tx =
    fp_tx_at(
      100,
      Transaction {
        ..placeholder,
        inputs: [
          util.mk_input(
            util.mk_ref(0),
            util.mk_output(
              util.script_address(fp_pool_sh),
              fp_pool_val(10_000_000, fp_pool_lamp),
              pd_in,
            ),
          ),
          fp_did_input(fp_did_name),
        ],
        outputs: [
          fp_pool_output(pd_out, fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 100, 100, fp_drip),
        ],
        mint: fp_mint(fp_did_name, 1),
      },
    )
  fp_run(pd_in, ClaimOpen, tx)
}

test claim_two_pool_inputs() fail {
  let pool_in2 =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(
        util.script_address_staked(fp_pool_sh, #"99"),
        fp_pool_val(10_000_000, fp_pool_lamp),
        fp_pd(100, 0),
      ),
    )
  let tx =
    open_tx_with(
      100,
      100,
      0,
      fp_acct_output(fp_did_name, 100, 100, fp_drip),
      fp_mint(fp_did_name, 1),
      [pool_in2],
      [],
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

// ── TRẦN TỐC ĐỘ (tầng a) ─────────────────────────────────────────

/// Ca dương song sinh của `poc_vet_N_lan_trong_mot_cua_so`: claim thứ `max`
/// trong cửa sổ phải XANH. Không có ca này, cặp không phân biệt được hai cực.
test rate_claim_thu_max_pass() {
  fp_run(fp_pd(100, fp_max_claims - 1), ClaimOpen, open_std(100, 100, fp_max_claims - 1))
}

/// C-RATE-2: claim thứ `max + 1` trong cùng cửa sổ.
test poc_vet_N_lan_trong_mot_cua_so() fail {
  fp_run(fp_pd(100, fp_max_claims), ClaimOpen, open_std(100, 100, fp_max_claims))
}

/// Cửa sổ mới reset bộ đếm: datum vào đầy quota của cửa sổ CŨ vẫn xanh.
test rate_cua_so_moi_reset() {
  fp_run(fp_pd(99, fp_max_claims), ClaimOpen, open_std(100, 99, fp_max_claims))
}

/// C-RATE-1: `now` nhỏ hơn `window_epoch` trong datum.
test rate_window_lui_ve_qua_khu() fail {
  fp_run(fp_pd(200, 0), ClaimOpen, open_std(100, 200, 0))
}

/// C-RATE-4: bộ đếm ở output không tăng.
test rate_out_claims_khong_tang() fail {
  let tx =
    fp_tx_at(
      100,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(fp_pd(100, 3)), fp_did_input(fp_did_name)],
        outputs: [
          fp_pool_output(fp_pd(100, 3), fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 100, 100, fp_drip),
        ],
        mint: fp_mint(fp_did_name, 1),
      },
    )
  fp_run(fp_pd(100, 3), ClaimOpen, tx)
}

/// C-RATE-3: cửa sổ ở output bị đẩy lên tương lai.
test rate_out_window_gia_mao() fail {
  let tx =
    fp_tx_at(
      100,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(fp_pd(100, 0)), fp_did_input(fp_did_name)],
        outputs: [
          fp_pool_output(fp_pd(101, 1), fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 100, 100, fp_drip),
        ],
        mint: fp_mint(fp_did_name, 1),
      },
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-RATE-0: cận trên VÔ HẠN ⇒ `now` là trường do người dựng tx đặt. Mọi thứ
/// khác y hệt `open_happy`.
test rate_upper_bound_vo_han() fail {
  let pd_out = fp_pd(100, 1)
  let tx =
    fp_tx_open(
      100,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(fp_pd(100, 0)), fp_did_input(fp_did_name)],
        outputs: [
          fp_pool_output(pd_out, fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 100, 100, fp_drip),
        ],
        mint: fp_mint(fp_did_name, 1),
      },
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-RATE-0 — ca leo thang bậc thang. Thời gian THẬT ở bucket 101; kẻ tấn công
/// khai bucket 100 bằng cách để `lo` ở bucket 100 và `hi` chớm sang bucket 101
/// (khoảng nằm TRỌN trong quá khứ thì chính ledger từ chối, nên đây là hình dạng
/// duy nhất còn lại). Mỗi bucket quá khứ khai được là một quota mới ⇒ trần tốc
/// độ bị vượt trong CÙNG một cửa sổ thật.
test rate_leo_thang_bac_thang() fail {
  let pd_out = fp_pd(100, 1)
  let tx =
    fp_tx_span(
      100,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(fp_pd(100, 0)), fp_did_input(fp_did_name)],
        outputs: [
          fp_pool_output(pd_out, fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 100, 100, fp_drip),
        ],
        mint: fp_mint(fp_did_name, 1),
      },
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

// ── CLAIM AGAIN ──────────────────────────────────────────────────

fn again_tx_with(
  now: Int,
  old_claim_ep: Int,
  acct_in_lamp: Int,
  acct_out: Output,
  mint: assets.Value,
  acct_in_did: ByteArray,
) -> Transaction {
  let acct_in =
    util.mk_input(
      util.mk_ref(3),
      util.mk_output(
        util.script_address(fp_acct_sh),
        fp_acct_val(acct_in_did, 2_000_000, acct_in_lamp),
        fp_acct_datum(acct_in_did, old_claim_ep, old_claim_ep),
      ),
    )
  fp_tx_at(
    now,
    Transaction {
      ..placeholder,
      inputs: [fp_pool_input(fp_pd(now, 0)), acct_in, fp_did_input(fp_did_name)],
      outputs: [
        fp_pool_output(fp_pd(now, 1), fp_pool_lamp - fp_drip),
        acct_out,
      ],
      mint: mint,
    },
  )
}

fn again_std(now: Int, old_claim_ep: Int) -> Transaction {
  again_tx_with(
    now,
    old_claim_ep,
    fp_drip,
    fp_acct_output(fp_did_name, now, now, fp_drip * 2),
    assets.zero,
    fp_did_name,
  )
}

test again_happy_sau_cooldown() {
  fp_run(fp_pd(136, 0), ClaimAgain, again_std(136, 100))
}

/// C-COOL-1: thiếu đúng một cửa sổ.
test again_cooldown_thieu_1_epoch() fail {
  fp_run(fp_pd(135, 0), ClaimAgain, again_std(135, 100))
}

/// C-AGAIN-2: `ClaimAgain` mà KHÔNG kèm account cũ — đường né cooldown.
test poc_claim_khong_kem_account_cu() fail {
  let tx =
    fp_tx_at(
      136,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(fp_pd(136, 0)), fp_did_input(fp_did_name)],
        outputs: [
          fp_pool_output(fp_pd(136, 1), fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 136, 136, fp_drip * 2),
        ],
        mint: assets.zero,
      },
    )
  fp_run(fp_pd(136, 0), ClaimAgain, tx)
}

/// C-AGAIN-2 — cực còn lại của cổng. `poc_claim_khong_kem_account_cu` ghim vế
/// "0 account input", ca này ghim vế "NHIỀU HƠN 1": tx tiêu account của alice
/// (đứng trước, nên `input_at_script` lấy nó và cooldown tính theo nó) VÀ account
/// của bob cùng lúc, drip + ACCT NFT của bob đi ra ví kẻ dựng tx. Không có vế
/// này thì cổng `== 1` bị đột biến thành `>= 1` mà không bài nào kêu.
test again_hai_account_input() fail {
  let acct_a =
    util.mk_input(
      util.mk_ref(3),
      util.mk_output(
        util.script_address(fp_acct_sh),
        fp_acct_val(fp_did_name, 2_000_000, fp_drip),
        fp_acct_datum(fp_did_name, 100, 100),
      ),
    )
  let acct_b =
    util.mk_input(
      util.mk_ref(4),
      util.mk_output(
        util.script_address(fp_acct_sh),
        fp_acct_val(fp_other_did, 2_000_000, fp_drip),
        fp_acct_datum(fp_other_did, 100, 100),
      ),
    )
  let thief_out =
    util.mk_output_no_datum(
      util.vk_address(fp_thief_pkh),
      assets.from_lovelace(2_000_000)
        |> assets.add(fp_nft_policy, acct_name(fp_other_did), 1)
        |> assets.add(fp_lamp_policy, fp_lamp_name, fp_drip),
    )
  let tx =
    fp_tx_at(
      136,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(fp_pd(136, 0)), acct_a, acct_b, fp_did_input(fp_did_name)],
        outputs: [
          fp_pool_output(fp_pd(136, 1), fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 136, 136, fp_drip * 2),
          thief_out,
        ],
      },
    )
  fp_run(fp_pd(136, 0), ClaimAgain, tx)
}

/// C-AGAIN-4: account input ở ĐÚNG script nhưng của DID khác.
test again_acct_in_datum_gia() fail {
  let tx =
    again_tx_with(
      136,
      100,
      fp_drip,
      fp_acct_output(fp_did_name, 136, 136, fp_drip * 2),
      assets.zero,
      fp_other_did,
    )
  fp_run(fp_pd(136, 0), ClaimAgain, tx)
}

/// C-AGAIN-3: account input ở đúng script, đúng datum, nhưng KHÔNG mang ACCT NFT.
test again_acct_in_khong_mang_nft() fail {
  let acct_in =
    util.mk_input(
      util.mk_ref(3),
      util.mk_output(
        util.script_address(fp_acct_sh),
        assets.from_lovelace(2_000_000)
          |> assets.add(fp_lamp_policy, fp_lamp_name, fp_drip),
        fp_acct_datum(fp_did_name, 100, 100),
      ),
    )
  let tx =
    fp_tx_at(
      136,
      Transaction {
        ..placeholder,
        inputs: [
          fp_pool_input(fp_pd(136, 0)),
          acct_in,
          fp_did_input(fp_did_name),
        ],
        outputs: [
          fp_pool_output(fp_pd(136, 1), fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 136, 136, fp_drip * 2),
        ],
        mint: assets.zero,
      },
    )
  fp_run(fp_pd(136, 0), ClaimAgain, tx)
}

/// C-AGAIN-1: đúc thêm ACCT NFT ở nhánh `ClaimAgain`.
test again_mint_them_acct() fail {
  let tx =
    again_tx_with(
      136,
      100,
      fp_drip,
      fp_acct_output(fp_did_name, 136, 136, fp_drip * 2),
      fp_mint(fp_did_name, 1),
      fp_did_name,
    )
  fp_run(fp_pd(136, 0), ClaimAgain, tx)
}

/// C-AGAIN-5: account_out chỉ mang drip mới, bỏ rơi số tLAMP cũ.
test again_bo_bot_tlamp_cu() fail {
  let tx =
    again_tx_with(
      136,
      100,
      fp_drip,
      fp_acct_output(fp_did_name, 136, 136, fp_drip),
      assets.zero,
      fp_did_name,
    )
  fp_run(fp_pd(136, 0), ClaimAgain, tx)
}

// ── RECLAIM ──────────────────────────────────────────────────────
// `reclaim_happy` mang `claims_in_window = max` ở datum vào: với 0/0 thì
// C-RECL-2 thoả tầm thường và ca dương không chứng minh bộ đếm được BẢO TOÀN,
// chỉ chứng minh 0 == 0.

fn fp_reclaim_acct_input() -> Input {
  util.mk_input(
    util.mk_ref(3),
    util.mk_output(
      util.script_address(fp_acct_sh),
      fp_acct_val(fp_did_name, 2_000_000, fp_drip),
      fp_acct_datum(fp_did_name, 100, 100),
    ),
  )
}

fn reclaim_tx_with(pd_in: PoolDatum, pool_out: Output, inputs_extra: List<Input>) -> Transaction {
  fp_tx_at(
    2000,
    Transaction {
      ..placeholder,
      inputs: list_concat([fp_pool_input(pd_in)], inputs_extra),
      outputs: [pool_out],
    },
  )
}

test reclaim_happy() {
  let pd = fp_pd(100, fp_max_claims)
  let tx =
    reclaim_tx_with(
      pd,
      fp_pool_output(pd, fp_pool_lamp + fp_drip),
      [fp_reclaim_acct_input()],
    )
  fp_run(pd, Reclaim, tx)
}

/// C-RECL-0: cửa spend RỖNG — không account input, Δ = 0, output y hệt input.
/// Giá = một phí tx, lặp mỗi block ⇒ mọi claim của người thật trượt vĩnh viễn.
test reclaim_spend_rong() fail {
  let pd = fp_pd(100, fp_max_claims)
  let tx = reclaim_tx_with(pd, fp_pool_output(pd, fp_pool_lamp), [])
  fp_run(pd, Reclaim, tx)
}

/// C-RECL-2: xen một `Reclaim` để reset bộ đếm ⇒ trần tốc độ vô hiệu.
test reclaim_reset_bo_dem() fail {
  let pd = fp_pd(100, fp_max_claims)
  let tx =
    reclaim_tx_with(
      pd,
      fp_pool_output(fp_pd(100, 0), fp_pool_lamp + fp_drip),
      [fp_reclaim_acct_input()],
    )
  fp_run(pd, Reclaim, tx)
}

/// C-RECL-1: đổi `window_epoch` qua `Reclaim`.
test reclaim_doi_window() fail {
  let pd = fp_pd(100, fp_max_claims)
  let tx =
    reclaim_tx_with(
      pd,
      fp_pool_output(fp_pd(101, fp_max_claims), fp_pool_lamp + fp_drip),
      [fp_reclaim_acct_input()],
    )
  fp_run(pd, Reclaim, tx)
}

test reclaim_pool_loses() fail {
  let pd = fp_pd(100, fp_max_claims)
  let tx =
    reclaim_tx_with(
      pd,
      fp_pool_output(pd, fp_pool_lamp - fp_drip),
      [fp_reclaim_acct_input()],
    )
  fp_run(pd, Reclaim, tx)
}

test reclaim_steal_ada() fail {
  let pd = fp_pd(100, fp_max_claims)
  let pool_out =
    util.mk_output(
      util.script_address(fp_pool_sh),
      fp_pool_val(2_000_000, fp_pool_lamp + fp_drip),
      pd,
    )
  let tx = reclaim_tx_with(pd, pool_out, [fp_reclaim_acct_input()])
  fp_run(pd, Reclaim, tx)
}

// ── TOPUPPOOL ────────────────────────────────────────────────────

fn topuppool_tx(pd: PoolDatum, delta: Int, inputs_extra: List<Input>, pd_out: PoolDatum) -> Transaction {
  fp_tx_at(
    2000,
    Transaction {
      ..placeholder,
      inputs: list_concat([fp_pool_input(pd)], inputs_extra),
      outputs: [fp_pool_output(pd_out, fp_pool_lamp + delta)],
    },
  )
}

test topuppool_happy() {
  let pd = fp_pd(100, fp_max_claims)
  fp_run(pd, TopUpPool, topuppool_tx(pd, fp_drip * 1000, [], pd))
}

/// C-TUP-1: spend rỗng đội lốt "nạp".
test topuppool_delta_0() fail {
  let pd = fp_pd(100, fp_max_claims)
  fp_run(pd, TopUpPool, topuppool_tx(pd, 0, [], pd))
}

/// `TopUpPool` mượn đường thu hồi account.
test topuppool_co_account_input() fail {
  let pd = fp_pd(100, fp_max_claims)
  fp_run(
    pd,
    TopUpPool,
    topuppool_tx(pd, fp_drip * 1000, [fp_reclaim_acct_input()], pd),
  )
}

/// C-TUP-3: nạp tiền mà tiện tay reset bộ đếm.
test topuppool_doi_bo_dem() fail {
  let pd = fp_pd(100, fp_max_claims)
  fp_run(pd, TopUpPool, topuppool_tx(pd, fp_drip * 1000, [], fp_pd(100, 0)))
}

// ══════════════════════════════════════════════════════════════
// ĐÍCH POOL — ca kiểm ĐỔI ĐỊA CHỈ (không phải đổi value)
// ══════════════════════════════════════════════════════════════
// Mọi ca phía trên dựng pool_out bằng CÙNG một hằng `util.script_address(fp_pool_sh)`
// ở cả hai cực ⇒ không ca nào phân biệt được "pool_out ở đâu". Bốn ca dưới đây
// giữ value + datum ĐÚNG y hệt ca happy, chỉ đổi ĐỊA CHỈ / reference_script.
// Chúng đều mang account input để KHÔNG đỏ nhầm ở C-RECL-0.

test poc_reclaim_pool_to_wallet() fail {
  let pd = fp_pd(100, fp_max_claims)
  let pool_out =
    util.mk_output(
      util.vk_address(fp_thief_pkh),
      fp_pool_val(10_000_000, fp_pool_lamp + fp_drip),
      pd,
    )
  fp_run(pd, Reclaim, reclaim_tx_with(pd, pool_out, [fp_reclaim_acct_input()]))
}

test poc_reclaim_pool_stake_hijack() fail {
  let pd = fp_pd(100, fp_max_claims)
  let pool_out =
    util.mk_output(
      util.script_address_staked(fp_pool_sh, fp_thief_pkh),
      fp_pool_val(10_000_000, fp_pool_lamp + fp_drip),
      pd,
    )
  fp_run(pd, Reclaim, reclaim_tx_with(pd, pool_out, [fp_reclaim_acct_input()]))
}

test poc_reclaim_pool_script_carrier() fail {
  let pd = fp_pd(100, fp_max_claims)
  let pool_out =
    util.mk_output_with_ref_script(
      util.script_address(fp_pool_sh),
      fp_pool_val(10_000_000, fp_pool_lamp + fp_drip),
      pd,
      #"beef",
    )
  fp_run(pd, Reclaim, reclaim_tx_with(pd, pool_out, [fp_reclaim_acct_input()]))
}

/// Tấn công qua ClaimOpen: drip đúng, quota đúng, DID đúng — chỉ pool_out về ví.
test poc_claim_pool_to_wallet() fail {
  let pool_out =
    util.mk_output(
      util.vk_address(fp_thief_pkh),
      fp_pool_val(10_000_000, fp_pool_lamp - fp_drip),
      fp_pd(100, 1),
    )
  let tx =
    fp_tx_at(
      100,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(fp_pd(100, 0)), fp_did_input(fp_did_name)],
        outputs: [pool_out, fp_acct_output(fp_did_name, 100, 100, fp_drip)],
        mint: fp_mint(fp_did_name, 1),
      },
    )
  fp_run(fp_pd(100, 0), ClaimOpen, tx)
}

/// C-POOL-IN-1: POOL NFT nằm ở VÍ, UTxO đang tiêu là một UTxO khác ở script pool.
test poc_pool_nft_input_not_at_own_script() fail {
  let pd = fp_pd(100, fp_max_claims)
  let thief_addr = util.vk_address(fp_thief_pkh)
  let v = fp_pool_val(10_000_000, fp_pool_lamp)
  let own_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        util.script_address(fp_pool_sh),
        assets.from_lovelace(5_000_000),
        pd,
      ),
    )
  let pool_in =
    util.mk_input(util.mk_ref(1), util.mk_output(thief_addr, v, pd))
  let tx =
    fp_tx_at(
      2000,
      Transaction {
        ..placeholder,
        inputs: [own_in, pool_in, fp_reclaim_acct_input()],
        outputs: [util.mk_output(thief_addr, v, pd)],
      },
    )
  fp_run(pd, Reclaim, tx)
}

// ══════════════════════════════════════════════════════════════
// HAI VALIDATOR MỘT TX
// ══════════════════════════════════════════════════════════════
// Mọi ca phía trên gọi ĐÚNG MỘT validator. Lớp ca dưới đây gọi cả hai script
// thật sự chạy trên cùng một `Transaction` — đó là phép đo duy nhất bắt được
// lớp lỗi "hai bên đòi trái nhau": một luồng có thể xanh ở mọi bài đơn vị và
// vẫn KHÔNG có hình dạng giao dịch nào tiêu được.
//
// Hai luồng KHÔNG có ca loại này, và đó là tính chất của thiết kế chứ không
// phải chỗ thiếu:
//   - `Use`        — C-USE-NOPOOL-1 cấm POOL NFT input ⇒ không tx nào gọi được
//                    cả hai. Cực đối xứng nằm ở `use_co_pool_input`
//                    (`faucet_account.ak`) và `again_account_dung_redeemer_Use`.
//   - `TopUpPool`  — cấm account input và không đúc gì ⇒ chỉ một script chạy.
//                    Cực đối xứng: `topuppool_co_account_input`.

const fp_acct_ref_ix: Int = 3

fn fp_acct_run(r: AccountRedeemer, datum: FaucetAccount, tx: Transaction) -> Bool {
  handlers.account_spend(
    fp_nft_policy,
    fp_did_policy,
    fp_lamp_policy,
    fp_lamp_name,
    fp_ms_per_epoch,
    Some(datum),
    r,
    util.mk_ref(fp_acct_ref_ix),
    tx,
  )
}

/// Luồng OPEN: `faucet_pool.ClaimOpen` + `faucet_nft.MintAccount` trên cùng tx.
/// `faucet_account` KHÔNG chạy ở luồng này (C-OPEN-2 ép 0 account input), nên
/// script thứ hai đúng là mint policy.
test open_happy_hai_validator() {
  let tx = open_std(100, 100, 0)
  and {
    fp_run(fp_pd(100, 0), ClaimOpen, tx),
    handlers.nft_mint(
      OutputReference { transaction_id: #"aa", output_index: 5 },
      fp_ms_per_epoch,
      MintAccount,
      fp_nft_policy,
      tx,
    ),
  }
}

/// Luồng AGAIN: `faucet_pool.ClaimAgain` + `faucet_account.TopUp` trên cùng tx.
/// Đây là ca ghim rằng luồng cooldown THẬT SỰ tiêu được. Bản trước bản vá này
/// không có nhánh nào của `faucet_account` chấp nhận được một tx `ClaimAgain`:
/// `Use` cấm tLAMP tăng, `ReclaimIdle` đòi pool TĂNG — nên nhánh cooldown là mã
/// chết trong khi `ClaimOpen` lặp lại với cùng DID vẫn chạy.
test again_happy_hai_validator() {
  let tx = again_std(136, 100)
  and {
    fp_run(fp_pd(136, 0), ClaimAgain, tx),
    fp_acct_run(TopUp, fp_acct_datum(fp_did_name, 100, 100), tx),
  }
}

/// Cùng tx `ClaimAgain`, nhưng account dùng redeemer `Use` → phải ĐỎ.
/// C-USE-NOPOOL-1 là dòng làm hai nhánh rời nhau; không có nó, `Use` và `TopUp`
/// tranh nhau một luồng và chốt "account không được tăng tLAMP" mất nghĩa.
test again_account_dung_redeemer_Use() fail {
  let tx = again_std(136, 100)
  fp_acct_run(Use, fp_acct_datum(fp_did_name, 100, 100), tx)
}

/// Luồng RECLAIM / RECLAIM-IDLE: `faucet_pool.Reclaim` + `faucet_account.ReclaimIdle`
/// trên cùng tx, kèm đốt ACCT NFT.
test reclaim_idle_happy_hai_validator() {
  let pd = fp_pd(100, fp_max_claims)
  let tx =
    fp_tx_at(
      2000,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(pd), fp_reclaim_acct_input()],
        outputs: [fp_pool_output(pd, fp_pool_lamp + fp_drip)],
        mint: fp_mint(fp_did_name, -1),
      },
    )
  and {
    fp_run(pd, Reclaim, tx),
    fp_acct_run(ReclaimIdle, fp_acct_datum(fp_did_name, 100, 100), tx),
  }
}

/// Cùng tx thu hồi, nhưng đốt ACCT NFT là bước bị bỏ ⇒ `faucet_pool.Reclaim`
/// vẫn XANH (nó không canh mint) trong khi `faucet_account.ReclaimIdle` ĐỎ. Ca
/// này ghim rằng C-BURN-1 là cổng DUY NHẤT canh việc đó — đừng trông vào pool.
test reclaim_idle_khong_burn_hai_validator() fail {
  let pd = fp_pd(100, fp_max_claims)
  let tx =
    fp_tx_at(
      2000,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(pd), fp_reclaim_acct_input()],
        outputs: [fp_pool_output(pd, fp_pool_lamp + fp_drip)],
      },
    )
  and {
    fp_run(pd, Reclaim, tx),
    fp_acct_run(ReclaimIdle, fp_acct_datum(fp_did_name, 100, 100), tx),
  }
}

// ── GRIEFING qua `TopUp` không có DID (C-TOP-DID-1) ──────────────────────
// Cặp hai cực trên CÙNG MỘT `Transaction`: pool `Reclaim` XANH, account `TopUp`
// ĐỎ. Đó là điểm của cặp này — chốt canh đường griefing nằm ở `faucet_account`,
// KHÔNG ở pool, nên "pool cho qua" không phải lỗi mà là dữ kiện phải ghim lại.
// Kịch bản: kẻ dựng tx tiêu account của bob, TỰ BỎ `drip` tLAMP của mình vào
// (nên C-TOP-5 về dòng tiền vẫn thoả), pool không mất gì (Δ = 0 nên C-RECL-*
// thoả) — cái nó lấy được là GHI `last_claim_epoch = now` của bob, tức hoãn lần
// claim kế tiếp của bob thêm `cooldown_epochs` cửa sổ, và hoãn cả `ReclaimIdle`.
// Không cần DID NFT của bob nếu thiếu C-TOP-DID-1.

fn topup_griefing_tx() -> Transaction {
  let pd = fp_pd(100, fp_max_claims)
  // Account của BOB, ở đúng script, mang ACCT NFT đúng tên của bob.
  let bob_acct =
    util.mk_input(
      util.mk_ref(fp_acct_ref_ix),
      util.mk_output(
        util.script_address(fp_acct_sh),
        fp_acct_val(fp_other_did, 2_000_000, fp_drip),
        fp_acct_datum(fp_other_did, 100, 100),
      ),
    )
  // tLAMP của chính kẻ dựng tx — nguồn của `drip` cộng thêm.
  let thief_funds =
    util.mk_input(
      util.mk_ref(9),
      util.mk_output_no_datum(
        util.vk_address(fp_thief_pkh),
        assets.from_lovelace(5_000_000)
          |> assets.add(fp_lamp_policy, fp_lamp_name, fp_drip),
      ),
    )
  fp_tx_at(
    2000,
    Transaction {
      ..placeholder,
      inputs: [fp_pool_input(pd), bob_acct, thief_funds],
      outputs: [
        // Pool KHÔNG mất gì: Δ tLAMP = 0, datum y nguyên.
        fp_pool_output(pd, fp_pool_lamp),
        // Account của bob nhận thêm drip, nhưng mốc cooldown bị đẩy lên now.
        fp_acct_output(fp_other_did, 2000, 2000, fp_drip * 2),
      ],
    },
  )
}

/// Cực XANH: `faucet_pool.Reclaim` cho hình dạng tx này đi qua. Ca này KHÔNG nói
/// bản vá hỏng — nó nói chốt canh nằm ở validator bên kia, nên đừng ai "tối giản"
/// C-TOP-DID-1 với lý do "pool đã kiểm".
test topup_griefing_pool_van_xanh() {
  fp_run(fp_pd(100, fp_max_claims), Reclaim, topup_griefing_tx())
}

/// Cực ĐỎ: cùng tx đó, `faucet_account.TopUp` phải từ chối vì thiếu DID NFT của
/// bob. Gỡ C-TOP-DID-1 thì ca này XANH và đường griefing mở.
test topup_griefing_hai_validator() fail {
  let tx = topup_griefing_tx()
  and {
    fp_run(fp_pd(100, fp_max_claims), Reclaim, tx),
    fp_acct_run(TopUp, fp_acct_datum(fp_other_did, 100, 100), tx),
  }
}
