// verify_acyclic.ts — BẰNG CHỨNG PHÁ VÒNG phụ thuộc hash compile-time (VIỆC 1).
//
// Demo Preview cũ KẸT vì đồ thị param VÒNG TRÒN:
//   budget_nft(channel_budget_hash) → channel_budget(claim_account_hash)
//   → claim_account(channel_budget_hash) → ... vòng tròn → KHÔNG apply-param được.
//
// Sau tái thiết kế (NFT-beacon authenticity thay script-hash param chéo), đồ thị là DAG:
//   budget_nft(genesis_ref, channel_id, lamp_policy, lamp_name)   ← ĐÁY (không dep script)
//        │ (policy id = script hash của budget_nft đã apply)
//        ▼
//   claim_account(..., budget_nft_policy)                          ← dep budget_nft
//        │ (claim_account_hash)
//        ▼
//   treasury(claim_account_hash, ...)        channel_budget(..., budget_nft_policy, claim_account_hash)
//                                              ← dep budget_nft + claim_account (MỘT chiều)
//
// Script này apply-param THỰC theo đúng thứ tự topo. Nếu còn vòng → 1 bước sẽ thiếu
// đầu vào (hash chưa tồn tại) → KHÔNG chạy được. Chạy trót lọt cả 4 = chứng minh ACYCLIC.
//
// Chạy:  cd Allocation && npx tsx scripts/verify_acyclic.ts
//   (KHÔNG cần Blockfrost/ví — chỉ apply-param thuần + derive hash. Không submit gì.)

import {
  applyParamsToScript,
  validatorToScriptHash,
  Constr,
  type Validator,
} from "@lucid-evolution/lucid";
import { assertParamCountFromBlueprint } from "../../Genesis/offchain/src/applyGate.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Tham số giả lập (deterministic, KHÔNG chạm chain) ───────────────────────
const GENESIS_TXID = "aa".repeat(32);           // tx_id UTxO genesis (one-shot)
const GENESIS_IDX = 7n;                          // output_index
const CHANNEL_ID = Buffer.from("TEAM").toString("hex");  // NFT name = channel_id
const LAMP_POLICY = "b1474a77c8867762efda418adda90ecf7bb5ca35b0be13a7bfbf0ebd";
const LAMP_NAME = "4c414d50";                    // "LAMP"
const COMMITTEE = ["11".repeat(28)];             // committee key-hash list
const THRESHOLD = 1n;
const MS_PER_EPOCH = 86_400_000n;
const DROP_VALUE = 1_000_000n;

// ── Cổng đếm khe APPLY-001/002 ───────────────────────────────────────────────
// `applyParamsToScript` KHÔNG báo lỗi khi thiếu/thừa tham số: nó apply một phần rồi trả về
// một script hash KHÁC, im lặng — và ở script này hậu quả còn xảo hơn bình thường, vì nó
// dùng chính việc "apply trót lọt cả 4 bước" làm BẰNG CHỨNG đồ thị là DAG. Apply thiếu vẫn
// trót lọt ⇒ bằng chứng vẫn in ra "✔" trong khi chẳng chứng minh gì. Số khe đọc TỪ
// blueprint, không gõ tay. Lý do đầy đủ: `Genesis/offchain/src/applyGate.ts`.
async function applyChecked(title: string, params: unknown[]): Promise<Validator> {
  const json = JSON.parse(await readFile(resolve(__dirname, "../onchain/plutus.json"), "utf8"));
  const v = json.validators.find((x: { title: string }) => x.title === title);
  if (!v) throw new Error(`validator ${title} không thấy trong plutus.json`);
  assertParamCountFromBlueprint(json, title, "Allocation", params.length);
  return { type: "PlutusV3", script: applyParamsToScript(v.compiledCode as string, params as never) };
}

/** OutputReference = Constr(0, [tx_id_bytes, output_index_int]) — khớp Aiken. */
function outputRef(txId: string, idx: bigint): Constr<any> {
  return new Constr(0, [txId, idx]);
}

