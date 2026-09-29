// chainRead — đọc + kiểm UTxO đầu vào cho builder. Mọi hàm NÉM lỗi có mã khi hình dạng lạ;
// không hàm nào trả giá trị đệm.
//
// Mỗi hàm mirror một phép đọc on-chain (dẫn tên hàm Aiken ở từng chỗ) để builder từ chối dựng
// đúng những giao dịch mà validator sẽ từ chối — trượt ở máy dựng rẻ hơn trượt trên chuỗi.

import {
  Data, SLOT_CONFIG_NETWORK, credentialToAddress, getAddressDetails, toUnit,
  type LucidEvolution, type Network, type UTxO,
} from "@lucid-evolution/lucid";

import { decodeTallyDatum, decodeWeightParam } from "./datum.js";
import type { SlotConfig } from "./epochWindow.js";
import { d8Problem } from "./tallyMath.js";
import type { OutputRef, TallyDatum, WeightParam } from "./types.js";

export function utxoRef(u: UTxO): OutputRef {
  return { transaction_id: u.txHash, output_index: BigInt(u.outputIndex) };
}

export function sameRef(a: OutputRef, b: OutputRef): boolean {
  return a.transaction_id === b.transaction_id && a.output_index === b.output_index;
}

/** Thứ tự input mà ledger đưa vào ScriptContext: theo (txHash bytes, outputIndex). */
export function compareInputOrder(a: UTxO, b: UTxO): number {
  if (a.txHash !== b.txHash) return a.txHash < b.txHash ? -1 : 1;
  return a.outputIndex - b.outputIndex;
}

export function networkOf(lucid: LucidEvolution): Network {
  const n = lucid.config().network;
  if (n === undefined) throw new Error("GOV-CHAIN-001: lucid chưa có network (lucid.config().network rỗng)");
  return n;
}

export function slotConfigOf(lucid: LucidEvolution, override?: SlotConfig): SlotConfig {
  if (override) return override;
  const s = SLOT_CONFIG_NETWORK[networkOf(lucid)];
  if (!s) throw new Error(`GOV-CHAIN-002: không có SLOT_CONFIG cho mạng ${networkOf(lucid)}`);
  return s;
}

export function scriptAddress(network: Network, hash: string): string {
  return credentialToAddress(network, { type: "Script", hash });
}

/** Payment credential của địa chỉ là `Script(hash)`? — mirror util.ak ▸ is_at_script. */
export function isAtScript(address: string, hash: string): boolean {
  const pc = getAddressDetails(address).paymentCredential;
  return pc !== undefined && pc.type === "Script" && pc.hash === hash;
}

export function inlineDatumOf(u: UTxO, ctx: string): string {
  if (!u.datum) throw new Error(`GOV-CHAIN-003: ${ctx} (${u.txHash}#${u.outputIndex}) không có inline datum`);
  return u.datum;
}

/** Mọi tên tài sản của `policy` trong UTxO → số lượng. */
export function tokensOf(u: UTxO, policy: string): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const [unit, qty] of Object.entries(u.assets)) {
    if (unit !== "lovelace" && unit.startsWith(policy) && unit.length >= 56) m.set(unit.slice(56), qty);
  }
  return m;
}

export function qtyOf(u: UTxO, policy: string, name: string): bigint {
  return u.assets[toUnit(policy, name)] ?? 0n;
}

/**
 * UTxO bảng tham số — mirror `weight_ref.ak ▸ read_weight_param`: đúng ref đã cam kết, đúng MỘT
 * tên tài sản của `weight_param_policy` với số lượng 1, datum `WeightParam`, cổng D8.
 */
export function readWeightParam(u: UTxO, weightParamPolicyId: string, expectRef: OutputRef | null): WeightParam {
  if (expectRef !== null && !sameRef(utxoRef(u), expectRef)) {
    throw new Error(
      `GOV-CHAIN-010: UTxO bảng tham số ${u.txHash}#${u.outputIndex} ≠ weight_param_ref đã cam kết ` +
      `${expectRef.transaction_id}#${expectRef.output_index}`,
    );
  }
  const toks = [...tokensOf(u, weightParamPolicyId).entries()];
  if (toks.length !== 1 || toks[0]![1] !== 1n) {
    throw new Error(`GOV-CHAIN-011: UTxO bảng tham số phải mang đúng 1 token của weight_param_policy, thấy ${JSON.stringify(toks.map(([n, q]) => [n, String(q)]))}`);
  }
  const wp = decodeWeightParam(Data.from(inlineDatumOf(u, "UTxO bảng tham số")));
  const d8 = d8Problem(wp);
  if (d8 !== null) throw new Error(`GOV-CHAIN-012: bảng WeightParam vi phạm cổng D8 (weight_guard.d8_ok) — on-chain sẽ bác: ${d8}`);
  return wp;
}

/** Tally UTxO của `proposalId` — mirror `tally_ref.ak ▸ expect_tally` (+ vế địa chỉ nếu `scriptHash`). */
export function readTally(u: UTxO, tallyPolicyId: string, proposalId: string | null, scriptHash: string | null): TallyDatum {
  const td = decodeTallyDatum(Data.from(inlineDatumOf(u, "Tally UTxO")));
  if (proposalId !== null && td.proposal_id !== proposalId) {
    throw new Error(`GOV-CHAIN-020: Tally của proposal ${td.proposal_id}, mong ${proposalId}`);
  }
  if (qtyOf(u, tallyPolicyId, td.proposal_id) !== 1n) {
    throw new Error(`GOV-CHAIN-021: Tally UTxO không mang đúng 1 token (tally_policy, ${td.proposal_id})`);
  }
  if (tokensOf(u, tallyPolicyId).size !== 1) {
    throw new Error("GOV-CHAIN-022: Tally UTxO mang nhiều hơn một tên token tally_policy — tên token PHẢI ứng đúng một proposal_id");
  }
  if (scriptHash !== null && !isAtScript(u.address, scriptHash)) {
    throw new Error(`GOV-CHAIN-023: Tally UTxO không nằm tại Script(${scriptHash}) — governance (R-TALLY-HASH) sẽ không đọc`);
  }
  return td;
}
