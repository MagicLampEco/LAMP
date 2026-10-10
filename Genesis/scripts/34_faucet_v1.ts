// 34_faucet_v1.ts — vòi v1 cho tLAMP Preprod: in địa chỉ, đặt reference script, đọc trạng thái pool.
//
// Vòi v1 = `Faucet/onchain/validators/faucet_v1.ak` (permissionless, mỗi Claim nhả đúng
// claim_amount của datum). Máy chủ `Faucet/server/faucetBuild.ts` dựng giao dịch Claim chưa ký cho
// ứng dụng. Tham số validator: (policy tLAMP Preprod ACTIVE, "tLAMP") — policy đọc từ
// `Genesis/offchain/src/lampPolicies.ts` ▸ `activeLampPolicyId("preprod")`, và script ném nếu
// bản chép trong `Faucet/offchain/src/faucetV1.ts` ▸ `FAUCET_V1_PREPROD_TLAMP` lệch nguồn đó.
//
// Các bước:
//   STEP=address  in script hash + địa chỉ pool + datum + DÒNG LỆNH NẠP ĐIỀN SẴN. Không mạng, không khoá.
//   STEP=export-script  ghi `Faucet/server/faucet_v1.preprod.json` (script ĐÃ áp tham số, sinh từ
//                 blueprint) cho máy chủ — máy chủ chạy ở nơi không có aiken, `plutus.json` bị
//                 gitignore. Không mạng, không khoá. Đổi validator ⇒ chạy lại + commit tệp;
//                 `Faucet/tests/faucetServer.test.ts` đỏ khi tệp commit lệch blueprint.
//   STEP=ref      dựng giao dịch đặt reference script vào CHÍNH địa chỉ pool, KHÔNG datum ⇒ khoá
//                 vĩnh viễn (validator ném ở `expect Some(datum)`), không ai tiêu/gỡ được. Cần ví
//                 vận hành + BLOCKFROST_KEY như các runner khác. SUBMIT=false (mặc định): dựng, không ký,
//                 không gửi. Đã có reference script đúng hash ở đó ⇒ in outref rồi dừng.
//   STEP=status   đọc pool qua Koios Preprod công khai (không khoá): số UTxO dùng được, tổng tLAMP,
//                 số lượt claim còn lại, UTxO bị bỏ qua kèm lý do, outref reference script.
//
// NẠP POOL — KHÔNG có mã mới: dùng `31_preprod_dev_pot.ts` STEP=pay-pot (chi từ pot development
// Preprod thẳng vào kho script, soát hình dạng output bằng `_potShape.ts`). Mỗi output pool là
// {2 ADA, suất tLAMP} + datum FaucetDatum{100_000_000}; nhiều output ⇒ nhiều người claim song song
// ít giẫm nhau. Hình dạng lệnh (STEP=address in bản ĐIỀN SẴN hash + địa chỉ, sinh từ blueprint):
//
//   NETWORK=Preprod STEP=pay-pot \
//     PAY_OILDROP=10000000000000 POT_SHARE_OILDROP=500000000000 POT_OUTPUTS=20 \
//     POT_ADDRESS=<địa chỉ pool> POT_SCRIPT_HASH=<script hash> POT_DATUM_CBOR=d8799f1a05f5e100ff \
//     tsx 31_preprod_dev_pot.ts
//   (20 output × 500.000 tLAMP = 10.000.000 tLAMP = 100.000 lượt claim; thêm SUBMIT=true để gửi.)
//
// Giá trị đo 2026-10-10 (aiken v1.1.21, nhánh feat/faucet-v1-tlamp) — CHỈ để đối chiếu, nguồn là
// STEP=address: script hash 75e87583f0e8ede310f8d230f6d320ded5a920761fa9e4c23689356a,
// địa chỉ addr_test1wp67savr7r5wmccslrfrpaknyr0dt2fqwc06nexzx6yn26sypk9ka.
//
// Chạy:
//   NETWORK=Preprod STEP=address tsx 34_faucet_v1.ts        (cần `aiken build` trong Faucet/onchain)
//   NETWORK=Preprod STEP=export-script tsx 34_faucet_v1.ts  (cần `aiken build` trong Faucet/onchain)
//   NETWORK=Preprod STEP=status  tsx 34_faucet_v1.ts
//   NETWORK=Preprod STEP=ref BLOCKFROST_KEY=… WALLET_SEED="…" tsx 34_faucet_v1.ts
//
// Chỉ Preprod: policy tLAMP nướng vào script là của Preprod; Mainnet và Preview bị chặn.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Koios, credentialToAddress, scriptHashToCredential, validatorToScriptHash, type UTxO } from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, TLAMP_NAME, makeLucid, walletPkh, explorerTx } from "./config.js";
import { activeLampPolicyId } from "../offchain/src/lampPolicies.js";
import {
  FAUCET_V1_CLAIM_OILDROP, FAUCET_V1_PREPROD_TLAMP, encodeFaucetV1Datum, faucetV1CommittedScript, faucetV1Validator,
  faucetV1ValidatorFromCommitted, scanFaucetV1Pool,
} from "../../Faucet/offchain/src/faucetV1.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAUCET_BLUEPRINT = resolve(__dirname, "../../Faucet/onchain/plutus.json");
const FAUCET_SERVER_SCRIPT = resolve(__dirname, "../../Faucet/server/faucet_v1.preprod.json");
const KOIOS_PREPROD_URL = "https://preprod.koios.rest/api/v1";
const STEP = (process.env.STEP ?? "").toLowerCase();

