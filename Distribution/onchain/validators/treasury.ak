// DistributionTreasury validator (SPEC §QĐ7, C-TRE-1/2, C-SOLV-*).
// Giữ LAMP pool + sổ cái solvency `outstanding_entitlement` = SỐ CÒN NỢ người dùng
// = Σ(entitlement − redeemed) toàn hệ thống. 2 redeemer:
//   ReleaseForRedeem — trả nợ: pool ↓ `released` VÀ sổ cái ↓ `released` (đi cặp).
//     KHÔNG cần committee — gate bởi 1 Redeem hợp lệ (đã verify vested ở claim_account).
//   GrantEntitlement — committee cấp E qua Claim cùng tx: pool LAMP BẤT BIẾN,
//     sổ cái += granted, ép outstanding_entitlement_out ≤ pool (SOLVENCY).
//     Treasury là singleton (1-in/1-out theo script hash) → sổ cái là biến toàn cục
//     serial-hoá MỌI Claim/Redeem → bất biến Σ(E−redeemed) ≤ pool ép được PER-TX.
//
// ⚠ SỬA 2026-08-12 — NGỮ NGHĨA SỔ CÁI (review PR #22, điểm 1).
// Bản đầu đặt sổ cái là `cumulative_entitlement` = TỔNG CẤP SUỐT VÒNG ĐỜI: chỉ tăng khi
// grant, BẤT BIẾN khi redeem. Nhưng pool thì GIẢM mỗi lần redeem, mà C-SOLV-2 lại so sổ
// cái với pool HIỆN TẠI ⇒ mỗi lần redeem lại siết cửa grant thêm một nấc, không có đường
// lùi (không mệnh đề nào cho sổ cái giảm).
// Hệ quả không phải bất tiện mà là BẾ TẮC: quỹ đã cấp 5000, người dùng rút hết 5000
// (nợ = 0), nạp lại 5000 LAMP — cấp thêm 1 đồng vẫn BỊ TỪ CHỐI vì 5000+1 > 5000. Quy ra
// phân phối thật, lần cấp CUỐI đòi pool ≥ 26,37 tỷ LAMP tại đúng thời điểm đó, trong khi
// mọi redeem trước đã rút LAMP ra khỏi quỹ — cung cố định nên KHÔNG nạp bù được.
// Tính chất an toàn muốn có (Σ(E−redeemed) ≤ pool) vốn đã được bảo toàn bởi phép kiểm
// YẾU HƠN: chỉ cần sổ cái theo dõi CÒN NỢ thay vì TỔNG CẤP. Nay đổi đúng thế, và đổi luôn
// TÊN trường (`cumulative_` → `outstanding_`) vì chính cái tên sai đã dẫn tới bất biến sai.
// Đổi lại: sổ cái không còn là "tổng đã cấp lịch sử" — muốn con số đó thì cộng off-chain.

use aiken/collection/list
use aiken/crypto.{blake2b_256}
use aiken/interval
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
  placeholder,
}
use magiclamp/lampdist/types.{
  BeaconDatum, ClaimAccountDatum, DropParam, GrantEntitlement, Refill,
  ReleaseForRedeem, TreasuryDatum, TreasuryRedeemer,
}
use magiclamp/lampdist/util

