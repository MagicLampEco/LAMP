// Treasury releaseBuilder — dựng tx RELEASE (CONTRACT §4,§9 T1/T5; custody.ak nhánh
// Release — Model A). Cổng release = ĐỌC kết quả Governance qua REFERENCE INPUT mang
// Proposal NFT one-shot (v1 giả lập beacon ProposalResult).
//
// Input:
//   - Custody UTxO (inline CustodyDatum) — spend với Release redeemer (proposal_ref + draws).
//   - Proposal UTxO (reference input, KHÔNG tiêu): mang Proposal NFT + ProposalResult datum.
// Output:
//   - Custody': value = value_in ⊖ Σdraw; ledger -= Σdraw tại (bucket,asset);
//     datum params (instance_id, accepted_assets, governance_ref, cut_bps) bảo toàn; epoch ≥ in.
//   - 1 output / recipient: Σ value(asset) == Σ draw(to,asset) (tổng-khớp C-REL-7).
//
// Invariants (khớp custody.ak nhánh Release — tự kiểm TRƯỚC build, fail-fast):
//   C-REL-10  tx.mint == 0 (LAMP fixed-supply — không burn/mint).
//   C-REL-2   proposal.status == Executed.
//   C-REL-3   spend_spec_hash(draws) == proposal.spend_spec_hash.
//   C-REL-8   current_epoch ≥ proposal.execute_after_epoch (caller set validity_range).
//   C-REL-5   value_out == value_in ⊖ Σdraw — Σout=Σin per-asset (KHÔNG drain/burn).
//   C-REL-6   ledger_out[(b,a)] == ledger_in[(b,a)] − Σdraw(b,a) ∧ draw ≤ số dư bucket.
//   C-REL-7   Σ output tới `to` == Σ draw(to,asset) ∧ to ≠ custody.

import {
  Data, credentialToAddress, keyHashToCredential, scriptHashToCredential,
  validatorToScriptHash,
  type Credential as LucidCredential, type LucidEvolution, type Network,
  type TxSignBuilder, type UTxO, type Validator,
} from "@lucid-evolution/lucid";

import type {
  Address, CustodyDatum, ProposalResult, ReleaseDraw,
} from "./types.js";
import {
  decodeCustodyDatum, custodyDatumToCbor, custodyRedeemerToCbor,
} from "./datum.js";
import type { OutputReference } from "./types.js";
import { assetsToMap, mapToAssets } from "./collectBuilder.js";
import type { AssetMap } from "./collect.js";
import {
  type RecipientOutput, applyDraws, ledgerOk, planLedgerOut, planRecipientOutputs,
  recipientsOk, spendSpecHash, toIsCustody, valueOk,
} from "./release.js";

// ── Cầu Address offchain → lucid bech32 ──────────────────────────────────

/** offchain Credential → lucid Credential. */
function toLucidCredential(c: Address["payment_credential"]): LucidCredential {
  return c.kind === "Script"
    ? scriptHashToCredential(c.hash.toLowerCase())
    : keyHashToCredential(c.hash.toLowerCase());
}

/** offchain Address → bech32 (payment + optional stake credential). */
export function addressToBech32(network: Network, a: Address): string {
  const payment = toLucidCredential(a.payment_credential);
  const stake = a.stake_credential === null
    ? undefined
    : toLucidCredential(a.stake_credential.credential);
  return credentialToAddress(network, payment, stake);
}

// ── plan thuần (không cần lucid) — tách để test + tự kiểm bất biến ────────

export interface ReleasePlan {
  newDatum:     CustodyDatum;        // datum custody output (ledger -= Σdraw)
  custodyAfter: AssetMap;            // value custody output (per-asset)
  recipients:   RecipientOutput[];   // 1 output/recipient (Σ == Σdraw)
  specHash:     string;             // spend_spec_hash(draws) — khớp proposal
}

/**
 * Plan release thuần. Ném lỗi nếu vi phạm bất biến onchain (fail-fast trước submit).
 * @param custodyHash payment script hash của custody (chống to == custody, đếm double-sat).
 * @param currentEpoch epoch tx sẽ submit (so execute_after_epoch — caller set validity_range).
 */
