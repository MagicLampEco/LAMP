// Treasury collectBuilder — dựng tx COLLECT (CONTRACT §3; custody.ak nhánh Collect).
//
// Input:
//   - Custody UTxO (inline CustodyDatum) — spend với Collect redeemer.
//   - Provider funds (do CALLER cấp qua ví/UTxO khác): residual amount−cut trả thẳng
//     provider ngoài custody; phần cut về custody.
// Output:
//   - Custody': value = value_in ⊕ cut_value(items); ledger += Σcut tại (category,asset);
//     datum params (instance_id, accepted_assets, governance_ref, cut_bps) bảo toàn;
//     epoch không lùi.
//
// Invariants (khớp custody.ak):
//   C-MINT-0  tx.mint == 0 (LAMP fixed-supply — không burn/mint).
//   C-COL-1   đúng 1 custody input + 1 custody output (đếm theo PAYMENT SCRIPT HASH).
//   C-COL-2   custody address ở SCRIPT (tách ví); datum params bảo toàn; epoch ≥ in.
//   C-COL-3   ledger_out == ledger_in + Σcut tại (category,asset) — đơn-bucket.
//   C-COL-4   value_out == value_in ⊕ cut_value(items) — Σout = Σin per-asset.
//   C-COL-5   mọi item: amount ≥ 0 + asset ∈ accepted_assets.
//   C-COL-11  Σcut per-asset > 0 (F3 — reject Collect no-op / griefing respend).
//
// LƯU Ý: builder KHÔNG định giá. amount trong item là số app đã định giá. Builder chỉ
// tính cut + dựng output bảo toàn value. Phần residual + cách provider cấp fund tuỳ caller.

import {
  Data, credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder, type Assets,
} from "@lucid-evolution/lucid";
import type { Network } from "@lucid-evolution/lucid";

import type { CollectItem, CustodyDatum } from "./types.js";
import { decodeCustodyDatum, custodyDatumToCbor, collectRedeemerToCbor } from "./datum.js";
import {
  type AssetMap, allItemsValid, applyCut, assetKey, cutValue, planLedgerOut, ledgerOk, valueOk,
} from "./collect.js";

// ── Cầu nối Value: lucid Assets (unit hex / "lovelace") ↔ AssetMap ("policy|name") ──

/** lucid Assets → AssetMap. Lovelace ("lovelace") → khóa "|" (policy="" name=""). */
export function assetsToMap(a: Assets): AssetMap {
  const out: AssetMap = {};
  for (const [unit, amt] of Object.entries(a)) {
    const k = unit === "lovelace" ? "|" : `${unit.slice(0, 56).toLowerCase()}|${unit.slice(56).toLowerCase()}`;
    out[k] = (out[k] ?? 0n) + amt;
  }
  return out;
}

// ── F4: validity_range HỮU HẠN + lower&upper CÙNG epoch (mirror util.get_epoch_bounded) ──
// On-chain ép upper hữu hạn ∧ ⌊upper/ms⌋ == ⌊lower/ms⌋ (range không trải biên epoch) →
// out.epoch == epoch submit thật. Off-chain PHẢI set CẢ validFrom & validTo trong cùng
// epoch, nếu chỉ set validFrom → upper = +∞ → get_epoch_bounded expect Some(hi) FAIL.

/**
 * validTo (POSIX ms) lớn nhất CÙNG epoch với validFromMs: ms cuối của epoch đó
 * = (⌊validFromMs/msPerEpoch⌋ + 1) × msPerEpoch − 1. Bảo đảm ⌊validTo/ms⌋ == ⌊validFrom/ms⌋
 * (mirror get_epoch_bounded) đồng thời cho cửa sổ hợp lệ tối đa trong epoch.
 */
export function sameEpochValidToMs(validFromMs: bigint, msPerEpoch: bigint): bigint {
  if (msPerEpoch <= 0n) throw new Error("EPOCH-000: msPerEpoch phải > 0");
  const epoch = validFromMs / msPerEpoch;
  return (epoch + 1n) * msPerEpoch - 1n;
}

