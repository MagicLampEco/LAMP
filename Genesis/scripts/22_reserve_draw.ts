// 22_reserve_draw.ts — Tx C: đúc LAMP qua nhánh `ReserveDraw`.
//
// ⛔ BƯỚC NÀY KHÔNG CÒN XANH ĐƯỢC, VÀ MÀU ĐỎ CỦA NÓ KHÔNG CÒN LÀ TÍN HIỆU TẢ Ở DƯỚI.
//
// Từ commit `cc1af74`, nhánh `ReserveDraw` đòi thêm ĐÚNG MỘT input mang NFT kho-reserve
// (`lamp_mint.ak`, khối `count_inputs_holding_nft(tx.inputs, reserve_kho_nft_policy,
// reserve_kho_nft_name) == 1` kèm `qty_delta_at_script(...) >= delta`). Bước này tiêu meter
// NFT từ VÍ và KHÔNG BAO GIỜ dựng input đó — `grep -c "reserveKho\|reserve_kho"
// 22_reserve_draw.ts` → 0. Nên nó đỏ vì THIẾU MỘT INPUT, không phải vì policy mang khuyết
// tật mainnet.
//
// Đọc màu đỏ ở đây thành "ĐỪNG phát hành" là đọc sai — và đó là chiều sai đắt nhất: nó dừng
// một đợt phát hành lành mạnh bằng một lý do không có thật. Đường đo ĐÚNG cho cùng câu hỏi
// là LỚP 2: `24_reserve_layer2_init.ts` → `25_gated_draw.ts`. Bước 25 dựng input kho-reserve
// dưới tên `custody NFT` (`25_gated_draw.ts:80`, `:160`), nên nó thoả vế mới.
//
// Giữ tệp lại chứ không xoá: phần mô tả khuyết tật mainnet bên dưới vẫn đúng và vẫn là tài
// liệu duy nhất giải thích vì sao trần thật của policy mồi là 26,37 tỷ.
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
import { NETWORK, SUBMIT, makeLucid, walletPkh, explorerTx } from "./config.js";
import { supplyStateToCbor, supplyStateFromCbor, supplyStateRedeemerToCbor, mintRouteToCbor } from "../offchain/src/datum.js";
import { rehydrate, writeState, waitFor, isWaitTimeout } from "./_canonical_v2.js";
import { assertSeedNotSpent, custodySeedRefFromState, refKey } from "./_custodySeedRef.js";

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

  // Bước này đặc biệt đắt nếu hỏng: nó đúc theo ĐÚNG nhánh ReserveDraw mà hạt giống custody
  // bảo vệ. Tiêu nhầm hạt giống ở đây là tự cắt đường của chính mình ở lượt sau.
  const seed = custodySeedRefFromState(state.reserve?.custodyRef, process.env);
  console.log(`hạt giống custody phải giữ nguyên: ${refKey(seed.ref)} (nguồn: ${seed.source})`);

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

  // Cổng đứng TRƯỚC nhánh SUBMIT=false — cùng lý do đã viết ở `21_vest_to_kho.ts`.
  assertSeedNotSpent(tx, seed.ref, "Tx C (22 ReserveDraw)");

  const signed = await tx.sign.withWallet().complete();
  if (!SUBMIT) {
    console.log(
      `\n(SUBMIT=false ⇒ KHÔNG gửi, KHÔNG ghi state.)\n` +
      `Tx dựng xong và ký được — nghĩa là nhánh ReserveDraw QUA ĐƯỢC khâu dựng, meter NFT có\n` +
      `thật và tiêu được. Đó chính là chỗ policy mồi mainnet không tới nổi.\n` +
      `Hạt giống custody KHÔNG nằm trong input lẫn collateral của giao dịch này.\n` +
      `Gửi thật: SUBMIT=true tsx 22_reserve_draw.ts`,
    );
    return;
  }

  const hash = await signed.submit();
  console.log(`\n📤 Tx C: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);

  // GHI SỔ TRƯỚC, ĐỐI CHIẾU SAU — cùng lý do đã viết ở `21_vest_to_kho.ts`, và chỗ này là bản
  // thứ hai của cùng một khuyết tật: bản trước gọi `waitFor` rồi mới `writeState`, nên một lần
  // chờ hết giờ (chỉ mục chậm, không phải chuỗi hỏng) sẽ ném ở giữa và bỏ lại cuốn sổ không có
  // `hash` cho một giao dịch đã lên chuỗi thật. Số ghi ở đây là `s1` — số MÌNH vừa gửi đi;
  // dòng đối chiếu bên dưới mới là số ĐỌC VỀ. Hai số đó khác vai, đừng gộp.
  state.tx.reserveDraw = hash;
  state.minted.reserve = s1.reserve_minted.toString();
  await writeState(state);

  // Đối chiếu: đọc lại SupplyState trên chuỗi. Không ném — ném ở đây là ném SAU một thao tác
  // bất khả hồi, nó không cứu được gì. Chờ hết giờ ⇒ "CHƯA ĐO ĐƯỢC", không phải "HỎNG".
  try {
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
  } catch (e) {
    // BA trạng thái, không phải hai. `waitFor` hết giờ = chưa đọc được. Mọi ngoại lệ KHÁC phát ra
    // từ hàm đọc là HỎNG THẬT, và ít nhất hai trong số đó là thảm hoạ: `theOneHolding` ném khi
    // tìm thấy HAI UTxO mang SUPPLY NFT (thread NFT nhân đôi ⇒ `dist_minted` về 0 ⇒ đúc lại trọn
    // cap), và `.datum!` ném `TypeError` khi SupplyState quay về không có inline datum. Gộp cả
    // hai vào nhãn "chưa đo được" là dạy người đọc bỏ qua đúng dòng đáng dừng nhất.
    const msg = e instanceof Error ? e.message : String(e);
    if (isWaitTimeout(e)) {
      process.exitCode = 2;
      console.log(
        `\n⚠ CHƯA ĐO ĐƯỢC (không phải "hỏng"): chưa đọc lại được SupplyState mang số mới.\n` +
        `  ${msg}\n` +
        `  Giao dịch ĐÃ gửi và đã ghi vào sổ. Đo lại bằng chính nó: ${explorerTx(hash)}\n` +
        `  Hoặc chạy: tsx verify_canonical_v2.ts`,
      );
    } else {
      process.exitCode = 1;
      console.error(
        `\n❌ HỎNG khi đọc lại SupplyState — KHÔNG phải chỉ mục chậm:\n` +
        `  ${msg}\n` +
        `  Giao dịch ĐÃ gửi (${hash}) và đã ghi vào sổ, nên không mất dấu. ĐỪNG chạy bước kế\n` +
        `  trước khi hiểu dòng trên: tsx verify_canonical_v2.ts`,
      );
    }
  }
  console.log(`\n⚠ CHƯA chứng minh trần nhịp δ ≤ E/1000 — MET còn ở ví, reserve_draw chưa chạy (Lớp 2).`);
  // `✅ Xong` chỉ được in khi phép đối chiếu ĐÃ chạy và ĐÃ khớp. Đầu tệp này khai rằng màu của
  // bước này quyết định có phát hành hay không — nên một dấu ✅ đứng sau một trạng thái mù là
  // một khẳng định mà không phép đo nào đỡ.
  if (process.exitCode === undefined) {
    console.log(`\n✅ Xong. Bước kế: tsx 23_prove_oneshot.ts`);
  } else {
    console.log(`\nKHÔNG in "Xong": xem dòng ⚠/❌ ở trên. Mã thoát ${process.exitCode}.`);
  }
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
