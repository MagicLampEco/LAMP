// treasury_stake — STAKE CREDENTIAL của kho custody Treasury (Plutus V3, stake purpose).
//
// ─────────────────────────────────────────────────────────────────────────
// MÔ HÌNH
//   Kho được gieo với địa chỉ (payment: Script(custody_hash), stake: Script(this)).
//   Cả BỐN nhánh spend của `custody.ak` đều ép `cust_out.address == cust_in.address`
//   (C-COL-ADDR / C-REL-ADDR / C-MIG-ADDR / C-STK-ADDR) nên stake credential của kho là
//   BẤT BIẾN đời instance: không giao dịch nào dời được nó sang credential khác.
//
//   Toàn bộ ADA trong kho do đó sinh phần thưởng uỷ quyền, và phần thưởng ấy dồn về
//   reward-account của CHÍNH script này. Ledger không đòi chữ ký nào để rút một
//   reward-account có stake credential là script — điều kiện rút là script này trả True.
//   Nghĩa là `withdraw` PERMISSIONLESS theo thiết kế, và thứ duy nhất giữ được tiền là
//   ĐÍCH RÚT bị khoá bằng tham số apply-time.
//
// ─────────────────────────────────────────────────────────────────────────
// HAI HANDLER
//   withdraw — rút thưởng khỏi reward-account. ÉP:
//     S-STK-ACC   account đang chạy phải có mặt trong `tx.withdrawals`.
//     S-STK-DEST  đích nhận = `reward_cred` (payment credential), không cred nào khác.
//     S-STK-NET   ÉP NET: (Σ out→đích − Σ in-từ-đích) ≥ Σ withdrawals. KHÔNG ép GROSS.
//     S-STK-SUM   ép theo Σ MỌI withdrawal của tx, không chỉ phần của account này.
//     S-STK-BOOK  đích là Script ⇒ kho phải được tiêu bằng `StakeRewardIn { amount }`
//                 với amount ≥ Σ withdrawals. NET thôi không phân biệt được "vào sổ" với
//                 "vào một UTxO không datum" hay "ké một Collect" — xem `reward_booked`.
//   publish — chứng nhận uỷ thác. ÉP:
//     S-STK-CERT-DEREG  `UnregisterCredential` → False, tuyệt đối.
//     S-STK-CERT-SIG    register/delegate đòi chữ ký `delegation_admin`.
//                       Mọi certificate khác → False (danh sách trắng, fail-closed).
//
// ─────────────────────────────────────────────────────────────────────────
// CHỖ KHÁC BẢN THAM CHIẾU `SRCL/onchain/validators/srcl_stake.ak` (nhánh
// feat/srcl-stake-port) VÀ VÌ SAO:
//   1. `did_hash` → `instance_id`. SRCL salt theo DID để đo thưởng per-DID; Treasury salt
//      theo instance để mỗi instance đa-thuê-bao có một reward-account riêng, đọc được
//      "instance này đã thu bao nhiêu thưởng" bằng một phép tra. Cùng cơ chế, khác đại
//      lượng — nên đổi tên chứ không giữ tên cũ.
//   2. `publish` SIẾT LẠI. SRCL cho register/delegate permissionless vì vốn gốc nằm ở
//      payment credential của chính người dùng — người dùng tự chịu nếu chọn pool tồi.
//      Kho Treasury giữ ADA của DAO: delegate permissionless ⇒ bất kỳ ai cũng trỏ toàn bộ
//      stake của kho sang pool của mình. Thưởng vẫn bị `withdraw` ép về đích, nhưng kẻ
//      tấn công ăn margin pool, và trỏ vào pool không sản xuất block thì kho mất sạch
//      thưởng với chi phí một phí tx. ⇒ đòi chữ ký `delegation_admin`.
//   3. Danh sách TRẮNG certificate thay cho `_ -> True`. SRCL để mở mọi cert ngoài
//      deregister; ở đây mọi cert không nằm trong ba dòng register/delegate đều bị từ
//      chối — stake credential của một cái kho không có vai DRep/stake-pool/uỷ ban.
//   4. Logic thuần tách sang `lib/magiclamp/treasury/stake.ak` theo đúng phong cách
//      `collect.ak`/`migrate.ak`/`release.ak` của kho này, để test đơn vị được.
//   GIỮ NGUYÊN không đổi: phép NET (`net_to_cred`), phép Σ mọi withdrawal
//   (`sum_withdrawals`), và lệnh cấm deregister — ba thứ này là phần đã trả giá của bản
//   tham chiếu, port nguyên văn về ngữ nghĩa.
//
// ─────────────────────────────────────────────────────────────────────────
// BA RÀNG BUỘC PHẢI KIỂM Ở BƯỚC GIEO (không kiểm được on-chain vì đều là hằng
// apply-time — một `expect` so hai hằng sẽ tốn ExUnit mỗi tx mà luôn cùng kết quả):
//   G1. `reward_cred` LÀ payment credential của chính kho custody — đường khuyến nghị kể
//       từ khi `custody.ak` có nhánh `StakeRewardIn`.
//       ⚠ ĐÃ ĐẢO so với bản đầu của tệp này. Bản đầu CẤM đích trùng kho, và lý do khi ấy
//       đúng: không nhánh spend nào đưa ADA vào kho ĐÚNG SỔ được, nên rót thưởng về địa
//       chỉ kho sinh ra một UTxO thứ hai không NFT, không datum — cả ba nhánh đều đòi đúng
//       1 UTxO mang NFT nên nó không tiêu lại được, tức rót đúng địa chỉ mà sai hình dạng =
//       đốt trá hình. `StakeRewardIn` là hình dạng ĐÚNG: nó ép Δ vào CHÍNH UTxO kho (C-STK-1
//       đúng 1 in + 1 out) và vào SỔ ở một hằng bucket dành riêng (C-STK-8), lovelace bằng
//       ĐẲNG THỨC (C-STK-7).
//       ⚠ Có nhánh ấy CHƯA đủ đóng lỗ — phải BẮT tx rút đi qua nó. NET đơn thuần vẫn thoả
//       khi Δ rót vào một UTxO không datum ở địa chỉ kho, hoặc khi withdrawal ké một
//       `Collect`/`MigrateIn` làm kho tăng ≥ Δ (thưởng rơi vào change người dựng tx). Nên
//       ràng HAI CHIỀU: S-STK-BOOK ở đây đòi kho được tiêu bằng `StakeRewardIn` với
//       amount ≥ Σ withdrawals; `custody.ak` ▸ C-STK-10 đòi `StakeRewardIn` đi kèm withdrawal
//       của chính stake credential kho, ĐÚNG BẰNG amount.
//       Hệ quả: `reward_cred` là Script thì PHẢI là kho custody — một script khác không có
//       redeemer `StakeRewardIn` nên mọi lượt rút bị từ chối (fail-closed, không mất tiền).
//       Đặt `reward_cred` ra một ví ngoài (VerificationKey) VẪN chạy, chỉ còn S-STK-NET giữ:
//       thưởng của DAO đi qua tay người vận hành, không cơ chế on-chain nào bắt nó quay về
//       kho, và bất kỳ tx nào vốn trả ví ấy ≥ Δ cũng ké được withdrawal.
//   G2. Người crank KHÔNG được dùng chính `reward_cred` làm ví trả phí. S-STK-NET trừ mọi
//       input đến từ đích, nên ví đích vừa trả phí vừa nhận change sẽ ra NET âm và tx bị
//       từ chối. Đây là REJECT, không phải mất tiền — nhưng phải biết trước.
//       Khi `reward_cred` == kho (G1), ràng buộc này được C-STK-1 lo hộ: tx chỉ được tiêu
//       ĐÚNG MỘT UTxO kho, và đó là UTxO đang nạp (S-STK-BOOK đòi chính UTxO ấy).
//   G3. `CustodyDatum.accepted_assets` PHẢI chứa ADA (`policy=#""`, `name=#""`) khi kho
//       dùng script stake credential. `custody.ak` ▸ C-STK-9 đòi điều đó mỗi lượt nạp, và
//       `accepted_assets` là BẤT BIẾN đời instance — không nhánh nào sửa được sau seed. Gieo
//       thiếu ⇒ `StakeRewardIn` bất khả thi vĩnh viễn ⇒ thưởng kẹt trong reward-account,
//       mà `reward_cred` cũng khoá cứng nên không có đích nào khác để rút về.

