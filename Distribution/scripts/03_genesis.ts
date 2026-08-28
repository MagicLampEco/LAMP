// LampDistribution/scripts/03_genesis.ts — Tạo genesis state on-chain (CONTRACT v2 "Capped Drop").
//
// Chạy: npm run genesis   (sau 01_deploy + 02_mint_test_lamp)
//
// Tạo (trong 1 tx):
//   - Mint 1 beacon NFT one-shot (DropParam, asset name "DROP") bằng native sig policy.
//   - 1 beacon UTxO tại beacon address giữ NFT + BeaconDatum{epoch, DropParam, drop_value=D}.
//   - 1 treasury UTxO giữ test-LAMP pool + TreasuryDatum{committee_hash}.
//
// GENESIS KHÔNG CÒN TẠO TÀI KHOẢN (đổi 2026-08-14, theo PR #22). Trước đây bước này tạo
// sẵn 2 ClaimAccount UTxO rỗng (entitlement=0). Nay KHÔNG dựng nổi nữa, và cũng không nên:
//   1. Tài khoản phải mang NFT tên blake2b_256(owner) mới spend được (claim_account C-ACC-0).
//      Tài khoản rỗng không NFT = UTxO chết ở địa chỉ script, đúng loại mất-vĩnh-viễn mà
//      hệ KHÔNG BURN không có đường lùi.
//   2. Đúc NFT đó (claim_account_nft A-ACC-6) đòi tx có MỘT INPUT mang TRSY — mà trong
//      chính tx genesis, TRSY vừa được ĐÚC nên chưa tồn tại input nào. Bất khả thi trong
//      cùng một tx, không phải chuyện xếp lại thứ tự output.
//   3. Và đường đúc còn đi kèm `treasury.GrantEntitlement` với `granted > 0` — tức tài
//      khoản phải được cấp entitlement NGAY lúc mở, không có khái niệm "mở rỗng trước".
// ⇒ Tài khoản nay mở ở 04_e2e qua đường CREATE của claimBuilder (mở + cấp E + đúc NFT
//   trong cùng một tx). `deployed.json.genesis.claimAccountA/B` thành tuỳ chọn.
//
// committee_hash (TreasuryDatum): MVP self-test committee 1 key → committee_hash =
// keyhash[0] (28-byte). Production: hash native multisig script. Treasury validator
// chỉ so khớp committee_hash bảo toàn (C-TRE-2); release thực chất gate bởi
// claim_account redeem (C-TRE-1) nên giá trị cụ thể không chặn flow MVP.
//
// v2 BỎ hoàn toàn: Randomness/MerkleRoot beacon, nonce, claimed_cumulative/redeemed_cumulative.

import {
  Data, Constr, toUnit as lucidToUnit, getAddressDetails,
} from "@lucid-evolution/lucid";
import {
  NETWORK, DROP_ASSET_NAME, TREASURY_NFT_ASSET_NAME,
  makeLucid, walletPkh, nativeSigPolicy, nativeSigPolicyId,
  beaconNftPolicyFromRef, beaconNftPolicyIdFromRef,
  treasuryNftPolicyFromRef, treasuryNftPolicyIdFromRef,
  loadDeployed, saveDeployed, toUnit, explorerTx, awaitTx, currentEpoch,
} from "./config.js";
import {
  beaconDatumToCbor, treasuryDatumToCbor,
} from "../offchain/src/datum.js";
import { D_GENESIS } from "../offchain/src/constants.js";

