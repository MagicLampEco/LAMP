// 27_refill_treasury.ts — gộp các UTxO ở địa chỉ KHO về MỘT singleton (nhánh `Refill`).
//
// VÌ SAO CÓ BƯỚC NÀY. `21_vest_to_kho.ts` rót LAMP vào kho qua A-DEST. LAMP hạ cánh thành một
// UTxO RIÊNG, không mang NFT "TRSY". Kể từ lúc đó địa chỉ kho có HAI UTxO: một mang TRSY và
// không có LAMP, một mang LAMP và không có TRSY. `claim_account.ak:210-223` đòi đúng MỘT input
// kho MANG TRSY ⇒ nhánh Redeem buộc tiêu cái vỏ rỗng ⇒ giải ngân bằng 0. Tài sản nằm TRONG SÂN
// kho và NGOÀI SỔ kho.
//
// Đo trên Preprod 2026-09-15 (Koios `address_utxos`, `addr_test1wqcnq8kk…`): đúng hình dạng đó,
// 10.000.000.000 oildrop ở UTxO không TRSY. `Refill` là nhánh DUY NHẤT gộp lại được.
//
// KHÔNG TỰ CHỌN INPUT. Script này LIỆT KÊ những gì đang ở địa chỉ kho rồi DỪNG, trừ khi người
// vận hành nêu đích danh từng UTxO qua `REFILL_INPUTS`. Cố ý: ai cũng đỗ được một UTxO ở địa
// chỉ script (Cardano không chạy validator lúc TẠO), nên một UTxO mang datum-hash do người lạ
// đặt vào sẽ làm `fold_ledger` (`treasury.ak:306`) `fail` cho mọi tx gộp quét-tất-cả. Quét =
// mời người lạ khoá vĩnh viễn nhánh cứu kho.
//
// Chạy:
//   NETWORK=Preprod tsx 27_refill_treasury.ts                       # liệt kê rồi dừng
//   NETWORK=Preprod REFILL_INPUTS="<tx>#<ix>,<tx>#<ix>" tsx 27_refill_treasury.ts
//   NETWORK=Preprod REFILL_INPUTS="…" SUBMIT=true tsx 27_refill_treasury.ts   # gửi thật
import { type UTxO } from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, makeLucid, walletPkh, explorerTx } from "./config.js";
import {
  rehydrate, canonicalCommittee, CANONICAL_COMMITTEE_THRESHOLD,
} from "./_canonical_v2.js";
import { buildRefillTx } from "../../Distribution/offchain/src/refillBuilder.js";

/** LAMP nạp THÊM từ ví, đơn vị oildrop. Mặc định 0 — thuần gộp. */
const DEPOSIT_OILDROP = BigInt(process.env.REFILL_DEPOSIT_OILDROP ?? "0");

const refKey = (u: UTxO) => `${u.txHash}#${u.outputIndex}`;

