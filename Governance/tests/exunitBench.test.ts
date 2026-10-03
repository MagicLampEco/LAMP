// Đối chiếu `[SUMBATCH-EXUNIT]` bằng ExUnit THẬT: dựng giao dịch SumBatch k phiếu bằng chính builder
// SDK trong Emulator, đọc ExUnit của từng redeemer do Lucid tính (máy UPLC cục bộ, validator đã biên
// dịch + apply tham số, qua lớp bọc thật — gồm cả phần giải ScriptContext mà ca đo Aiken
// `onchain/validators/exunit_test.ak` bỏ sót) và kích thước CBOR của giao dịch.
//
// Chạy (không đặt biến thì bộ báo SKIP):
//   GOV_BENCH=1 npm --prefix <…>/Governance/offchain exec -- vitest run --root <…>/Governance/offchain ../tests/exunitBench.test.ts
//
// Phạm vi: sổ RỖNG trước lô (lô đầu của proposal), heap rỗng — Emulator không dựng được Tally với
// sổ/heap có sẵn mà không đi qua đủ các lượt gom trước. Ca sổ lớn/heap đầy chỉ có ở ca đo Aiken.
// Giao dịch chỉ DỰNG, không nộp: mọi k đo trên cùng một trạng thái chuỗi.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  Constr, Data, Emulator, Lucid, generateEmulatorAccountFromPrivateKey, mintingPolicyToId,
  paymentCredentialOf, scriptFromNative, toUnit,
  type EmulatorAccount, type LucidEvolution, type TxSignBuilder, type UTxO,
} from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";

import { scriptAddress } from "../offchain/src/chainRead.js";
import { applyGovernanceBlueprint, withScriptRefs, type GovernanceConfig, type ScriptKind } from "../offchain/src/config.js";
import { voteDatumFromCbor } from "../offchain/src/datum.js";
import { buildOpenProposalTx } from "../offchain/src/openProposalBuilder.js";
import { buildSumBatchTx } from "../offchain/src/tallyBuilders.js";
import { SCALE } from "../offchain/src/tallyMath.js";
import type { Knot, WeightParam } from "../offchain/src/types.js";
import { buildCastVoteTx } from "../offchain/src/voteBuilders.js";
import { buildMintWeightParamTx } from "../offchain/src/weightParamBuilder.js";

const MS_PER_EPOCH = 3_600_000n;
// Gốc cửa sổ THẬT của Mainnet (Specs/Window/CONTRACT.md v1.0 §3), không phải 0: gốc 0 không phân
// biệt được bản có trừ gốc với bản quên trừ. Emulator chạy ở giờ thật (> gốc này) nên mọi mốc
// `now` đều ở sau gốc.
const ORIGIN_MS = 1_506_203_091_000n;
const blueprint = JSON.parse(readFileSync(resolve(__dirname, "../onchain/plutus.json"), "utf8"));
const pkhOf = (a: EmulatorAccount) => paymentCredentialOf(a.address).hash;

function anchorDatum(did: string, controller: string, device: string): string {
  const none = new Constr(1, []);
  return Data.to(new Constr(0, [
    did, new Constr(0, []), controller, "00", 0n, new Constr(0, []), [], none,
    none, none, none, none, none, 0n, device, [], none, 0n,
  ]));
}

async function submit(emulator: Emulator, tx: TxSignBuilder, extraKeys: string[] = []) {
  let s = tx.sign.withWallet();
  for (const k of extraKeys) s = s.sign.withPrivateKey(k);
  const h = await (await s.complete()).submit();
  emulator.awaitBlock(1);
  return h;
}

function advanceToEpoch(emulator: Emulator, target: bigint) {
  const t = Number(ORIGIN_MS + target * MS_PER_EPOCH) + 10_000;
  emulator.awaitSlot(Math.ceil((t - emulator.now()) / 1000));
}
const epochNow = (em: Emulator) => (BigInt(em.now()) - ORIGIN_MS) / MS_PER_EPOCH;

const k = (c: bigint, pow: bigint): Knot => ({ c, pow });
const LIN2 = [k(0n, 0n), k(100n, 100n * SCALE)];
const LIN8 = [0n, 1n, 4n, 16n, 64n, 256n, 1024n, 4096n].map((c) => k(c, c * SCALE));
const SQRT8 = [[0n, 0n], [1n, 1n], [4n, 2n], [16n, 4n], [64n, 8n], [256n, 16n], [1024n, 32n], [4096n, 64n]].map(([c, p]) => k(c!, p! * SCALE));

interface Row { label: string; k: number; ok: boolean; size?: number; spend?: { mem: bigint; steps: bigint }[]; mint?: { mem: bigint; steps: bigint }; total?: { mem: bigint; steps: bigint }; err?: string }

