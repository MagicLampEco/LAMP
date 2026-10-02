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
//       ACCOUNT (`ClaimAgain`). Tự nó KHÔNG giới hạn số account mà một `did_name`
//       mở được; thứ làm việc đó là tầng (c) dưới đây. Trước khi có tầng (c),
//       một DID chiếm được trọn quota của tầng (a) trong một cửa sổ.
//   (c) MỘT DID MỘT ACCOUNT — `PoolDatum.opened_root` (sổ MPF các khoá DID đang
//       có account) + `ClaimOpen`/`Reclaim` phải nộp bằng chứng. Đây là thứ làm
//       cooldown ở tầng (b) thành ràng buộc THẬT trên một DID, không chỉ trên một
//       chuỗi account. Bất biến: INV-ONE-ACCT (xem `ledger.ak`).
//
// ─────────────────────────────────────────────────────────────────────────
// ĐÚC ACCT NFT CHỈ XẢY RA Ở `ClaimOpen` (giả thiết H-MINT của Math-Spec §6a)
// ─────────────────────────────────────────────────────────────────────────
// `faucet_nft ▸ MintAccount` chỉ đòi tx có POOL NFT input rồi UỶ QUYỀN phần còn
// lại cho pool. Nên nếu pool không canh `tx.mint` ở MỌI nhánh thì "uỷ quyền" đó
// rơi vào khoảng trống: một tx `TopUpPool` (hoặc `ClaimAgain` cho một DID KHÁC)
// kèm `MintAccount` đúc được ACCT NFT ra ví, và cả hai validator đều chấp nhận.
// Một ACCT NFT nằm ngoài sổ là đủ để phá INV-ONE-ACCT: đặt nó vào một UTxO ở địa
// chỉ account script với datum tự đặt (tạo UTxO ở địa chỉ script không cần chữ
// ký của ai), rồi `pool.Reclaim` + `account.ReclaimIdle` trên UTxO đó — khoá của
// DID bị XOÁ khỏi sổ trong khi account THẬT còn sống ⇒ `ClaimOpen` lần thứ hai.
//
// Ba chốt đóng, tất cả đặt TRONG POOL:
//   C-MINT-ONLY-OPEN-1  `ClaimAgain`: `tx.mint` dưới `faucet_nft_policy` RỖNG.
//   C-MINT-ONLY-OPEN-2  `TopUpPool` : cùng thế.
//   C-RECL-BURN-2       `Reclaim`   : ĐÚNG MỘT mục (và C-RECL-BURN-1 ép mục đó
//                                     là −1 của ACCT bị thu hồi).
//
// VÌ SAO Ở POOL CHỨ KHÔNG Ở MINT POLICY. Đặt ở `faucet_nft ▸ MintAccount` thì
// policy phải tự đọc redeemer của pool trong `tx.redeemers` để biết nhánh nào
// đang chạy — tức nó phải ôm codec `PoolRedeemer` (thứ tự constructor là trường
// load-bearing, xem `ledger.ak`) và trở thành NGUỒN THỨ HAI cho câu hỏi "pool
// đang ở nhánh nào". Hai nguồn đó trôi khỏi nhau trong im lặng. Pool thì biết
// nhánh của chính nó MIỄN PHÍ. Không vòng hash ở cả hai phương án (pool đã nhận
// `faucet_nft_policy` làm param, và `tx.mint` do ledger cấp), nên phương án được
// chọn theo tiêu chí "một nguồn cho một sự thật", không theo tiêu chí vòng.
//
// VÌ SAO CHỈ CANH Ở POOL LÀ ĐỦ: `MintAccount` đòi POOL NFT nằm trong `tx.inputs`
// (không phải reference input), POOL NFT ở địa chỉ script pool (C-MP-1 lúc đúc +
// C-POOL-OUT-1 mọi lượt sau), nên mọi tx đúc được ACCT NFT đều CHẠY `faucet_pool.spend`
// và rơi vào đúng một trong bốn nhánh dưới. Phần dư còn lại là phần C-MP-1 đã
// ghi: nếu giây deploy đúc POOL NFT vào một script KHÁC thì pool không bao giờ
// chạy — đó là rủi ro deploy, đối chiếu datum on-chain sau deploy.
//
// BỐN REDEEMER:
//   ClaimOpen  — mở account MỚI: đúc ACCT NFT, 0 account input, CHÈN khoá DID vào
//                sổ (C-OPEN-UNIQ-1).
//   ClaimAgain — nạp thêm drip vào account đã có: 1 account input, ép cooldown.
//   Reclaim    — nhận tLAMP từ account idle, XOÁ khoá DID khỏi sổ
//                (C-RECL-UNIQ-1) và ĐỐT ACCT NFT của DID đó (C-RECL-BURN-1).
//                ĐÒI đúng 1 account input (C-RECL-0):
//                không có dòng đó thì đây là cửa spend RỖNG permissionless trên
//                một singleton, tức DoS toàn phần giá một phí tx, và nó nuôi bậc
//                thang quota bằng cách giữ `window_epoch` đứng im.
//   TopUpPool  — nạp tLAMP vào pool (ops/deploy). Cấm account input, đòi nạp thật.

use aiken/collection/dict
use aiken/crypto
use aiken/interval
use aiken/merkle_patricia_forestry as mpf
use cardano/assets
use cardano/transaction.{InlineDatum, Input, Output, OutputReference,
  Transaction, placeholder}
use magiclamp/faucet/ledger.{
  AccountRedeemer, BurnAccount, ClaimAgain, ClaimOpen, FaucetAccount,
  FaucetConfig, FaucetNftRedeemer, MintAccount, PoolDatum, PoolRedeemer, Reclaim,
  ReclaimIdle, TopUp, TopUpPool, Use, acct_name, did_key, did_leaf_value,
  empty_opened_root, pool_nft_name,
}
use magiclamp/faucet/util

// Import dưới CHỈ phục vụ khối ca kiểm "HAI VALIDATOR MỘT TX" ở cuối tệp.
// Không có lớp ca đó thì cả một họ lỗi vô hình với bộ kiểm: hai validator đòi
// hai điều TRÁI NHAU trên cùng một giao dịch, mà mỗi bài đơn vị vẫn xanh đúng
// tên nó. `handlers` giữ THÂN của `faucet_account.spend` và `faucet_nft.mint`
// vì Aiken không xuất handler của validator ra ngoài module — xem `handlers.ak`.
use magiclamp/faucet/handlers
use magiclamp/faucet/window_origin_fixtures

