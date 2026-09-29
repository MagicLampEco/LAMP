// config — apply tham số blueprint cho bộ validator Governance v2, ĐÚNG thứ tự phụ thuộc hash.
//
// Nguồn thứ tự: `SPEC.md` §v2.4 + đầu tệp `onchain/validators/governance.ak`:
//   tally_nft, weight_param_nft  (không phụ thuộc gì)
//     → nullifier(tally_policy, taad_policy, ms_per_epoch, tally_window_epochs)
//     → vote(tally_policy, nullifier_policy, taad_policy, ms_per_epoch, tally_window_epochs)
//     → tally(tally_policy, vote_script_hash, nullifier_policy, weight_param_policy, c3_policy,
//             c3_script_hash, tally_window_epochs, ms_per_epoch)
//     → governance(tally_policy, tally_script_hash, weight_param_policy, ms_per_epoch,
//                  delta_min_epochs, recovery_timelock_epochs, _phase_tag)
// Danh sách tham số trên được KIỂM với `parameters` của blueprint lúc apply (tên VÀ số lượng) —
// lệch ⇒ `GOV-APPLY-001`. Apply thiếu tham số KHÔNG báo lỗi ở Lucid: nó sinh hash khác, im lặng
// (bài học `Distribution/scripts/blueprint.ts ▸ assertParamCount`).
//
// Không policy id nào gõ cứng: mọi giá trị đến từ `GovernanceDeployParams` người gọi truyền vào
// (soft-pin theo mạng — `taad_policy`, `ms_per_epoch`, … là cấu hình của mạng đích).

import {
  applyParamsToScript, validatorToScriptHash,
  type Data, type MintingPolicy, type UTxO, type Validator,
} from "@lucid-evolution/lucid";

import { assertHex, encodeOutputRef } from "./datum.js";
import type { OutputRef } from "./types.js";

/** Phần `validators` của `onchain/plutus.json` (CIP-57) mà module này đọc. */
export interface Blueprint {
  validators: { title: string; compiledCode: string; parameters?: { title: string }[] }[];
}

export interface WeightParamNftParams {
  /** seed one-shot của `weight_param_nft`. */
  seedRef: OutputRef;
  /** hex — tên tài sản NFT = mã pha. */
  phaseTag: string;
  bftFloorMin: bigint;
  bftFloorMax: bigint;
  quorumVotersMin: bigint;
}

export interface GovernanceDeployParams {
  /** hex — `_phase_tag` của `tally_nft` và `governance`. */
  phaseTag: string;
  /** policy id TAAD (anchor DID) của mạng đích. */
  taadPolicyId: string;
  /** policy id NFT chứng thực C3; `""` = pha chưa bật C3 (tally ép `c3_capped == 0`). */
  c3PolicyId: string;
  /**
   * Hash script GIỮ NFT chứng thực C3 (apply-param `c3_script_hash` của `tally`). `tally.ak ▸
   * attested_c3` chỉ đọc chứng thực tại `Script(c3_script_hash)`. PHẢI đi cặp với `c3PolicyId`:
   * cả hai `""` (pha chưa bật C3) hoặc cả hai là hash 28 byte — lệch cặp ⇒ `GOV-APPLY-004`.
   */
  c3ScriptHash: string;
  msPerEpoch: bigint;
  tallyWindowEpochs: bigint;
  deltaMinEpochs: bigint;
  recoveryTimelockEpochs: bigint;
  /** Bảng tham số: tham số để apply `weight_param_nft`, HOẶC policy id đã có sẵn của pha. */
  weightParam: WeightParamNftParams | { policyId: string };
}

/** Mọi thứ builder cần: script đã apply + hash + tham số thời gian. */
export interface GovernanceConfig {
  msPerEpoch: bigint;
  tallyWindowEpochs: bigint;
  deltaMinEpochs: bigint;
  recoveryTimelockEpochs: bigint;
  taadPolicyId: string;
  c3PolicyId: string;
  /** `""` khi và chỉ khi `c3PolicyId == ""`. */
  c3ScriptHash: string;
  tallyNftPolicy: MintingPolicy;
  tallyPolicyId: string;
  weightParamPolicyId: string;
  /** Có khi `weightParam` được apply ở đây (để đúc bảng); vắng khi pha đã có bảng. Mang theo
   *  chính bộ tham số đã apply để builder `mintWeightParam` kiểm bảng theo ĐÚNG ngưỡng đã nướng. */
  weightParamNft?: { policy: MintingPolicy; params: WeightParamNftParams };
  nullifierPolicy: MintingPolicy;
  nullifierPolicyId: string;
  voteScript: Validator;
  voteScriptHash: string;
  tallyScript: Validator;
  tallyScriptHash: string;
  /** Validator hai mục đích: `mint` (OpenProposal) + `spend` (FinalizeProposal). */
  governanceScript: Validator;
  /** = policy id token proposal = hash script governance. */
  governancePolicyId: string;
  /**
   * UTxO mang reference script (CIP-33), theo loại. Có mặt ⇒ builder đọc script qua reference
   * input thay vì đính kèm. BẮT BUỘC cho SumBatch: tally (~8,7 KB) + vote (~7,3 KB) + nullifier
   * (~3,7 KB) đính kèm vượt trần 16 384 byte một giao dịch. Gắn bằng `withScriptRefs` (có kiểm hash).
   */
  scriptRefs?: Partial<Record<ScriptKind, UTxO>>;
}

