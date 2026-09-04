// 25_gated_draw.ts — LỚP 2 bước rút: một lượt Reserve đi QUA PHANH, không đi vòng nó.
//
// KHÁC `22_reserve_draw.ts` Ở ĐÂU
//   Bước 22 tiêu meter NFT từ VÍ. Không validator nào chạy — nó chứng minh đường THÔNG.
//   Bước này tiêu meter NFT từ `reserve_draw`, nên MỘT giao dịch phải làm hài lòng BỐN
//   validator cùng lúc, và đó mới là hình dạng thật của một lượt rút Reserve:
//
//     reserve_draw.spend  — ≤1 lượt/epoch, δ ≤ tổng/1000, δ ≤ pot còn lại, δ về đúng đích,
//                           ReserveState tái tạo đúng, có auth NFT tiêu TỪ gate.
//     reserve_gate.spend  — parked của két < sàn (cổng CẦU), auth NFT quay về gate, không burn.
//     lamp_mint.mint      — nhánh ReserveDraw: đúng 1 input mang meter NFT, meter không mint/burn.
//     supply_state.spend  — `reserve_minted += δ`, ≤ cap, đơn điệu.
//
//   Thiếu bất kỳ mảnh nào thì giao dịch KHÔNG dựng nổi — không phải cảnh báo, không phải
//   "gửi rồi hỏng sau".
//
// SỐ ĐO SẼ IN RA, VÀ MỘT SỐ TRONG ĐÓ LÀ PHÁT HIỆN
//   Bước này đo `parked` của két TRƯỚC và SAU. Đọc kỹ chỗ đó: δ LAMP rót vào ĐỊA CHỈ két,
//   nhưng `reserve_gate` đọc `parked` từ UTxO MANG CUSTODY NFT. Hai thứ đó không phải một —
//   xem phần "cổng cầu không tự đóng lại" ở cuối tệp.
//
// Chạy: NETWORK=Preprod tsx 25_gated_draw.ts     (DRAW_LAMP=1000 mặc định)
import { type UTxO } from "@lucid-evolution/lucid";
import { NETWORK, makeLucid, walletPkh, explorerTx } from "./config.js";
import {
  supplyStateToCbor, supplyStateFromCbor, supplyStateRedeemerToCbor, mintRouteToCbor,
} from "../offchain/src/datum.js";
import { rehydrate, writeState, waitFor } from "./_canonical_v2.js";
import {
  deriveReserveWiring, reserveStateDatum, drawWindow, printReserveWiring,
} from "./_reserve_layer2.js";
import { reserveStateFromCbor, drawRedeemerToCbor } from "../../Reserve/offchain/src/datum.js";
import { attachGateSpend, parkedOf } from "../../Treasury/offchain/src/reserveGateBuilder.js";

const NFT_ADA = 2_000_000n;
const DRAW_LAMP = BigInt(process.env.DRAW_LAMP ?? "1000");