/** AssetMap → lucid Assets. Khóa "|" → "lovelace". Bỏ amount == 0. */
export function mapToAssets(m: AssetMap): Assets {
  const out: Assets = {};
  for (const [k, amt] of Object.entries(m)) {
    if (amt === 0n) continue;
    const [policy, name] = k.split("|");
    const unit = policy === "" ? "lovelace" : `${policy}${name ?? ""}`;
    out[unit] = amt;
  }
  return out;
}

export interface CollectParams {
  lucid:   LucidEvolution;
  network: Network;

  /** Custody UTxO (inline CustodyDatum bắt buộc). */
  custodyUtxo:   UTxO;
  custodyScript: Validator;

  /** Lô item collect (đã định giá ở app). */
  items: CollectItem[];

  /** validity_range lower bound (POSIX ms). out_datum.epoch suy TRỰC TIẾP từ đây:
   *  epoch = ⌊validFromMs / msPerEpoch⌋ (C-EPOCH — neo chain). */
  validFromMs: bigint;
  /** POSIX ms ↔ epoch (mirror onchain ms_per_epoch). */
  msPerEpoch:  bigint;

  /** seed_policy (PolicyId NFT authenticity). ÉP cust_in mang NFT (seed_policy, instance_id). */
  seedPolicy?: string;
}

export interface CollectResult {
  tx:           TxSignBuilder;
  cutValue:     AssetMap;       // tổng cut về custody (per-asset)
  newDatum:     CustodyDatum;   // datum custody output
  custodyAfter: AssetMap;       // value custody output (per-asset)
  summary:      string;
}

/**
 * Plan thuần (không cần lucid) — tách ra để test trực tiếp + tự kiểm bất biến.
 * Ném lỗi nếu vi phạm bất biến onchain (fail-fast trước khi submit tốn phí).
 * @param seedPolicy (hardening v1) nếu set → ÉP cust_in mang NFT (seed_policy, instance_id)
 *   qty 1 (C-NFT). NFT KHÔNG bị đụng (Σout=Σin) nên tự bảo toàn vào custody output.
 */
export function planCollect(
  datum: CustodyDatum, valueIn: AssetMap, items: CollectItem[],
  newEpoch?: bigint, seedPolicy?: string,
): {
  newDatum: CustodyDatum; custodyAfter: AssetMap; cut: AssetMap;
} {
  // C-NFT: cust_in PHẢI mang đúng 1 NFT authenticity (seed_policy, instance_id).
  if (seedPolicy !== undefined) {
    const nftK = assetKey(seedPolicy, datum.instance_id);
    if ((valueIn[nftK] ?? 0n) !== 1n) {
      throw new Error(
        `COLLECT-NFT: cust_in thiếu NFT authenticity (${seedPolicy}, ${datum.instance_id}) qty 1`,
      );
    }
  }
  // C-COL-5
  if (!allItemsValid(items, datum.accepted_assets)) {
    throw new Error("COLLECT-001: item không hợp lệ (amount < 0 hoặc asset ∉ accepted_assets)");
  }
  // C-COL-2 epoch không lùi
  const epoch = newEpoch ?? datum.epoch;
  if (epoch < datum.epoch) {
    throw new Error(`COLLECT-002: epoch lùi (${epoch} < ${datum.epoch})`);
  }

  const cut = cutValue(items, datum.cut_bps);

  // C-COL-11 (F3): Collect PHẢI sinh cut > 0 (custody thực sự nhận value). Chống
  // griefing no-op: items rỗng / mọi cut=0 → respend miễn phí gây contention chặn
  // settlement thật. Mirror custody.ak `!assets.is_zero(cut_value(items,cut_bps))`.
  // cutValue đã prune dòng cut==0 → map rỗng ⇔ Σcut per-asset == 0.
  if (Object.keys(cut).length === 0) {
    throw new Error("COLLECT-011: Σcut == 0 — Collect no-op bị từ chối (F3)");
  }

  const custodyAfter = applyCut(valueIn, items, datum.cut_bps);   // C-COL-4
  const ledgerOut = planLedgerOut(datum.ledger, items, datum.cut_bps); // C-COL-3

  const newDatum: CustodyDatum = {
    instance_id:     datum.instance_id,
    accepted_assets: datum.accepted_assets,
    ledger:          ledgerOut,
    cut_bps:         datum.cut_bps,
    governance_ref:  datum.governance_ref,
    epoch,
    // Collect KHÔNG đụng marker single-use — bảo toàn nguyên (chỉ Release append).
    consumed_proposals: datum.consumed_proposals,
  };

  // Tự kiểm khớp validator (C-COL-3 / C-COL-4) trước khi dựng tx.
  if (!ledgerOk(datum.ledger, ledgerOut, items, datum.cut_bps)) {
    throw new Error("COLLECT-003: ledger_out vi phạm ledger_ok (đơn-bucket/incremental)");
  }
  if (!valueOk(valueIn, custodyAfter, items, datum.cut_bps)) {
    throw new Error("COLLECT-004: value_out vi phạm Σout=Σin per-asset (value không bảo toàn)");
  }

  return { newDatum, custodyAfter, cut };
}