validator faucet_pool(
  faucet_nft_policy: ByteArray,
  did_nft_policy: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
  ms_per_epoch: Int,
  account_script_hash: ByteArray,
  // THÊM 2026-10-02 (Specs/Window/CONTRACT.md v1.0, WIN-ORIGIN-3) — ĐẶT CUỐI theo khuôn các
  // tham số đã thêm trước. Gốc lưới cửa sổ: cửa sổ = (t − window_origin_ms) / ms_per_epoch,
  // nên chỉ số cửa sổ = số epoch Cardano của mạng. Đổi hash validator này.
  window_origin_ms: Int,
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
      ClaimOpen { proof } -> {
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
            window_origin_ms,
            account_script_hash,
          )
        // C-OPEN-1: đúc đúng ACCT NFT của DID này.
        expect assets.quantity_of(tx.mint, faucet_nft_policy, ctx.an) == 1
        // C-OPEN-2: KHÔNG có account input — `ClaimOpen` là đường mở mới.
        expect util.count_inputs_at_script(tx.inputs, account_script_hash) == 0
        // C-OPEN-3: account mới nhận ĐÚNG drip.
        expect
          assets.quantity_of(ctx.acct_out.value, lamp_policy, lamp_name) == cfg.drip_oildrop
        // ── C-OPEN-UNIQ-1: MỘT DID MỘT ACCOUNT ─────────────────────────────
        // `mpf.insert` tự `expect` rằng `proof` chứng minh khoá CHƯA có trong
        // `pd.opened_root` (nó tính lại gốc-không-có-khoá từ bằng chứng và so với
        // gốc vào), rồi trả về gốc ĐÃ chèn. Nên một dòng này gánh cả hai vế:
        // "chưa tồn tại" và "ghi vào sổ". Không có nó, cooldown và trần tốc độ
        // vẫn còn nhưng một DID mở được vô số account song song và mỗi cái có
        // quota riêng — đó là điểm treo `[FAUCET-ACCT-UNIQUE]`, nay đóng.
        //
        // `did` lấy từ ĐÚNG datum của account output (`ctx.acct.did_name`), cùng
        // một nguồn với C-NAME-1/C-DID-1 — KHÔNG nhận `did` từ redeemer. Nhận từ
        // redeemer thì kẻ dựng tx khai một DID chưa có khoá trong khi đúc ACCT NFT
        // cho DID đã có, và sổ ghi sai chỗ.
        // Ghim bởi `open_did_da_co_account` · `open_goc_output_sai` ·
        // `open_proof_cua_did_khac`.
        expect
          out_pd.opened_root == mpf.root(
            mpf.insert(
              mpf.from_root(pd.opened_root),
              did_key(ctx.acct.did_name),
              did_leaf_value,
              proof,
            ),
          )
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
            window_origin_ms,
            account_script_hash,
          )
        // ── C-MINT-ONLY-OPEN-1: `tx.mint` dưới policy này phải RỖNG ─────────
        // THAY chốt cũ C-AGAIN-1 (`quantity_of(tx.mint, policy, ctx.an) == 0`),
        // không đứng cạnh nó: vế cũ là hệ quả chặt của vế này, giữ cả hai thì vế
        // cũ thành BẤT KHẢ GHIM (gỡ nó ra mà không ca nào đỏ) trong khi vẫn đọc
        // như đang được canh. Vế cũ chỉ so tên của CHÍNH DID trong tx này, nên
        // đúc `an(d')` của một DID KHÁC đi lọt — chuỗi account cũ của d đi tiếp
        // đúng luật, và d' có một ACCT NFT ngoài sổ. "RỖNG" chứ không phải "không
        // dương": nhánh này cũng không có lý do ĐỐT gì (đốt là việc của `Reclaim`),
        // và một vế rỗng không cần ai đọc lại để biết nó chặn hướng nào.
        // Ghim bởi `again_mint_them_acct` · `again_duc_acct_did_khac_ba_validator`.
        expect dict.is_empty(assets.tokens(tx.mint, faucet_nft_policy))
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
        // ── C-ROOT-KEEP-1 (nhánh `ClaimAgain`): sổ KHÔNG đổi ────────────────
        // Nhánh này không mở và không đóng account nào. Viết RIÊNG ở từng nhánh
        // chứ không gộp lên prelude: gộp lên thì hai nhánh đổi sổ phải được miễn
        // trừ, và một dòng miễn trừ là chỗ để lọt một nhánh thứ ba sau này.
        // Không có dòng này, `ClaimAgain` — nhánh KHÔNG cần bằng chứng nào — ghi
        // được gốc tuỳ ý, tức xoá khoá của chính mình rồi `ClaimOpen` lại: toàn
        // bộ INV-ONE-ACCT sập bằng một đường không tốn gì.
        expect out_pd.opened_root == pd.opened_root
        True
      }

      // ── RECLAIM (nhận tLAMP từ account idle) ───────────────────────────
      Reclaim { proof } -> {
        // ── C-RECL-0: đang THU HỒI một account, không phải spend rỗng ──────
        // Ghim bởi `reclaim_spend_rong`.
        expect util.count_inputs_at_script(tx.inputs, account_script_hash) == 1
        let recl_acct_in = util.input_at_script(tx.inputs, account_script_hash)
        expect InlineDatum(rad) = recl_acct_in.datum
        expect recl_acct: FaucetAccount = rad

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
        // ── C-RECL-UNIQ-1: XOÁ khoá khỏi sổ ────────────────────────────────
        // Vế đối xứng của C-OPEN-UNIQ-1, và là vế làm cho INV-ONE-ACCT KHÔNG
        // khoá chết một DID: mỗi account bị thu hồi phải trả khoá lại, nếu không
        // thì một DID chỉ được dùng faucet đúng một lần trong cả đời hệ.
        // `mpf.delete` tự `expect` rằng `proof` chứng minh khoá ĐANG có trong
        // `pd.opened_root` trước khi trả về gốc đã xoá — nên không xoá khống được
        // một khoá không tồn tại để làm loãng sổ.
        //
        // `did` lấy từ datum của ĐÚNG account input mà C-RECL-0 vừa ép là duy
        // nhất. Datum đó KHÔNG đổi được trong suốt đời account (`Use`/`TopUp` đều
        // ép `out_acct.did_name == acct.did_name`, và C-NAME-1 neo nó vào tên ACCT
        // NFT lúc mở), nên nó là cùng một định danh với khoá đã được chèn.
        // Một UTxO GIẢ đặt ở địa chỉ account với datum khai `did_name` của người
        // khác KHÔNG đi tới đây được: chính nó cũng đang bị tiêu ⇒ `faucet_account`
        // phải chạy, mà cả ba nhánh của nó đều đóng (`Use`/`TopUp` đòi DID NFT của
        // nạn nhân, `ReclaimIdle` đòi đốt ACCT NFT của nạn nhân).
        // Ghim bởi `reclaim_goc_khong_xoa` · `reclaim_xoa_did_khac`.
        expect
          out_pd.opened_root == mpf.root(
            mpf.delete(
              mpf.from_root(pd.opened_root),
              did_key(recl_acct.did_name),
              did_leaf_value,
              proof,
            ),
          )
        // ── C-RECL-BURN-1: xoá khoá ⇔ ĐỐT ACCT NFT, trong CÙNG tx ───────────
        // Vế đối xứng của C-OPEN-1 (chèn khoá ⇔ đúc ACCT NFT). Không có dòng này,
        // INV-ONE-ACCT sập bằng một hình dạng tx hoàn toàn hợp lệ ở mọi chốt khác:
        // `pool.Reclaim` + `account.TopUp`. `Reclaim` chỉ đòi đúng 1 account input,
        // `lamp_out >= lamp_in` (chủ DID tự bỏ drip vào nên pool không mất gì) và
        // bộ đếm bảo toàn; `TopUp` giữ account SỐNG NGUYÊN cùng ACCT NFT của nó.
        // Kết quả: khoá bị xoá khỏi sổ trong khi account vẫn tồn tại ⇒ chính chủ DID
        // `ClaimOpen` được account THỨ HAI, và lặp lại bao nhiêu lần cũng được.
        // Đây là chỗ mà cách phân vai của bản trước KHÔNG còn đúng: lúc pool chưa
        // giữ sổ thì "canh việc đốt là việc của `faucet_account`" là đủ, vì pool
        // không thay đổi trạng thái toàn cục nào. Nay pool LÀ nơi ghi sổ, nên nó
        // phải tự canh điều kiện mà bút ghi của nó dựa vào.
        // Cổng này CHỒNG với C-TOP-4 (`TopUp` đòi mint == 0) — hai vế trái nhau ⇒
        // cặp `Reclaim`+`TopUp` bất khả thi ở CẢ HAI phía, cố ý giữ cả hai.
        // Ghim bởi `reclaim_khong_dot_acct_nft` · `reclaim_dot_acct_did_khac`.
        expect
          assets.quantity_of(
            tx.mint,
            faucet_nft_policy,
            acct_name(recl_acct.did_name),
          ) == -1
        // ── C-RECL-BURN-2: ĐÚNG MỘT mục dưới policy này ─────────────────────
        // C-RECL-BURN-1 nói "mục của ACCT bị thu hồi bằng −1"; nó KHÔNG nói gì về
        // các mục khác. Cặp hai dòng mới ép được `tx.mint` dưới `faucet_nft_policy`
        // = đúng `{an(d): −1}`, tức một lượt thu hồi không kèm một lượt ĐÚC.
        // Hai vế TRỰC GIAO (gỡ vế nào cũng còn một hình dạng lọt), nên cả hai đều
        // ghim được: `reclaim_dot_acct_did_khac` đỏ ở vế trên, `reclaim_dot_va_duc_them`
        // đỏ ở vế này.
        // TRÙNG LẶP có chủ ý, nói thẳng ra để lần dọn sau không gỡ: `faucet_nft`
        // đã ép `dict.size(own_tokens) == 1` ở CẢ BA nhánh của nó, và nó LUÔN chạy
        // khi `tx.mint` có mục nào dưới policy này ⇒ hôm nay hình dạng "đốt kèm
        // đúc" đã bất khả thi. Giữ vế này ở pool vì cùng một lý do đã viết cho
        // C-RECL-BURN-1: pool là nơi GHI SỔ, nên tiền đề của bút ghi của nó không
        // được đi vay hình dạng mà một script KHÁC tình cờ đang ép — script kia đổi
        // được mà pool không đổi một dòng nào.
        expect dict.size(assets.tokens(tx.mint, faucet_nft_policy)) == 1
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
        // C-ROOT-KEEP-1 (nhánh `TopUpPool`): nạp tiền cũng không đổi sổ. Cùng lý
        // do với vế ở `ClaimAgain` — nhánh này permissionless về phía ai nạp.
        expect out_pd.opened_root == pd.opened_root
        // ── C-MINT-ONLY-OPEN-2: `tx.mint` dưới policy này phải RỖNG ──────────
        // Nhánh này KHÔNG đọc `tx.mint` ở bản trước, và đó là lỗ đã đo được
        // (`[FAUCET-ACCT-MINT-GATE]`): `MintAccount` chỉ đòi POOL NFT input, mà một
        // lượt `TopUpPool` có POOL NFT input — nên một tx nạp tiền đúc kèm được một
        // ACCT NFT ra ví và CẢ HAI validator đều chấp nhận. Giá cho kẻ tấn công =
        // một lượt nạp `≥ drip` vào pool, tức nó còn có lãi khi ACCT NFT đó mở ra
        // một chuỗi cooldown thứ hai.
        // Vế RỖNG (không phải "không dương") cũng chặn `ReclaimIdle` mượn đường
        // nạp tiền để đốt: nhánh này đã cấm account input nên hình dạng đó vốn
        // không dựng được, và một vế rỗng thì không đòi ai đọc lại cổng kia mới
        // biết nó kín.
        // Ghim bởi `topuppool_duc_acct_hai_validator` · `topuppool_dot_acct`.
        expect dict.is_empty(assets.tokens(tx.mint, faucet_nft_policy))
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
  window_origin_ms: Int,
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
  let now = util.get_epoch_pinned(tx, ms_per_epoch, window_origin_ms)

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

// ── SỔ `opened_root` trong ca kiểm ────────────────────────────────
// Thư viện MPF KHÔNG có bộ dựng bằng chứng chạy on-chain (bằng chứng là việc của
// off-chain), nên mọi gốc dùng ở đây được dựng bằng CHÍNH `mpf.insert` — tức cùng
// một phép tính mà validator sẽ chạy — và mọi bằng chứng được viết tay theo đúng
// định dạng của thư viện. Hai hệ quả phải nhớ:
//   1. `fp_root_of` / `fp_root_of_two` KHÔNG phải hằng gõ tay ⇒ thư viện đổi cách
//      băm thì ca kiểm đi theo, không phân kỳ im lặng.
//   2. Hình dạng `Leaf{skip: 0, …}` chỉ đúng khi hai khoá KHÁC nhau ở nibble đầu
//      (nếu trùng thì cây thật có nút nhánh và `skip > 0`). `fp_did_name` và
//      `fp_other_did` đã được chọn thoả điều đó; `do_fork` của thư viện tự
//      `expect branch != neighbor.nibble` nên chọn sai là ĐỎ ngay, không lọt.

/// Gốc của sổ RỖNG.
fn fp_root_empty() -> ByteArray {
  empty_opened_root()
}

/// Bước bằng chứng "láng giềng ở nút này là lá của `did`". `key` là ĐƯỜNG ĐI
/// (`blake2b_256` của khoá MPF) và `value` là `blake2b_256` của giá trị lá — đây
/// là hình dạng thư viện đọc, không phải khoá/giá trị thô.
fn fp_leaf_step(did: ByteArray) -> mpf.ProofStep {
  mpf.Leaf {
    skip: 0,
    key: crypto.blake2b_256(did_key(did)),
    value: crypto.blake2b_256(did_leaf_value),
  }
}

/// Gốc của sổ chỉ chứa `did`.
fn fp_root_of(did: ByteArray) -> ByteArray {
  mpf.insert(mpf.empty, did_key(did), did_leaf_value, []) |> mpf.root
}

/// Gốc của sổ chứa `did_a` rồi `did_b` (chèn `did_b` bằng bằng chứng lá `did_a`).
fn fp_root_of_two(did_a: ByteArray, did_b: ByteArray) -> ByteArray {
  mpf.insert(
    mpf.from_root(fp_root_of(did_a)),
    did_key(did_b),
    did_leaf_value,
    [fp_leaf_step(did_a)],
  )
    |> mpf.root
}

/// PoolDatum với sổ đặt TƯỜNG MINH.
fn fp_pd_at(window: Int, claims: Int, root: ByteArray) -> PoolDatum {
  PoolDatum {
    cfg: fp_cfg(),
    window_epoch: window,
    claims_in_window: claims,
    opened_root: root,
  }
}

/// PoolDatum với sổ RỖNG — trạng thái pool khi `fp_did_name` CHƯA có account.
/// Đây là đầu VÀO của mọi ca `ClaimOpen`.
fn fp_pd(window: Int, claims: Int) -> PoolDatum {
  fp_pd_at(window, claims, fp_root_empty())
}

/// PoolDatum với sổ chứa đúng khoá của `fp_did_name` — trạng thái pool khi DID đó
/// ĐANG có account. Đây là đầu RA của `ClaimOpen`, và đầu VÀO của `ClaimAgain` /
/// `Reclaim`. Dùng `fp_pd` (sổ rỗng) ở những chỗ này là dựng một trạng thái
/// KHÔNG thoả INV-ONE-ACCT, tức đo một thứ không tồn tại trên chuỗi.
fn fp_pd_one(window: Int, claims: Int) -> PoolDatum {
  fp_pd_at(window, claims, fp_root_of(fp_did_name))
}

/// Như `fp_pd_one` nhưng cho `fp_other_did` — dùng ở ca nào account bị chạm là của
/// bob, không của alice.
fn fp_pd_other(window: Int, claims: Int) -> PoolDatum {
  fp_pd_at(window, claims, fp_root_of(fp_other_did))
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

/// `ClaimOpen` với bằng chứng RỖNG. Đúng cho mọi ca mở account trên một sổ RỖNG:
/// `excluding(key, [])` của thư viện trả về gốc rỗng, nên bằng chứng rỗng CHÍNH LÀ
/// bằng chứng vắng mặt hợp lệ ở trạng thái đó. Sổ đã có khoá thì phải nộp bằng
/// chứng thật — xem `open_did_thu_hai_chen_vao_cay_co_san`.
const fp_open: PoolRedeemer = ClaimOpen { proof: [] }

/// `Reclaim` với bằng chứng RỖNG. Đúng cho sổ chỉ có ĐÚNG MỘT khoá:
/// `including(key, value, [])` là gốc của cây một lá.
const fp_reclaim: PoolRedeemer = Reclaim { proof: [] }

fn fp_run(pd: PoolDatum, r: PoolRedeemer, tx: Transaction) -> Bool {
  faucet_pool.spend(
    fp_nft_policy,
    fp_did_policy,
    fp_lamp_policy,
    fp_lamp_name,
    fp_ms_per_epoch,
    fp_acct_sh,
    0,
    Some(pd),
    r,
    util.mk_ref(0),
    tx,
  )
}

// ── Gốc cửa sổ (Specs/Window/CONTRACT.md v1.0, WIN-ORIGIN-1..3) ─────────────────
// Bản của `fp_run` nhận gốc `origin` và dời mọi biên hữu hạn của validity range đi
// `shift`. `(o, o)`: cùng kịch bản dời sang lưới có gốc ⇒ kết quả phải y như bản gốc 0.
// `(0, o)`: validator QUÊN gốc trên tx đã dời ⇒ phải bị chặn.
fn fp_run_at(origin: Int, shift: Int, pd: PoolDatum, r: PoolRedeemer, tx: Transaction) -> Bool {
  faucet_pool.spend(
    fp_nft_policy,
    fp_did_policy,
    fp_lamp_policy,
    fp_lamp_name,
    fp_ms_per_epoch,
    fp_acct_sh,
    origin,
    Some(pd),
    r,
    util.mk_ref(0),
    window_origin_fixtures.shift_tx(tx, shift),
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
  let pd_out = fp_pd_one(now, fp_used(now, window, claims) + 1)
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

/// Builder cho lớp ca về SỔ: DID mở account và cả hai gốc đặt TƯỜNG MINH. Mọi
/// thứ khác giữ đúng hình dạng của ca dương, nên hai cực của một cặp chỉ khác
/// nhau ở đúng cái đang thử.
fn open_tx_for(
  did: ByteArray,
  now: Int,
  window: Int,
  claims: Int,
  root_in: ByteArray,
  root_out: ByteArray,
) -> Transaction {
  fp_tx_at(
    now,
    Transaction {
      ..placeholder,
      inputs: [
        fp_pool_input(fp_pd_at(window, claims, root_in)),
        fp_did_input(did),
      ],
      outputs: [
        fp_pool_output(
          fp_pd_at(now, fp_used(now, window, claims) + 1, root_out),
          fp_pool_lamp - fp_drip,
        ),
        fp_acct_output(did, now, now, fp_drip),
      ],
      mint: fp_mint(did, 1),
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
  fp_run(fp_pd(100, 0), fp_open, open_std(100, 100, 0))
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
  fp_run(fp_pd(100, 0), fp_open, tx)
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
  fp_run(fp_pd(100, 0), fp_open, tx)
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
  fp_run(fp_pd(100, 0), fp_open, tx)
}

/// C-DRIP-1: pool nhả nhiều hơn drip.
test claim_pool_drain_extra() fail {
  let pd_out = fp_pd_one(100, 1)
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
  fp_run(fp_pd(100, 0), fp_open, tx)
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
  fp_run(fp_pd(100, 0), fp_open, tx)
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
  fp_run(fp_pd(100, 0), fp_open, tx)
}

/// C-DID-1: không có DID NFT input.
test claim_no_did_nft() fail {
  let pd_out = fp_pd_one(100, 1)
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
  fp_run(fp_pd(100, 0), fp_open, tx)
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
  fp_run(fp_pd(100, 0), fp_open, open_tx_with(100, 100, 0, acct_out, fp_mint(fp_did_name, 1), [], []))
}

/// C-ACCTOUT-1: acct_out ở một script hash KHÁC.
test claim_acct_out_script_khac() fail {
  let acct_out =
    util.mk_output(
      util.script_address(#"dead01"),
      fp_acct_val(fp_did_name, 2_000_000, fp_drip),
      fp_acct_datum(fp_did_name, 100, 100),
    )
  fp_run(fp_pd(100, 0), fp_open, open_tx_with(100, 100, 0, acct_out, fp_mint(fp_did_name, 1), [], []))
}

/// C-ACCTOUT-2: cùng script hash, khác stake credential.
test claim_acct_out_stake_hijack() fail {
  let acct_out =
    util.mk_output(
      util.script_address_staked(fp_acct_sh, fp_thief_pkh),
      fp_acct_val(fp_did_name, 2_000_000, fp_drip),
      fp_acct_datum(fp_did_name, 100, 100),
    )
  fp_run(fp_pd(100, 0), fp_open, open_tx_with(100, 100, 0, acct_out, fp_mint(fp_did_name, 1), [], []))
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
  fp_run(fp_pd(100, 0), fp_open, open_tx_with(100, 100, 0, acct_out, fp_mint(fp_did_name, 1), [], []))
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
  fp_run(fp_pd(100, 0), fp_open, open_tx_with(100, 100, 0, acct_out, fp_mint(fp_did_name, 1), [], []))
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
  fp_run(fp_pd(100, 0), fp_open, tx)
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
    PoolDatum {
      cfg: bad_cfg,
      window_epoch: 100,
      claims_in_window: 1,
      opened_root: fp_root_of(fp_did_name),
    }
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
  fp_run(fp_pd(100, 0), fp_open, tx)
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
  let pd_in =
    PoolDatum {
      cfg: bad_cfg,
      window_epoch: 100,
      claims_in_window: 0,
      opened_root: fp_root_empty(),
    }
  let pd_out =
    PoolDatum {
      cfg: bad_cfg,
      window_epoch: 100,
      claims_in_window: 1,
      opened_root: fp_root_of(fp_did_name),
    }
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
  fp_run(pd_in, fp_open, tx)
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
  fp_run(fp_pd(100, 0), fp_open, tx)
}

// ── TRẦN TỐC ĐỘ (tầng a) ─────────────────────────────────────────

/// Ca dương song sinh của `poc_vet_N_lan_trong_mot_cua_so`: claim thứ `max`
/// trong cửa sổ phải XANH. Không có ca này, cặp không phân biệt được hai cực.
test rate_claim_thu_max_pass() {
  fp_run(fp_pd(100, fp_max_claims - 1), fp_open, open_std(100, 100, fp_max_claims - 1))
}

/// C-RATE-2: claim thứ `max + 1` trong cùng cửa sổ.
test poc_vet_N_lan_trong_mot_cua_so() fail {
  fp_run(fp_pd(100, fp_max_claims), fp_open, open_std(100, 100, fp_max_claims))
}

/// Cửa sổ mới reset bộ đếm: datum vào đầy quota của cửa sổ CŨ vẫn xanh.
test rate_cua_so_moi_reset() {
  fp_run(fp_pd(99, fp_max_claims), fp_open, open_std(100, 99, fp_max_claims))
}

/// C-RATE-1: `now` nhỏ hơn `window_epoch` trong datum.
test rate_window_lui_ve_qua_khu() fail {
  fp_run(fp_pd(200, 0), fp_open, open_std(100, 200, 0))
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
          fp_pool_output(fp_pd_one(100, 3), fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 100, 100, fp_drip),
        ],
        mint: fp_mint(fp_did_name, 1),
      },
    )
  fp_run(fp_pd(100, 3), fp_open, tx)
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
          fp_pool_output(fp_pd_one(101, 1), fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 100, 100, fp_drip),
        ],
        mint: fp_mint(fp_did_name, 1),
      },
    )
  fp_run(fp_pd(100, 0), fp_open, tx)
}

/// C-RATE-0: cận trên VÔ HẠN ⇒ `now` là trường do người dựng tx đặt. Mọi thứ
/// khác y hệt `open_happy`.
test rate_upper_bound_vo_han() fail {
  let pd_out = fp_pd_one(100, 1)
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
  fp_run(fp_pd(100, 0), fp_open, tx)
}

/// C-RATE-0 — ca leo thang bậc thang. Thời gian THẬT ở bucket 101; kẻ tấn công
/// khai bucket 100 bằng cách để `lo` ở bucket 100 và `hi` chớm sang bucket 101
/// (khoảng nằm TRỌN trong quá khứ thì chính ledger từ chối, nên đây là hình dạng
/// duy nhất còn lại). Mỗi bucket quá khứ khai được là một quota mới ⇒ trần tốc
/// độ bị vượt trong CÙNG một cửa sổ thật.
test rate_leo_thang_bac_thang() fail {
  let pd_out = fp_pd_one(100, 1)
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
  fp_run(fp_pd(100, 0), fp_open, tx)
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
      inputs: [fp_pool_input(fp_pd_one(now, 0)), acct_in, fp_did_input(fp_did_name)],
      outputs: [
        fp_pool_output(fp_pd_one(now, 1), fp_pool_lamp - fp_drip),
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
  fp_run(fp_pd_one(136, 0), ClaimAgain, again_std(136, 100))
}

/// C-COOL-1: thiếu đúng một cửa sổ.
test again_cooldown_thieu_1_epoch() fail {
  fp_run(fp_pd_one(135, 0), ClaimAgain, again_std(135, 100))
}

/// C-AGAIN-2: `ClaimAgain` mà KHÔNG kèm account cũ — đường né cooldown.
test poc_claim_khong_kem_account_cu() fail {
  let tx =
    fp_tx_at(
      136,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(fp_pd_one(136, 0)), fp_did_input(fp_did_name)],
        outputs: [
          fp_pool_output(fp_pd_one(136, 1), fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 136, 136, fp_drip * 2),
        ],
        mint: assets.zero,
      },
    )
  fp_run(fp_pd_one(136, 0), ClaimAgain, tx)
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
        inputs: [fp_pool_input(fp_pd_one(136, 0)), acct_a, acct_b, fp_did_input(fp_did_name)],
        outputs: [
          fp_pool_output(fp_pd_one(136, 1), fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 136, 136, fp_drip * 2),
          thief_out,
        ],
      },
    )
  fp_run(fp_pd_one(136, 0), ClaimAgain, tx)
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
  fp_run(fp_pd_one(136, 0), ClaimAgain, tx)
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
          fp_pool_input(fp_pd_one(136, 0)),
          acct_in,
          fp_did_input(fp_did_name),
        ],
        outputs: [
          fp_pool_output(fp_pd_one(136, 1), fp_pool_lamp - fp_drip),
          fp_acct_output(fp_did_name, 136, 136, fp_drip * 2),
        ],
        mint: assets.zero,
      },
    )
  fp_run(fp_pd_one(136, 0), ClaimAgain, tx)
}

