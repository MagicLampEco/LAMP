// LampDistribution onchain types — interface contract (`capped-drop/Tech-Spec.md` v3 §2).
// Phải khớp byte-perfect với offchain types.ts (Constr index theo thứ tự khai báo).

/// Per-wallet account tại claim_account script — CONTRACT v3 "Capped Drop".
/// Mọi giá trị là oildrop. Bất biến: 0 ≤ redeemed ≤ entitlement.
///
/// v3 KHÔNG còn tính vested bằng `D · dpe · elapsed`. Thay vào đó mốc thời gian của tài
/// khoản là CHỈ SỐ CỘNG DỒN `A` do beacon giữ, chụp lại lúc mở ở `index_at_start`:
///   A_span = A(bây giờ) − index_at_start
///   vested = min(entitlement, drops_per_epoch · √entitlement · A_span)
/// Validator KHÔNG khai căn — nó kẹp con số người dựng tx XIN (xem `claim_account.ak`).
pub type ClaimAccountDatum {
  owner           : ByteArray,   // PKH chủ ví
  entitlement     : Int,         // E — tổng LAMP được phân bổ
  redeemed        : Int,         // đã nhận tích lũy
  start_epoch     : Int,         // t0 — GIỮ, chỉ còn dùng cho nhãn/kiểm toán
  drops_per_epoch : Int,         // GHIM == 1 ở v3 (C-ACC-DPE) — giữ trường, khoá giá trị
  // a₀ — chỉ số beacon A CHỤP LÚC MỞ. TRƯỜNG MỚI v3, ĐẶT Ở CUỐI để năm trường trên giữ
  // nguyên chỉ số Constr. Đó KHÔNG phải tương thích ngược: Aiken giải mã nghiêm ngặt theo
  // SỐ TRƯỜNG, nên mọi UTxO tài khoản v2 đang sống không đọc được bằng validator v3 ⇒ v3
  // đòi một genesis mới. Cái giữ được chỉ là: codec offchain và công cụ đọc datum không
  // phải đánh số lại năm trường cũ.
  index_at_start  : Int,
}

pub type ClaimAccountRedeemer {
  // committee M-of-N confirm activity → tài khoản REBASE, entitlement += amount
  Claim { amount: Int }
  // user XIN `amount`, validator KẸP (trần tích luỹ + cắt ngọn). v2 để validator tự tính
  // rồi trả trọn phần chênh; v3 không làm thế được nữa vì cắt ngọn phải chặn từng lượt,
  // và vì người dùng phải chọn được rút ít hơn (gộp phí, chia nhiều lượt).
  Redeem { amount: Int }
}

pub type BeaconKind {
  // tham số tốc độ mở khoá — v3: chỉ số cộng dồn `A` + gốc tốc độ `rate_root`
  DropParam
}

/// Beacon UTxO do committee post. Authenticity = NFT "DROP".
///
/// `index` là CHỈ SỐ CỘNG DỒN: nó tăng đơn điệu và không nhánh nào làm nó giảm. Đọc được
/// tại một cửa sổ bất kỳ mà KHÔNG cần ai post gì:
///   A(t) = index + rate_root · (t − epoch)
/// Committee im lặng ⇒ vesting VẪN chạy ở `rate_root` đã post lần cuối (fail-open có chủ
/// đích — bắt committee post mỗi cửa sổ sẽ biến sự im lặng thành nút đóng băng toàn hệ).
pub type BeaconDatum {
  epoch          : Int,               // cửa sổ lượt post này (C-BCN-3)
  kind           : BeaconKind,
  index          : Int,               // A tại mốc `epoch` — CỘNG DỒN, CHỈ TĂNG
  rate_root      : Int,               // w — NGUYÊN THUỶ (W := w², KHÔNG phải ngược lại)
  trim_num       : Int,               // κ tử  ┐ tham số CẮT NGỌN (kênh "siết thoải mái")
  trim_den       : Int,               // κ mẫu ┘ giá trị vận hành 1 / 1000
  speed_policies : List<ByteArray>,   // MÓC MỞ RỘNG — RỖNG ở lượt đúc này
}

pub type BeaconRedeemer {
  // committee post giá trị mới cho cửa sổ hiện tại
  PostBeacon
}

/// Treasury UTxO giữ LAMP pool (QĐ7) + hai sổ cái ĐI NGƯỢC CHIỀU NHAU.
///
/// `outstanding_entitlement` = SỐ CÒN NỢ người dùng = Σ(entitlement − redeemed) toàn hệ,
/// serial-hoá qua treasury singleton. TĂNG khi grant (+granted), GIẢM khi redeem
/// (−released). Bất biến on-chain ép tại mỗi Claim:
///   outstanding_entitlement ≤ treasury_lamp (pool)  ⇒ quỹ luôn đủ trả.
/// ⚠ 2026-08-12: trước đây trường này tên `cumulative_entitlement` và mang nghĩa TỔNG CẤP
/// SUỐT VÒNG ĐỜI (bất biến khi redeem). Sai: pool giảm mỗi redeem còn sổ cái thì không,
/// nên `≤ pool` siết dần đến BẾ TẮC. Xem ghi chú đầy đủ ở đầu `validators/treasury.ak`.
///
/// `total_redeemed` = SỐ ĐÃ PHÁT RA tích luỹ, CHỈ TĂNG (trường MỚI v3, ở CUỐI). Nó KHÔNG
/// suy ra được từ trường trên — hai đại lượng đi ngược chiều nhau, và `entitlement` được
/// cấp dần chứ không cố định từ đầu. Đây là MẪU SỐ của phép cắt ngọn; đơn điệu tăng là một
/// bất biến PHẢI VIẾT RA, vì đổi mẫu số sang một đại lượng giảm được (vd "lưu hành trừ tồn
/// kho") dựng lại nguyên lớp lỗi hồi tố mà v3 sinh ra để diệt.
pub type TreasuryDatum {
  committee_hash         : ByteArray,
  outstanding_entitlement: Int,        // oildrop — sổ cái CÒN NỢ
  total_redeemed         : Int,        // oildrop — ĐÃ PHÁT RA, chỉ tăng (field mới, ở cuối)
}

pub type TreasuryRedeemer {
  // release LAMP cho các Redeem trong cùng tx (pool ↓ và sổ cái nợ ↓, ĐÚNG redeemed delta)
  ReleaseForRedeem
  // committee cấp entitlement: pool LAMP bất biến, sổ cái nợ += granted,
  // ép outstanding_entitlement_out ≤ treasury_lamp (solvency on-chain).
  GrantEntitlement
  // ⚠ THÊM 2026-08-12 (vá review PR #22, điểm 2) — ĐẶT Ở CUỐI để giữ nguyên Constr index
  // của hai redeemer trên (0/1), offchain đang neo theo đó.
  // Gộp N ≥ 1 UTxO đang nằm ở script treasury vào ĐÚNG 1 output + cho phép nạp thêm LAMP.
  // VÌ SAO PHẢI CÓ: trước bản vá không redeemer nào làm pool TĂNG — Grant ép value bất biến,
  // Release chỉ cho LAMP giảm, và `count_inputs_at_script == 1` chặn luôn đường gộp. Tổng
  // cấp phát suốt vòng đời do đó ≤ số dư genesis, còn LAMP rót về kho sau này (A-DEST hạ
  // cánh dưới dạng UTxO RIÊNG, thường KHÔNG datum) nằm chết tại địa chỉ script.
  Refill
}
