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
//   NETWORK=Preprod STEP=pay-pot PAY_OILDROP=… POT_SHARE_OILDROP=… POT_OUTPUTS=… \
//     POT_ADDRESS=addr_test1w… POT_SCRIPT_HASH=<hex28> POT_DATUM_CBOR=<cbor> tsx 31_preprod_dev_pot.ts
//     (chi thẳng vào kho script của nhà khác — lý do ở hàm `payPot`)
import { getAddressDetails, coreToTxOutput, type LucidEvolution, type UTxO } from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, makeLucid, walletPkh, explorerTx } from "./config.js";
import { rehydrate } from "./_canonical_v2.js";
import {
  requireField, positiveBig, potTargetFromEnv, potOutputAssets, potOutputFailures, unitAt, type OutputShape,
} from "./_potShape.js";
import { preprodDevPot, DEV_POT_DATUM_CBOR } from "../offchain/src/preprodDevPot.js";
import { splitPotOutputs } from "../../Distribution/offchain/src/fundPotBuilder.js";

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

  if (STEP === "pay-pot") return payPot(lucid, pkh, pot, utxos, wiring.lampUnit);
  if (STEP !== "pay") throw new Error(`DEVPOT-010: STEP phải là 'address', 'pay' hoặc 'pay-pot' (đang '${STEP}').`);
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

/** Chọn ÍT UTxO nhất đủ trả `need`: lớn trước. */
function pickLargest(utxos: UTxO[], unit: string, need: bigint): { picked: UTxO[]; sum: bigint } {
  const sorted = utxos
    .filter((u) => (u.assets[unit] ?? 0n) > 0n)
    .sort((a, b) => Number((b.assets[unit] ?? 0n) - (a.assets[unit] ?? 0n)));
  const picked: UTxO[] = [];
  let sum = 0n;
  for (const u of sorted) {
    if (sum >= need) break;
    picked.push(u);
    sum += u.assets[unit] ?? 0n;
  }
  return { picked, sum };
}

/**
 * STEP=pay-pot — chi từ pot development thay thế THẲNG vào kho script của một nhà khác (vd kho
 * Wakeme dựng lại), không qua kho Treasury. Lý do có đường này: một pot đã rót trọn ngân sách từ
 * kho Treasury (FPB-001) thì không rót lần hai từ đó được; khi nhà nhận dựng lại kho trên mạng thử,
 * tiền thử đi từ pot development — ngân sách pot kia trong sổ không bị vượt.
 *
 * Hình dạng đích khai bằng POT_ADDRESS + POT_SCRIPT_HASH + POT_DATUM_CBOR, soát bằng đúng các cổng
 * của `fund_pot.ts` (`_potShape.ts`). Mỗi output = bội của POT_SHARE_OILDROP (`splitPotOutputs`),
 * inline datum, chỉ {ADA, LAMP}. Đọc lại giao dịch ĐÃ DỰNG trước khi ký.
 */
async function payPot(lucid: LucidEvolution, pkh: string, pot: ReturnType<typeof preprodDevPot>,
                      utxos: UTxO[], lampUnit: string): Promise<void> {
  const target = potTargetFromEnv(process.env, 0);
  const share = positiveBig("POT_SHARE_OILDROP", requireField("POT_SHARE_OILDROP", process.env.POT_SHARE_OILDROP));
  const k = Number(positiveBig("POT_OUTPUTS", requireField("POT_OUTPUTS", process.env.POT_OUTPUTS)));
  if (!Number.isSafeInteger(k)) throw new Error(`DEVPOT-020: POT_OUTPUTS quá lớn.`);
  if (PAY_OILDROP <= 0n) throw new Error(`DEVPOT-012: PAY_OILDROP phải > 0 (đang ${PAY_OILDROP}).`);
  if (target.address === pot.address) throw new Error(`DEVPOT-021: đích là chính pot development.`);
  const amounts = splitPotOutputs(PAY_OILDROP, share, k);   // ném nếu không phải bội của suất

  const { picked, sum } = pickLargest(utxos, lampUnit, PAY_OILDROP);
  if (sum < PAY_OILDROP) throw new Error(`DEVPOT-015: pot giữ không đủ ${PAY_OILDROP} oildrop.`);

  let tx = lucid.newTx().collectFrom(picked).attach.SpendingValidator(pot.script);
  for (const a of amounts) {
    tx = tx.pay.ToContract(target.address, { kind: "inline", value: target.datumCbor },
      potOutputAssets(POT_LOVELACE, lampUnit, a));
  }
  const rest = sum - PAY_OILDROP;
  if (rest > 0n) {
    tx = tx.pay.ToContract(pot.address, { kind: "inline", value: DEV_POT_DATUM_CBOR },
      { lovelace: POT_LOVELACE, [lampUnit]: rest });
  }
  const built = await tx.addSignerKey(pkh).complete();

  // Đọc lại giao dịch đã dựng: đúng k output ở đích, mỗi cái đúng lượng + datum, tổng đúng.
  const outs = built.toTransaction().body().outputs();
  const shaped: OutputShape[] = [];
  for (let i = 0; i < outs.len(); i++) shaped.push(coreToTxOutput(outs.get(i)));
  const atTarget = shaped.filter((o) => o.address === target.address);
  const fails: string[] = [];
  if (atTarget.length !== amounts.length) fails.push(`${atTarget.length} output ở đích, dựng ${amounts.length}`);
  atTarget.forEach((o, i) => fails.push(...potOutputFailures(o, { lampUnit, amount: amounts[i]!, datumCbor: target.datumCbor })
    .map((f) => `#${i}: ${f}`)));
  if (unitAt(shaped, target.address, lampUnit) !== PAY_OILDROP) fails.push(`tổng ở đích ≠ ${PAY_OILDROP}`);
  if (fails.length > 0) throw new Error(`DEVPOT-022: giao dịch đã dựng lệch hình dạng — ${fails.join("; ")}`);

  console.log(`Chi từ pot development → kho ${target.address}: ${PAY_OILDROP} oildrop, ${amounts.length} output ` +
    `(bội của ${share}), datum ${target.datumCbor}. Pot: ${picked.length} UTxO vào, ${rest} quay về.`);
  if (!SUBMIT) {
    console.log(`(SUBMIT=false ⇒ KHÔNG ký, KHÔNG gửi.) Hash thân giao dịch: ${built.toHash()}`);
    return;
  }
  const signed = await built.sign.withWallet().complete();
  const hash = await signed.submit();
  console.log(`📤 Chi pot development → kho: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);
  console.log(`✅ Đã vào block.`);
}

main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
