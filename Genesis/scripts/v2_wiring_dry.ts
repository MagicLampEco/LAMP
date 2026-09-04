// v2_wiring_dry.ts — Tính wiring policy canonical v2 KHÔNG CHẠM MẠNG, KHÔNG CẦN VÍ.
//
// Vì sao cần một bước khô: mọi tham số của `lamp_mint` bị nướng vào policy-id, nên lượt đầu
// tiên chạm chuỗi đã là lượt cuối cùng sửa được. Bước này cho phép soi TRỌN bộ policy-id /
// script-hash / địa chỉ trước khi tiêu một UTxO nào — và soi được trên máy không có khoá,
// không có tADA, không có Blockfrost.
//
// Nó cũng chính là thứ chạy được trong CI: cổng APPLY-001/002 (`config.ts::assertParamCount`)
// tra blueprint và ném nếu số tham số truyền vào không khớp bản khai. Sai thứ tự hay thiếu
// một tham số KHÔNG báo lỗi ở `applyParamsToScript` — nó ra một policy-id khác, im lặng.
// Chạy tệp này sau mỗi lần `aiken build` là bắt được chuyện đó ngay.
//
// Chạy:
//   NETWORK=Preprod tsx v2_wiring_dry.ts
//   NETWORK=Preprod DRY_GENESIS_TX=<64 hex> DRY_GENESIS_IDX=0 DRY_PKH=<56 hex> tsx v2_wiring_dry.ts
import { NETWORK, TOKEN_NAME } from "./config.js";
import { deriveWiring, printWiring } from "./_canonical_v2.js";

/** Giá trị mẫu — CHỈ để xem hình dạng wiring. Không phải hạt giống thật của lượt nào. */
const SAMPLE_TX  = "0".repeat(63) + "1";
const SAMPLE_PKH = "0".repeat(55) + "1";

function hex(name: string, fallback: string, chars: number): string {
  const v = (process.env[name] ?? fallback).trim().toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${chars}}$`).test(v)) {
    throw new Error(`${name} phải là ${chars} ký tự hex; nhận "${v}".`);
  }
  return v;
}

async function main(): Promise<void> {
  const genesisTxHash = hex("DRY_GENESIS_TX", SAMPLE_TX, 64);
  const pkh = hex("DRY_PKH", SAMPLE_PKH, 56);
  const genesisIndex = Number(process.env.DRY_GENESIS_IDX ?? "0");
  const sample = genesisTxHash === SAMPLE_TX || pkh === SAMPLE_PKH;

  console.log(`=== Wiring canonical v2 — KHÔ (${NETWORK}) ===`);
  if (sample) {
    console.log("⚠ đang dùng GIÁ TRỊ MẪU cho hạt giống/pkh. Mọi policy-id dưới đây chỉ để xem");
    console.log("  hình dạng — KHÔNG phải policy của lượt nào. Truyền DRY_GENESIS_TX/DRY_PKH");
    console.log("  để tính đúng lượt thật.");
  }
  console.log();

  const { wiring } = await deriveWiring({ genesisTxHash, genesisIndex, pkh, tokenName: TOKEN_NAME });
  printWiring(wiring);

  // Năm marker phải ra NĂM policy-id khác nhau. Trùng nhau nghĩa là một tham số bị bỏ sót
  // lúc apply (asset_name không vào được bytecode) — và lúc đó "bốn NFT" thật ra là một.
  const pids = Object.entries(wiring.markers);
  const dup = pids.filter(([, v], i) => pids.findIndex(([, w]) => w === v) !== i);
  if (dup.length) {
    throw new Error(`marker trùng policy-id: ${dup.map(([k]) => k).join(", ")} — apply-param sót tham số.`);
  }
  console.log(`\n✓ ${pids.length} marker ra ${pids.length} policy-id khác nhau.`);
  console.log("✓ cổng APPLY-001/002 không kêu ⇒ số tham số truyền vào khớp blueprint.");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
