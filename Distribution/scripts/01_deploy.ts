// LampDistribution/scripts/01_deploy.ts — Apply params cho 3 validator + in hash/address.
//
// Chạy: npm run deploy
//
// Validator params (theo onchain/plutus.json — số tham số được cổng APPLY-001 ép khớp):
//   beacon.beacon.spend      (3): [committee:List<ByteArray>, threshold:Int, beacon_nft_policy]
//   claim_account_nft.mint   (3): [committee, threshold, treasury_nft_policy]
//   claim_account.spend      (8): [committee, threshold, ms_per_epoch, lamp_policy, lamp_name,
//                                  beacon_nft_policy, treasury_nft_policy, account_nft_policy]
//   treasury.spend           (6): [claim_account_hash, lamp_policy, lamp_name,
//                                  committee, threshold, account_nft_policy]
//
// Phụ thuộc compile-time (thứ tự apply KHÔNG đổi được):
//   - claim_account + treasury cần account_nft_policy → apply claim_account_nft TRƯỚC NHẤT.
//   - treasury cần claim_account_hash → apply claim_account trước treasury.
//   - claim_account/beacon cần beacon_nft_policy + lamp_policy → tính TRƯỚC từ ví deploy
//     (native one-shot sig policy, id deterministic theo keyhash). Self-test:
//     lamp_policy == beacon_nft_policy == nativeSigPolicyId(walletPkh); phân biệt theo
//     asset name. Production: truyền LAMP_POLICY_ID / BEACON_NFT_POLICY qua .env.
//
// Env apply-param (nướng vào script-hash ⇒ sai là không sửa được):
//   LAMP_POLICY_ID    56 hex   — bắt buộc trên mọi network ≠ Preview (xem `strictLampParams`)
//   LAMP_ASSET_NAME   hex chẵn — nt; mặc định của module là tLAMP, SAI trên mainnet
//   BEACON_NFT_POLICY 56 hex   — tuỳ chọn, override policy mint ngoài
//   LAMP_PARAMS_STRICT=1       — bật chế độ nghiêm trên Preview (đối xứng BEACON_NFT_ONESHOT=1)
//
// Ghi kết quả vào deployed.json để 02/03/04 dùng lại.

import { createHash } from "node:crypto";
import {
  NETWORK, MS_PER_EPOCH, LAMP_ASSET_NAME,
  makeLucid, walletPkh, resolveCommittee,
  rawValidator, applyValidator, scriptAddress, scriptHash,
  nativeSigPolicyId, beaconNftPolicyIdFromRef, treasuryNftPolicyIdFromRef,
  accountNftPolicyId,
  pickGenesisRef, saveDeployed, type DeployedState, type GenesisRef,
} from "./config.js";

/**
 * Kiểm DẠNG một apply-param đọc từ env (hex, độ dài, giá trị chết).
 *
 * VÌ SAO CẦN: `resolveCommittee` (config.ts:95) đã chặn keyhash bằng `/^[0-9a-f]{56}$/`,
 * nhưng ba biến policy/asset-name dưới đây chỉ `.trim()`. Copy từ explorer ra **asset unit**
 * (policyId ‖ assetName — dài hơn 56) hoặc dán thiếu một ký tự ⇒ `applyValidator` nhận một
 * bytestring khác, KHÔNG ai báo lỗi, và ra 3 script-hash khác dự kiến. `DEPLOY_ACK` chỉ
 * chốt lại cái sai chứ không phát hiện sai dạng — nó băm chính giá trị hỏng.
 *
 * `bytes` = độ dài byte bắt buộc (28 cho policy-id/script-hash); bỏ trống = hex tự do
 * (asset-name). Toàn 0 / toàn f bị chặn: đúng dạng nhưng không có tiền ảnh blake2b-224
 * ⇒ không UTxO nào mang được policy đó (đúng vết bản mồi mainnet,
 * Genesis/offchain/src/deployed.ts:92).
 */
