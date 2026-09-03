// 22_reserve_draw.ts — Tx C: đúc LAMP qua nhánh `ReserveDraw`.
//
// ĐÂY LÀ PHÉP THỬ QUAN TRỌNG NHẤT CỦA CẢ MÀN DIỄN TẬP, vì đây đúng là nhánh ĐÃ CHẾT trên
// mainnet. Policy mồi `55d3e01b…180f0` nướng `meter_nft_policy` = 28 byte 0
// (`Genesis/offchain/src/deployed.ts:92`). Chuỗi 28 byte 0 không có tiền ảnh blake2b-224
// nên không UTxO nào mang nổi NFT dưới policy đó ⇒ điều kiện
// `count_inputs_holding_nft(tx.inputs, meter_nft_policy, meter_nft_name) == 1`
// (`lamp_mint.ak:250-252`) không bao giờ thoả ⇒ 9,63 tỷ LAMP Reserve không rút được, mãi mãi
// (deployed.ts:118-119). Trần phát hành THỰC TẾ của policy mainnet là 26,37 tỷ, không phải
// 36 tỷ — đúng như `verify_mainnet_supply.ts` in ra.
//
// Bước này chạy xanh = policy mới KHÔNG mang khuyết tật đó. Bước này đỏ = ĐỪNG phát hành.
//
// ── CÁI NÀY CHỨNG MINH GÌ, VÀ KHÔNG CHỨNG MINH GÌ ───────────────────────────
// CHỨNG MINH: nhánh `ReserveDraw` của `lamp_mint` MỞ ĐƯỢC, tức meter NFT có thật, tiêu được,
//   và transition `reserve_minted += Δ` đi qua đủ mọi luật cap/đơn điệu.
// KHÔNG CHỨNG MINH: trần nhịp δ ≤ E/1000 mỗi epoch. Trần đó là việc của `reserve_draw.ak`
//   (module Reserve, 9 tham số), và ở màn này MET nằm ở VÍ nên không validator nào chạy khi
//   nó bị tiêu. Nghĩa là bản Lớp 1 này CHỨNG MINH ĐƯỜNG THÔNG, KHÔNG chứng minh ĐƯỜNG CÓ
//   PHANH. Đặt MET dưới `reserve_draw` là Lớp 2 — xem `canonical-preprod-runbook.md`.
//
//   Nói thẳng hệ quả: nếu phát hành mainnet mà MET vẫn nằm ở ví thì ai giữ khoá ví rút trọn
//   9,63 tỷ trong một giao dịch, chi phí bằng phí mạng. Đó chính là đường (b) mà cổng
//   MARKER-001 mô tả (`_guards.ts`). Lớp 2 phải xanh trước khi lên mainnet.
//
// Chạy: NETWORK=Preprod tsx 22_reserve_draw.ts    (RESERVE_LAMP=1000 mặc định)
import { type UTxO } from "@lucid-evolution/lucid";
import { NETWORK, makeLucid, walletPkh, explorerTx } from "./config.js";
import { supplyStateToCbor, supplyStateFromCbor, supplyStateRedeemerToCbor, mintRouteToCbor } from "../offchain/src/datum.js";
import { rehydrate, writeState, waitFor } from "./_canonical_v2.js";

const NFT_ADA = 2_000_000n;
const RESERVE_LAMP = BigInt(process.env.RESERVE_LAMP ?? "1000");

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

  const delta = RESERVE_LAMP * 1_000_000n;
  console.log(`=== Tx C — ReserveDraw (${NETWORK}) — nhánh đã CHẾT trên mainnet ===`);
  console.log(`meter policy: ${wiring.markers.metPid}  (mainnet: 28 byte 0 ⇒ không có tiền ảnh)`);
  console.log(`Δ = ${RESERVE_LAMP} LAMP (${delta} oildrop)\n`);

  const ssU  = theOneHolding(await lucid.utxosAt(wiring.ssAddr), wiring.threadUnit, "SUPPLY NFT");
  const metU = theOneHolding(await lucid.wallet().getUtxos(),    wiring.metUnit,    "MET NFT");
  console.log(`✓ meter NFT TỒN TẠI trên chuỗi: ${metU.txHash}#${metU.outputIndex}`);
  console.log(`  (đúng chỗ policy mainnet không thể có gì — đó là toàn bộ khác biệt)`);

  if (!ssU.datum) throw new Error("SupplyState UTxO không có inline datum.");
  const s0 = supplyStateFromCbor(ssU.datum);
  console.log(`\nSupplyState: dist=${s0.dist_minted} reserve=${s0.reserve_minted} / cap reserve ${s0.reserve_cap}`);
  if (s0.reserve_minted + delta > s0.reserve_cap) {
    throw new Error(`vượt cap Reserve: ${s0.reserve_minted} + ${delta} > ${s0.reserve_cap}.`);
  }
  const s1 = { ...s0, reserve_minted: s0.reserve_minted + delta };

  const tx = await lucid.newTx()
    .collectFrom([ssU], supplyStateRedeemerToCbor())
    .attach.SpendingValidator(scripts.supplyState)
    // TIÊU meter NFT — đây là điều kiện duy nhất của nhánh ReserveDraw. Không chữ ký
    // authority, không A-DEST: cổng nằm ở chỗ meter chỉ có MỘT bản one-shot.
    .collectFrom([metU])
    .mintAssets({ [wiring.lampUnit]: delta }, mintRouteToCbor("ReserveDraw"))
    .attach.MintingPolicy(scripts.lampMint)
    .pay.ToContract(wiring.ssAddr, { kind: "inline", value: supplyStateToCbor(s1) },
      { lovelace: NFT_ADA, [wiring.threadUnit]: 1n })
    // Trả meter về nguyên chỗ. Nó KHÔNG được mint/burn trong tx này
    // (`lamp_mint.ak:252` đòi `quantity_of(tx.mint, meter_policy, meter_name) == 0`).
    .pay.ToAddress(walletAddr, { lovelace: NFT_ADA, [wiring.metUnit]: 1n })
    .complete();

  const hash = await (await tx.sign.withWallet().complete()).submit();
  console.log(`\n📤 Tx C: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);

  const s2 = await waitFor(
    `SupplyState.reserve_minted = ${s1.reserve_minted}`,
    async () => supplyStateFromCbor(
      theOneHolding(await lucid.utxosAt(wiring.ssAddr), wiring.threadUnit, "SUPPLY NFT").datum!,
    ),
    (s) => s.reserve_minted === s1.reserve_minted,
  );
  console.log(`\n✓ reserve_minted: ${s0.reserve_minted} → ${s2.reserve_minted} oildrop`);
  console.log(`✓ NHÁNH ReserveDraw MỞ ĐƯỢC trên policy này.`);
  console.log(`  Trần phát hành thật = ${s2.dist_cap + s2.reserve_cap} oildrop = 36 tỷ LAMP,`);
  console.log(`  KHÔNG phải 26,37 tỷ như policy mồi mainnet.`);
  console.log(`\n⚠ CHƯA chứng minh trần nhịp δ ≤ E/1000 — MET còn ở ví, reserve_draw chưa chạy (Lớp 2).`);

  state.tx.reserveDraw = hash;
  state.minted.reserve = s2.reserve_minted.toString();
  await writeState(state);
  console.log(`\n✅ Xong. Bước kế: tsx 23_prove_oneshot.ts`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
