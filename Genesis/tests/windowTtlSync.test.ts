// Trần TTL của validity range có BỐN bản chép ở bốn gói — gói nào cũng không import được gói kia
// (ranh giới `rootDir` / không phụ thuộc chéo), nên chúng là bản chép có nhãn "PHẢI khớp".
// Chú thích không tự kêu khi lệch; bài này kêu. Nguồn: `Genesis/scripts/_epochWindow.ts`.
//
// Vì sao đáng một bài riêng: một bản TTL lệch lên quá chân trời dự báo của node (~1,5 ngày)
// là đúng lỗi PastHorizon mà cả bốn bản sinh ra để chặn, và nó chỉ lộ khi gửi tx thật.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WINDOW_TTL_MS } from "../scripts/_epochWindow.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Đọc giá trị số của `export const <name> = <số>[n];` — không thấy thì NÉM, không trả mặc định. */
function readConst(relPath: string, name: string): number {
  const src = readFileSync(resolve(ROOT, relPath), "utf8");
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*([0-9_]+)n?\\s*;`));
  if (!m) throw new Error(`không tìm thấy \`export const ${name}\` trong ${relPath}`);
  return Number(m[1]!.replace(/_/g, ""));
}

describe("WINDOW_TTL_MS — các bản chép khớp nguồn", () => {
  it.each([
    ["Distribution/offchain/src/constants.ts", "WINDOW_TTL_MS"],
    ["Treasury/offchain/src/collectBuilder.ts", "VALID_TTL_MS"],
    ["Faucet/offchain/src/epochWindow.ts", "WINDOW_TTL_MS"],
  ])("%s ▸ %s", (relPath, name) => {
    expect(readConst(relPath, name)).toBe(WINDOW_TTL_MS);
  });

  it("nguồn nằm dưới chân trời dự báo với biên rộng (≤ 24 giờ)", () => {
    expect(WINDOW_TTL_MS).toBeGreaterThan(0);
    expect(WINDOW_TTL_MS).toBeLessThanOrEqual(24 * 3_600_000);
  });
});
