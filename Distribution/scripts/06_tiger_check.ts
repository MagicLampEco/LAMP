// LampDistribution/scripts/06_tiger_check.ts — CÔNG CỤ DELEGATOR TỰ KIỂM ETD.
//
// Delegator nhập ĐỊA CHỈ VÍ → công cụ in bảng LAMP nhận được MỖI EPOCH suốt lịch sử
// delegate TIGER (mỗi epoch: tổng pot LAMP epoch đó + phần mình) + TỔNG entitlement.
// Tất định, chỉ cần snapshot công khai — KHÔNG cần tin operator (tự dựng lại số liệu).
//
// Chạy:
//   npx tsx 06_tiger_check.ts <addr_test1...> --snapshot ./tiger-snapshot.json
//   npx tsx 06_tiger_check.ts --pkh <pkh_hex>  --snapshot ./tiger-snapshot.json
//   thêm --json   → in JSON (cho UI tái dùng)
//   thêm --verify → đối chiếu ĐỘC LẬP stake của mình với Blockfrost /accounts/{stake}/history
//
// Snapshot công khai dựng bằng build_tiger_snapshot.ts (operator). Định dạng = ETD
// PublishedSnapshot (snapshot-io.ts). Giải mã địa chỉ OFFLINE (getAddressDetails).

import { readFileSync } from "node:fs";
import { getAddressDetails, credentialToRewardAddress } from "@lucid-evolution/lucid";
import { NETWORK, BLOCKFROST_URL, BLOCKFROST_KEY } from "./config.js";
import {
  parseSnapshot,
  ownerBreakdown,
  attributionContext,
  type PublishedSnapshot,
} from "../ETD/offchain/src/index.js";

const OIL_PER_LAMP = 1_000_000n;

// ── parse args ────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const wantJson = argv.includes("--json");
const wantVerify = argv.includes("--verify");
const snapshotPath = flag("--snapshot") ?? process.env.TIGER_SNAPSHOT;
const pkhArg = flag("--pkh");
const addrArg = argv.find((a) => !a.startsWith("--") && (a.startsWith("addr") || a.startsWith("stake")));

if (!snapshotPath) {
  console.error("Thiếu --snapshot <đường-dẫn.json> (hoặc đặt TIGER_SNAPSHOT).");
  process.exit(1);
}
if (!pkhArg && !addrArg) {
  console.error("Thiếu địa chỉ ví <addr_test1...> hoặc --pkh <hex>.");
  process.exit(1);
}

// ── resolve owner pkh (+ stake addr) từ địa chỉ — OFFLINE ──────
let ownerPkh: string;
let stakeAddress: string | undefined;
if (pkhArg) {
  ownerPkh = (pkhArg.startsWith("0x") ? pkhArg.slice(2) : pkhArg).toLowerCase();
  if (!/^[0-9a-f]{56}$/.test(ownerPkh)) {
    console.error(`--pkh không hợp lệ (cần 28-byte hex): ${pkhArg}`);
    process.exit(1);
  }
} else {
  const det = getAddressDetails(addrArg!);
  if (!det.paymentCredential) {
    console.error("Không lấy được payment-credential từ địa chỉ (địa chỉ enterprise/script?).");
    process.exit(1);
  }
  ownerPkh = det.paymentCredential.hash.toLowerCase();
  // stake address (stake1…) để tự-kiểm Blockfrost — derive từ stake credential.
  stakeAddress = det.stakeCredential
    ? credentialToRewardAddress(NETWORK, det.stakeCredential)
    : undefined;
}

// ── load + parse snapshot ─────────────────────────────────────
const snap = JSON.parse(readFileSync(snapshotPath, "utf8")) as PublishedSnapshot;
const p = parseSnapshot(snap);
const ctx = attributionContext(p.snapshots, p.params, p.epochs);
const bd = ownerBreakdown(p.snapshots, ownerPkh, p.params, p.epochs);

