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
import { assertRefillOutputMatches } from "./_refillReadback.js";
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
    // Chỉ gợi ý những UTxO GỘP ĐƯỢC. Dán CẢ danh sách thô = đúng chế độ quét-tất-cả mà đầu tệp
    // đã loại: ai cũng đỗ được một UTxO ở địa chỉ script công khai này (Cardano không chạy
    // validator lúc TẠO). Người vận hành đang cứu kho là người có lý do NHẤT để dán nguyên cái
    // script đưa cho họ — không phải chỗ để đặt cược vào sự cẩn thận của con người.
    const goiY = all.filter((u) => !u.datumHash || u.datum);
    const bo = all.filter((u) => u.datumHash && !u.datum);
    if (bo.length) {
      console.log(`\n⚠️  ${bo.length} UTxO mang DATUM-HASH — không tx nào gộp được (fold_ledger fail), đã loại khỏi gợi ý:`);
      for (const u of bo) console.log(`  · ${refKey(u)}`);
    }
    console.log(
      `\nDỪNG: chưa nêu input. Script này KHÔNG tự chọn — xem lý do ở đầu tệp.\n` +
      `Soát TỪNG dòng dưới đây trước khi dán — địa chỉ kho là công khai, người lạ đặt được UTxO vào:\n` +
      `  REFILL_INPUTS="${goiY.map(refKey).join(",")}" tsx 27_refill_treasury.ts`,
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

  // RFL-010: đọc lại giao dịch ĐÃ DỰNG trước khi ký hay in bất cứ gì — `summary` ở trên in số
  // builder đã TÍNH, không phải số Lucid thật sự DỰNG (xem `_refillReadback.ts`).
  assertRefillOutputMatches(result.tx, wiring.treAddr, result.outputLovelace);

  if (!SUBMIT) {
    // Cố ý KHÔNG ký và KHÔNG in CBOR. Committee canonical hôm nay là 1-of-1
    // (`_canonical_v2.ts:99-102`) ⇒ chữ ký ví vận hành là ĐỦ, nên một CBOR đã ký đầy đủ dán vào
    // đây là một giao dịch nộp được NGAY bởi bất kỳ ai đọc log này — vào chat đội, vào issue,
    // vào log CI — bất cứ lúc nào trước khi các input bị tiêu, kể cả sau khi đội đã quyết định
    // KHÔNG gộp nữa. Cổng `SUBMIT` chỉ chặn lời gọi `submit()` của TIẾN TRÌNH NÀY; nó không chặn
    // việc phát hành một công cụ mang quyền ra ngoài.
    console.log(
      `\n(SUBMIT=false ⇒ KHÔNG ký, KHÔNG gửi.)\n` +
      `Tx dựng xong. Hash thân giao dịch: ${result.tx.toHash()}\n` +
      `Cố ý KHÔNG in CBOR đã ký: committee 1-of-1 nên CBOR đó nộp được NGAY bởi bất kỳ ai đọc log.\n` +
      `Gửi thật: SUBMIT=true REFILL_INPUTS="${named.join(",")}" tsx 27_refill_treasury.ts`,
    );
    return;
  }

  const signed = await result.tx.sign.withWallet().complete();
  const hash = await signed.submit();
  console.log(`\n📤 Refill: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);

  // Đối chiếu bằng CHÍNH chuỗi, không tin vào việc tx đã gửi. BA trạng thái, không phải hai —
  // và "không đo được" phải kêu KHÁC "hỏng", to hơn "hỏng" (Forall §Cổng gác): đúng singleton
  // mang đủ TRSY + LAMP · còn nhiều UTxO (gộp thiếu, THẬT sự hỏng) · đọc không ra gì (chỉ mục
  // provider trễ sau `awaitTx` — KHÔNG phải "gộp hỏng", tx đã vào block).
  const after = await lucid.utxosAt(wiring.treAddr);
  if (after.length === 0) {
    process.exitCode = 2;
    console.error(
      `\n⚠️  KHÔNG ĐO ĐƯỢC: chỉ mục provider trả 0 UTxO ở địa chỉ kho ngay sau \`awaitTx\`. Đây ` +
      `KHÔNG phải "gộp hỏng" — tx ${hash} đã vào block. Đợi rồi chạy lại script KHÔNG đặt ` +
      `REFILL_INPUTS để chỉ đọc trạng thái, đừng kết luận từ lượt này.`,
    );
    return;
  }
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
