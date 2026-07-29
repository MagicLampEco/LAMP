// seed_canonical_pool.ts — nạp Faucet pool bằng tLAMP CANONICAL (lamp_mint), nhả 100/claim.
//
// FIRST-PRINCIPLES: faucet.ak chỉ param (policy_id, asset_name) rồi khoá cứng claim_amount.
// Token tới từ đâu không quan trọng → dùng CANONICAL lamp_mint tLAMP thay one-shot,
// để dev nhận token CÙNG policy với toàn hệ (Distribution/Treasury custody/Governance).
//
// Nguồn seed: ví FOUNDATION (đang giữ tLAMP canonical đã redeem). FOUNDATION ký tx.
// Pool datum = FaucetDatum{claim_amount} (v1, khớp claimBuilder.ts + 02_claim.ts).
//
// Chạy:  SUBMIT=true FOUNDATION_WALLET_SEED="..." NETWORK=Preprod tsx seed_canonical_pool.ts
//
import {
  applyParamsToScript, validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  scriptFromNative, mintingPolicyToId, toUnit as u, Lucid, Blockfrost, Data,
  type Validator,
} from "@lucid-evolution/lucid";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NETWORK, BLOCKFROST_URL, BLOCKFROST_KEY, makeLucid, walletPkh, rawValidator, applyValidator,
  scriptHash, scriptAddress, explorerTx, SUBMIT,
} from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Hằng số canonical — KHỚP canonical_mint.ts / canonical_release.ts.
const SUPPLY_NAME = "535550504c59", TLAMP_NAME = "744c414d50", TOKEN_TAG = "4c414d50";
const DIST_CAP = 26370000000000000n, RESERVE_CAP = 9630000000000000n;
const REG = "524547", KHO = "4b484f", MET = "4d4554";
const CLAIM_AMOUNT_OILDROP = 100n * 1_000_000n;      // 100 tLAMP/claim
const POOL_LOVELACE = 5_000_000n;                // min-ADA pool
const SEED_OILDROP = BigInt(process.env.SEED_OILDROP ?? (9_000n * 1_000_000n).toString()); // mặc định 9000 tLAMP

async function gCode(mod: string, title: string): Promise<string> {
  const bp = JSON.parse(await readFile(resolve(__dirname, `../../${mod}/onchain/plutus.json`), "utf8"));
  const v = (bp.validators as { title: string; compiledCode: string }[]).find((x) => x.title === title);
  if (!v) throw new Error(`${title} not found in ${mod}/plutus.json`);
  return v.compiledCode;
}
const applyV = (code: string, p: unknown[]): Validator =>
  ({ type: "PlutusV3", script: applyParamsToScript(code, p as never) });

async function main(): Promise<void> {
  console.log(`=== Seed CANONICAL faucet pool (${NETWORK}) ===\n`);

  // 1. Ví deploy (WALLET_SEED) → native-sig policy id nPid = gốc mọi wiring canonical.
  const dLucid = await makeLucid();
  const dPkh = await walletPkh(dLucid);
  const native = scriptFromNative({ type: "sig", keyHash: dPkh });
  const nPid = mintingPolicyToId(native);

  // 2. Tái dựng canonical lamp_mint (12-param) → lampPid.
  const lampMint = applyV(await gCode("Genesis", "lamp_mint.lamp_mint.mint"),
    [nPid, SUPPLY_NAME, TLAMP_NAME, DIST_CAP, RESERVE_CAP, nPid, REG, TOKEN_TAG, nPid, KHO, nPid, MET]);
  const lampPid = validatorToScriptHash(lampMint);
  const lampUnit = u(lampPid, TLAMP_NAME);
  console.log(`canonical lampPid: ${lampPid}`);
  console.log(`canonical lampUnit: ${lampUnit}\n`);

  // 3. Faucet pool param theo CANONICAL policy (v1 faucet.ak).
  const rawSpend = await rawValidator("faucet.faucet.spend");
  const faucetScript = applyValidator(rawSpend.compiledCode, [lampPid, TLAMP_NAME]);
  const faucetHash = scriptHash(faucetScript);
  const faucetAddr = scriptAddress(faucetScript);
  console.log(`Faucet hash:    ${faucetHash}`);
  console.log(`Faucet address: ${faucetAddr}\n`);

  // 4. Ví FOUNDATION (giữ tLAMP canonical) — ký seed.
  const fSeed = (process.env.FOUNDATION_WALLET_SEED ?? "").trim().replace(/\s+/g, " ");
  if (!fSeed) throw new Error("thiếu FOUNDATION_WALLET_SEED (ví giữ tLAMP canonical).");
  const fLucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  fLucid.selectWallet.fromSeed(fSeed);
  const fAddr = await fLucid.wallet().address();
  const fUtxos = await fLucid.wallet().getUtxos();
  const held = fUtxos.reduce((s, x) => s + (x.assets[lampUnit] ?? 0n), 0n);
  console.log(`FOUNDATION: ${fAddr}`);
  console.log(`  giữ tLAMP canonical: ${held} oildrop = ${held / 1_000_000n} tLAMP`);
  if (held < SEED_OILDROP) throw new Error(`FOUNDATION chỉ giữ ${held} oildrop < SEED_OILDROP ${SEED_OILDROP}. Giảm SEED_OILDROP hoặc mint+release thêm.`);

  const poolAssets: Record<string, bigint> = { lovelace: POOL_LOVELACE, [lampUnit]: SEED_OILDROP };
  const poolDatum = Data.to(new (await import("@lucid-evolution/lucid")).Constr(0, [CLAIM_AMOUNT_OILDROP]));
  console.log(`\nSeed pool: ${SEED_OILDROP} oildrop = ${SEED_OILDROP / 1_000_000n} tLAMP  (claim ${CLAIM_AMOUNT_OILDROP / 1_000_000n}/lần → ${SEED_OILDROP / CLAIM_AMOUNT_OILDROP} lượt)`);

  const tx = await fLucid.newTx()
    .pay.ToContract(faucetAddr, { kind: "inline", value: poolDatum }, poolAssets)
    .complete();

  if (!SUBMIT) {
    console.log("\nℹ️ SUBMIT=false → chỉ build, KHÔNG gửi. Bật SUBMIT=true để nạp thật.");
    console.log(JSON.stringify({ network: NETWORK, lampPid, lampUnit, faucetHash, faucetAddr,
      claimAmountOildrop: CLAIM_AMOUNT_OILDROP.toString(), seedOildrop: SEED_OILDROP.toString() }, null, 2));
    return;
  }
  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log(`\n✅ Seed pool! TX: ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
  await fLucid.awaitTx(txHash);
  console.log(`\nPOOL sẵn sàng. Ghi lại:`);
  console.log(JSON.stringify({ network: NETWORK, tlampPolicyId: lampPid, tlampUnit: lampUnit,
    assetName: TLAMP_NAME, faucetHash, faucetAddr, poolUtxo: { txHash, outputIndex: 0 },
    claimAmountOildrop: CLAIM_AMOUNT_OILDROP.toString(), seedOildrop: SEED_OILDROP.toString(), canonical: true }, null, 2));
}

main().catch((e) => { console.error("❌", e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); });
