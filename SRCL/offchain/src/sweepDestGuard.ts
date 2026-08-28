// sweepDestGuard — cổng gác `treasury_dest`, giá trị quyết định LAMP dư đi đâu khi pool đóng.
//
// VÌ SAO CÓ TỆP NÀY
//   `Sweep` là đường ra DUY NHẤT của `srcl_pool`: sau `end_epoch`, bất kỳ ai cũng gọi được, không
//   cần chữ ký admin (`srcl_pool.ak:202-211`). Chính vì không cần chữ ký nên nó là đường ra thật
//   chứ không phải đường ra trên giấy — nếu nó đòi đúng tập khoá đang nghi lộ thì nó vô dụng đúng
//   lúc cần đến.
//
//   Nhưng đường ra đó chỉ thật nếu ĐÍCH ĐẾN đúng. Hai cách hỏng, cả hai đều im lặng:
//
//   (1) ĐÍCH TRÙNG NGƯỜI GÁC. `treasury_dest` nằm dưới cùng tập khoá với `admin` ⇒ Sweep chuyển
//       tài sản từ một chỗ kẻ tấn công với tới được sang một chỗ **cũng** với tới được, chỉ chậm
//       hơn. Đường ra chỉ thật khi hai tập khoá RỜI nhau.
//
//   (2) SAI KIỂU HASH — nặng hơn, và là ca đã có thật trong cây. `srcl_pool.ak:210` gọi
//       `util.lamp_to_script(...)`, mà `util.is_at_script:23-27` chỉ khớp
//       `payment_credential == Script(h)`. Đưa vào một **khoá ví** (VerificationKey hash) thì
//       Sweep đòi trả LAMP tới `Script(<khoá ví>)` — một địa chỉ script KHÔNG CÓ TIỀN ẢNH.
//       Tx Sweep vẫn dựng được, vẫn lên chuỗi, vẫn "thành công". Nhưng LAMP hạ cánh ở một địa chỉ
//       không ai spend được, mãi mãi. Và LAMP không burn ⇒ không có đường dọn sổ.
//
//   Ca (2) là cùng một họ với `meter_nft_policy = 28 byte 0` đã giết nhánh ReserveDraw của bản mồi
//   mainnet: một giá trị **đúng hình dạng, sai tiền ảnh**, nướng vào chỗ không sửa được sau.
//
// KHÔNG chạm `process`/`console` và không phụ thuộc lucid — hàm thuần để test chạm được mọi nhánh.

/** Hậu quả, viết ra để thông điệp lỗi không phải một câu chung chung. */
export const CONSEQUENCE_SWEEP_DEST =
  "Sweep là đường ra DUY NHẤT của pool (srcl_pool.ak:202-211, sau end_epoch, không cần chữ ký). " +
  "Đích sai thì LAMP dư của cả chiến dịch rơi vào chỗ không ai lấy được, và LAMP không burn nên " +
  "không có đường dọn sổ làm lại.";

export interface SweepDestOptions {
  /** Danh sách pkh admin (apply-param của srcl_pool). */
  admin: string[];
  /**
   * true = giá trị này sắp được ghi vào datum on-chain. Datum ghi rồi thì `srcl_pool.ak:125,179`
   * ép `out_d.treasury_dest == d.treasury_dest` ở MỌI redeemer khác ⇒ không sửa được nữa.
   */
  willWrite: boolean;
  /**
   * Xác nhận rằng giá trị truyền vào là **script hash**, không phải khoá ví. Không suy ra được
   * từ 28 byte trần — chỉ người dựng mới biết. Bắt buộc khai, để nó là một lựa chọn có vết.
   */
  isScriptHash: boolean;
}

/**
 * ÉP `treasury_dest` hợp lệ trước khi ghi vào datum. Ném nếu:
 *   - không phải 28 byte hex, hoặc
 *   - trùng bất kỳ pkh admin nào (ca 1), hoặc
 *   - chưa ai khai đó là script hash (ca 2).
 */
export function assertSweepDest(dest: string, opts: SweepDestOptions): void {
  if (!/^[0-9a-fA-F]{56}$/.test(dest)) {
    throw new Error(
      `SWEEP-001: treasury_dest phải là 28 byte hex (56 ký tự), nhận '${dest}'. ` +
      CONSEQUENCE_SWEEP_DEST,
    );
  }
  const lower = dest.toLowerCase();
  const clash = opts.admin.filter((a) => a.toLowerCase() === lower);
  if (clash.length > 0) {
    throw new Error(
      `SWEEP-002: treasury_dest TRÙNG khoá admin (${clash.length} khớp). Sweep sẽ chuyển LAMP dư ` +
      `từ một chỗ người giữ khoá admin với tới được sang một chỗ CŨNG với tới được — không phải ` +
      `một đường ra. Đích phải nằm dưới tập khoá RỜI với admin. ` + CONSEQUENCE_SWEEP_DEST,
    );
  }
  if (!opts.willWrite) return;
  if (!opts.isScriptHash) {
    throw new Error(
      `SWEEP-003: chưa khai treasury_dest là SCRIPT hash. srcl_pool.ak:210 đòi output nằm ở ` +
      `Script(treasury_dest) (util.is_at_script:23-27 chỉ khớp payment_credential Script). ` +
      `Đưa vào một khoá ví thì Sweep đòi trả LAMP tới Script(<khoá ví>) — địa chỉ KHÔNG CÓ TIỀN ` +
      `ẢNH, tx vẫn lên chuỗi "thành công" mà LAMP thì không ai spend được nữa. ` +
      CONSEQUENCE_SWEEP_DEST,
    );
  }
}