/// C-MINT-ONLY-OPEN-1: đúc thêm ACCT NFT (cùng tên) ở nhánh `ClaimAgain`. Ca này
/// từng ghim chốt cũ C-AGAIN-1; nay nó đỏ ở chốt thay thế, và cực "tên KHÁC" —
/// hình dạng mà C-AGAIN-1 để lọt — nằm ở `again_duc_acct_did_khac_ba_validator`.
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
  fp_run(fp_pd_one(136, 0), ClaimAgain, tx)
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
  fp_run(fp_pd_one(136, 0), ClaimAgain, tx)
}

// ── RECLAIM ──────────────────────────────────────────────────────
// `reclaim_happy` mang `claims_in_window = max` ở datum vào: với 0/0 thì
// C-RECL-2 thoả tầm thường và ca dương không chứng minh bộ đếm được BẢO TOÀN,
// chỉ chứng minh 0 == 0.

// Sổ `opened_root` trong nhánh này: đầu VÀO chứa khoá của DID bị thu hồi, đầu RA
// KHÔNG còn nó. `fp_pd_one` / `fp_pd` đứng đúng hai vai đó (xem chú thích của
// chúng). Mọi ca âm dưới đây giữ phép chuyển sổ HỢP LỆ và chỉ sai ĐÚNG một thứ
// khác — nếu để sai hai thứ thì ablation chốt mang tên ca vẫn thấy ca đỏ và ta kết
// luận sai rằng chốt đó đang được canh.