export type ScriptKind = "governance" | "tally" | "vote" | "nullifier" | "tallyNft" | "weightParamNft";

function hashOfKind(cfg: GovernanceConfig, k: ScriptKind): string {
  switch (k) {
    case "governance": return cfg.governancePolicyId;
    case "tally": return cfg.tallyScriptHash;
    case "vote": return cfg.voteScriptHash;
    case "nullifier": return cfg.nullifierPolicyId;
    case "tallyNft": return cfg.tallyPolicyId;
    case "weightParamNft": {
      if (!cfg.weightParamNft) throw new Error("GOV-REF-003: config không có weightParamNft để gắn reference script");
      return cfg.weightParamPolicyId;
    }
  }
}

/** Gắn UTxO reference script vào config; hash script trong UTxO ≠ hash đã apply ⇒ `GOV-REF-001`. */
export function withScriptRefs(cfg: GovernanceConfig, refs: Partial<Record<ScriptKind, UTxO>>): GovernanceConfig {
  for (const [k, u] of Object.entries(refs) as [ScriptKind, UTxO][]) {
    if (!u.scriptRef) throw new Error(`GOV-REF-002: UTxO ${u.txHash}#${u.outputIndex} (${k}) không mang reference script`);
    const got = validatorToScriptHash(u.scriptRef);
    if (got !== hashOfKind(cfg, k)) {
      throw new Error(`GOV-REF-001: reference script ${k} có hash ${got} ≠ hash đã apply ${hashOfKind(cfg, k)}`);
    }
  }
  return { ...cfg, scriptRefs: { ...(cfg.scriptRefs ?? {}), ...refs } };
}

/** Nguồn script cho builder: reference input nếu đã gắn, ngược lại đính kèm. */
export function scriptSource(cfg: GovernanceConfig, k: ScriptKind): { ref: UTxO } | { attach: true } {
  const r = cfg.scriptRefs?.[k];
  return r ? { ref: r } : { attach: true };
}

const T = {
  tallyNft: "tally_nft.tally_nft.mint",
  weightParamNft: "weight_param_nft.weight_param_nft.mint",
  nullifier: "nullifier.nullifier.mint",
  vote: "vote.vote.spend",
  tally: "tally.tally.spend",
  governance: "governance.governance.mint",
} as const;

/** Tên tham số blueprint mong đợi — đối chiếu nguyên văn với `parameters[].title`. */
export const EXPECTED_PARAMS: Record<keyof typeof T, string[]> = {
  tallyNft: ["_phase_tag"],
  weightParamNft: ["seed_ref", "phase_tag", "bft_floor_min", "bft_floor_max", "quorum_voters_min"],
  nullifier: ["tally_policy", "taad_policy", "ms_per_epoch", "tally_window_epochs"],
  vote: ["tally_policy", "nullifier_policy", "taad_policy", "ms_per_epoch", "tally_window_epochs"],
  tally: [
    "tally_policy", "vote_script_hash", "nullifier_policy", "weight_param_policy", "c3_policy", "c3_script_hash",
    "tally_window_epochs", "ms_per_epoch",
  ],
  governance: ["tally_policy", "tally_script_hash", "weight_param_policy", "ms_per_epoch", "delta_min_epochs", "recovery_timelock_epochs", "_phase_tag"],
};

function applyChecked(bp: Blueprint, key: keyof typeof T, params: Data[]): Validator {
  if (bp === null || typeof bp !== "object" || !Array.isArray(bp.validators)) {
    throw new Error("GOV-APPLY-000: blueprint phải là plutus.json đã parse (có mảng validators)");
  }
  const v = bp.validators.find((x) => x.title === T[key]);
  if (!v) throw new Error(`GOV-APPLY-002: blueprint không có validator '${T[key]}' — chạy 'aiken build' trong onchain/`);
  const names = (v.parameters ?? []).map((p) => p.title);
  const want = EXPECTED_PARAMS[key];
  if (names.length !== want.length || names.some((n, i) => n !== want[i]) || params.length !== want.length) {
    throw new Error(
      `GOV-APPLY-001: ${T[key]} — blueprint khai [${names.join(", ")}], SDK mong [${want.join(", ")}], ` +
      `truyền ${params.length} giá trị. Apply lệch KHÔNG báo lỗi mà sinh hash khác — dừng.`,
    );
  }
  return { type: "PlutusV3", script: applyParamsToScript(v.compiledCode, params as never) };
}

const hash28 = (h: string, ctx: string) => assertHex(h, 28, ctx);

