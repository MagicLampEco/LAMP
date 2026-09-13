// _floorLabel.ts — nhãn xuất xứ của con số SÀN cổng cầu, dạng LIỆT KÊ ĐÓNG.
//
// VÌ SAO CÓ TỆP NÀY
//   `FLOOR_OILDROP` trong `_reserve_layer2.ts` là một giá trị DIỄN TẬP: 1.000 LAMP, chọn đủ nhỏ
//   để nạp qua sàn bằng một giao dịch nên kiểm được cả hai chiều. Con số mainnet là quyết định
//   của Treasury, không phải của tệp đó.
//
//   Trước đợt vá này, chữ "diễn tập" chỉ sống trong một chú thích và một dòng `console.log`.
//   Nó KHÔNG nằm trong tạo tác nào: `CanonicalState` không có trường cho nó, nên tệp trạng thái
//   ghi lại đường ống mà không ghi lại việc con số ấy là tạm. Bản thật sau này kế thừa con số
//   mà không kế thừa cái nhãn, và không có gì kêu — nhãn chết ở màn hình là nhãn không tồn tại.
//
// VÌ SAO LIỆT KÊ ĐÓNG, KHÔNG PHẢI CHUỖI TỰ DO
//   Chỗ tiêu thụ (verify, bước phát hành sau) phải KHÔNG THỂ nhận một giá trị ngoài dự kiến mà
//   vẫn chạy tiếp. Một chuỗi tự do thì `"demo "`, `"Demo"`, `"prod"`, `""` đều đi lọt và mỗi
//   chỗ đọc tự diễn giải một kiểu; một liệt kê đóng biến cùng đám đó thành một lỗi đọc được.
//   Cố ý KHÔNG chuẩn hoá hoa/thường và KHÔNG cắt khoảng trắng: nhãn này do MÃ đặt, không do
//   người gõ, nên mọi biến thể đều là dấu hiệu một nguồn thứ hai đã mọc ra.

/** Toàn bộ giá trị hợp lệ của nhãn xuất xứ. Thêm một giá trị ở đây là một quyết định, không phải một lần gõ. */
export const FLOOR_SOURCES = ["demo", "production"] as const;

/** Nhãn xuất xứ con số sàn: `"demo"` = giá trị diễn tập · `"production"` = giá trị Treasury đã chốt. */
export type FloorSource = (typeof FLOOR_SOURCES)[number];

/**
 * Ép một giá trị đọc từ tạo tác (tệp trạng thái, biến môi trường) về đúng liệt kê đóng.
 *
 * Ném `FLOOR-LABEL-001` cho MỌI thứ khác, kể cả `undefined` — thiếu nhãn không phải là
 * "chắc là bản thật", nó là trạng thái mù, và trạng thái mù ở đây trỏ vào một con số sàn
 * quyết định khi nào cổng cầu mở.
 */
export function parseFloorSource(v: unknown, nhan = "floorSource"): FloorSource {
  if (typeof v === "string" && (FLOOR_SOURCES as readonly string[]).includes(v)) {
    return v as FloorSource;
  }
  throw new Error(
    `FLOOR-LABEL-001: ${nhan} = ${JSON.stringify(v)} — không thuộc liệt kê đóng ` +
      `[${FLOOR_SOURCES.join(", ")}]. Nhãn này nói con số SÀN của cổng cầu là giá trị diễn tập ` +
      `hay giá trị Treasury đã chốt. Thiếu nhãn KHÔNG được đọc thành "bản thật": bản thật kế ` +
      `thừa con số mà không kế thừa chữ "demo" chính là cách một giá trị diễn tập đi lên mạng ` +
      `thật mà không có gì kêu.`,
  );
}

/**
 * Câu cảnh báo đi kèm một nhãn, hoặc `undefined` khi không có gì phải cảnh báo.
 *
 * Tách khỏi `parseFloorSource` vì hai việc khác nhau: đọc nhãn là chuyện hình dạng, cảnh báo
 * là chuyện vận hành. Gộp lại thì chỗ nào chỉ cần đọc cũng phải nuốt một câu cảnh báo.
 */
export function floorSourceWarning(s: FloorSource): string | undefined {
  return s === "demo"
    ? `sàn cổng cầu đang là GIÁ TRỊ DIỄN TẬP ("demo"). Con số mainnet là quyết định của ` +
        `Treasury — phải thay trước lượt đúc bản thật, và nhãn này phải đổi cùng lúc.`
    : undefined;
}
