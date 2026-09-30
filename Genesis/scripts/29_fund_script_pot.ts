// 29_fund_script_pot.ts — rót LAMP từ ví vận hành vào KHO SCRIPT của một pot, bằng một lượt
// chuyển thường.
//
// Đây là bước cuối của đường "kho Distribution → Redeem về ví → chuyển thường tới pot". Đường
// `send` của `28_beacon_grant_redeem.ts` cố ý từ chối mọi đích là script (SEND-003): rót vào kho
// script mà không biết hình dạng UTxO kho đó nhận là rót mù. Runner này đòi người chạy NÓI RA
// hình dạng đó, và soát lại từng phần trước khi ký.
//
// Rót đúng ĐỊA CHỈ chưa phải rót vào SỔ. Một kho script nhận ra tài sản của nó bằng cái mà
// validator của nó đọc (datum, NFT, hình dạng value), không bằng địa chỉ. Nên trước khi gửi,
// người chạy phải trả lời được: "sau giao dịch này, nhánh nào của validator pot tiêu lại được
// UTxO vừa tạo, và điều kiện nào của nó được thoả?". Runner không trả lời hộ câu đó — nó chỉ
// bảo đảm UTxO tạo ra có ĐÚNG hình dạng người chạy khai.
//
// Hình dạng UTxO tạo ra:
//   địa chỉ  = POT_ADDRESS, payment credential là Script và hash == POT_SCRIPT_HASH (khai hai lần
//              để một lỗi gõ ở một chỗ không lọt qua);
//   value    = đúng {lovelace, LAMP} — không asset nào khác;
//   datum    = InlineDatum(POT_DATUM_CBOR) — BẮT BUỘC, không mặc định.
//
// Chạy (mặc định CHỈ DỰNG, không ký, không gửi):
//   NETWORK=Preprod LAMP_POLICY_ID=<pid> LAMP_ASSET_NAME=<hex> \
//   POT_ADDRESS=<addr> POT_SCRIPT_HASH=<hex28> POT_DATUM_CBOR=<cbor> AMOUNT_OILDROP=<n> \
//     tsx 29_fund_script_pot.ts
//   … thêm SUBMIT=true để ký và gửi.
//
// Mainnet bị chặn: cũng như 20–28, đây là công cụ diễn tập cho tới khi đường rót pot trên
// Mainnet được duyệt.

// Cổng soát hình dạng (đích, datum, value, output đã dựng/đã lên chuỗi) nằm ở `_potShape.ts`,
// dùng chung với `30_feeder_accounts.ts` STEP=fundpot — một cổng, một bản.
import { toUnit, coreToTxOutput } from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, makeLucid, explorerTx } from "./config.js";
import {
  requireField, hexField, positiveBig, potTargetFromEnv, potOutputAssets, assertPotOutputs,
  type OutputShape,
} from "./_potShape.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") {
    throw new Error("POT-FUND-000: CHẶN trên Mainnet — runner này là công cụ diễn tập.");
  }

  // Mainnet đã bị chặn ở trên ⇒ mọi mạng còn lại là testnet (networkId 0).
  const pot = potTargetFromEnv(process.env, 0);
  const potAddress = pot.address;
  const potHash = pot.scriptHash;
  const datumCbor = pot.datumCbor;
  const req = (name: string): string => requireField(name, process.env[name]);
  const lampPolicy = hexField("LAMP_POLICY_ID", req("LAMP_POLICY_ID"), 28);
  const lampName = hexField("LAMP_ASSET_NAME", req("LAMP_ASSET_NAME"));
  const amount = positiveBig("AMOUNT_OILDROP", req("AMOUNT_OILDROP"));
  const lovelace = positiveBig("POT_LOVELACE", process.env.POT_LOVELACE ?? "2000000");

  const lucid = await makeLucid();
  const lampUnit = toUnit(lampPolicy, lampName);
  const walletLamp = (await lucid.wallet().getUtxos()).reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  if (walletLamp < amount) {
    throw new Error(`POT-FUND-009: ví có ${walletLamp} oildrop LAMP, cần ${amount}.`);
  }

  console.log(`═══ Rót kho script (${NETWORK}) ═══`);
  console.log(`Đích:        ${potAddress}`);
  console.log(`Script hash: ${potHash}  (khớp địa chỉ)`);
  console.log(`LAMP:        ${amount} oildrop  (ví có ${walletLamp})`);
  console.log(`lovelace:    ${lovelace} (Lucid có thể nâng lên min-ADA)`);
  console.log(`Datum:       InlineDatum ${datumCbor}`);

  const tx = await lucid.newTx()
    .pay.ToContract(potAddress, { kind: "inline", value: datumCbor }, potOutputAssets(lovelace, lampUnit, amount))
    .complete();

  // Soát giao dịch ĐÃ DỰNG, không tin value đã khai: đúng 1 output ở pot, đúng hình dạng.
  const outs = tx.toTransaction().body().outputs();
  const built: OutputShape[] = [];
  for (let i = 0; i < outs.len(); i++) built.push(coreToTxOutput(outs.get(i)));
  assertPotOutputs(built, potAddress, { lampUnit, amount, datumCbor }, "POT-FUND-010");

  if (!SUBMIT) {
    console.log("\n(SUBMIT=false ⇒ KHÔNG ký, KHÔNG gửi.) Hash thân giao dịch: " + tx.toHash());
    return;
  }
  const h = await (await tx.sign.withWallet().complete()).submit();
  console.log(`\n📤 ${h}\n   ${explorerTx(h)}`);
  await lucid.awaitTx(h);
  await sleep(20_000);

  // ── Đối chiếu trên chuỗi: UTxO vừa tạo có đúng hình dạng đã khai ──────────
  const made = (await lucid.utxosAt(potAddress)).filter((u) => u.txHash === h);
  assertPotOutputs(made, potAddress, { lampUnit, amount, datumCbor }, "POT-FUND-VERIFY-001");
  console.log(`✅ Đối chiếu trên chuỗi: 1 UTxO · ${amount} oildrop LAMP · chỉ {ada, LAMP} · datum đúng.`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
