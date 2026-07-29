// launch_did_mint.ts — Submit backend cho runbook GreenSun OrgDID mint LAMP (bước D).
//
// "CHƯA trong code app" theo LAMP-DID-Mint-DEPLOY-RUNBOOK.md §D. Đây là glue FFI-INDEPENDENT:
// nhận tx CBOR (hex) do builder Core (Rust FFI) dựng → fetch context → evaluate-then-patch
// ExUnits (builder để ExUnits TĨNH, node reject nếu không vá) → submit → poll. KHÔNG phụ thuộc
// chữ ký/loại tx → tái dùng cho B1–B4 (setup) lẫn C (mint).
//
// WIRING (khi builder Core feat/registry-mint-builders về local): gọi FFI dựng CBOR cho từng bước
// runbook, rồi đưa qua `evaluateAndPatch` → `submitAndPoll`. Các điểm gọi FFI đánh dấu TODO(ffi).
//
// AN TOÀN: NETWORK=Preview/preprod để dry-run TRƯỚC; SUBMIT=false để build-không-gửi. Mainnet chỉ
// chạy sau khi dry-run preprod xanh + anh duyệt. KHÔNG in seed/khoá.

import { BLOCKFROST_URL, BLOCKFROST_KEY, NETWORK, SUBMIT } from "./config.js";

// ─── Blockfrost REST (project_id header) ─────────────────────────────────────
async function bf(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BLOCKFROST_URL}${path}`, {
    ...init,
    headers: { project_id: BLOCKFROST_KEY, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Blockfrost ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.headers.get("content-type")?.includes("json") ? res.json() : res.text();
}

// ─── 1. FETCH CONTEXT (runbook D.1) ──────────────────────────────────────────

/** UTxO mang đúng 1 NFT (policy+name) + inline datum hex — anchor/registry/supply_state. */
export async function fetchNftUtxo(address: string, unit: string): Promise<{
  txHash: string; outputIndex: number; datumHex?: string; amount: any[];
}> {
  const utxos: any[] = await bf(`/addresses/${address}/utxos/${unit}`);
  if (!utxos.length) throw new Error(`không thấy UTxO mang ${unit} ở ${address}`);
  const u = utxos[0];
  let datumHex: string | undefined;
  if (u.inline_datum) datumHex = u.inline_datum;
  else if (u.data_hash) datumHex = (await bf(`/scripts/datum/${u.data_hash}/cbor`)).cbor;
  return { txHash: u.tx_hash, outputIndex: u.output_index, datumHex, amount: u.amount };
}

/** UTxO ví THUẦN-ADA (chỉ lovelace) cho collateral/fee — runbook ép collateral thuần-ADA. */
export async function fetchPureAdaUtxos(address: string, minLovelace = 5_000_000n): Promise<any[]> {
  const utxos: any[] = await bf(`/addresses/${address}/utxos`);
  return utxos.filter(
    (u) => u.amount.length === 1 && u.amount[0].unit === "lovelace" && BigInt(u.amount[0].quantity) >= minLovelace,
  );
}

/** Protocol params + slot tip (cho builder set validity range + tính phí). */
export async function fetchChainTip(): Promise<{ slot: number; epoch: number; params: any }> {
  const latest = await bf(`/blocks/latest`);
  const epoch = await bf(`/epochs/latest`);
  const params = await bf(`/epochs/${epoch.epoch}/parameters`);
  return { slot: latest.slot, epoch: epoch.epoch, params };
}

// ─── 2. EVALUATE-THEN-PATCH ExUnits (runbook D.2) ────────────────────────────

export type RedeemerBudget = { tag: string; index: number; ex_units: { mem: number; steps: number } };

/**
 * POST /utils/txs/evaluate → ngân sách ExUnits thực mỗi redeemer (builder để TĨNH).
 * Trả danh sách (tag,index)→ex_units để PATCH lại vào tx. Áp dụng patch = bước cần CML
 * (deserialize witness_set, set redeemer.ex_units, reserialize) — làm khi có CBOR builder thật
 * để khớp đúng cấu trúc redeemer (TODO(cml): patch in-place + tính lại fee).
 */
export async function evaluateExUnits(txCborHex: string): Promise<RedeemerBudget[]> {
  const out = await bf(`/utils/txs/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/cbor" },
    body: txCborHex,
  });
  // Ogmios-shape result: out.result.EvaluationResult { "spend:0": {memory,steps}, ... }
  const evalRes = out?.result?.EvaluationResult ?? out?.EvaluationResult ?? out;
  const budgets: RedeemerBudget[] = [];
  for (const [k, v] of Object.entries<any>(evalRes)) {
    const [tag, idx] = k.split(":");
    budgets.push({ tag, index: Number(idx), ex_units: { mem: v.memory, steps: v.steps } });
  }
  if (!budgets.length) throw new Error(`evaluate không trả ExUnits: ${JSON.stringify(out).slice(0, 200)}`);
  return budgets;
}

// ─── 3. SUBMIT + POLL (runbook D.3) ──────────────────────────────────────────

export async function submitAndPoll(txCborHex: string, opts = { timeoutMs: 120_000 }): Promise<string> {
  if (!SUBMIT) {
    console.log("   [SUBMIT=false] bỏ qua gửi — chỉ build/evaluate.");
    return "(not-submitted)";
  }
  const hash: string = await bf(`/tx/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/cbor" },
    body: Buffer.from(txCborHex, "hex") as any,
  });
  console.log(`   submitted: ${hash} — poll confirm…`);
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    try {
      await bf(`/txs/${hash}`);
      console.log(`   ✓ confirmed: ${hash}`);
      return hash;
    } catch { await new Promise((r) => setTimeout(r, 5_000)); }
  }
  throw new Error(`timeout chờ confirm ${hash}`);
}

// ─── 4. ORCHESTRATOR (runbook B→C) — wiring FFI builder ──────────────────────

/**
 * Khung chạy runbook. Mỗi bước: TODO(ffi) gọi builder Core dựng CBOR → evaluate → patch → submit.
 * Chạy theo thứ tự B1→B4 (setup 1 lần) rồi C (mint mỗi pot). Mint tuần-tự (spend supply_state).
 */
export async function runStep(label: string, buildCbor: () => Promise<string>): Promise<string> {
  console.log(`── ${label} ──`);
  const raw = await buildCbor();              // CBOR builder Core (ExUnits tĩnh)
  const budgets = await evaluateExUnits(raw); // ngân sách thật
  console.log(`   ExUnits: ${budgets.map((b) => `${b.tag}:${b.index}`).join(", ")}`);
  // const patched = patchExUnits(raw, budgets); // TODO(cml): khi có CBOR builder thật
  const patched = raw;                         // tạm: builder có thể đã tự set khi có evaluate
  return submitAndPoll(patched);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`launch_did_mint backend — NETWORK=${NETWORK} SUBMIT=${SUBMIT}`);
  console.log("Module D (fetch/evaluate/submit/poll) sẵn sàng. Chờ builder Core feat/registry-mint-builders để wire B1–B4/C.");
}
