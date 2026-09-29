// mintWeightParam — `weight_param_nft.mint ▸ MintWeightParam`: đúc NFT bảng tham số một lần mỗi pha.
//
// On-chain (`onchain/validators/weight_param_nft.ak`): tiêu `seed_ref` · đúng 1 tên (policy,
// phase_tag) ×1, không policy nào khác · đúng MỘT output giữ NFT, tại `Script(policy_id)`, không
// reference script · datum `WeightParam`: 1 ≤ θ_num ≤ θ_den, 2·θ_num ≥ θ_den, bft_floor ∈
// [bft_floor_min, bft_floor_max], quorum_voter ≥ quorum_voters_min, quorum_vp ≥ 1, D8 (gồm G0
// `knots_wellformed` — mọi bảng hợp khuôn, `pow(0) = 0`).
//
// UTxO ra là BEACON KHOÁ VĨNH VIỄN (script không có nhánh spend) — min-ADA đặt ở đây là mất hẳn.
// Builder mặc định mức thấp và KHÔNG tự thêm gì vào value.

import { toUnit, type LucidEvolution, type TxSignBuilder, type UTxO } from "@lucid-evolution/lucid";

import { networkOf, sameRef, scriptAddress, utxoRef } from "./chainRead.js";
import type { GovernanceConfig } from "./config.js";
import { weightParamNftRedeemerToCbor, weightParamToCbor } from "./datum.js";
import { useScripts } from "./scriptUse.js";
import { d8Problem, knotsProblem } from "./tallyMath.js";
import type { WeightParam } from "./types.js";

export interface MintWeightParamParams {
  lucid: LucidEvolution;
  config: GovernanceConfig;
  /** UTxO đúng `seed_ref` đã apply vào policy. */
  seedUtxo: UTxO;
  weightParam: WeightParam;
  lovelace?: bigint;
}

/** Mirror các vế `and { … }` của `weight_param_nft.ak`. */
export function assertWeightParamMintable(
  wp: WeightParam,
  b: { bftFloorMin: bigint; bftFloorMax: bigint; quorumVotersMin: bigint },
): void {
  const bad = (code: string, msg: string): never => { throw new Error(`GOV-WP-${code}: ${msg}`); };
  if (wp.theta_num < 1n) bad("001", `theta_num ${wp.theta_num} < 1`);
  if (wp.theta_num > wp.theta_den) bad("002", `theta_num ${wp.theta_num} > theta_den ${wp.theta_den}`);
  if (2n * wp.theta_num < wp.theta_den) bad("003", `θ = ${wp.theta_num}/${wp.theta_den} < 1/2`);
  if (wp.bft_floor < b.bftFloorMin || wp.bft_floor > b.bftFloorMax) {
    bad("004", `bft_floor ${wp.bft_floor} ngoài [${b.bftFloorMin}, ${b.bftFloorMax}]`);
  }
  if (wp.quorum_voter_threshold < b.quorumVotersMin) bad("005", `quorum_voter_threshold ${wp.quorum_voter_threshold} < ${b.quorumVotersMin}`);
  if (wp.quorum_vp_threshold < 1n) bad("006", `quorum_vp_threshold ${wp.quorum_vp_threshold} < 1`);
  // G0 tách mã riêng khỏi G1–G3: bảng SAI KHUÔN và bảng hợp khuôn nhưng lệch trọng số là hai lỗi
  // khác nhau về cách sửa (đổi hình dạng bảng vs đổi độ dốc), người dựng phải phân biệt được.
  for (const [name, k] of [["k1", wp.k1], ["k2", wp.k2], ["k3", wp.k3], ["k4", wp.k4]] as const) {
    const why = knotsProblem(k);
    if (why !== null) bad("008", `bảng ${name} sai khuôn (weight_guard.knots_wellformed): ${why}`);
  }
  const d8 = d8Problem(wp);
  if (d8 !== null) bad("007", `bảng knots vi phạm D8 (weight_guard.d8_ok): ${d8}`);
}

export async function buildMintWeightParamTx(p: MintWeightParamParams): Promise<{ tx: TxSignBuilder; unit: string; address: string }> {
  const cfg = p.config;
  const nft = cfg.weightParamNft;
  if (!nft) throw new Error("GOV-WP-010: config không mang weightParamNft (policy + tham số) — apply blueprint với weightParam dạng tham số");
  if (!sameRef(utxoRef(p.seedUtxo), nft.params.seedRef)) {
    throw new Error("GOV-WP-011: seedUtxo không phải seed_ref đã apply vào weight_param_nft");
  }
  assertWeightParamMintable(p.weightParam, nft.params);
  // Khoảng hiệu lực: `weight_param_nft` không đọc `validity_range` (không gọi get_epoch_bounded)
  // ⇒ builder cố ý KHÔNG đặt validFrom/validTo.
  const unit = toUnit(cfg.weightParamPolicyId, nft.params.phaseTag);
  const address = scriptAddress(networkOf(p.lucid), cfg.weightParamPolicyId);
  const { txb, refs } = useScripts(p.lucid.newTx(), cfg, [{ kind: "weightParamNft", role: "mint" }]);
  // Lucid từ chối `readFrom([])` (EMPTY_UTXO) ⇒ chỉ gọi khi có reference script.
  const base = refs.length > 0 ? txb.readFrom(refs) : txb;
  const tx = await base
    .collectFrom([p.seedUtxo])
    .mintAssets({ [unit]: 1n }, weightParamNftRedeemerToCbor({ kind: "MintWeightParam" }))
    .pay.ToAddressWithData(address, { kind: "inline", value: weightParamToCbor(p.weightParam) },
      { lovelace: p.lovelace ?? 5_000_000n, [unit]: 1n })
    .complete();
  return { tx, unit, address };
}