export function planRelease(
  datum: CustodyDatum,
  valueIn: AssetMap,
  proposal: ProposalResult,
  draws: ReleaseDraw[],
  custodyHash: string,
  currentEpoch: bigint,
  newEpoch?: bigint,
): ReleasePlan {
  // C-REL-2: chỉ chi khi Executed.
  if (proposal.status !== "Executed") {
    throw new Error(`RELEASE-002: proposal chưa Executed (status=${proposal.status})`);
  }

  // C-REL-3: hash canonical draws thực tế == spend_spec_hash đã duyệt.
  const specHash = spendSpecHash(draws);
  if (specHash.toLowerCase() !== proposal.spend_spec_hash.toLowerCase()) {
    throw new Error(
      `RELEASE-003: spend_spec_hash lệch — draws(${specHash}) ≠ proposal(${proposal.spend_spec_hash})`,
    );
  }

  // C-REL-8: time-lock — epoch hiện tại ≥ execute_after_epoch.
  if (currentEpoch < proposal.execute_after_epoch) {
    throw new Error(
      `RELEASE-008: time-lock chưa mở (epoch ${currentEpoch} < execute_after ${proposal.execute_after_epoch})`,
    );
  }

  // C-REL-9: SINGLE-USE proposal — proposal_id CHƯA chi (chống replay / chi vượt duyệt).
  const proposalId = proposal.proposal_id.toLowerCase();
  if (datum.consumed_proposals.some((p) => p.toLowerCase() === proposalId)) {
    throw new Error(
      `RELEASE-009b: proposal ${proposalId} đã chi (consumed_proposals) — replay bị chặn`,
    );
  }

  // C-REL-7 (to ≠ custody) — phải kiểm TRƯỚC khi dựng output (chống rút vòng về kho).
  for (const d of draws) {
    if (toIsCustody(d.to, custodyHash)) {
      throw new Error("RELEASE-007a: draw.to == custody (rút vòng về kho — cấm)");
    }
  }

  const epoch = newEpoch ?? datum.epoch;
  if (epoch < datum.epoch) {
    throw new Error(`RELEASE-009: epoch lùi (${epoch} < ${datum.epoch})`);
  }

  // C-REL-5: value custody output = value_in ⊖ Σdraw.
  const custodyAfter = applyDraws(valueIn, draws);
  // C-REL-6: ledger output = ledger_in − Σdraw(bucket,asset).
  const ledgerOut = planLedgerOut(datum.ledger, draws);
  // C-REL-7: 1 output/recipient gộp Σ draw theo (to,asset).
  const recipients = planRecipientOutputs(draws);

  const newDatum: CustodyDatum = {
    instance_id:     datum.instance_id,
    accepted_assets: datum.accepted_assets,
    ledger:          ledgerOut,
    cut_bps:         datum.cut_bps,
    governance_ref:  datum.governance_ref,
    epoch,
    // C-REL-9: append proposal_id lên đầu (khớp consumed_appended_ok onchain).
    consumed_proposals: [proposal.proposal_id, ...datum.consumed_proposals],
  };

  // ── Tự kiểm khớp validator TRƯỚC khi dựng tx ──
  if (!ledgerOk(datum.ledger, ledgerOut, draws)) {
    throw new Error("RELEASE-006: ledger_out vi phạm ledger_ok (over-draw / xóa dòng / dup)");
  }
  if (!valueOk(valueIn, custodyAfter, draws)) {
    throw new Error("RELEASE-005: value_out vi phạm Σout=Σin per-asset (value không bảo toàn)");
  }
  if (!recipientsOk(recipients, draws, custodyHash)) {
    throw new Error("RELEASE-007: recipients vi phạm tổng-khớp Σout == Σdraw per (to,asset)");
  }

  return { newDatum, custodyAfter, recipients, specHash };
}

// ── tx builder ────────────────────────────────────────────────────────────