async function main() {
  console.log("=== verify_acyclic — chứng minh đồ thị param là DAG (phá vòng) ===\n");

  // ── Bước 1 (ĐÁY DAG): budget_nft(genesis_ref, channel_id, lamp_policy, lamp_name) ──
  // KHÔNG cần hash của bất kỳ script nào khác → apply được NGAY (đáy đồ thị).
  const budgetNftScript: Validator = await applyChecked("budget_nft.budget_nft.mint", [
    outputRef(GENESIS_TXID, GENESIS_IDX),
    CHANNEL_ID,
    LAMP_POLICY,
    LAMP_NAME,
  ]);
  // policy id của minting policy = script hash của chính nó.
  const budgetNftPolicy = validatorToScriptHash(budgetNftScript);
  console.log(`[1] budget_nft.policy_id      = ${budgetNftPolicy}`);

  // ── Bước 2: claim_account(..., budget_nft_policy) — chỉ dep budget_nft_policy (bước 1) ──
  const claimScript: Validator = await applyChecked("claim_account.claim_account.spend", [
    COMMITTEE,
    THRESHOLD,
    MS_PER_EPOCH,
    LAMP_POLICY,
    LAMP_NAME,
    DROP_VALUE,
    budgetNftPolicy,            // ← đầu ra bước 1 (KHÔNG cần channel_budget_hash nữa)
  ]);
  const claimHash = validatorToScriptHash(claimScript);
  console.log(`[2] claim_account.script_hash = ${claimHash}`);

  // ── Bước 3: treasury(claim_account_hash, lamp_policy, lamp_name) — dep claim (bước 2) ──
  const treasuryScript: Validator = await applyChecked("treasury.treasury.spend", [
    claimHash,                  // ← đầu ra bước 2
    LAMP_POLICY,
    LAMP_NAME,
  ]);
  const treasuryHash = validatorToScriptHash(treasuryScript);
  console.log(`[3] treasury.script_hash      = ${treasuryHash}`);

  // ── Bước 4: channel_budget(committee, threshold, budget_nft_policy, claim_account_hash) ──
  // Dep budget_nft_policy (bước 1) + claim_account_hash (bước 2) — MỘT chiều, KHÔNG vòng lại.
  const channelBudgetScript: Validator = await applyChecked("channel_budget.channel_budget.spend", [
    COMMITTEE,
    THRESHOLD,
    budgetNftPolicy,            // ← bước 1
    claimHash,                  // ← bước 2
  ]);
  const channelBudgetHash = validatorToScriptHash(channelBudgetScript);
  console.log(`[4] channel_budget.script_hash= ${channelBudgetHash}`);

  console.log("\n=== KẾT QUẢ ===");
  console.log("Apply-param TRÓT LỌT cả 4 theo thứ tự topo (genesis → nft → claim → treasury/budget).");
  console.log("KHÔNG bước nào cần hash của bước SAU nó → đồ thị ACYCLIC (DAG). Vòng đã phá. ✔");

  // Sanity: 4 hash phải khác nhau & đúng độ dài 28 byte (56 hex).
  const hashes = [budgetNftPolicy, claimHash, treasuryHash, channelBudgetHash];
  for (const h of hashes) {
    if (h.length !== 56) throw new Error(`hash sai độ dài: ${h}`);
  }
  if (new Set(hashes).size !== 4) throw new Error("trùng hash — bất thường");

  console.log(JSON.stringify({
    budget_nft_policy: budgetNftPolicy,
    claim_account_hash: claimHash,
    treasury_hash: treasuryHash,
    channel_budget_hash: channelBudgetHash,
  }, null, 2));
}

main().catch((e) => {
  console.error("❌ apply-param THẤT BẠI (còn vòng?):", e instanceof Error ? e.message : e);
  process.exit(1);
});