validator treasury(
  claim_account_hash : ByteArray,
  lamp_policy        : ByteArray,
  lamp_name          : ByteArray,
  committee          : List<ByteArray>,
  threshold          : Int,
  // ⚠ THÊM 2026-08-12 (vá review PR #22, điểm 1) — ĐẶT CUỐI để giữ nguyên vị trí 5 tham
  // số cũ trong chuỗi apply-param offchain. Chỉ dùng để NỚI ĐÚNG MỘT KHE của C-MINT-0
  // ở nhánh GrantEntitlement: tx mở tài khoản buộc phải đúc NFT tài khoản, mà C-MINT-0
  // cũ (`is_zero(tx.mint)` áp cho MỌI redeemer) chặn luôn đường đó.
  account_nft_policy : ByteArray,
  // ⚠ THÊM 2026-09-16 (vá Issue #72, lỗ 1) — ĐẶT CUỐI, cùng lý do với tham số trên.
  // Chỉ dùng ở nhánh CREATE của `GrantEntitlement`, để ghim `start_epoch` vào cửa sổ
  // thật. Đổi hash treasury (⇒ đổi địa chỉ kho), KHÔNG đổi policy id của LAMP: kho được
  // định danh qua SUPPLY NFT chứ không qua script-hash — xem `lamp_mint.ak`, tham số
  // `kho_nft_policy`/`kho_nft_name`.
  ms_per_epoch       : Int,
  // ⚠ THÊM 2026-09-22 (v3, C-CLAIM-8) — ĐẶT CUỐI, cùng lý do với hai tham số trên.
  // Chỉ dùng ở nhánh `GrantEntitlement`, để ghim `index_at_start` bằng `A(cửa sổ này)`.
  //
  // VÌ SAO PHẢI Ở ĐÂY chứ không chỉ ở `claim_account`: đường CREATE (mở tài khoản mới)
  // KHÔNG có input tài khoản, nên `claim_account.spend` không chạy — nhánh này là nơi DUY
  // NHẤT có thẩm quyền đặt `index_at_start` lúc mở. Cùng lý lẽ đã dùng cho C-ACC-2
  // (`start_epoch`) ngày 2026-09-16.
  //
  // GIÁ PHẢI TRẢ, ghi ra để offchain không phát hiện muộn: (a) `treasury` lên 8 tham số ⇒
  // mọi cổng đo ARITY bên offchain đỏ; (b) MỌI giao dịch `GrantEntitlement` từ nay phải
  // mang beacon ở `reference_inputs` — đó là một đổi HÌNH DẠNG TX, không chỉ đổi tham số.
  beacon_nft_policy  : ByteArray,
) {
  spend(
    datum_opt : Option<TreasuryDatum>,
    redeemer  : TreasuryRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // ⚠ CẤU TRÚC 2026-08-12 (vá review PR #22, điểm 2): `expect Some(datum) = datum_opt`,
    // C-MINT-0 và C-TRE-1 trước đây nằm NGOÀI `when redeemer` — tức áp cho mọi nhánh.
    // `Refill` phải tiêu được UTxO KHÔNG datum (LAMP rót về kho qua A-DEST hạ cánh không
    // datum) và phải GỘP được N > 1 input, nên ba mệnh đề đó chuyển vào TỪNG nhánh.
    // Hai redeemer cũ giữ nguyên hành vi từng chữ.

    when redeemer is {
      // ── RELEASE (Redeem permissionless) ───────────────────────
      ReleaseForRedeem -> {
        expect Some(datum) = datum_opt

        // C-MINT-0 — GIỮ NGUYÊN Ở NHÁNH NÀY. Đường trả nợ không có lý do gì đụng tới
        // mint; nới ở đây là mở cửa cho tx vừa rút LAMP vừa đúc NFT tài khoản mới.
        expect assets.is_zero(tx.mint)

        let (tre_in, tre_out, out_datum) = singleton_io(tx, own_hash, datum)

        // Đúng 1 ClaimAccount input + output (cùng tx redeem) — chống batch nhập nhằng.
        expect
          list.count(tx.inputs, fn(i) { util.is_at_script(i.output.address, claim_account_hash) }) == 1
        expect
          list.count(tx.outputs, fn(o) { util.is_at_script(o.address, claim_account_hash) }) == 1

        // released = ClaimAccount.redeemed(out) − redeemed(in)
        let ca_in = find_claim_account_input(tx.inputs, claim_account_hash)
        let ca_out = find_claim_account_output(tx.outputs, claim_account_hash)
        let released = ca_out.redeemed - ca_in.redeemed
        expect released > 0

        // C-SOLV-3: redeem trả nợ ⇒ sổ cái GIẢM ĐÚNG `released`, song hành với pool.
        // (Bản đầu ép sổ cái BẤT BIẾN ở đây — xem ghi chú "SỬA 2026-08-12" đầu file: đó
        // chính là nguồn của bế tắc grant. Pool giảm mà sổ cái đứng yên thì `≤ pool` siết
        // dần tới mức không cấp được nữa dù quỹ không nợ ai.)
        expect out_datum.outstanding_entitlement == datum.outstanding_entitlement - released

        // Sổ cái không bao giờ âm — chốt số học, cũng là canh cho `released` không vượt nợ.
        expect out_datum.outstanding_entitlement >= 0

        // C-RDM-TOTAL (v3, phía kho): sổ ĐÃ PHÁT RA tăng ĐÚNG `released`. Đi CẶP với dòng
        // trên — hai vế cùng một số, hai chiều ngược nhau: nợ giảm, đã-phát-ra tăng.
        // `total_redeemed` là MẪU SỐ của phép cắt ngọn ở `claim_account`, nên thiếu vế này
        // thì mẫu số trôi khỏi sự thật mà không dòng nào kêu — và nó trôi theo chiều LÀM
        // TRẦN RÚT CO LẠI so với thật, tức hệ tự bóp nghẹt chính nó mà không ai truy ra.
        expect out_datum.total_redeemed == datum.total_redeemed + released

        // C-TRE-1 + C-VAL-0: output == input value với LAMP giảm ĐÚNG released.
        // Bảo toàn TUYỆT ĐỐI mọi asset khác (ADA, token) — chống drain ADA (audit M1).
        expect tre_out.value == assets.add(tre_in.value, lamp_policy, lamp_name, -released)

        True
      }

      // ── GRANT (Claim cấp entitlement — committee) ─────────────
      GrantEntitlement -> {
        expect Some(datum) = datum_opt

        // C-MINT-1 (2026-08-12, vá review PR #22 điểm 1) — NỚI ĐÚNG MỘT KHE của C-MINT-0.
        // Mở tài khoản = đúc NFT tài khoản, mà `is_zero(tx.mint)` cũ chặn đứng đường đó
        // ⇒ hoặc bỏ cổng NFT, hoặc nới ở đây. Nới CHẶT: tập policy xuất hiện trong
        // `tx.mint` phải ⊆ {account_nft_policy}. Không policy nào khác — kể cả LAMP —
        // được nhúng ké vào tx cấp entitlement. Chính `claim_account_nft` mới là chỗ ép
        // shape của lần đúc đó (đúng 1 tên, qty +1, hạ cánh ở script, tên = hash owner).
        expect list.all(assets.policies(tx.mint), fn(p) { p == account_nft_policy })

        let (tre_in, tre_out, out_datum) = singleton_io(tx, own_hash, datum)
        let pool_in = assets.quantity_of(tre_in.value, lamp_policy, lamp_name)

        // C-CLAIM-1 (mirror): treasury cũng ép ngưỡng committee → CREATE path
        // (không có claim_account input → claim_account validator KHÔNG chạy) vẫn
        // được treasury gác chữ ký + solvency.
        expect util.committee_approved(committee, threshold, tx.extra_signatories)

        // ── C-CLAIM-8 (v3): `index_at_start` = A(CỬA SỔ NÀY), ở CẢ HAI đường ────────────
        // `A` là chỉ số cộng dồn của beacon, đọc qua reference input đã xác thực bằng NFT.
        //
        // Ở CREATE nó là mốc gốc của tài khoản. Ở UPDATE nó là vế thứ tư của phép REBASE,
        // và thiếu nó thì v3 dựng lại ĐÚNG cái lỗ mà bản vá `start_epoch` đã bịt, qua một
        // cửa khác: một tài khoản già có `index_at_start` nhỏ nên `A_span` của nó đã rất
        // lớn; cấp thêm một lô mới mà giữ nguyên mốc ấy thì lô mới vest GẦN NHƯ TỨC THÌ.
        // Rebase `start_epoch` KHÔNG cứu được, vì ở v3 `start_epoch` không còn đi vào phép
        // tính vested — thứ đi vào phép tính là `index_at_start`.
        //
        // Đây là ca mẫu của một lớp lỗi phải canh mỗi lần thêm trường: một bản vá cũ chỉ
        // bịt đúng cái cửa nó nhìn thấy.
        let grant_window = util.get_epoch_strict(tx, ms_per_epoch)
        let a_now =
          util.beacon_index_at(
            util.find_beacon(tx.reference_inputs, beacon_nft_policy),
            grant_window,
          )

        // Đúng 1 ClaimAccount OUTPUT (account được cấp). INPUT ∈ {0 (CREATE), 1 (UPDATE)}.
        let ca_in_count =
          list.count(tx.inputs, fn(i) { util.is_at_script(i.output.address, claim_account_hash) })
        let ca_out_count =
          list.count(tx.outputs, fn(o) { util.is_at_script(o.address, claim_account_hash) })
        expect ca_out_count == 1
        expect ca_in_count <= 1

        // granted = entitlement(out) − entitlement(in_or_0).
        //
        // ⚠ 2026-09-26 — LẤY TRỌN `Output`, không chỉ datum. `find_claim_account_output`
        // trả về `ClaimAccountDatum`, tức mọi mệnh đề CREATE viết từ trước tới nay CHỈ
        // NHÌN THẤY phần datum của tài khoản; VALUE của nó không đi vào một mệnh đề nào.
        // Đó là lý do C-ACC-1 nói được "tx phải ĐÚC NFT" mà không nói được "NFT phải NẰM
        // TRONG tài khoản" — một chữ ký hàm đã quyết hộ phạm vi của cái cổng.
        // `ca_out_count == 1` ngay trên ⇒ `output_at_script` trả về đúng cái output ấy.
        let ca_out_utxo = util.output_at_script(tx.outputs, claim_account_hash)
        expect InlineDatum(ca_out_raw) = ca_out_utxo.datum
        expect ca_out: ClaimAccountDatum = ca_out_raw
        let ent_in =
          if ca_in_count == 1 {
            let ca_in = find_claim_account_input(tx.inputs, claim_account_hash)
            // ── C-ACC-3 (2026-09-17): CẤP THÊM = REBASE TÀI KHOẢN ─────────────────────
            // C-ACC-2 ngay dưới chỉ ghim `start_epoch` ở nhánh CREATE. Một mình nó KHÔNG
            // ghim được lịch vesting: mở tài khoản E=400 ở cửa sổ 0, để già 100 cửa sổ,
            // cấp thêm lên E=1400 mà giữ mốc cũ ⇒ `elapsed = 100` ⇒ giao dịch KẾ TIẾP rút
            // trọn 1400 — phần vừa cấp ra khỏi kho trong đúng cửa sổ nó được cấp.
            //
            // Bản vá trước dời mốc theo BÌNH QUÂN GIA QUYỀN entitlement. Nó KHÔNG đóng lỗ,
            // chỉ hoãn: cùng ca trên cho `start' = 72`, `elapsed = 28`,
            // `vested = min(1400, D·dpe·28)` — với D=100, dpe=1 vẫn là trọn 1400. Gốc: bình
            // quân bảo toàn `E × epoch`, còn vesting bị chặn theo lô bằng `min(E, r·elapsed)`;
            // phần tuổi vượt quá lúc lô cũ đã vest hết là tín dụng không trần, và phép bình
            // quân rửa nó sang lô mới. Đổi trọng số sang `E − redeemed` cũng không cứu: ca
            // tấn công có `redeemed = 0`. Tín dụng nằm ở phần ĐÃ VEST MÀ CHƯA RÚT, và muốn
            // đo phần đó thì cần D — tức thêm reference input beacon, đổi hình dạng tx.
            //
            // Rebase không cần D. Mỗi lần cấp thêm, tài khoản được viết lại như vừa mở:
            //
            //     E' = (E − redeemed) + granted      redeemed' = 0      start' = cửa sổ này
            //
            // Không tuổi nào mang sang ⇒ không tín dụng nào để rửa. Người nhận KHÔNG MẤT
            // tiền: phần chưa rút `E − redeemed` nằm nguyên trong E'. Cái giá duy nhất là
            // phần đã vest-mà-chưa-rút phải vest lại — rút nó TRƯỚC khi nhận cấp thêm thì
            // không mất gì. Sổ nợ kho không đổi nghĩa: nó đo Σ(E − redeemed), và đại lượng
            // đó của tài khoản tăng đúng `granted`.
            //
            // `get_epoch_strict` chứ không `get_epoch`, cùng lý do đã ghi ở C-ACC-2.
            // `claim_account.ak` nhánh `Claim` ép cùng ba đẳng thức từ phía tài khoản —
            // hai validator không dựa vào nhau để ghim, mỗi bên tự đủ.
            expect ca_out.redeemed == 0
            expect ca_out.start_epoch == grant_window
            // C-CLAIM-8: vế thứ tư của rebase — gốc CHỈ SỐ, không phải gốc cửa sổ.
            expect ca_out.index_at_start == a_now

            // Phần CHƯA RÚT của tài khoản trước khi cấp — không phải `entitlement`.
            ca_in.entitlement - ca_in.redeemed
          } else {
            // CREATE: account mới, entitlement cũ = 0, redeemed PHẢI = 0 (no double-count
            // redeemed làm lệch cumulative; claim_account validator KHÔNG chạy nên ép tại đây).
            expect ca_out.redeemed == 0

            // ── C-ACC-2 (2026-09-16, vá Issue #72 lỗ 1): GHIM `start_epoch` ──────────
            // Trước bản vá KHÔNG validator nào trên đường CREATE chạm `start_epoch` —
            // soát cả ba chỗ có thẩm quyền (`claim_account_nft.MintAccount`, nhánh này,
            // và `claim_account.spend` vốn KHÔNG chạy ở CREATE vì không có input tài
            // khoản). Bên dựng tx do đó đặt `start_epoch` lùi bao xa tuỳ ý, `elapsed`
            // lớn ngay lập tức, và trọn `entitlement` vested trong giao dịch kế tiếp.
            // Đo được trên Preprod: tài khoản mở ở cửa sổ 4142 mang `start_epoch = 4141`
            // rồi rút ngay. Lịch vesting khi ấy là kỷ luật vận hành, không phải mã ép.
            //
            // Đây là chỗ ĐÚNG để ghim, không phải `claim_account_nft`: cổng NFT cũng
            // chạy ở CREATE, nhưng thêm tham số cho nó sẽ đổi `account_nft_policy`, mà
            // policy đó là tham số của CẢ `claim_account` LẪN treasury ⇒ ba script đổi
            // hash thay vì một.
            //
            // `get_epoch_strict` chứ không `get_epoch`: đại lượng cần ở đây phải chặn
            // được chiều LÙI, mà đầu dưới của validity range đặt lùi bao xa cũng hợp lệ
            // với sổ cái — dùng `get_epoch` ở đây là vá bằng chính thứ đang thủng. Ép cả
            // hai đầu cùng cửa sổ thì `start_epoch` kẹp đúng cửa sổ thật từ hai phía.
            //
            // Chiều TIẾN cũng phải chặn, và nó không phải chuyện thẩm mỹ: `start_epoch`
            // đặt xa ở tương lai ⇒ không bao giờ vested ⇒ `Redeem` không chạy được ⇒
            // khoản nợ đã vào `outstanding_entitlement` mà KHÔNG CÓ ĐƯỜNG LÙI (sổ chỉ
            // giảm qua `ReleaseForRedeem`, vốn cần một tài khoản rút được). Đúng cái bẫy
            // một-chiều mà C-ACC-1 ngay dưới đây sinh ra để chặn, chỉ khác lối vào.
            expect ca_out.start_epoch == util.get_epoch_strict(tx, ms_per_epoch)

            // ── C-CLAIM-8 ở CREATE: mốc CHỈ SỐ, song hành với mốc CỬA SỔ ngay trên ──
            // Dòng trên ghim `start_epoch`, nhưng ở v3 `start_epoch` KHÔNG còn đi vào
            // phép tính vested — `A_span = A(bây giờ) − index_at_start` mới là thứ đi
            // vào. Ghim một mốc mà bỏ mốc kia là vá đúng cái cửa mình nhìn thấy: bên
            // dựng tx đặt `index_at_start` nhỏ tuỳ ý ⇒ `A_span` phồng ⇒ trọn
            // `entitlement` vest ngay giao dịch kế, đúng lại ca Preprod đã đo ở C-ACC-2
            // qua một cửa khác. Chiều ngược lại (`index_at_start` lớn hơn `A` hiện tại)
            // là bẫy một chiều: `A_span` âm ⇒ không bao giờ rút được, mà nợ đã vào sổ.
            //
            // CREATE không có input tài khoản ⇒ `claim_account.spend` KHÔNG chạy ⇒
            // không có lớp thứ hai nào đỡ. Đây là chỗ duy nhất.
            expect ca_out.index_at_start == a_now

            // ── C-ACC-DPE (v3, thay C-ACC-4): `drops_per_epoch` GHIM == 1 ───────────
            // v3 mở khoá theo `vested = min(E, dpe · √E · A_span)`, trong đó `A_span` là
            // hiệu của chỉ số cộng dồn — một tổng. `dpe` đứng NGOÀI tổng đó, nên hạ nó
            // viết lại TOÀN BỘ quá khứ chứ không chỉ chặn một lần rút (Math-Spec §4,
            // M-CHANNEL). Một tham số mà mọi lần đổi đều rewrite lịch sử thì không được
            // là tham số: ghim cứng bằng 1 tại lối vào DUY NHẤT sinh ra tài khoản.
            // Trần cũ `<= drops_per_epoch_max` không còn đủ: nó chặn dpe LỚN, trong khi
            // đường hại của v3 là dpe NHỎ ĐI ở một tài khoản cấp sau.
            // Sàn cũ `> 0` nằm trong mệnh đề này: dpe = 0 giết nhánh `Redeem` vĩnh viễn
            // trong khi khoản nợ đã vào sổ ở chính giao dịch này — bẫy một chiều cùng họ
            // với C-ACC-1.
            expect ca_out.drops_per_epoch == 1

            // C-ACC-1 (2026-08-12, khép nốt vá điểm 1): đường CREATE BẮT BUỘC đúc NFT tài
            // khoản cho ĐÚNG ví này. Không có dòng này thì cổng NFT chỉ là "được phép",
            // chưa phải "bắt buộc": committee tạo được output ở `claim_account_hash` KHÔNG
            // kèm NFT ⇒ khoản nợ VÀO SỔ nhưng tài khoản VĨNH VIỄN không tiêu được (spend
            // đòi NFT) ⇒ `outstanding_entitlement` phình mãi mãi, và vì nó chỉ giảm qua
            // `ReleaseForRedeem` — vốn cần một tài khoản tiêu được — nên phần phình đó
            // KHÔNG CÓ ĐƯỜNG LÙI, siết dần trần cấp phát về sau qua C-SOLV-2.
            // Không phải bề mặt bên-thứ-ba (đòi đủ chữ ký committee), nhưng là cái bẫy
            // một-chiều nên chặn ngay lúc ghi thay vì tin vào kỷ luật vận hành.
            expect
              assets.quantity_of(
                tx.mint,
                account_nft_policy,
                blake2b_256(ca_out.owner),
              ) == 1

            // ── C-ACC-1b (2026-09-26): NFT vừa đúc phải NẰM TRONG tài khoản vừa mở ──
            // C-ACC-1 ngay trên đo `tx.mint` — tức nó chỉ biết NFT được SINH RA, không
            // biết nó HẠ CÁNH Ở ĐÂU. Cổng duy nhất nói về đích là `claim_account_nft.ak`
            // ▸ A-ACC-3, và cổng ấy cố ý chỉ ép "phải là MỘT Script bất kỳ" (vòng tham
            // số: policy cần hash `claim_account`, hash `claim_account` cần policy). Lời
            // biện hộ ghi ở đó — *"đúc vào script KHÁC thì tự khoá tiền của kẻ dựng tx,
            // không phải bề mặt tấn công"* — ĐÚNG với ví kẻ dựng tx và SAI với kho: giao
            // dịch này vẫn ghi `granted` vào `outstanding_entitlement` ở C-SOLV-1 dưới
            // đây. Tài khoản ra đời KHÔNG NFT thì `claim_account.spend` từ chối nó vĩnh
            // viễn ⇒ nợ đã vào sổ mà không có đường lùi (sổ chỉ giảm qua
            // `ReleaseForRedeem`, vốn cần một tài khoản tiêu được) ⇒ C-SOLV-2 siết dần
            // trần cấp phát cho MỌI pot về sau. Đúng cái bẫy một chiều mà C-ACC-1 sinh ra
            // để chặn, chỉ khác ở chỗ NFT có tồn tại — nên C-ACC-1 nhìn không thấy.
            //
            // Vì sao ép được ở ĐÂY mà không ép được ở mint policy: `treasury` đã nhận
            // `claim_account_hash` làm tham số từ đầu, không có vòng nào cả. Đây là chỗ
            // DUY NHẤT trong hệ biết CẢ HAI: tên NFT phải đúc, và địa chỉ tài khoản.
            expect
              assets.quantity_of(
                ca_out_utxo.value,
                account_nft_policy,
                blake2b_256(ca_out.owner),
              ) == 1
            0
          }
        let granted = ca_out.entitlement - ent_in
        expect granted > 0

        // C-SOLV-1: outstanding_entitlement += granted (sổ cái dồn đúng amount cấp).
        expect out_datum.outstanding_entitlement == datum.outstanding_entitlement + granted

        // C-SOLV-2 (BẤT BIẾN SOLVENCY): outstanding_entitlement_out ≤ pool LAMP.
        // Quỹ KHÔNG cấp E vượt số dư → redeem không bao giờ kẹt vì cạn pool.
        expect out_datum.outstanding_entitlement <= pool_in

        // C-GRANT-TOTAL (v3): `total_redeemed` ĐỨNG YÊN khi cấp quyền. Cấp quyền không phát
        // LAMP nào (C-VAL-0 ngay dưới), nên số ĐÃ PHÁT không có lý do đổi. Thiếu dòng này thì
        // chỉ riêng nhánh này cho viết lại trường "CHỈ TĂNG" tuỳ ý: thổi lên thì trần cắt ngọn
        // ở `claim_account` nới ra; kéo về 0 thì trần rơi về `trim_floor`; ghi âm thì mọi
        // `Refill` về sau chết ở `carrier_ledger` (`total_redeemed >= 0`). Ghim bởi
        // `grant_inflating_total_redeemed_rejected` và hai ca anh em.
        expect out_datum.total_redeemed == datum.total_redeemed

        // C-VAL-0: pool LAMP + mọi asset BẤT BIẾN khi grant (chỉ datum đổi).
        expect tre_out.value == tre_in.value

        True
      }

      // ── REFILL (gộp UTxO ở kho + nạp thêm LAMP — committee) ───
      // Thêm 2026-08-12 (vá review PR #22, điểm 2). KỊCH BẢN HỎNG được vá: kho CHỈ-GIẢM.
      // Grant ép `tre_out.value == tre_in.value`, Release chỉ cho LAMP GIẢM, và
      // `count_inputs_at_script == 1` chặn luôn đường gộp ⇒ KHÔNG redeemer nào làm pool
      // TĂNG ⇒ tổng cấp phát suốt vòng đời ≤ số dư genesis, và mọi LAMP rót về kho sau
      // này (A-DEST hạ cánh thành UTxO RIÊNG, thường KHÔNG datum) nằm chết tại địa chỉ
      // script, không đường nào đưa vào pool đang được C-SOLV-2 đo.
      Refill -> {
        // KHÔNG dùng `datum_opt`: nhánh này PHẢI chạy được cho input KHÔNG datum.
        // (Sổ cái của riêng input đó bị bỏ qua khi nó không phải carrier — xem
        // `carrier_ledger` — nhưng MỌI mệnh đề
        // toàn-tx bên dưới vẫn chạy đủ.)

        // Không permissionless: singleton kho là UTxO đơn, ai cũng gộp được thì kẻ phá
        // quấy chiếm nó liên tục (churn UTxO, đua chèn tx) mà không tốn gì ngoài phí.
        expect util.committee_approved(committee, threshold, tx.extra_signatories)

        // Refill KHÔNG có lý do đụng mint (không tạo tài khoản, không đúc TRSY).
        expect assets.is_zero(tx.mint)

        // C-REF-ACC (2026-09-17): Refill KHÔNG chạm tài khoản nào. `claim_account` nhánh
        // `Claim` chỉ ép "có co-spend kho và sổ kho tăng đúng `amount`" (C-SOLV-1), KHÔNG
        // ép kho chạy nhánh nào. Nên {Refill(kho + UTxO tự đỗ mang sổ khai thêm `amount`),
        // Claim(amount)} thoả cả hai phía mà không đi qua `GrantEntitlement` — tức né mọi
        // mệnh đề của C-ACC-2/3/4. Cardano không chạy validator lúc TẠO output, nên UTxO
        // tự đỗ ấy ai cũng tạo được. Gộp kho không có lý do gì cần một tài khoản.
        expect
          list.count(tx.inputs, fn(i) { util.is_at_script(i.output.address, claim_account_hash) }) == 0
        expect
          list.count(tx.outputs, fn(o) { util.is_at_script(o.address, claim_account_hash) }) == 0

        // GỘP: N ≥ 1 input ở script → ĐÚNG 1 output ở script. Kho lại về singleton.
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
        let tre_out = util.output_at_script(tx.outputs, own_hash)
        expect InlineDatum(od) = tre_out.datum
        expect out_datum: TreasuryDatum = od

        let ins =
          list.filter(
            tx.inputs,
            fn(i) { util.is_at_script(i.output.address, own_hash) },
          )

        // Σ value của MỌI input ở script.
        let value_in =
          list.foldl(ins, assets.zero, fn(i, acc) { assets.merge(acc, i.output.value) })

        // ── C-REF-PROV (2026-09-26): SỐ SỔ CHỈ ĐI RA TỪ CARRIER ────────────────────
        // GỐC TÍCH, không phải DẤU. Xem docstring `carrier_ledger` cho lập luận đầy đủ.
        let carrier = carrier_ledger(ins)

        // `committee_hash` neo vào carrier — vật duy nhất trong tập input có quá khứ
        // chứng minh được (`treasury_nft.ak` one-shot ⇒ nó ra đời đúng một lần, ở genesis,
        // với sổ mở 0/0; từ đó mọi lần nó đổi tay đều đi qua một nhánh của chính tệp này).
        expect out_datum.committee_hash == carrier.committee_hash

        // Gộp KHÔNG tạo và KHÔNG xoá nợ: sổ ra = sổ CỦA CARRIER.
        expect out_datum.outstanding_entitlement == carrier.outstanding_entitlement

        // ── C-REF-TOTAL (v3, ngữ nghĩa sửa 2026-09-26): gộp KHÔNG viết lại LỊCH SỬ RÚT ──
        // `total_redeemed` là MẪU SỐ của trần một lượt ở `claim_account` — mọi tài khoản
        // trong hệ đọc nó. Không có dòng này thì `Refill` đặt nó tuỳ ý, và cả hai chiều
        // đều hại theo kiểu không kêu:
        //   • ĐẶT LỚN  ⇒ trần một lượt phồng cho TOÀN hệ ngay lập tức. Không tài khoản
        //     nào vượt `vested` của nó, nên không bất biến nào gãy — thứ mất là NHỊP,
        //     đúng cái mà phép cắt ngọn sinh ra để giữ.
        //   • ĐẶT NHỎ (hay 0) ⇒ trần rơi về `trim_floor`, tức dựng lại chính điểm hấp
        //     thụ mà sàn ấy có mặt để phá.
        //
        // ⚠ BẢN TRƯỚC ÉP `== Σ total_redeemed CỦA MỌI INPUT CÓ DATUM`, và chú thích của
        // nó tự biện hộ nguyên văn: *"Chặn chặt hơn (đòi input lạ khai 0) sẽ giết cả lượt
        // gộp hai kho hợp lệ."* Câu đó SAI, và nó sai vì một dữ kiện nằm ở tệp khác:
        // `treasury_nft` là policy ONE-SHOT ⇒ **không bao giờ tồn tại hai kho hợp lệ** để
        // mà gộp. Mọi input ở địa chỉ kho ngoài carrier hoặc là LAMP rót về qua A-DEST
        // (không datum), hoặc là một UTxO người lạ tự đỗ — Cardano không chạy validator
        // lúc TẠO output, nên datum của nó là thứ kẻ dựng tx tự viết. Phép TỔNG vì thế
        // không gộp hai sự thật, nó cộng một sự thật với một lời khai.
        //
        // Cái giá của phép tổng, đo theo đúng hai chiều ở trên: một UTxO tự đỗ khai
        // `total_redeemed = 10^24` được gộp vào ⇒ mẫu số của TOÀN hệ nhảy lên 10^24 ⇒
        // phép cắt ngọn chết VĨNH VIỄN, vì trường này CHỈ TĂNG nên không nhánh nào kéo
        // nó về. `C-REF-SIGN` (`>= 0`) không bắt được: số khống là số DƯƠNG.
        expect out_datum.total_redeemed == carrier.total_redeemed

        // Giá trị: mọi asset khác bảo toàn TUYỆT ĐỐI (chống rút ADA và chống đánh cắp
        // NFT "TRSY" ra ngoài), CHỈ LAMP được phép TĂNG một lượng `deposited >= 0`.
        let lamp_in = assets.quantity_of(value_in, lamp_policy, lamp_name)
        let lamp_out = assets.quantity_of(tre_out.value, lamp_policy, lamp_name)
        let deposited = lamp_out - lamp_in
        expect deposited >= 0
        expect tre_out.value == assets.add(value_in, lamp_policy, lamp_name, deposited)

        // C-SOLV-2 MỞ RỘNG SANG REFILL — mệnh đề này KHÔNG có trong đặc tả được giao,
        // em thêm vào vì tìm được đường phá; báo rõ chứ không lặng lẽ:
        //   Refill gộp Σ sổ cái của mọi input. Ai cũng đỗ được một UTxO ở địa chỉ kho
        //   (Cardano không chạy validator lúc TẠO) mang `TreasuryDatum` khai nợ khống.
        //   Không có dòng này, một tx { Refill(kho thật + UTxO-khai-khống-N), Claim(N) }
        //   thoả CẢ Refill (sổ ra = tổng vào) LẪN C-SOLV-1 phía `claim_account`
        //   (`trsy_out == trsy_in + amount`) ⇒ cấp entitlement N mà KHÔNG hề đi qua
        //   `GrantEntitlement`, tức KHÔNG qua cửa `nợ ≤ pool`. Với dòng này, nợ khống
        //   phải nằm dưới pool thật ⇒ không vượt được trần mà GrantEntitlement đã đặt.
        // Không làm kẹt vận hành hợp lệ: bất biến `nợ ≤ pool` đã đúng trước khi gộp
        // (genesis 0, Grant ép ≤, Release trừ đều hai vế), gộp chỉ cộng hai vế lại và
        // `deposited >= 0` chỉ làm vế phải to thêm.
        //
        // ⚠ 2026-09-26 — C-REF-PROV ở trên đã giết đường phá mô tả trong đoạn này (sổ ra
        // nay bằng sổ carrier, nên Refill KHÔNG làm sổ tăng được lấy một đơn vị). Dòng
        // này GIỮ LẠI làm lớp thứ hai, đúng vì nó đo một đại lượng KHÁC: C-REF-PROV đo
        // GỐC TÍCH của con số, dòng này đo QUAN HỆ giữa nó và pool. Một lượt nới C-REF-PROV
        // về sau mà quên dòng này thì mở lại trọn vẹn lối cũ.
        expect out_datum.outstanding_entitlement <= lamp_out

        // ── DOUBLE-SATISFACTION: vì sao chạy N lần vẫn kết luận như nhau ───────────
        // `Refill` chạy MỘT LẦN CHO MỖI input ở script. Hai thứ khác nhau giữa các lần
        // chạy là `own_ref` và `datum_opt`. `datum_opt` KHÔNG được đọc ở nhánh này.
        // `own_ref` chỉ dùng để lấy `own_hash` — mà mọi input ở đây có CÙNG payment
        // credential, nên `own_hash` y hệt. Toàn bộ phần còn lại là mệnh đề TOÀN TX
        // (đếm output, tổng vào/ra, chữ ký, mint) ⇒ mọi lần chạy đánh giá ĐÚNG CÙNG một
        // biểu thức ⇒ hoặc tất cả PASS hoặc tất cả FAIL. Không có "một output thoả cho
        // nhiều input" vì output chỉ có ĐÚNG MỘT và nó bị ép bằng TỔNG mọi input.
        // Trộn redeemer trong cùng tx cũng không mở được gì: nếu một input khác dùng
        // `ReleaseForRedeem`/`GrantEntitlement` thì hai redeemer ấy đòi
        // `count_inputs_at_script == 1`, mà đã có ≥ 2 input ở script ⇒ tx chết.
        // Kèm Redeem của `claim_account` cũng bất khả: Redeem đòi sổ cái GIẢM đúng
        // `amount > 0`, Refill đòi sổ ra = tổng sổ vào ⇒ mâu thuẫn.
        True
      }
    }
  }

  else(_) {
    fail
  }
}

