// 31_preprod_dev_pot.ts — pot development thay thế trên mạng thử: in địa chỉ, và chi tLAMP từ
// pot ra ví thường. Lý do có pot này: `Genesis/offchain/src/preprodDevPot.ts` đầu tệp.
//
// Ba bước, theo thứ tự:
//   STEP=address  in địa chỉ + hash + datum của pot — đưa vào `fund_pot.ts` (POT_ID=development).
//   (fund_pot.ts) rót trọn ngân sách pot development từ kho Treasury vào địa chỉ đó.
//   STEP=pay      chi PAY_OILDROP tới PAY_TO (ví payment-key). Phần còn lại QUAY VỀ pot, cùng
//                 datum — không về ví vận hành, để số dư pot luôn đọc được ở một địa chỉ.
//
// SUBMIT=false (mặc định): dựng, không ký, không gửi.
//
//   NETWORK=Preprod STEP=address tsx 31_preprod_dev_pot.ts
//   NETWORK=Preprod STEP=pay PAY_TO=addr_test1q… PAY_OILDROP=100000000 tsx 31_preprod_dev_pot.ts
import { getAddressDetails } from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, makeLucid, walletPkh, explorerTx } from "./config.js";
import { rehydrate } from "./_canonical_v2.js";
import { preprodDevPot, DEV_POT_DATUM_CBOR } from "../offchain/src/preprodDevPot.js";

const STEP = (process.env.STEP ?? "").toLowerCase();
const PAY_TO = (process.env.PAY_TO ?? "").trim();
const PAY_OILDROP = BigInt(process.env.PAY_OILDROP ?? "0");
const PAY_LOVELACE = BigInt(process.env.PAY_LOVELACE ?? "2000000");
const POT_LOVELACE = 2_000_000n;

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: pot development thay thế chỉ dùng trên mạng thử.");
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const { wiring } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);
  const pot = preprodDevPot(NETWORK, pkh);

  const utxos = await lucid.utxosAt(pot.address);
  const held = utxos.reduce((s, u) => s + (u.assets[wiring.lampUnit] ?? 0n), 0n);

  if (STEP === "address") {
    console.log(`POT_ID=development`);
    console.log(`POT_ADDRESS=${pot.address}`);
    console.log(`POT_SCRIPT_HASH=${pot.scriptHash}`);
    console.log(`POT_DATUM_CBOR=${DEV_POT_DATUM_CBOR}`);
    console.log(`Đang giữ: ${held} oildrop tLAMP trong ${utxos.length} UTxO.`);
    return;
  }

  if (STEP !== "pay") throw new Error(`DEVPOT-010: STEP phải là 'address' hoặc 'pay' (đang '${STEP}').`);
  if (!PAY_TO) throw new Error("DEVPOT-011: đặt PAY_TO = địa chỉ ví nhận.");
  if (PAY_OILDROP <= 0n) throw new Error(`DEVPOT-012: PAY_OILDROP phải > 0 (đang ${PAY_OILDROP}).`);
  const det = getAddressDetails(PAY_TO);
  if (det.paymentCredential?.type !== "Key") {
    throw new Error(`DEVPOT-013: ${PAY_TO} không phải ví payment-key — bước này chỉ chi ra ví thường.`);
  }
  if (det.networkId !== 0) throw new Error(`DEVPOT-014: ${PAY_TO} không thuộc mạng thử.`);

  // Chọn ÍT UTxO nhất đủ trả: lớn trước. Không gom cả pot vào một tx — vài UTxO là đủ và tx nhỏ.
  const lampUtxos = utxos
    .filter((u) => (u.assets[wiring.lampUnit] ?? 0n) > 0n)
    .sort((a, b) => Number((b.assets[wiring.lampUnit] ?? 0n) - (a.assets[wiring.lampUnit] ?? 0n)));
  const picked = [];
  let sum = 0n;
  for (const u of lampUtxos) {
    if (sum >= PAY_OILDROP) break;
    picked.push(u);
    sum += u.assets[wiring.lampUnit] ?? 0n;
  }
  if (sum < PAY_OILDROP) {
    throw new Error(`DEVPOT-015: pot giữ ${held} oildrop, cần ${PAY_OILDROP}. Chạy fund_pot.ts POT_ID=development trước.`);
  }

  let tx = lucid.newTx()
    .collectFrom(picked)
    .attach.SpendingValidator(pot.script)
    .pay.ToAddress(PAY_TO, { lovelace: PAY_LOVELACE, [wiring.lampUnit]: PAY_OILDROP });
  const rest = sum - PAY_OILDROP;
  if (rest > 0n) {
    tx = tx.pay.ToContract(pot.address, { kind: "inline", value: DEV_POT_DATUM_CBOR },
      { lovelace: POT_LOVELACE, [wiring.lampUnit]: rest });
  }
  const built = await tx.addSignerKey(pkh).complete();

  console.log(`Chi từ pot development: ${PAY_OILDROP} oildrop → ${PAY_TO}`);
  console.log(`Pot: ${picked.length} UTxO vào, ${rest} oildrop quay về pot.`);
  if (!SUBMIT) {
    console.log(`(SUBMIT=false ⇒ KHÔNG ký, KHÔNG gửi.) Hash thân giao dịch: ${built.toHash()}`);
    return;
  }
  const signed = await built.sign.withWallet().complete();
  const hash = await signed.submit();
  console.log(`📤 Chi pot development: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);
  console.log(`✅ Đã vào block.`);
}

main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
