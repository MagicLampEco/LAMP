// SECRETS-001/002 — cổng phải phân biệt "biến CÓ ĐƯỢC ĐẶT" với "biến có GIÁ TRỊ THẬT".
//
// VÌ SAO BÀI NÀY TỒN TẠI
// Runbook viết dòng lệnh mẫu là `BLOCKFROST_KEY=… WALLET_SEED="…"`. Chuỗi `…` không rỗng,
// nên cổng bản trước — chỉ kiểm rỗng — cho qua. Lỗi nổ ở tận lần gọi mạng, dưới dạng một
// câu 403 đọc như "khoá sai" chứ không như "bạn chưa thay chỗ giữ chỗ".
//
// Đây đúng hình dạng mà `Forall §Cổng gác` gọi là đo SAI ĐẠI LƯỢNG: phép đo trả về giá trị
// hợp lệ đúng lúc nó không đo được điều cần đo, và màu xanh của nó đọc thành "ổn".
//
// Bài đo CẢ HAI CỰC. Chỉ kiểm "chỗ giữ chỗ bị chặn" thì một cổng chặn MỌI thứ cũng xanh —
// và một cổng như thế làm mọi lượt chạy thật đứng lại.
import { describe, it, expect } from "vitest";
import { isPlaceholder } from "../scripts/config.js";

describe("isPlaceholder — chặn chỗ giữ chỗ", () => {
  it.each([
    ["rỗng", ""],
    ["chỉ khoảng trắng", "   "],
    ["dấu chấm lửng U+2026", "…"],
    ["dấu chấm lửng có khoảng trắng", "  …  "],
    ["ba chấm ASCII", "..."],
    ["ngoặc nhọn", "<khoá của bạn>"],
    ["xxx", "xxxx"],
    ["TODO", "TODO"],
  ])("%s ⇒ là chỗ giữ chỗ", (_ten, v) => {
    expect(isPlaceholder(v)).toBe(true);
  });
});

describe("isPlaceholder — KHÔNG chặn giá trị thật", () => {
  // Cực đối. Thiếu khối này thì `isPlaceholder = () => true` cũng làm khối trên xanh trọn vẹn.
  it.each([
    ["khoá Blockfrost Preprod (hình dạng)", "preprod" + "a".repeat(25)],
    ["khoá Blockfrost Mainnet (hình dạng)", "mainnet" + "b".repeat(25)],
    ["private key bech32", "ed25519e_sk1" + "c".repeat(40)],
    ["mnemonic 24 từ", Array(24).fill("abandon").join(" ")],
    ["một ký tự", "k"],
    ["chuỗi có chứa dấu chấm lửng nhưng không phải chỗ giữ chỗ", "preprod…abc"],
    ["một dấu chấm", "."],
  ])("%s ⇒ KHÔNG phải chỗ giữ chỗ", (_ten, v) => {
    expect(isPlaceholder(v)).toBe(false);
  });
});