use cardano/address.{Credential}
use cardano/certificate.{Certificate}
use cardano/transaction.{Transaction}
use magiclamp/treasury/stake

/// Tham số apply-time:
///   instance_id      — salt per-instance (khớp `CustodyDatum.instance_id`) ⇒ mỗi instance
///                      một script hash ⇒ một reward-account riêng.
///   reward_cred      — ĐÍCH rút thưởng, khoá cứng. Xem G1 ở đầu tệp.
///   delegation_admin — khoá duy nhất được phép phát certificate register/delegate.
///
/// ⚠ Cả ba nướng vào script hash ⇒ nướng vào stake credential ⇒ nướng vào ĐỊA CHỈ kho.
/// Đổi bất kỳ tham số nào ⇒ địa chỉ kho đổi ⇒ phải dời toàn bộ tài sản, mà dời tài sản kho
/// chỉ đi được qua `Release` (cổng Governance). Chọn sai ở đây là sai ĐẮT.
validator treasury_stake(
  instance_id      : ByteArray,
  reward_cred      : Credential,
  delegation_admin : ByteArray,
) {
  withdraw(_redeemer: Data, account: Credential, self: Transaction) {
    // Salt phải thật — giữ tham số sống và chặn instance_id rỗng lúc apply.
    expect instance_id != #""

    stake.withdraw_ok(
      self.inputs,
      self.outputs,
      self.redeemers,
      self.withdrawals,
      account,
      reward_cred,
    )
  }

  publish(_redeemer: Data, certificate: Certificate, self: Transaction) {
    stake.certificate_ok(certificate, self.extra_signatories, delegation_admin)
  }

  else(_) {
    fail
  }
}
