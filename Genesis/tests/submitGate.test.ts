// Mọi runner Genesis gửi giao dịch phải có cổng SUBMIT ĐỨNG TRƯỚC lời gọi `.submit()` đầu tiên.
//
// Vì sao là một phép quét tĩnh chứ không phải bài chạy: runner gọi mạng thật, không dựng được
// trong bộ kiểm. Cái cần ghim là HÌNH DẠNG — trước 2026-09-26, năm runner (02, 03, 20b, 24, 25)
// gửi thật ngay khi chạy, và 24 là ba giao dịch one-shot bất khả hồi. Không gì báo điều đó, vì
// "không có cổng" trông y hệt "cổng ở chỗ khác".
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
// Ba dạng cổng đang có trong kho: `haltUnlessSubmit(…)`, `if (!SUBMIT) { … return }`, và
// `if (SUBMIT) { …submit… }` (01 bọc lời gửi trong nhánh).
const GATE = /haltUnlessSubmit\(|if \(!?SUBMIT\b/;

const all = readdirSync(scriptsDir).filter((f) => f.endsWith(".ts"));
// Tệp `_*` là thư viện dùng chung, không phải runner: chúng nhắc `.submit()` trong chú thích.
const runners = all.filter((f) => !f.startsWith("_"));
const senders = runners.filter((f) => readFileSync(join(scriptsDir, f), "utf8").includes(".submit()"));

describe("cổng SUBMIT đứng trước lời gửi đầu tiên", () => {
  it("vùng quét không rỗng, và khai được phần nằm ngoài", () => {
    expect(senders.length).toBeGreaterThan(0);
    expect(runners.length).toBeGreaterThanOrEqual(senders.length);
    expect(all.length - runners.length).toBeGreaterThan(0);   // tệp `_*` bị loại có chủ đích
  });

  it.each(senders)("%s", (f) => {
    const src = readFileSync(join(scriptsDir, f), "utf8");
    const firstSend = src.indexOf(".submit()");
    const m = GATE.exec(src.slice(0, firstSend));
    expect(m, `${f}: không có haltUnlessSubmit( / if (SUBMIT…) trước .submit() đầu tiên`).not.toBeNull();
  });
});