function describe(u: UTxO, lampUnit: string, khoUnit: string): string {
  const lovelace = u.assets["lovelace"] ?? 0n;
  const lamp = u.assets[lampUnit] ?? 0n;
  const trsy = u.assets[khoUnit] ?? 0n;
  const shape = u.datum ? "inline datum" : u.datumHash ? "DATUM-HASH (không gộp được)" : "không datum";
  return `${refKey(u)}  ${lovelace} lovelace · ${lamp} oildrop · TRSY×${trsy} · ${shape}`;
}

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const { wiring, scripts } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);

  const all = await lucid.utxosAt(wiring.treAddr);
  console.log(`=== Refill — gộp kho về singleton (${NETWORK}) ===`);
  console.log(`Địa chỉ kho: ${wiring.treAddr}`);
  console.log(`Có ${all.length} UTxO ở đó:\n`);
  for (const u of all) console.log(`  · ${describe(u, wiring.lampUnit, wiring.khoUnit)}`);

  const named = (process.env.REFILL_INPUTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (named.length === 0) {
    console.log(
      `\nDỪNG: chưa nêu input. Script này KHÔNG tự chọn — xem lý do ở đầu tệp.\n` +
      `Nêu đích danh rồi chạy lại:\n` +
      `  REFILL_INPUTS="${all.map(refKey).join(",")}" tsx 27_refill_treasury.ts`,
    );
    return;
  }

  // Tra theo tên, KHÔNG lọc theo thuộc tính: một UTxO được nêu mà không tìm thấy là một sai
  // lệch giữa điều người vận hành TIN và điều đang có trên chuỗi. Bỏ qua lặng lẽ thì tx vẫn
  // dựng được với tập nhỏ hơn, và cái hụt chỉ lộ ra khi kho vẫn kẹt sau khi "đã gộp".
  const byKey = new Map(all.map((u) => [refKey(u), u]));
  const picked: UTxO[] = [];
  for (const k of named) {
    const u = byKey.get(k);
    if (!u) {
      throw new Error(
        `REFILL-001: không thấy '${k}' ở địa chỉ kho. Nó đã bị tiêu, hoặc gõ sai, hoặc thuộc ` +
        `một lần triển khai khác. Đối chiếu lại danh sách in ở trên.`,
      );
    }
    picked.push(u);
  }

  const result = await buildRefillTx({
    lucid,
    treasuryUtxos:      picked,
    treasuryScript:     scripts.treasury,
    committeeSigners:   canonicalCommittee(wiring.pkh),
    committeeThreshold: Number(CANONICAL_COMMITTEE_THRESHOLD),
    lampPolicyId:       wiring.lampPid,
    lampAssetName:      wiring.tokenName,
    treasuryNftPolicy:  wiring.markers.khoPid,
    depositOildrop:     DEPOSIT_OILDROP,
  });

  console.log(`\n${result.summary}`);

  const signed = await result.tx.sign.withWallet().complete();
  if (!SUBMIT) {
    console.log(
      `\n(SUBMIT=false ⇒ KHÔNG gửi.)\n` +
      `Tx dựng xong và ký được. CBOR:\n${signed.toCBOR()}\n\n` +
      `Gửi thật: SUBMIT=true REFILL_INPUTS="${named.join(",")}" tsx 27_refill_treasury.ts`,
    );
    return;
  }

  const hash = await signed.submit();
  console.log(`\n📤 Refill: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);

  // Đối chiếu bằng CHÍNH chuỗi, không tin vào việc tx đã gửi. Ba trạng thái, không phải hai:
  // đúng singleton mang đủ TRSY + LAMP · còn nhiều UTxO (gộp thiếu) · đọc không ra (chỉ mục chậm).
  const after = await lucid.utxosAt(wiring.treAddr);
  console.log(`\nSau khi gộp, địa chỉ kho có ${after.length} UTxO:`);
  for (const u of after) console.log(`  · ${describe(u, wiring.lampUnit, wiring.khoUnit)}`);

  const carrier = after.filter((u) => (u.assets[wiring.khoUnit] ?? 0n) === 1n);
  if (carrier.length !== 1) {
    process.exitCode = 1;
    console.error(
      `\n❌ Không còn đúng 1 UTxO mang TRSY (đếm ${carrier.length}). ĐỪNG chạy bước kế.`,
    );
    return;
  }
  const lamp = carrier[0]!.assets[wiring.lampUnit] ?? 0n;
  if (lamp !== result.lampAfter) {
    process.exitCode = 1;
    console.error(
      `\n❌ UTxO mang TRSY giữ ${lamp} oildrop, dựng ra là ${result.lampAfter}. Lệch ⇒ dừng.`,
    );
    return;
  }
  console.log(
    `\n✅ Kho về singleton: 1 UTxO mang TRSY và ${lamp} oildrop.\n` +
    `   Nhánh Redeem nay đọc được đúng UTxO này (claim_account.ak:210-223).`,
  );
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
