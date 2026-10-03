// Đầu-cuối trong Emulator của Lucid Evolution, chạy VALIDATOR THẬT (biên dịch từ
// `onchain/plutus.json`, apply tham số bằng `applyGovernanceBlueprint`). `complete()` của Lucid
// đánh giá từng script bằng máy UPLC cục bộ — validator trả False là giao dịch không dựng được,
// nên mỗi bước xanh ở đây nghĩa là validator Aiken ĐÃ CHẤP NHẬN giao dịch do builder dựng.
//
// Kịch bản: đúc bảng tham số → mở proposal → 3 DID bỏ phiếu (A Yes, B No, C No) + A đúc thêm một
// nullifier trùng ra ví → B rút phiếu đổi sang Yes → hai lượt SumBatch (A, rồi B; sổ dựng lại từ
// danh sách lá lô trước) → Finalize tally → FinalizeProposal (Rejected — VP-ZERO-FACTOR) → C thu hồi phiếu chưa
// gom → A đốt nullifier trùng bằng đường (b).
//
// Anchor TAAD giả lập: policy = native script ký bởi admin, anchor nằm tại Script(policy) với
// datum 18 trường theo chỉ số của `anchor_view.ak`. KHÔNG phải validator TAAD thật của PhoenixKey.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  Constr, Data, Emulator, Lucid, generateEmulatorAccountFromPrivateKey, mintingPolicyToId,
  paymentCredentialOf, scriptFromNative, toUnit,
  type EmulatorAccount, type LucidEvolution, type UTxO,
} from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";

import { scriptAddress } from "../offchain/src/chainRead.js";
import {
  applyGovernanceBlueprint, withScriptRefs, type GovernanceConfig, type ScriptKind,
} from "../offchain/src/config.js";
import {
  nullifierRedeemerToCbor, proposalResultFromCbor, tallyDatumFromCbor, tallyDatumToCbor,
  tallyRedeemerToCbor, voteDatumFromCbor, voteRedeemerToCbor,
} from "../offchain/src/datum.js";
import { buildFinalizeProposalTx } from "../offchain/src/finalizeProposalBuilder.js";
import { nullifierName } from "../offchain/src/names.js";
import { buildOpenProposalTx } from "../offchain/src/openProposalBuilder.js";
import { buildFinalizeTallyTx, buildSumBatchTx } from "../offchain/src/tallyBuilders.js";
import { SCALE, sumBatchNext } from "../offchain/src/tallyMath.js";
import type { WeightParam } from "../offchain/src/types.js";
import {
  buildBurnNullifierTx, buildCastVoteTx, buildReclaimVoteTx, buildRetractVoteTx,
} from "../offchain/src/voteBuilders.js";
import { buildMintWeightParamTx } from "../offchain/src/weightParamBuilder.js";
import { VOTED_ROOT_EMPTY } from "../offchain/src/votedLedger.js";

const MS_PER_EPOCH = 3_600_000n;
// Gốc cửa sổ THẬT của Mainnet (Specs/Window/CONTRACT.md v1.0 §3), không phải 0: gốc 0 không phân
// biệt được bản có trừ gốc với bản quên trừ. Emulator chạy ở giờ thật (> gốc này) nên mọi mốc
// `now` đều ở sau gốc.
const ORIGIN_MS = 1_506_203_091_000n;
const blueprint = JSON.parse(readFileSync(resolve(__dirname, "../onchain/plutus.json"), "utf8"));

const pkhOf = (a: EmulatorAccount) => paymentCredentialOf(a.address).hash;

/** Datum anchor TAAD 18 trường (chỉ số theo `anchor_view.ak`). */
function anchorDatum(did: string, controller: string, device: string): string {
  const none = new Constr(1, []);
  return Data.to(new Constr(0, [
    did,                    // 0 did
    new Constr(0, []),      // 1 entity_type = Person
    controller,             // 2 controller_pkh
    "00",                   // 3 hw_key_pubkey
    0n,                     // 4 sequence
    new Constr(0, []),      // 5 status = Active
    [],                     // 6 guardians
    none,                   // 7 parent_did = None
    none, none, none, none, none, // 8..12
    0n,                     // 13 depth
    device,                 // 14 device_pkh
    [],                     // 15 aux_device_pkhs
    none,                   // 16 wakeme_vault_policy
    0n,                     // 17 last_active_ms
  ]));
}

async function submit(lucid: LucidEvolution, emulator: Emulator, tx: { sign: any }, extraKeys: string[] = []) {
  let s = tx.sign.withWallet();
  for (const k of extraKeys) s = s.sign.withPrivateKey(k);
  const signed = await s.complete();
  const h = await signed.submit();
  emulator.awaitBlock(1);
  return h as string;
}