const BEACON_MIN_ADA   = 2_000_000n;
const TREASURY_MIN_ADA = 2_000_000n;

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

  // ── Resolve beacon NFT minting policy theo mode đã chốt ở 01 ──
  // oneshot: Aiken beacon_nft, policy parameterized bởi genesis_ref → mint PHẢI consume
  //          đúng UTxO đó (supply 1 tuyệt đối). native-sig: MVP fallback Preview.
  const mode = state.beaconNftMode ?? "native-sig";
  let nftPolicy: import("@lucid-evolution/lucid").MintingPolicy;
  let nftPolicyId: string;
  let oneshotRef: import("./config.js").GenesisRef | undefined;

  if (mode === "oneshot") {
    if (!state.beaconNftGenesisRef) {
      throw new Error(
        "beaconNftMode=oneshot nhưng thiếu beaconNftGenesisRef trong deployed.json — chạy lại 01_deploy.",
      );
    }
    oneshotRef = state.beaconNftGenesisRef;
    nftPolicy   = await beaconNftPolicyFromRef(oneshotRef);
    nftPolicyId = await beaconNftPolicyIdFromRef(oneshotRef);
    // policy id PHẢI khớp cái 01 đã bake vào claim_account/beacon, nếu không → desync.
    const baked = state.params.beaconNftPolicy;
    if (nftPolicyId !== baked) {
      throw new Error(
        `beacon_nft one-shot desync: re-apply genesis_ref ra policy ${nftPolicyId} ` +
        `≠ baked ${baked}. genesis_ref/blueprint đã đổi — chạy lại 01_deploy.`,
      );
    }
  } else {
    if (NETWORK === "Mainnet") {
      throw new Error("Mainnet KHÔNG cho beacon NFT native-sig (re-mint được). Chạy 01_deploy one-shot.");
    }
    nftPolicy   = nativeSigPolicy(aPkh);
    nftPolicyId = state.beaconNftPolicy ?? nativeSigPolicyId(aPkh);
  }
  const lampUnit = toUnit(state.testLamp.policyId, state.testLamp.assetName);

  // ── Treasury authenticity NFT (TRSY) ONE-SHOT ────────────────
  // policyId đã bake vào claim_account ở 01 (param 7); ở đây re-derive từ genesis_ref
  // rồi mint TRSY consume đúng UTxO đó. Desync → fail-closed.
  if (!state.treasuryNftGenesisRef) {
    throw new Error(
      "thiếu treasuryNftGenesisRef trong deployed.json — chạy lại 01_deploy " +
      "(bản mới luôn bake treasury_nft one-shot).",
    );
  }
  const treasuryNftRef    = state.treasuryNftGenesisRef;
  const treasuryNftPolicy = await treasuryNftPolicyFromRef(treasuryNftRef);
  const treasuryNftPolId  = await treasuryNftPolicyIdFromRef(treasuryNftRef);
  if (treasuryNftPolId !== state.params.treasuryNftPolicy) {
    throw new Error(
      `treasury_nft one-shot desync: re-apply genesis_ref ra policy ${treasuryNftPolId} ` +
      `≠ baked ${state.params.treasuryNftPolicy}. Chạy lại 01_deploy.`,
    );
  }
  const trsyNft = lucidToUnit(treasuryNftPolId, TREASURY_NFT_ASSET_NAME);

  // committee_hash MVP = keyhash[0] (xem ghi chú đầu file).
  const committeeHash = state.committee.keyHashes[0]!;

  // ── beacon NFT unit (1 NFT DropParam) ────────────────────────
  const dropNft = lucidToUnit(nftPolicyId, DROP_ASSET_NAME);

  // ── beacon datum: DropParam{epoch, D} ────────────────────────
  const dropDatum = beaconDatumToCbor({ epoch, kind: "DropParam", drop_value: DROP_VALUE });

  // ── treasury datum (sổ cái solvency khởi tạo outstanding_entitlement = 0) ──
  const trDatum = treasuryDatumToCbor({
    committee_hash: committeeHash,
    outstanding_entitlement: 0n,
  });

  console.log(`Treasury fund: ${TREASURY_FUND / 1_000_000n} LAMP`);
  const utxos   = await lucid.wallet().getUtxos();
  const lampBal = utxos.reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  console.log(`test-LAMP có:  ${lampBal / 1_000_000n} LAMP`);
  if (lampBal < TREASURY_FUND) {
    throw new Error(`thiếu test-LAMP: cần ${TREASURY_FUND}, có ${lampBal}. Mint thêm (02).`);
  }
  console.log();

  // ── 1 tx: mint 2 NFT (DROP beacon + TRSY treasury) + tạo 2 output ──
  // one-shot: redeemer MintGenesis = Constr(0, []), và PHẢI consume đúng genesis_ref
  //           (validator ép `list.any(inputs, == genesis_ref)`).
  // native-sig (beacon fallback Preview): Data.void(), không cần consume ref cụ thể.
  // treasury_nft LUÔN one-shot → luôn consume treasuryNftGenesisRef.
  const MINT_GENESIS = Data.to(new Constr(0, [])); // MintGenesis (one-shot)
  let txb = lucid.newTx();

  // Gom các genesis_ref one-shot PHẢI consume (dedupe theo txHash#index).
  const refsToCollect = new Map<string, { txHash: string; outputIndex: number }>();
  if (mode === "oneshot" && oneshotRef) {
    refsToCollect.set(`${oneshotRef.txHash}#${oneshotRef.outputIndex}`, oneshotRef);
  }
  refsToCollect.set(
    `${treasuryNftRef.txHash}#${treasuryNftRef.outputIndex}`,
    { txHash: treasuryNftRef.txHash, outputIndex: treasuryNftRef.outputIndex },
  );
  if (refsToCollect.size > 0) {
    const refList = [...refsToCollect.values()];
    const refUtxos = await lucid.utxosByOutRef(refList);
    if (refUtxos.length !== refList.length) {
      throw new Error(
        `genesis_ref one-shot không còn đủ (đã spend?): cần ${refList.length}, ` +
        `tìm thấy ${refUtxos.length}. Policy đã bake ref này — chạy lại 01_deploy.`,
      );
    }
    txb = txb.collectFrom(refUtxos);
  }

  // Mint beacon DROP NFT.
  txb = (mode === "oneshot" && oneshotRef)
    ? txb.mintAssets({ [dropNft]: 1n }, MINT_GENESIS).attach.MintingPolicy(nftPolicy)
    : txb.mintAssets({ [dropNft]: 1n }, Data.void()).attach.MintingPolicy(nftPolicy);

  // Mint treasury TRSY NFT (one-shot, MintGenesis). NFT này gắn vào treasury UTxO bên dưới.
  txb = txb
    .mintAssets({ [trsyNft]: 1n }, MINT_GENESIS)
    .attach.MintingPolicy(treasuryNftPolicy);

  const tx = await txb
    // 1 beacon UTxO (DropParam)
    .pay.ToAddressWithData(state.beacon.address, { kind: "inline", value: dropDatum },
      { lovelace: BEACON_MIN_ADA, [dropNft]: 1n })
    // treasury UTxO (pool LAMP + TRSY authenticity NFT)
    .pay.ToAddressWithData(state.treasury.address, { kind: "inline", value: trDatum },
      { lovelace: TREASURY_MIN_ADA, [lampUnit]: TREASURY_FUND, [trsyNft]: 1n })
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
  state.beaconNftPolicy = nftPolicyId;
  state.wallets = { aPkh, bPkh: b.pkh };
  state.genesis = {
    dropParamBeacon: dropRef,
    treasuryUtxo:    treasuryRef,
  };
  await saveDeployed(state);

  console.log("\n── Genesis UTxO map ──");
  console.log(`   DropParam beacon:  ${state.genesis.dropParamBeacon.txHash}#${state.genesis.dropParamBeacon.outputIndex}`);
  console.log(`   Treasury:          ${state.genesis.treasuryUtxo.txHash}#${state.genesis.treasuryUtxo.outputIndex}`);
  console.log("   ClaimAccount:      chưa có — 04_e2e mở tài khoản (CREATE + đúc NFT + cấp E).");
  console.log("\n✅ Đã cập nhật deployed.json. Tiếp theo: npm run e2e");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