function theOneHolding(utxos: UTxO[], unit: string, what: string): UTxO {
  const hits = utxos.filter((u) => (u.assets[unit] ?? 0n) === 1n);
  if (hits.length !== 1) throw new Error(`cần ĐÚNG 1 UTxO mang ${what} (${unit}), tìm thấy ${hits.length}.`);
  return hits[0]!;
}

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  const { state, wiring, scripts } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);
  if (!state.reserve?.custodyRef || (state.reserve.authRef?.outputIndex ?? -1) < 0) {
    throw new Error("chưa dựng Lớp 2 — chạy 'tsx 24_reserve_layer2_init.ts' trước.");
  }

  const { reserve, scripts: rs } = await deriveReserveWiring(wiring, {
    custodyTxHash: state.reserve.custodyRef.txHash,
    custodyIndex:  state.reserve.custodyRef.outputIndex,
    authTxHash:    state.reserve.authRef.txHash,
    authIndex:     state.reserve.authRef.outputIndex,
    network:       wiring.network,
  });

  const delta = DRAW_LAMP * 1_000_000n;
  console.log(`=== Lượt rút Reserve QUA CỔNG (${NETWORK}) ===`);
  printReserveWiring(reserve);
  console.log(`Δ = ${DRAW_LAMP} LAMP (${delta} oildrop)\n`);

  // ── Bốn UTxO đầu vào, mỗi cái phải đúng MỘT bản ───────────────────────────
  const drawU = theOneHolding(await lucid.utxosAt(reserve.drawAddr), wiring.metUnit, "meter NFT tại reserve_draw");
  const ssU   = theOneHolding(await lucid.utxosAt(wiring.ssAddr),    wiring.threadUnit, "SUPPLY NFT");
  const authU = theOneHolding(await lucid.utxosAt(reserve.gateAddr), reserve.authUnit,  "auth NFT tại gate");
  const custU = theOneHolding(await lucid.utxosAt(reserve.custodyAddr), reserve.custodyNftUnit, "custody NFT");

  if (!drawU.datum) throw new Error("ReserveState UTxO không có inline datum.");
  if (!ssU.datum)   throw new Error("SupplyState UTxO không có inline datum.");
  const r0 = reserveStateFromCbor(drawU.datum);
  const s0 = supplyStateFromCbor(ssU.datum);

  // ── Ba trần, kiểm TRƯỚC khi dựng để lỗi đọc được thay vì "validator crashed" ──
  const window = drawWindow();
  console.log(`ReserveState: start=${r0.start_epoch} total=${r0.total_oildrop} drawn=${r0.drawn_oildrop} last=${r0.last_epoch}`);
  console.log(`epoch lượt này t = ${window.t}  (cửa sổ ${window.loMs} → ${window.hiMs})`);
  if (!(window.t > r0.last_epoch)) {
    throw new Error(
      `LUẬT 3: t=${window.t} ≤ last_epoch=${r0.last_epoch} — epoch này đã rút rồi. ` +
      `Mỗi epoch tối đa MỘT lượt; chờ sang epoch sau.`,
    );
  }
  if (delta > reserve.maxPerEpoch) {
    throw new Error(`LUẬT 4: Δ=${delta} > trần epoch ${reserve.maxPerEpoch} oildrop.`);
  }
  if (delta > r0.total_oildrop - r0.drawn_oildrop) {
    throw new Error(`LUẬT 4: Δ=${delta} > pot còn lại ${r0.total_oildrop - r0.drawn_oildrop}.`);
  }
  if (s0.reserve_minted + delta > s0.reserve_cap) {
    throw new Error(`vượt cap Reserve của SupplyState: ${s0.reserve_minted} + ${delta} > ${s0.reserve_cap}.`);
  }

  const parkedBefore = parkedOf(custU, wiring.lampPid, wiring.tokenName);
  console.log(`parked (UTxO mang custody NFT) = ${parkedBefore} oildrop, sàn = ${reserve.floorOildrop}`);
  console.log(parkedBefore < reserve.floorOildrop ? `⇒ dưới sàn: cổng CẦU mở\n` : `⇒ TRÊN sàn: cổng CẦU đóng\n`);

  const lampAtCustodyBefore = (await lucid.utxosAt(reserve.custodyAddr))
    .reduce((s, u) => s + (u.assets[wiring.lampUnit] ?? 0n), 0n);

  // ── Một giao dịch, bốn validator ──────────────────────────────────────────
  let txb = lucid.newTx()
    // reserve_draw: tiêu ReserveState (mang meter) + tái tạo, drawn += Δ, last_epoch := t.
    .collectFrom([drawU], drawRedeemerToCbor())
    .attach.SpendingValidator(rs.draw)
    .pay.ToContract(reserve.drawAddr,
      { kind: "inline", value: reserveStateDatum(r0.start_epoch, r0.total_oildrop, r0.drawn_oildrop + delta, window.t) },
      { lovelace: NFT_ADA, [wiring.metUnit]: 1n })
    // lamp_mint nhánh ReserveDraw — meter NFT chính là input reserve_draw ở trên.
    .mintAssets({ [wiring.lampUnit]: delta }, mintRouteToCbor("ReserveDraw"))
    .attach.MintingPolicy(scripts.lampMint)
    // supply_state: reserve_minted += Δ.
    .collectFrom([ssU], supplyStateRedeemerToCbor())
    .attach.SpendingValidator(scripts.supplyState)
    .pay.ToContract(wiring.ssAddr,
      { kind: "inline", value: supplyStateToCbor({ ...s0, reserve_minted: s0.reserve_minted + delta }) },
      { lovelace: NFT_ADA, [wiring.threadUnit]: 1n })
    // Luật 9: TOÀN BỘ Δ đi tới `reserve_dest` = credential của két.
    .pay.ToAddress(reserve.custodyAddr, { lovelace: NFT_ADA, [wiring.lampUnit]: delta })
    // Luật 2b: lower_bound và upper_bound PHẢI cùng một epoch.
    .validFrom(window.loMs).validTo(window.hiMs)
    .addSigner(walletAddr);

  // reserve_gate: tiêu auth NFT (kích cổng sàn) + reference custody + trả auth về gate.
  txb = attachGateSpend(txb, {
    lucid, authUtxo: authU, gateScript: rs.gate, gateAddress: reserve.gateAddr,
    authPolicyId: reserve.authPid, authName: reserve.authUnit.slice(56),
    custodyUtxo: custU, lampPolicyId: wiring.lampPid, tokenName: wiring.tokenName,
    floorOildrop: reserve.floorOildrop,
  });

  const tx = await txb.complete();
  const hash = await (await tx.sign.withWallet().complete()).submit();
  console.log(`📤 Lượt rút qua cổng: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);

  // GHI STATE NGAY, TRƯỚC MỌI PHÉP ĐỐI CHIẾU.
  //
  // Giao dịch đã lên chuỗi thì không quay lui được, nên bất kỳ lỗi nào ở phần đo bên dưới —
  // kể cả một lỗi đọc sớm — không được phép làm mất bản ghi của một lượt chạy THÀNH CÔNG.
  // Bài học này trả giá hai lần rồi: Tx A mất state vì `JSON.stringify` gặp BigInt, và lượt
  // rút đầu ở bước này bị báo "LUẬT 9 HỎNG" trong khi trên chuỗi Δ nằm đúng chỗ.
  state.tx.gatedDraw = hash;
  state.minted.reserve = (s0.reserve_minted + delta).toString();
  await writeState(state);

  // ── Đối chiếu bằng số, không bằng "tx đã qua" ─────────────────────────────
  const r1 = await waitFor(
    `ReserveState.drawn_oildrop = ${r0.drawn_oildrop + delta}`,
    async () => reserveStateFromCbor(
      theOneHolding(await lucid.utxosAt(reserve.drawAddr), wiring.metUnit, "meter NFT").datum!,
    ),
    (r) => r.drawn_oildrop === r0.drawn_oildrop + delta,
  );
  console.log(`\n✓ drawn_oildrop: ${r0.drawn_oildrop} → ${r1.drawn_oildrop}`);
  console.log(`✓ last_epoch:    ${r0.last_epoch} → ${r1.last_epoch} (epoch này KHOÁ, lượt hai bị Luật 3 chặn)`);
  console.log(`✓ start_epoch và total_oildrop giữ nguyên: ${r1.start_epoch} / ${r1.total_oildrop}`);

  // Địa chỉ két là một CHỈ MỤC KHÁC với địa chỉ reserve_draw, và nhà cung cấp cập nhật hai
  // chỉ mục đó không đồng thời. Đọc thẳng ở đây thì ra bản CŨ — và bản cũ nói "két tăng 0",
  // tức tố cáo Luật 9 hỏng trong khi trên chuỗi Δ nằm đúng chỗ. Lượt chạy đầu (2026-09-03)
  // hỏng đúng vậy: tx `a1d64ec2…` thành công, script báo "LUẬT 9 HỎNG".
  const atCustodyAfter = await waitFor(
    `két nhận Δ = ${delta} oildrop`,
    () => lucid.utxosAt(reserve.custodyAddr),
    (us) => us.reduce((s, u) => s + (u.assets[wiring.lampUnit] ?? 0n), 0n) - lampAtCustodyBefore >= delta,
  );
  const lampAtCustodyAfter = atCustodyAfter.reduce((s, u) => s + (u.assets[wiring.lampUnit] ?? 0n), 0n);
  const custAfter = theOneHolding(atCustodyAfter, reserve.custodyNftUnit, "custody NFT");
  const parkedAfter = parkedOf(custAfter, wiring.lampPid, wiring.tokenName);

  console.log(`\n── Két nhận Δ ở đâu ──`);
  console.log(`LAMP tại ĐỊA CHỈ két:        ${lampAtCustodyBefore} → ${lampAtCustodyAfter} (tăng ${lampAtCustodyAfter - lampAtCustodyBefore})`);
  console.log(`parked tại UTxO CÓ custody NFT: ${parkedBefore} → ${parkedAfter} (tăng ${parkedAfter - parkedBefore})`);

  if (lampAtCustodyAfter - lampAtCustodyBefore < delta) {
    throw new Error(`LUẬT 9 HỎNG: két chỉ tăng ${lampAtCustodyAfter - lampAtCustodyBefore}, cần ≥ ${delta}.`);
  }

  if (parkedAfter === parkedBefore) {
    // Đây KHÔNG phải lỗi của lượt chạy — nó là hình dạng của thiết kế, và nó nên được đọc ra.
    console.log(`
⚠ CỔNG CẦU KHÔNG TỰ ĐÓNG LẠI ĐƯỢC
  Δ LAMP đã vào ĐÚNG địa chỉ két (Luật 9 xanh), nhưng nó nằm ở một UTxO RIÊNG bên cạnh UTxO
  mang custody NFT — và \`reserve_gate\` chỉ đọc \`parked\` từ UTxO mang NFT
  (\`reserve_gate.ak\` G-CUST-1 + G-FLOOR-1). Nên \`parked\` KHÔNG nhích lên sau một lượt rút.

  Không thể sửa bằng cách rót thẳng vào UTxO custody: cùng một UTxO không thể vừa là
  reference input (gate đòi) vừa là input bị tiêu (rót vào thì phải tiêu) trong một giao dịch.
  Nghĩa là theo CẤU TRÚC, lượt rút Reserve không bao giờ tự nâng \`parked\` qua sàn.

  Hệ quả: sàn chỉ đóng lại khi một tiến trình KHÁC nạp LAMP vào chính UTxO custody — tức một
  \`Collect\` của Treasury. Chừng nào Collect chưa dựng, cổng cầu MỞ VĨNH VIỄN và thứ duy nhất
  còn chặn là trần nhịp (${reserve.maxPerEpoch} oildrop/epoch, ≥1000 epoch để cạn pot).

  Trần nhịp là phanh THẬT và nó đang chạy. Cổng cầu thì chưa — đừng ghi nó vào cột "đã có".`);
  }

  console.log(`\n✅ Xong. Bước kế: tsx 26_prove_brake.ts (ba phép thử PHỦ ĐỊNH của phanh).`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
