// Bộ sinh `onchain/validators/exunit_fixtures.ak` cho phép đo `[SUMBATCH-EXUNIT]` (SPEC §v2.10),
// kèm mô hình KÍCH THƯỚC giao dịch SumBatch tính từ CBOR thật của redeemer/datum.
//
// Chạy (không đặt biến thì cả bộ báo SKIP — không chạy ngầm trong `vitest run` thường):
//   GOV_GEN_EXUNIT=1 npm --prefix <…>/Governance/offchain exec -- vitest run --root <…>/Governance/offchain ../tests/exunitFixtures.gen.test.ts
// rồi `aiken fmt` trong `onchain/` (tệp sinh ra chưa theo khuôn fmt).
//
// Dữ liệu: MỘT proposal, lô tối đa 40 DID. Hai trạng thái sổ trước lô:
//   · `s0`   — sổ rỗng (lô đầu tiên của proposal);
//   · `s10k` — sổ đã có 10 000 DID (lô muộn của một proposal lớn): bằng chứng MPF dài hơn.
// Bằng chứng CHÈN dùng chung tiền tố: bằng chứng thứ i chỉ phụ thuộc trạng thái TRƯỚC lần chèn i,
// nên lô k lấy k phần tử đầu. Bằng chứng THÀNH VIÊN phụ thuộc gốc SAU cả lô ⇒ sinh riêng cho mỗi k.
// Mọi bằng chứng tự kiểm bằng đúng phép on-chain (gốc-không-khoá / gốc-có-khoá) trước khi ghi.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { blake2b } from "@noble/hashes/blake2b";
import { describe, expect, it } from "vitest";

import { nullifierRedeemerToCbor, tallyDatumToCbor, tallyRedeemerToCbor, voteRedeemerToCbor } from "../offchain/src/datum.js";
import { nullifierName } from "../offchain/src/names.js";
import type { MpfProof, TallyDatum } from "../offchain/src/types.js";
import { VOTED_ROOT_EMPTY, proofFromLibrary } from "../offchain/src/votedLedger.js";

const KS = [1, 2, 3, 4, 5, 10, 20, 40] as const;
const K_MAX = 40;
const SETS = [{ name: "s0", prefill: 0 }, { name: "s10k", prefill: 10_000 }] as const;
const OUT = resolve(__dirname, "../onchain/validators/exunit_fixtures.ak");

const h32 = (s: string) => Buffer.from(blake2b(Buffer.from(s), { dkLen: 32 })).toString("hex");
const PROP = h32("exunit-proposal");
const batchDid = (i: number) => h32(`exunit-batch-did-${i}`);
const prefillDid = (i: number) => h32(`exunit-prefill-did-${i}`);
const rootOf = (t: Trie) => (t.hash == null ? VOTED_ROOT_EMPTY : t.hash.toString("hex"));

function aikenProof(p: MpfProof): string {
  if (p.length === 0) return "[]";
  const steps = p.map((s) => {
    switch (s.kind) {
      case "Branch": return `Branch { skip: ${s.skip}, neighbors: #"${s.neighbors}" }`;
      case "Fork": return `Fork { skip: ${s.skip}, neighbor: Neighbor { nibble: ${s.neighbor.nibble}, prefix: #"${s.neighbor.prefix}", root: #"${s.neighbor.root}" } }`;
      case "Leaf": return `Leaf { skip: ${s.skip}, key: #"${s.key}", value: #"${s.value}" }`;
    }
  });
  return `[${steps.join(", ")}]`;
}

interface SetData {
  name: string;
  prefill: number;
  rootIn: string;
  /** gốc sau i+1 lần chèn, i = 0..K_MAX-1 */
  rootsAfter: string[];
  insertProofs: MpfProof[];
  /** mem[k] = bằng chứng thành viên của k DID đầu trong sổ sau lô k */
  mem: Record<number, MpfProof[]>;
}