/** Tiến tới đầu epoch `target` + 10 s. */
function advanceToEpoch(emulator: Emulator, target: bigint) {
  const t = Number(ORIGIN_MS + target * MS_PER_EPOCH) + 10_000;
  const now = emulator.now();
  if (t <= now) throw new Error(`advanceToEpoch: ${t} ≤ now ${now}`);
  emulator.awaitSlot(Math.ceil((t - now) / 1000));
}

const epochNow = (em: Emulator) => (BigInt(em.now()) - ORIGIN_MS) / MS_PER_EPOCH;

describe("E2E Governance v2 trên Emulator — validator thật", () => {
  it("mở → bỏ phiếu → rút → gom 2 lô → Finalize → FinalizeProposal=Rejected (VP-ZERO-FACTOR) → thu hồi → đốt", async () => {
    const admin = generateEmulatorAccountFromPrivateKey({ lovelace: 1_000_000_000n });
    const voters = ["A", "B", "C"].map(() => ({
      ctrl: generateEmulatorAccountFromPrivateKey({ lovelace: 100_000_000n }),
      dev: generateEmulatorAccountFromPrivateKey({ lovelace: 5_000_000n }),
    }));
    const emulator = new Emulator([admin, ...voters.flatMap((v) => [v.ctrl, v.dev])]);
    const lucid = await Lucid(emulator, "Custom");
    lucid.selectWallet.fromPrivateKey(admin.privateKey);

    // Bắt đầu ở đầu một epoch mới cho khỏi sát biên.
    advanceToEpoch(emulator, epochNow(emulator) + 1n);
    const e0 = epochNow(emulator);

    // ── anchor TAAD giả lập ──
    const taadScript = scriptFromNative({ type: "sig", keyHash: pkhOf(admin) });
    const taadPolicyId = mintingPolicyToId(taadScript);
    const dids = ["a1", "b2", "c3"].map((x) => x.repeat(32));
    const taadAddr = scriptAddress("Custom", taadPolicyId);
    let atx = lucid.newTx().attach.MintingPolicy(taadScript)
      .mintAssets(Object.fromEntries(dids.map((d) => [toUnit(taadPolicyId, d), 1n])));
    dids.forEach((d, i) => {
      atx = atx.pay.ToAddressWithData(taadAddr, { kind: "inline", value: anchorDatum(d, pkhOf(voters[i]!.ctrl), pkhOf(voters[i]!.dev)) },
        { lovelace: 3_000_000n, [toUnit(taadPolicyId, d)]: 1n });
    });
    await submit(lucid, emulator, await atx.addSignerKey(pkhOf(admin)).complete());
    const anchorOf = async (d: string) => (await lucid.utxosAtWithUnit(taadAddr, toUnit(taadPolicyId, d)))[0]!;

    // ── apply blueprint (seed của bảng tham số = một UTxO ví admin) ──
    const adminUtxos = await lucid.wallet().getUtxos();
    const wpSeed = adminUtxos[0]!;
    let cfg: GovernanceConfig = applyGovernanceBlueprint(blueprint, {
      phaseTag: "5031", taadPolicyId, c3PolicyId: "", c3ScriptHash: "", engagePolicies: [],
      msPerEpoch: MS_PER_EPOCH, windowOriginMs: ORIGIN_MS, tallyWindowEpochs: 2n, deltaMinEpochs: 1n, recoveryTimelockEpochs: 10n,
      weightParam: {
        seedRef: { transaction_id: wpSeed.txHash, output_index: BigInt(wpSeed.outputIndex) },
        phaseTag: "5031", bftFloorMin: 1n, bftFloorMax: 64n, quorumVotersMin: 1n,
      },
    });

    // ── 1. đúc bảng tham số ──
    // Bảng HỢP KHUÔN theo cổng G0 (`weight_guard.knots_wellformed`): `pow(0) = 0`.
    // Bảng cũ dùng `pow(0) = SCALE` và giờ bị `read_weight_param` bác.
    const knots = [{ c: 0n, pow: 0n }, { c: 100n, pow: 100n * SCALE }];
    const wp: WeightParam = {
      k1: knots, k2: knots, k3: knots, k4: knots, bft_floor: 2n, quorum_vp_threshold: 1n,
      quorum_voter_threshold: 1n, theta_num: 2n, theta_den: 3n,
    };
    // Ca âm: bft_floor ngoài [bftFloorMin, bftFloorMax] đã apply.
    await expect(buildMintWeightParamTx({ lucid, config: cfg, seedUtxo: wpSeed, weightParam: { ...wp, bft_floor: 65n } }))
      .rejects.toThrow("GOV-WP-004");
    const mw = await buildMintWeightParamTx({ lucid, config: cfg, seedUtxo: wpSeed, weightParam: wp });
    await submit(lucid, emulator, mw.tx);
    const wpUtxo = (await lucid.utxosAtWithUnit(mw.address, mw.unit))[0]!;
    expect(wpUtxo).toBeDefined();

    // ── 1b. triển khai reference script (CIP-33) — đính kèm trực tiếp vượt trần 16 384 byte ──
    // Mỗi script một giao dịch, gửi tới địa chỉ một account KHÔNG bao giờ được chọn làm ví
    // (để `complete()` không vô tình tiêu mất UTxO mang script).
    const refHolder = generateEmulatorAccountFromPrivateKey({ lovelace: 0n });
    const refKinds = ["governance", "tally", "vote", "nullifier", "tallyNft"] as const;
    const scriptOfKind = {
      governance: cfg.governanceScript, tally: cfg.tallyScript, vote: cfg.voteScript,
      nullifier: cfg.nullifierPolicy, tallyNft: cfg.tallyNftPolicy,
    };
    const refs: Partial<Record<ScriptKind, UTxO>> = {};
    for (const k of refKinds) {
      const dtx = await lucid.newTx()
        .pay.ToAddressWithData(refHolder.address, undefined, { lovelace: 60_000_000n }, scriptOfKind[k])
        .complete();
      const h = await submit(lucid, emulator, dtx);
      const u = (await lucid.utxosAt(refHolder.address)).find((x) => x.txHash === h);
      expect(u?.scriptRef).toBeDefined();
      refs[k] = u!;
    }
    // Ca âm: gắn nhầm UTxO mang script vote vào chỗ tally ⇒ hash lệch.
    expect(() => withScriptRefs(cfg, { tally: refs.vote! })).toThrow("GOV-REF-001");
    cfg = withScriptRefs(cfg, refs);

    // ── 2. mở proposal ──
    const seed = (await lucid.wallet().getUtxos()).find((u) => u.txHash !== wpSeed.txHash || u.outputIndex !== wpSeed.outputIndex)!;
    // Ca âm O3: close − open = 10 ≥ recovery_timelock_epochs (10).
    await expect(buildOpenProposalTx({
      lucid, config: cfg, seedUtxo: seed, weightParamUtxo: wpUtxo,
      voteOpenEpoch: e0, voteCloseEpoch: e0 + 10n, nowMs: emulator.now(),
    })).rejects.toThrow("GOV-OPEN-003");
    const op = await buildOpenProposalTx({
      lucid, config: cfg, seedUtxo: seed, weightParamUtxo: wpUtxo,
      voteOpenEpoch: e0, voteCloseEpoch: e0 + 2n, nowMs: emulator.now(),
    });
    await submit(lucid, emulator, op.tx);
    const pid = op.proposalId;
    const tallyUnit = toUnit(cfg.tallyPolicyId, pid);
    const getTally = async () => (await lucid.utxosAtWithUnit(op.tallyAddress, tallyUnit))[0]!;
    const getProposal = async () => (await lucid.utxosAtWithUnit(op.proposalAddress, toUnit(cfg.governancePolicyId, pid)))[0]!;
    expect(tallyDatumFromCbor((await getTally()).datum!).voted_root).toBe(VOTED_ROOT_EMPTY);
    expect(proposalResultFromCbor((await getProposal()).datum!).status).toBe("Open");

    // Ca âm: tally còn Summing ⇒ không FinalizeProposal được; cửa sổ gom chưa hết ⇒ không Finalize tally.
    await expect(buildFinalizeProposalTx({
      lucid, config: cfg, proposalUtxo: await getProposal(), tallyUtxo: await getTally(),
      weightParamUtxo: wpUtxo, nowMs: emulator.now(),
    })).rejects.toThrow("GOV-FINP-003");
    await expect(buildFinalizeTallyTx({ lucid, config: cfg, tallyUtxo: await getTally(), weightParamUtxo: wpUtxo, nowMs: emulator.now() }))
      .rejects.toThrow("GOV-TALLY-020");
    // Ca âm bỏ phiếu: c1 ≠ 0; và `now` còn 30 s tới hết kỷ nguyên (< MIN_WINDOW_MS) ⇒ không dựng
    // được khoảng hiệu lực nằm trọn một epoch.
    lucid.selectWallet.fromPrivateKey(voters[0]!.ctrl.privateKey);
    await expect(buildCastVoteTx({
      lucid, config: cfg, tallyUtxo: await getTally(), anchorUtxo: await anchorOf(dids[0]!),
      didCommit: dids[0]!, choice: "Yes", c1Capped: 1n, nowMs: emulator.now(),
    })).rejects.toThrow("GOV-VOTE-004");
    await expect(buildCastVoteTx({
      lucid, config: cfg, tallyUtxo: await getTally(), anchorUtxo: await anchorOf(dids[0]!),
      didCommit: dids[0]!, choice: "Yes", nowMs: Number(ORIGIN_MS + (e0 + 1n) * MS_PER_EPOCH) - 30_000,
    })).rejects.toThrow("GOV-WINDOW-001");

    // ── 3. bỏ phiếu ──
    const choices = ["Yes", "No", "No"] as const;
    for (let i = 0; i < 3; i++) {
      const v = voters[i]!;
      lucid.selectWallet.fromPrivateKey(v.ctrl.privateKey);
      const cv = await buildCastVoteTx({
        lucid, config: cfg, tallyUtxo: await getTally(), anchorUtxo: await anchorOf(dids[i]!),
        didCommit: dids[i]!, choice: choices[i]!, nowMs: emulator.now(),
      });
      await submit(lucid, emulator, cv.tx, [v.dev.privateKey]);
    }
    const voteAddr = scriptAddress("Custom", cfg.voteScriptHash);
    const voteOf = async (did: string) => {
      const us = (await lucid.utxosAt(voteAddr)).filter((u) => voteDatumFromCbor(u.datum!).did_commit === did);
      expect(us).toHaveLength(1);
      return us[0]!;
    };

    // A đúc thêm MỘT nullifier trùng ra ví (không qua vote script) — [SELF-DUP-CHOICE]: vô hại,
    // sổ chỉ đếm một lần. Dựng tay vì builder castVote luôn gửi phiếu vào vote script.
    {
      const v = voters[0]!;
      lucid.selectWallet.fromPrivateKey(v.ctrl.privateKey);
      const { boundedEpochWindow } = await import("../offchain/src/epochWindow.js");
      const { slotConfigOf } = await import("../offchain/src/chainRead.js");
      const w = boundedEpochWindow(emulator.now(), MS_PER_EPOCH, ORIGIN_MS, slotConfigOf(lucid));
      const tx = await lucid.newTx()
        .readFrom([await getTally(), await anchorOf(dids[0]!)])
        .mintAssets({ [toUnit(cfg.nullifierPolicyId, nullifierName(dids[0]!, pid))]: 1n },
          nullifierRedeemerToCbor({ kind: "MintNullifier", did_commit: dids[0]!, proposal_id: pid }))
        .attach.MintingPolicy(cfg.nullifierPolicy)
        .addSignerKey(pkhOf(v.ctrl)).addSignerKey(pkhOf(v.dev))
        .validFrom(w.loMs).validTo(w.hiMs).complete();
      await submit(lucid, emulator, tx, [v.dev.privateKey]);
    }

    // ── 4. B rút phiếu: No → Yes ──
    lucid.selectWallet.fromPrivateKey(voters[1]!.ctrl.privateKey);
    const rv = await buildRetractVoteTx({
      lucid, config: cfg, voteUtxo: await voteOf(dids[1]!), tallyUtxo: await getTally(),
      anchorUtxo: await anchorOf(dids[1]!), newChoice: "Yes", nowMs: emulator.now(),
    });
    await submit(lucid, emulator, rv.tx, [voters[1]!.dev.privateKey]);
    expect(voteDatumFromCbor((await voteOf(dids[1]!)).datum!).choice).toBe("Yes");

    // ── 5. gom hai lô trong [close, close + window) ──
    advanceToEpoch(emulator, e0 + 2n);
    // Ca âm: đã tới vote_close ⇒ ngoài cửa sổ bỏ phiếu.
    lucid.selectWallet.fromPrivateKey(voters[0]!.ctrl.privateKey);
    await expect(buildCastVoteTx({
      lucid, config: cfg, tallyUtxo: await getTally(), anchorUtxo: await anchorOf(dids[0]!),
      didCommit: dids[0]!, choice: "Yes", nowMs: emulator.now(),
    })).rejects.toThrow("GOV-VOTE-002");
    lucid.selectWallet.fromPrivateKey(admin.privateKey);
    const b1 = await buildSumBatchTx({
      lucid, config: cfg, tallyUtxo: await getTally(), voteUtxos: [await voteOf(dids[0]!)],
      weightParamUtxo: wpUtxo, votedLedger: [], nowMs: emulator.now(),
    });
    // Ca âm on-chain (chứng minh validator THẬT được chạy khi `complete()`): cùng lô, cùng proof,
    // nhưng tally đầu ra giữ `voted_root` cũ ⇒ tally.ak phải từ chối (gốc sau ≠ gốc suy từ proof).
    {
      const tU = await getTally();
      const vU = await voteOf(dids[0]!);
      const { boundedEpochWindow } = await import("../offchain/src/epochWindow.js");
      const { slotConfigOf } = await import("../offchain/src/chainRead.js");
      const w = boundedEpochWindow(emulator.now(), MS_PER_EPOCH, ORIGIN_MS, slotConfigOf(lucid));
      const badOut = { ...b1.tallyDatumOut, voted_root: b1.plan.rootBefore };
      const bad = lucid.newTx()
        .collectFrom([tU], tallyRedeemerToCbor({ kind: "SumBatch", insert_proofs: b1.plan.insertProofs }))
        .collectFrom([vU], voteRedeemerToCbor({ kind: "ConsumeForTally", book_proof: b1.plan.membershipProofs[0]! }))
        .readFrom([wpUtxo, refs.tally!, refs.vote!, refs.nullifier!])
        .mintAssets({ [toUnit(cfg.nullifierPolicyId, voteDatumFromCbor(vU.datum!).nullifier)]: -1n },
          nullifierRedeemerToCbor({
            kind: "BurnNullifier", proposal_id: pid,
            did_commits: [voteDatumFromCbor(vU.datum!).did_commit],
          }))
        .pay.ToAddressWithData(tU.address, { kind: "inline", value: tallyDatumToCbor(badOut) }, { ...tU.assets })
        .validFrom(w.loMs).validTo(w.hiMs)
        .complete();
      const err = await bad.then(() => null, (e: unknown) => e);
      expect(err).not.toBeNull();
      expect(JSON.stringify(err)).toContain("failed script execution");
    }
    await submit(lucid, emulator, b1.tx);
    const td1 = tallyDatumFromCbor((await getTally()).datum!);
    expect(td1.voted_root).toBe(b1.plan.rootAfter);
    expect(td1.voters_acc).toBe(1n);

    // Ca âm: sổ off-chain cũ (rỗng) không khớp voted_root hiện tại của Tally.
    await expect(buildSumBatchTx({
      lucid, config: cfg, tallyUtxo: await getTally(), voteUtxos: [await voteOf(dids[1]!)],
      weightParamUtxo: wpUtxo, votedLedger: [], nowMs: emulator.now(),
    })).rejects.toThrow("GOV-LEDGER-001");
    const b2 = await buildSumBatchTx({
      lucid, config: cfg, tallyUtxo: await getTally(), voteUtxos: [await voteOf(dids[1]!)],
      weightParamUtxo: wpUtxo, votedLedger: b1.plan.entries, nowMs: emulator.now(),
    });
    await submit(lucid, emulator, b2.tx);
    const td2 = tallyDatumFromCbor((await getTally()).datum!);
    expect(td2).toEqual(b2.tallyDatumOut);
    expect(td2.yes_voters_acc).toBe(2n);
    // `[VP-ZERO-FACTOR]`: bảng hợp khuôn + `c1 = c2 = c4` bị ép 0 ⇒ tích nhân ra 0.
    expect(td2.yes_power_raw).toBe(0n);
    expect(td2.top_did_vp).toEqual([{ vp_raw: 0n, choice: "Yes" }]); // F − 1 = 1 entry

    // ── 6. Finalize tally + FinalizeProposal ──
    advanceToEpoch(emulator, e0 + 4n);
    const ft = await buildFinalizeTallyTx({ lucid, config: cfg, tallyUtxo: await getTally(), weightParamUtxo: wpUtxo, nowMs: emulator.now() });
    await submit(lucid, emulator, ft.tx);
    expect(tallyDatumFromCbor((await getTally()).datum!).phase).toBe("Clamped");

    const fp = await buildFinalizeProposalTx({
      lucid, config: cfg, proposalUtxo: await getProposal(), tallyUtxo: await getTally(),
      weightParamUtxo: wpUtxo, nowMs: emulator.now(),
    });
    // `[VP-ZERO-FACTOR]`: bảng knots hợp khuôn (`pow(0) = 0`) cộng `c_sources_ok` ép
    // `c1 = c2 = c4 = 0` ⇒ mọi VP = 0 ⇒ quorum VP không bao giờ đạt ⇒ verdict là
    // `Rejected`. Đây là HỆ QUẢ của mô hình tích nhân, không phải lỗi: `Executed` ở
    // Pha 1/2 đòi có nguồn C1/C2/C4 on-chain trước (`[C1-C2-C4-SOURCE]`).
    expect(fp.verdict).toBe("Rejected");
    await submit(lucid, emulator, fp.tx);
    const prOut = proposalResultFromCbor((await getProposal()).datum!);
    expect(prOut.status).toBe("Rejected");
    expect(prOut.spend_spec_hash).toBe("");

    // ── 7. C thu hồi phiếu chưa gom ──
    lucid.selectWallet.fromPrivateKey(voters[2]!.ctrl.privateKey);
    const rc = await buildReclaimVoteTx({
      lucid, config: cfg, voteUtxo: await voteOf(dids[2]!), tallyUtxo: await getTally(),
      anchorUtxo: await anchorOf(dids[2]!), nowMs: emulator.now(),
    });
    await submit(lucid, emulator, rc.tx, [voters[2]!.dev.privateKey]);
    expect(await lucid.utxosAt(voteAddr)).toHaveLength(0);

    // ── 8. A đốt nullifier trùng đang nằm ở ví (đường (b)) ──
    lucid.selectWallet.fromPrivateKey(voters[0]!.ctrl.privateKey);
    const nA = nullifierName(dids[0]!, pid);
    const holders: UTxO[] = (await lucid.wallet().getUtxos()).filter((u) => (u.assets[toUnit(cfg.nullifierPolicyId, nA)] ?? 0n) > 0n);
    expect(holders).toHaveLength(1);
    const bn = await buildBurnNullifierTx({
      lucid, config: cfg, tallyUtxo: await getTally(), didCommits: [dids[0]!], holderUtxos: holders, nowMs: emulator.now(),
    });
    await submit(lucid, emulator, bn.tx);
    const left = (await lucid.wallet().getUtxos()).filter((u) => (u.assets[toUnit(cfg.nullifierPolicyId, nA)] ?? 0n) > 0n);
    expect(left).toHaveLength(0);
  }, 120_000);

  // Pha BẬT C3: `c3_policy` + `c3_script_hash` thật trong Emulator. Chứng thực C3 là NFT
  // `(c3_policy, did_commit)` đặt tại `Script(c3_script_hash)` với datum inline Int.
  // `c3_policy` = native script ký bởi bên phát hành; `c3_script_hash` = hash một native script
  // khác (payment credential `Script(hash)` gồm cả native script — `attested_c3` chỉ so credential).
  // KHÔNG phải hợp đồng C3 thật (chưa tồn tại — `[C1-C2-C4-SOURCE]` / C3-ISSUER).
  //
  // Hai lô: A (c3 = 10, chứng thực 10) rồi B (c3 = 40, chứng thực 40). Cặp đối chứng một biến ở lô
  // B: CÙNG phiếu, CÙNG bằng chứng sổ, chỉ đổi reference input chứng thực — bản ở ví thường (datum
  // 100 do người giữ tự viết) thì validator bác, bản tại Script(c3_script_hash) thì qua.
  it("pha bật C3: chứng thực phải nằm tại Script(c3_script_hash) — bản ở ví thường bị validator bác", async () => {
    const admin = generateEmulatorAccountFromPrivateKey({ lovelace: 1_000_000_000n });
    const voters = ["A", "B"].map(() => ({
      ctrl: generateEmulatorAccountFromPrivateKey({ lovelace: 100_000_000n }),
      dev: generateEmulatorAccountFromPrivateKey({ lovelace: 5_000_000n }),
    }));
    // Ví giữ chứng thực GIẢ — không bao giờ được chọn làm ví dựng giao dịch.
    const forger = generateEmulatorAccountFromPrivateKey({ lovelace: 0n });
    const c3Issuer = generateEmulatorAccountFromPrivateKey({ lovelace: 0n });
    const emulator = new Emulator([admin, ...voters.flatMap((v) => [v.ctrl, v.dev])]);
    const lucid = await Lucid(emulator, "Custom");
    lucid.selectWallet.fromPrivateKey(admin.privateKey);
    advanceToEpoch(emulator, epochNow(emulator) + 1n);
    const e0 = epochNow(emulator);

    // anchor TAAD giả lập
    const taadScript = scriptFromNative({ type: "sig", keyHash: pkhOf(admin) });
    const taadPolicyId = mintingPolicyToId(taadScript);
    const dids = ["a1", "b2"].map((x) => x.repeat(32));
    const taadAddr = scriptAddress("Custom", taadPolicyId);
    let atx = lucid.newTx().attach.MintingPolicy(taadScript)
      .mintAssets(Object.fromEntries(dids.map((d) => [toUnit(taadPolicyId, d), 1n])));
    dids.forEach((d, i) => {
      atx = atx.pay.ToAddressWithData(taadAddr, { kind: "inline", value: anchorDatum(d, pkhOf(voters[i]!.ctrl), pkhOf(voters[i]!.dev)) },
        { lovelace: 3_000_000n, [toUnit(taadPolicyId, d)]: 1n });
    });
    await submit(lucid, emulator, await atx.addSignerKey(pkhOf(admin)).complete());
    const anchorOf = async (d: string) => (await lucid.utxosAtWithUnit(taadAddr, toUnit(taadPolicyId, d)))[0]!;

    // C3: policy của bên phát hành + script GIỮ chứng thực
    const c3PolicyScript = scriptFromNative({ type: "sig", keyHash: pkhOf(admin) });
    const c3PolicyId = mintingPolicyToId(c3PolicyScript);
    const c3HolderScript = scriptFromNative({ type: "sig", keyHash: pkhOf(c3Issuer) });
    const c3ScriptHash = mintingPolicyToId(c3HolderScript);
    const c3Addr = scriptAddress("Custom", c3ScriptHash);
    const c3Unit = (d: string) => toUnit(c3PolicyId, d);
    const c3Claim = [10n, 40n];
    {
      // Chứng thực THẬT tại Script(c3_script_hash) cho A và B + một bản GIẢ cho B ở ví `forger`.
      let ctx = lucid.newTx().attach.MintingPolicy(c3PolicyScript)
        .mintAssets({ [c3Unit(dids[0]!)]: 1n, [c3Unit(dids[1]!)]: 2n });
      dids.forEach((d, i) => {
        ctx = ctx.pay.ToAddressWithData(c3Addr, { kind: "inline", value: Data.to(c3Claim[i]!) }, { lovelace: 2_000_000n, [c3Unit(d)]: 1n });
      });
      ctx = ctx.pay.ToAddressWithData(forger.address, { kind: "inline", value: Data.to(100n) }, { lovelace: 2_000_000n, [c3Unit(dids[1]!)]: 1n });
      await submit(lucid, emulator, await ctx.addSignerKey(pkhOf(admin)).complete());
    }
    const realAttest = async (d: string) => (await lucid.utxosAtWithUnit(c3Addr, c3Unit(d)))[0]!;
    const forgedB = (await lucid.utxosAtWithUnit(forger.address, c3Unit(dids[1]!)))[0]!;
    expect(forgedB).toBeDefined();

    const adminUtxos = await lucid.wallet().getUtxos();
    const wpSeed = adminUtxos[0]!;
    let cfg: GovernanceConfig = applyGovernanceBlueprint(blueprint, {
      phaseTag: "5032", taadPolicyId, c3PolicyId, c3ScriptHash, engagePolicies: [],
      msPerEpoch: MS_PER_EPOCH, windowOriginMs: ORIGIN_MS, tallyWindowEpochs: 2n, deltaMinEpochs: 1n, recoveryTimelockEpochs: 10n,
      weightParam: {
        seedRef: { transaction_id: wpSeed.txHash, output_index: BigInt(wpSeed.outputIndex) },
        phaseTag: "5032", bftFloorMin: 1n, bftFloorMax: 64n, quorumVotersMin: 1n,
      },
    });
    const knots = [{ c: 0n, pow: 0n }, { c: 100n, pow: 100n * SCALE }];
    const wp: WeightParam = {
      k1: knots, k2: knots, k3: knots, k4: knots, bft_floor: 2n, quorum_vp_threshold: 1n,
      quorum_voter_threshold: 1n, theta_num: 2n, theta_den: 3n,
    };
    const mw = await buildMintWeightParamTx({ lucid, config: cfg, seedUtxo: wpSeed, weightParam: wp });
    await submit(lucid, emulator, mw.tx);
    const wpUtxo = (await lucid.utxosAtWithUnit(mw.address, mw.unit))[0]!;

    const refHolder = generateEmulatorAccountFromPrivateKey({ lovelace: 0n });
    const scriptOfKind = {
      governance: cfg.governanceScript, tally: cfg.tallyScript, vote: cfg.voteScript,
      nullifier: cfg.nullifierPolicy, tallyNft: cfg.tallyNftPolicy,
    };
    const refs: Partial<Record<ScriptKind, UTxO>> = {};
    for (const k of ["governance", "tally", "vote", "nullifier", "tallyNft"] as const) {
      const h = await submit(lucid, emulator, await lucid.newTx()
        .pay.ToAddressWithData(refHolder.address, undefined, { lovelace: 60_000_000n }, scriptOfKind[k]).complete());
      refs[k] = (await lucid.utxosAt(refHolder.address)).find((x) => x.txHash === h)!;
    }
    cfg = withScriptRefs(cfg, refs);

    const seed = (await lucid.wallet().getUtxos()).find((u) => u.txHash !== wpSeed.txHash || u.outputIndex !== wpSeed.outputIndex)!;
    const op = await buildOpenProposalTx({
      lucid, config: cfg, seedUtxo: seed, weightParamUtxo: wpUtxo,
      voteOpenEpoch: e0, voteCloseEpoch: e0 + 2n, nowMs: emulator.now(),
    });
    await submit(lucid, emulator, op.tx);
    const pid = op.proposalId;
    const getTally = async () => (await lucid.utxosAtWithUnit(op.tallyAddress, toUnit(cfg.tallyPolicyId, pid)))[0]!;

    for (let i = 0; i < 2; i++) {
      lucid.selectWallet.fromPrivateKey(voters[i]!.ctrl.privateKey);
      const cv = await buildCastVoteTx({
        lucid, config: cfg, tallyUtxo: await getTally(), anchorUtxo: await anchorOf(dids[i]!),
        didCommit: dids[i]!, choice: "Yes", c3Capped: c3Claim[i]!, nowMs: emulator.now(),
      });
      await submit(lucid, emulator, cv.tx, [voters[i]!.dev.privateKey]);
    }
    const voteAddr = scriptAddress("Custom", cfg.voteScriptHash);
    const voteOf = async (did: string) => (await lucid.utxosAt(voteAddr)).find((u) => voteDatumFromCbor(u.datum!).did_commit === did)!;

    advanceToEpoch(emulator, e0 + 2n);
    lucid.selectWallet.fromPrivateKey(admin.privateKey);

    // Lô 1 — A. Ca âm builder: thiếu chứng thực ⇒ GOV-TALLY-010.
    await expect(buildSumBatchTx({
      lucid, config: cfg, tallyUtxo: await getTally(), voteUtxos: [await voteOf(dids[0]!)],
      weightParamUtxo: wpUtxo, votedLedger: [], nowMs: emulator.now(),
    })).rejects.toThrow("GOV-TALLY-010");
    const b1 = await buildSumBatchTx({
      lucid, config: cfg, tallyUtxo: await getTally(), voteUtxos: [await voteOf(dids[0]!)],
      weightParamUtxo: wpUtxo, votedLedger: [], c3AttestUtxos: [await realAttest(dids[0]!)], nowMs: emulator.now(),
    });
    await submit(lucid, emulator, b1.tx);
    expect(tallyDatumFromCbor((await getTally()).datum!).voters_acc).toBe(1n);

    // Lô 2 — B. Ca âm builder: chỉ có bản ở ví thường ⇒ GOV-TALLY-016.
    await expect(buildSumBatchTx({
      lucid, config: cfg, tallyUtxo: await getTally(), voteUtxos: [await voteOf(dids[1]!)],
      weightParamUtxo: wpUtxo, votedLedger: b1.plan.next, c3AttestUtxos: [forgedB], nowMs: emulator.now(),
    })).rejects.toThrow("GOV-TALLY-016");

    // Ca âm ON-CHAIN: dựng tay đúng lô B (cùng bằng chứng sổ, cùng datum ra đúng) nhưng reference
    // input chứng thực là bản ở ví `forger`. `attested_c3` không thấy ứng viên nào tại
    // Script(c3_script_hash) ⇒ -1 < 40 ⇒ tally.ak bác.
    {
      const tU = await getTally();
      const vU = await voteOf(dids[1]!);
      const vB = voteDatumFromCbor(vU.datum!);
      const plan = await b1.plan.next.planBatchInsert([{ didCommit: vB.did_commit, nullifier: vB.nullifier }]);
      const out = sumBatchNext(tallyDatumFromCbor(tU.datum!), wp, [vB], plan.rootAfter);
      const { boundedEpochWindow } = await import("../offchain/src/epochWindow.js");
      const { slotConfigOf } = await import("../offchain/src/chainRead.js");
      const w = boundedEpochWindow(emulator.now(), MS_PER_EPOCH, ORIGIN_MS, slotConfigOf(lucid));
      const mk = (attest: UTxO) => lucid.newTx()
        .collectFrom([tU], tallyRedeemerToCbor({ kind: "SumBatch", insert_proofs: plan.insertProofs }))
        .collectFrom([vU], voteRedeemerToCbor({ kind: "ConsumeForTally", book_proof: plan.membershipProofs[0]! }))
        .readFrom([wpUtxo, refs.tally!, refs.vote!, refs.nullifier!, attest])
        .mintAssets({ [toUnit(cfg.nullifierPolicyId, vB.nullifier)]: -1n },
          nullifierRedeemerToCbor({ kind: "BurnNullifier", proposal_id: pid, did_commits: [vB.did_commit] }))
        .pay.ToAddressWithData(tU.address, { kind: "inline", value: tallyDatumToCbor(out) }, { ...tU.assets })
        .validFrom(w.loMs).validTo(w.hiMs)
        .complete();
      const err = await mk(forgedB).then(() => null, (e: unknown) => e);
      expect(err).not.toBeNull();
      expect(JSON.stringify(err)).toContain("failed script execution");
      // Đối chứng một biến: cùng giao dịch, chứng thực tại Script(c3_script_hash) ⇒ dựng được.
      await expect(mk(await realAttest(dids[1]!))).resolves.toBeDefined();
    }

    // Builder: bản thật + bản giả cùng có mặt ⇒ vẫn đúng MỘT ứng viên tại script ⇒ qua và lên chuỗi.
    const b2 = await buildSumBatchTx({
      lucid, config: cfg, tallyUtxo: await getTally(), voteUtxos: [await voteOf(dids[1]!)],
      weightParamUtxo: wpUtxo, votedLedger: b1.plan.next, c3AttestUtxos: [await realAttest(dids[1]!), forgedB],
      nowMs: emulator.now(),
    });
    await submit(lucid, emulator, b2.tx);
    const td2 = tallyDatumFromCbor((await getTally()).datum!);
    expect(td2).toEqual(b2.tallyDatumOut);
    expect(td2.voters_acc).toBe(2n);
    expect((await getTally()).scriptRef ?? null).toBeNull();
    // `[VP-ZERO-FACTOR]`: C3 có nguồn nhưng c1 = c2 = c4 = 0 ⇒ tích nhân vẫn 0.
    expect(td2.yes_power_raw).toBe(0n);
  }, 120_000);
});