fn fp_reclaim_acct_input_for(did: ByteArray) -> Input {
  util.mk_input(
    util.mk_ref(3),
    util.mk_output(
      util.script_address(fp_acct_sh),
      fp_acct_val(did, 2_000_000, fp_drip),
      fp_acct_datum(did, 100, 100),
    ),
  )
}

fn fp_reclaim_acct_input() -> Input {
  fp_reclaim_acct_input_for(fp_did_name)
}

fn reclaim_tx_mint(
  pd_in: PoolDatum,
  pool_out: Output,
  inputs_extra: List<Input>,
  mint: assets.Value,
) -> Transaction {
  fp_tx_at(
    2000,
    Transaction {
      ..placeholder,
      inputs: list_concat([fp_pool_input(pd_in)], inputs_extra),
      outputs: [pool_out],
      mint: mint,
    },
  )
}

/// `Reclaim` hợp lệ ĐỐT ACCT NFT của `fp_did_name` (C-RECL-BURN-1), nên việc đốt
/// nằm trong builder dùng chung: mọi ca âm bên dưới nhờ vậy chỉ còn sai ĐÚNG cái
/// chúng mang tên.
fn reclaim_tx_with(pd_in: PoolDatum, pool_out: Output, inputs_extra: List<Input>) -> Transaction {
  reclaim_tx_mint(pd_in, pool_out, inputs_extra, fp_mint(fp_did_name, -1))
}

test reclaim_happy() {
  let pd = fp_pd_one(100, fp_max_claims)
  let tx =
    reclaim_tx_with(
      pd,
      fp_pool_output(fp_pd(100, fp_max_claims), fp_pool_lamp + fp_drip),
      [fp_reclaim_acct_input()],
    )
  fp_run(pd, fp_reclaim, tx)
}

/// C-RECL-0: cửa spend RỖNG — không account input, Δ = 0, output y hệt input.
/// Giá = một phí tx, lặp mỗi block ⇒ mọi claim của người thật trượt vĩnh viễn.
/// Sổ ở đây CỐ Ý để nguyên (không xoá gì): với 0 account input thì không có
/// `did_name` nào để xoá, nên không tồn tại hình dạng tx hợp lệ ở nhánh này. Ca
/// dừng ở C-RECL-0 — dòng ĐẦU TIÊN của nhánh — nên nó không chạm tới chốt sổ.
test reclaim_spend_rong() fail {
  let pd = fp_pd(100, fp_max_claims)
  let tx = reclaim_tx_with(pd, fp_pool_output(pd, fp_pool_lamp), [])
  fp_run(pd, fp_reclaim, tx)
}

/// C-RECL-2: xen một `Reclaim` để reset bộ đếm ⇒ trần tốc độ vô hiệu.
test reclaim_reset_bo_dem() fail {
  let pd = fp_pd_one(100, fp_max_claims)
  let tx =
    reclaim_tx_with(
      pd,
      fp_pool_output(fp_pd(100, 0), fp_pool_lamp + fp_drip),
      [fp_reclaim_acct_input()],
    )
  fp_run(pd, fp_reclaim, tx)
}

/// C-RECL-1: đổi `window_epoch` qua `Reclaim`.
test reclaim_doi_window() fail {
  let pd = fp_pd_one(100, fp_max_claims)
  let tx =
    reclaim_tx_with(
      pd,
      fp_pool_output(fp_pd(101, fp_max_claims), fp_pool_lamp + fp_drip),
      [fp_reclaim_acct_input()],
    )
  fp_run(pd, fp_reclaim, tx)
}

test reclaim_pool_loses() fail {
  let pd = fp_pd_one(100, fp_max_claims)
  let tx =
    reclaim_tx_with(
      pd,
      fp_pool_output(fp_pd(100, fp_max_claims), fp_pool_lamp - fp_drip),
      [fp_reclaim_acct_input()],
    )
  fp_run(pd, fp_reclaim, tx)
}

