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
import { deriveReserveWiring, printReserveWiring } from "./_reserve_layer2.js";
import { reserveStateFromCbor } from "../../Reserve/offchain/src/datum.js";
import { parkedOf } from "../../Treasury/offchain/src/reserveGateBuilder.js";

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

  // ── Lớp 2: meter NFT ở ĐÂU quyết định nhánh Reserve có phanh hay không ────
  // Ở ví: tiêu nó KHÔNG kích validator nào ⇒ ai giữ khoá ví rút trọn 9,63 tỷ trong một giao
  // dịch. Ở `reserve_draw`: tiêu nó = chạy bốn luật trần/nhịp/đích/cổng. Đây là khác biệt
  // giữa "đường thông" và "đường có phanh", nên nó phải là một dòng đối chiếu riêng.
  let rw: Awaited<ReturnType<typeof deriveReserveWiring>> | undefined;
  if (state.reserve?.custodyRef && (state.reserve.authRef?.outputIndex ?? -1) >= 0) {
    rw = await deriveReserveWiring(wiring, {
      custodyTxHash: state.reserve.custodyRef.txHash,
      custodyIndex:  state.reserve.custodyRef.outputIndex,
      authTxHash:    state.reserve.authRef.txHash,
      authIndex:     state.reserve.authRef.outputIndex,
      network:       wiring.network,
    });
  }
  if (!rw) {
    check(false,
      `MET NFT:    Lớp 2 CHƯA dựng — meter còn ở ví, nhánh Reserve KHÔNG CÓ PHANH ` +
      `(chạy 24_reserve_layer2_init.ts). Ở trạng thái này, người giữ khoá ví rút trọn ` +
      `${vn(9_630_000_000n)} LAMP trong MỘT giao dịch.`);
  } else {
    const atDraw = await lucid.utxosAt(rw.reserve.drawAddr);
    check(count(atDraw, wiring.metUnit) === 1n,
      `MET NFT:    1 bản tại reserve_draw — nhánh Reserve CÓ PHANH`);
    check(count(atWlt, wiring.metUnit) === 0n,
      `MET NFT:    KHÔNG còn bản nào ở ví (ở ví = đường vòng qua mọi luật)`);
  }

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
  // Phép đo này chỉ đúng TRƯỚC lần phân phối đầu tiên. `khoLamp` là số đang ở kho HÔM NAY;
  // `dist_minted` là tổng đúc LỊCH SỬ. Mỗi `ReleaseForRedeem` (treasury.ak) rút LAMP ra cho
  // người dùng ⇒ khoLamp giảm, dist_minted không giảm ⇒ dòng này sẽ đỏ VĨNH VIỄN sau đợt phân
  // phối đầu. Cổng đỏ-giả bị người vận hành học cách bỏ qua, và lúc đó nó hết bắt được cái nó
  // sinh ra để bắt. Nên: chỉ ép khi kho chưa từng nhả, và nói rõ khi không còn ép được.
  if (khoLamp >= s.dist_minted) {
    check(true,
      `mọi LAMP đường Distribution đều nằm trong kho (${vn(khoLamp / OIL)} ≥ ${vn(s.dist_minted / OIL)})`);
  } else {
    console.log(
      `   · KHÔNG ĐO ĐƯỢC: kho giữ ${vn(khoLamp / OIL)} < dist_minted ${vn(s.dist_minted / OIL)} LAMP.\n` +
      `     Đây là hình dạng BÌNH THƯỜNG sau khi phân phối bắt đầu (ReleaseForRedeem rút khỏi kho),\n` +
      `     nhưng phép đo này không phân biệt được nó với rò rỉ. Muốn ép lại thì phải cộng dồn\n` +
      `     lượng đã nhả từ lịch sử tx — chưa dựng. KHÔNG tính là xanh, cũng KHÔNG tính là đỏ.`,
    );
  }

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

  // ── Lớp 2: phanh có tác dụng THẬT hay chỉ có mặt ──────────────────────────
  if (rw) {
    console.log("\n── Lớp 2: phanh nhịp Reserve ──");
    printReserveWiring(rw.reserve);
    const drawU = (await lucid.utxosAt(rw.reserve.drawAddr))
      .find((u) => (u.assets[wiring.metUnit] ?? 0n) === 1n);
    if (drawU?.datum) {
      const r = reserveStateFromCbor(drawU.datum);
      console.log(`ReserveState: start=${r.start_epoch} total=${vn(r.total_oildrop)} drawn=${vn(r.drawn_oildrop)} last_epoch=${r.last_epoch}`);
      check(r.total_oildrop === s.reserve_cap,
        `total_oildrop khớp reserve_cap của SupplyState (${vn(r.total_oildrop)})`);
      // Bản trước viết `drawn <= total/1000*1 + drawn` — vế phải LUÔN ≥ vế trái với total ≥ 0,
      // nên dòng đó in ✓ kể cả khi drawn vượt pot: nhãn nói "≤ pot", phép đo không nhắc tới pot.
      check(r.drawn_oildrop <= r.total_oildrop,
        `drawn_oildrop = ${vn(r.drawn_oildrop)} ≤ pot ${vn(r.total_oildrop)}`);
      check(r.drawn_oildrop <= r.total_oildrop / 1000n * (r.last_epoch - r.start_epoch + 1n),
        `drawn_oildrop ≤ trần nhịp cộng dồn (${r.last_epoch - r.start_epoch + 1n} epoch × pot/1000)`);
    }

    const custU = (await lucid.utxosAt(rw.reserve.custodyAddr))
      .find((u) => (u.assets[rw!.reserve.custodyNftUnit] ?? 0n) === 1n);
    check(custU !== undefined, `custody NFT: 1 bản tại két (cổng cầu đọc parked từ đây)`);
    if (custU) {
      const parked = parkedOf(custU, wiring.lampPid, wiring.tokenName);
      const lampAtAddr = (await lucid.utxosAt(rw.reserve.custodyAddr))
        .reduce((a, u) => a + (u.assets[wiring.lampUnit] ?? 0n), 0n);
      console.log(`parked (UTxO có custody NFT) = ${vn(parked / OIL)} LAMP · sàn = ${vn(rw.reserve.floorOildrop / OIL)} LAMP`);
      console.log(`LAMP tại ĐỊA CHỈ két         = ${vn(lampAtAddr / OIL)} LAMP`);
      if (lampAtAddr > parked) {
        console.log(
          `ℹ hai số trên LỆCH NHAU, và đó là hình dạng của thiết kế chứ không phải lỗi lượt chạy:\n` +
          `  Δ rút về đúng ĐỊA CHỈ két (reserve_draw Luật 9 xanh), nhưng nằm ở UTxO RIÊNG bên cạnh\n` +
          `  UTxO mang custody NFT — mà cổng cầu chỉ đọc UTxO mang NFT. Cùng một UTxO không thể vừa\n` +
          `  là reference input vừa bị tiêu, nên theo CẤU TRÚC lượt rút không bao giờ tự nâng parked\n` +
          `  qua sàn. Cổng cầu chỉ đóng khi một Collect của Treasury nạp vào chính UTxO custody —\n` +
          `  và Collect chưa dựng. Chừng đó, phanh đang chạy là TRẦN NHỊP, không phải cổng cầu.`,
        );
      }
    }

    const bp = state.reserve?.brakeProof;
    check(bp?.overCapBlocked === true,
      bp ? `bằng chứng phanh P1: δ vượt trần nhịp BỊ CHẶN` : `chưa có bằng chứng phanh — chạy 26_prove_brake.ts`);
    check(bp?.noGateBlocked === true,
      bp ? `bằng chứng phanh P3: rút KHÔNG qua cổng BỊ CHẶN` : `chưa có bằng chứng phanh P3`);
    if (bp && !bp.sameEpochBlocked) {
      console.log(`ℹ P2 (lượt hai cùng epoch): ${bp.sameEpochError}`);
    } else if (bp) {
      check(true, `bằng chứng phanh P2: lượt hai cùng epoch BỊ CHẶN`);
    }
  }

  console.log(
    bad === 0
      ? "\n✅ Toàn bộ mục đối chiếu xanh."
      : `\n⚠ ${bad} mục chưa xanh — xem dấu ✗ ở trên.`,
  );
  if (bad > 0) process.exit(1);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
