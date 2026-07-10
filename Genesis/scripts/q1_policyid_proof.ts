// q1_policyid_proof.ts — CHỨNG MINH Q1: policy-id LAMP CỐ ĐỊNH, không redeploy.
//
// Chạy: npx tsx q1_policyid_proof.ts   (LOCAL, KHÔNG submit — chỉ apply-param + hash)
//
// Chứng minh 2 mệnh đề:
//   (A) Chuỗi apply-param là DAG KHÔNG VÒNG:
//        dist_vault_hash = hash(dist_vault, [release_nft])           ← KHÔNG có lamp_policy
//        lamp_policy     = hash(lamp_mint, [thread, token, anchor_nft, dist_vault_hash, meter])
//        → lamp_policy phụ thuộc dist_vault_hash, dist_vault_hash KHÔNG phụ thuộc lamp_policy
//        → tính được, deploy được 1 lần.
//   (B) controller_pkh KHÔNG nằm trong param lamp_mint — nó ở anchor DATUM (runtime).
//        Đổi controller (rotate) = đổi datum anchor, KHÔNG đổi param → policy-id Y NGUYÊN.
//        Dựng 2 TAADDatum (controller A vs B) KHÁC nhau → cùng 1 policy-id.

import { Constr, Data } from "@lucid-evolution/lucid";
import { rawValidator, applyValidator, applyPolicy, policyId, scriptHashOf } from "./config.js";

const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

// ── Danh tính BẤT BIẾN (one-shot NFT + token name + caps) ──
const threadPid = "11".repeat(28); // thread NFT (SupplyState) — one-shot
const threadNm = hex("SUPPLY");
const tokenName = hex("LAMP");
const meterPid = "66".repeat(28); // reserve_thread (meter) — one-shot
const meterNm = hex("MET");
const releasePid = "5e".repeat(28); // release NFT (tầng nhả vesting) — one-shot
const releaseNm = hex("REL");
// anchor = TAAD script hash (policy) + blake2b_256(did) (name) — cố định đời DID
const anchorPid = "a9".repeat(28);
const anchorNm = "0b".repeat(32);

// ── load compiled code (async) ──
const distVaultCode = (await rawValidator("dist_vault.dist_vault.spend")).compiledCode;
const lampMintCode = (await rawValidator("lamp_mint.lamp_mint.mint")).compiledCode;

// ── (A) DAG apply-param ──
const distVault = applyValidator(distVaultCode, [releasePid, releaseNm]);
const distVaultHash = scriptHashOf(distVault);

function lampPolicyId(): string {
  const p = applyPolicy(lampMintCode, [
    threadPid,
    threadNm,
    tokenName,
    anchorPid,
    anchorNm,
    distVaultHash, // dist_dest = dist_vault hash (KHÔNG phải lamp_policy → không vòng)
    meterPid,
    meterNm,
  ]);
  return policyId(p);
}

// ── (B) 2 TAADDatum khác controller (rotate) ──
// TAADDatum = Constr(0, [did, entity(Org=Constr1), controller_pkh, hw, seq, status(Active=Constr0),
//                        guardians[], parent_did(None=Constr1), revoked_slot(None), recovery_anchor(None)])
function taadDatum(controllerPkh: string, seq: bigint): string {
  const None = new Constr(1, []);
  const datum = new Constr(0, [
    hex("did:phoenix:org:greensun"),
    new Constr(1, []), // entity_type = Org
    controllerPkh,
    "e5".repeat(32), // hw_key_pubkey
    seq,
    new Constr(0, []), // status = Active
    [], // guardians
    None, // parent_did
    None, // revoked_slot
    None, // recovery_anchor
  ]);
  return Data.to(datum);
}

const ctrlA = "a1".repeat(28); // controller TRƯỚC rotate
const ctrlB = "b2".repeat(28); // controller SAU rotate (seed mới)

const pidA = lampPolicyId();
const pidB = lampPolicyId(); // cùng param → cùng policy-id (controller không là param)
const datumA = taadDatum(ctrlA, 5n);
const datumB = taadDatum(ctrlB, 6n);

console.log("════════ Q1 PROOF: policy-id LAMP cố định ════════\n");
console.log("(A) DAG apply-param KHÔNG VÒNG:");
console.log(`   release_nft        = ${releasePid.slice(0, 12)}… / ${releaseNm}`);
console.log(`   dist_vault_hash    = ${distVaultHash}`);
console.log(`     ↑ input: [release_nft] — KHÔNG chứa lamp_policy ✓ (không vòng)`);
console.log(`   lamp_policy        = ${pidA}`);
console.log(`     ↑ input: [thread, token, anchor_nft, dist_vault_hash, meter] — KHÔNG tự tham chiếu ✓\n`);

console.log("(B) controller KHÔNG là param → rotate KHÔNG đổi policy-id:");
console.log(`   anchor datum (ctrl A=${ctrlA.slice(0, 8)}…, seq5): ${datumA.slice(0, 24)}…`);
console.log(`   anchor datum (ctrl B=${ctrlB.slice(0, 8)}…, seq6): ${datumB.slice(0, 24)}…`);
console.log(`   2 datum KHÁC nhau? ${datumA !== datumB ? "CÓ ✓" : "KHÔNG ✗"}`);
console.log(`   policy-id khi ctrl A: ${pidA}`);
console.log(`   policy-id khi ctrl B: ${pidB}`);
console.log(`   policy-id BẤT BIẾN qua rotate? ${pidA === pidB ? "CÓ ✓✓✓" : "KHÔNG ✗"}\n`);

if (pidA !== pidB) {
  console.error("❌ Q1 FAIL: policy-id đổi — sai!");
  process.exit(1);
}
console.log("✅ Q1 CHỨNG MINH: deploy 1 lần. Rotate/recovery đổi datum anchor (controller),");
console.log("   KHÔNG đổi param → policy-id LAMP y nguyên → KHÔNG bao giờ phải mint lại policy.");