async function buildSet(name: string, prefill: number): Promise<SetData> {
  const t = new Trie();
  for (let i = 0; i < prefill; i++) {
    const d = prefillDid(i);
    await t.insert(Buffer.from(d, "hex"), Buffer.from(nullifierName(d, PROP), "hex"));
  }
  const rootIn = rootOf(t);
  const rootsAfter: string[] = [];
  const insertProofs: MpfProof[] = [];
  const mem: Record<number, MpfProof[]> = {};
  let before = rootIn;
  for (let i = 0; i < K_MAX; i++) {
    const d = batchDid(i);
    const key = Buffer.from(d, "hex");
    await t.insert(key, Buffer.from(nullifierName(d, PROP), "hex"));
    const p = await t.prove(key);
    const ex = p.verify(false, undefined);
    const inc = p.verify(true, undefined);
    expect(ex == null ? VOTED_ROOT_EMPTY : ex.toString("hex")).toBe(before);
    expect(inc == null ? VOTED_ROOT_EMPTY : inc.toString("hex")).toBe(rootOf(t));
    insertProofs.push(proofFromLibrary(p.toJSON()));
    before = rootOf(t);
    rootsAfter.push(before);
    if ((KS as readonly number[]).includes(i + 1)) {
      const ps: MpfProof[] = [];
      for (let j = 0; j <= i; j++) {
        const pj = await t.prove(Buffer.from(batchDid(j), "hex"));
        const r = pj.verify(true, undefined);
        expect(r == null ? VOTED_ROOT_EMPTY : r.toString("hex")).toBe(before);
        ps.push(proofFromLibrary(pj.toJSON()));
      }
      mem[i + 1] = ps;
    }
  }
  return { name, prefill, rootIn, rootsAfter, insertProofs, mem };
}

