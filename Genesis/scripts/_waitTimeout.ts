// _waitTimeout.ts — phân biệt "HẾT GIỜ CHỜ" với "HỎNG THẬT" ở các bước đã gửi giao dịch.
//
// VÌ SAO NÓ LÀ MỘT TỆP RIÊNG
// Vị từ này thuộc về `waitFor` trong `_canonical_v2.ts`. Nhưng tệp đó `import ./config.js`, mà
// `config.ts` NÉM ngay lúc import khi môi trường chưa dựng (`SECRETS-001`) — nên không bài kiểm
// nào import được nó, và một cổng không bài nào canh được là một cổng sẽ trôi. Tách ra đây để
// vị từ kiểm được ở mọi máy; `_canonical_v2.ts` xuất lại cho người gọi, nên chỗ gọi không đổi.
//
// VÌ SAO NÓ TỒN TẠI
// Sau khi giao dịch đã gửi, bước đối chiếu KHÔNG được ném — ném sau một thao tác bất khả hồi
// không cứu được gì, chỉ bỏ lại một cuốn sổ dở dang. Nhưng "không ném" rất dễ trượt thành "bọc
// trọn khối trong `catch` rồi gán mọi ngoại lệ vào nhãn chưa-đo-được", và đó là một cái vỏ im
// lặng: nó không nói "ổn", nó nói "tôi không biết" bằng giọng của "ổn".
//
// Ba trạng thái, không phải hai:
//   · đọc về ĐÚNG          → in kết quả, mã thoát 0
//   · KHÔNG ĐỌC ĐƯỢC      → hết giờ chờ chỉ mục nhà cung cấp; mã thoát 2, KHÔNG in "Xong"
//   · HỎNG THẬT           → mọi ngoại lệ khác; mã thoát 1, in ❌ kèm nguyên văn
//
// Trạng thái thứ hai và thứ ba trông giống nhau ở chỗ cả hai đều là một `throw` đi ra từ cùng
// một lời gọi, nhưng chúng đòi hai hành động khác nhau: một cái bảo "chạy lại phép đo", cái kia
// bảo "dừng, đừng chạy bước kế". Ít nhất hai ngoại lệ đi qua đây là thảm hoạ thật —
// `theOneHolding` ném khi tìm thấy HAI UTxO mang SUPPLY NFT (thread NFT nhân đôi ⇒ `dist_minted`
// về 0 ⇒ đúc lại trọn cap), và `.datum!` ném `TypeError` khi SupplyState quay về không có inline
// datum. Gộp chúng vào nhãn chưa-đo-được là dạy người đọc bỏ qua đúng dòng đáng dừng nhất.

/** Tiền tố của lỗi do `waitFor` phát ra khi hết số lượt chờ. Không dùng cho lỗi nào khác. */
export const WAIT_TIMEOUT_CODE = "WAIT-TIMEOUT-001";

/**
 * `true` CHỈ KHI lỗi là hết-giờ-chờ của `waitFor`.
 *
 * Cố ý so TIỀN TỐ chứ không so chuỗi con: một thông điệp lỗi khác vô tình nhắc tới mã này ở giữa
 * câu (ví dụ lỗi bọc lại, hoặc một dòng nhật ký được nối vào) sẽ bị đọc thành hết-giờ, và đó là
 * chiều hỏng sai — nó biến một lỗi HỎNG THẬT thành một cảnh báo nhẹ.
 */
export function isWaitTimeout(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith(`${WAIT_TIMEOUT_CODE}:`);
}

/** Dựng câu lỗi hết-giờ. Một chỗ sinh duy nhất, để tiền tố không bao giờ lệch với vị từ trên. */
export function waitTimeoutError(seconds: number, what: string): Error {
  return new Error(
    `${WAIT_TIMEOUT_CODE}: hết ${seconds}s chờ ${what}. Giao dịch có thể ĐÃ thành công trên chuỗi ` +
    `mà chỉ mục nhà cung cấp chưa bắt kịp — kiểm bằng 'npm run v2:verify' trước khi kết luận là hỏng.`,
  );
}
