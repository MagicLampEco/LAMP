// ┌──────────────────────────────────────────────────────────────────────────────┐
// │ ⚠ TỆP NÀY KHÔNG PHẢI THỨ ĐANG CHẠY TRÊN MAINNET. ĐỪNG ĐỌC NÓ ĐỂ SUY RA MAINNET.│
// └──────────────────────────────────────────────────────────────────────────────┘
//
// Policy LAMP mainnet đúc từ `457f312`, KHÁC bản dưới đây ở ba chỗ ĐỔI HÀNH VI —
// không phải khác cách viết. Ai đọc bản này rồi dựng lời gọi cho mainnet sẽ ra một
// policy-id khác (tham số nằm TRONG policy-id), tức một token khác, một kho khác.
//
//   1. SỐ THAM SỐ: bản dưới 14 (xem chữ ký `validator lamp_mint(` — trích theo TÊN, không
//      theo số dòng, vì số dòng trôi mà con trỏ vẫn trỏ vào một dòng CÓ THẬT), mainnet 8
//      (`git show 457f312:Genesis/onchain/validators/lamp_mint.ak` dòng 53-61).
//      Vị trí `meter_nft_policy` KHÁC NHAU: ở đây là tham số #11, mainnet là #7.
//      Truyền theo thứ tự bản này vào script mainnet = lệch mọi tham số từ #4 trở đi.
//      Hai khe #13-14 (`reserve_kho_nft_policy`/`reserve_kho_nft_name`) KHÔNG tồn tại ở
//      mainnet — chúng là phần vá đường Reserve, thêm sau khi policy mainnet đã đúc.
//
//   2. CAP: bản dưới nhận `dist_cap`/`reserve_cap` làm THAM SỐ (dòng 100-101). Mainnet
//      không có hai tham số đó — cap là HẰNG biên dịch, kiểm bằng
//      `expect s.dist_cap == constants.dist_cap_oil` (457f312:lamp_mint.ak:93-94).
//      Nghĩa là mainnet KHÔNG đổi cap được bằng cách truyền tham số khác.
//
//   3. WHO-GATE: bản dưới gác quyền qua Registry NFT đọc on-chain
//      (`registry_nft_policy`/`registry_nft_name`, dòng 102-103). Mainnet gác bằng DANH
//      SÁCH pkh NƯỚNG SẴN + ngưỡng chữ ký (`dist_authority: List<ByteArray>`,
//      `auth_threshold` — 457f312:lamp_mint.ak:57-58); `Genesis/offchain/src/deployed.ts:71-76`
//      ghi `mintAuthority.kind: "baked-pkh-list"`. Sửa danh sách người ký = đúc lại
//      policy khác, không có đường cập nhật.
//
// NGUỒN SỰ THẬT CHO MAINNET: `Genesis/offchain/src/deployed.ts` — policyId (:63),
// `mintParamCount: 8` (:65), giá trị từng tham số đã dùng, `byteMatch: true` đối chiếu
// với `sourceCommit: "457f312"` (:99-100). Cần dựng tx chạm policy mainnet thì đọc tệp
// đó, KHÔNG đọc tệp này.
//
// LƯU Ý ĐÃ THÀNH SỰ THẬT: tham số `meter_nft_policy` của mainnet là 28 byte 0
// (deployed.ts:92) — không có tiền ảnh ⇒ nhánh ReserveDraw không bao giờ thoả ⇒ 9,63 tỷ
// LAMP Reserve không rút được qua policy đó (deployed.ts:118-119). Bản dưới đây KHÔNG
// khắc phục điều đó cho policy đã đúc; apply-param không sửa được sau khi gửi.
//
// ─────────────────────────────────────────────────────────────────────────────
//
// lamp_mint — minting policy LAZY-MINT token LAMP, gated bởi SupplyState (CONTRACT §5).
//
// FIRST-PRINCIPLES — fixed-supply không cần mint sẵn:
//   "Fixed-supply" KHÔNG đòi 36 tỷ token nằm sẵn on-chain. Nó đòi TỔNG phát hành
//   lịch sử ≤ CAP. Một bộ đếm đơn điệu (SupplyState) chặn tại CAP thỏa mạnh hơn:
//   token chưa mint = không tồn tại = không bị tấn công, không khóa min-ADA.
//
//   Mọi tx mint LAMP PHẢI consume + recreate SupplyState (nhận diện qua thread NFT
//   one-shot DUY NHẤT). Δ = lượng mint trong tx; transition datum ép Δ vào ĐÚNG
//   quota (Distribution HOẶC Reserve) theo redeemer, ≤ cap, đơn điệu, KHÔNG burn.
//
// ASSET NAME LAMP = PARAM (token_name), KHÔNG hằng:
//   token_name truyền lúc apply-param khi deploy → testnet truyền "tLAMP"
//   (#"744c414d50"), mainnet truyền "LAMP" (#"4c414d50"). Cùng 1 code deploy được cả
//   2 network mà KHÔNG mint nhầm nhãn. Token = PolicyID + AssetName → token_name là
//   param ⇒ policyId KHÁC nhau giữa tLAMP và LAMP (đúng: 2 token độc lập). AssetName
//   chỉ là NHÃN; tính DUY NHẤT của token nằm ở PolicyID (neo bởi genesis_ref one-shot
//   của thread_nft, tuyến tính apply-param). Đổi token_name ⇒ đổi policyId ⇒ token mới.
//
// Param (14): thread_nft_policy + thread_nft_name (tầng 1) + token_name (asset name LAMP) +
// dist_cap + reserve_cap (PARAM apply-time — framework dùng-chung; LAMP 26,37+9,63 tỷ oildrop,
// FARM 12 tỷ, … bake vào policy-id ⇒ cap cố định bất biến từng token) +
// registry_nft_policy/name + token_tag (WHO-gate: đọc bảng registry, authority theo tag) +
// kho_nft_policy/name (A-DEST đường Distribution) + meter_nft_policy/name (định danh meter
// NFT = reserve_thread NFT, Reserve) + reserve_kho_nft_policy/name (A-DEST đường Reserve).
// KHÔNG tham chiếu ngược tầng 3 (không vòng lặp apply-param).
//
// ── HAI CẶP KHO, KHÔNG PHẢI MỘT (chốt khi vá lỗ Δ-chết) ─────────────────────
// `kho_nft` và `reserve_kho_nft` trỏ vào HAI kho KHÁC NHAU, không phải hai tên của một thứ:
//
//   • `kho_nft_*` (#9-10) → kho DISTRIBUTION (`Distribution/onchain/validators/treasury.ak`).
//     Kho đó có sổ riêng `outstanding_entitlement` và ba redeemer ReleaseForRedeem /
//     GrantEntitlement / Refill phục vụ đường claim + redeem của người nắm token.
//     Dùng cho nhánh `DistributionVest`.
//
//   • `reserve_kho_nft_*` (#13-14) → Treasury CUSTODY (`Treasury/onchain/validators/custody.ak`),
//     cặp giá trị = (`seed_policy`, `instance_id`) của instance custody đích. Đó là nơi giữ SỔ
//     KẾ TOÁN mà `Treasury/CONTRACT.md §5` nói tới ("giảm lưu hành = chuyển vào Treasury").
//     Dùng cho nhánh `ReserveDraw`.
//
// VÌ SAO KHÔNG DÙNG CHUNG MỘT CẶP: dùng chung sẽ dời đích của `DistributionVest` sang Treasury
// custody, tức 26,37 tỷ LAMP chỉ còn chi được qua `Release` gác bằng proposal — phá đường
// claim/redeem của Distribution. Hai đường có hai đích thật sự khác nhau nên phải hai cặp.
//
// ⚠ BẤT BIẾN DEPLOY: `reserve_kho_nft_name` = `instance_id` của MỘT instance custody, nướng
// vào policy-id ⇒ đường Reserve khoá vĩnh viễn vào đúng instance đó. Chọn sai lúc deploy
// không sửa được bằng cách truyền tham số khác — phải đúc policy mới.
//
// GATE NHẢ RESERVE = HÀM, KHÔNG CHỮ KÝ (permissionless thật). Nhánh ReserveDraw KHÔNG
// đòi pubkey-sig: nó ÉP tx phải spend đúng 1 UTxO mang meter NFT (= reserve_thread NFT)
// VÀ spend đúng 1 UTxO mang kho NFT, với ĐỘ TĂNG RÒNG của kho ≥ δ (A-DEST, soi gương
// DistributionVest). Kho bị spend ⇒ validator kho chạy ⇒ Δ vào SỔ, không chỉ vào địa chỉ.
// Gate nhịp = reserve_draw (Reserve module) ép δ ≤ E/1000 (trần CỨNG mỗi epoch) + pot còn
// lại + Treasury-pull. KHÔNG có validator "reserve_meter" riêng — đó là tên khái niệm gate
// nhịp, hiện thực bởi reserve_draw + reserve_thread. ⟹ MỌI ReserveDraw BẮT BUỘC đi qua
// reserve_draw; không ai (kể cả keyholder cũ) rút tay được. meter_nft (= reserve_thread) là
// one-shot độc lập (mint trước khi apply-param lamp_mint) → KHÔNG vòng phụ thuộc apply-param.
//
// NEO ĐỊNH DANH SupplyState = qua SUPPLY NFT one-shot (KHÔNG qua script-hash). Thread NFT
// được mint đúng MỘT lần (thread_nft one-shot, param genesis_ref) → tồn tại DUY NHẤT 1 bản
// trên chain → "UTxO mang đúng 1 SUPPLY NFT" ⟺ "SupplyState chính danh". Không cần ghim
// payment_credential == Script(supply_state_hash): ghim đó tạo VÒNG (supply_state_hash phụ
// thuộc lamp_policy phụ thuộc lại supply_state_hash) — không apply-param được khi deploy.
//
// LƯU Ý: validator này KHÔNG tự đọc supply_state spend (nó là MINT policy). Nó tìm
// SupplyState input/output qua SUPPLY NFT. supply_state.ak (tầng 3) chỉ ép "có mint
// LAMP" rồi ủy quyền toàn bộ transition cho ĐÂY → một nguồn sự thật cho cap.