// ── format helpers ────────────────────────────────────────────
const fmtLamp = (oil: bigint): string => {
  const lamp = oil / OIL_PER_LAMP;
  const frac = oil % OIL_PER_LAMP;
  const intStr = lamp.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac === 0n ? intStr : `${intStr},${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
};
const fmtAda = (lovelace: bigint): string =>
  (lovelace / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const pct = (num: bigint, den: bigint): string =>
  den === 0n ? "0%" : `${(Number((num * 10000n) / den) / 100).toFixed(2)}%`;

// ── JSON mode (cho UI) ────────────────────────────────────────
if (wantJson) {
  console.log(JSON.stringify({
    pot: snap.pot,
    network: snap.network,
    owner: ownerPkh,
    stakeAddress,
    found: bd.found,
    budgetLamp: snap.budgetLamp,
    distributedOil: ctx.distributedOil.toString(),
    accStake: bd.accStake.toString(),
    capped: bd.capped,
    entitlementOil: bd.entitlementOil.toString(),
    entitlementLamp: fmtLamp(bd.entitlementOil),
    epochs: bd.epochs.map((e) => ({
      epoch: e.epoch.toString(),
      ownerStakeLovelace: e.ownerStake.toString(),
      totalStakeLovelace: e.totalStake.toString(),
      potOil: e.potOil.toString(),
      ownerShareOil: e.ownerShareOil.toString(),
      cumulativeOil: e.cumulativeOil.toString(),
    })),
  }, null, 2));
  process.exit(0);
}

// ── bảng người-đọc ────────────────────────────────────────────
console.log(`\n  POT: ${snap.pot}  (${snap.network})`);
console.log(`  Ngân sách pot: ${fmtLamp(ctx.budgetOil)} LAMP · đã phân bổ ${fmtLamp(ctx.distributedOil)} · leftover ${fmtLamp(ctx.leftoverOil)}`);
console.log(`  Ví (payment pkh): ${ownerPkh}`);
if (stakeAddress) console.log(`  Stake address:    ${stakeAddress}`);
console.log("");

if (!bd.found) {
  console.log("  ⚠ Ví này KHÔNG có trong snapshot (không delegate trước cutoff, stake 0, hoặc bị loại self-dealing).");
  console.log(`  → Entitlement: 0 LAMP\n`);
  process.exit(0);
}

console.log(`  Stake tích lũy: ${bd.accStake.toString()} lovelace·epoch  ·  cap chạm trần: ${bd.capped ? "CÓ" : "không"}`);
console.log("");
const H = "  ┌────────┬──────────────────┬──────────────────┬─────────┬────────────────────┬────────────────────┐";
const M = "  ├────────┼──────────────────┼──────────────────┼─────────┼────────────────────┼────────────────────┤";
const B = "  └────────┴──────────────────┴──────────────────┴─────────┴────────────────────┴────────────────────┘";
const pad = (s: string, n: number): string => s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
const padL = (s: string, n: number): string => s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s;
console.log(H);
console.log(`  │ ${pad("Epoch", 6)} │ ${pad("Stake mình (ADA)", 16)} │ ${pad("Tổng stake (ADA)", 16)} │ ${pad("Tỷ lệ", 7)} │ ${pad("Pot epoch (LAMP)", 18)} │ ${pad("Mình nhận (LAMP)", 18)} │`);
console.log(M);
for (const e of bd.epochs) {
  console.log(
    `  │ ${padL(e.epoch.toString(), 6)} │ ${padL(fmtAda(e.ownerStake), 16)} │ ${padL(fmtAda(e.totalStake), 16)} │ ${padL(pct(e.ownerStake, e.totalStake), 7)} │ ${padL(fmtLamp(e.potOil), 18)} │ ${padL(fmtLamp(e.ownerShareOil), 18)} │`,
  );
}
console.log(B);
console.log(`\n  ➤ TỔNG entitlement (cộng mọi epoch): ${fmtLamp(bd.entitlementOil)} LAMP`);
console.log(`     (Σ cột "Mình nhận" == TỔNG — bảo toàn tuyệt đối; số này KHỚP số redeem on-chain.)`);
console.log(`     Nhả dần kiểu B qua ${p.dripEpochs} epoch từ cliff epoch ${p.cliffEpoch}.\n`);

// ── tùy chọn: tự-kiểm độc lập với Blockfrost ──────────────────
if (wantVerify) {
  if (!stakeAddress) {
    console.log("  --verify cần địa chỉ có stake credential (bỏ qua với --pkh).\n");
    process.exit(0);
  }
  if (!BLOCKFROST_KEY) {
    console.log("  --verify cần BLOCKFROST_KEY trong .env (bỏ qua).\n");
    process.exit(0);
  }
  console.log("  ⟳ Đối chiếu ĐỘC LẬP stake từng epoch với Blockfrost…");
  const res = await fetch(`${BLOCKFROST_URL}/accounts/${stakeAddress}/history?count=100`, {
    headers: { project_id: BLOCKFROST_KEY },
  });
  if (!res.ok) {
    console.log(`  Blockfrost lỗi ${res.status} — bỏ qua đối chiếu.\n`);
    process.exit(0);
  }
  const hist = (await res.json()) as { active_epoch: number; amount: string; pool_id: string }[];
  const byEpoch = new Map<bigint, bigint>();
  for (const h of hist) byEpoch.set(BigInt(h.active_epoch), BigInt(h.amount));
  let ok = true;
  for (const e of bd.epochs) {
    const chain = byEpoch.get(e.epoch);
    const match = chain !== undefined && chain === e.ownerStake;
    if (!match) ok = false;
    console.log(`    epoch ${e.epoch}: snapshot ${fmtAda(e.ownerStake)} ADA  vs  chain ${chain !== undefined ? fmtAda(chain) + " ADA" : "—"}  ${match ? "✓" : "✗"}`);
  }
  console.log(ok ? "  ✓ Snapshot KHỚP on-chain hoàn toàn.\n" : "  ⚠ Có epoch lệch — kiểm tra pool_id/cutoff hoặc snapshot.\n");
}
