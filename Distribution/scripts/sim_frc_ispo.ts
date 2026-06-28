// Simulation FRC-ISPO profile (Preview-shaped) — KHÔNG submit on-chain, chỉ chạy
// đúng TOÁN PHÂN BỔ engine sẽ chạy (apportion Hamilton, bit-identical attribution.ts).
//
// Giả định (anh Aladin):
//   • Pot 3000 tLAMP, nhả 1000 tLAMP mỗi epoch trong 3 epoch.
//   • 10 người chơi đóng góp tADA staking reward KHÁC NHAU mỗi epoch (ký 1 lần, auto mỗi epoch).
//   • Mỗi epoch: 1000 tLAMP chia ∝ tADA reward đóng góp epoch đó. tADA → địa chỉ GST.
//
// Chạy: npx tsx sim_frc_ispo.ts

import { apportion } from "../ETD/offchain/src/attribution.js";

const OIL = 1_000_000n;            // 1 tLAMP = 1e6 oildrop
const ADA = 1_000_000n;           // 1 tADA = 1e6 lovelace
const POT_PER_EPOCH = 1000n * OIL; // 1000 tLAMP / epoch

// tADA reward (lovelace) mỗi người mỗi epoch. 0 = epoch đó không đóng (vào/ra linh hoạt).
// Người 1..10. Tỉ lệ khác nhau + biến động giữa các epoch (reward đổi theo stake từng epoch).
const P = ["P1","P2","P3","P4","P5","P6","P7","P8","P9","P10"];
const ada = (x: number) => BigInt(Math.round(x * 1e6)); // tADA -> lovelace
const EPOCHS: bigint[][] = [
  // epoch 550: tADA reward từng người
  [ada(10), ada(20), ada(5),  ada(15), ada(8),  ada(12), ada(25), ada(3),  ada(18), ada(7)],
  // epoch 551: P4 tạm dừng (0), vài người tăng/giảm
  [ada(12), ada(18), ada(6),  ada(0),  ada(10), ada(14), ada(22), ada(5),  ada(20), ada(9)],
  // epoch 552: P2 rút (0), P4 quay lại
  [ada(11), ada(0),  ada(8),  ada(15), ada(9),  ada(13), ada(24), ada(4),  ada(19), ada(8)],
];
const EPOCH_LABELS = [550n, 551n, 552n];

const fmtLamp = (oil: bigint) => {
  const w = oil / OIL, f = oil % OIL;
  const s = w.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return f === 0n ? s : `${s},${f.toString().padStart(6,"0").replace(/0+$/,"")}`;
};
const fmtAda = (lov: bigint) => {
  const w = lov / ADA, f = lov % ADA;
  const s = w.toString();
  return f === 0n ? s : `${s},${f.toString().padStart(6,"0").replace(/0+$/,"")}`;
};
const pad = (s: string, n: number) => s.length>=n ? s : " ".repeat(n-s.length)+s;

const totalLamp = new Array<bigint>(P.length).fill(0n);
let gstTotal = 0n;
let potCheck = 0n;

for (let e = 0; e < EPOCHS.length; e++) {
  const contrib = EPOCHS[e]!;
  const epochTotalAda = contrib.reduce((s,v)=>s+v, 0n);
  const lampShares = apportion(POT_PER_EPOCH, contrib); // ∝ tADA, Hamilton, Σ=1000 tLAMP
  gstTotal += epochTotalAda;
  potCheck += lampShares.reduce((s,v)=>s+v,0n);

  console.log(`\n══ EPOCH ${EPOCH_LABELS[e]} ══  GST nhận: ${fmtAda(epochTotalAda)} tADA   |   nhả ${fmtLamp(POT_PER_EPOCH)} tLAMP`);
  console.log(`   ${pad("Người",6)} │ ${pad("tADA đóng",11)} │ ${pad("Tỷ lệ",7)} │ ${pad("tLAMP nhận",12)}`);
  for (let i = 0; i < P.length; i++) {
    totalLamp[i]! += lampShares[i]!;
    const pctNum = epochTotalAda === 0n ? 0 : Number((contrib[i]! * 10000n)/epochTotalAda)/100;
    console.log(`   ${pad(P[i]!,6)} │ ${pad(fmtAda(contrib[i]!),11)} │ ${pad(pctNum.toFixed(2)+"%",7)} │ ${pad(fmtLamp(lampShares[i]!),12)}`);
  }
}

console.log(`\n══════════ TỔNG KẾT 3 EPOCH ══════════`);
console.log(`   ${pad("Người",6)} │ ${pad("Σ tLAMP nhận",14)}`);
let sumAll = 0n;
for (let i = 0; i < P.length; i++) {
  sumAll += totalLamp[i]!;
  console.log(`   ${pad(P[i]!,6)} │ ${pad(fmtLamp(totalLamp[i]!),14)}`);
}
console.log(`   ${"─".repeat(6)}─┼─${"─".repeat(14)}`);
console.log(`   ${pad("Σ",6)} │ ${pad(fmtLamp(sumAll),14)} tLAMP`);
console.log(`\n   GST nhận tổng:     ${fmtAda(gstTotal)} tADA (qua 3 epoch)`);
console.log(`   Bảo toàn pot:      Σ tLAMP = ${fmtLamp(potCheck)} == 3.000 (${potCheck === 3000n*OIL ? "ĐÚNG ✓" : "SAI ✗"})`);
console.log(`   Ký 1 lần → 3 epoch auto-phân-bổ; tỉ lệ tính lại mỗi epoch theo tADA đóng góp.\n`);
