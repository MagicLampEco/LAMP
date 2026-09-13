// 00_split_utxos — tách ví deploy thành NHIỀU UTxO trước khi chạy bất kỳ bước one-shot nào.
//
// VÌ SAO CẦN: mỗi policy one-shot ăn MỘT OutputReference riêng và tiêu nó (thread_nft ·
// oneshot registry · custody_seed · reserve_thread…). Ví chỉ có một UTxO thì hạt giống
// genesis và hạt giống custody buộc phải là cùng một ref, và cổng `SEED-002` /
// `CUSTODY-SEED-004` ở `20_canonical_genesis.ts` chặn đúng ca đó. Nên bước vận hành ĐẦU
// TIÊN là một tx tự-trả, không phải tx đúc.
//
// MẶC ĐỊNH KHÔNG GỬI. `SUBMIT=false` (mặc định) chỉ in trạng thái ví + kế hoạch tách.
//
// Chạy (đặt biến NGAY TRƯỚC lệnh — bí mật sống trong đúng một tiến trình, không đi qua tệp nào):
//   NETWORK=Preprod BLOCKFROST_KEY=… WALLET_SEED="…" tsx 00_split_utxos.ts
//   thêm SUBMIT=true để gửi thật.
//
// Tham số:
//   SPLIT_COUNT  — số UTxO hạt giống cần tạo (mặc định 6)
//   SPLIT_ADA    — mỗi UTxO bao nhiêu ADA (mặc định 500)

import { Blockfrost, Lucid, type LucidEvolution } from "@lucid-evolution/lucid";

const NETWORK = (process.env.NETWORK ?? "Preview") as "Preprod" | "Preview" | "Mainnet";
const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? "";
const WALLET_SEED = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const SUBMIT = (process.env.SUBMIT ?? "false").toLowerCase() === "true";

const SPLIT_COUNT = Number(process.env.SPLIT_COUNT ?? "6");
const SPLIT_ADA = BigInt(process.env.SPLIT_ADA ?? "500");
const SPLIT_LOVELACE = SPLIT_ADA * 1_000_000n;

// Dư ra cho phí + change. Một tx 6 output trên Preprod tốn dưới 0,3 ADA; để rộng 5 ADA.
const HEADROOM = 5_000_000n;

function explorerTx(hash: string): string {
  const host =
    NETWORK === "Mainnet" ? "cexplorer.io"
    : NETWORK === "Preprod" ? "preprod.cexplorer.io"
    : "preview.cexplorer.io";
  return `https://${host}/tx/${hash}`;
}

async function makeLucid(): Promise<LucidEvolution> {
  if (!BLOCKFROST_KEY) {
    throw new Error(
      "SPLIT-001: thiếu BLOCKFROST_KEY. Đặt nó ngay trước lệnh, đừng ghi vào tệp nào trong kho.",
    );
  }
  if (!PRIVATE_KEY && !WALLET_SEED) {
    throw new Error("SPLIT-002: thiếu WALLET_SEED (hoặc PRIVATE_KEY). Đặt ngay trước lệnh.");
  }
  const lucid = await Lucid(
    new Blockfrost(`https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`, BLOCKFROST_KEY),
    NETWORK,
  );
  if (PRIVATE_KEY) lucid.selectWallet.fromPrivateKey(PRIVATE_KEY);
  else lucid.selectWallet.fromSeed(WALLET_SEED);
  return lucid;
}

async function main(): Promise<void> {
  if (!Number.isInteger(SPLIT_COUNT) || SPLIT_COUNT < 1 || SPLIT_COUNT > 20) {
    throw new Error(`SPLIT-003: SPLIT_COUNT phải là số nguyên trong [1,20], nhận "${SPLIT_COUNT}".`);
  }

  const lucid = await makeLucid();
  const addr = await lucid.wallet().address();
  const utxos = await lucid.wallet().getUtxos();
  const balance = utxos.reduce((s, u) => s + u.assets.lovelace, 0n);

  console.log(`=== 00_split_utxos (${NETWORK}) === SUBMIT=${SUBMIT}\n`);
  console.log(`ví    : ${addr}`);
  console.log(`số dư : ${balance / 1_000_000n} ADA trên ${utxos.length} UTxO`);
  for (const u of utxos) {
    const extra = Object.keys(u.assets).filter((k) => k !== "lovelace");
    console.log(
      `        ${u.txHash}#${u.outputIndex}  ${u.assets.lovelace / 1_000_000n} ADA` +
        (extra.length ? `  + ${extra.length} asset khác` : ""),
    );
  }
  console.log();

  // Cổng này ĐẾM UTxO chỉ-ADA. Một UTxO mang token không dùng làm hạt giống one-shot được
  // một cách vô hại: tiêu nó là kéo theo token đó vào tx, và mọi cổng "đúng-một-tên" ở
  // nhánh mint sẽ đọc thấy thứ nó không mong đợi.
  const plainAda = utxos.filter((u) => Object.keys(u.assets).length === 1);
  if (plainAda.length >= SPLIT_COUNT) {
    console.log(
      `✓ Ví đã có ${plainAda.length} UTxO chỉ-ADA ≥ ${SPLIT_COUNT} cần thiết. KHÔNG cần tách.`,
    );
    return;
  }

  const need = SPLIT_LOVELACE * BigInt(SPLIT_COUNT) + HEADROOM;
  if (balance < need) {
    throw new Error(
      `SPLIT-004: cần ≥ ${need / 1_000_000n} ADA để tạo ${SPLIT_COUNT} × ${SPLIT_ADA} ADA + phí; ` +
        `ví đang có ${balance / 1_000_000n} ADA. Hạ SPLIT_COUNT hoặc SPLIT_ADA.`,
    );
  }

  console.log(`Kế hoạch: tự-trả ${SPLIT_COUNT} output × ${SPLIT_ADA} ADA về chính ví trên.`);

  let tx = lucid.newTx();
  for (let i = 0; i < SPLIT_COUNT; i++) {
    tx = tx.pay.ToAddress(addr, { lovelace: SPLIT_LOVELACE });
  }
  const completed = await tx.complete();

  if (!SUBMIT) {
    console.log(
      `\n(SUBMIT=false ⇒ KHÔNG gửi. Tx đã dựng và eval xong — ` +
        `phí ${completed.toTransaction().body().fee()} lovelace.)\n` +
        `Gửi thật: thêm SUBMIT=true vào cùng dòng lệnh.`,
    );
    return;
  }

  const signed = await completed.sign.withWallet().complete();
  const hash = await signed.submit();
  console.log(`\n✓ đã gửi: ${hash}`);
  console.log(`  ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);
  const after = await lucid.wallet().getUtxos();
  console.log(`✓ xác nhận. Ví nay có ${after.length} UTxO.`);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
