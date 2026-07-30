// verify_delegator.ts — kiểm hàng loạt đăng ký delegator (pot Delegator 100M LAMP).
//
// Ba lớp kiểm, FAIL-CLOSED (trượt bất kỳ lớp nào → LOẠI):
//   1. Chữ ký Ed25519 khớp message_hex + signing_pubkey.
//   2. pubkeyToStakeAddr(signing_pubkey) === stake_address khai báo (chống MẠO DANH:
//      kẻ khai stake_address nạn nhân + payment của mình).
//   3. Có LỊCH SỬ STAKE THẬT trên chain (≥1 epoch active stake > 0 qua Blockfrost).
//
// Dùng:
//   npx tsx verify_delegator.ts --reg <file|dir> [--out verified.json]
//   npx tsx verify_delegator.ts --reg delegator_registration.json
//   npx tsx verify_delegator.ts --reg ./registrations/   (thư mục nhiều file)
//
// Output: verified.json = MẢNG đăng ký hợp lệ (nạp thẳng cho build_delegator_snapshot.ts).
// Lớp 1–2 thuần crypto (offchain/src/delegatorSnapshot.verifyRegistration); lớp 3 gọi mạng.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bfAll, BLOCKFROST_KEY, NETWORK } from "./config.js";
import { verifyRegistration } from "../offchain/src/delegatorSnapshot.js";
import type { DelegatorRegistration, StakeHistoryRow } from "../offchain/src/delegatorSnapshot.js";
import { loadRegistrations } from "./registrations_io.js";

interface Args { regPath: string; outFile: string; skipChain: boolean; }

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let regPath = "";
  let outFile = resolve(process.cwd(), "delegator_registrations_verified.json");
  let skipChain = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--reg" && args[i + 1]) regPath = args[++i]!;
    else if ((a === "--out" || a === "-o") && args[i + 1]) outFile = resolve(process.cwd(), args[++i]!);
    else if (a === "--skip-chain") skipChain = true; // chỉ kiểm crypto (offline/CI)
    else if (a === "--help" || a === "-h") {
      console.log(`
Dùng: npx tsx verify_delegator.ts --reg <file|dir> [--out verified.json]

  --reg <path>     File JSON (mảng hoặc 1 đăng ký) hoặc thư mục *.json  [bắt buộc]
  --out, -o <f>    File đăng ký hợp lệ (mặc định delegator_registrations_verified.json)
  --skip-chain     BỎ lớp 3 (lịch sử stake trên chain) — chỉ kiểm crypto, offline/CI
`);
      process.exit(0);
    }
  }
  if (!regPath) { console.error("Bắt buộc: --reg <file|dir>. Chạy --help."); process.exit(1); }
  return { regPath, outFile, skipChain };
}

/** Lớp 3 — có lịch sử stake thật? (≥1 epoch active stake > 0). */
async function hasRealStakeHistory(stakeAddr: string): Promise<{ ok: boolean; epochs: number }> {
  const history = await bfAll<StakeHistoryRow>(`/accounts/${stakeAddr}/history`);
  const active = history.filter((h) => { try { return BigInt(h.amount) > 0n; } catch { return false; } });
  return { ok: active.length > 0, epochs: active.length };
}

function short(a: string): string {
  return a.length > 24 ? `${a.slice(0, 14)}…${a.slice(-6)}` : a;
}

async function main(): Promise<void> {
  const { regPath, outFile, skipChain } = parseArgs();
  if (!skipChain && !BLOCKFROST_KEY) {
    throw new Error("thiếu BLOCKFROST_KEY — cấu hình .env, hoặc dùng --skip-chain để chỉ kiểm crypto");
  }

  const loaded = loadRegistrations(regPath);
  console.log(`Network: ${NETWORK}`);
  console.log(`Đã nạp: ${loaded.length} đăng ký từ ${regPath}\n`);

  const verified: DelegatorRegistration[] = [];
  const rejected: { source: string; stake: string; reasons: string[] }[] = [];

  for (const { reg, source } of loaded) {
    const v = await verifyRegistration(reg);
    const reasons = [...v.reasons];

    if (v.ok && !skipChain) {
      const chain = await hasRealStakeHistory(reg.stake_address).catch((e) => {
        reasons.push(`không đọc được lịch sử stake: ${e instanceof Error ? e.message : e}`);
        return { ok: false, epochs: 0 };
      });
      if (!chain.ok) reasons.push("không có lịch sử stake thật (0 epoch active > 0)");
    }

    if (reasons.length === 0) {
      verified.push(reg);
      console.log(`  ✓ ${short(reg.stake_address)} → ${short(reg.payment_address)}`);
    } else {
      rejected.push({ source, stake: reg.stake_address, reasons });
      console.log(`  ✗ ${short(reg.stake_address)} [${source}] — ${reasons.join("; ")}`);
    }
  }

  console.log(`\n=== Kết quả ===`);
  console.log(`  Hợp lệ:  ${verified.length}`);
  console.log(`  Loại:    ${rejected.length}`);
  if (skipChain) console.log(`  (--skip-chain: BỎ lớp 3, chưa xác nhận lịch sử stake thật)`);

  await writeFile(outFile, JSON.stringify(verified, null, 2) + "\n", "utf8");
  console.log(`\nĐã ghi ${verified.length} đăng ký hợp lệ: ${outFile}`);
  console.log(`Bước tiếp: npx tsx build_delegator_snapshot.ts --reg ${outFile} --excluded <file>|--no-excluded`);
}

main().catch((e) => { console.error("LỖI:", e instanceof Error ? e.message : e); process.exit(1); });