/** Script vòi v1 cho tLAMP Preprod, sau khi đối chiếu bản chép policy với nguồn. */
async function faucet() {
  const pid = activeLampPolicyId("preprod");
  if (FAUCET_V1_PREPROD_TLAMP.policyId !== pid || FAUCET_V1_PREPROD_TLAMP.assetName !== TLAMP_NAME) {
    throw new Error(
      `FAUCETV1-001: Faucet/offchain/src/faucetV1.ts ▸ FAUCET_V1_PREPROD_TLAMP = ` +
      `${FAUCET_V1_PREPROD_TLAMP.policyId}.${FAUCET_V1_PREPROD_TLAMP.assetName}, nguồn lampPolicies.ts nói ` +
      `${pid}.${TLAMP_NAME}. Sửa bản chép rồi dựng lại — vòi đang nhả token khác policy ACTIVE.`,
    );
  }
  let bp: unknown;
  try { bp = JSON.parse(await readFile(FAUCET_BLUEPRINT, "utf8")); } catch (e) {
    throw new Error(`FAUCETV1-002: không đọc được ${FAUCET_BLUEPRINT} — chạy 'aiken build' trong Faucet/onchain (${(e as Error).message}).`);
  }
  const { validator, scriptHash } = faucetV1Validator(bp as { validators?: [] }, { policyId: pid, assetName: TLAMP_NAME });
  const address = credentialToAddress("Preprod", scriptHashToCredential(scriptHash));
  const committed = faucetV1CommittedScript(bp as { validators?: [] }, { policyId: pid, assetName: TLAMP_NAME });
  return { validator, scriptHash, address, committed, unit: pid + TLAMP_NAME, datum: encodeFaucetV1Datum(FAUCET_V1_CLAIM_OILDROP) };
}

function refAt(utxos: UTxO[], scriptHash: string): UTxO | undefined {
  return utxos.find((u) => u.scriptRef && validatorToScriptHash(u.scriptRef) === scriptHash);
}