export interface ReleaseParams {
  lucid:   LucidEvolution;
  network: Network;

  /** Custody UTxO (inline CustodyDatum bắt buộc). */
  custodyUtxo:   UTxO;
  custodyScript: Validator;

  /** Proposal UTxO (reference input — beacon ProposalResult). KHÔNG tiêu. */
  proposalUtxo: UTxO;
  /** ProposalResult đã decode (từ proposalUtxo.datum). */
  proposal:     ProposalResult;
  /** OutputReference của proposalUtxo (vào redeemer Release). */
  proposalRef:  OutputReference;

  /** Danh sách rút thực tế (khớp spend_spec_hash của proposal). */
  draws: ReleaseDraw[];

  /** Epoch hiện tại để builder kiểm time-lock + set validity_range lower bound. */
  currentEpoch: bigint;
  /** POSIX ms ↔ epoch (mirror onchain ms_per_epoch). */
  msPerEpoch:   bigint;

  /** Epoch mới cho custody output (≥ datum.epoch). Mặc định giữ epoch cũ. */
  newEpoch?: bigint;
}

export interface ReleaseResult {
  tx:           TxSignBuilder;
  newDatum:     CustodyDatum;
  custodyAfter: AssetMap;
  recipients:   RecipientOutput[];
  specHash:     string;
  summary:      string;
}

export async function buildReleaseTx(params: ReleaseParams): Promise<ReleaseResult> {
  const {
    lucid, network, custodyUtxo, custodyScript, proposalUtxo, proposal, proposalRef,
    draws, currentEpoch, msPerEpoch,
  } = params;

  if (!custodyUtxo.datum) throw new Error("RELEASE-000: custodyUtxo has no inline datum");
  const datum = decodeCustodyDatum(Data.from(custodyUtxo.datum));

  const custodyHash = validatorToScriptHash(custodyScript);
  const valueIn = assetsToMap(custodyUtxo.assets);

  const { newDatum, custodyAfter, recipients, specHash } = planRelease(
    datum, valueIn, proposal, draws, custodyHash, currentEpoch, params.newEpoch,
  );

  const custodyAddress = credentialToAddress(
    network, scriptHashToCredential(custodyHash),
  );

  const redeemer = custodyRedeemerToCbor({ kind: "Release", proposal_ref: proposalRef, draws });

  // C-REL-8: validity_range lower bound = currentEpoch × ms_per_epoch (epoch chứng từ ledger).
  const validFrom = Number(currentEpoch * msPerEpoch);

  let txb = lucid
    .newTx()
    .collectFrom([custodyUtxo], redeemer)
    .attach.SpendingValidator(custodyScript)
    .readFrom([proposalUtxo])                       // C-REL-1: proposal qua reference input
    .validFrom(validFrom)
    // Custody output: value ⊖ Σdraw, datum ledger giảm.
    .pay.ToAddressWithData(
      custodyAddress,
      { kind: "inline", value: custodyDatumToCbor(newDatum) },
      mapToAssets(custodyAfter),
    );

  // 1 output / recipient (Σ value == Σ draw per (to,asset)).
  for (const r of recipients) {
    txb = txb.pay.ToAddress(addressToBech32(network, r.to), mapToAssets(r.value));
  }

  const tx = await txb.complete();

  const drawLines = draws.map((d) => {
    const label = d.policy === "" ? "lovelace" : `${d.policy}.${d.name}`;
    return `  bucket ${d.bucket_id} → ${label} ${d.amount}`;
  });

  const summary = [
    `═══ Release ═══`,
    `Instance:    ${datum.instance_id}`,
    `Proposal:    ${proposal.proposal_id} (${proposal.status})`,
    `Spec hash:   ${specHash}`,
    `Draws:       ${draws.length}`,
    ...drawLines,
    `Recipients:  ${recipients.length}`,
    `Epoch:       ${datum.epoch} → ${newDatum.epoch} (current ${currentEpoch})`,
  ].join("\n");

  return { tx, newDatum, custodyAfter, recipients, specHash, summary };
}
