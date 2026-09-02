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
import { NETWORK, makeLucid, walletPkh, explorerTx } from "./config.js";
import { supplyStateToCbor, supplyStateFromCbor, supplyStateRedeemerToCbor, mintRouteToCbor } from "../offchain/src/datum.js";
import { rehydrate, treasuryDatum, writeState } from "./_canonical_v2.js";

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

  const delta = DELTA_LAMP * 1_000_000n;
  console.log(`=== Tx B — DistributionVest → KHO (${NETWORK}) ===`);
  console.log(`lamp_policy: ${wiring.lampPid}`);
  console.log(`KHO addr:    ${wiring.treAddr}`);
  console.log(`Δ = ${DELTA_LAMP} LAMP (${delta} oildrop)\n`);

  const ssU  = theOneHolding(await lucid.utxosAt(wiring.ssAddr),  wiring.threadUnit, "SUPPLY NFT");
  const regU = theOneHolding(await lucid.wallet().getUtxos(),     wiring.regUnit,    "REG NFT");
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

  const khoBefore = (await lucid.utxosAt(wiring.treAddr))
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

  const hash = await (await tx.sign.withWallet().complete()).submit();
  console.log(`📤 Tx B: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);

  // ── Đối chiếu A-DEST bằng số đo, không bằng "tx đã qua" ──────────────────
  const khoAfter = (await lucid.utxosAt(wiring.treAddr))
    .reduce((s, u) => s + (u.assets[wiring.lampUnit] ?? 0n), 0n);
  const grew = khoAfter - khoBefore;
  console.log(`\nKHO: ${khoBefore} → ${khoAfter} oildrop (tăng ${grew})`);
  if (grew < delta) throw new Error(`A-DEST HỎNG: kho chỉ tăng ${grew}, cần ≥ ${delta}.`);
  console.log(`✓ A-DEST: toàn bộ Δ vào kho, không đồng nào ra ví.`);

  state.tx.vest = hash;
  state.minted.dist = s1.dist_minted.toString();
  await writeState(state);
  console.log(`\n✅ Xong. Bước kế: tsx 22_reserve_draw.ts (nhánh đã CHẾT trên mainnet).`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
