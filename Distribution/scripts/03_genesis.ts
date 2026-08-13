// LampDistribution/scripts/03_genesis.ts — Tạo genesis state on-chain (CONTRACT v2 "Capped Drop").
//
// Chạy: npm run genesis   (sau 01_deploy + 02_mint_test_lamp)
//
// Tạo (trong 1 tx):
//   - Mint 1 beacon NFT one-shot (DropParam, asset name "DROP") bằng native sig policy.
//   - 1 beacon UTxO tại beacon address giữ NFT + BeaconDatum{epoch, DropParam, drop_value=D}.
//   - 1 treasury UTxO giữ test-LAMP pool + TreasuryDatum{committee_hash}.
//   - 2 ClaimAccount UTxO (ví A, B) datum v2 {owner, entitlement=0, redeemed=0,
//     start_epoch=epoch, drops_per_epoch=1} — genesis empty accounts; entitlement
//     được committee cấp ở 04 (Claim), redeem tất định theo vested(t).
//
// committee_hash (TreasuryDatum): MVP self-test committee 1 key → committee_hash =
// keyhash[0] (28-byte). Production: hash native multisig script. Treasury validator
// chỉ so khớp committee_hash bảo toàn (C-TRE-2); release thực chất gate bởi
// claim_account redeem (C-TRE-1) nên giá trị cụ thể không chặn flow MVP.
//
// v2 BỎ hoàn toàn: Randomness/MerkleRoot beacon, nonce, claimed_cumulative/redeemed_cumulative.

import {
  Data, toUnit as lucidToUnit, getAddressDetails,
} from "@lucid-evolution/lucid";
import {
  NETWORK, DROP_ASSET_NAME,
  makeLucid, walletPkh, nativeSigPolicy, nativeSigPolicyId,
  loadDeployed, saveDeployed, toUnit, explorerTx, awaitTx, currentEpoch,
} from "./config.js";
import {
  beaconDatumToCbor, treasuryDatumToCbor, claimAccountDatumToCbor,
} from "../offchain/src/datum.js";
import { D_GENESIS, DEFAULT_DROPS_PER_EPOCH } from "../offchain/src/constants.js";

const BEACON_MIN_ADA   = 2_000_000n;
const TREASURY_MIN_ADA = 2_000_000n;
const ACCOUNT_MIN_ADA  = 2_000_000n;

// test-LAMP fund vào treasury pool (oildrop). Mặc định 500_000 LAMP — dư cho redeem demo.
const TREASURY_FUND = BigInt(process.env.TREASURY_FUND_OILDROP ?? (500_000n * 1_000_000n).toString());

// DropParam D (oildrop/drop·epoch). THAM SỐ — đọc từ beacon ở redeem, không hardcode validator.
const DROP_VALUE = BigInt(process.env.DROP_VALUE_OILDROP ?? D_GENESIS.toString());

/** Ví B test: PRIVATE_KEY_B/WALLET_SEED_B nếu có; else PKH cố định (chỉ demo 2 account). */
async function resolveWalletBPkh(): Promise<{ pkh: string; real: boolean }> {
  const sk   = (process.env.PRIVATE_KEY_B ?? "").trim();
  const seed = (process.env.WALLET_SEED_B ?? "").trim();
  if (sk || seed) {
    const l = await makeLucid();
    if (sk) l.selectWallet.fromPrivateKey(sk);
    else    l.selectWallet.fromSeed(seed.replace(/\s+/g, " "));
    const addr = await l.wallet().address();
    const { paymentCredential } = getAddressDetails(addr);
    if (!paymentCredential) throw new Error("ví B: không lấy được payment credential");
    return { pkh: paymentCredential.hash, real: true };
  }
  // Placeholder PKH (28-byte) — KHÔNG redeem được (không ai ký), chỉ demo 2 account.
  return { pkh: "b0".repeat(28), real: false };
}