async function runScenario(label: string, tables: { k1: Knot[]; k2: Knot[]; k3: Knot[]; k4: Knot[] }, c3On: boolean, ks: number[]): Promise<Row[]> {
  const N = Math.max(...ks);
  const admin = generateEmulatorAccountFromPrivateKey({ lovelace: 5_000_000_000n });
  const voters = Array.from({ length: N }, () => ({
    ctrl: generateEmulatorAccountFromPrivateKey({ lovelace: 50_000_000n }),
    dev: generateEmulatorAccountFromPrivateKey({ lovelace: 5_000_000n }),
  }));
  const c3Issuer = generateEmulatorAccountFromPrivateKey({ lovelace: 0n });
  const emulator = new Emulator([admin, ...voters.flatMap((v) => [v.ctrl, v.dev])]);
  const lucid: LucidEvolution = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromPrivateKey(admin.privateKey);
  advanceToEpoch(emulator, epochNow(emulator) + 1n);
  const e0 = epochNow(emulator);

  const taadScript = scriptFromNative({ type: "sig", keyHash: pkhOf(admin) });
  const taadPolicyId = mintingPolicyToId(taadScript);
  const taadAddr = scriptAddress("Custom", taadPolicyId);
  const dids = voters.map((_, i) => (i + 16).toString(16).padStart(2, "0").repeat(32));
  let atx = lucid.newTx().attach.MintingPolicy(taadScript)
    .mintAssets(Object.fromEntries(dids.map((d) => [toUnit(taadPolicyId, d), 1n])));
  dids.forEach((d, i) => {
    atx = atx.pay.ToAddressWithData(taadAddr, { kind: "inline", value: anchorDatum(d, pkhOf(voters[i]!.ctrl), pkhOf(voters[i]!.dev)) },
      { lovelace: 3_000_000n, [toUnit(taadPolicyId, d)]: 1n });
  });
  await submit(emulator, await atx.addSignerKey(pkhOf(admin)).complete());
  const anchorOf = async (d: string) => (await lucid.utxosAtWithUnit(taadAddr, toUnit(taadPolicyId, d)))[0]!;

  const c3PolicyScript = scriptFromNative({ type: "sig", keyHash: pkhOf(admin) });
  const c3PolicyId = c3On ? mintingPolicyToId(c3PolicyScript) : "";
  const c3ScriptHash = c3On ? mintingPolicyToId(scriptFromNative({ type: "sig", keyHash: pkhOf(c3Issuer) })) : "";
  const C3 = 4000n;
  if (c3On) {
    const c3Addr = scriptAddress("Custom", c3ScriptHash);
    let ctx = lucid.newTx().attach.MintingPolicy(c3PolicyScript)
      .mintAssets(Object.fromEntries(dids.map((d) => [toUnit(c3PolicyId, d), 1n])));
    for (const d of dids) ctx = ctx.pay.ToAddressWithData(c3Addr, { kind: "inline", value: Data.to(C3) }, { lovelace: 2_000_000n, [toUnit(c3PolicyId, d)]: 1n });
    await submit(emulator, await ctx.addSignerKey(pkhOf(admin)).complete());
  }

  const wpSeed = (await lucid.wallet().getUtxos())[0]!;
  let cfg: GovernanceConfig = applyGovernanceBlueprint(blueprint, {
    phaseTag: "5031", taadPolicyId, c3PolicyId, c3ScriptHash, engagePolicies: [],
    msPerEpoch: MS_PER_EPOCH, windowOriginMs: ORIGIN_MS, tallyWindowEpochs: 2n, deltaMinEpochs: 1n, recoveryTimelockEpochs: 10n,
    weightParam: {
      seedRef: { transaction_id: wpSeed.txHash, output_index: BigInt(wpSeed.outputIndex) },
      phaseTag: "5031", bftFloorMin: 1n, bftFloorMax: 64n, quorumVotersMin: 1n,
    },
  });
  const wp: WeightParam = { ...tables, bft_floor: 21n, quorum_vp_threshold: 1n, quorum_voter_threshold: 1n, theta_num: 2n, theta_den: 3n };
  const mw = await buildMintWeightParamTx({ lucid, config: cfg, seedUtxo: wpSeed, weightParam: wp });
  await submit(emulator, mw.tx);
  const wpUtxo = (await lucid.utxosAtWithUnit(mw.address, mw.unit))[0]!;

  const refHolder = generateEmulatorAccountFromPrivateKey({ lovelace: 0n });
  const scriptOfKind = { governance: cfg.governanceScript, tally: cfg.tallyScript, vote: cfg.voteScript, nullifier: cfg.nullifierPolicy, tallyNft: cfg.tallyNftPolicy };
  const refs: Partial<Record<ScriptKind, UTxO>> = {};
  for (const kind of ["governance", "tally", "vote", "nullifier", "tallyNft"] as const) {
    const h = await submit(emulator, await lucid.newTx().pay.ToAddressWithData(refHolder.address, undefined, { lovelace: 60_000_000n }, scriptOfKind[kind]).complete());
    refs[kind] = (await lucid.utxosAt(refHolder.address)).find((x) => x.txHash === h)!;
  }
  cfg = withScriptRefs(cfg, refs);

  const seed = (await lucid.wallet().getUtxos()).find((u) => u.txHash !== wpSeed.txHash || u.outputIndex !== wpSeed.outputIndex)!;
  const op = await buildOpenProposalTx({ lucid, config: cfg, seedUtxo: seed, weightParamUtxo: wpUtxo, voteOpenEpoch: e0, voteCloseEpoch: e0 + 2n, nowMs: emulator.now() });
  await submit(emulator, op.tx);
  const getTally = async () => (await lucid.utxosAtWithUnit(op.tallyAddress, toUnit(cfg.tallyPolicyId, op.proposalId)))[0]!;

  for (let i = 0; i < N; i++) {
    lucid.selectWallet.fromPrivateKey(voters[i]!.ctrl.privateKey);
    const cv = await buildCastVoteTx({
      lucid, config: cfg, tallyUtxo: await getTally(), anchorUtxo: await anchorOf(dids[i]!),
      didCommit: dids[i]!, choice: "Yes", c3Capped: c3On ? C3 : 0n, nowMs: emulator.now(),
    });
    await submit(emulator, cv.tx, [voters[i]!.dev.privateKey]);
  }
  advanceToEpoch(emulator, e0 + 2n);
  lucid.selectWallet.fromPrivateKey(admin.privateKey);
  const voteUtxos = await lucid.utxosAt(scriptAddress("Custom", cfg.voteScriptHash));
  const c3Utxos = c3On ? await lucid.utxosAt(scriptAddress("Custom", c3ScriptHash)) : [];

  const rows: Row[] = [];
  for (const kk of ks) {
    const batch = voteUtxos.slice(0, kk);
    const batchDids = new Set(batch.map((u) => voteDatumFromCbor(u.datum!).did_commit));
    const attest = c3Utxos.filter((u) => Object.keys(u.assets).some((unit) => batchDids.has(unit.slice(56))));
    try {
      const r = await buildSumBatchTx({
        lucid, config: cfg, tallyUtxo: await getTally(), voteUtxos: batch, weightParamUtxo: wpUtxo,
        votedLedger: [], c3AttestUtxos: attest, nowMs: emulator.now(),
      });
      const t = r.tx.toTransaction();
      const flat = t.witness_set().redeemers()!.to_flat_format();
      const spend: { mem: bigint; steps: bigint }[] = [];
      let mint: { mem: bigint; steps: bigint } | undefined;
      let tm = 0n, ts = 0n;
      for (let i = 0; i < flat.len(); i++) {
        const rd = flat.get(i);
        const eu = { mem: rd.ex_units().mem(), steps: rd.ex_units().steps() };
        tm += eu.mem; ts += eu.steps;
        if (rd.tag() === 1) mint = eu; else spend.push(eu);
      }
      rows.push({ label, k: kk, ok: true, size: r.tx.toCBOR().length / 2, spend, ...(mint ? { mint } : {}), total: { mem: tm, steps: ts } });
    } catch (e) {
      rows.push({ label, k: kk, ok: false, err: String((e as Error)?.message ?? JSON.stringify(e)).slice(0, 300) });
    }
  }
  return rows;
}