use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Input, Output, Transaction, placeholder}
use magiclamp/genesis/constants
use magiclamp/genesis/registry
use magiclamp/genesis/registry.{
  Authority, MultiSig, RegistryDatum, RegistryEntry, Revoked, SinglePkh,
}
use magiclamp/genesis/types.{
  DistributionVest, ReserveDraw, SupplyState, TLampMintRedeemer,
}
use magiclamp/genesis/util

validator lamp_mint(
  thread_nft_policy   : PolicyId,
  thread_nft_name     : ByteArray,
  token_name          : ByteArray,
  dist_cap            : Int,
  reserve_cap         : Int,
  registry_nft_policy : PolicyId,
  registry_nft_name   : ByteArray,
  token_tag           : ByteArray,
  kho_nft_policy      : PolicyId,
  kho_nft_name        : ByteArray,
  meter_nft_policy    : PolicyId,
  meter_nft_name      : ByteArray,
  // #13-#14 — THÊM SAU CÙNG, CÓ CHỦ Ý. Đặt ở cuối để 12 khe đang có không xê dịch:
  // truyền sai thứ tự tham số KHÔNG báo lỗi, nó ra một policy-id khác một cách im lặng.
  reserve_kho_nft_policy : PolicyId,
  reserve_kho_nft_name   : ByteArray,
) {
  mint(r: TLampMintRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── Luật 1: consume + recreate SupplyState (thread NFT) ───────────────
    // Đúng 1 input mang thread NFT, đúng 1 output mang lại NFT đó. Thread NFT
    // KHÔNG được mint/burn trong tx này (qty trong tx.mint của thread policy == 0).
    // → chống mint lậu (A2), SupplyState giả/đôi (A3/A7), mất NFT.
    expect util.count_inputs_holding_nft(tx.inputs, thread_nft_policy, thread_nft_name) == 1
    expect util.count_holding_nft(tx.outputs, thread_nft_policy, thread_nft_name) == 1
    expect assets.quantity_of(tx.mint, thread_nft_policy, thread_nft_name) == 0

    let s_in: Output = util.input_holding_nft(tx.inputs, thread_nft_policy, thread_nft_name)
    let s_out: Output = util.output_holding_nft(tx.outputs, thread_nft_policy, thread_nft_name)

    // ── D8-#1 (neo NFT, không ghim hash): định danh SupplyState bằng SUPPLY NFT ──
    // KHÔNG ghim payment_credential == Script(supply_state_hash) — ghim đó tạo VÒNG
    // (supply_state_hash phụ thuộc lamp_policy phụ thuộc lại nó). Thay vào: SUPPLY NFT
    // là one-shot DUY NHẤT (thread_nft param genesis_ref) → "mang đúng 1 SUPPLY NFT"
    // ⟺ SupplyState chính danh. Kẻ tấn công KHÔNG đúc nổi NFT thứ 2 để dựng SupplyState
    // giả. Cap-phình ở UTxO giả vô dụng: D7-#1 dưới ép cap == hằng genesis (sai cap →
    // không mint được), nên không cần ghim địa chỉ.
    //
    // SupplyState output PHẢI ở lại CÙNG địa chỉ input (thread không rời chỗ) — so trực
    // tiếp input↔output, KHÔNG cần param, KHÔNG vòng.
    expect s_out.address == s_in.address

    expect s: SupplyState = util.inline_datum(s_in)
    expect s2: SupplyState = util.inline_datum(s_out)

    // ── D7-#1: NEO CAP vào PARAM apply-time (chống cap phình → mint vượt cap) ─
    // Cap không chỉ "bất biến qua transition" (luật 4) mà phải ĐÚNG cap bake vào
    // policy. Nếu UTxO vào mang cap bịa (lớn hơn), luật 4 vẫn pass vì chỉ so s2==s.
    //
    // FRAMEWORK (dùng-chung mọi token hệ sinh thái): dist_cap/reserve_cap là PARAM
    // apply-time, KHÔNG hằng. LAMP bake 26,37 tỷ / 9,63 tỷ (tổng 36 tỷ); FARM bake
    // 12 tỷ; … từ CÙNG source. Bake vào params ⇒ vào policy-id ⇒ cap CỐ ĐỊNH bất
    // biến cho từng token, verify-được từ policy-id (không cần tin datum). "Cố định"
    // (mỗi token) và "param" (tái dùng source) KHÔNG mâu thuẫn.
    expect s.dist_cap == dist_cap
    expect s.reserve_cap == reserve_cap

    // ── D7-#10: counter KHÔNG âm (chống dist_minted/reserve_minted âm → cap ảo) ──
    expect s.dist_minted >= 0
    expect s.reserve_minted >= 0

    // ── Luật 2 + 3: Δ>0 và policy chỉ mint đúng 1 name = token_name (param) ──
    // Δ = lượng LAMP mint trong tx (cùng biến dùng cho transition → A8 không lệch).
    // Đo theo token_name (param apply lúc deploy): tLAMP trên testnet, LAMP trên mainnet.
    let delta = util.minted_qty(tx.mint, policy_id, token_name)
    expect delta > 0                                                   // A6 (no burn / no-op)
    expect util.policy_name_count(tx.mint, policy_id) == 1             // A11 (đúng 1 name)

    // ── Luật 4: caps BẤT BIẾN qua transition ──────────────────────────────
    expect s2.dist_cap == s.dist_cap                                  // A9
    expect s2.reserve_cap == s.reserve_cap

    // ── Luật 5: cộng đúng quota theo redeemer (khóa Distribution↔Reserve) ──
    // A5: DistributionVest KHÔNG đụng reserve_minted; ReserveDraw KHÔNG đụng dist_minted.
    // A8: cùng Δ — không thể "mint nhiều, ghi sổ ít".
    let quota_ok =
      when r is {
        DistributionVest ->
          s2.dist_minted == s.dist_minted + delta
            && s2.reserve_minted == s.reserve_minted
        ReserveDraw ->
          s2.reserve_minted == s.reserve_minted + delta
            && s2.dist_minted == s.dist_minted
      }
    expect quota_ok

    // ── Luật 6: monotonic (đơn điệu, không rollback) ──────────────────────
    // Ngầm đã đúng qua luật 5 (Δ>0) nhưng guard tường minh chống mọi rollback (A4).
    expect s2.dist_minted >= s.dist_minted
    expect s2.reserve_minted >= s.reserve_minted

    // ── Luật 7: cap enforce (biên = đúng cap được phép, > cap reject) ──────
    expect s2.dist_minted <= s2.dist_cap                             // A1
    expect s2.reserve_minted <= s2.reserve_cap

    // ── D7-#2: TRẦN TỔNG (defense-in-depth) ───────────────────────────────
    // Dù cap đã neo param, ép thêm trần tổng tuyệt đối = dist_cap + reserve_cap
    // (tổng phát hành lịch sử ≤ tổng cap bake — LAMP 36 tỷ oildrop, token khác theo param).
    expect s2.dist_minted + s2.reserve_minted <= dist_cap + reserve_cap

    // ── D3-#1 + D3-#3: KHÓA continuing output (SupplyState UTxO sạch) ──────
    // SupplyState UTxO KHÔNG được chứa LAMP (chống nhồi LAMP vào state để né
    // recipient / làm nhiễu kế toán circulating). Đo theo token_name (param).
    expect assets.quantity_of(s_out.value, policy_id, token_name) == 0
    // KHÔNG đính reference_script (chống biến SupplyState thành script-carrier rác).
    expect s_out.reference_script == None
    // Lý tưởng: continuing output chỉ gồm 1 thread NFT + lovelace (không token lạ).
    // policy_name_count thread == 1 đã ngầm bởi luật 1; ép thêm: KHÔNG có policy nào
    // khác ngoài thread_nft_policy + lovelace (ngăn token rác bám SupplyState).
    expect util.value_only_nft_and_ada(s_out.value, thread_nft_policy)

    // ── Luật 8: gate theo đường mint ──────────────────────────────────────
    // Hai đường mint khóa khác nhau (A10):
    //   • DistributionVest → pubkey-sig M-of-N (dist_authority + threshold). Đường DAO/
    //     vesting, MVP stub. Giữ nguyên.
    //   • ReserveDraw → KHÔNG chữ ký. Ép tx PHẢI spend đúng 1 UTxO mang meter NFT
    //     (= reserve_thread NFT) → reserve_draw.spend (Reserve) BẮT BUỘC chạy → δ ép
    //     ≤ E/1000 + pot + Treasury-pull (gate nhịp tất định). Permissionless thật:
    //     không keyholder nào quyết được con số nhả, ai dựng
    //     tx đúng lịch cũng được. Đây là điểm khóa "nhả-thuật-toán không ai rút tay".
    let gate_ok =
      when r is {
        DistributionVest -> {
          // ── WHO: authority đọc từ REGISTRY do OrgDID quản (token-mint v2) ──
          // KHÔNG đọc anchor TAAD trực tiếp, KHÔNG bake pkh tĩnh. registry.validate_mint ép:
          // (a) mint đúng 1 asset-name = token_name qty>0 [C-1]; (b) đúng 1 registry ref
          // input; (c) tìm entry token_tag; (d) authority thoả (SinglePkh 1 sig / MultiSig
          // M-of-N / Revoked→fail). Rotate khoá vận hành = sửa entry registry (do controller
          // DID hiện tại ký, tầng Registry validator) → KHÔNG redeploy. Least-privilege/token,
          // token đối tác MultiSig, thu hồi 1 token (Revoked) — không đẻ sub-DID/khoá.
          //
          // ── WHERE: A-DEST — TOÀN BỘ delta LAMP PHẢI rót vào KHO ──
          // Kho ĐỊNH-DANH bằng NFT (kho_nft), KHÔNG bake hash kho → kho tự-bound (treasury,
          // param theo lamp_policy) KHÔNG tạo VÒNG. Đọc hash kho ĐỘNG từ ref input mang kho NFT
          // (one-shot, không giả được). authority chỉ "bơm vào kho", KHÔNG mint thẳng về ví →
          // lộ khoá vận hành cũng không cướp được (kho nhả-theo-vesting). HOW MUCH = cap, trực giao.
          registry.validate_mint(
            policy_id,
            token_name,
            registry_nft_policy,
            registry_nft_name,
            token_tag,
            tx,
          ) && {
            let kho_hash =
              util.script_hash_of_holder(tx.reference_inputs, kho_nft_policy, kho_nft_name)
            // Đo ĐỘ TĂNG ròng của kho, KHÔNG đo tổng mặt output. Đo tổng cho phép tái chế:
            // kho đang giữ X, tx tiêu UTxO kho rồi trả lại đúng X, đưa delta mới về ví —
            // "tổng ≥ delta" vẫn thoả khi X ≥ delta dù kho không tăng đồng nào.
            util.qty_delta_at_script(
              tx.inputs,
              tx.outputs,
              kho_hash,
              policy_id,
              token_name,
            ) >= delta
          }
        }
        ReserveDraw -> {
          // ── WHO/NHỊP: đúng 1 input mang meter NFT (= reserve_thread NFT) ──
          // → tầng gate nhịp (reserve_draw, Reserve module) BẮT BUỘC được kích hoạt và ép
          // δ ≤ E/1000 + pot. Không cho 0 (bỏ qua meter) hay ≥2 (double-meter). meter NFT
          // KHÔNG được mint/burn trong tx (one-shot, sống mãi).
          //
          // ── WHERE: A-DEST cho đường Reserve — soi gương DistributionVest ──
          // Trước đây nhánh này KHÔNG ép đích: nó uỷ quyền toàn bộ cho reserve_draw, mà
          // reserve_draw lại đo bằng "tổng LAMP tới một ĐỊA CHỈ" — đúng phép đo mà chú
          // thích của DistributionVest ngay bên trên đã bác. Hệ quả đo được: mỗi lượt rút
          // Δ đi vào một UTxO không datum ở địa chỉ kho, tiêu lại không được, tức Δ bị
          // PHÁ HUỶ thay vì chuyển vào kho — trái bất biến "LAMP không đốt; giảm lưu hành
          // = chuyển vào kho (kế toán)".
          //
          // Nay ép hai vế, cùng hình dạng đã audit ở DistributionVest:
          //   (a) tx phải TIÊU đúng 1 UTxO mang kho NFT ⇒ validator của kho (Treasury
          //       custody, nhánh MigrateIn) chạy ⇒ nó ép Δ vào value VÀ vào SỔ;
          //   (b) ĐỘ TĂNG RÒNG của kho ≥ delta (không đo tổng — đo tổng cho tái chế).
          //
          // KHÁC DistributionVest ở CHỖ ĐỌC, và khác có lý do: Distribution đọc kho qua
          // REFERENCE input (kho không cần bị tiêu, không tranh chấp UTxO). Ở đây kho PHẢI
          // là SPEND input, vì chính việc bị tiêu mới làm validator kho chạy. Cùng một hàm
          // `script_hash_of_holder` phục vụ được cả hai vì nó nhận `List<Input>` — nó vẫn
          // đòi carrier ở SCRIPT và đòi ĐÚNG MỘT carrier, nên NFT kho đặt ở ví thường thì
          // cả tx chết ngay tại đây.
          //
          // ── KHO CỦA NHÁNH NÀY LÀ CẶP RIÊNG `reserve_kho_nft_*` (#13-14) ──────────
          // KHÔNG dùng `kho_nft_*` (#9-10) của `DistributionVest`. Hai cặp trỏ vào hai kho
          // THẬT SỰ khác nhau — lý do đầy đủ ở khối "HAI CẶP KHO" đầu tệp. Tóm tắt chỗ dễ
          // sai: `kho_nft_*` trỏ kho Distribution (`Distribution/…/treasury.ak`, có sổ
          // `outstanding_entitlement` phục vụ claim/redeem); `reserve_kho_nft_*` trỏ Treasury
          // custody (`Treasury/…/custody.ak`, cặp = (`seed_policy`, `instance_id`)), là nơi
          // duy nhất có nhánh `MigrateIn` ép Δ vào SỔ KẾ TOÁN.
          //
          // Nối nhầm dây ở đây thì khoá ba tầng hở NGAY Ở TẦNG NỐI: tx tiêu UTxO kho
          // Distribution, `treasury.ak` chạy — nhưng nó không có nhánh nào ghi Δ vào sổ
          // custody, nên Δ vẫn đứng ngoài sổ kế toán dù mọi phép đo ở đây đều xanh.
          //
          // GHI CHÚ TRUNG THỰC về vế `count_inputs_holding_nft(reserve_kho) == 1`: nó BỊ BAO
          // HÀM bởi `script_hash_of_holder` ngay dưới (`expect [single] = carriers`). Đo bằng
          // đột biến một dòng: nới nó thành `>= 0` ⟹ 0 bài đỏ. Giữ lại vì nó nói mệnh đề
          // ra thành lời tại chỗ và không phụ thuộc chi tiết cài đặt của helper; đừng đọc
          // "0 bài đỏ" ở đây thành "thiếu bài".
          util.count_inputs_holding_nft(tx.inputs, meter_nft_policy, meter_nft_name) == 1
            && assets.quantity_of(tx.mint, meter_nft_policy, meter_nft_name) == 0
            && util.count_inputs_holding_nft(
                 tx.inputs,
                 reserve_kho_nft_policy,
                 reserve_kho_nft_name,
               ) == 1
            && {
              let reserve_kho_hash =
                util.script_hash_of_holder(
                  tx.inputs,
                  reserve_kho_nft_policy,
                  reserve_kho_nft_name,
                )
              util.qty_delta_at_script(
                tx.inputs,
                tx.outputs,
                reserve_kho_hash,
                policy_id,
                token_name,
              ) >= delta
            }
        }
      }
    expect gate_ok

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests — happy (2 đường, biên cap) + NEGATIVE (mọi vector A1..A11)
// ══════════════════════════════════════════════════════════════

const lamp_pol: PolicyId = #"7717"

/// token_name dùng cho test = default_token_name ("tLAMP"). Validator nhận qua param.
const tk_name: ByteArray = constants.default_token_name

const thr_pol: PolicyId = #"5544"

const sscript: ByteArray = #"5151"

/// Kho Distribution treasury (dest) cho test — DistributionVest phải rót LAMP vào đây.
const dist_dest_hash: ByteArray = #"d35a"

// Registry NFT (bảng token_tag→authority do OrgDID quản). LAMP đọc cái này.
const registry_pol: PolicyId = #"a9c0"

const registry_nm: ByteArray = #"0b0b"

// token_tag mà policy LAMP này được phép mint (param bake).
const lamp_tag: ByteArray = #"4c414d50746167"

// khoá vận hành được uỷ quyền mint (SinglePkh authority trong entry) — người PHẢI ký.
const ctrl_pkh: ByteArray = #"c07401"

// kẻ lạ (không có trong authority) — dùng test reject.
const stranger: ByteArray = #"ba0bad"

// 2 khoá đối tác (test MultiSig).
const partner_a: ByteArray = #"9a"

const partner_b: ByteArray = #"9b"

// meter NFT = reserve_thread NFT (Reserve module — định danh đường ReserveDraw permissionless).
const meter_pol: PolicyId = #"6655"

const meter_nm: ByteArray = #"4d4554"

/// Input mang meter NFT (= reserve_thread NFT) — bằng chứng tx đi qua reserve_draw (gate nhịp).
fn meter_input() -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(meter_pol, meter_nm, 1)
  util.mk_input(util.mk_ref(9), util.mk_output(util.script_address(#"6d6d"), v, 0))
}

/// SupplyState input UTxO mang thread NFT, datum = s.
fn ss_input(s: SupplyState) -> Input {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(thr_pol, constants.supply_name, 1)
  util.mk_input(util.mk_ref(0), util.mk_output(util.script_address(sscript), v, s))
}

/// SupplyState output mang lại thread NFT, datum = s2 (cùng địa chỉ script).
fn ss_output(s2: SupplyState) -> Output {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(thr_pol, constants.supply_name, 1)
  util.mk_output(util.script_address(sscript), v, s2)
}

/// Output KHO Distribution treasury giữ `qty` LAMP (A-DEST: nơi DistributionVest phải rót).
fn dest_output(qty: Int) -> Output {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(lamp_pol, constants.default_token_name, qty)
  util.mk_output_no_datum(util.script_address(dist_dest_hash), v)
}

fn mint_lamp(qty: Int) {
  assets.zero |> assets.add(lamp_pol, constants.default_token_name, qty)
}

/// RegistryDatum 1 entry: tag → authority.
fn reg_datum(tag: ByteArray, auth: Authority) -> RegistryDatum {
  RegistryDatum {
    governing_did: "did:phoenix:org:greensun",
    entries: [RegistryEntry { token_tag: tag, authority: auth }],
  }
}

/// Reference input mang Registry NFT (1 đơn vị) + RegistryDatum inline.
fn registry_ref(d: RegistryDatum) -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(registry_pol, registry_nm, 1)
  util.mk_input(util.mk_ref(7), util.mk_output(util.script_address(#"a9c0"), v, d))
}

/// Registry ref hợp lệ mặc định: entry lamp_tag → SinglePkh{ctrl_pkh}.
fn registry_ok() -> Input {
  registry_ref(reg_datum(lamp_tag, SinglePkh { pkh: ctrl_pkh }))
}

// kho NFT đánh dấu địa chỉ KHO (= dist_dest_hash). A-DEST đọc hash kho từ đây.
const kho_pol: PolicyId = #"7a17"

const kho_nm: ByteArray = #"4b484f"

/// Reference input mang kho NFT, đặt tại địa chỉ kho (dist_dest_hash).
fn kho_ref() -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(kho_pol, kho_nm, 1)
  util.mk_input(util.mk_ref(6), util.mk_output(util.script_address(dist_dest_hash), v, 0))
}

/// Dựng tx DistributionVest đầy đủ (gate anchor). Kèm anchor ref hợp lệ mặc định
/// (Active/Org/ctrl) + rót toàn bộ LAMP vào kho (A-DEST). sigs = extra_signatories.
fn build_tx(
  s: SupplyState,
  s2: SupplyState,
  mint_qty: Int,
  sigs: List<ByteArray>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [ss_input(s)],
    reference_inputs: [registry_ok(), kho_ref()],
    outputs: [ss_output(s2), dest_output(mint_qty)],
    mint: mint_lamp(mint_qty),
    extra_signatories: sigs,
  }
}

/// build_tx với registry ref tùy biến (test authority khác). kho_ref tự thêm cho A-DEST.
fn build_tx_anchor(
  s: SupplyState,
  s2: SupplyState,
  mint_qty: Int,
  sigs: List<ByteArray>,
  refs: List<Input>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [ss_input(s)],
    reference_inputs: list.concat(refs, [kho_ref()]),
    outputs: [ss_output(s2), dest_output(mint_qty)],
    mint: mint_lamp(mint_qty),
    extra_signatories: sigs,
  }
}

// ── KHO ĐƯỜNG RESERVE = Treasury CUSTODY, KHÁC HẲN kho Distribution ở trên ───────────
// Cặp `(reserve_kho_pol, reserve_kho_nm)` mô phỏng `(seed_policy, instance_id)` của
// `Treasury/onchain/validators/custody.ak`; nó nằm ở MỘT script hash KHÁC `dist_dest_hash`.
// Giữ hai hash phân biệt trong fixture là điều làm ca âm `reservedraw_delta_vao_kho_dist`
// bên dưới có nghĩa — trộn chung một hash thì ca đó xanh vì lý do sai.
const reserve_kho_pol: PolicyId = #"c057"

const reserve_kho_nm: ByteArray = #"435553"

/// Script hash của Treasury custody (đích thật của đường Reserve).
const custody_hash: ByteArray = #"c0d1"

/// Input SPEND mang custody NFT: chính UTxO kho Treasury bị tiêu trong lượt rút.
/// KHÁC `kho_ref()` ở chỗ nó nằm trong `tx.inputs` — đó là điều làm validator custody CHẠY.
/// `holding` = lượng LAMP custody đang giữ TRƯỚC lượt rút (dùng cho ca tái chế).
fn custody_input_spent(holding: Int) -> Input {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(reserve_kho_pol, reserve_kho_nm, 1)
      |> assets.add(lamp_pol, constants.default_token_name, holding)
  util.mk_input(util.mk_ref(5), util.mk_output(util.script_address(custody_hash), v, 0))
}

/// Output custody sau MigrateIn: custody NFT trả lại + `qty` LAMP.
fn custody_output(qty: Int) -> Output {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(reserve_kho_pol, reserve_kho_nm, 1)
      |> assets.add(lamp_pol, constants.default_token_name, qty)
  util.mk_output(util.script_address(custody_hash), v, 0)
}

/// Dựng tx ReserveDraw đầy đủ: gate nhịp (spend meter NFT = reserve_thread NFT, KHÔNG chữ
/// ký) + A-DEST (spend custody NFT, custody tăng ròng đúng Δ). Custody khởi đầu giữ 0 LAMP.
fn build_tx_reserve(s: SupplyState, s2: SupplyState, mint_qty: Int) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [ss_input(s), meter_input(), custody_input_spent(0)],
    outputs: [ss_output(s2), custody_output(mint_qty)],
    mint: mint_lamp(mint_qty),
    extra_signatories: [],
  }
}

/// 14 tham số, ĐÚNG THỨ TỰ chữ ký. Hai khe cuối là cặp kho RIÊNG của đường Reserve —
/// đừng truyền `kho_pol, kho_nm` vào đó, đó chính là lỗ vừa vá.
fn run(r: TLampMintRedeemer, tx: Transaction) -> Bool {
  lamp_mint.mint(
    thr_pol, constants.supply_name, tk_name,
    constants.dist_cap_oildrop, constants.reserve_cap_oildrop,
    registry_pol, registry_nm, lamp_tag, kho_pol, kho_nm, meter_pol, meter_nm,
    reserve_kho_pol, reserve_kho_nm,
    r, lamp_pol, tx,
  )
}

fn fresh() -> SupplyState {
  SupplyState {
    dist_minted: 0,
    reserve_minted: 0,
    dist_cap: constants.dist_cap_oildrop,
    reserve_cap: constants.reserve_cap_oildrop,
  }
}

// ── HAPPY ────────────────────────────────────────────────────

test distvest_happy() {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [ctrl_pkh]))
}