/// Bộ khung SINGLETON dùng chung cho hai redeemer cũ (C-TRE-1 + C-TRE-2):
/// đúng 1 treasury input + 1 output theo SCRIPT HASH trên toàn tx (chống N× release /
/// split sổ cái qua nhiều treasury UTxO), datum ra decode được, `committee_hash` bảo toàn.
/// Tách thành hàm khi `Refill` buộc phần này rời khỏi thân chung — giữ NGUYÊN từng mệnh đề.
fn singleton_io(
  tx       : Transaction,
  own_hash : ByteArray,
  in_datum : TreasuryDatum,
) -> (Output, Output, TreasuryDatum) {
  expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
  expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

  let tre_in = util.input_at_script(tx.inputs, own_hash)
  let tre_out = util.output_at_script(tx.outputs, own_hash)

  expect InlineDatum(od) = tre_out.datum
  expect out_datum: TreasuryDatum = od
  expect out_datum.committee_hash == in_datum.committee_hash

  (tre_in, tre_out, out_datum)
}

/// C-REF-PROV (2026-09-26) — `TreasuryDatum` của **carrier**, tức UTxO ở địa chỉ kho mang
/// NFT kho "TRSY". Đây là vật DUY NHẤT trong tập input mà sổ cái của nó có gốc tích:
/// `treasury_nft` là policy ONE-SHOT, nó ra đời đúng một lần ở genesis với sổ mở `0/0`
/// (`treasury_nft.ak` ▸ `td.outstanding_entitlement == 0`, `td.total_redeemed == 0`), và
/// từ đó mọi lần nó đổi tay đều đi qua một nhánh của chính tệp này.
///
/// ⚠ HÀM NÀY THAY `fold_ledger`, bản CỘNG sổ của MỌI input có inline datum. Bản cũ hỏng
/// theo kiểu không kêu: địa chỉ kho chỉ là một hash công khai, ai cũng trả min-ADA vào đó
/// kèm `TreasuryDatum` TỰ VIẾT — Cardano KHÔNG chạy validator lúc TẠO output, chỉ lúc
/// TIÊU. Hai trường sổ, hai đường hại, cùng một lối vào:
///   • `total_redeemed` khống (ví dụ 10^24) ⇒ MẪU SỐ của phép cắt ngọn ở `claim_account`
///     nhảy lên cho TOÀN hệ, và vì trường này CHỈ TĂNG nên không nhánh nào kéo nó về:
///     phép cắt ngọn chết VĨNH VIỄN sau đúng một giao dịch;
///   • `outstanding_entitlement` khống ⇒ sổ NỢ phình, C-SOLV-2 từ chối mọi
///     `GrantEntitlement` về sau, và sổ nợ chỉ giảm qua `ReleaseForRedeem` — vốn cần một
///     tài khoản thật rút tiền — nên phần phình đó cũng không có đường lùi.
/// Bản cũ chỉ ép hai số đó `>= 0` (C-REF-SIGN) và ép `committee_hash` khớp nhau; cả hai
/// mệnh đề đều thoả được bằng cách khai một số DƯƠNG kèm `committee_hash` công khai.
/// Nói gọn: bản cũ kiểm **DẤU** của con số mà không kiểm **NGUỒN** của nó.
///
/// NGỮ NGHĨA CHỌN cho input KHÔNG phải carrier: **BỎ QUA datum, KHÔNG fail**. Lý do là
/// vận hành — `Refill` sinh ra để gom LAMP rót về kho qua A-DEST, và committee không
/// kiểm soát được ai đỗ cái gì ở một địa chỉ công khai. Fail-closed ở đây biến một hành
/// vi mà người lạ tuỳ ý gây ra thành một cổng chặn chính chủ kho gom tiền của mình. Bỏ
/// qua thì an toàn, vì sau dòng này KHÔNG con số nào của input đó đi vào một mệnh đề:
/// value của nó vẫn được cộng (đó là điểm của Refill), datum của nó thì không.
///
/// `expect [carrier]` — ĐÚNG MỘT, không phải "ít nhất một":
///   • 0 carrier ⇒ từ chối. Nếu không, một `Refill` gom hai UTxO lạ sẽ SINH RA một UTxO
///     ở địa chỉ kho mang sổ tuỳ ý — một cái kho giả trông y hệt kho thật với mọi công cụ
///     đọc theo địa chỉ.
///   • ≥2 ⇒ từ chối. Fail-closed cho một trạng thái mà one-shot policy nói là không thể.
///
/// GIỚI HẠN CÒN LẠI, nói thẳng: `treasury` KHÔNG nhận `treasury_nft_policy` làm tham số
/// (8 khe hiện có đã bake vào đường apply-param của off-chain), nên phép nhận diện ở đây
/// đi theo TÊN tài sản `"TRSY"`, không theo policy id. Hệ quả: đúc một tài sản trùng tên
/// dưới policy khác rồi đỗ ở địa chỉ kho thì tập carrier có 2 phần tử ⇒ giao dịch gộp đó
/// bị từ chối. Đó là quấy rối (committee chỉ cần không chọn UTxO ấy vào input), KHÔNG
/// phải đường chiếm sổ: một `Refill` không có carrier THẬT tạo ra UTxO không mang NFT
/// "TRSY" của policy thật, mà `claim_account` tìm kho THUẦN THEO policy đó
/// (`find_treasury_in`/`find_treasury_out`) ⇒ vật ấy trơ, và không bao giờ gộp ngược lại
/// được vào kho thật (2 carrier). Muốn khoá nốt khe quấy rối thì phải thêm tham số
/// `treasury_nft_policy` — một đổi ARITY, tức một lượt deploy có phối hợp với off-chain.
fn carrier_ledger(ins: List<Input>) -> TreasuryDatum {
  let trsy = util.treasury_nft_name()
  expect [carrier] = list.filter(ins, fn(i) { bears_treasury_nft(i.output.value, trsy) })

  // Carrier phải đọc được sổ NGAY TRONG `Output`. Datum-hash thì datum thật nằm ngoài
  // giao dịch ⇒ fail-closed, thay vì âm thầm coi như sổ 0.
  expect InlineDatum(d) = carrier.output.datum
  expect td: TreasuryDatum = d

  // C-REF-SIGN — cận DƯỚI, đối xứng với `<= lamp_out` là cận TRÊN. Sau C-REF-PROV đây là
  // lớp phòng thủ theo chiều sâu chứ không còn là lớp duy nhất: mọi nhánh ghi vào carrier
  // đã ép hai trường này không âm. Giữ vì nó rẻ và vì nó là thứ duy nhất canh một carrier
  // sinh ra từ một bản `treasury` cũ hơn bản đang chạy.
  expect td.outstanding_entitlement >= 0
  expect td.total_redeemed >= 0
  td
}