describe.skipIf(!process.env.GOV_BENCH)("ExUnit + kích thước SumBatch thật trong Emulator", () => {
  it("bảng", async () => {
    const all: Row[] = [];
    all.push(...await runScenario("2 mốc, C3 tắt", { k1: LIN2, k2: LIN2, k3: LIN2, k4: LIN2 }, false, [1, 2, 3, 4, 5]));
    all.push(...await runScenario("8 mốc, C3 tắt", { k1: LIN8, k2: SQRT8, k3: LIN8, k4: SQRT8 }, false, [1, 2, 3, 4]));
    all.push(...await runScenario("8 mốc, C3 bật", { k1: LIN8, k2: SQRT8, k3: LIN8, k4: SQRT8 }, true, [1, 2, 3, 4, 6, 8]));
    const lines = all.map((r) => r.ok
      ? `${r.label} | k=${r.k} | size=${r.size} B (chưa ký) | tổng mem=${r.total!.mem} steps=${r.total!.steps} | mint(nullifier) ${r.mint?.mem}/${r.mint?.steps} | spend ${r.spend!.map((s) => `${s.mem}/${s.steps}`).join(", ")}`
      : `${r.label} | k=${r.k} | KHÔNG DỰNG ĐƯỢC: ${r.err}`);
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(all.length).toBeGreaterThan(0);
  }, 600_000);
});
