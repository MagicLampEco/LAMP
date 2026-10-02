// park_custody_seed.ts — đỗ một hạt giống custody (5 ADA) ở địa chỉ ENTERPRISE của chính khoá vận hành.
//
// Vì sao enterprise: hạt giống custody nướng vào khe #13 của `lamp_mint` ở Tx A, rồi phải sống
// qua mọi giao dịch tới lượt Lớp 2 tiêu nó. Ví (`lucid.wallet().getUtxos()`) chỉ thấy địa chỉ BASE,
// nên một UTxO ở enterprise của cùng khoá nằm ngoài coin-selection tự do của mọi bước — mà khoá
// vẫn ký tiêu được nó khi cần (`findOwnedCustodySeed`).
//
// Giao dịch tiêu ĐÚNG một input chọn tường minh (`PARK_FROM_TX/IDX`) và tắt coin-selection: ví vận
// hành có thể đang giữ hạt giống của cụm khác hoặc marker, không được để thư viện tự nhặt.
//
// Chạy:
//   NETWORK=Preprod tsx park_custody_seed.ts                                  # liệt kê UTxO ví, không dựng gì
//   NETWORK=Preprod PARK_FROM_TX=… PARK_FROM_IDX=… tsx park_custody_seed.ts   # dựng + in, không gửi
//   … SUBMIT=true tsx park_custody_seed.ts                                    # gửi, in outref hạt giống
import { credentialToAddress } from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, makeLucid, walletPkh, explorerTx } from "./config.js";
import { refKey } from "./_custodySeedRef.js";

const SEED_ADA = 5_000_000n;

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: đỗ hạt giống mainnet đi theo runbook mainnet, không theo script này.");
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const enterprise = credentialToAddress(NETWORK, { type: "Key", hash: pkh });
  const utxos = await lucid.wallet().getUtxos();

  const fromTx = (process.env.PARK_FROM_TX ?? "").trim().toLowerCase();
  const fromIdx = (process.env.PARK_FROM_IDX ?? "").trim();
  if (!fromTx) {
    console.log(`ví base — ${utxos.length} UTxO (chọn một UTxO THUẦN ADA không phải hạt giống/marker của cụm khác):`);
    for (const u of utxos) {
      const extra = Object.keys(u.assets).filter((k) => k !== "lovelace");
      console.log(`  ${refKey(u)}  ${(u.assets.lovelace ?? 0n) / 1_000_000n} ADA${extra.length ? `  + ${extra.join(",")}` : ""}`);
    }
    console.log(`\nenterprise đích: ${enterprise}`);
    return;
  }
  if (!/^[0-9a-f]{64}$/.test(fromTx) || !/^[0-9]+$/.test(fromIdx)) {
    throw new Error("PARK-001: PARK_FROM_TX cần 64 hex và PARK_FROM_IDX cần số nguyên không âm.");
  }
  const input = utxos.find((u) => u.txHash === fromTx && u.outputIndex === Number(fromIdx));
  if (!input) throw new Error(`PARK-002: ${fromTx}#${fromIdx} không có trong ví base lúc này.`);
  if (Object.keys(input.assets).length !== 1) {
    throw new Error(`PARK-003: ${refKey(input)} mang token — có thể là marker/hạt giống của cụm khác. Chọn UTxO thuần ADA.`);
  }
  if ((input.assets.lovelace ?? 0n) < SEED_ADA + 3_000_000n) {
    throw new Error(`PARK-004: ${refKey(input)} quá nhỏ để trả ${SEED_ADA / 1_000_000n} ADA + phí + tiền thừa.`);
  }

  const tx = await lucid.newTx()
    .collectFrom([input])
    .pay.ToAddress(enterprise, { lovelace: SEED_ADA })
    .complete({ coinSelection: false });
  const signed = await tx.sign.withWallet().complete();
  const hash = signed.toHash();
  console.log(`input: ${refKey(input)}\nđích: ${enterprise}\ntx (dựng): ${hash}`);
  if (!SUBMIT) {
    console.log("\n(SUBMIT=false ⇒ KHÔNG gửi.)");
    return;
  }
  await signed.submit();
  console.log(`📤 ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);
  const seed = (await lucid.utxosAt(enterprise)).find((u) => u.txHash === hash && u.assets.lovelace === SEED_ADA);
  if (!seed) throw new Error(`PARK-005: tx ${hash} đã lên nhưng không thấy output ${SEED_ADA} lovelace ở enterprise — đọc lại bằng explorer.`);
  console.log(`✅ hạt giống custody: CUSTODY_SEED_TX=${seed.txHash} CUSTODY_SEED_IDX=${seed.outputIndex}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