/// Value có mang đúng MỘT đơn vị tài sản tên `"TRSY"` (policy bất kỳ) không.
/// Xem docstring `carrier_ledger` cho lý do phép so đi theo TÊN chứ không theo policy id.
fn bears_treasury_nft(v: assets.Value, trsy: ByteArray) -> Bool {
  list.any(
    assets.flatten(v),
    fn(tok) {
      let (_policy, name, qty) = tok
      name == trsy && qty == 1
    },
  )
}

fn find_claim_account_input(inputs: List<Input>, script_hash: ByteArray) -> ClaimAccountDatum {
  expect Some(i) = list.find(inputs, fn(x) { util.is_at_script(x.output.address, script_hash) })
  expect InlineDatum(d) = i.output.datum
  expect ca: ClaimAccountDatum = d
  ca
}

fn find_claim_account_output(outputs: List<Output>, script_hash: ByteArray) -> ClaimAccountDatum {
  expect Some(o) = list.find(outputs, fn(x) { util.is_at_script(x.address, script_hash) })
  expect InlineDatum(d) = o.datum
  expect ca: ClaimAccountDatum = d
  ca
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction) — chứng minh fix C2 + M1
// ══════════════════════════════════════════════════════════════

const tt_tre_sh: ByteArray = #"77777777"

const tt_ca_sh: ByteArray = #"a1a1a1a1"

const tt_lamp_policy: ByteArray = #"1a3b"

const tt_lamp_name: ByteArray = #"744c414d50"

const tt_owner: ByteArray = #"0a0a"

const tt_committee: List<ByteArray> = [#"c1", #"c2", #"c3"]

const tt_threshold: Int = 2

const tt_acct_nft_policy: ByteArray = #"acac"

const tt_mspe: Int = 432_000_000

/// Cửa sổ mà mọi ca GRANT dựng sẵn chạy trong đó. KHÁC 0 có chủ đích: bản trước chọn 0, làm
/// `start_epoch` của mọi tài khoản vào bằng 0 và một số hạng của công thức mốc không bao giờ
/// được đầu vào nào chạm tới. Tài khoản vào ở nhánh UPDATE mang mốc 2 (`grant_tx_at`).
const tt_window: Int = 7

// ── Beacon dùng chung cho mọi ca GRANT (v3, C-CLAIM-8) ───────────────────────
// `epoch` KHÁC `tt_window` và `rate_root` KHÁC 0, cả hai đều có chủ đích: chỉ khi đó
// `A(tt_window)` mới khác `index`. Mẫu nào để `epoch == tt_window` thì hai vế bằng nhau,
// và mọi ca dựng trên nó XANH ở cả hai cực — kể cả với một hiện thực bỏ quên `epoch`,
// đúng cái bẫy `util.ak` ▸ `find_beacon` đã ghi ra. Tức mẫu đó không kiểm gì.
const tt_bcn_policy: ByteArray = #"beac"

const tt_bcn_epoch: Int = 3

const tt_bcn_index: Int = 500

const tt_bcn_rate: Int = 100

/// A(tt_window) = index + rate_root · (7 − 3) = 500 + 400 = 900.
const tt_a_now: Int = 900

/// `A` tại một cửa sổ bất kỳ — cho các ca chạy ngoài `tt_window` (ví dụ ca tài khoản già
/// ở cửa sổ 100). Dùng hằng ở trên cho ca đó thì nó đỏ vì SAI CỬA SỔ, không vì mệnh đề
/// đang muốn canh — một bài đỏ nói sai nguyên nhân.
fn tt_a_at(window: Int) -> Int {
  tt_bcn_index + tt_bcn_rate * ( window - tt_bcn_epoch )
}

/// Reference input mang beacon NFT — `GrantEntitlement` đòi nó ở MỌI giao dịch (đây là
/// một đổi HÌNH DẠNG TX của v3, không chỉ đổi tham số).
fn tt_bcn_ref() -> Input {
  util.mk_input(
    util.mk_ref(9),
    util.mk_output(
      util.script_address(#"bcbc"),
      assets.add(
        assets.from_lovelace(2_000_000),
        tt_bcn_policy,
        util.beacon_name(DropParam),
        1,
      ),
      BeaconDatum {
        epoch: tt_bcn_epoch,
        kind: DropParam,
        index: tt_bcn_index,
        rate_root: tt_bcn_rate,
        trim_num: 1,
        trim_den: 1000,
        speed_policies: [],
      },
    ),
  )
}

fn tt_tre_d(cum: Int) -> TreasuryDatum {
  tt_tre_d_tr(cum, 0)
}

/// v3: chọn được `total_redeemed` — cần cho các ca ghim C-RDM-TOTAL, nơi hai trường sổ
/// phải đi ngược chiều nhau trong CÙNG một giao dịch.
fn tt_tre_d_tr(cum: Int, total_redeemed: Int) -> TreasuryDatum {
  TreasuryDatum {
    committee_hash: #"cccc",
    outstanding_entitlement: cum,
    total_redeemed: total_redeemed,
  }
}

fn tt_ca_d(entitlement: Int, redeemed: Int) -> ClaimAccountDatum {
  tt_ca_d_at(entitlement, redeemed, tt_window)
}

fn tt_ca_d_at(entitlement: Int, redeemed: Int, start_epoch: Int) -> ClaimAccountDatum {
  tt_ca_d_idx(entitlement, redeemed, start_epoch, tt_a_now)
}

/// v3: chọn được `index_at_start` — cần cho các ca âm tính của C-CLAIM-8, nơi mọi thứ
/// khác phải giữ nguyên để chỉ đúng mệnh đề đó phân biệt được hai cực.
fn tt_ca_d_idx(
  entitlement   : Int,
  redeemed      : Int,
  start_epoch   : Int,
  index_at_start: Int,
) -> ClaimAccountDatum {
  ClaimAccountDatum {
    owner: tt_owner,
    entitlement: entitlement,
    redeemed: redeemed,
    start_epoch: start_epoch,
    drops_per_epoch: 1,
    index_at_start: index_at_start,
  }
}

/// Validity range nằm gọn trong một cửa sổ — thoả Luật 2b (`util.get_epoch_strict`).
fn tt_range(window: Int) -> interval.Interval {
  interval.between(window * tt_mspe, window * tt_mspe + 1000)
}

fn tt_lamp_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(lovelace), tt_lamp_policy, tt_lamp_name, lamp)
}

// ── RELEASE (ReleaseForRedeem) ────────────────────────────────
fn release_tx(
  tre_in_val  : assets.Value,
  tre_out_val : assets.Value,
  cum_in      : Int,
  cum_out     : Int,
  redeemed_in : Int,
  redeemed_out: Int,
  extra_tre   : List<Input>,
) -> Transaction {
  // C-RDM-TOTAL phía kho: sổ ĐÃ PHÁT RA tăng ĐÚNG `released`. Suy ra tại đây để mọi ca
  // cũ giữ nguyên ý nghĩa; ca nào muốn bẻ riêng mệnh đề này thì đi qua `release_tx_tr`.
  release_tx_tr(
    tre_in_val, tre_out_val, cum_in, cum_out, redeemed_in, redeemed_out,
    redeemed_out - redeemed_in, extra_tre,
  )
}

/// Bản đầy đủ: chọn được `total_redeemed` của datum kho RA, độc lập với `released`.
fn release_tx_tr(
  tre_in_val      : assets.Value,
  tre_out_val     : assets.Value,
  cum_in          : Int,
  cum_out         : Int,
  redeemed_in     : Int,
  redeemed_out    : Int,
  total_redeemed_out: Int,
  extra_tre       : List<Input>,
) -> Transaction {
  let tre_addr = util.script_address(tt_tre_sh)
  let ca_addr = util.script_address(tt_ca_sh)
  let tre_in = util.mk_input(util.mk_ref(0), util.mk_output(tre_addr, tre_in_val, tt_tre_d(cum_in)))
  let tre_out = util.mk_output(tre_addr, tre_out_val, tt_tre_d_tr(cum_out, total_redeemed_out))
  let ca_in =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(1000, redeemed_in)),
    )
  let ca_out = util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(1000, redeemed_out))
  Transaction {
    ..placeholder,
    inputs: list.concat([tre_in, ca_in], extra_tre),
    outputs: [tre_out, ca_out],
    mint: assets.zero,
  }
}

fn release(cum_in: Int, tx: Transaction) -> Bool {
  treasury.spend(
    tt_ca_sh, tt_lamp_policy, tt_lamp_name, tt_committee, tt_threshold,
    tt_acct_nft_policy,
    tt_mspe,
    tt_bcn_policy,
    Some(tt_tre_d(cum_in)), ReleaseForRedeem, util.mk_ref(0), tx,
  )
}

test treasury_happy() {
  // released = 100; treasury LAMP 1000 → 900, ADA giữ nguyên, sổ cái nợ 500 → 400.
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 500, 400, 0, 100, []))
}

// ── C-RDM-TOTAL phía kho (v3): `total_redeemed` tăng ĐÚNG `released` ──────────
// Ba ca dưới CHỈ khác nhau ở `total_redeemed` của datum kho RA — mọi thứ còn lại, kể cả
// `released` và value, giữ nguyên. Hai sổ đi NGƯỢC CHIỀU trong cùng một giao dịch, nên
// một ca chỉ đo `outstanding_entitlement` không phân biệt được mệnh đề này.
//
// Chiều nguy hiểm là chiều THIẾU: `total_redeemed` là MẪU SỐ của phép cắt ngọn ở
// `claim_account`, nên nó nhỏ hơn sự thật ⇒ trần rút co lại ⇒ hệ tự bóp nghẹt chính nó,
// và không dòng nào kêu.

/// `total_redeemed` đứng yên trong khi 100 LAMP đã rời kho.
test treasury_release_total_redeemed_frozen_rejected() fail {
  release(500,
    release_tx_tr(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900),
      500, 400, 0, 100, 0, []))
}

/// Chiều THỪA: khai phát ra nhiều hơn thật ⇒ trần cắt ngọn nới rộng không có cơ sở.
test treasury_release_total_redeemed_over_incremented_rejected() fail {
  release(500,
    release_tx_tr(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900),
      500, 400, 0, 100, 101, []))
}

/// Đối chứng dương với ĐÚNG hai ca trên: chỉ số 100 là khác biệt duy nhất.
test treasury_release_total_redeemed_exact_ok() {
  release(500,
    release_tx_tr(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900),
      500, 400, 0, 100, 100, []))
}

test treasury_double_release() fail {
  // C2: 2 treasury input cùng script hash, KHÁC stake cred → count == 2 → reject
  let tre_addr2 = util.script_address_staked(tt_tre_sh, #"5742")
  let extra =
    util.mk_input(util.mk_ref(9), util.mk_output(tre_addr2, tt_lamp_val(5_000_000, 1000), tt_tre_d(500)))
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 500, 400, 0, 100, [extra]))
}

test treasury_ada_drain() fail {
  // M1: LAMP delta đúng nhưng rút bớt ADA (5M→2M) → value sai → reject
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(2_000_000, 900), 500, 400, 0, 100, []))
}

test treasury_zero_release() fail {
  // released = 0 → expect released > 0 fail → reject
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 1000), 500, 500, 100, 100, []))
}

test treasury_release_ledger_frozen_fails() fail {
  // C-SOLV-3 (ngữ nghĩa MỚI): pool giảm 100 mà sổ cái nợ đứng yên (500→500) → reject.
  // Đây CHÍNH LÀ hành vi bản đầu ÉP PHẢI có, và là nguồn bế tắc grant.
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 500, 500, 0, 100, []))
}

test treasury_release_ledger_overpay_fails() fail {
  // Sổ cái giảm 200 trong khi pool chỉ giảm 100 → lệch → reject (không xoá nợ khống).
  release(500, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 500, 300, 0, 100, []))
}

test treasury_release_ledger_never_negative() fail {
  // Nợ mở 50 nhưng release 100 → sổ cái ra −50 → reject (chốt số học C-SOLV-3).
  release(50, release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 50, -50, 0, 100, []))
}