test reclaim_steal_ada() fail {
  let pd = fp_pd_one(100, fp_max_claims)
  let pool_out =
    util.mk_output(
      util.script_address(fp_pool_sh),
      fp_pool_val(2_000_000, fp_pool_lamp + fp_drip),
      fp_pd(100, fp_max_claims),
    )
  let tx = reclaim_tx_with(pd, pool_out, [fp_reclaim_acct_input()])
  fp_run(pd, fp_reclaim, tx)
}

// ── TOPUPPOOL ────────────────────────────────────────────────────

fn topuppool_tx_mint(
  pd: PoolDatum,
  delta: Int,
  inputs_extra: List<Input>,
  pd_out: PoolDatum,
  mint: assets.Value,
) -> Transaction {
  fp_tx_at(
    2000,
    Transaction {
      ..placeholder,
      inputs: list_concat([fp_pool_input(pd)], inputs_extra),
      outputs: [fp_pool_output(pd_out, fp_pool_lamp + delta)],
      mint: mint,
    },
  )
}

fn topuppool_tx(pd: PoolDatum, delta: Int, inputs_extra: List<Input>, pd_out: PoolDatum) -> Transaction {
  topuppool_tx_mint(pd, delta, inputs_extra, pd_out, assets.zero)
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
  let pd = fp_pd_one(100, fp_max_claims)
  let pool_out =
    util.mk_output(
      util.vk_address(fp_thief_pkh),
      fp_pool_val(10_000_000, fp_pool_lamp + fp_drip),
      fp_pd(100, fp_max_claims),
    )
  fp_run(pd, fp_reclaim, reclaim_tx_with(pd, pool_out, [fp_reclaim_acct_input()]))
}

test poc_reclaim_pool_stake_hijack() fail {
  let pd = fp_pd_one(100, fp_max_claims)
  let pool_out =
    util.mk_output(
      util.script_address_staked(fp_pool_sh, fp_thief_pkh),
      fp_pool_val(10_000_000, fp_pool_lamp + fp_drip),
      fp_pd(100, fp_max_claims),
    )
  fp_run(pd, fp_reclaim, reclaim_tx_with(pd, pool_out, [fp_reclaim_acct_input()]))
}

test poc_reclaim_pool_script_carrier() fail {
  let pd = fp_pd_one(100, fp_max_claims)
  let pool_out =
    util.mk_output_with_ref_script(
      util.script_address(fp_pool_sh),
      fp_pool_val(10_000_000, fp_pool_lamp + fp_drip),
      fp_pd(100, fp_max_claims),
      #"beef",
    )
  fp_run(pd, fp_reclaim, reclaim_tx_with(pd, pool_out, [fp_reclaim_acct_input()]))
}

/// Tấn công qua ClaimOpen: drip đúng, quota đúng, DID đúng — chỉ pool_out về ví.
test poc_claim_pool_to_wallet() fail {
  let pool_out =
    util.mk_output(
      util.vk_address(fp_thief_pkh),
      fp_pool_val(10_000_000, fp_pool_lamp - fp_drip),
      fp_pd_one(100, 1),
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
  fp_run(fp_pd(100, 0), fp_open, tx)
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
  fp_run(pd, fp_reclaim, tx)
}

// ══════════════════════════════════════════════════════════════
// HAI VALIDATOR MỘT TX
// ══════════════════════════════════════════════════════════════
// Mọi ca phía trên gọi ĐÚNG MỘT validator. Lớp ca dưới đây gọi cả hai script
// thật sự chạy trên cùng một `Transaction` — đó là phép đo duy nhất bắt được
// lớp lỗi "hai bên đòi trái nhau": một luồng có thể xanh ở mọi bài đơn vị và
// vẫn KHÔNG có hình dạng giao dịch nào tiêu được.
//
// Một luồng KHÔNG có ca DƯƠNG loại này, và đó là tính chất của thiết kế chứ
// không phải chỗ thiếu:
//   - `Use`        — C-USE-NOPOOL-1 cấm POOL NFT input ⇒ không tx nào gọi được
//                    cả hai. Cực đối xứng nằm ở `use_co_pool_input`
//                    (`faucet_account.ak`) và `again_account_dung_redeemer_Use`.
//
// `TopUpPool` thì KHÔNG có ca dương hai-validator (cấm account input ⇒
// `faucet_account` không chạy; cực đối xứng: `topuppool_co_account_input`) nhưng
// CÓ ca âm hai-validator với mint policy — `topuppool_duc_acct_hai_validator`.
// Bản trước bản vá này ghi ở đây rằng `TopUpPool` "không đúc gì", và câu đó là
// một khẳng định về mã mà mã không ép: nó đọc như một lý do để KHÔNG viết ca,
// nên nó tự bảo vệ đúng cái lỗ mà nó mô tả sai.

const fp_acct_ref_ix: Int = 3

fn fp_acct_run(r: AccountRedeemer, datum: FaucetAccount, tx: Transaction) -> Bool {
  handlers.account_spend(
    fp_nft_policy,
    fp_did_policy,
    fp_lamp_policy,
    fp_lamp_name,
    fp_ms_per_epoch,
    0,
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
    fp_run(fp_pd(100, 0), fp_open, tx),
    fp_nft_run(MintAccount, tx),
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
    fp_run(fp_pd_one(136, 0), ClaimAgain, tx),
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
  let pd = fp_pd_one(100, fp_max_claims)
  let tx =
    fp_tx_at(
      2000,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(pd), fp_reclaim_acct_input()],
        outputs: [
          fp_pool_output(fp_pd(100, fp_max_claims), fp_pool_lamp + fp_drip),
        ],
        mint: fp_mint(fp_did_name, -1),
      },
    )
  and {
    fp_run(pd, fp_reclaim, tx),
    fp_acct_run(ReclaimIdle, fp_acct_datum(fp_did_name, 100, 100), tx),
  }
}

/// Account RỖNG (0 tLAMP, chỉ còn ACCT NFT + ADA) — đầu vào của ca thu hồi account rỗng.
fn fp_reclaim_acct_input_rong(touch_ep: Int) -> Input {
  util.mk_input(
    util.mk_ref(fp_acct_ref_ix),
    util.mk_output(
      util.script_address(fp_acct_sh),
      fp_acct_val(fp_did_name, 2_000_000, 0),
      fp_acct_datum(fp_did_name, touch_ep, touch_ep),
    ),
  )
}

fn reclaim_rong_tx(touch_ep: Int) -> Transaction {
  fp_tx_at(
    2000,
    Transaction {
      ..placeholder,
      inputs: [
        fp_pool_input(fp_pd_one(100, fp_max_claims)),
        fp_reclaim_acct_input_rong(touch_ep),
      ],
      outputs: [fp_pool_output(fp_pd(100, fp_max_claims), fp_pool_lamp)],
      mint: fp_mint(fp_did_name, -1),
    },
  )
}

/// Thu hồi account 0 tLAMP: pool nhận thêm 0, vẫn xoá khoá DID và đốt ACCT NFT.
/// Từ v3.1 đây là đường DUY NHẤT trả khoá của một DID đã rút sạch account về sổ,
/// nên cả hai validator phải CHẤP NHẬN nó (SDK từng từ chối ca này ở RECLAIM-003).
test reclaim_idle_account_rong_hai_validator() {
  let tx = reclaim_rong_tx(2000 - 72)
  and {
    fp_run(fp_pd_one(100, fp_max_claims), fp_reclaim, tx),
    fp_acct_run(ReclaimIdle, fp_acct_datum(fp_did_name, 2000 - 72, 2000 - 72), tx),
  }
}

/// Song sinh âm: cùng account rỗng, idle 71 cửa sổ ⇒ `faucet_account` ĐỎ ở cổng idle.
/// Account rỗng không được miễn ngưỡng thu hồi.
test reclaim_idle_account_rong_chua_du_72() fail {
  let tx = reclaim_rong_tx(2000 - 71)
  fp_acct_run(ReclaimIdle, fp_acct_datum(fp_did_name, 2000 - 71, 2000 - 71), tx)
}

/// Cùng tx thu hồi, nhưng bỏ bước đốt ACCT NFT ⇒ NAY cả hai validator đều ĐỎ:
/// `faucet_pool` ở C-RECL-BURN-1, `faucet_account` ở C-BURN-1. Giữ cả hai cổng là
/// cố ý, không phải trùng lặp: `faucet_account.ReclaimIdle` chỉ đòi POOL NFT có mặt
/// trong tx, nó KHÔNG đòi POOL NFT nằm ở script pool — nên nếu POOL NFT lạc ra ví
/// thì `faucet_pool.spend` không được gọi và C-BURN-1 là cổng duy nhất còn đứng.
/// Cực đơn-validator của C-BURN-1 nằm ở `reclaim_idle_khong_burn_acct`
/// (`faucet_account.ak`), nên chốt đó vẫn có ca ghim riêng.
test reclaim_idle_khong_burn_hai_validator() fail {
  let pd = fp_pd_one(100, fp_max_claims)
  let tx =
    fp_tx_at(
      2000,
      Transaction {
        ..placeholder,
        inputs: [fp_pool_input(pd), fp_reclaim_acct_input()],
        outputs: [
          fp_pool_output(fp_pd(100, fp_max_claims), fp_pool_lamp + fp_drip),
        ],
      },
    )
  and {
    fp_run(pd, fp_reclaim, tx),
    fp_acct_run(ReclaimIdle, fp_acct_datum(fp_did_name, 100, 100), tx),
  }
}

