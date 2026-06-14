// Allocation demo trên Preview — Setup (tạo ClaimAccount + Treasury con) → Redeem.
//
// LƯU Ý PHẠM VI: flow Claim qua co-spend ChannelBudget beacon BỊ KẸT vì vòng phụ thuộc
// hash compile-time: channel_budget(claim_account_hash) ↔ claim_account(channel_budget_hash).
// Không giải được bằng applyParamsToScript thuần (vòng tròn toán học) → cần tái thiết kế
// onchain (vượt phạm vi deploy demo). Nhánh Redeem của claim_account KHÔNG dùng
// channel_budget_hash → apply placeholder 0×28 cho param đó, tính đúng Redeem KHÔNG đổi.
//
// Demo này chứng minh LÕI giá trị Allocation: vesting tất định (Capped Drop) + treasury
// con nhả LAMP đúng phần vested. 2 tx thật:
//   Tx#A Setup: tạo ClaimAccount UTxO (entitlement) + Treasury UTxO (nạp LAMP) — KHÔNG qua
//        buildSetupChannelTx (cần budget beacon + vòng); đặt datum trực tiếp.
//   Tx#B Redeem: buildRedeemTx — user nhận LAMP đã vested từ treasury con.

import {
  Lucid, Blockfrost, getAddressDetails,
  applyParamsToScript, validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  toUnit, Data, type Network, type Validator, type UTxO,
} from "@lucid-evolution/lucid";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";

import { buildRedeemTx } from "../offchain/src/redeemBuilder.js";
import { claimAccountDatumToCbor, treasuryDatumToCbor } from "../offchain/src/datum.js";
import type { ClaimAccountDatum, TreasuryDatum } from "../offchain/src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env") });

const NETWORK = (process.env.NETWORK ?? "Preview") as Network;
if (NETWORK !== "Preview") { console.error("❌ NETWORK != Preview — DỪNG."); process.exit(1); }
const BF_KEY = process.env.BLOCKFROST_KEY ?? "";
const SEED = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");
if (!BF_KEY || !SEED) { console.error("❌ thiếu BLOCKFROST_KEY / WALLET_SEED"); process.exit(1); }

const BF_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
const explorer = (h: string) => `https://preview.cexplorer.io/tx/${h}`;

// LAMP token = tLAMP đã mint ở Genesis (Tx#2).
const LAMP_POLICY = process.env.LAMP_POLICY ?? "b1474a77c8867762efda418adda90ecf7bb5ca35b0be13a7bfbf0ebd";
const LAMP_NAME = process.env.LAMP_NAME ?? "744c414d50"; // tLAMP

const ZERO28 = "00".repeat(28);
const MS_PER_EPOCH = 86_400_000n;       // 1 ngày/epoch
const DROP_VALUE = 1_000_000n;          // D = 1 LAMP / drop·epoch
const CHANNEL_ID = Buffer.from("DEMO").toString("hex"); // "DEMO" hex
const ENTITLEMENT = 5_000_000n;         // 5 LAMP
const MIN_ADA = 2_000_000n;

async function rawCompiled(title: string): Promise<string> {
  const json = JSON.parse(await readFile(resolve(__dirname, "../onchain/plutus.json"), "utf8"));
  const v = json.validators.find((x: any) => x.title === title);
  if (!v) throw new Error(`validator ${title} không thấy`);
  return v.compiledCode;
}

