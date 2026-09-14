// 21_vest_to_kho.ts — Tx B: đúc LAMP đường `DistributionVest` và ÉP nó rót vào KHO.
//
// Bước này kiểm ba luật cùng lúc, và cả ba đều là thứ bản mồi mainnet KHÔNG có:
//
//   WHO   — `registry.validate_mint` đọc bảng registry từ một reference input mang REG NFT,
//           tìm entry `token_tag`, rồi đòi authority trong entry ký. Bản mainnet gác bằng
//           DANH SÁCH pkh nướng sẵn (`deployed.ts:71-76` — "baked-pkh-list", không đọc
//           registry, không đọc DID) nên xoay khoá phải đúc lại policy.
//   WHERE — A-DEST: đọc hash kho ĐỘNG từ reference input mang TRSY NFT, rồi đòi ĐỘ TĂNG
//           RÒNG của LAMP tại kho ≥ Δ. Đo độ tăng ròng chứ không đo tổng mặt output, nên
//           mẹo "tiêu UTxO kho rồi trả lại đúng số cũ" không lọt.
//   HOW MUCH — SupplyState cộng đúng Δ vào `dist_minted`, ≤ cap, đơn điệu, không burn.
//
// Chạy: NETWORK=Preprod tsx 21_vest_to_kho.ts     (DELTA_LAMP=10000 mặc định)
import { type UTxO } from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, makeLucid, walletPkh, explorerTx } from "./config.js";
import { supplyStateToCbor, supplyStateFromCbor, supplyStateRedeemerToCbor, mintRouteToCbor } from "../offchain/src/datum.js";
import { rehydrate, treasuryDatum, writeState, waitFor, isWaitTimeout } from "./_canonical_v2.js";
import { assertSeedNotSpent, custodySeedRefFromState, refKey } from "./_custodySeedRef.js";

const NFT_ADA = 2_000_000n;
/** Lượng đúc thử, tính bằng LAMP (1 LAMP = 1e6 oildrop). */
const DELTA_LAMP = BigInt(process.env.DELTA_LAMP ?? "10000");