// ── HÌNH DẠNG `Reclaim` + `TopUp` — BA cổng cùng đóng ────────────────────
// Kịch bản: một tx tiêu account của bob, TỰ BỎ `drip` tLAMP vào (nên C-TOP-5 về
// dòng tiền thoả), pool không mất gì (Δ = 0 nên C-RECL-* thoả). Hình dạng này đáng
// một khối riêng vì nó là chỗ hai lớp lỗ KHÁC NHAU gặp nhau, và cả hai đều nằm
// ngoài mọi ca đơn validator:
//
//   (1) GRIEFING — nó GHI `last_claim_epoch = now` của bob, tức hoãn lần claim kế
//       tiếp của bob thêm `cooldown_epochs` cửa sổ và hoãn cả `ReclaimIdle`. Không
//       cần DID NFT của bob nếu thiếu C-TOP-DID-1 (cổng ở `faucet_account`).
//   (2) PHÁ INV-ONE-ACCT — `Reclaim` XOÁ khoá của bob khỏi sổ trong khi `TopUp`
//       giữ account của bob SỐNG NGUYÊN cùng ACCT NFT. Người giữ DID NFT của bob
//       làm được (nên (1) không chặn anh ta) và sau đó `ClaimOpen` account thứ hai.
//       Cổng đóng đường này là C-RECL-BURN-1 ở pool.
//
// Hai cổng ở hai tệp, chặn hai thứ khác nhau, và KHÔNG cái nào thay được cái kia:
// bỏ C-TOP-DID-1 thì người ngoài griefing được người thật; bỏ C-RECL-BURN-1 thì
// người giữ DID NFT nhân bản account của mình. Cổng thứ ba (C-TOP-4, `TopUp` đòi
// mint == 0) phủ chồng lên C-RECL-BURN-1 — giữ cả ba.

fn topup_griefing_tx() -> Transaction {
  let pd = fp_pd_other(100, fp_max_claims)
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
        // Pool KHÔNG mất gì: Δ tLAMP = 0, bộ đếm y nguyên. Sổ thì PHẢI xoá khoá
        // của bob — nhánh `Reclaim` không có đường nào bỏ bước đó.
        fp_pool_output(fp_pd(100, fp_max_claims), fp_pool_lamp),
        // Account của bob nhận thêm drip, nhưng mốc cooldown bị đẩy lên now.
        fp_acct_output(fp_other_did, 2000, 2000, fp_drip * 2),
      ],
    },
  )
}

/// C-RECL-BURN-1 ở PHÍA POOL: cùng hình dạng đó, `faucet_pool.Reclaim` một mình đã
/// phải từ chối, vì nó xoá khoá của bob khỏi sổ mà không đốt ACCT NFT của bob.
/// Trước khi pool giữ sổ, cực này là XANH và điều đó ĐÚNG (pool không đổi trạng
/// thái toàn cục nào nên không có lý do canh mint). Nay nó phải ĐỎ.
test reclaim_khong_dot_acct_nft() fail {
  fp_run(fp_pd_other(100, fp_max_claims), fp_reclaim, topup_griefing_tx())
}

/// Cùng tx đó, cả hai validator đều từ chối — mỗi bên vì một lý do khác:
/// `faucet_pool` vì C-RECL-BURN-1, `faucet_account` vì C-TOP-DID-1 (thiếu DID NFT
/// của bob) và C-TOP-4 (mint phải bằng 0).
test topup_griefing_hai_validator() fail {
  let tx = topup_griefing_tx()
  and {
    fp_run(fp_pd_other(100, fp_max_claims), fp_reclaim, tx),
    fp_acct_run(TopUp, fp_acct_datum(fp_other_did, 100, 100), tx),
  }
}

/// C-RECL-BURN-1: đốt ACCT NFT của một DID KHÁC (giữ lại vé của chính mình). Cùng
/// builder với `reclaim_happy`, đổi ĐÚNG tên bị đốt. Không có vế "đúng tên" thì một
/// lượt thu hồi bất kỳ trả được khoá của mình về sổ bằng cách đốt một ACCT NFT rẻ
/// tiền khác.
test reclaim_dot_acct_did_khac() fail {
  let pd = fp_pd_one(100, fp_max_claims)
  fp_run(
    pd,
    fp_reclaim,
    reclaim_tx_mint(
      pd,
      fp_pool_output(fp_pd(100, fp_max_claims), fp_pool_lamp + fp_drip),
      [fp_reclaim_acct_input()],
      fp_mint(fp_other_did, -1),
    ),
  )
}

// ══════════════════════════════════════════════════════════════
// ĐÚC ACCT NFT NGOÀI `ClaimOpen` (H-MINT) — C-MINT-ONLY-OPEN-1/2, C-RECL-BURN-2
// ══════════════════════════════════════════════════════════════
// Lớp ca này KHÔNG dựng được bằng một validator: cái làm nên lỗ là `faucet_nft ▸
// MintAccount` uỷ quyền cho pool trong khi pool không canh `tx.mint` ở nhánh đang
// chạy. Nên mỗi ca âm dưới đây đi kèm một ca DƯƠNG khẳng định (các) script KHÁC
// **chấp nhận** đúng tx đó — thiếu cực dương thì ca âm không nói được nó đỏ ở
// pool hay đỏ ở chỗ khác, và một lần dọn sau có thể gỡ cổng ở pool mà bộ kiểm
// vẫn đỏ đúng tên ca.