function emit(sets: SetData[]): string {
  const L: string[] = [];
  L.push("// SINH TỰ ĐỘNG — KHÔNG SỬA TAY.");
  L.push("// Bộ sinh: `Governance/tests/exunitFixtures.gen.test.ts` (GOV_GEN_EXUNIT=1), rồi `aiken fmt`.");
  L.push("// Dữ liệu cho phép đo `[SUMBATCH-EXUNIT]` ở `exunit_test.ak`. Khoá MPF = did_commit (32 byte),");
  L.push("// giá trị = nullifier_name(did_commit, prop). Mọi bằng chứng đã tự kiểm bằng phép on-chain lúc sinh.");
  L.push("");
  L.push("use aiken/merkle_patricia_forestry.{Branch, Fork, Leaf, Neighbor, Proof}");
  L.push("");
  L.push(`pub const prop: ByteArray = #"${PROP}"`);
  L.push("");
  L.push(`/// ${K_MAX} DID của lô, đúng thứ tự chèn (= thứ tự input).`);
  L.push(`pub fn batch_dids() -> List<ByteArray> {`);
  L.push(`  [${Array.from({ length: K_MAX }, (_, i) => `#"${batchDid(i)}"`).join(", ")}]`);
  L.push("}");
  for (const s of sets) {
    L.push("");
    L.push(`// ═══ bộ \`${s.name}\`: sổ có ${s.prefill} DID trước lô ═══`);
    L.push("");
    L.push(`pub const ${s.name}_root_in: ByteArray = #"${s.rootIn}"`);
    L.push("");
    L.push(`/// Gốc sổ sau i+1 lần chèn (i = 0..${K_MAX - 1}).`);
    L.push(`pub fn ${s.name}_roots_after() -> List<ByteArray> {`);
    L.push(`  [${s.rootsAfter.map((r) => `#"${r}"`).join(", ")}]`);
    L.push("}");
    L.push("");
    L.push(`/// Bằng chứng CHÈN của ${K_MAX} DID, đúng thứ tự; lô k lấy k phần tử đầu.`);
    L.push(`pub fn ${s.name}_insert_proofs() -> List<Proof> {`);
    L.push(`  [${s.insertProofs.map(aikenProof).join(", ")}]`);
    L.push("}");
    for (const k of KS) {
      L.push("");
      L.push(`/// Bằng chứng THÀNH VIÊN của ${k} DID đầu trong sổ sau lô ${k}.`);
      L.push(`pub fn ${s.name}_mem_k${k}() -> List<Proof> {`);
      L.push(`  [${s.mem[k]!.map(aikenProof).join(", ")}]`);
      L.push("}");
    }
  }
  L.push("");
  return L.join("\n");
}

// ── Mô hình kích thước giao dịch (byte) ──
// Phần BIẾN THEO LÔ tính từ CBOR thật do codec SDK sinh; phần CỐ ĐỊNH là ước lượng có ghi rõ từng
// khoản — đối chiếu với kích thước thật của giao dịch dựng trong Emulator ở `exunitBench.test.ts`.
const INPUT_REF = 36;          // [txid(32+2), index] + đầu mảng
const REDEEMER_ENTRY = 16;     // khoá [tag, index] + ExUnits [mem, steps] + đầu cấu trúc, trừ phần data
const MINT_ENTRY = 36;         // tên 32 byte (+2) + số lượng âm

function heapDatum(heap: number): TallyDatum {
  return {
    proposal_id: PROP, phase: "Summing",
    weight_param_ref: { transaction_id: "ab".repeat(32), output_index: 0n },
    yes_power_raw: 0n, no_power_raw: 0n, abstain_power_raw: 0n, voters_acc: 10_040n, yes_voters_acc: 10_040n,
    top_did_vp: Array.from({ length: heap }, () => ({ vp_raw: 0n, choice: "Yes" as const })),
    yes_power_eff: 0n, no_power_eff: 0n, abstain_power_eff: 0n,
    vote_open_epoch: 100n, vote_close_epoch: 102n, voted_root: "00".repeat(32),
  };
}

function sizeModel(s: SetData, k: number, c3: boolean) {
  const cb = (hex: string) => hex.length / 2;
  const tallyRed = cb(tallyRedeemerToCbor({ kind: "SumBatch", insert_proofs: s.insertProofs.slice(0, k) }));
  const voteReds = s.mem[k]!.reduce((a, p) => a + cb(voteRedeemerToCbor({ kind: "ConsumeForTally", book_proof: p })), 0);
  const dids = Array.from({ length: k }, (_, i) => batchDid(i));
  const nlRed = cb(nullifierRedeemerToCbor({ kind: "BurnNullifier", proposal_id: PROP, did_commits: dids }));
  const redeemers = tallyRed + voteReds + nlRed + (k + 2) * REDEEMER_ENTRY;
  const inputs = (k + 1 + 1) * INPUT_REF;                 // tally + k phiếu + 1 input phí
  const refInputs = (1 + 3 + (c3 ? k : 0)) * INPUT_REF;   // bảng tham số + 3 reference script + k chứng thực
  const mint = 30 + k * MINT_ENTRY;
  const tallyOut = 70 + 40 + cb(tallyDatumToCbor(heapDatum(20)));   // địa chỉ + value (ADA + NFT) + datum heap 20
  // Cố định: output thối (~70) · collateral in (36) + collateral return (~70) + total collateral (9) ·
  // fee (5) · validity 2×(~6) · script_data_hash (34) · 1 chữ ký vkey (~102) · đầu cấu trúc (~20).
  const fixed = 70 + 36 + 70 + 9 + 5 + 12 + 34 + 102 + 20;
  return { tallyRed, voteReds, nlRed, redeemers, inputs, refInputs, mint, tallyOut, fixed,
    total: redeemers + inputs + refInputs + mint + tallyOut + fixed };
}

describe.skipIf(!process.env.GOV_GEN_EXUNIT)("sinh exunit_fixtures.ak + mô hình kích thước", () => {
  it("sinh tệp và in bảng kích thước", async () => {
    const sets: SetData[] = [];
    for (const s of SETS) sets.push(await buildSet(s.name, s.prefill));
    writeFileSync(OUT, emit(sets));
    const rows: string[] = ["bộ   | k  | C3  | insert_proofs | book_proofs | nl_red | redeemers | inputs | ref_in | mint | tally_out | cố định | TỔNG"];
    for (const s of sets) for (const c3 of [false, true]) for (const k of KS) {
      const m = sizeModel(s, k, c3);
      rows.push([s.name.padEnd(4), String(k).padStart(2), c3 ? "bật" : "tắt", m.tallyRed, m.voteReds, m.nlRed, m.redeemers,
        m.inputs, m.refInputs, m.mint, m.tallyOut, m.fixed, m.total].join(" | "));
    }
    // eslint-disable-next-line no-console
    console.log(rows.join("\n"));
    // Độ dài bằng chứng trung bình mỗi bộ (số bước).
    for (const s of sets) {
      const avg = (ps: MpfProof[]) => (ps.reduce((a, p) => a + p.length, 0) / ps.length).toFixed(2);
      // eslint-disable-next-line no-console
      console.log(`${s.name}: bước/bằng chứng chèn (40) = ${avg(s.insertProofs)}, bước/bằng chứng thành viên (k=40) = ${avg(s.mem[40]!)}`);
    }
  }, 600_000);
});
