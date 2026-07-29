// _mint_prodlamp.ts — Token TEST "prodLAMP" trên Preprod (KHÔNG phải tLAMP canonical).
//
// prodLAMP = token thử chức năng, tự do chuyển. Policy = native-sig (ví deploy điều khiển,
// mint thêm/less bất cứ lúc nào). KHÔNG registry-gate, KHÔNG A-DEST, KHÔNG kho vesting.
// Phân biệt rõ với "tLAMP" canonical mô phỏng mainnet (làm sau theo DEV-NOTE-kho-A-DEST-canonical).
//
// Đơn vị theo quy ước LAMP: 1 prodLAMP = 1e6 base. Chạy:
//   NETWORK=Preprod BLOCKFROST_KEY=... npx tsx _mint_prodlamp.ts
// Env tuỳ chọn: MINT_TOTAL (prodLAMP, mặc định 1_000_000), SEND_AMT (prodLAMP, mặc định 10_000),
//   TARGET_ADDR (mặc định ví test anh đưa).
import { scriptFromNative, mintingPolicyToId, fromText, toUnit } from "@lucid-evolution/lucid";
import { makeLucid, walletPkh, NETWORK, explorerTx } from "./config.js";

const BASE = 1_000_000n; // 1 prodLAMP = 1e6 base
const MINT_TOTAL = BigInt(process.env.MINT_TOTAL ?? "1000000") * BASE; // mint tổng vào ví deploy
const SEND_AMT = BigInt(process.env.SEND_AMT ?? "10000") * BASE;       // gửi tới ví test
const TARGET =
  process.env.TARGET_ADDR ??
  "addr_test1qqj3n67gy98jv84pu939m4rd9h4x2zrw4rsr5lftlh42c93aavrkxz2v53wl8c3g5utlrp202zgxg2mm4frsqgqwqf4sar0ha2";

const preprodExplorer = (h: string) => `https://preprod.cexplorer.io/tx/${h}`;

async function main() {
  if (NETWORK !== "Preprod") throw new Error(`CHẶN: script này chỉ chạy Preprod, NETWORK=${NETWORK}`);
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const myAddr = await lucid.wallet().address();

  // native-sig minting policy (ví deploy ký để mint)
  const native = scriptFromNative({ type: "sig", keyHash: pkh });
  const policyId = mintingPolicyToId(native);
  const assetName = fromText("prodLAMP"); // 70726f644c414d50
  const unit = toUnit(policyId, assetName);

  console.log(`=== Mint prodLAMP (test token, Preprod) ===`);
  console.log(`deploy pkh:   ${pkh}`);
  console.log(`policy id:    ${policyId}`);
  console.log(`asset:        ${unit}  (name=prodLAMP)`);
  console.log(`mint total:   ${MINT_TOTAL / BASE} prodLAMP  (${MINT_TOTAL} base)`);
  console.log(`→ gửi:        ${SEND_AMT / BASE} prodLAMP tới ${TARGET.slice(0, 24)}…`);
  console.log(`→ giữ lại ví: ${(MINT_TOTAL - SEND_AMT) / BASE} prodLAMP\n`);

  const tx = await lucid
    .newTx()
    .mintAssets({ [unit]: MINT_TOTAL })
    .attach.MintingPolicy(native)
    .pay.ToAddress(TARGET, { lovelace: 2_000_000n, [unit]: SEND_AMT })
    // phần còn lại (MINT_TOTAL - SEND_AMT) tự về ví deploy qua change
    .complete();

  console.log(`tx built (eval OK). CBOR len: ${tx.toCBOR().length}`);
  const signed = await tx.sign.withWallet().complete();
  const h = await signed.submit();
  console.log(`\n📤 submitted: ${h}`);
  console.log(`   ${preprodExplorer(h)}`);
  await lucid.awaitTx(h);
  console.log(`✅ confirmed.`);
  console.log(JSON.stringify({ network: NETWORK, policyId, asset: unit, assetNameHex: assetName, mintTotalBase: MINT_TOTAL.toString(), sentBase: SEND_AMT.toString(), target: TARGET, txHash: h }, null, 2));
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