async function main(): Promise<void> {
  if (NETWORK !== "Preprod") throw new Error(`CHẶN: vòi v1 chỉ chạy trên Preprod (NETWORK='${NETWORK}').`);
  const f = await faucet();

  if (STEP === "address") {
    console.log(`FAUCET_V1_SCRIPT_HASH=${f.scriptHash}`);
    console.log(`POOL_ADDRESS=${f.address}`);
    console.log(`POOL_DATUM_CBOR=${f.datum}   # FaucetDatum{claim_amount=${FAUCET_V1_CLAIM_OILDROP}}`);
    console.log(`TLAMP_UNIT=${f.unit}`);
    console.log(`\nNạp pool (chạy khô; thêm SUBMIT=true để gửi):`);
    console.log(`NETWORK=Preprod STEP=pay-pot PAY_OILDROP=10000000000000 POT_SHARE_OILDROP=500000000000 POT_OUTPUTS=20 ` +
      `POT_ADDRESS=${f.address} POT_SCRIPT_HASH=${f.scriptHash} POT_DATUM_CBOR=${f.datum} tsx 31_preprod_dev_pot.ts`);
    return;
  }

  if (STEP === "export-script") {
    // Đọc lại đúng như máy chủ đọc: hash tính lại + khớp địa chỉ pool, trước khi ghi.
    faucetV1ValidatorFromCommitted(f.committed, f.address);
    await writeFile(FAUCET_SERVER_SCRIPT, JSON.stringify(f.committed, null, 2) + "\n");
    console.log(`Đã ghi ${FAUCET_SERVER_SCRIPT}`);
    console.log(`script_hash=${f.committed.script_hash} · ${f.committed.compiled_code.length / 2} byte · pool ${f.address}`);
    return;
  }

  if (STEP === "status") {
    const utxos = await new Koios(KOIOS_PREPROD_URL).getUtxos(f.address);
    const scan = scanFaucetV1Pool(utxos, f.unit, FAUCET_V1_CLAIM_OILDROP);
    const held = scan.usable.reduce((s, u) => s + (u.assets[f.unit] ?? 0n), 0n);
    const claims = scan.usable.reduce((s, u) => s + (u.assets[f.unit] ?? 0n) / FAUCET_V1_CLAIM_OILDROP, 0n);
    const ref = refAt(utxos, f.scriptHash);
    console.log(`Pool ${f.address} (script ${f.scriptHash})`);
    console.log(`UTxO tại địa chỉ: ${utxos.length} · dùng được: ${scan.usable.length} · bỏ qua: ${scan.skipped.length}`);
    console.log(`tLAMP trong UTxO dùng được: ${held} oildrop · lượt claim còn: ${claims}`);
    console.log(`Reference script: ${ref ? `${ref.txHash}#${ref.outputIndex}  (FAUCET_REF_UTXO cho máy chủ)` : "CHƯA có — chạy STEP=ref"}`);
    for (const s of scan.skipped) console.log(`  bỏ qua ${s.outRef}: ${s.reason}`);
    return;
  }

  if (STEP !== "ref") throw new Error(`FAUCETV1-010: STEP phải là 'address', 'export-script', 'ref' hoặc 'status' (đang '${STEP}').`);
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const existing = refAt(await lucid.utxosAt(f.address), f.scriptHash);
  if (existing) {
    console.log(`Reference script đã có: ${existing.txHash}#${existing.outputIndex} — không dựng thêm.`);
    return;
  }
  // Không datum: UTxO này không bao giờ tiêu được (validator đòi datum), nên reference script
  // sống mãi và không ai — kể cả ví vận hành — gỡ nhầm được.
  const built = await lucid.newTx()
    .pay.ToAddressWithData(f.address, undefined, {}, f.validator)
    .addSignerKey(pkh)
    .complete();
  console.log(`Đặt reference script faucet v1 (${f.scriptHash}) tại ${f.address}, không datum (khoá vĩnh viễn).`);
  if (!SUBMIT) {
    console.log(`(SUBMIT=false ⇒ KHÔNG ký, KHÔNG gửi.) Hash thân giao dịch: ${built.toHash()} — FAUCET_REF_UTXO sẽ là <hash>#0.`);
    return;
  }
  const signed = await built.sign.withWallet().complete();
  const hash = await signed.submit();
  console.log(`📤 Reference script: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);
  console.log(`✅ Đã vào block. Chạy STEP=status để lấy FAUCET_REF_UTXO.`);
}

main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
