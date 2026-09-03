// verify_canonical_v2.ts — ĐỌC-KHÔNG-GHI. Đối chiếu policy canonical mới với chuỗi.
//
// Không dựng giao dịch nào, không ký gì. Dùng được bất cứ lúc nào, kể cả sau khi máy khác
// chạy các bước 20-23: mọi số đọc từ chuỗi, `canonical-v2-state.json` chỉ dùng để biết
// `genesis_ref` — từ đó dựng lại toàn bộ policy-id rồi SO với state (`rehydrate()` ném nếu lệch).
//
// Chạy: NETWORK=Preprod tsx verify_canonical_v2.ts
import { NETWORK, makeLucid } from "./config.js";
import { supplyStateFromCbor } from "../offchain/src/datum.js";
import { rehydrate, printWiring } from "./_canonical_v2.js";

const OIL = 1_000_000n;
const vn = (n: bigint) => n.toLocaleString("vi-VN");

async function main(): Promise<void> {
  const lucid = await makeLucid();
  const { state, wiring } = await rehydrate();

  console.log(`=== Đối chiếu policy canonical v2 (${NETWORK}) ===\n`);
  printWiring(wiring);

  let bad = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? "✓" : "✗"} ${msg}`);
    if (!ok) bad++;
  };

  // ── Marker: mỗi cái đúng 1 bản, đúng chỗ ─────────────────────────────────
  console.log("\n── Marker one-shot ──");
  const atSs   = await lucid.utxosAt(wiring.ssAddr);
  const atTre  = await lucid.utxosAt(wiring.treAddr);
  const atBcn  = await lucid.utxosAt(wiring.beaconAddr);
  const atWlt  = await lucid.wallet().getUtxos();
  const count = (us: { assets: Record<string, bigint> }[], u: string) =>
    us.reduce((s, x) => s + (x.assets[u] ?? 0n), 0n);

  check(count(atSs,  wiring.threadUnit) === 1n, `SUPPLY NFT: 1 bản tại supply_state`);
  check(count(atTre, wiring.khoUnit)    === 1n, `TRSY NFT:   1 bản tại KHO (treasury.ak)`);
  check(count(atBcn, wiring.markers.beaconPid + "44524f50") === 1n, `DROP NFT:   1 bản tại beacon`);
  // REG phải ở `Script(regPid)`, không phải ở ví: `registry.ak::find_registry_datum` lọc theo
  // NFT **và** theo `payment_credential == Script(policy)`. Ở ví thì cổng WHO đóng câm.
  const atReg = await lucid.utxosAt(wiring.regAddr);
  check(count(atReg, wiring.regUnit)    === 1n, `REG NFT:    1 bản tại Script(regPid) — cổng WHO đọc được`);
  check(count(atWlt, wiring.metUnit)    === 1n, `MET NFT:    1 bản (ví — Lớp 2 sẽ đưa xuống reserve_draw)`);

  // ── SupplyState ──────────────────────────────────────────────────────────
  console.log("\n── SupplyState on-chain ──");
  const ssU = atSs.find((u) => (u.assets[wiring.threadUnit] ?? 0n) === 1n);
  if (!ssU?.datum) {
    console.log("✗ không đọc được SupplyState — dừng phần số.");
    process.exit(1);
  }
  const s = supplyStateFromCbor(ssU.datum);
  console.log(`dist_minted    = ${vn(s.dist_minted / OIL)} LAMP`);
  console.log(`reserve_minted = ${vn(s.reserve_minted / OIL)} LAMP`);
  console.log(`dist_cap       = ${vn(s.dist_cap / OIL)} LAMP`);
  console.log(`reserve_cap    = ${vn(s.reserve_cap / OIL)} LAMP`);
  check(s.dist_cap + s.reserve_cap === 36_000_000_000n * OIL,
    `TỔNG CAP = ${vn((s.dist_cap + s.reserve_cap) / OIL)} LAMP (mong đợi 36 tỷ)`);
  check(s.dist_minted.toString() === state.minted.dist,
    `dist_minted khớp state file (${state.minted.dist})`);
  check(s.reserve_minted.toString() === state.minted.reserve,
    `reserve_minted khớp state file (${state.minted.reserve})`);

  // ── KHO ──────────────────────────────────────────────────────────────────
  console.log("\n── KHO A-DEST ──");
  const khoLamp = count(atTre, wiring.lampUnit);
  console.log(`KHO giữ ${vn(khoLamp / OIL)} LAMP trên ${atTre.length} UTxO`);
  check(khoLamp >= s.dist_minted,
    `mọi LAMP đường Distribution đều nằm trong kho (${vn(khoLamp / OIL)} ≥ ${vn(s.dist_minted / OIL)})`);

  // ── Hai điều khác mainnet, nói bằng số ───────────────────────────────────
  console.log("\n── Khác policy mồi mainnet ở đâu ──");
  const reserveReachable = s.reserve_minted > 0n;
  check(reserveReachable,
    reserveReachable
      ? `nhánh ReserveDraw ĐÃ chạy thật (${vn(s.reserve_minted / OIL)} LAMP) — trần thật = 36 tỷ`
      : `nhánh ReserveDraw CHƯA chạy (chạy 22_reserve_draw.ts). Chưa chạy thì chưa có bằng chứng ` +
        `nó khác policy mồi mainnet, nơi trần thật chỉ là 26,37 tỷ (deployed.ts:118-119)`);
  const proof = state.oneshotProof;
  check(proof?.blocked === true,
    proof
      ? `bằng chứng one-shot: đúc marker lượt hai BỊ CHẶN (${proof.attemptedAt})`
      : `chưa có bằng chứng one-shot — chạy 23_prove_oneshot.ts (mục C đòi bằng chứng RIÊNG)`);

  console.log(
    bad === 0
      ? "\n✅ Toàn bộ mục đối chiếu xanh."
      : `\n⚠ ${bad} mục chưa xanh — xem dấu ✗ ở trên.`,
  );
  if (bad > 0) process.exit(1);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
