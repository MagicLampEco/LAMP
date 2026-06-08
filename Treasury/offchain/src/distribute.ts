// Orchestrator "điều tiết cung-cầu" — distributeToTreasuries.
// Thu `total` LAMP từ giao dịch → chia theo SplitParam vào ≥2 custody Accounting
// (mỗi custody là SCRIPT, KHÔNG ví PKH) → với MỖI recipient dựng 1 Collect (tái
// dùng buildCollectTx). Cả 2 vào Accounting (ledger). CONTRACT §3.1.
//
// THIẾT KẾ (4 trục):
//   - split.ts tính parts (S1: Σ parts == total, remainder dồn MagicLamp đầu).
//   - minOil ép total ≥ min_oil (chống bụi + buộc gộp lô).
//   - MỖI custody recipient là TOÀN-THU: cut_bps == 10000 ⇒ itemCut(part, 10000)
//     == part ⇒ TOÀN BỘ part_i vào custody (không residual). Đây là custody "điều
//     tiết cung-cầu" — khác custody cut-% (OriLife). Ép cut_bps == 10000 ⇒ value
//     bảo toàn từng Collect (part_i vào đúng custody, Σ = total).
//   - SCRIPT-ness: ép custody address payment credential là Script(custody_hash)
//     khớp recipient.custody_hash — chặn ví PKH lọt.
//
// ENFORCE tỷ lệ (MVP): ở orchestrator offchain + receipt on-chain minh bạch (mỗi
// Collect ghi app_id+amount vào ledger custody → đối soát). Hard-enforce Σ outputs
// đúng weight bằng 1 splitter validator = v1.x (xem CONTRACT §3.1, lý do hoãn).

import type { LucidEvolution, Network, UTxO, Validator, TxSignBuilder } from "@lucid-evolution/lucid";
import { Data, validatorToScriptHash } from "@lucid-evolution/lucid";

import type { CollectItem, CustodyDatum } from "./types.js";
import { decodeCustodyDatum } from "./datum.js";
import { buildCollectTx } from "./collectBuilder.js";
import {
  type Recipient, type SplitParam, paramValid, minOilOk, splitAmounts, sumInts,
} from "./split.js";

/** custody recipient PHẢI toàn-thu (toàn bộ part_i vào custody). */
const FULL_COLLECT_BPS = 10_000n;

export interface DistributeRecipientPlan {
  recipient: Recipient;       // custody đích (script hash + weight)
  part: bigint;               // số LAMP chia về custody này (S1: Σ == total)
  item: CollectItem;          // CollectItem dựng cho custody này (amount = part)
}

export interface DistributePlan {
  total: bigint;
  parts: bigint[];            // theo thứ tự recipients (S1: Σ == total)
  plans: DistributeRecipientPlan[];
}

export interface DistributeParams {
  lucid: LucidEvolution;
  network: Network;

  /** Tổng LAMP thu được (đã định giá ở app). Ép ≥ splitParam.min_oil. */
  total: bigint;

  splitParam: SplitParam;

  /** Custody UTxO theo ĐÚNG thứ tự splitParam.recipients (1 UTxO / recipient). */
  custodyUtxos: UTxO[];

  /** Validator custody (cùng 1 script param hoá; hash phân biệt từng instance qua addr). */
  custodyScripts: Validator[];

  /** Asset chia (LAMP). policy="" name="" cho lovelace. */
  policy: string;
  name: string;

  /** Ai trả (receipt — generators/OriLife/app). */
  appId: string;

  /** bucket_id đích trong mỗi custody ledger. */
  category: bigint;

  /** Epoch mới cho mỗi custody output (≥ datum.epoch). */
  newEpoch?: bigint;
}

export interface DistributeResult {
  plan: DistributePlan;
  txs: TxSignBuilder[];        // 1 tx Collect / recipient (theo thứ tự recipients)
  summary: string;
}

/**
 * Plan THUẦN (không cần lucid) — tách để test trực tiếp + tự kiểm bất biến.
 * Ném lỗi nếu vi phạm: param không hợp lệ, total < min_oil, hoặc Σ parts ≠ total.
 */