async function main() {
  console.log("=== Allocation demo (Preview): Setup ClaimAccount+Treasury → Redeem ===\n");
  console.log(`Network=${NETWORK}  LAMP=${LAMP_POLICY}.${LAMP_NAME}\n`);

  const lucid = await Lucid(new Blockfrost(BF_URL, BF_KEY), NETWORK);
  lucid.selectWallet.fromSeed(SEED);
  const myAddr = await lucid.wallet().address();
  const { paymentCredential } = getAddressDetails(myAddr);
  const pkh = paymentCredential!.hash;
  console.log(`Wallet PKH: ${pkh}`);

  // ── Apply params ────────────────────────────────────────────────────
  // claim_account(committee, threshold, ms_per_epoch, lamp_policy, lamp_name, drop_value,
  //               budget_nft_policy, channel_budget_hash) — 2 hash cuối = placeholder
  //   (Redeem KHÔNG dùng channel_budget_hash; budget_nft_policy chỉ ở Claim).
  const claimScript: Validator = {
    type: "PlutusV3",
    script: applyParamsToScript(await rawCompiled("claim_account.claim_account.spend"), [
      [pkh], 1n, MS_PER_EPOCH, LAMP_POLICY, LAMP_NAME, DROP_VALUE, ZERO28, ZERO28,
    ] as never),
  };
  const claimHash = validatorToScriptHash(claimScript);
  const claimAddr = credentialToAddress(NETWORK, scriptHashToCredential(claimHash));
  console.log(`claim_account hash: ${claimHash}`);

  // treasury(claim_account_hash, lamp_policy, lamp_name)
  const treasuryScript: Validator = {
    type: "PlutusV3",
    script: applyParamsToScript(await rawCompiled("treasury.treasury.spend"), [
      claimHash, LAMP_POLICY, LAMP_NAME,
    ] as never),
  };
  const treasuryHash = validatorToScriptHash(treasuryScript);
  const treasuryAddr = credentialToAddress(NETWORK, scriptHashToCredential(treasuryHash));
  console.log(`treasury hash:      ${treasuryHash}\n`);

  const lampUnit = toUnit(LAMP_POLICY, LAMP_NAME);

  // ── Tx#A Setup: tạo ClaimAccount + Treasury (nạp ENTITLEMENT LAMP) ──
  const claimDatum: ClaimAccountDatum = {
    owner: pkh, entitlement: ENTITLEMENT, redeemed: 0n,
    start_epoch: 0n, drops_per_epoch: 1n, channel_id: CHANNEL_ID,
  };
  const treasuryDatum: TreasuryDatum = { committee_hash: pkh, channel_id: CHANNEL_ID };

  console.log("Tx#A — Setup ClaimAccount + Treasury:");
  // collateral cần pure-ADA cho Redeem sau; setup tx tự cân.
  const txA = await lucid.newTx()
    .pay.ToContract(claimAddr, { kind: "inline", value: claimAccountDatumToCbor(claimDatum) },
      { lovelace: MIN_ADA })
    .pay.ToContract(treasuryAddr, { kind: "inline", value: treasuryDatumToCbor(treasuryDatum) },
      { lovelace: MIN_ADA, [lampUnit]: ENTITLEMENT })
    // tạo 1 UTxO pure-ADA cho collateral của Tx#B Redeem (ví chỉ còn UTxO chứa token).
    .pay.ToAddress(myAddr, { lovelace: 5_000_000n })
    .complete();
  const signedA = await txA.sign.withWallet().complete();
  const hashA = await signedA.submit();
  console.log(`  📤 ${explorer(hashA)}`);
  await lucid.awaitTx(hashA);
  console.log(`  ✅ Setup confirmed\n`);

  // locate UTxOs
  const claimUtxos = await lucid.utxosAt(claimAddr);
  const claimUtxo = claimUtxos.find((u) => u.txHash === hashA && !!u.datum);
  const treUtxos = await lucid.utxosAt(treasuryAddr);
  const treUtxo = treUtxos.find((u) => u.txHash === hashA && (u.assets[lampUnit] ?? 0n) === ENTITLEMENT);
  if (!claimUtxo || !treUtxo) throw new Error("không tìm thấy ClaimAccount/Treasury UTxO sau Setup");

  // ── Tx#B Redeem: vested = min(E, D·dpe·elapsed). validFromMs lớn → elapsed lớn → vested=E ──
  const nowMs = BigInt(Date.now());
  // lùi ~2 phút để lower_bound chắc chắn ≤ tip slot (tránh "OutsideValidityInterval").
  const validFromMs = nowMs - 120_000n;
  console.log("Tx#B — Redeem (user nhận LAMP đã vested):");
  const redeem = await buildRedeemTx({
    lucid, network: NETWORK,
    claimAccountUtxo: claimUtxo, claimScript,
    treasuryUtxo: treUtxo, treasuryScript,
    dropValue: DROP_VALUE, msPerEpoch: MS_PER_EPOCH, validFromMs,
    lampPolicyId: LAMP_POLICY, lampAssetName: LAMP_NAME,
  });
  console.log(redeem.summary);
  const signedB = await redeem.tx.sign.withWallet().complete();
  const hashB = await signedB.submit();
  console.log(`  📤 ${explorer(hashB)}`);
  await lucid.awaitTx(hashB);
  console.log(`  ✅ Redeem confirmed — user nhận ${redeem.amount / 1_000_000n} LAMP\n`);

  console.log("=== Done ===");
  console.log(JSON.stringify({
    network: NETWORK, channelId: CHANNEL_ID,
    claimAddr, treasuryAddr, lampUnit,
    txSetup: explorer(hashA), txRedeem: explorer(hashB),
    redeemedLamp: (redeem.amount / 1_000_000n).toString(),
  }, null, 2));
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