async function main(): Promise<void> {
  console.log("=== LampDistribution Step 3: Genesis (Capped Drop v2) ===\n");

  const state = await loadDeployed();
  if (!state.testLamp) {
    console.log("⚠ chưa có testLamp trong deployed.json — chạy 'npm run mint-lamp' trước,");
    console.log("  hoặc tự fund treasury bằng token ngoài (sửa state.testLamp thủ công).");
    throw new Error("thiếu testLamp");
  }

  const lucid = await makeLucid();
  const aPkh  = await walletPkh(lucid);
  const b     = await resolveWalletBPkh();
  const epoch = await currentEpoch();

  console.log(`Network:      ${NETWORK}`);
  console.log(`Epoch:        ${epoch}`);
  console.log(`Drop value D: ${DROP_VALUE / 1_000_000n} LAMP/drop·epoch (${DROP_VALUE} oildrop)`);
  console.log(`Ví A (PKH):   ${aPkh}  (= ví deploy, redeem được)`);
  console.log(`Ví B (PKH):   ${b.pkh}  (${b.real ? "ví thật" : "placeholder — chỉ demo account"})`);
  console.log();

  const nftPolicyId = state.beaconNftPolicy ?? nativeSigPolicyId(aPkh);
  const nftPolicy   = nativeSigPolicy(aPkh);
  const lampUnit    = toUnit(state.testLamp.policyId, state.testLamp.assetName);

  // committee_hash MVP = keyhash[0] (xem ghi chú đầu file).
  const committeeHash = state.committee.keyHashes[0]!;

  // ── beacon NFT unit (1 NFT DropParam) ────────────────────────
  const dropNft = lucidToUnit(nftPolicyId, DROP_ASSET_NAME);

  // ── beacon datum: DropParam{epoch, D} ────────────────────────
  const dropDatum = beaconDatumToCbor({ epoch, kind: "DropParam", drop_value: DROP_VALUE });

  // ── treasury datum ───────────────────────────────────────────
  const trDatum = treasuryDatumToCbor({ committee_hash: committeeHash });

  // ── claim account datums v2 (genesis empty: entitlement=0, redeemed=0) ──
  const accA = claimAccountDatumToCbor({
    owner: aPkh, entitlement: 0n, redeemed: 0n,
    start_epoch: epoch, drops_per_epoch: DEFAULT_DROPS_PER_EPOCH,
  });
  const accB = claimAccountDatumToCbor({
    owner: b.pkh, entitlement: 0n, redeemed: 0n,
    start_epoch: epoch, drops_per_epoch: DEFAULT_DROPS_PER_EPOCH,
  });

  console.log(`Treasury fund: ${TREASURY_FUND / 1_000_000n} LAMP`);
  const utxos   = await lucid.wallet().getUtxos();
  const lampBal = utxos.reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  console.log(`test-LAMP có:  ${lampBal / 1_000_000n} LAMP`);
  if (lampBal < TREASURY_FUND) {
    throw new Error(`thiếu test-LAMP: cần ${TREASURY_FUND}, có ${lampBal}. Mint thêm (02).`);
  }
  console.log();

  // ── 1 tx: mint 1 NFT + tạo 4 output ──────────────────────────
  const tx = await lucid
    .newTx()
    .mintAssets({ [dropNft]: 1n }, Data.void())
    .attach.MintingPolicy(nftPolicy)
    // 1 beacon UTxO (DropParam)
    .pay.ToAddressWithData(state.beacon.address, { kind: "inline", value: dropDatum },
      { lovelace: BEACON_MIN_ADA, [dropNft]: 1n })
    // treasury UTxO (pool LAMP)
    .pay.ToAddressWithData(state.treasury.address, { kind: "inline", value: trDatum },
      { lovelace: TREASURY_MIN_ADA, [lampUnit]: TREASURY_FUND })
    // 2 claim account UTxO (empty)
    .pay.ToAddressWithData(state.claimAccount.address, { kind: "inline", value: accA },
      { lovelace: ACCOUNT_MIN_ADA })
    .pay.ToAddressWithData(state.claimAccount.address, { kind: "inline", value: accB },
      { lovelace: ACCOUNT_MIN_ADA })
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();

  console.log(`✅ Genesis tx submitted!`);
  console.log(`   TX hash:  ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
  await awaitTx(lucid, txHash, "genesis");

  // resolve UTxO indices: query lại theo asset/datum trong tx này (Lucid giữ thứ tự
  // outputs khai báo, nhưng query chắc chắn hơn).
  console.log("\n   resolve genesis UTxO indices…");
  const beaconUtxos   = await lucid.utxosAt(state.beacon.address);
  const treasuryUtxos = await lucid.utxosAt(state.treasury.address);
  const accountUtxos  = await lucid.utxosAt(state.claimAccount.address);

  const dropRef = (() => {
    const u = beaconUtxos.find((x) => (x.assets[dropNft] ?? 0n) === 1n && x.txHash === txHash);
    if (!u) throw new Error(`không tìm thấy DropParam beacon UTxO chứa ${dropNft} trong tx ${txHash}`);
    return { txHash: u.txHash, outputIndex: u.outputIndex };
  })();
  const treasuryRef = (() => {
    const u = treasuryUtxos.find((x) => x.txHash === txHash && (x.assets[lampUnit] ?? 0n) > 0n);
    if (!u) throw new Error("không tìm thấy treasury UTxO");
    return { txHash: u.txHash, outputIndex: u.outputIndex };
  })();
  // 2 account UTxO: phân biệt theo datum (cbor đúng owner).
  const accUtxosThisTx = accountUtxos.filter((x) => x.txHash === txHash);
  const accountARef = (() => {
    const u = accUtxosThisTx.find((x) => x.datum && x.datum === accA);
    if (!u) throw new Error("không tìm thấy ClaimAccount A");
    return { txHash: u.txHash, outputIndex: u.outputIndex };
  })();
  const accountBRef = (() => {
    const u = accUtxosThisTx.find((x) => x.datum && x.datum === accB);
    if (!u) throw new Error("không tìm thấy ClaimAccount B");
    return { txHash: u.txHash, outputIndex: u.outputIndex };
  })();

  state.beaconNftPolicy = nftPolicyId;
  state.wallets = { aPkh, bPkh: b.pkh };
  state.genesis = {
    dropParamBeacon: dropRef,
    treasuryUtxo:    treasuryRef,
    claimAccountA:   accountARef,
    claimAccountB:   accountBRef,
  };
  await saveDeployed(state);

  console.log("\n── Genesis UTxO map ──");
  console.log(`   DropParam beacon:  ${state.genesis.dropParamBeacon.txHash}#${state.genesis.dropParamBeacon.outputIndex}`);
  console.log(`   Treasury:          ${state.genesis.treasuryUtxo.txHash}#${state.genesis.treasuryUtxo.outputIndex}`);
  console.log(`   ClaimAccount A:    ${state.genesis.claimAccountA.txHash}#${state.genesis.claimAccountA.outputIndex}`);
  console.log(`   ClaimAccount B:    ${state.genesis.claimAccountB.txHash}#${state.genesis.claimAccountB.outputIndex}`);
  console.log("\n✅ Đã cập nhật deployed.json. Tiếp theo: npm run e2e");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