function assertPos(v: bigint, ctx: string): bigint {
  if (typeof v !== "bigint" || v <= 0n) throw new Error(`GOV-APPLY-003: ${ctx} phải là bigint > 0, nhận ${String(v)}`);
  return v;
}

/** Apply toàn bộ bộ validator theo thứ tự phụ thuộc hash. */
export function applyGovernanceBlueprint(bp: Blueprint, p: GovernanceDeployParams): GovernanceConfig {
  const phaseTag = assertHex(p.phaseTag, null, "phaseTag");
  const taad = hash28(p.taadPolicyId, "taadPolicyId");
  const c3 = p.c3PolicyId === "" ? "" : hash28(p.c3PolicyId, "c3PolicyId");
  if (typeof p.c3ScriptHash !== "string") {
    throw new Error("GOV-APPLY-004: c3ScriptHash phải là chuỗi (\"\" khi pha chưa bật C3, hash 28 byte khi bật)");
  }
  const c3Sh = p.c3ScriptHash === "" ? "" : hash28(p.c3ScriptHash, "c3ScriptHash");
  // Lệch cặp ⇒ ném. `c3_policy ≠ ""` với `c3_script_hash = ""` thì không địa chỉ nào khớp
  // `Script(#"")` ⇒ mọi phiếu khai c3 ≥ 0 bị bác ⇒ SumBatch của pha TỰ KHOÁ (chú thích
  // `tally.ak ▸ attested_c3`). Chiều ngược lại vô hại trên chuỗi nhưng cho ra một hash tally
  // khác với cấu hình "chưa bật C3" chuẩn — hai triển khai cùng ý định mà khác địa chỉ. Cả hai
  // là cấu hình khai lệch, nên SDK từ chối cả hai thay vì đoán ý người gọi.
  if ((c3 === "") !== (c3Sh === "")) {
    throw new Error(
      "GOV-APPLY-004: c3PolicyId và c3ScriptHash phải cùng rỗng (pha chưa bật C3) hoặc cùng là hash 28 byte; " +
      `nhận c3PolicyId='${c3}', c3ScriptHash='${c3Sh}'`,
    );
  }
  const msPerEpoch = assertPos(p.msPerEpoch, "msPerEpoch");
  const tallyWindow = assertPos(p.tallyWindowEpochs, "tallyWindowEpochs");
  // R-DELAY: Δ_min > 0 (SPEC §v2.8) — on-chain không tự kiểm apply-param, nên kiểm ở đây.
  const deltaMin = assertPos(p.deltaMinEpochs, "deltaMinEpochs");
  const recovery = assertPos(p.recoveryTimelockEpochs, "recoveryTimelockEpochs");

  const tallyNftPolicy = applyChecked(bp, "tallyNft", [phaseTag]);
  const tallyPolicyId = validatorToScriptHash(tallyNftPolicy);

  let weightParamPolicyId: string;
  let weightParamNft: { policy: MintingPolicy; params: WeightParamNftParams } | undefined;
  if ("policyId" in p.weightParam) {
    weightParamPolicyId = hash28(p.weightParam.policyId, "weightParam.policyId");
  } else {
    const w = p.weightParam;
    const policy = applyChecked(bp, "weightParamNft", [
      encodeOutputRef(w.seedRef),
      assertHex(w.phaseTag, null, "weightParam.phaseTag"),
      w.bftFloorMin, w.bftFloorMax, w.quorumVotersMin,
    ]);
    weightParamPolicyId = validatorToScriptHash(policy);
    weightParamNft = { policy, params: w };
  }

  const nullifierPolicy = applyChecked(bp, "nullifier", [tallyPolicyId, taad, msPerEpoch, tallyWindow]);
  const nullifierPolicyId = validatorToScriptHash(nullifierPolicy);
  const voteScript = applyChecked(bp, "vote", [tallyPolicyId, nullifierPolicyId, taad, msPerEpoch, tallyWindow]);
  const voteScriptHash = validatorToScriptHash(voteScript);
  const tallyScript = applyChecked(bp, "tally", [
    tallyPolicyId, voteScriptHash, nullifierPolicyId, weightParamPolicyId, c3, c3Sh, tallyWindow, msPerEpoch,
  ]);
  const tallyScriptHash = validatorToScriptHash(tallyScript);
  const governanceScript = applyChecked(bp, "governance", [
    tallyPolicyId, tallyScriptHash, weightParamPolicyId, msPerEpoch, deltaMin, recovery, phaseTag,
  ]);
  const governancePolicyId = validatorToScriptHash(governanceScript);

  return {
    msPerEpoch, tallyWindowEpochs: tallyWindow, deltaMinEpochs: deltaMin, recoveryTimelockEpochs: recovery,
    taadPolicyId: taad, c3PolicyId: c3, c3ScriptHash: c3Sh,
    tallyNftPolicy, tallyPolicyId,
    weightParamPolicyId, ...(weightParamNft ? { weightParamNft } : {}),
    nullifierPolicy, nullifierPolicyId,
    voteScript, voteScriptHash,
    tallyScript, tallyScriptHash,
    governanceScript, governancePolicyId,
  };
}
