// Vitest — asset name off-chain phải KHỚP asset name on-chain ép, đọc thẳng từ `util.ak`.
//
// VÌ SAO BỘ KIỂM NÀY TỒN TẠI: `constants.ts` khai "PHẢI khớp onchain util.treasury_nft_name" —
// một câu chú thích, không phải cơ chế. Hai giá trị này đi vào hai nửa của cùng một phép so:
// `treasury_nft.ak` chỉ đúc được đúng tên `util.treasury_nft_name()`, còn `lamp_mint` khe #9-10
// (A-DEST) nướng tên lấy từ `TREASURY_NFT_ASSET_NAME` (qua `Genesis/scripts/_canonical_v2.ts`).
// Lệch một byte thì A-DEST trỏ vào một NFT không bao giờ tồn tại ⇒ nhánh DistributionVest chết
// vĩnh viễn, và cả hai phía vẫn biên dịch, vẫn xanh.
//
// Đọc MÃ NGUỒN `.ak`, không đọc blueprint: hằng trong thân hàm không hiện ra ở `plutus.json`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TREASURY_NFT_ASSET_NAME, DROP_ASSET_NAME } from "../offchain/src/constants.js";

const UTIL_AK = resolve(process.cwd(), "../onchain/lib/magiclamp/lampdist/util.ak");
const src = readFileSync(UTIL_AK, "utf8");

/** Hex trả về bởi thân hàm — đúng MỘT literal, không thì ném (hàm đổi hình dạng ⇒ bài phải sửa). */
function hexOf(pattern: RegExp, label: string): string {
  const m = [...src.matchAll(pattern)];
  expect(m.length, `${label}: cần đúng một literal trong util.ak, thấy ${m.length}`).toBe(1);
  return m[0][1];
}

describe("asset name — một nguồn on-chain, off-chain phải khớp", () => {
  it("TREASURY_NFT_ASSET_NAME == util.treasury_nft_name()", () => {
    const onchain = hexOf(
      /pub fn treasury_nft_name\(\)\s*->\s*AssetName\s*\{\s*#"([0-9a-f]+)"/g,
      "treasury_nft_name",
    );
    expect(TREASURY_NFT_ASSET_NAME).toBe(onchain);
  });

  it("DROP_ASSET_NAME == util.beacon_name(DropParam)", () => {
    const onchain = hexOf(/DropParam\s*->\s*#"([0-9a-f]+)"/g, "beacon_name(DropParam)");
    expect(DROP_ASSET_NAME).toBe(onchain);
  });
});
