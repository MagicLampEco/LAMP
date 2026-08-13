// LampDistribution/scripts/01_deploy.ts — Apply params cho 3 validator + in hash/address.
//
// Chạy: npm run deploy
//
// Validator params (theo onchain/plutus.json):
//   beacon.beacon.spend          : [committee:List<ByteArray>, threshold:Int, beacon_nft_policy:ByteArray]
//   claim_account.claim_account.spend
//        : [committee, threshold, ms_per_epoch:Int, lamp_policy:ByteArray, lamp_name:ByteArray, beacon_nft_policy:ByteArray]
//   treasury.treasury.spend      : [claim_account_hash:ByteArray, lamp_policy:ByteArray, lamp_name:ByteArray]
//
// Phụ thuộc compile-time:
//   - treasury cần claim_account_hash → apply claim_account TRƯỚC để lấy hash.
//   - claim_account/beacon cần beacon_nft_policy + lamp_policy → tính TRƯỚC từ ví deploy
//     (native one-shot sig policy, id deterministic theo keyhash). Self-test:
//     lamp_policy == beacon_nft_policy == nativeSigPolicyId(walletPkh); phân biệt theo
//     asset name. Production: truyền LAMP_POLICY_ID / BEACON_NFT_POLICY qua .env.
//
// Ghi kết quả vào deployed.json để 02/03/04 dùng lại.

import { createHash } from "node:crypto";
import {
  NETWORK, MS_PER_EPOCH, LAMP_ASSET_NAME,
  makeLucid, walletPkh, resolveCommittee,
  rawValidator, applyValidator, scriptAddress, scriptHash,
  nativeSigPolicyId, beaconNftPolicyIdFromRef, treasuryNftPolicyIdFromRef,
  pickGenesisRef, saveDeployed, type DeployedState, type GenesisRef,
} from "./config.js";