/// Hằng `genesis_ref` cho mọi lượt gọi `nft_mint` ở lớp ca này. Nhánh
/// `MintAccount`/`BurnAccount` KHÔNG đọc nó (chỉ `MintPool` đọc), nên giá trị là
/// tuỳ ý — viết ra một chỗ để không ai đọc nó thành một tiền đề.
const fp_genesis_ref: OutputReference =
  OutputReference { transaction_id: #"aa", output_index: 5 }

fn fp_nft_run(r: FaucetNftRedeemer, tx: Transaction) -> Bool {
  handlers.nft_mint(fp_genesis_ref, fp_ms_per_epoch, 0, r, fp_nft_policy, tx)
}

/// PoC đã đo 2026-09-28: một tx `TopUpPool` hợp lệ kèm đúc ACCT NFT của alice.
/// Không có account input, không có account output — ACCT NFT đi thẳng ra ví kẻ
/// dựng tx (mock tx không ràng buộc nơi token đến; trên chuỗi thì đó là một output
/// ví bất kỳ).
fn topuppool_duc_acct_tx() -> Transaction {
  let pd = fp_pd(100, fp_max_claims)
  topuppool_tx_mint(pd, fp_drip * 1000, [], pd, fp_mint(fp_did_name, 1))
}

/// Cực DƯƠNG của PoC: mint policy CHẤP NHẬN tx đó. Đây là dòng nói rằng
/// `faucet_nft` không phải cổng — nó đòi đúng một tên ACCT hình dạng đúng và một
/// POOL NFT input, cả ba đều có. Nếu ca này thành đỏ thì ca âm bên dưới mất nghĩa
/// và phải viết lại, đừng đọc nó là "đã kín hơn".
test topuppool_duc_acct_mint_policy_chap_nhan() {
  fp_nft_run(MintAccount, topuppool_duc_acct_tx())
}

/// C-MINT-ONLY-OPEN-2 — PoC dựng lại: hai validator trên MỘT tx. Trước bản vá cả
/// hai đều XANH (lỗ `[FAUCET-ACCT-MINT-GATE]`); nay `faucet_pool` từ chối.
test topuppool_duc_acct_hai_validator() fail {
  let tx = topuppool_duc_acct_tx()
  and {
    fp_run(fp_pd(100, fp_max_claims), TopUpPool, tx),
    fp_nft_run(MintAccount, tx),
  }
}

/// C-MINT-ONLY-OPEN-2, chiều ĐỐT (H-EXIT): một lượt nạp tiền tiện tay đốt một ACCT
/// NFT. Vế "RỖNG" chặn cả chiều này; vế "không dương" thì không. Trên chuỗi hình
/// dạng này còn cần ACCT NFT có mặt trong input, mà nhánh `TopUpPool` cấm account
/// input — nên ca đo ĐÚNG cổng ở pool, không đo phép bảo toàn value của ledger.
test topuppool_dot_acct() fail {
  let pd = fp_pd(100, fp_max_claims)
  fp_run(
    pd,
    TopUpPool,
    topuppool_tx_mint(pd, fp_drip * 1000, [], pd, fp_mint(fp_did_name, -1)),
  )
}

/// Tx `ClaimAgain` của alice, đúc kèm ACCT NFT của một DID KHÁC (bob). Chốt cũ
/// C-AGAIN-1 chỉ so tên của alice nên hình dạng này đi lọt.
fn again_duc_acct_did_khac_tx() -> Transaction {
  again_tx_with(
    136,
    100,
    fp_drip,
    fp_acct_output(fp_did_name, 136, 136, fp_drip * 2),
    fp_mint(fp_other_did, 1),
    fp_did_name,
  )
}

/// Cực DƯƠNG: HAI script kia đều chấp nhận tx đó — `faucet_account ▸ TopUp` (C-TOP-4
/// chỉ so `an` của alice, bằng 0) và `faucet_nft ▸ MintAccount` (đúng một tên, đúng
/// hình dạng, có POOL input). Chỉ pool mới là cổng.
test again_duc_acct_did_khac_hai_script_kia_chap_nhan() {
  let tx = again_duc_acct_did_khac_tx()
  and {
    fp_acct_run(TopUp, fp_acct_datum(fp_did_name, 100, 100), tx),
    fp_nft_run(MintAccount, tx),
  }
}

/// C-MINT-ONLY-OPEN-1: BA script trên một tx. Trước bản vá cả ba XANH ⇒ bob có một
/// ACCT NFT ngoài sổ trong khi alice claim lại đúng luật.
test again_duc_acct_did_khac_ba_validator() fail {
  let tx = again_duc_acct_did_khac_tx()
  and {
    fp_run(fp_pd_one(136, 0), ClaimAgain, tx),
    fp_acct_run(TopUp, fp_acct_datum(fp_did_name, 100, 100), tx),
    fp_nft_run(MintAccount, tx),
  }
}

/// C-RECL-BURN-2: thu hồi account của alice (đốt ACCT của alice, hợp lệ ở
/// C-RECL-BURN-1) mà tiện tay ĐÚC ACCT của bob. Ca chỉ gọi POOL: `faucet_nft` cũng
/// từ chối hình dạng này (`dict.size(own_tokens) == 1` ở cả ba nhánh), nên một ca
/// `and {pool, nft}` sẽ đỏ dù có gỡ cổng ở pool — tức nó không ghim được gì.
test reclaim_dot_va_duc_them() fail {
  let pd = fp_pd_one(100, fp_max_claims)
  fp_run(
    pd,
    fp_reclaim,
    reclaim_tx_mint(
      pd,
      fp_pool_output(fp_pd(100, fp_max_claims), fp_pool_lamp + fp_drip),
      [fp_reclaim_acct_input()],
      fp_mint(fp_did_name, -1) |> assets.add(fp_nft_policy, acct_name(fp_other_did), 1),
    ),
  )
}

/// Cực đối xứng của ca trên ở phía mint policy — dán nhãn cho câu "nft cũng từ
/// chối" ở docstring trên, để nó là một phép đo chứ không phải một lời khẳng định.
test reclaim_dot_va_duc_them_nft_cung_tu_choi() fail {
  fp_nft_run(
    BurnAccount,
    reclaim_tx_mint(
      fp_pd_one(100, fp_max_claims),
      fp_pool_output(fp_pd(100, fp_max_claims), fp_pool_lamp + fp_drip),
      [fp_reclaim_acct_input()],
      fp_mint(fp_did_name, -1) |> assets.add(fp_nft_policy, acct_name(fp_other_did), 1),
    ),
  )
}

// ══════════════════════════════════════════════════════════════
// MỘT DID MỘT ACCOUNT — SỔ `opened_root` (INV-ONE-ACCT)
// ══════════════════════════════════════════════════════════════
// Ba chốt ở tệp này: C-OPEN-UNIQ-1 (chèn) · C-RECL-UNIQ-1 (xoá) · C-ROOT-KEEP-1
// (hai nhánh không đổi sổ). Chốt thứ tư — C-MP-8, gốc khởi tạo RỖNG — nằm ở
// `faucet_nft.ak` cùng với các ca `MintPool` khác.
//
// Mỗi cặp dưới đây có MỘT cực xanh và MỘT cực đỏ dựng bằng CÙNG builder, khác đúng
// một trường. Thiếu cực xanh thì cực đỏ không nói được nó đỏ VÌ chốt đang thử hay
// vì fixture của nó vốn đã sai ở một tiền đề khác.
//
// `fp_third_did` chỉ tồn tại cho ca "bằng chứng của DID khác": nó KHÔNG bao giờ
// nằm trong sổ, và nibble đầu của đường đi của nó khác của hai DID kia (điều kiện
// để `do_fork` của thư viện không tự từ chối vì lý do khác).

const fp_third_did: ByteArray = #"c0a201"

// ── C-OPEN-UNIQ-1 ────────────────────────────────────────────────

/// Cực XANH: DID chưa có account ⇒ sổ vào RỖNG, bằng chứng rỗng CHÍNH LÀ bằng
/// chứng vắng mặt hợp lệ ở trạng thái đó, sổ ra CHỨA khoá.
/// Vế `≠` ghim rằng phép chèn THẬT SỰ đổi gốc. Không có nó, một thư viện (hay một
/// lần sửa) làm `insert` trả về gốc y nguyên vẫn đi lọt ca dương này, và cả ba ca
/// âm bên dưới mất nghĩa CÙNG LÚC.
test open_did_moi_chen_goc() {
  and {
    fp_root_of(fp_did_name) != fp_root_empty(),
    fp_run(
      fp_pd(100, 0),
      fp_open,
      open_tx_for(
        fp_did_name,
        100,
        100,
        0,
        fp_root_empty(),
        fp_root_of(fp_did_name),
      ),
    ),
  }
}

/// DID ĐÃ có account mở thêm cái thứ hai. Sổ vào đã chứa khoá; người dựng tx nộp
/// bằng chứng VẮNG MẶT (rỗng) ⇒ gốc suy ra là gốc RỖNG, khác gốc vào ⇒ `mpf.insert`
/// từ chối. ĐÂY là chốt duy nhất chặn đường này: cooldown không chạm tới (nhánh
/// `ClaimOpen` không đọc account cũ) và trần tốc độ vẫn còn quota.
test open_did_da_co_account() fail {
  let root = fp_root_of(fp_did_name)
  fp_run(
    fp_pd_at(100, 0, root),
    fp_open,
    open_tx_for(fp_did_name, 100, 100, 0, root, root),
  )
}

/// Sổ ra KHÔNG ghi khoá vừa mở (giữ nguyên gốc rỗng). Bằng chứng hợp lệ, phép chèn
/// chạy xong — chỉ đẳng thức với `out_pd.opened_root` vỡ. Không có vế đó thì
/// `ClaimOpen` chèn vào một cái sổ không ai lưu lại, và cùng DID mở lại được ở tx
/// ngay sau.
test open_goc_output_sai() fail {
  fp_run(
    fp_pd(100, 0),
    fp_open,
    open_tx_for(fp_did_name, 100, 100, 0, fp_root_empty(), fp_root_empty()),
  )
}

/// Cực XANH thứ hai: DID THỨ HAI mở account trên sổ đã có một khoá. Bằng chứng ở
/// đây là bằng chứng THẬT (một bước `Leaf` trỏ láng giềng), nên chỉ cặp này phân
/// biệt được "bằng chứng của đúng cây" với "bằng chứng của cây khác" — cặp bằng
/// chứng rỗng ở trên không phân biệt được điều đó.
test open_did_thu_hai_chen_vao_cay_co_san() {
  let root_in = fp_root_of(fp_did_name)
  let root_out = fp_root_of_two(fp_did_name, fp_other_did)
  and {
    root_out != root_in,
    fp_run(
      fp_pd_at(100, 0, root_in),
      ClaimOpen { proof: [fp_leaf_step(fp_did_name)] },
      open_tx_for(fp_other_did, 100, 100, 0, root_in, root_out),
    ),
  }
}

/// Bằng chứng của một DID KHÁC. Cùng builder với ca xanh trên, đổi ĐÚNG một thứ:
/// bước `Leaf` trỏ láng giềng `fp_third_did` (không có trong sổ) thay vì
/// `fp_did_name`. Gốc suy ra từ bằng chứng đó là gốc của một cây khác ⇒ từ chối.
/// Không có chốt này thì bằng chứng chỉ là tham số trang trí: ai cũng dựng một cây
/// riêng rồi khai gốc mới tuỳ ý, và sổ mất mọi liên hệ với tập account thật.
test open_proof_cua_did_khac() fail {
  let root_in = fp_root_of(fp_did_name)
  let root_out = fp_root_of_two(fp_did_name, fp_other_did)
  fp_run(
    fp_pd_at(100, 0, root_in),
    ClaimOpen { proof: [fp_leaf_step(fp_third_did)] },
    open_tx_for(fp_other_did, 100, 100, 0, root_in, root_out),
  )
}

// ── C-RECL-UNIQ-1 ────────────────────────────────────────────────
// `reclaim_happy` đã phủ hình dạng một-lá / bằng chứng rỗng. Ba ca dưới đây làm
// việc mà hình dạng đó KHÔNG làm được: phân biệt "xoá đúng khoá" với "xoá khoá
// khác", thứ chỉ hiện ra khi sổ có từ hai khoá.

fn reclaim_two_leaf_tx(root_out: ByteArray) -> Transaction {
  let root_in = fp_root_of_two(fp_did_name, fp_other_did)
  reclaim_tx_with(
    fp_pd_at(100, fp_max_claims, root_in),
    fp_pool_output(
      fp_pd_at(100, fp_max_claims, root_out),
      fp_pool_lamp + fp_drip,
    ),
    [fp_reclaim_acct_input()],
  )
}

/// Cực XANH: thu hồi account của `fp_did_name` khỏi sổ hai-khoá ⇒ sổ ra chỉ còn
/// khoá của `fp_other_did`.
test reclaim_xoa_goc() {
  let root_in = fp_root_of_two(fp_did_name, fp_other_did)
  let root_out = fp_root_of(fp_other_did)
  and {
    root_out != root_in,
    fp_run(
      fp_pd_at(100, fp_max_claims, root_in),
      Reclaim { proof: [fp_leaf_step(fp_other_did)] },
      reclaim_two_leaf_tx(root_out),
    ),
  }
}

/// Thu hồi account nhưng GIỮ khoá trong sổ. `Reclaim` là nơi DUY NHẤT trả khoá lại;
/// không có chốt này thì mỗi DID chỉ dùng được faucet đúng một lần trong cả đời hệ
/// (account bị thu hồi, khoá vẫn nằm đó, `ClaimOpen` đòi chứng minh VẮNG mãi mãi
/// không thoả) — hỏng theo chiều KHOÁ CHẾT, không theo chiều rò rỉ, nên nó không
/// lộ ra ở bất kỳ ca nào về dòng tiền.
test reclaim_goc_khong_xoa() fail {
  let pd = fp_pd_one(100, fp_max_claims)
  fp_run(
    pd,
    fp_reclaim,
    reclaim_tx_with(
      pd,
      fp_pool_output(pd, fp_pool_lamp + fp_drip),
      [fp_reclaim_acct_input()],
    ),
  )
}

/// Thu hồi account của `fp_did_name` nhưng xoá khoá của `fp_other_did` khỏi sổ.
/// Cùng builder với `reclaim_xoa_goc`, đổi ĐÚNG gốc ra. Không có chốt này thì một
/// người thu hồi account của mình cũng xoá được khoá của người khác, và người đó
/// mở được account thứ hai — INV-ONE-ACCT sập mà không ai mất một token nào.
test reclaim_xoa_did_khac() fail {
  let root_in = fp_root_of_two(fp_did_name, fp_other_did)
  fp_run(
    fp_pd_at(100, fp_max_claims, root_in),
    Reclaim { proof: [fp_leaf_step(fp_other_did)] },
    reclaim_two_leaf_tx(fp_root_of(fp_did_name)),
  )
}

// ── C-ROOT-KEEP-1 ────────────────────────────────────────────────

/// Như `again_std` nhưng gốc ở output đặt TƯỜNG MINH, để cặp giữ/đổi khác nhau
/// đúng một trường.
fn again_tx_root_out(now: Int, old_claim_ep: Int, root_out: ByteArray) -> Transaction {
  let acct_in =
    util.mk_input(
      util.mk_ref(3),
      util.mk_output(
        util.script_address(fp_acct_sh),
        fp_acct_val(fp_did_name, 2_000_000, fp_drip),
        fp_acct_datum(fp_did_name, old_claim_ep, old_claim_ep),
      ),
    )
  fp_tx_at(
    now,
    Transaction {
      ..placeholder,
      inputs: [
        fp_pool_input(fp_pd_one(now, 0)),
        acct_in,
        fp_did_input(fp_did_name),
      ],
      outputs: [
        fp_pool_output(fp_pd_at(now, 1, root_out), fp_pool_lamp - fp_drip),
        fp_acct_output(fp_did_name, now, now, fp_drip * 2),
      ],
      mint: assets.zero,
    },
  )
}

/// Cực XANH của cặp `ClaimAgain`: gốc GIỮ NGUYÊN.
test again_giu_goc() {
  fp_run(
    fp_pd_one(136, 0),
    ClaimAgain,
    again_tx_root_out(136, 100, fp_root_of(fp_did_name)),
  )
}

/// `ClaimAgain` — nhánh KHÔNG đòi bằng chứng nào — ghi một gốc khác. Không có
/// C-ROOT-KEEP-1 ở nhánh này thì đây là đường xoá khoá của chính mình không tốn gì,
/// rồi `ClaimOpen` lại: toàn bộ INV-ONE-ACCT sập bằng hai tx hợp lệ.
test again_doi_goc() fail {
  fp_run(
    fp_pd_one(136, 0),
    ClaimAgain,
    again_tx_root_out(136, 100, fp_root_empty()),
  )
}

/// Cực XANH của cặp `TopUpPool`: nạp tLAMP, gốc GIỮ NGUYÊN.
test topuppool_giu_goc() {
  let pd = fp_pd_one(100, fp_max_claims)
  fp_run(pd, TopUpPool, topuppool_tx(pd, fp_drip * 1000, [], pd))
}

/// Nạp tLAMP mà tiện tay đổi sổ. `TopUpPool` permissionless về phía người nạp, nên
/// không có chốt này thì bất kỳ ai cũng viết lại sổ với giá một lượt nạp.
test topuppool_doi_goc() fail {
  let pd = fp_pd_one(100, fp_max_claims)
  fp_run(
    pd,
    TopUpPool,
    topuppool_tx(pd, fp_drip * 1000, [], fp_pd(100, fp_max_claims)),
  )
}

// ── CHUỖI: mở → thu hồi → mở LẠI ─────────────────────────────────

/// Ba tx NỐI NHAU bằng GIÁ TRỊ: gốc ra của bước trước là gốc vào của bước sau.
/// Ca này trả lời câu hỏi mà mọi ca đơn lẻ ở trên KHÔNG trả lời được — INV-ONE-ACCT
/// có khoá chết một DID vĩnh viễn không. Vế `mpf.delete(...) == root0` là chỗ nối
/// thật sự: nó khẳng định gốc sau khi xoá TRỞ VỀ đúng gốc rỗng ban đầu, chứ không
/// phải một gốc thứ ba trông cũng hợp lệ.
test open_sau_reclaim_duoc_mo_lai() {
  let root0 = fp_root_empty()
  let root1 = fp_root_of(fp_did_name)
  let pd_after_open = fp_pd_at(100, 1, root1)
  and {
    // (1) mở account: sổ rỗng → sổ có khoá.
    fp_run(
      fp_pd_at(100, 0, root0),
      fp_open,
      open_tx_for(fp_did_name, 100, 100, 0, root0, root1),
    ),
    // chỗ nối: xoá khoá khỏi `root1` trả về ĐÚNG `root0`.
    mpf.root(
      mpf.delete(
        mpf.from_root(root1),
        did_key(fp_did_name),
        did_leaf_value,
        [],
      ),
    ) == root0,
    // (2) thu hồi: sổ có khoá → sổ rỗng, bộ đếm giữ nguyên.
    fp_run(
      pd_after_open,
      fp_reclaim,
      reclaim_tx_with(
        pd_after_open,
        fp_pool_output(fp_pd_at(100, 1, root0), fp_pool_lamp + fp_drip),
        [fp_reclaim_acct_input()],
      ),
    ),
    // (3) CÙNG DID mở lại được ở một cửa sổ sau.
    fp_run(
      fp_pd_at(200, 0, root0),
      fp_open,
      open_tx_for(fp_did_name, 200, 200, 0, root0, root1),
    ),
  }
}

// ══════════════════════════════════════════════════════════════
// NGÂN SÁCH EX-UNIT THEO ĐỘ SÂU SỔ
// ══════════════════════════════════════════════════════════════
// Mọi ca ở trên dùng bằng chứng 0 hoặc 1 bước, tức sổ có 1–2 khoá. Sổ thật sâu
// ~log₁₆(N) nên bằng chứng thật có ~log₁₆(N) bước `Branch`, và câu cần trả lời là
// "sổ lớn có làm `ClaimOpen` vượt trần ex-unit không".
//
// Không dựng được cây nhiều khoá bằng Aiken thuần: thư viện MPF cố ý KHÔNG có bộ
// dựng bằng chứng chạy on-chain (đó là việc của off-chain). Nhưng CHI PHÍ của một
// bước KHÔNG phụ thuộc bằng chứng có đúng hay không — `do_branch` chỉ cắt 4×32 byte
// từ `neighbors` rồi băm, không có nhánh nào rẽ theo kết quả so sánh. Nên đo được
// bằng `mpf.miss` trên một gốc RÁC với bằng chứng dài dần: nó trả `False` và vẫn đi
// TRỌN đường. Giá một bước = HIỆU giữa hai ca liền nhau; ex-unit từng ca đọc ở
// output `aiken check` (hoặc trường `execution_units` khi stdout không phải TTY).
//
// Ba ca dưới đây KHÔNG kiểm một chốt nào của validator — chúng là phép ĐO. Đừng
// xoá vì "không gác gì": không có chúng thì câu trả lời về ngân sách chỉ còn là ước
// lượng, và ước lượng ex-unit là thứ chỉ sai khi đã lên mạng.

/// 128 byte `neighbors` tuỳ ý — `do_branch` cắt đúng 4×32 byte đầu, không kiểm nội
/// dung, nên giá trị cụ thể không ảnh hưởng chi phí.
const fp_branch_neighbors: ByteArray =
  #"0101010101010101010101010101010101010101010101010101010101010101020202020202020202020202020202020202020202020202020202020202020203030303030303030303030303030303030303030303030303030303030303030404040404040404040404040404040404040404040404040404040404040404"

fn fp_branch_steps(n: Int) -> mpf.Proof {
  if n <= 0 {
    []
  } else {
    [
      mpf.Branch { skip: 0, neighbors: fp_branch_neighbors },
      ..fp_branch_steps(n - 1)
    ]
  }
}

const fp_garbage_root: ByteArray =
  #"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

/// Mốc NỀN: đi hết đường với bằng chứng 0 bước.
test budget_proof_0_buoc() {
  mpf.miss(
    mpf.from_root(fp_garbage_root),
    did_key(fp_did_name),
    fp_branch_steps(0),
  ) == False
}

/// 1 bước `Branch`. Hiệu so với ca trên = giá MỘT bước.
test budget_proof_1_buoc() {
  mpf.miss(
    mpf.from_root(fp_garbage_root),
    did_key(fp_did_name),
    fp_branch_steps(1),
  ) == False
}

/// 5 bước `Branch` ≈ sổ ~16⁵ ≈ một triệu khoá. Hiệu so với ca 1 bước, chia 4, là
/// giá một bước ở chỗ sâu — và tổng của ca này là phần bằng chứng cộng thêm vào
/// ex-unit của `ClaimOpen` ở quy mô đó.
test budget_proof_5_buoc() {
  mpf.miss(
    mpf.from_root(fp_garbage_root),
    did_key(fp_did_name),
    fp_branch_steps(5),
  ) == False
}

/// `open_happy` dời sang gốc Mainnet: phải xanh như bản gốc 0.
test open_happy_origin_mainnet() {
  fp_run_at(window_origin_fixtures.mainnet_origin_ms, window_origin_fixtures.mainnet_origin_ms, fp_pd(100, 0), fp_open, open_std(100, 100, 0))
}

/// `open_happy` dời sang gốc Preprod: phải xanh như bản gốc 0.
test open_happy_origin_preprod() {
  fp_run_at(window_origin_fixtures.preprod_origin_ms, window_origin_fixtures.preprod_origin_ms, fp_pd(100, 0), fp_open, open_std(100, 100, 0))
}

/// Ca âm: tx đã dời sang lưới Mainnet nhưng validator nhận gốc 0 (quên trừ gốc) ⇒ phải bị chặn.
test open_happy_origin_forgotten() fail {
  fp_run_at(0, window_origin_fixtures.mainnet_origin_ms, fp_pd(100, 0), fp_open, open_std(100, 100, 0))
}