test treasury_grant_after_full_redeem_ok() {
  // HỒI QUY điểm 1 review: đã cấp 5000, người dùng rút HẾT (nợ 0), quỹ còn/nạp lại 5000.
  // Cấp thêm 1000 cho account MỚI phải PASS. Bản đầu TỪ CHỐI ca này (5000+1000 > 5000)
  // dù quỹ không nợ ai — chính là bế tắc.
  grant(0, grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"]))
}

// ── GRANT (GrantEntitlement — Claim cấp E) ────────────────────
// CREATE: 0 ca input, 1 ca output (entitlement = granted, redeemed=0).
// UPDATE: 1 ca input + 1 ca output (granted = ent_out − ent_in).
fn grant_tx(
  pool        : Int,
  cum_in      : Int,
  cum_out     : Int,
  ent_in_opt  : Option<Int>,   // None = CREATE (no ca input)
  ent_out     : Int,
  redeemed_out: Int,
  sigs        : List<ByteArray>,
) -> Transaction {
  grant_tx_at(pool, cum_in, cum_out, ent_in_opt, ent_out, redeemed_out, sigs,
    tt_window, tt_range(tt_window))
}

/// Bản đầy đủ: chọn được `start_epoch` ghi vào tài khoản VÀ validity range của tx — hai
/// đại lượng mà C-ACC-2 ràng vào nhau. Mọi ca cũ đi qua `grant_tx` ở trên, nơi hai thứ đó
/// khớp; các ca âm tính bên dưới bẻ đúng một trong hai.
fn grant_tx_at(
  pool        : Int,
  cum_in      : Int,
  cum_out     : Int,
  ent_in_opt  : Option<Int>,
  ent_out     : Int,
  redeemed_out: Int,
  sigs        : List<ByteArray>,
  start_epoch : Int,
  vr          : interval.Interval,
) -> Transaction {
  let tre_addr = util.script_address(tt_tre_sh)
  let ca_addr = util.script_address(tt_ca_sh)
  let val = tt_lamp_val(5_000_000, pool)
  let tre_in = util.mk_input(util.mk_ref(0), util.mk_output(tre_addr, val, tt_tre_d(cum_in)))
  let tre_out = util.mk_output(tre_addr, val, tt_tre_d(cum_out))
  // ⚠ 2026-09-26 — output tài khoản MANG NFT tài khoản. Bản trước chỉ có 2 ADA, tức mọi
  // ca CREATE dựng sẵn mô tả một hình dạng KHÔNG BAO GIỜ hợp lệ trên chuỗi (tài khoản
  // không NFT thì `claim_account.spend` từ chối nó vĩnh viễn) — và chính vì fixture không
  // mang NFT nên C-ACC-1b không thể ra đời: viết nó ra là 7 ca dương đỏ ngay.
  let ca_out =
    util.mk_output(ca_addr, tt_ca_out_value(), tt_ca_d_at(ent_out, redeemed_out, start_epoch))
  let base_inputs =
    when ent_in_opt is {
      Some(ent_in) -> {
        let ca_in =
          util.mk_input(
            util.mk_ref(1),
            util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d_at(ent_in, 0, 2)),
          )
        [tre_in, ca_in]
      }
      None -> [tre_in]
    }
  Transaction {
    ..placeholder,
    inputs: base_inputs,
    // v3 C-CLAIM-8: beacon ở reference_inputs, KHÔNG phải input tiêu.
    reference_inputs: [tt_bcn_ref()],
    outputs: [tre_out, ca_out],
    extra_signatories: sigs,
    // C-ACC-1: đường CREATE (không có ca input) BẮT BUỘC đúc NFT tài khoản cho đúng ví.
    // Đường UPDATE thì không đúc gì — C-MINT-1 chỉ NỚI chứ không ĐÒI.
    mint: when ent_in_opt is {
      None -> assets.add(assets.zero, tt_acct_nft_policy, tt_acct_nft_name(), 1)
      Some(_) -> assets.zero
    },
    validity_range: vr,
  }
}

fn grant(cum_in: Int, tx: Transaction) -> Bool {
  treasury.spend(
    tt_ca_sh, tt_lamp_policy, tt_lamp_name, tt_committee, tt_threshold,
    tt_acct_nft_policy,
    tt_mspe,
    tt_bcn_policy,
    Some(tt_tre_d(cum_in)), GrantEntitlement, util.mk_ref(0), tx,
  )
}