export function planDistribute(
  total: bigint, splitParam: SplitParam, policy: string, name: string,
  appId: string, category: bigint,
): DistributePlan {
  // S4 + cấu trúc param.
  if (!paramValid(splitParam)) {
    throw new Error("DIST-001: SplitParam không hợp lệ (≥2 recipient, Σ weight==10000, min_oil≥0, hash 28 byte)");
  }
  // S3: total ≥ min_oil (biên: min_oil-1 fail, min_oil pass).
  if (!minOilOk(total, splitParam.min_oil)) {
    throw new Error(`DIST-002: total (${total}) < min_oil (${splitParam.min_oil}) — settlement dưới ngưỡng bụi`);
  }

  const parts = splitAmounts(total, splitParam.recipients);

  // S1: Σ parts == total tuyệt đối (KHÔNG rơi oil khi chia lẻ).
  if (sumInts(parts) !== total) {
    throw new Error(`DIST-003: Σ parts (${sumInts(parts)}) ≠ total (${total}) — value không bảo toàn`);
  }

  const plans: DistributeRecipientPlan[] = splitParam.recipients.map((recipient, i) => {
    const part = parts[i]!;
    const item: CollectItem = { app_id: appId, policy, name, amount: part, category };
    return { recipient, part, item };
  });

  return { total, parts, plans };
}

/**
 * distributeToTreasuries — dựng 1 Collect tx / recipient.
 * Ép: số custody UTxO == số recipient; mỗi custody address là SCRIPT khớp
 * recipient.custody_hash (chặn ví PKH); mỗi custody datum cut_bps == 10000 (toàn-thu).
 */
export async function distributeToTreasuries(params: DistributeParams): Promise<DistributeResult> {
  const { lucid, network, total, splitParam, custodyUtxos, custodyScripts, policy, name, appId, category, newEpoch } = params;

  const plan = planDistribute(total, splitParam, policy, name, appId, category);

  const n = splitParam.recipients.length;
  if (custodyUtxos.length !== n) {
    throw new Error(`DIST-010: số custody UTxO (${custodyUtxos.length}) ≠ số recipient (${n})`);
  }
  if (custodyScripts.length !== n) {
    throw new Error(`DIST-011: số custody script (${custodyScripts.length}) ≠ số recipient (${n})`);
  }

  const txs: TxSignBuilder[] = [];
  const lines: string[] = [];

  for (let i = 0; i < n; i++) {
    const recipient = splitParam.recipients[i]!;
    const utxo = custodyUtxos[i]!;
    const script = custodyScripts[i]!;
    const part = plan.parts[i]!;

    // SCRIPT-ness + đúng custody: script hash khớp recipient.custody_hash.
    const scriptHash = validatorToScriptHash(script).toLowerCase();
    const wantHash = (recipient.custody_hash.startsWith("0x")
      ? recipient.custody_hash.slice(2) : recipient.custody_hash).toLowerCase();
    if (scriptHash !== wantHash) {
      throw new Error(`DIST-012: custody[${i}] script hash (${scriptHash}) ≠ recipient.custody_hash (${wantHash})`);
    }

    if (!utxo.datum) throw new Error(`DIST-013: custody[${i}] UTxO thiếu inline datum`);
    const datum: CustodyDatum = decodeCustodyDatum(Data.from(utxo.datum));

    // Toàn-thu: cut_bps == 10000 ⇒ itemCut(part,10000)==part ⇒ toàn bộ part vào custody.
    if (datum.cut_bps !== FULL_COLLECT_BPS) {
      throw new Error(`DIST-014: custody[${i}] cut_bps (${datum.cut_bps}) ≠ 10000 — distribute yêu cầu custody toàn-thu`);
    }

    // SCRIPT-ness: buildCollectTx dựng custody output từ validatorToScriptHash(script)
    // → payment credential LUÔN là Script (KHÔNG ví PKH). custody.ak còn ép
    // `!util.is_vk(cust_out.address)` on-chain. Hash đã khớp recipient.custody_hash trên.

    const item: CollectItem = { app_id: appId, policy, name, amount: part, category };
    const { tx } = await buildCollectTx({
      lucid, network, custodyUtxo: utxo, custodyScript: script, items: [item],
      ...(newEpoch !== undefined ? { newEpoch } : {}),
    });
    txs.push(tx);

    lines.push(`  [${i}] ${wantHash.slice(0, 8)}… weight=${recipient.weight_bps} part=${part}`);
  }

  const summary = [
    `═══ Distribute (điều tiết cung-cầu) ═══`,
    `Total:       ${total}`,
    `min_oil:     ${splitParam.min_oil}`,
    `Recipients:  ${n}`,
    ...lines,
    `Σ parts:     ${sumInts(plan.parts)} (== total: ${sumInts(plan.parts) === total})`,
  ].join("\n");

  return { plan, txs, summary };
}