test reservedraw_happy() {
  // Permissionless: KHÔNG chữ ký, chỉ cần spend meter NFT (= reserve_thread NFT).
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 5_000_000 }
  run(ReserveDraw, build_tx_reserve(s, s2, 5_000_000))
}

test distvest_incremental() {
  // mint dần: state đã có 100 tLAMP dist, mint thêm 50.
  let s = SupplyState { ..fresh(), dist_minted: 100_000_000 }
  let s2 = SupplyState { ..s, dist_minted: 150_000_000 }
  run(DistributionVest, build_tx(s, s2, 50_000_000, [ctrl_pkh]))
}

test distvest_exact_cap_boundary() {
  // mint tới ĐÚNG dist_cap (biên dưới-bằng được phép).
  let s = SupplyState { ..fresh(), dist_minted: constants.dist_cap_oildrop - 7 }
  let s2 = SupplyState { ..s, dist_minted: constants.dist_cap_oildrop }
  run(DistributionVest, build_tx(s, s2, 7, [ctrl_pkh]))
}

test reservedraw_exact_cap_boundary() {
  let s = SupplyState { ..fresh(), reserve_minted: constants.reserve_cap_oildrop - 3 }
  let s2 = SupplyState { ..s, reserve_minted: constants.reserve_cap_oildrop }
  run(ReserveDraw, build_tx_reserve(s, s2, 3))
}