async function main(): Promise<void> {
  console.log("=== LampDistribution Step 1: Deploy (apply params) ===\n");

  const lucid = await makeLucid();
  const pkh   = await walletPkh(lucid);
  const committee = await resolveCommittee(lucid);

  console.log(`Network:           ${NETWORK}`);
  console.log(`ms_per_epoch:      ${MS_PER_EPOCH}`);
  console.log(`Deploy wallet PKH: ${pkh}`);
  console.log(`Committee source:  ${committee.source}`);
  console.log(`Committee keys:    ${committee.keyHashes.length} (threshold ${committee.threshold})`);
  committee.keyHashes.forEach((k, i) => console.log(`   [${i}] ${k}`));
  console.log();

  // ── Resolve lamp_policy ──────────────────────────────────────
  const lampPolicy = (process.env.LAMP_POLICY_ID ?? "").trim() || nativeSigPolicyId(pkh);
  const lampName   = (process.env.LAMP_ASSET_NAME ?? "").trim() || LAMP_ASSET_NAME;

  // ── Resolve beacon_nft_policy (ONE-SHOT Aiken vs native-sig fallback) ──
  // Ưu tiên: (1) BEACON_NFT_POLICY env override (policy mint ngoài) → tin tưởng,
  //          (2) one-shot Aiken beacon_nft (Mainnet, hoặc BEACON_NFT_ONESHOT=1):
  //              chọn genesis_ref ví → bake policy id one-shot,
  //          (3) native-sig fallback CHỈ Preview self-test (re-mint được → KHÔNG mainnet).
  let beaconNftPolicy: string;
  let beaconNftMode: "oneshot" | "native-sig";
  let beaconNftGenesisRef: import("./config.js").GenesisRef | undefined;
  const wantOneshot = NETWORK === "Mainnet" || process.env.BEACON_NFT_ONESHOT === "1";
  const envBeacon = (process.env.BEACON_NFT_POLICY ?? "").trim();

  if (envBeacon) {
    beaconNftPolicy = envBeacon;
    beaconNftMode = "oneshot"; // policy ngoài coi như đã one-shot/đã kiểm soát supply
    console.log(`beacon_nft_policy: ${beaconNftPolicy}  (env override — supply do anh kiểm soát)`);
  } else if (wantOneshot) {
    beaconNftGenesisRef = await pickGenesisRef(lucid);
    beaconNftPolicy = await beaconNftPolicyIdFromRef(beaconNftGenesisRef);
    beaconNftMode = "oneshot";
    console.log(`beacon_nft_policy: ${beaconNftPolicy}  (ONE-SHOT Aiken beacon_nft)`);
    console.log(`   genesis_ref:    ${beaconNftGenesisRef.txHash}#${beaconNftGenesisRef.outputIndex}`);
    console.log("   (supply = 1 TUYỆT ĐỐI; 03_genesis PHẢI consume đúng UTxO này khi mint)");
  } else {
    // FAIL-CLOSED: native-sig chỉ cho non-Mainnet self-test.
    beaconNftPolicy = nativeSigPolicyId(pkh);
    beaconNftMode = "native-sig";
    console.log(`beacon_nft_policy: ${beaconNftPolicy}  (⚠ native-sig MVP — re-mint được!)`);
    console.log("   ⚠ CHỈ Preview self-test. Mainnet tự bật one-shot (fail-closed).");
    console.log("     Bật one-shot trên testnet bằng BEACON_NFT_ONESHOT=1.");
  }

  // ── Resolve treasury_nft_policy (LUÔN ONE-SHOT Aiken treasury_nft) ──
  // Authenticity treasury (TRSY) là sống còn cho solvency → KHÔNG có native-sig fallback.
  // policyId derive từ 1 genesis_ref ví; reuse genesis_ref của beacon one-shot khi có
  // (1 UTxO consume thoả CẢ hai policy trong cùng genesis tx), else pick ref riêng.
  // BEACON_NFT_POLICY env override: beacon không one-shot nội bộ → treasury_nft cần ref riêng.
  let treasuryNftGenesisRef: GenesisRef;
  if (beaconNftGenesisRef) {
    treasuryNftGenesisRef = beaconNftGenesisRef;
  } else {
    treasuryNftGenesisRef = await pickGenesisRef(lucid);
  }
  const treasuryNftPolicy = await treasuryNftPolicyIdFromRef(treasuryNftGenesisRef);
  console.log(`treasury_nft_policy: ${treasuryNftPolicy}  (ONE-SHOT Aiken treasury_nft — TRSY)`);
  console.log(`   genesis_ref:      ${treasuryNftGenesisRef.txHash}#${treasuryNftGenesisRef.outputIndex}`);
  console.log("   (supply = 1 TUYỆT ĐỐI; 03_genesis PHẢI consume đúng UTxO này khi mint TRSY)");

  console.log(`lamp_policy:       ${lampPolicy}`);
  console.log(`lamp_name:         ${lampName} ("${Buffer.from(lampName, "hex").toString("utf8")}")`);
  console.log();

  const committeeData = committee.keyHashes;   // List<ByteArray> = array of hex strings
  const thresholdData = BigInt(committee.threshold);

  // ── claim_account (apply trước để lấy hash cho treasury) ─────
  const rawClaim = await rawValidator("claim_account.claim_account.spend");
  const claimScript = applyValidator(rawClaim.compiledCode, [
    committeeData,
    thresholdData,
    MS_PER_EPOCH,
    lampPolicy,
    lampName,
    beaconNftPolicy,
    treasuryNftPolicy,
  ]);
  const claimHash = scriptHash(claimScript);
  const claimAddr = scriptAddress(claimScript);

  // ── beacon ────────────────────────────────────────────────────
  const rawBeacon = await rawValidator("beacon.beacon.spend");
  const beaconScript = applyValidator(rawBeacon.compiledCode, [
    committeeData,
    thresholdData,
    beaconNftPolicy,
  ]);
  const beaconHash = scriptHash(beaconScript);
  const beaconAddr = scriptAddress(beaconScript);

  // ── treasury (cần claim_account_hash) ────────────────────────
  const rawTreasury = await rawValidator("treasury.treasury.spend");
  const treasuryScript = applyValidator(rawTreasury.compiledCode, [
    claimHash,
    lampPolicy,
    lampName,
    committeeData,
    thresholdData,
  ]);
  const treasuryHash = scriptHash(treasuryScript);
  const treasuryAddr = scriptAddress(treasuryScript);

  console.log("── Applied validators ──");
  console.log(`claim_account hash: ${claimHash}`);
  console.log(`   addr:            ${claimAddr}`);
  console.log(`beacon hash:        ${beaconHash}`);
  console.log(`   addr:            ${beaconAddr}`);
  console.log(`treasury hash:      ${treasuryHash}`);
  console.log(`   addr:            ${treasuryAddr}`);
  console.log();

  // ── PREFLIGHT CHECKSUM (no-undo genesis) ─────────────────────
  // Apply param sai 1 keyhash/threshold → 3 hash sai → vốn treasury khoá vĩnh viễn,
  // KHÔNG undo. In lại toàn bộ tham số + checksum 3 hash để operator đối chiếu TRƯỚC
  // khi ghi deployed.json. Trên Mainnet ép xác nhận (DEPLOY_ACK=<checksum>).
  const checksum = createHash("sha256")
    .update([
      committee.keyHashes.join(","),
      String(committee.threshold),
      lampPolicy, lampName, beaconNftPolicy, treasuryNftPolicy,
      MS_PER_EPOCH.toString(),
      claimHash, beaconHash, treasuryHash,
    ].join("|"))
    .digest("hex")
    .slice(0, 16);

  console.log("── PREFLIGHT CHECKSUM (đối chiếu trước genesis no-undo) ──");
  console.log(`   committee (${committee.keyHashes.length}-of-N, threshold ${committee.threshold}):`);
  committee.keyHashes.forEach((k, i) => console.log(`     [${i}] ${k}`));
  console.log(`   lamp_policy:        ${lampPolicy}`);
  console.log(`   beacon_nft_policy:  ${beaconNftPolicy}`);
  console.log(`   treasury_nft_policy:${treasuryNftPolicy}`);
  console.log(`   ms_per_epoch:       ${MS_PER_EPOCH}`);
  console.log(`   3-hash checksum:    ${checksum}`);
  console.log();

  if (NETWORK === "Mainnet") {
    if (process.env.DEPLOY_ACK !== checksum) {
      throw new Error(
        `Mainnet no-undo: đặt DEPLOY_ACK=${checksum} (sau khi ĐÃ đối chiếu committee + ` +
        `3 hash ở trên) rồi chạy lại. Bước này chặn genesis sai-tham-số không thể hoàn tác.`,
      );
    }
    console.log("✅ DEPLOY_ACK khớp checksum — operator đã xác nhận.\n");
  }

  const state: DeployedState = {
    network: NETWORK,
    msPerEpoch: MS_PER_EPOCH.toString(),
    committee: {
      keyHashes: committee.keyHashes,
      threshold: committee.threshold,
      source: committee.source,
    },
    claimAccount: { hash: claimHash, address: claimAddr },
    beacon:       { hash: beaconHash, address: beaconAddr },
    treasury:     { hash: treasuryHash, address: treasuryAddr },
    params: {
      msPerEpoch: MS_PER_EPOCH.toString(),
      lampPolicy,
      lampName,
      beaconNftPolicy,
      treasuryNftPolicy,
      claimAccountHash: claimHash,
    },
    beaconNftMode,
    ...(beaconNftGenesisRef ? { beaconNftGenesisRef } : {}),
    treasuryNftGenesisRef,
  };
  await saveDeployed(state);

  console.log("✅ Đã ghi deployed.json. Tiếp theo: npm run mint-lamp");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