test grant_create_happy() {
  // CREATE: cấp E=1000, cum 0→1000 ≤ pool 5000, pool bất biến.
  grant(0, grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"]))
}

/// C-ACC-1: CREATE mà KHÔNG đúc NFT tài khoản → chặn. Không có mệnh đề này thì cổng NFT
/// chỉ "được phép" chứ chưa "bắt buộc": nợ vào sổ mà tài khoản vĩnh viễn không tiêu được
/// (spend đòi NFT), và phần sổ phình đó KHÔNG có đường lùi vì `ReleaseForRedeem` cần một
/// tài khoản tiêu được mới giảm sổ được.
test grant_create_without_minting_account_nft_rejected() fail {
  let tx = Transaction { ..grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"]), mint: assets.zero }
  grant(0, tx)
}

// ── C-ACC-1b (2026-09-26): NFT phải NẰM TRONG tài khoản, không chỉ được ĐÚC ────
// Hai ca dưới chia đôi đúng chỗ mà C-ACC-1 một mình không với tới: nó đo `tx.mint`, tức
// đo sự TỒN TẠI của NFT. Ca `..._minted_elsewhere_...` giữ nguyên `tx.mint` hợp lệ và chỉ
// dời NFT sang một output khác — gỡ C-ACC-1b ra thì nó ĐƯỢC CHẤP NHẬN, còn C-ACC-1 vẫn
// xanh, vì không một chữ nào của C-ACC-1 nói về nơi hạ cánh.

/// NFT đúc đúng tên, đúng policy, nhưng hạ cánh ở một script KHÁC (điều mà
/// `claim_account_nft.ak` ▸ A-ACC-3 CHO PHÉP: nó chỉ ép "một Script bất kỳ"). Tài khoản
/// sinh ra không NFT ⇒ `claim_account.spend` từ chối nó vĩnh viễn ⇒ `granted` vào sổ nợ
/// mà không có đường lùi. Khác `grant_create_happy` ĐÚNG MỘT điều: NFT nằm ở output nào.
test grant_create_account_nft_minted_elsewhere_rejected() fail {
  let base = grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"])
  expect [tre_out, ca_out] = base.outputs
  let stripped = Output { ..ca_out, value: assets.from_lovelace(2_000_000) }
  let elsewhere = Output { ..ca_out, address: util.script_address(#"beefbeef") }
  grant(0, Transaction { ..base, outputs: [tre_out, stripped, elsewhere] })
}

/// Cùng khuôn nhưng NFT bị giữ lại trong VÍ người dựng tx — biến thể rẻ nhất của ca trên
/// và là hình dạng mà một builder viết ẩu sinh ra (quên `.pay.ToContract` phần NFT).
test grant_create_account_nft_kept_in_wallet_rejected() fail {
  let base = grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"])
  expect [tre_out, ca_out] = base.outputs
  let stripped = Output { ..ca_out, value: assets.from_lovelace(2_000_000) }
  let to_wallet =
    util.mk_output_no_datum(
      util.vk_address(#"badbad"),
      assets.from_lovelace(2_000_000)
        |> assets.add(tt_acct_nft_policy, tt_acct_nft_name(), 1),
    )
  grant(0, Transaction { ..base, outputs: [tre_out, stripped, to_wallet] })
}

// ── C-ACC-2 (Issue #72, lỗ 1): `start_epoch` phải là cửa sổ HIỆN TẠI ──────────
//
// Ca âm tính trung tâm. Trước bản vá cả năm ca dưới đây đều XANH, và ca đầu là ca đã
// chạy thật trên Preprod: tài khoản mở ở cửa sổ 4142 mang `start_epoch = 4141` rồi rút
// ngay trong giao dịch kế tiếp.

/// LÙI NGÀY — chiều tấn công thật. Cửa sổ 7, ghi `start_epoch = 6` ⇒ `elapsed` đã bằng 1
/// ngay lúc tài khoản vừa mở.
test grant_create_backdated_start_epoch_rejected() fail {
  grant(0, grant_tx_at(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"], 6, tt_range(7)))
}

/// LÙI XA — cùng lỗ, thang khác: `start_epoch = 0` ở cửa sổ 7 cho `elapsed = 7`, đủ để
/// vested trọn `entitlement` ngay lượt rút đầu.
test grant_create_far_backdated_start_epoch_rejected() fail {
  grant(0, grant_tx_at(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"], 0, tt_range(7)))
}

/// TIẾN NGÀY — không phải chuyện thẩm mỹ. `start_epoch` ở tương lai ⇒ không bao giờ
/// vested ⇒ `Redeem` không chạy ⇒ nợ đã vào `outstanding_entitlement` mà chỉ
/// `ReleaseForRedeem` mới rút ra được, và nhánh ấy cần một tài khoản rút được. Bẫy
/// một-chiều, cùng họ với ca C-ACC-1 ngay trên.
test grant_create_future_start_epoch_rejected() fail {
  grant(0, grant_tx_at(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"], 9, tt_range(7)))
}

/// Luật 2b — không đầu trên thì tx không tự khai nổi cửa sổ của nó. Fail-closed.
/// Ca này cũng là ca chứng minh vì sao C-ACC-2 KHÔNG dùng được `util.get_epoch`: hàm đó
/// nhận đúng khoảng `interval.after` này và trả về 7, tức mọi ca trên vẫn lọt.
test grant_create_unbounded_range_rejected() fail {
  grant(0,
    grant_tx_at(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"], 7, interval.after(7 * tt_mspe)))
}

/// Cửa sổ vắt qua biên epoch ⇒ hai đầu rơi hai cửa sổ ⇒ từ chối. Bên dựng tx phải kéo
/// đầu trên về sát cuối cửa sổ.
///
/// ⚠ Ca này KHÔNG ghim được đầu trên của Luật 2b: gỡ mệnh đề ấy ra thì nó vẫn đỏ, chỉ là
/// đỏ ở C-ACC-2 (`e` thành 6, mà `start_epoch` ghi 7). Ca ghim thật ở ngay dưới.
test grant_create_range_straddles_boundary_rejected() fail {
  grant(0,
    grant_tx_at(
      5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"], 7,
      interval.between(7 * tt_mspe - 1000, 7 * tt_mspe + 1000),
    ))
}

/// Ca PHÂN BIỆT cho ĐẦU TRÊN của Luật 2b. Đầu dưới rơi cửa sổ 7, đầu trên rơi cửa sổ 8,
/// `start_epoch` ghi 7 — tức KHỚP với `get_epoch(lower)`. Còn mệnh đề đầu trên thì từ
/// chối; gỡ nó ra thì tx này ĐƯỢC CHẤP NHẬN.
///
/// Đây chính là đường lùi ngày mà lỗ 1 nói tới, ở dạng tinh vi hơn ca `backdated`: kẻ
/// dựng tx không cần ghi một `start_epoch` sai, chỉ cần kéo dài đầu trên của validity
/// range. Viết SAU khi phép đo đảo báo mệnh đề đầu trên không bài nào canh.
test grant_create_upper_bound_is_the_binding_clause() fail {
  grant(0,
    grant_tx_at(
      5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"], 7,
      interval.between(7 * tt_mspe, 8 * tt_mspe),
    ))
}

/// ĐỐI CHỨNG: cùng khuôn, `start_epoch` khớp cửa sổ ⇒ XANH. Không có ca này thì năm ca
/// đỏ ở trên xanh được bằng cách làm hỏng bất cứ thứ gì khác trong `grant_tx_at`.
test grant_create_start_epoch_matches_window_ok() {
  grant(0, grant_tx_at(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"], 7, tt_range(7)))
}

// ── C-ACC-3 (2026-09-17): cấp thêm = REBASE tài khoản ─────────────────────────
// Tài khoản vào mang `redeemed = 150`, `start_epoch = 2` — CỐ Ý khác 0 và khác cửa sổ 7.
// Để mặc định (redeemed 0, start = cửa sổ) thì số hạng `− redeemed` và mệnh đề mốc có hay
// không cũng ra cùng kết quả ở mọi ca, tức không bài nào ghim được chúng.

fn tt_ca(entitlement: Int, redeemed: Int, start_epoch: Int, dpe: Int) -> ClaimAccountDatum {
  tt_ca_idx(entitlement, redeemed, start_epoch, dpe, tt_a_now)
}

fn tt_ca_idx(
  entitlement   : Int,
  redeemed      : Int,
  start_epoch   : Int,
  dpe           : Int,
  index_at_start: Int,
) -> ClaimAccountDatum {
  ClaimAccountDatum {
    owner: tt_owner,
    entitlement: entitlement,
    redeemed: redeemed,
    start_epoch: start_epoch,
    drops_per_epoch: dpe,
    index_at_start: index_at_start,
  }
}

/// UPDATE đầy đủ: chọn được datum tài khoản vào/ra và validity range.
fn grant_upd_tx(
  cum_in : Int,
  cum_out: Int,
  in_d   : ClaimAccountDatum,
  out_d  : ClaimAccountDatum,
  vr     : interval.Interval,
) -> Transaction {
  let tre_addr = util.script_address(tt_tre_sh)
  let ca_addr = util.script_address(tt_ca_sh)
  let val = tt_lamp_val(5_000_000, 5000)
  Transaction {
    ..placeholder,
    inputs: [
      util.mk_input(util.mk_ref(0), util.mk_output(tre_addr, val, tt_tre_d(cum_in))),
      util.mk_input(util.mk_ref(1), util.mk_output(ca_addr, assets.from_lovelace(2_000_000), in_d)),
    ],
    reference_inputs: [tt_bcn_ref()],
    outputs: [
      util.mk_output(tre_addr, val, tt_tre_d(cum_out)),
      util.mk_output(ca_addr, assets.from_lovelace(2_000_000), out_d),
    ],
    extra_signatories: [#"c1", #"c2"],
    mint: assets.zero,
    validity_range: vr,
  }
}

/// Đối chứng: E' = 400 − 150 + 1000 = 1250, redeemed' = 0, start' = 7; sổ 250 → 1250.
test grant_update_rebases_account_ok() {
  grant(250, grant_upd_tx(250, 1250, tt_ca(400, 150, 2, 1), tt_ca(1250, 0, 7, 1), tt_range(7)))
}

/// `granted` tính trên `entitlement` thay vì phần chưa rút: 1400 − 400 = 1000 khớp sổ, nhưng
/// datum ra mang E' = 1400 ⇒ nợ thật của tài khoản tăng 1150. Chỉ số hạng `− redeemed` chặn.
test grant_update_granted_ignoring_redeemed_rejected() fail {
  grant(250, grant_upd_tx(250, 1250, tt_ca(400, 150, 2, 1), tt_ca(1400, 150, 7, 1), tt_range(7)))
}

/// Entitlement đúng theo rebase nhưng `redeemed` giữ nguyên — chỉ mệnh đề `redeemed' = 0` chặn.
test grant_update_keeping_redeemed_rejected() fail {
  grant(250, grant_upd_tx(250, 1250, tt_ca(400, 150, 2, 1), tt_ca(1250, 150, 7, 1), tt_range(7)))
}

/// Mốc cũ giữ nguyên — đường mang tuổi sang lô mới.
test grant_update_keeping_old_start_rejected() fail {
  grant(250, grant_upd_tx(250, 1250, tt_ca(400, 150, 2, 1), tt_ca(1250, 0, 2, 1), tt_range(7)))
}

/// Ca ĐO ĐƯỢC của lỗ: tài khoản E=400 mở ở cửa sổ 0, top-up 1000 ở cửa sổ 100. Mốc 72 là
/// giá trị bản vá bình quân gia quyền chấp nhận — và với nó lượt rút kế tiếp ra trọn 1400.
test grant_update_weighted_average_start_rejected() fail {
  grant(400, grant_upd_tx(400, 1400, tt_ca(400, 0, 0, 1), tt_ca(1400, 0, 72, 1), tt_range(100)))
}

/// Cùng ca đó, rebase: mốc về đúng cửa sổ 100 VÀ chỉ số gốc về `A(100)` ⇒ QUA.
/// Tài khoản vào mang `A(0)` — chỉ số gốc của một tài khoản mở từ đầu.
test grant_update_aged_account_restarts_now_ok() {
  grant(400,
    grant_upd_tx(400, 1400, tt_ca_idx(400, 0, 0, 1, tt_a_at(0)),
      tt_ca_idx(1400, 0, 100, 1, tt_a_at(100)), tt_range(100)))
}

/// CÙNG ca đó, chỉ khác: mốc chỉ số giữ nguyên `A(0)` của tài khoản già. Đây là lỗ mà
/// C-CLAIM-8 sinh ra để bịt — rebase `start_epoch` KHÔNG cứu được, vì ở v3 `start_epoch`
/// không còn đi vào phép tính vested; thứ đi vào là `index_at_start`. Mọi mệnh đề rebase
/// khác đều thoả ở ca này, nên chỉ C-CLAIM-8 từ chối được nó.
test grant_update_aged_account_keeping_old_index_rejected() fail {
  grant(400,
    grant_upd_tx(400, 1400, tt_ca_idx(400, 0, 0, 1, tt_a_at(0)),
      tt_ca_idx(1400, 0, 100, 1, tt_a_at(0)), tt_range(100)))
}

/// Luật 2b ĐẦU TRÊN ở nhánh UPDATE: đầu dưới rơi cửa sổ 7 (khớp start' = 7 nếu chỉ đọc
/// `get_epoch`), đầu trên rơi cửa sổ 8. Hạ `get_epoch_strict` xuống `get_epoch` thì ca QUA.
test grant_update_range_upper_bound_rejected() fail {
  grant(250,
    grant_upd_tx(250, 1250, tt_ca(400, 150, 2, 1), tt_ca(1250, 0, 7, 1),
      interval.between(7 * tt_mspe, 8 * tt_mspe)))
}

/// Tài khoản đã rút hết (E = redeemed) nhận cấp mới: E' = 0 + 1000, sổ 0 → 1000.
test grant_update_fully_redeemed_account_ok() {
  grant(0, grant_upd_tx(0, 1000, tt_ca(400, 400, 2, 1), tt_ca(1000, 0, 7, 1), tt_range(7)))
}

// ── C-CLAIM-8 (v3) ở nhánh CREATE: `index_at_start` == A(cửa sổ này) ──────────
// CREATE là lối vào DUY NHẤT đặt mốc chỉ số của một tài khoản mới, và `claim_account`
// KHÔNG chạy ở đó (không có input tài khoản) ⇒ không có lớp thứ hai nào đỡ.
// Mốc đặt NHỎ hơn thật ⇒ `A_span` phồng lên ⇒ tài khoản vest gần như tức thì.
// Mốc đặt LỚN hơn thật ⇒ `A_span` âm ⇒ tài khoản không bao giờ rút được, mà nợ đã vào sổ.
// Hai chiều hỏng khác nhau, nên phải có hai ca, không gộp.

fn grant_create_idx_tx(index_at_start: Int) -> Transaction {
  let tre_addr = util.script_address(tt_tre_sh)
  let ca_addr = util.script_address(tt_ca_sh)
  Transaction {
    ..grant_tx_at(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"], 7, tt_range(7)),
    outputs: [
      util.mk_output(tre_addr, tt_lamp_val(5_000_000, 5000), tt_tre_d(1000)),
      util.mk_output(ca_addr, tt_ca_out_value(), tt_ca_d_idx(1000, 0, 7, index_at_start)),
    ],
  }
}

test grant_create_index_at_now_ok() {
  grant(0, grant_create_idx_tx(tt_a_now))
}

/// Lệch MỘT đơn vị xuống. Chọn một đơn vị chứ không phải một số lớn: mệnh đề là đẳng thức,
/// và một ca lệch xa vẫn đỏ kể cả khi mệnh đề bị nới thành bất đẳng thức.
test grant_create_index_below_now_rejected() fail {
  grant(0, grant_create_idx_tx(tt_a_now - 1))
}

test grant_create_index_above_now_rejected() fail {
  grant(0, grant_create_idx_tx(tt_a_now + 1))
}

/// Mốc bằng `index` của beacon (tức QUÊN số hạng `rate_root · (cửa sổ − epoch)`). Đây là
/// đúng hình dạng mà một hiện thực bỏ sót `epoch` sinh ra — `util.ak` ▸ `find_beacon` đã
/// ghi ra cái bẫy đó. Nó chỉ phân biệt được vì mẫu beacon có `epoch` KHÁC cửa sổ.
test grant_create_index_forgetting_epoch_term_rejected() fail {
  grant(0, grant_create_idx_tx(tt_bcn_index))
}

/// Giao dịch cấp phát KHÔNG mang beacon ở `reference_inputs`. v3 đổi HÌNH DẠNG TX, không
/// chỉ đổi tham số — ca này là thứ báo cho off-chain biết điều đó.
test grant_create_without_beacon_reference_rejected() fail {
  let tx =
    Transaction {
      ..grant_tx_at(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"], 7, tt_range(7)),
      reference_inputs: [],
    }
  grant(0, tx)
}

// ── C-ACC-DPE (v3): `drops_per_epoch` ở CREATE ghim == 1 ──────────────────────

fn grant_create_dpe_tx(dpe: Int) -> Transaction {
  let tre_addr = util.script_address(tt_tre_sh)
  let ca_addr = util.script_address(tt_ca_sh)
  Transaction {
    ..grant_tx_at(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"], 7, tt_range(7)),
    outputs: [
      util.mk_output(tre_addr, tt_lamp_val(5_000_000, 5000), tt_tre_d(1000)),
      util.mk_output(ca_addr, tt_ca_out_value(), tt_ca(1000, 0, 7, dpe)),
    ],
  }
}

/// Ba ca dưới CHỈ khác nhau ở `dpe`, cùng một giao dịch dựng từ cùng một hàm — nên
/// chúng phân biệt được đúng mệnh đề `== 1` chứ không phân biệt một khác biệt nào khác.
test grant_create_dpe_one_ok() {
  grant(0, grant_create_dpe_tx(1))
}

/// dpe = 2: lớn hơn 1 thì tốc độ mở khoá gấp đôi so với thứ Math-Spec đã tính.
test grant_create_dpe_above_one_rejected() fail {
  grant(0, grant_create_dpe_tx(2))
}

/// dpe = 0: tài khoản không bao giờ `Redeem` được, nợ đã vào sổ — bẫy một chiều.
test grant_create_dpe_zero_rejected() fail {
  grant(0, grant_create_dpe_tx(0))
}

/// Và đúc NFT cho VÍ KHÁC cũng không qua — tên phải là blake2b_256 của đúng owner ghi
/// trong datum tài khoản được cấp.
test grant_create_minting_nft_for_other_owner_rejected() fail {
  let tx =
    Transaction {
      ..grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"]),
      mint: assets.add(assets.zero, tt_acct_nft_policy, blake2b_256(#"beef"), 1),
    }
  grant(0, tx)
}

test grant_update_happy() {
  // UPDATE: E 1000→1600 (granted 600), cum 1000→1600 ≤ pool 5000.
  grant(1000, grant_tx(5000, 1000, 1600, Some(1000), 1600, 0, [#"c1", #"c2"]))
}

test grant_over_fund_rejected() fail {
  // C-SOLV-2: cấp E=6000 > pool 5000 → cum 0→6000 > pool → reject (over-grant vượt quỹ).
  grant(0, grant_tx(5000, 0, 6000, None, 6000, 0, [#"c1", #"c2"]))
}

test grant_over_fund_accumulated_rejected() fail {
  // C-SOLV-2: cum cũ 4500 + granted 1000 = 5500 > pool 5000 → reject (vượt quỹ tích lũy).
  grant(4500, grant_tx(5000, 4500, 5500, Some(4500), 5500, 0, [#"c1", #"c2"]))
}

test grant_at_fund_boundary_ok() {
  // biên: cum_out == pool 5000 → solvent (over-collateral biên), pass.
  grant(4000, grant_tx(5000, 4000, 5000, Some(4000), 5000, 0, [#"c1", #"c2"]))
}

test grant_cum_mismatch_rejected() fail {
  // C-SOLV-1: granted (ent 0→1000=1000) ≠ cum delta (0→900=900) → reject.
  grant(0, grant_tx(5000, 0, 900, None, 1000, 0, [#"c1", #"c2"]))
}

// ── C-GRANT-TOTAL: `GrantEntitlement` KHÔNG chạm `total_redeemed` ─────────────
// Mọi ca Grant ở trên mang `total_redeemed = 0` ở CẢ HAI phía (qua `tt_tre_d`), nên chúng
// xanh dù có chốt hay không. Ba ca dưới đặt vế vào KHÁC 0 và chỉ khác nhau ở vế ra.
// Cấp quyền không phát ra LAMP nào (C-VAL-0: value bất biến) ⟹ số đã phát phải đứng yên.

/// Grant CREATE trên một kho đã phát `tr_in`, ghi `tr_out` vào datum kho ra.
fn grant_tr(tr_in: Int, tr_out: Int) -> Bool {
  let base = grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"])
  let tre_addr = util.script_address(tt_tre_sh)
  let val = tt_lamp_val(5_000_000, 5000)
  let tre_in =
    util.mk_input(util.mk_ref(0), util.mk_output(tre_addr, val, tt_tre_d_tr(0, tr_in)))
  let tre_out = util.mk_output(tre_addr, val, tt_tre_d_tr(1000, tr_out))
  expect [_, ca_out] = base.outputs
  treasury.spend(
    tt_ca_sh, tt_lamp_policy, tt_lamp_name, tt_committee, tt_threshold,
    tt_acct_nft_policy,
    tt_mspe,
    tt_bcn_policy,
    Some(tt_tre_d_tr(0, tr_in)), GrantEntitlement, util.mk_ref(0),
    Transaction { ..base, inputs: [tre_in], outputs: [tre_out, ca_out] },
  )
}

test grant_keeps_total_redeemed_ok() {
  grant_tr(700, 700)
}

/// Thổi phồng mẫu số ⟹ trần cắt ngọn một lượt ở `claim_account` nới ra.
test grant_inflating_total_redeemed_rejected() fail {
  grant_tr(700, 701)
}

/// Kéo về 0 ⟹ trần rơi về `trim_floor`, siết mọi lượt rút về sau.
test grant_resetting_total_redeemed_rejected() fail {
  grant_tr(700, 0)
}

/// Ghi âm ⟹ mọi `Refill` về sau chết ở `carrier_ledger` (`total_redeemed >= 0`), kho không còn
/// đường gộp phần LAMP A-DEST hạ cánh.
test grant_negative_total_redeemed_rejected() fail {
  grant_tr(700, -1)
}

test grant_pool_drained_rejected() fail {
  // C-VAL-0: grant KHÔNG được rút LAMP pool. out pool 4000 ≠ in 5000 → reject.
  //
  // Ca này TỪNG đỏ mà không chạm C-VAL-0: tx dựng tay thiếu `mint` NFT tài khoản và
  // thiếu `validity_range`, nên nó chết ở cổng NFT của nhánh CREATE, mấy chục dòng
  // TRƯỚC chỗ mang tên nó. Đo bằng cách gỡ hẳn `expect tre_out.value == tre_in.value`:
  // trước khi thêm hai trường dưới đây, bộ kiểm vẫn XANH — tức không bài nào canh chốt
  // ấy, mà bài này thì đỏ đúng dòng và đúng tên. "Có bài đỏ ở chốt X" ≠ "chốt X được ghim".
  let tre_addr = util.script_address(tt_tre_sh)
  let ca_addr = util.script_address(tt_ca_sh)
  let tre_in = util.mk_input(util.mk_ref(0), util.mk_output(tre_addr, tt_lamp_val(5_000_000, 5000), tt_tre_d(0)))
  let tre_out = util.mk_output(tre_addr, tt_lamp_val(5_000_000, 4000), tt_tre_d(1000))
  let ca_out = util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(1000, 0))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tre_in],
      outputs: [tre_out, ca_out],
      extra_signatories: [#"c1", #"c2"],
      mint: assets.add(assets.zero, tt_acct_nft_policy, tt_acct_nft_name(), 1),
      validity_range: tt_range(tt_window),
    }
  grant(0, tx)
}

test grant_insufficient_committee_rejected() fail {
  // C-CLAIM-1: chỉ 1 sig < threshold 2 → reject (treasury gác CREATE path).
  grant(0, grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1"]))
}

test grant_create_nonzero_redeemed_rejected() fail {
  // CREATE: redeemed ≠ 0 trên account mới → double-count sai cumulative → reject.
  grant(0, grant_tx(5000, 0, 1000, None, 1000, 50, [#"c1", #"c2"]))
}

// ══════════════════════════════════════════════════════════════
// VÁ 2026-08-12 — điểm 1: C-MINT-1 (khe mint cho NFT tài khoản)
// ══════════════════════════════════════════════════════════════

const tt_trsy_policy: ByteArray = #"7235"

fn tt_acct_nft_name() -> ByteArray {
  blake2b_256(tt_owner)
}

/// Value của output tài khoản MỚI MỞ: min-ADA + NFT tài khoản. C-ACC-1b đòi NFT có mặt ở
/// đúng output này, nên mọi fixture CREATE phải dựng đúng hình dạng thật — bản trước chỉ
/// có min-ADA, tức mô tả một tài khoản không bao giờ tiêu được.
fn tt_ca_out_value() -> assets.Value {
  assets.from_lovelace(2_000_000)
    |> assets.add(tt_acct_nft_policy, tt_acct_nft_name(), 1)
}

/// grant_tx nhưng gắn thêm một `tx.mint` tuỳ ý (đường CREATE thật luôn có mint NFT).
fn grant_tx_minting(mint: assets.Value) -> Transaction {
  let base = grant_tx(5000, 0, 1000, None, 1000, 0, [#"c1", #"c2"])
  Transaction { ..base, mint: mint }
}

test grant_with_account_nft_mint_ok() {
  // (đối chứng dương của C-MINT-1) Đường TẠO tài khoản: tx đúc NFT tài khoản dưới ĐÚNG
  // `account_nft_policy`. C-MINT-0 cũ (`is_zero`) đã chặn thẳng ca này ⇒ cổng NFT tài
  // khoản sẽ không deploy được nếu không nới đúng khe này.
  grant(
    0,
    grant_tx_minting(assets.add(assets.zero, tt_acct_nft_policy, tt_acct_nft_name(), 1)),
  )
}

test grant_with_foreign_mint_rejected() fail {
  // (h) mint policy LẠ trong tx cấp entitlement → reject. Khe nới là DUY NHẤT cho
  // `account_nft_policy`, không phải "cho phép mint nói chung".
  grant(0, grant_tx_minting(assets.add(assets.zero, #"dead", #"beef", 1)))
}

test grant_with_lamp_mint_rejected() fail {
  // Cùng lớp với (h) nhưng đáng gọi tên riêng: LAMP cũng KHÔNG được đúc kèm — nếu lọt,
  // pool tự phình và C-SOLV-2 đo trên một con số bịa.
  grant(0, grant_tx_minting(assets.add(assets.zero, tt_lamp_policy, tt_lamp_name, 1_000_000)))
}

test grant_with_mixed_mint_rejected() fail {
  // NFT tài khoản hợp lệ + kèm một policy lạ → vẫn reject (tập policy ⊄ {account_nft}).
  let m =
    assets.zero
      |> assets.add(tt_acct_nft_policy, tt_acct_nft_name(), 1)
      |> assets.add(#"dead", #"beef", 1)
  grant(0, grant_tx_minting(m))
}

test release_with_mint_rejected() fail {
  // (i) ReleaseForRedeem GIỮ NGUYÊN C-MINT-0: tx trả nợ mà có mint → reject. Nhờ đó,
  // tx mở tài khoản (bắt buộc có mint) KHÔNG thể mượn nhánh này để thoả điều kiện
  // "có input TRSY" của `claim_account_nft` mà né đường ghi sổ.
  let base =
    release_tx(tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), 500, 400, 0, 100, [])
  let tx =
    Transaction {
      ..base,
      mint: assets.add(assets.zero, tt_acct_nft_policy, tt_acct_nft_name(), 1),
    }
  release(500, tx)
}

// ══════════════════════════════════════════════════════════════
// VÁ 2026-08-12 — điểm 2: REFILL (gộp + nạp thêm LAMP)
// ══════════════════════════════════════════════════════════════

/// Value của một UTxO kho: ADA + LAMP (+ NFT "TRSY" nếu là carrier canonical).
fn tt_val(lovelace: Int, lamp: Int, trsy: Bool) -> assets.Value {
  let v = tt_lamp_val(lovelace, lamp)
  if trsy {
    assets.add(v, tt_trsy_policy, util.treasury_nft_name(), 1)
  } else {
    v
  }
}

fn tre_in_d(ix: Int, lovelace: Int, lamp: Int, cum: Int, trsy: Bool) -> Input {
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output(util.script_address(tt_tre_sh), tt_val(lovelace, lamp, trsy), tt_tre_d(cum)),
  )
}

/// UTxO ở địa chỉ kho nhưng KHÔNG datum — đúng hình dạng LAMP rót về qua A-DEST.
fn tre_in_bare(ix: Int, lovelace: Int, lamp: Int) -> Input {
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output_no_datum(util.script_address(tt_tre_sh), tt_val(lovelace, lamp, False)),
  )
}

fn tre_out_d(lovelace: Int, lamp: Int, cum: Int, trsy: Bool) -> Output {
  util.mk_output(util.script_address(tt_tre_sh), tt_val(lovelace, lamp, trsy), tt_tre_d(cum))
}

/// Hai bản dưới chọn được `total_redeemed`, để các ca C-REF-TOTAL đặt hai vế KHÁC 0.
/// Mọi ca Refill cũ dùng `tt_tre_d(cum)`, tức `total_redeemed = 0` ở CẢ HAI phía — và một
/// ca mà hai cực của phép đột biến trả cùng kết quả thì nó không kiểm gì ở chốt ấy.
fn tre_in_d_tr(ix: Int, lovelace: Int, lamp: Int, cum: Int, red: Int, trsy: Bool) -> Input {
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output(
      util.script_address(tt_tre_sh),
      tt_val(lovelace, lamp, trsy),
      tt_tre_d_tr(cum, red),
    ),
  )
}

fn tre_out_d_tr(lovelace: Int, lamp: Int, cum: Int, red: Int, trsy: Bool) -> Output {
  util.mk_output(
    util.script_address(tt_tre_sh),
    tt_val(lovelace, lamp, trsy),
    tt_tre_d_tr(cum, red),
  )
}

fn refill_tx(ins: List<Input>, outs: List<Output>, sigs: List<ByteArray>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: ins,
    outputs: outs,
    extra_signatories: sigs,
    mint: assets.zero,
  }
}

/// Chạy Refill trên input số `own_ix`. `datum_opt` truyền đúng như ledger sẽ truyền.
fn refill(own_ix: Int, datum_opt: Option<TreasuryDatum>, tx: Transaction) -> Bool {
  treasury.spend(
    tt_ca_sh, tt_lamp_policy, tt_lamp_name, tt_committee, tt_threshold,
    tt_acct_nft_policy,
    tt_mspe,
    tt_bcn_policy,
    datum_opt, Refill, util.mk_ref(own_ix), tx,
  )
}

// ⚠ NGỮ NGHĨA ĐỔI 2026-09-26 (C-REF-PROV). Trước lượt này, Refill ép sổ ra = Σ sổ của MỌI
// input có datum, nên các ca dưới đây khai nợ ra 500 = 300 + 200. Nay sổ ra = sổ CỦA
// CARRIER (UTxO mang NFT "TRSY") và datum của mọi input khác bị BỎ QUA — nên con số đúng
// là 300, còn "200" của input thứ hai là một lời khai mà ai cũng viết được.

test refill_merge_two_and_deposit_ok() {
  // (j) Gộp 2 UTxO kho + nạp thêm 400 LAMP từ ví.
  //   vào: A(TRSY, 5 ADA, 1000 LAMP, nợ 300) + B(2 ADA, 500 LAMP, nợ khai 200 — BỎ QUA)
  //   ra : 1 UTxO (TRSY, 7 ADA, 1900 LAMP, nợ 300 = sổ của carrier)
  // Đây đồng thời là bài dương của C-REF-PROV: value của B vẫn được hút vào pool (đó là
  // lý do Refill tồn tại), chỉ SỔ của B là không đi vào mệnh đề nào.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1900, 300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_merge_two_second_input_same_verdict() {
  // Đối chứng double-satisfaction: CÙNG tx trên, chạy cho input THỨ HAI → cùng kết luận.
  // (Mọi mệnh đề của Refill là mệnh đề toàn-tx nên hai lần chạy không thể lệch nhau.
  // C-REF-PROV giữ tính chất đó: nó lọc theo VALUE của input, không theo `own_ref`.)
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1900, 300, True)
  refill(1, Some(tt_tre_d(200)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

// ── C-REF-PROV: hai ca TRUNG TÂM, đúng hình dạng khai thác đã dựng PoC ────────
// Cả hai dùng CHUNG một tx với ca dương ngay trên, khác đúng một con số: sổ mà UTxO tự đỗ
// KHAI, và con số tương ứng ở datum ra. Dưới luật CŨ cả hai ĐƯỢC CHẤP NHẬN.

/// A2 — `total_redeemed` KHỐNG qua Refill. UTxO tự đỗ khai đã-phát-ra 10^24; luật cũ cộng
/// nó vào sổ thật ⇒ MẪU SỐ của phép cắt ngọn (`claim_account` ▸ C-RDM-TRIM) nhảy lên 10^24
/// cho TOÀN hệ. Trường này CHỈ TĂNG nên không nhánh nào kéo về được: cắt ngọn chết vĩnh
/// viễn sau đúng một giao dịch. C-REF-SIGN không bắt — 10^24 là số dương.
test refill_parked_utxo_inflating_total_redeemed_rejected() fail {
  let a = tre_in_d_tr(0, 5_000_000, 1000, 300, 7000, True)
  let parked = tre_in_d_tr(1, 2_000_000, 500, 0, 1_000_000_000_000_000_000_000_000, False)
  let o = tre_out_d_tr(7_000_000, 1900, 300, 1_000_000_000_000_000_007_000, True)
  refill(0, Some(tt_tre_d_tr(300, 7000)), refill_tx([a, parked], [o], [#"c1", #"c2"]))
}

/// A3 — `outstanding_entitlement` DƯƠNG KHỐNG qua Refill. Số chọn ở mức 1000 CỐ Ý: sổ ra
/// 1300 vẫn ≤ pool ra 1900, nên vế `<= lamp_out` (C-SOLV-2 mở rộng) KHÔNG bắt được — nó là
/// cận TRÊN. Hậu quả: mọi `GrantEntitlement` về sau đo trên một sổ nợ phồng, và sổ nợ chỉ
/// giảm qua `ReleaseForRedeem` — vốn cần một tài khoản THẬT rút tiền — nên phần phồng
/// không có đường lùi.
test refill_parked_utxo_inflating_outstanding_rejected() fail {
  let a = tre_in_d_tr(0, 5_000_000, 1000, 300, 7000, True)
  let parked = tre_in_d_tr(1, 2_000_000, 500, 1000, 0, False)
  let o = tre_out_d_tr(7_000_000, 1900, 1300, 7000, True)
  refill(0, Some(tt_tre_d_tr(300, 7000)), refill_tx([a, parked], [o], [#"c1", #"c2"]))
}

/// Đối chứng DƯƠNG của đúng hai ca trên: cùng tập input (UTxO tự đỗ khai cả hai trường
/// khác 0), datum ra mang ĐÚNG sổ của carrier ⇒ QUA. Không có ca này thì hai ca đỏ ở trên
/// xanh được bằng cách làm hỏng bất cứ thứ gì khác trong fixture.
test refill_parked_utxo_ledger_ignored_ok() {
  let a = tre_in_d_tr(0, 5_000_000, 1000, 300, 7000, True)
  let parked = tre_in_d_tr(1, 2_000_000, 500, 1000, 3000, False)
  let o = tre_out_d_tr(7_000_000, 1900, 300, 7000, True)
  refill(0, Some(tt_tre_d_tr(300, 7000)), refill_tx([a, parked], [o], [#"c1", #"c2"]))
}

/// Luật CŨ viết thành một bài âm: sổ ra = TỔNG (300+1000, 7000+3000). Đây là ca phân biệt
/// giữa hai ngữ nghĩa — nó XANH trước bản vá và ĐỎ sau.
test refill_summing_parked_ledger_rejected() fail {
  let a = tre_in_d_tr(0, 5_000_000, 1000, 300, 7000, True)
  let parked = tre_in_d_tr(1, 2_000_000, 500, 1000, 3000, False)
  let o = tre_out_d_tr(7_000_000, 1900, 1300, 10000, True)
  refill(0, Some(tt_tre_d_tr(300, 7000)), refill_tx([a, parked], [o], [#"c1", #"c2"]))
}

/// Không có carrier trong tập input mà vẫn dựng được một UTxO ở địa chỉ kho mang sổ tuỳ ý
/// — tức SINH RA một cái kho giả trông y hệt kho thật với mọi công cụ đọc theo địa chỉ.
/// `expect [carrier]` ở nhánh 0 phần tử chặn. (Ca 2 carrier ở ngay dưới, mục riêng.)
test refill_without_carrier_rejected() fail {
  let p1 = tre_in_d_tr(0, 5_000_000, 1000, 300, 7000, False)
  let p2 = tre_in_d_tr(1, 2_000_000, 500, 200, 3000, False)
  let o = tre_out_d_tr(7_000_000, 1500, 300, 7000, False)
  refill(0, Some(tt_tre_d_tr(300, 7000)), refill_tx([p1, p2], [o], [#"c1", #"c2"]))
}

/// Hai UTxO cùng mang một tài sản tên "TRSY" ⇒ nhập nhằng ⇒ từ chối. One-shot policy nói
/// trạng thái này không tồn tại với policy THẬT; nó dựng được bằng một policy khác trùng
/// tên, và khi đó fail-closed là câu trả lời đúng (xem giới hạn ghi ở `carrier_ledger`).
test refill_two_carriers_rejected() fail {
  let a = tre_in_d_tr(0, 5_000_000, 1000, 300, 7000, True)
  let b = tre_in_d_tr(1, 2_000_000, 500, 200, 3000, True)
  // Output mang CẢ HAI đơn vị "TRSY" ⇒ bảo toàn value vẫn đúng ⇒ ca này đỏ ở
  // `expect [carrier]` chứ không đỏ ké ở mệnh đề value.
  let o =
    util.mk_output(
      util.script_address(tt_tre_sh),
      assets.add(tt_val(7_000_000, 1500, True), tt_trsy_policy, util.treasury_nft_name(), 1),
      tt_tre_d_tr(300, 7000),
    )
  refill(0, Some(tt_tre_d_tr(300, 7000)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_absorb_no_datum_utxo_ok() {
  // (k) Hút một UTxO KHÔNG datum (LAMP rót về kho qua A-DEST) vào carrier canonical.
  //   vào: A(TRSY, 5 ADA, 1000 LAMP, nợ 300) + bare(2 ADA, 700 LAMP, KHÔNG datum)
  //   ra : 1 UTxO (TRSY, 7 ADA, 1700 LAMP, nợ 300 — sổ cái của bare bị bỏ qua)
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let bare = tre_in_bare(1, 2_000_000, 700)
  let o = tre_out_d(7_000_000, 1700, 300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, bare], [o], [#"c1", #"c2"]))
}

test refill_run_on_no_datum_input_ok() {
  // Chính input KHÔNG datum là input đang chạy (`datum_opt == None`). Trước bản vá,
  // `expect Some(datum) = datum_opt` nằm NGOÀI `when` nên ca này crash ngay dòng đầu.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let bare = tre_in_bare(1, 2_000_000, 700)
  let o = tre_out_d(7_000_000, 1700, 300, True)
  refill(1, None, refill_tx([a, bare], [o], [#"c1", #"c2"]))
}

// ⚠ Ba ca value dưới đây mang sổ ra = 300 (sổ của carrier), KHÔNG phải 500. Để 500 thì
// chúng đỏ ở C-REF-PROV trước khi chạm tới mệnh đề value — tức chúng sẽ đúng màu, đúng
// tên, và không canh cái chúng mang tên.

test refill_ada_skim_rejected() fail {
  // (l) Rút bớt ADA (7 → 6) trong lúc gộp → reject. Mọi asset ≠ LAMP bảo toàn tuyệt đối.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(6_000_000, 1500, 300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_lamp_decrease_rejected() fail {
  // (m) LAMP ra 1400 < tổng vào 1500 → `deposited < 0` → reject. Refill KHÔNG phải cửa rút.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1400, 300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_trsy_stolen_rejected() fail {
  // Cùng họ với (l): bỏ NFT "TRSY" khỏi output (đem ra ví) → value ra ≠ Σ vào → reject.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1500, 300, False)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_ledger_mismatch_rejected() fail {
  // (n) Sổ cái ra 400 ≠ sổ carrier 300 → reject. Gộp không được BỊA thêm nợ.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1500, 400, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

/// Chiều ngược của ca trên: gộp XOÁ bớt nợ (300 → 200). Hai chiều cần hai ca — một mệnh
/// đề đẳng thức chỉ được ghim khi cả hai cực đều có bài.
test refill_ledger_shrunk_rejected() fail {
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1500, 200, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

/// C-SOLV-2 MỞ RỘNG (`nợ ra ≤ pool ra`) — bài ghim RIÊNG. Sau C-REF-PROV, mệnh đề này
/// không còn ca nào chạm tới qua đường "UTxO tự đỗ khai nợ khống" (sổ ra nay bằng sổ
/// carrier), nên nó cần một carrier mà chính sổ của nó đã vượt pool. Trạng thái ấy không
/// dựng được trên chuỗi — đó chính là lý do phải dựng nó ở đây, nếu không dòng `expect`
/// ấy gỡ ra mà không bài nào kêu.
test refill_carrier_debt_above_pool_rejected() fail {
  let a = tre_in_d(0, 5_000_000, 1000, 2000, True)
  let o = tre_out_d(5_000_000, 1000, 2000, True)
  refill(0, Some(tt_tre_d(2000)), refill_tx([a], [o], [#"c1", #"c2"]))
}

// ── C-REF-TOTAL (v3): `total_redeemed` gộp ĐÚNG TỔNG, không trôi ──────────────
// Bốn ca dưới dùng `tre_in_d_tr`/`tre_out_d_tr` để hai vế KHÁC 0 — các ca Refill phía
// trên đều mang `total_redeemed = 0` cả hai phía, nên chúng xanh dù có chốt hay không.
// Cả HAI chiều lệch đều được cho một ca: chiều NÂNG phồng trần một lượt cho toàn hệ,
// chiều HẠ dựng lại điểm hấp thụ mà sàn cắt ngọn có mặt để phá. Chiều hạ là chiều dễ
// bị bỏ quên vì nó trông như "thận trọng".

test refill_total_redeemed_from_carrier_ok() {
  // Gộp 2 UTxO kho: carrier khai đã-rút 7000, UTxO tự đỗ khai 3000 (BỎ QUA) ⇒ ra mang 7000.
  // ⚠ Bản trước của ca này kỳ vọng 10000 (phép TỔNG). Đổi vì ngữ nghĩa đổi, không vì bài
  // hỏng — xem C-REF-PROV ở `carrier_ledger`.
  let a = tre_in_d_tr(0, 5_000_000, 1000, 300, 7000, True)
  let b = tre_in_d_tr(1, 2_000_000, 500, 200, 3000, False)
  let o = tre_out_d_tr(7_000_000, 1900, 300, 7000, True)
  refill(0, Some(tt_tre_d_tr(300, 7000)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_total_redeemed_inflated_rejected() fail {
  // Đặt 99000 thay vì 7000 — không bất biến nào khác của kho gãy (nợ vẫn đúng, value vẫn
  // đúng), nhưng trần một lượt của MỌI tài khoản phồng lên hơn mười lần.
  let a = tre_in_d_tr(0, 5_000_000, 1000, 300, 7000, True)
  let b = tre_in_d_tr(1, 2_000_000, 500, 200, 3000, False)
  let o = tre_out_d_tr(7_000_000, 1900, 300, 99000, True)
  refill(0, Some(tt_tre_d_tr(300, 7000)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_total_redeemed_reset_to_zero_rejected() fail {
  // Xoá lịch sử rút về 0 ⇒ trần rơi về `trim_floor` cho toàn hệ.
  let a = tre_in_d_tr(0, 5_000_000, 1000, 300, 7000, True)
  let b = tre_in_d_tr(1, 2_000_000, 500, 200, 3000, False)
  let o = tre_out_d_tr(7_000_000, 1900, 300, 0, True)
  refill(0, Some(tt_tre_d_tr(300, 7000)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

// ── C-REF-SIGN: cận DƯỚI cho sổ cái đi vào phép gộp ──────────────────────────
// ⚠ ĐỔI ĐÍCH 2026-09-26. Bốn ca này trước đây đặt số ÂM ở INPUT THỨ HAI, vì luật cũ cộng
// sổ của mọi input có datum nên input tự đỗ là đúng lối vào. Sau C-REF-PROV lối ấy đã
// đóng (sổ của input tự đỗ không đi vào mệnh đề nào), nên để nguyên thì bốn ca vẫn đỏ mà
// đỏ ở C-REF-PROV, KHÔNG ở C-REF-SIGN — đúng màu, đúng tên, canh nhầm chỗ. Nay số âm đặt
// ở CHÍNH CARRIER.
//
// Trạng thái ấy không dựng được trên chuỗi (mọi nhánh ghi vào carrier đều ép hai trường
// không âm), và đó chính là lý do phải dựng nó ở đây: C-REF-SIGN nay là lớp phòng thủ
// theo chiều sâu, và một lớp không có bài canh là một lớp gỡ đi mà không ai kêu.
//
// Vì sao bốn ca chứ không hai: mỗi trường cần CẢ ca âm bị từ chối LẪN ca 0 được qua. Không
// có ca 0 thì một bản vá gõ nhầm thành `> 0` cũng xanh hệt như bản đúng — mà `> 0` giết
// luôn kho rỗng hợp lệ (genesis mở sổ ở 0) và chỉ lộ ra trên mạng thật.
//
// Hai ca âm KHÔNG thay thế được nhau: `outstanding_entitlement` âm đánh vào trần
// `nợ ≤ pool` ở `GrantEntitlement`; `total_redeemed` âm đánh vào mẫu số của trần cắt ngọn.
// Gỡ một trong hai dòng `expect` thì đúng một ca đỏ — đó là cách đọc được ca nào canh dòng nào.

test refill_outstanding_negative_rejected() fail {
  // Carrier khai nợ −500 ⇒ nợ bị khai THẤP HƠN thật ⇒ trần `nợ ≤ pool` ở
  // `GrantEntitlement` nới ra vĩnh viễn. Vế `<= lamp_out` KHÔNG bắt: −500 ≤ 1900.
  let a = tre_in_d_tr(0, 5_000_000, 1000, -500, 7000, True)
  let b = tre_in_d_tr(1, 2_000_000, 500, 200, 3000, False)
  let o = tre_out_d_tr(7_000_000, 1900, -500, 7000, True)
  refill(0, Some(tt_tre_d_tr(-500, 7000)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_total_redeemed_negative_rejected() fail {
  // Đối xứng ở vế trần cắt ngọn: mẫu số âm ⇒ trần một lượt rơi về `trim_floor` cho MỌI
  // tài khoản.
  let a = tre_in_d_tr(0, 5_000_000, 1000, 300, -3000, True)
  let b = tre_in_d_tr(1, 2_000_000, 500, 200, 3000, False)
  let o = tre_out_d_tr(7_000_000, 1900, 300, -3000, True)
  refill(0, Some(tt_tre_d_tr(300, -3000)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_outstanding_zero_ok() {
  // Cực còn lại: 0 phải ĐI QUA. Kho rỗng là trạng thái hợp lệ (genesis mở sổ ở 0), nên
  // một bản vá gõ `> 0` thay vì `>= 0` sẽ giết vận hành thật — ca này là thứ duy nhất
  // phân biệt được hai bản vá đó.
  let a = tre_in_d_tr(0, 5_000_000, 1000, 0, 7000, True)
  let b = tre_in_d_tr(1, 2_000_000, 500, 0, 3000, False)
  let o = tre_out_d_tr(7_000_000, 1900, 0, 7000, True)
  refill(0, Some(tt_tre_d_tr(0, 7000)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_total_redeemed_zero_ok() {
  // Đối xứng cho trường thứ hai: kho chưa ai rút đồng nào cũng phải gộp được.
  let a = tre_in_d_tr(0, 5_000_000, 1000, 300, 0, True)
  let b = tre_in_d_tr(1, 2_000_000, 500, 200, 0, False)
  let o = tre_out_d_tr(7_000_000, 1900, 300, 0, True)
  refill(0, Some(tt_tre_d_tr(300, 0)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_insufficient_committee_rejected() fail {
  // (o) 1 chữ ký < ngưỡng 2 → reject. Refill permissionless = mời kẻ phá quấy chiếm
  // UTxO singleton của kho liên tục.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1900, 300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1"]))
}

test refill_two_script_outputs_rejected() fail {
  // (p) Ra 2 output ở script → reject. Gộp phải TRẢ VỀ singleton, nếu không sổ cái
  // (biến toàn cục serial-hoá mọi Claim/Redeem) bị chia đôi.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o1 = tre_out_d(5_000_000, 1000, 300, True)
  let o2 = tre_out_d(2_000_000, 900, 200, False)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o1, o2], [#"c1", #"c2"]))
}

test refill_committee_hash_mismatch_rejected() fail {
  // ⚠ ĐỔI ĐÍCH 2026-09-26. Bản trước đặt `committee_hash` lạ ở INPUT THỨ HAI, vì luật cũ
  // bắt mọi input có datum khai cùng một giá trị. Nay `committee_hash` neo vào CARRIER,
  // nên ca phân biệt là: output tự đặt một `committee_hash` khác của carrier. Đó cũng là
  // hình dạng hại thật — "bỏ phiếu" đổi chủ sở hữu sổ cái trong một lượt gộp.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o =
    util.mk_output(
      util.script_address(tt_tre_sh),
      tt_val(7_000_000, 1500, True),
      TreasuryDatum {
        committee_hash: #"dddd",
        outstanding_entitlement: 300,
        total_redeemed: 0,
      },
    )
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o], [#"c1", #"c2"]))
}

test refill_no_datum_input_at_all_rejected() fail {
  // Chỉ toàn input KHÔNG datum (và không có carrier) → không sổ nào có gốc tích → reject.
  // Trước C-REF-PROV ca này đỏ ở `expect Some(ch)`; nay đỏ ở `expect [carrier]`, và lý do
  // mạnh hơn: nếu qua thì Refill SINH RA một UTxO ở địa chỉ kho mang sổ tuỳ ý.
  let b1 = tre_in_bare(0, 5_000_000, 1000)
  let b2 = tre_in_bare(1, 2_000_000, 500)
  let o = tre_out_d(7_000_000, 1500, 0, False)
  refill(0, None, refill_tx([b1, b2], [o], [#"c1", #"c2"]))
}

test refill_fake_debt_injection_rejected() fail {
  // ĐƯỜNG PHÁ ghi từ 2026-08-12: ai cũng đỗ được một UTxO ở địa chỉ kho mang
  // `TreasuryDatum` KHAI NỢ KHỐNG. Một tx { Refill(kho + UTxO khống N), Claim(N) } cấp
  // entitlement N mà KHÔNG đi qua `GrantEntitlement`, tức né cửa `nợ ≤ pool`.
  // Nay HAI lớp chặn độc lập: C-REF-PROV (sổ ra phải == sổ carrier = 300) và C-SOLV-2 mở
  // rộng (1_000_300 > pool 1500). Lớp thứ nhất là lớp đóng được lối vào ở MỌI thang số;
  // lớp thứ hai chỉ đóng được thang vượt pool — xem `refill_parked_utxo_inflating_
  // outstanding_rejected` cho ca mà một mình C-SOLV-2 KHÔNG bắt.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let fake = tre_in_d(1, 2_000_000, 500, 1_000_000, False)
  let o = tre_out_d(7_000_000, 1500, 1_000_300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, fake], [o], [#"c1", #"c2"]))
}

test refill_single_utxo_noop_ok() {
  // N = 1: gộp một mình (tự chuẩn hoá kho, nạp thêm 500 LAMP). Vẫn phải PASS — nếu không,
  // đường nạp LAMP vào carrier canonical mà không có UTxO rời sẽ chết.
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let o = tre_out_d(5_000_000, 1500, 300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a], [o], [#"c1", #"c2"]))
}

// ── C-REF-ACC (2026-09-17): Refill không chạm tài khoản ──────────────────────
// Hai ca dưới là đúng ca đối chứng `refill_merge_two_and_deposit_ok` cộng thêm MỘT UTxO ở
// địa chỉ tài khoản. Mọi mệnh đề khác của Refill chỉ đếm/tính trên địa chỉ kho, nên gỡ
// C-REF-ACC thì cả hai ca QUA. Mỗi ca chạm ĐÚNG MỘT chiều (input hoặc output) để mỗi phép
// đếm có bài canh riêng — ca chạm cả hai chiều thì phép đếm kia chặn hộ và che mất phép này.

fn tt_ca_utxo() -> Output {
  util.mk_output(util.script_address(tt_ca_sh), assets.from_lovelace(2_000_000), tt_ca_d(1000, 0))
}

test refill_spending_claim_account_rejected() fail {
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let ca = util.mk_input(util.mk_ref(2), tt_ca_utxo())
  let o = tre_out_d(7_000_000, 1900, 300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b, ca], [o], [#"c1", #"c2"]))
}

test refill_creating_claim_account_output_rejected() fail {
  let a = tre_in_d(0, 5_000_000, 1000, 300, True)
  let b = tre_in_d(1, 2_000_000, 500, 200, False)
  let o = tre_out_d(7_000_000, 1900, 300, True)
  refill(0, Some(tt_tre_d(300)), refill_tx([a, b], [o, tt_ca_utxo()], [#"c1", #"c2"]))
}