// ── NEGATIVE — A1: vượt cap ──────────────────────────────────

test mint_exceed_dist_cap() fail {
  let s = SupplyState { ..fresh(), dist_minted: constants.dist_cap_oildrop - 5 }
  let s2 = SupplyState { ..s, dist_minted: constants.dist_cap_oildrop + 1 }
  run(DistributionVest, build_tx(s, s2, 6, [ctrl_pkh]))
}

test mint_exceed_reserve_cap() fail {
  let s = SupplyState { ..fresh(), reserve_minted: constants.reserve_cap_oildrop }
  let s2 = SupplyState { ..s, reserve_minted: s.reserve_minted + 1 }
  run(ReserveDraw, build_tx_reserve(s, s2, 1))
}

// ── A2: mint không consume SupplyState ───────────────────────

test mint_no_supplystate() fail {
  // không có input/output mang thread NFT → count == 0 ≠ 1 → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        util.mk_input(util.mk_ref(0),
          util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000))),
      ],
      outputs: [],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── A4: rollback (minted giảm) ───────────────────────────────

test mint_rollback_dist() fail {
  // s2.dist_minted < s.dist_minted → vi phạm monotonic + quota.
  let s = SupplyState { ..fresh(), dist_minted: 100_000_000 }
  let s2 = SupplyState { ..s, dist_minted: 50_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [ctrl_pkh]))
}

// ── A5: mint sai quota (Distribution đụng Reserve) ───────────

test distvest_touches_reserve() fail {
  // DistributionVest nhưng lại tăng reserve_minted → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000, reserve_minted: 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [ctrl_pkh]))
}