/** Tìm đúng MỘT UTxO mang NFT đã cho; 0 hoặc ≥2 đều là dấu hiệu wiring sai, không đoán. */
function theOneHolding(utxos: UTxO[], unit: string, what: string): UTxO {
  const hits = utxos.filter((u) => (u.assets[unit] ?? 0n) === 1n);
  if (hits.length !== 1) {
    throw new Error(`cần ĐÚNG 1 UTxO mang ${what} (${unit}), tìm thấy ${hits.length}.`);
  }
  return hits[0]!;
}

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  const { state, wiring, scripts } = await rehydrate();
  if (pkh !== wiring.pkh) {
    throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}. Registry chỉ uỷ quyền cho pkh trong state.`);
  }

  // Hạt giống custody phải sống sót tới bước L2a — đọc TRƯỚC khi dựng giao dịch.
  const seed = custodySeedRefFromState(state.reserve?.custodyRef, process.env);
  console.log(`hạt giống custody phải giữ nguyên: ${refKey(seed.ref)} (nguồn: ${seed.source})`);

  const delta = DELTA_LAMP * 1_000_000n;
  console.log(`=== Tx B — DistributionVest → KHO (${NETWORK}) ===`);
  console.log(`lamp_policy: ${wiring.lampPid}`);
  console.log(`KHO addr:    ${wiring.treAddr}`);
  console.log(`Δ = ${DELTA_LAMP} LAMP (${delta} oildrop)\n`);

  const ssU  = theOneHolding(await lucid.utxosAt(wiring.ssAddr),  wiring.threadUnit, "SUPPLY NFT");
  // REG phải đọc ở `Script(regPid)`, KHÔNG phải ở ví: `registry.ak::find_registry_datum` lọc
  // reference input theo NFT **và** theo `payment_credential == Script(policy)`. Tìm nó ở ví thì
  // dựng được tx nhưng validator từ chối — lỗi hiện ra là "Mint[0] validator crashed", không nói
  // một chữ nào về địa chỉ. Nên gác ở đây, hỏng sớm với thông điệp đọc được.
  const atReg = await lucid.utxosAt(wiring.regAddr);
  if (atReg.filter((u) => (u.assets[wiring.regUnit] ?? 0n) === 1n).length !== 1) {
    throw new Error(
      `REG NFT không nằm ở ${wiring.regAddr}. Cổng WHO đòi nó ở ĐÚNG địa chỉ này ` +
      `(registry.ak::find_registry_datum) — ở ví thì cổng KHÔNG mở. Chạy 20b_place_registry.ts.`,
    );
  }
  const regU = theOneHolding(atReg, wiring.regUnit, "REG NFT");
  const khoU = theOneHolding(await lucid.utxosAt(wiring.treAddr), wiring.khoUnit,    "TRSY NFT");

  // Đọc SupplyState THẬT từ chuỗi, không lấy số trong state file: state file là bản ghi
  // của mình, chuỗi mới là sự thật. Lệch nhau thì dừng ở dưới.
  if (!ssU.datum) throw new Error("SupplyState UTxO không có inline datum.");
  const s0 = supplyStateFromCbor(ssU.datum);
  console.log(`SupplyState on-chain: dist=${s0.dist_minted} reserve=${s0.reserve_minted} cap=${s0.dist_cap}/${s0.reserve_cap}`);
  if (s0.dist_minted + delta > s0.dist_cap) {
    throw new Error(`vượt cap Distribution: ${s0.dist_minted} + ${delta} > ${s0.dist_cap}.`);
  }
  const s1 = { ...s0, dist_minted: s0.dist_minted + delta };

  const treasuryBefore = (await lucid.utxosAt(wiring.treAddr))
    .reduce((s, u) => s + (u.assets[wiring.lampUnit] ?? 0n), 0n);

  const tx = await lucid.newTx()
    .collectFrom([ssU], supplyStateRedeemerToCbor())
    .attach.SpendingValidator(scripts.supplyState)
    .mintAssets({ [wiring.lampUnit]: delta }, mintRouteToCbor("DistributionVest"))
    .attach.MintingPolicy(scripts.lampMint)
    // Hai reference input: bảng registry (WHO) + TRSY NFT (WHERE). Chỉ ĐỌC, không tiêu —
    // nên không validator nào của chúng chạy, và cả hai vẫn nguyên cho lượt sau.
    .readFrom([regU, khoU])
    // SupplyState trở lại đúng địa chỉ cũ, CHỈ mang thread NFT + ada
    // (`lamp_mint.ak` luật D3-#1/#3: cấm LAMP bám SupplyState, cấm token lạ, cấm ref script).
    .pay.ToContract(wiring.ssAddr, { kind: "inline", value: supplyStateToCbor(s1) },
      { lovelace: NFT_ADA, [wiring.threadUnit]: 1n })
    // Toàn bộ Δ vào KHO, kèm TreasuryDatum để `treasury.spend` về sau đọc được. Ghi thiếu
    // trường datum thì LAMP vào kho nằm chết — mà LAMP không burn (`Treasury/CONTRACT.md §5`).
    .pay.ToContract(wiring.treAddr, { kind: "inline", value: treasuryDatum(pkh) },
      { lovelace: NFT_ADA, [wiring.lampUnit]: delta })
    .addSigner(walletAddr)                       // authority trong entry registry phải ký
    .complete();

  // Tx B trả ra hai output kèm min-ADA và phí, nên chọn-đồng gần như chắc chắn phải kéo thêm
  // input ngoài các UTxO đã ghim — và không gì ngăn nó trúng hạt giống custody.
  // Cổng đứng TRƯỚC nhánh SUBMIT=false, không nằm sau: lượt chạy khô là lượt diễn tập, nên nó
  // phải phát hiện được đúng thứ mà lượt thật sẽ gặp. Đặt cổng sau nhánh đó thì chạy khô báo
  // xanh cho một giao dịch sẽ ăn mất hạt giống — đúng kiểu xanh vô nghĩa mà cổng sinh ra để chặn.
  assertSeedNotSpent(tx, seed.ref, "Tx B (21 vest → kho)");

  const signed = await tx.sign.withWallet().complete();
  if (!SUBMIT) {
    console.log(
      `\n(SUBMIT=false ⇒ KHÔNG gửi, KHÔNG ghi state.)\n` +
      `Tx dựng xong và ký được; Δ = ${delta} oildrop vào ${wiring.treAddr}.\n` +
      `Hạt giống custody KHÔNG nằm trong input lẫn collateral của giao dịch này.\n` +
      `Gửi thật: SUBMIT=true tsx 21_vest_to_kho.ts`,
    );
    return;
  }

  const hash = await signed.submit();
  console.log(`📤 Tx B: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);

  // GHI SỔ TRƯỚC, ĐỐI CHIẾU SAU. Thứ tự này không phải sở thích: lượt gửi ở trên là bất khả
  // hồi, nên từ đây trở đi mọi nhánh thoát đều phải để lại `hash` trên đĩa. Bản trước đối chiếu
  // trước rồi mới ghi, nên một lần đối chiếu đỏ NHẦM đã ném ở giữa và cuốn sổ ở lại với
  // `dist: "0"` cho một chuỗi đã đúc thật — sổ và chuỗi lệch nhau vĩnh viễn, không ai kêu.
  state.tx.vest = hash;
  state.minted.dist = s1.dist_minted.toString();
  await writeState(state);

  // ── Đối chiếu A-DEST bằng số đo, không bằng "tx đã qua" ──────────────────
  // Hỏi GIAO DỊCH, đừng hỏi bảng tra theo địa chỉ. Bảng UTxO-theo-địa-chỉ nhất quán DẦN: hỏi nó
  // ngay sau `awaitTx` thì một lượt ĐÃ THÀNH CÔNG đọc y hệt một lượt hỏng. Đã xảy ra thật
  // 2026-09-14 — dòng "A-DEST HỎNG: kho chỉ tăng 0" in ra cho giao dịch `47679b09…`, trong khi
  // kho nhận đủ 10.000 LAMP. Bảng địa chỉ vẫn dùng vì nó đo đúng ĐỘ TĂNG RÒNG, thứ mà một mình
  // output của tx không nói được; cái đổi là NHÃN khi nó chưa kịp: "CHƯA ĐO ĐƯỢC" chứ không
  // "HỎNG", và không ném. Ném ở đây là ném SAU một thao tác bất khả hồi — nó không cứu được gì,
  // chỉ bỏ lại một cuốn sổ dở dang.
  // CHỜ bảng bắt kịp thay vì đọc một lần rồi kết luận. Đọc một lần thì trạng thái mù là ca THƯỜNG
  // GẶP, và một cảnh báo lần nào cũng in ra sẽ dạy người đọc lướt qua nó — đến lượt nó đúng thì
  // nó nằm giữa những lần nó sai. Chờ xong mới mù thì mù mới mang đúng mức của mù.
  try {
    const treasuryDelta = await waitFor(
      `kho tăng ≥ ${delta} oildrop`,
      async () => (await lucid.utxosAt(wiring.treAddr))
        .reduce((s, u) => s + (u.assets[wiring.lampUnit] ?? 0n), 0n) - treasuryBefore,
      (d) => d >= delta,
    );
    console.log(`\nKHO: +${treasuryDelta} oildrop`);
    console.log(`✓ A-DEST: toàn bộ Δ vào kho, không đồng nào ra ví.`);
  } catch (e) {
    // Cùng ba trạng thái như ở `22_reserve_draw.ts`: hết giờ chờ là CHƯA ĐO ĐƯỢC, mọi ngoại lệ
    // khác (nhà cung cấp trả rác, đơn vị tài sản sai hình dạng) là HỎNG THẬT.
    const msg = e instanceof Error ? e.message : String(e);
    if (isWaitTimeout(e)) {
      process.exitCode = 2;
      console.log(
        `\n⚠ A-DEST CHƯA ĐO ĐƯỢC (không phải "hỏng"): bảng UTxO theo địa chỉ chưa trả đủ +${delta}.\n` +
        `  ${msg}\n` +
        `  Giao dịch ĐÃ gửi và đã ghi vào sổ. Đo lại bằng chính nó: ${explorerTx(hash)}\n` +
        `  Hoặc chạy: tsx verify_canonical_v2.ts (mục "KHO A-DEST").`,
      );
    } else {
      process.exitCode = 1;
      console.error(
        `\n❌ HỎNG khi đọc lại kho — KHÔNG phải chỉ mục chậm:\n` +
        `  ${msg}\n` +
        `  Giao dịch ĐÃ gửi (${hash}) và đã ghi vào sổ. ĐỪNG chạy bước kế trước khi hiểu dòng trên.`,
      );
    }
  }
  if (process.exitCode === undefined) {
    console.log(`\n✅ Xong. Bước kế: tsx 22_reserve_draw.ts (nhánh đã CHẾT trên mainnet).`);
  } else {
    console.log(`\nKHÔNG in "Xong": xem dòng ⚠/❌ ở trên. Mã thoát ${process.exitCode}.`);
  }
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