function hexParam(name: string, raw: string, bytes?: number): string {
  const v = raw.toLowerCase();
  const want = bytes ? `${bytes * 2} ký tự hex (${bytes} byte)` : "chuỗi hex độ dài chẵn";
  const okLen = bytes ? v.length === bytes * 2 : v.length > 0 && v.length % 2 === 0;
  if (!/^[0-9a-f]+$/.test(v) || !okLen) {
    throw new Error(
      `${name} sai dạng: cần ${want}, nhận ${v.length} ký tự ("${v.slice(0, 20)}…"). ` +
      `Đây là APPLY-PARAM: sai dạng không bị chặn ở tầng dưới, nó chỉ sinh ra script-hash ` +
      `khác — im lặng. Lỗi hay gặp: dán cả asset unit (policyId ‖ assetName) vào ô policy-id.`,
    );
  }
  if (/^0+$/.test(v) || /^f+$/.test(v)) {
    throw new Error(
      `${name} = ${v.slice(0, 8)}…(${v.length / 2} byte) — GIÁ TRỊ CHẾT. Toàn 0 / toàn f ` +
      `không có tiền ảnh, nên không token/credential nào khớp được ⇒ kho nướng theo nó là ` +
      `kho không nhả được đồng nào (LAMP KHÔNG burn).`,
    );
  }
  return v;
}

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
  // CỔNG GÁC (đối xứng với beacon_nft/treasury_nft ngay dưới, và với 03_genesis.ts:110-111):
  // `lamp_policy` là apply-param của CẢ claim_account LẪN treasury → nó nằm trong script-hash
  // của cả hai. Fallback `nativeSigPolicyId(pkh)` là policy của chính ví deploy, hợp lệ cho
  // self-test Preview nhưng trên Mainnet nó dựng ra một cặp script neo vào SAI token: LAMP thật
  // gửi vào kho đó không rút ra được (validator so lamp_policy khác) và LAMP KHÔNG burn.
  // Module này không có cờ SUBMIT nên gác theo NETWORK — fail-closed đúng như beacon/treasury.
  //
  // PHẠM VI GÁC (đối xứng với `wantOneshot` bên dưới: Mainnet luôn nghiêm + testnet có đường
  // bật tay): gác riêng `NETWORK === "Mainnet"` BỎ LỌT Preprod, mà `Genesis/mainnet-deploy-plan.md §C`
  // (GATE-C) lại bắt buộc diễn tập TRỌN pipeline trên **Preprod** làm cổng lên mainnet. Chạy
  // NETWORK=Preprod mà quên LAMP_POLICY_ID ⇒ rơi lặng vào `nativeSigPolicyId(pkh)` ⇒ claim_account
  // + treasury neo vào policy của CHÍNH VÍ DEPLOY, không phải tLAMP Genesis thật ⇒ diễn tập xanh
  // 100% mà KHÔNG kiểm chứng được đúng cái nối dây sẽ dùng ở mainnet — GATE-C mất hết ý nghĩa.
  // Nên: mọi network ≠ Preview đều nghiêm mặc định; Preview bật nghiêm bằng LAMP_PARAMS_STRICT=1.
  const strictLampParams = NETWORK !== "Preview" || process.env.LAMP_PARAMS_STRICT === "1";
  const envLampPolicy = (process.env.LAMP_POLICY_ID ?? "").trim();
  if (strictLampParams && !envLampPolicy) {
    throw new Error(
      `${NETWORK} KHÔNG cho lamp_policy fallback native-sig ví deploy. lamp_policy là apply-param ` +
      "của claim_account + treasury ⇒ sai giá trị = sai script-hash = LAMP rót vào kho KẸT vĩnh " +
      "viễn (no-burn). Lấy policyId LAMP mainnet ở Genesis/offchain/src/deployed.ts (LAMP_MAINNET.policyId) " +
      "— hoặc policyId tLAMP Genesis đang chạy nếu đây là diễn tập GATE-C trên Preprod — " +
      "rồi đặt LAMP_POLICY_ID=… trước khi chạy.",
    );
  }
  const lampPolicy = envLampPolicy
    ? hexParam("LAMP_POLICY_ID", envLampPolicy, 28)
    : nativeSigPolicyId(pkh);

  // ĐỐI XỨNG với guard ngay trên: `lamp_name` cũng là apply-param của CẢ claim_account LẪN
  // treasury, nên gác một nửa cặp (policy) mà bỏ nửa kia (name) là tái lập đúng thế bất đối
  // xứng đã đẻ ra bản mồi mainnet. Mặc định `LAMP_ASSET_NAME` của module này là hằng
  // "744c414d50" = tLAMP, KHÔNG đổi theo network (khác Genesis/scripts/config.ts vốn có
  // `tokenNameFor(network)`) — nên trên Mainnet cái mặc định đó là SAI: LAMP mainnet là
  // "4c414d50" (Genesis/offchain/src/deployed.ts:64). Quên biến ⇒ hai validator nướng nhãn
  // token không tồn tại ⇒ treasury không nhận ra LAMP thật ⇒ không nhả được đồng nào.
  const envLampName = (process.env.LAMP_ASSET_NAME ?? "").trim();
  if (strictLampParams && !envLampName) {
    throw new Error(
      `${NETWORK} KHÔNG cho lamp_name mặc định. Hằng LAMP_ASSET_NAME của module này là tLAMP ` +
      "(744c414d50), trong khi LAMP mainnet là 4c414d50 — lamp_name là apply-param của " +
      "claim_account + treasury ⇒ sai nhãn = sai script-hash = kho không nhận ra LAMP thật, " +
      "LAMP rót vào KẸT vĩnh viễn (no-burn). Lấy assetName ở Genesis/offchain/src/deployed.ts " +
      "(LAMP_MAINNET.assetName) rồi đặt LAMP_ASSET_NAME=… trước khi chạy.",
    );
  }
  // Không ép độ dài (asset-name tự do ≤ 32 byte) nhưng vẫn ép hex chẵn: `LAMP_ASSET_NAME=LAMP`
  // (ASCII) đi lọt `.trim()` sẽ thành một nhãn rác trong script-hash, và dòng
  // `Buffer.from(lampName, "hex")` bên dưới in ra chuỗi vô nghĩa thay vì báo lỗi.
  const lampName   = envLampName ? hexParam("LAMP_ASSET_NAME", envLampName) : LAMP_ASSET_NAME;

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
    // Cùng lớp lỗi với LAMP_POLICY_ID: đây cũng là apply-param của claim_account + beacon.
    beaconNftPolicy = hexParam("BEACON_NFT_POLICY", envBeacon, 28);
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

  // ── claim_account_nft (apply TRƯỚC NHẤT: policy id là tham số của 2 validator kia) ──
  const accountNftPolicy = await accountNftPolicyId(committeeData, thresholdData, treasuryNftPolicy);
  console.log(`account_nft_policy: ${accountNftPolicy}  (claim_account_nft — NFT xác thực tài khoản)`);
  console.log();

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
    accountNftPolicy,
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
    accountNftPolicy,
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
      lampPolicy, lampName, beaconNftPolicy, treasuryNftPolicy, accountNftPolicy,
      MS_PER_EPOCH.toString(),
      claimHash, beaconHash, treasuryHash,
    ].join("|"))
    .digest("hex")
    .slice(0, 16);

  console.log("── PREFLIGHT CHECKSUM (đối chiếu trước genesis no-undo) ──");
  console.log(`   committee (${committee.keyHashes.length}-of-N, threshold ${committee.threshold}):`);
  committee.keyHashes.forEach((k, i) => console.log(`     [${i}] ${k}`));
  console.log(`   lamp_policy:        ${lampPolicy}`);
  // lamp_name ĐÃ nằm trong checksum nhưng trước đây không được in — operator không đối
  // chiếu được thứ mình đang ký. In ra kèm giải mã ASCII để thấy ngay tLAMP vs LAMP.
  console.log(`   lamp_name:          ${lampName}  ("${Buffer.from(lampName, "hex").toString()}")`);
  console.log(`   beacon_nft_policy:  ${beaconNftPolicy}`);
  console.log(`   treasury_nft_policy:${treasuryNftPolicy}`);
  console.log(`   account_nft_policy: ${accountNftPolicy}`);
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
      accountNftPolicy,
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