test reservedraw_touches_dist() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000, dist_minted: 1_000_000 }
  run(ReserveDraw, build_tx_reserve(s, s2, 1_000_000))
}

// ── A6: burn / no-op (Δ ≤ 0) ─────────────────────────────────

test mint_negative() fail {
  // Δ = -1 (burn) → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 0 }
  run(DistributionVest, build_tx(s, s2, -1, [ctrl_pkh]))
}

test mint_zero() fail {
  // Δ = 0 (no-op) → reject (delta > 0).
  let s = fresh()
  let s2 = fresh()
  run(DistributionVest, build_tx(s, s2, 0, [ctrl_pkh]))
}

// ── A7: double-satisfaction (2 SupplyState input) ────────────

test two_supplystate_inputs() fail {
  // 2 input mang thread NFT → count == 2 ≠ 1 → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), ss_input(s)],
      outputs: [ss_output(s2)],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── A8: Δ policy ≠ Δ datum ────────────────────────────────────

test delta_mismatch() fail {
  // mint 1_000_000 tLAMP nhưng datum chỉ cộng 1 → s2.dist_minted ≠ s+Δ → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [ctrl_pkh]))
}

// ── A9: nới cap qua transition ───────────────────────────────

test widen_dist_cap() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000, dist_cap: constants.dist_cap_oildrop + 1 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [ctrl_pkh]))
}

test widen_reserve_cap() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000, reserve_cap: constants.reserve_cap_oildrop * 2 }
  run(ReserveDraw, build_tx_reserve(s, s2, 1_000_000))
}

// ── D7-#1: input datum khai cap-BỊA (≠ param bake) → reject ────
// Khoá framework-param: cap PHẢI khớp param apply-time, không tin datum tự khai.
// Kẻ tấn công dựng SupplyState với dist_cap phình → s.dist_cap ≠ dist_cap (param) → fail.
test input_cap_mismatch_param() fail {
  let s = SupplyState { ..fresh(), dist_cap: constants.dist_cap_oildrop + 1_000_000 }
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [ctrl_pkh]))
}

// ── A10: thiếu chữ ký authority ──────────────────────────────

test mint_non_controller_signer() fail {
  // Registry entry authority = SinglePkh{ctrl_pkh} nhưng người ký là #"ff" (không phải
  // authority) → registry.validate_mint (d) authority_satisfied fail → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [#"ff"]))
}