export async function buildCollectTx(params: CollectParams): Promise<CollectResult> {
  const { lucid, network, custodyUtxo, custodyScript, items, validFromMs, msPerEpoch, seedPolicy } = params;

  if (!custodyUtxo.datum) throw new Error("COLLECT-000: custodyUtxo has no inline datum");
  const datum = decodeCustodyDatum(Data.from(custodyUtxo.datum));

  const valueIn = assetsToMap(custodyUtxo.assets);
  // C-EPOCH: epoch neo TRỰC TIẾP từ validity_range lower bound (⌊validFromMs/msPerEpoch⌋).
  const newEpoch = validFromMs / msPerEpoch;
  const { newDatum, custodyAfter, cut } = planCollect(datum, valueIn, items, newEpoch, seedPolicy);

  const custodyAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(custodyScript)),
  );

  const custodyOutAssets = mapToAssets(custodyAfter);
  const redeemer = collectRedeemerToCbor(items);

  // F4: validity_range HỮU HẠN + lower&upper CÙNG epoch (mirror get_epoch_bounded).
  // validFrom = validFromMs; validTo = ms cuối CÙNG epoch ⇒ ⌊validTo/ms⌋ == newEpoch.
  const validToMs = sameEpochValidToMs(validFromMs, msPerEpoch);

  // Custody output: value = value_in ⊕ cut (caller phải cấp đủ cut từ provider fund).
  // validFrom/validTo neo epoch GỌN 1 epoch → on-chain get_epoch_bounded(tx) == newEpoch.
  const tx = await lucid
    .newTx()
    .collectFrom([custodyUtxo], redeemer)
    .attach.SpendingValidator(custodyScript)
    .validFrom(Number(validFromMs))
    .validTo(Number(validToMs))
    .pay.ToAddressWithData(
      custodyAddress,
      { kind: "inline", value: custodyDatumToCbor(newDatum) },
      custodyOutAssets,
    )
    .complete();

  const cutLines = Object.entries(cut).map(([k, v]) => {
    const [p, n] = k.split("|");
    const label = p === "" ? "lovelace" : `${p}.${n}`;
    return `  ${label}: +${v}`;
  });

  const summary = [
    `═══ Collect ═══`,
    `Instance:   ${datum.instance_id}`,
    `Items:      ${items.length}`,
    `Cut bps:    ${datum.cut_bps}`,
    `Cut value:`,
    ...(cutLines.length ? cutLines : ["  (none)"]),
    `Epoch:      ${datum.epoch} → ${newDatum.epoch}`,
  ].join("\n");

  return { tx, cutValue: cut, newDatum, custodyAfter, summary };
}