// ── A-DEST: DistributionVest rót LAMP ra VÍ (không vào kho) → reject ──
test distvest_mint_not_to_dest() fail {
  // Đủ chữ ký authority NHƯNG toàn bộ LAMP chảy về ví cá nhân (không tới dist_dest).
  // qty_to_script(dist_dest) == 0 < delta → reject. Chứng minh 2-of-3 KHÔNG rút về cho mình.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let to_wallet =
    util.mk_output_no_datum(
      util.vk_address(#"beef"),
      assets.from_lovelace(2_000_000)
        |> assets.add(lamp_pol, constants.default_token_name, 1_000_000),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      reference_inputs: [registry_ok(), kho_ref()],
      outputs: [ss_output(s2), to_wallet],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── A-DEST: rót phần lớn vào kho nhưng TÁCH một ít ra ví → vẫn reject ──
test distvest_split_some_to_wallet() fail {
  // 999_999 vào kho + 1 ra ví → to_dest = 999_999 < delta 1_000_000 → reject (không tách lén).
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let to_wallet =
    util.mk_output_no_datum(
      util.vk_address(#"beef"),
      assets.from_lovelace(2_000_000)
        |> assets.add(lamp_pol, constants.default_token_name, 1),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      reference_inputs: [registry_ok(), kho_ref()],
      outputs: [ss_output(s2), dest_output(999_999), to_wallet],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── A-DEST: rót vào kho qua ĐỊA CHỈ KHO CÓ STAKE (staked) vẫn nhận đúng ──
test distvest_to_dest_staked_ok() {
  // Kho có stake credential → so theo payment_credential vẫn khớp dist_dest → PASS.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let staked_kho =
    util.mk_output_no_datum(
      util.script_address_staked(dist_dest_hash, #"5742"),
      assets.from_lovelace(2_000_000)
        |> assets.add(lamp_pol, constants.default_token_name, 1_000_000),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      reference_inputs: [registry_ok(), kho_ref()],
      outputs: [ss_output(s2), staked_kho],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

test reservedraw_no_meter() fail {
  // ReserveDraw nhưng tx KHÔNG spend meter NFT (= reserve_thread NFT, chỉ có SupplyState input) →
  // gate ReserveDraw đòi count_inputs(meter) == 1 → reject. Chứng minh KHÔNG bỏ qua
  // được reserve_draw (chống bypass rate-limit — block #2 council nêu).
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  run(ReserveDraw, build_tx(s, s2, 1_000_000, []))
}

test reservedraw_sig_alone_insufficient() fail {
  // Người giữ key cũ chỉ KÝ (không spend meter) → KHÔNG còn rút được. Permissionless
  // gate KHÔNG nhận chữ ký thay cho meter. Chứng minh "không ai rút tay".
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  run(ReserveDraw, build_tx(s, s2, 1_000_000, [ctrl_pkh, stranger]))
}

test reservedraw_two_meters() fail {
  // 2 input mang meter NFT (= reserve_thread NFT) → count == 2 ≠ 1 → reject (chống double-meter).
  // Lệch ca dương ĐÚNG một chỗ: meter thứ hai; phần kho giữ nguyên.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input(), meter_input(), custody_input_spent(0)],
      outputs: [ss_output(s2), custody_output(1_000_000)],
      mint: mint_lamp(1_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

test reservedraw_meter_minted_in_tx() fail {
  // tx mint thêm meter NFT (= reserve_thread NFT) cùng đường ReserveDraw → qty meter ≠ 0 → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input(), custody_input_spent(0)],
      outputs: [ss_output(s2), custody_output(1_000_000)],
      mint: mint_lamp(1_000_000) |> assets.add(meter_pol, meter_nm, 1),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

// ── A-DEST đường Reserve: kho phải BỊ TIÊU và phải TĂNG RÒNG ─────────────────

test reservedraw_no_kho_input() fail {
  // Không tiêu UTxO kho → validator kho không chạy → Δ không vào sổ được.
  // Đây chính là hình dạng đã gây ra lỗ. Nay gate ReserveDraw reject.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input()],
      outputs: [ss_output(s2), custody_output(1_000_000)],
      mint: mint_lamp(1_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

test reservedraw_delta_to_datumless_utxo_at_kho() fail {
  // Δ rót vào UTxO KHÔNG DATUM, KHÔNG NFT tại ĐỊA CHỈ custody, custody KHÔNG bị tiêu.
  // Đúng địa chỉ nhưng không vào sổ, và tiêu lại không được ⇒ Δ chết ngoài sổ.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  let stray =
    util.mk_output_no_datum(
      util.script_address(custody_hash),
      assets.from_lovelace(2_000_000)
        |> assets.add(lamp_pol, constants.default_token_name, 1_000_000),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input()],
      outputs: [ss_output(s2), stray],
      mint: mint_lamp(1_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

test reservedraw_two_kho_inputs() fail {
  // 2 UTxO mang kho NFT → `script_hash_of_holder` đòi ĐÚNG một carrier → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input(), custody_input_spent(0), custody_input_spent(0)],
      outputs: [ss_output(s2), custody_output(1_000_000)],
      mint: mint_lamp(1_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

test reservedraw_kho_nft_at_wallet() fail {
  // custody NFT nằm ở VÍ THƯỜNG (không validator nào canh) → `script_hash_of_holder` đòi
  // carrier ở SCRIPT → reject. Đây là lớp chặn cho bất biến deploy mà Reserve không đo.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  let kho_at_vk = {
    let v =
      assets.from_lovelace(2_000_000) |> assets.add(reserve_kho_pol, reserve_kho_nm, 1)
    util.mk_input(util.mk_ref(5), util.mk_output(util.vk_address(#"7a7a"), v, 0))
  }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input(), kho_at_vk],
      outputs: [ss_output(s2), custody_output(1_000_000)],
      mint: mint_lamp(1_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

test reservedraw_reject_kho_recycle() fail {
  // TÁI CHẾ trên đường Reserve: kho đang giữ 10 triệu ≥ Δ. tx tiêu UTxO kho, trả lại
  // ĐÚNG 10 triệu, còn Δ mới chảy ra ví. Phép đo "TỔNG mặt output tới kho ≥ Δ" cho ca
  // này lọt; `qty_delta_at_script` đo ĐỘ TĂNG = 0 < Δ ⇒ reject.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 10_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input(), custody_input_spent(10_000_000)],
      outputs: [ss_output(s2), custody_output(10_000_000), wallet_output(10_000_000)],
      mint: mint_lamp(10_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

test reservedraw_kho_increase_below_delta() fail {
  // Kho tăng ròng NHỎ HƠN Δ (chia bớt Δ ra ví) → reject. Biên đối xứng của ca dương.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 10_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input(), custody_input_spent(0)],
      outputs: [ss_output(s2), custody_output(9_999_999), wallet_output(1)],
      mint: mint_lamp(10_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

test reservedraw_kho_increase_real_when_kho_prefunded() {
  // ĐỐI CHỨNG DƯƠNG: cũng tiêu UTxO kho đang giữ 10 triệu, nhưng trả về 20 triệu
  // = cũ + Δ. Độ tăng ròng == Δ ⇒ hợp lệ. Luật KHÔNG cấm tiêu UTxO kho, chỉ cấm
  // kho không tăng.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 10_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input(), custody_input_spent(10_000_000)],
      outputs: [ss_output(s2), custody_output(20_000_000)],
      mint: mint_lamp(10_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

// ══════════════════════════════════════════════════════════════════════════════
// HAI KHO KHÔNG THAY THẾ ĐƯỢC CHO NHAU — bài đỏ cho lỗ "nối nhầm dây"
//
// Lỗ đã có thật: nhánh `ReserveDraw` từng dùng CHUNG cặp `kho_nft_*` với `DistributionVest`.
// Cặp đó trỏ kho Distribution (`Distribution/…/treasury.ak`), không trỏ Treasury custody.
// Hệ quả: khoá ba tầng (lamp_mint ⟹ reserve_draw ⟹ custody.MigrateIn) đứt ở tầng NỐI DÂY —
// mọi phép đo trong `lamp_mint` vẫn xanh trong khi Δ hạ cánh ở một cái kho KHÔNG có nhánh
// nào ghi nó vào sổ kế toán. Bốn bài dưới đây đỏ nếu ai gỡ bản vá.
// ══════════════════════════════════════════════════════════════════════════════

/// Input SPEND mang kho NFT ĐƯỜNG DISTRIBUTION (`kho_pol`/`kho_nm`) tại `dist_dest_hash`.
/// Đây là CÁI KHO SAI cho đường Reserve — dựng riêng để bài âm nói đúng điều nó muốn nói.
fn dist_kho_input_spent(holding: Int) -> Input {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(kho_pol, kho_nm, 1)
      |> assets.add(lamp_pol, constants.default_token_name, holding)
  util.mk_input(util.mk_ref(12), util.mk_output(util.script_address(dist_dest_hash), v, 0))
}

test reservedraw_delta_vao_kho_dist_bi_tu_choi() fail {
  // LỖ CỐT LÕI. Giao dịch hoàn hảo theo mọi luật CŨ: tiêu meter NFT, tiêu một UTxO kho
  // mang kho NFT ở SCRIPT, kho đó tăng ròng đúng Δ. Chỉ sai một điều — đó là kho
  // DISTRIBUTION, không phải Treasury custody. Không UTxO nào mang custody NFT
  // ⇒ `count_inputs_holding_nft(reserve_kho) == 0` ⇒ reject.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input(), dist_kho_input_spent(0)],
      outputs: [ss_output(s2), dest_output(1_000_000)],
      mint: mint_lamp(1_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

test reservedraw_delta_vao_dung_custody_duoc_nhan() {
  // ĐỐI CHỨNG DƯƠNG của bài ngay trên, khác ĐÚNG MỘT biến: kho được tiêu và được rót
  // là Treasury custody (mang `reserve_kho` NFT, ở `custody_hash`). Cùng Δ, cùng meter,
  // cùng transition ⇒ chấp nhận. Cặp âm/dương này khoá đúng chiều "kho nào".
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input(), custody_input_spent(0)],
      outputs: [ss_output(s2), custody_output(1_000_000)],
      mint: mint_lamp(1_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

test reservedraw_custody_bi_tieu_nhung_delta_chay_sang_kho_dist() fail {
  // Tinh vi hơn: tx tiêu CẢ HAI kho, custody có mặt nên vế "đúng 1 carrier" thoả, nhưng Δ
  // được rót sang kho Distribution còn custody trả về đúng số cũ (0). Độ tăng ròng ĐO TẠI
  // `custody_hash` = 0 < Δ ⇒ reject. Bài này chứng minh phép đo neo vào ĐÚNG hash đọc từ
  // custody NFT, không phải "có một kho nào đó tăng là được".
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        ss_input(s), meter_input(), custody_input_spent(0), dist_kho_input_spent(0),
      ],
      outputs: [ss_output(s2), custody_output(0), dest_output(1_000_000)],
      mint: mint_lamp(1_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}

test distvest_delta_vao_custody_bi_tu_choi() fail {
  // CHIỀU NGƯỢC LẠI: `DistributionVest` rót toàn bộ Δ vào Treasury custody thay vì kho
  // Distribution. Registry ký đúng, kho ref đúng — nhưng độ tăng ròng tại `dist_dest_hash`
  // = 0 < Δ ⇒ reject.
  //
  // GHI CHÚ TRUNG THỰC về sức phát hiện: bài này KHÔNG đỏ dưới hai đột biến đã thử (đảo dây
  // nhánh ReserveDraw sang cặp Distribution; đảo dây nhánh DistributionVest sang cặp Reserve).
  // Nó fail cùng chỗ và cùng lý do với `distvest_mint_not_to_dest` — "kho Distribution không
  // tăng". Giữ lại vì nó ghi lại một HÌNH DẠNG khác (đích là một SCRIPT khác, không phải ví),
  // không phải vì nó bắt được thứ bài kia bỏ sót. Đừng đọc nó thành một lớp chặn độc lập.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      reference_inputs: [registry_ok(), kho_ref()],
      outputs: [ss_output(s2), custody_output(1_000_000)],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── A11: mint asset name lạ cùng policy ──────────────────────

test mint_extra_name() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [ss_output(s2)],
      mint: mint_lamp(1_000_000) |> assets.add(lamp_pol, #"9999", 1),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── thread NFT bị burn/mint kèm (phá thread) ─────────────────

test thread_minted_in_tx() fail {
  // tx mint thêm thread NFT (qty thread ≠ 0) → reject (luật 1 ép == 0).
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [ss_output(s2)],
      mint: mint_lamp(1_000_000) |> assets.add(thr_pol, constants.supply_name, 1),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── SupplyState output rời địa chỉ script ────────────────────

test supplystate_moved_address() fail {
  // output mang thread NFT nhưng ở địa chỉ ví khác → s_out.address ≠ s_in.address.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let moved =
    util.mk_output(
      util.vk_address(#"dead"),
      assets.from_lovelace(2_000_000) |> assets.add(thr_pol, constants.supply_name, 1),
      s2,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [moved],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── SupplyState recreate THIẾU (input có, output không mang NFT) ──

test no_supplystate_output() fail {
  // có SupplyState input nhưng KHÔNG recreate output mang thread NFT → count_out 0 ≠ 1.
  let s = fresh()
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [
        util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
      ],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── Output mang NFT nhưng datum KHÔNG phải SupplyState (datum rác) ──

test garbage_output_datum() fail {
  // output mang thread NFT nhưng datum là Int rác → expect s2: SupplyState fail.
  let s = fresh()
  let garbage =
    util.mk_output(
      util.script_address(sscript),
      assets.from_lovelace(2_000_000) |> assets.add(thr_pol, constants.supply_name, 1),
      42,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [garbage],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ══════════════════════════════════════════════════════════════
// NEGATIVE bổ sung — neo bootstrap on-chain (Nhóm A/B/C audit MECE)
// ══════════════════════════════════════════════════════════════

/// SupplyState input KHÔNG mang SUPPLY NFT (UTxO giả tại địa chỉ script).
fn ss_input_no_nft(s: SupplyState) -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(util.script_address(sscript), assets.from_lovelace(2_000_000), s),
  )
}

// ── D7-#1: cap INPUT phình (neo hằng) ─────────────────────────
test input_cap_inflated() fail {
  // s.dist_cap > hằng genesis → reject (luật 4 cũ chỉ so s2==s, không bắt được).
  let s = SupplyState { ..fresh(), dist_cap: constants.dist_cap_oildrop + 1_000_000_000 }
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [ctrl_pkh]))
}

test input_reserve_cap_inflated() fail {
  let s = SupplyState { ..fresh(), reserve_cap: constants.reserve_cap_oildrop * 10 }
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  run(ReserveDraw, build_tx_reserve(s, s2, 1_000_000))
}

// ── D7-#10: counter INPUT âm ──────────────────────────────────
test input_counter_negative() fail {
  // s.dist_minted < 0 → reject (chống cap ảo qua counter âm).
  let s = SupplyState { ..fresh(), dist_minted: -1_000_000 }
  let s2 = SupplyState { ..s, dist_minted: 0 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [ctrl_pkh]))
}

test input_reserve_counter_negative() fail {
  let s = SupplyState { ..fresh(), reserve_minted: -5 }
  let s2 = SupplyState { ..s, reserve_minted: -4 }
  run(ReserveDraw, build_tx_reserve(s, s2, 1))
}

// ── D8-#1 (neo NFT): SupplyState INPUT KHÔNG mang SUPPLY NFT → reject ──
test input_no_supply_nft() fail {
  // UTxO giả KHÔNG mang SUPPLY NFT → count_inputs_holding_nft == 0 ≠ 1 → reject.
  // Đây là neo định danh mới: không bằng địa chỉ-script (gây vòng) mà bằng NFT one-shot.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input_no_nft(s)],
      outputs: [ss_output(s2)],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── D7-#2: vượt TRẦN TỔNG (defense-in-depth) ──────────────────
// Lưu ý: với cap neo hằng, trần tổng = dist_cap+reserve_cap; muốn chạm trần phải
// đẩy 1 nhánh tới cap rồi nhánh kia vượt. Test bằng reserve tới sát rồi cộng vượt
// tổng nhưng vẫn ≤ reserve_cap là bất khả (reserve_cap < total). Dùng kịch bản:
// dist đã = dist_cap, mint reserve khiến tổng > total — nhưng reserve_minted vẫn phải
// ≤ reserve_cap. Vì dist_cap+reserve_cap == total_cap, chạm trần ⟺ chạm cả 2 cap.
// → trần tổng là lớp phòng thủ dư (đã được 2 cap riêng bao). Khẳng định nó KHÔNG
// loại oan happy-case biên kép:
test total_cap_double_boundary_ok() {
  // dist đầy cap, reserve mint tới đúng cap → tổng == total_cap (==, không vượt).
  let s = SupplyState { ..fresh(), dist_minted: constants.dist_cap_oildrop, reserve_minted: constants.reserve_cap_oildrop - 1 }
  let s2 = SupplyState { ..s, reserve_minted: constants.reserve_cap_oildrop }
  run(ReserveDraw, build_tx_reserve(s, s2, 1))
}

// ── D3-#1: nhồi tLAMP vào SupplyState output ──────────────────
test state_output_holds_tlamp() fail {
  // s_out chứa tLAMP → reject (continuing output phải sạch tLAMP).
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let dirty =
    util.mk_output(
      util.script_address(sscript),
      assets.from_lovelace(2_000_000)
        |> assets.add(thr_pol, constants.supply_name, 1)
        |> assets.add(lamp_pol, constants.default_token_name, 500_000),
      s2,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [dirty],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── D3 (token rác): SupplyState output mang token policy lạ ────
test state_output_foreign_token() fail {
  // s_out mang thread NFT + 1 token policy lạ → value_only_nft_and_ada fail → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let dirty =
    util.mk_output(
      util.script_address(sscript),
      assets.from_lovelace(2_000_000)
        |> assets.add(thr_pol, constants.supply_name, 1)
        |> assets.add(#"aaaa", #"1234", 7),
      s2,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [dirty],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ── D3-#3: SupplyState output đính reference_script ───────────
test state_output_has_reference_script() fail {
  // s_out.reference_script != None → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let with_ref =
    Output {
      address: util.script_address(sscript),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(thr_pol, constants.supply_name, 1),
      datum: InlineDatum(s2),
      reference_script: Some(#"deadbeef"),
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [with_ref],
      mint: mint_lamp(1_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ══════════════════════════════════════════════════════════════
// REGISTRY AUTHORITY (token-mint v2) — thay bộ anchor cũ
// ══════════════════════════════════════════════════════════════

// ── ROTATE khoá vận hành: registry entry trỏ khoá MỚI → khoá mới ký PASS ──
test registry_rotated_key_ok() {
  // Sửa entry registry sang SinglePkh{new_key} (controller DID ký ở tầng registry);
  // khoá mới ký mint → được. KHÔNG redeploy lamp_mint (authority là DỮ LIỆU registry).
  let new_key = #"c0ffee"
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let refs = [registry_ref(reg_datum(lamp_tag, SinglePkh { pkh: new_key }))]
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [new_key], refs))
}

// ── Registry NFT + datum bịa Ở VÍ THƯỜNG → reject (pin địa chỉ) ──
test registry_ref_o_vi_thuong_bi_tu_choi() fail {
  // Nếu find_registry_datum chỉ lọc theo NFT (không ép địa chỉ) thì bất kỳ ai nắm
  // được registry NFT cũng đặt nó ở ví mình, tự khai authority = ví mình, rồi mint
  // LAMP không giới hạn. Bản v1 (Legacy/Tokenomics-v1-anchor/.../phoenixkey.ak:142-156 —
  // Legacy/ đã gỡ khỏi cây 2026-08-12, tra `git show be14728:Legacy/Tokenomics-v1-anchor/`)
  // thiếu đúng mệnh đề này và PoC mint được thật. Ràng buộc
  // payment_credential == Script(registry_nft_policy) phải chặn ngay tại đây.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let v =
    assets.from_lovelace(2_000_000) |> assets.add(registry_pol, registry_nm, 1)
  let evil_ref =
    util.mk_input(
      util.mk_ref(7),
      util.mk_output(
        util.vk_address(ctrl_pkh),
        v,
        reg_datum(lamp_tag, SinglePkh { pkh: ctrl_pkh }),
      ),
    )
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [ctrl_pkh], [evil_ref]))
}

// ── STRANGER ký (không phải authority của entry) → reject ──
test registry_stranger_signs() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [stranger]))
}

// ── REVOKED: entry token_tag bị thu hồi → mọi mint fail ──
test registry_revoked() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let refs = [registry_ref(reg_datum(lamp_tag, Revoked))]
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [ctrl_pkh], refs))
}

// ── MULTISIG token đối tác: 2-of-2 đủ chữ ký → PASS ──
test registry_multisig_ok() {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let auth = MultiSig { pkhs: [partner_a, partner_b], threshold: 2 }
  let refs = [registry_ref(reg_datum(lamp_tag, auth))]
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [partner_a, partner_b], refs))
}

// ── MULTISIG thiếu 1 chữ ký (1-of-2 < threshold 2) → reject ──
test registry_multisig_insufficient() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let auth = MultiSig { pkhs: [partner_a, partner_b], threshold: 2 }
  let refs = [registry_ref(reg_datum(lamp_tag, auth))]
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [partner_a], refs))
}

// ── MULTISIG datum độc: pkhs TRÙNG phình count → reject (dedupe) ──
test registry_multisig_dup_pkh() fail {
  // [partner_a×3] threshold 3, chỉ partner_a ký → unique=1 < 3 → reject (không phình).
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let auth = MultiSig { pkhs: [partner_a, partner_a, partner_a], threshold: 3 }
  let refs = [registry_ref(reg_datum(lamp_tag, auth))]
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [partner_a], refs))
}

// ── MULTISIG threshold 0 (datum độc) → reject (0 chữ ký KHÔNG thoả) ──
test registry_multisig_threshold_zero() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let auth = MultiSig { pkhs: [partner_a, partner_b], threshold: 0 }
  let refs = [registry_ref(reg_datum(lamp_tag, auth))]
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [], refs))
}

// ── token_tag SAI: entry không khớp tag bake → fail (không thấy entry) ──
test registry_wrong_tag() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let refs =
    [registry_ref(reg_datum(#"deadbeef", SinglePkh { pkh: ctrl_pkh }))]
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [ctrl_pkh], refs))
}

// ── KHÔNG có registry ref input → reject ──
test registry_missing() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [ctrl_pkh], []))
}

// ── HAI registry ref (mơ hồ authority) → reject ──
test registry_two_refs() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let refs = [registry_ok(), registry_ref(reg_datum(lamp_tag, SinglePkh { pkh: #"c0ffee" }))]
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [ctrl_pkh], refs))
}

// ── READ-SIDE fail-closed: 1 datum có 2 entry TRÙNG tag → reject (KHÔNG ──
// ── first-match). ctrl_pkh ký (khớp entry đầu) nhưng vẫn fail vì ≥2 entry. ──
// Khớp canonical Tokenomics `token_mint_dup_tag_in_registry_fails`.
test registry_dup_tag_in_datum() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let dup =
    RegistryDatum {
      governing_did: "did:phoenix:org:greensun",
      entries: [
        RegistryEntry { token_tag: lamp_tag, authority: SinglePkh { pkh: ctrl_pkh } },
        RegistryEntry { token_tag: lamp_tag, authority: SinglePkh { pkh: stranger } },
      ],
    }
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [ctrl_pkh], [registry_ref(dup)]))
}

// ══════════════════════════════════════════════════════════════
// CỔNG CHẾT — đúc MỘT LƯỢT chạm cap ⇒ policy đóng vĩnh viễn
//
// Điều kiện anh chốt (2026-08-18): "Đúc một lần chạm cap ⇒ cổng chết ngay sau đó
// ⇒ xoay khoá OrgDID bao nhiêu lần cũng không ảnh hưởng gì cả."
//
// Đây là chỗ chứng minh mệnh đề đó bằng LUẬT SỔ CÁI, không bằng lời hứa vận hành:
// sau khi dist_minted == dist_cap, MỌI đường DistributionVest đều chết vì số học
// (delta > 0 ∧ dist_minted + delta ≤ dist_cap không cùng đúng được). Registry còn
// sống hay chết, khoá OrgDID xoay bao nhiêu lần, ai cầm seed — đều không đổi kết quả.
//
// Điều KHÔNG chết: ReserveDraw. Nhánh đó KHÔNG đọc registry, KHÔNG đòi chữ ký —
// nó đòi spend meter NFT (= reserve_thread NFT) nên bị reserve_draw ép trần
// E/1000 mỗi epoch. Đó là "thuật toán nhả không ai rút tay", giữ nguyên chủ đích.
// ══════════════════════════════════════════════════════════════

/// Trạng thái SAU lượt đúc trọn quota Distribution — dist_minted == dist_cap.
fn saturated_dist() -> SupplyState {
  SupplyState { ..fresh(), dist_minted: constants.dist_cap_oildrop }
}

// ── ĐÚC TRỌN QUOTA TRONG MỘT LƯỢT (từ 0 → dist_cap) ──────────────────
// 26,37 tỷ LAMP = 26_370_000_000_000_000 oildrop trong ĐÚNG một giao dịch.
test oneshot_full_dist_cap() {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: constants.dist_cap_oildrop }
  run(DistributionVest, build_tx(s, s2, constants.dist_cap_oildrop, [ctrl_pkh]))
}

// ── SAU ĐÓ: 1 oildrop cũng không đúc thêm được, DÙ khoá vận hành ký đúng ──
test gate_dead_authority_still_signs() fail {
  let s = saturated_dist()
  let s2 = SupplyState { ..s, dist_minted: s.dist_minted + 1 }
  run(DistributionVest, build_tx(s, s2, 1, [ctrl_pkh]))
}

// ── XOAY KHOÁ OrgDID KHÔNG CỨU ĐƯỢC CỔNG ĐÃ CHẾT ─────────────────────
// Registry ghi authority MỚI (khoá vừa xoay), khoá mới ký đúng. Vẫn fail.
// Đây là bằng chứng trực tiếp cho "xoay khoá bao nhiêu lần cũng không ảnh hưởng":
// registry_rotated_key_ok() ở trên chứng minh xoay khoá MỞ được cổng khi còn quota;
// test này chứng minh khi hết quota thì xoay khoá KHÔNG mở được nữa.
test gate_dead_even_after_key_rotation() fail {
  let s = saturated_dist()
  let s2 = SupplyState { ..s, dist_minted: s.dist_minted + 1_000_000 }
  let rotated = registry_ref(reg_datum(lamp_tag, SinglePkh { pkh: #"deadbeef" }))
  run(DistributionVest, build_tx_anchor(s, s2, 1_000_000, [#"deadbeef"], [rotated]))
}

// ── KHÔNG "ĐI VÒNG" QUA SỔ SÁCH: mint mà không ghi sổ cũng chết ───────
// Kẻ cầm khoá thử mint 1 triệu nhưng để nguyên dist_minted (không cộng) —
// luật 5 (delta_mismatch) chặn. Cổng chết KHÔNG né được bằng cách gian sổ.
test gate_dead_no_unbooked_mint() fail {
  let s = saturated_dist()
  run(DistributionVest, build_tx(s, s, 1_000_000, [ctrl_pkh]))
}

// ── KHÔNG QUAY NGƯỢC SỔ ĐỂ MỞ LẠI QUOTA ──────────────────────────────
// Hạ dist_minted xuống rồi mint lại — luật 6 (đơn điệu) chặn.
test gate_dead_no_counter_rollback() fail {
  let s = saturated_dist()
  let s2 = SupplyState { ..s, dist_minted: s.dist_minted - 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [ctrl_pkh]))
}

// ── KHÔNG MƯỢN QUOTA RESERVE ĐỂ ĐÚC TIẾP ĐƯỜNG DISTRIBUTION ───────────
// Quota Distribution hết; thử ghi delta sang reserve_minted nhưng vẫn đi
// redeemer DistributionVest — luật 5 (A5) khoá chéo, chặn.
test gate_dead_no_quota_borrow() fail {
  let s = saturated_dist()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [ctrl_pkh]))
}

// ── CÁI KHÔNG CHẾT: nhánh nhả 9,63 tỷ vẫn sống, KHÔNG chữ ký, KHÔNG registry ──
// Sau khi cổng Distribution chết, Reserve vẫn rút được qua meter NFT. Đây là
// phần "nhả nhỏ giọt tự động" — không ai ký, không ai xoay khoá được nó.
test reserve_alive_after_dist_gate_dead() {
  let s = saturated_dist()
  let s2 = SupplyState { ..s, reserve_minted: 5_000_000 }
  run(ReserveDraw, build_tx_reserve(s, s2, 5_000_000))
}

// ── VÀ KHI CẢ HAI QUOTA CẠN: policy đóng tuyệt đối, không đường nào mở ──
test both_quotas_exhausted_policy_closed() fail {
  let s =
    SupplyState {
      ..fresh(),
      dist_minted: constants.dist_cap_oildrop,
      reserve_minted: constants.reserve_cap_oildrop,
    }
  let s2 = SupplyState { ..s, reserve_minted: s.reserve_minted + 1 }
  run(ReserveDraw, build_tx_reserve(s, s2, 1))
}

// ══════════════════════════════════════════════════════════════
// A-DEST đo ĐỘ TĂNG, KHÔNG đo tổng — chống TÁI CHẾ LAMP đã nằm trong kho
//
// Đường tấn công (chỉ sống khi cổng còn quota): kho đang giữ X LAMP. Kẻ cầm khoá
// vận hành dựng tx tiêu UTxO kho (X), mint thêm delta, trả về kho ĐÚNG X, đưa
// delta mới về ví riêng. Luật cũ đo TỔNG mặt output ở kho = X ≥ delta ⇒ PASS,
// trong khi kho KHÔNG tăng một đồng. Luật mới đo (output − input) = 0 < delta ⇒ REJECT.
// ══════════════════════════════════════════════════════════════

/// UTxO kho đang giữ sẵn `qty` LAMP (bị TIÊU trong tx tấn công).
fn kho_input_holding(qty: Int) -> Input {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(lamp_pol, constants.default_token_name, qty)
  util.mk_input(util.mk_ref(11), util.mk_output_no_datum(util.script_address(dist_dest_hash), v))
}

/// Output về ví thường giữ `qty` LAMP (nơi kẻ tấn công muốn LAMP mới chảy tới).
fn wallet_output(qty: Int) -> Output {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(lamp_pol, constants.default_token_name, qty)
  util.mk_output_no_datum(util.vk_address(#"beef01"), v)
}

test adest_recycle_kho_balance_rejected() fail {
  // Kho đang giữ 10 triệu oildrop. Mint thêm 10 triệu, trả kho đúng 10 triệu cũ,
  // 10 triệu MỚI về ví. Tổng mặt output ở kho = 10 triệu ≥ delta → luật CŨ cho qua.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 10_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), kho_input_holding(10_000_000)],
      reference_inputs: [registry_ok(), kho_ref()],
      outputs: [ss_output(s2), dest_output(10_000_000), wallet_output(10_000_000)],
      mint: mint_lamp(10_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

test adest_kho_input_still_ok_when_increase_real() {
  // Đối chứng: cũng tiêu UTxO kho (10 triệu) nhưng trả về kho 20 triệu = cũ + delta.
  // Độ tăng ròng = 10 triệu = delta ⇒ hợp lệ. Luật mới KHÔNG cấm tiêu UTxO kho,
  // chỉ cấm kho không tăng.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 10_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), kho_input_holding(10_000_000)],
      reference_inputs: [registry_ok(), kho_ref()],
      outputs: [ss_output(s2), dest_output(20_000_000)],
      mint: mint_lamp(10_000_000),
      extra_signatories: [ctrl_pkh],
    }
  run(DistributionVest, tx)
}

// ══════════════════════════════════════════════════════════════
// RANH GIỚI ReserveDraw — cái gì lamp_mint canh, cái gì nó UỶ QUYỀN
//
// ĐÃ ĐỔI: trước đây nhánh ReserveDraw chỉ đòi ĐÚNG MỘT input mang meter NFT và KHÔNG ép
// đích đến. Nay nó ép thêm A-DEST đường Reserve — kho phải BỊ TIÊU và phải TĂNG RÒNG ≥ δ.
// Lý do đổi: uỷ quyền đích đến cho reserve_draw, mà reserve_draw lại đo bằng "tổng LAMP
// tới một ĐỊA CHỈ", nên mỗi lượt rút đẩy Δ vào một UTxO không datum ở địa chỉ kho — tiêu
// lại không được ⇒ Δ bị PHÁ HUỶ. Đúng địa chỉ mà không vào SỔ thì kho không nhận được gì.
//
// CÒN UỶ QUYỀN (lamp_mint vẫn KHÔNG canh): trần mỗi lượt (δ ≤ E/1000), nhịp ≤1 lượt/epoch,
// pot còn lại, Treasury-pull. Toàn bộ nằm ở SCRIPT ĐANG GIỮ METER NFT.
//   • meter NFT ở `reserve_draw.ak` ⇒ nhả theo thuật toán, không ai rút tay.
//   • meter NFT ở VÍ THƯỜNG ⇒ người cầm ví tự chọn nhịp và lượng (nhưng vẫn PHẢI rót
//     vào kho — A-DEST mới chặn đường "đúc thẳng về ví").
// meter_nft_policy/meter_nft_name và reserve_kho_nft_policy/reserve_kho_nft_name đều là THAM
// SỐ apply-time ⇒ nướng vào policy-id ⇒ chọn sai lúc deploy là vĩnh viễn.
//
// ⚠ CHỖ DỄ NỐI NHẦM DÂY NHẤT: kho của nhánh này là `reserve_kho_nft_*` (#13-14 → Treasury
// custody), KHÔNG phải `kho_nft_*` (#9-10 → kho Distribution). Nối nhầm thì mọi phép đo ở
// đây vẫn xanh mà Δ hạ cánh ở cái kho không có nhánh nào ghi nó vào sổ kế toán. Bài đỏ giữ
// chỗ này: `reservedraw_delta_vao_kho_dist_bi_tu_choi` +
// `reservedraw_custody_bi_tieu_nhung_delta_chay_sang_kho_dist`.
// ══════════════════════════════════════════════════════════════

test reservedraw_lamp_mint_ep_dich_den() fail {
  // ĐẢO KỲ VỌNG (trước là ca DƯƠNG tên `reservedraw_lamp_mint_khong_ep_dich_den`, ghi
  // lại đúng lỗ đang vá): toàn bộ LAMP mint đường Reserve chảy về VÍ THƯỜNG, không tiêu
  // kho, kho không tăng ⇒ nay REJECT.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 5_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), meter_input()],
      outputs: [ss_output(s2), wallet_output(5_000_000)],
      mint: mint_lamp(5_000_000),
      extra_signatories: [],
    }
  run(ReserveDraw, tx)
}
