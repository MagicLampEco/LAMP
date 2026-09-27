// Treasury depositBuilder — dựng tx DEPOSIT (CONTRACT §15.2; custody.ak nhánh Deposit).
//
// Deposit = nạp 100% vào kho: ADA thưởng staking của SRCL, LAMP dư khi Sweep, số dư quét từ
// kho cũ lúc chuyển pha governance. PERMISSIONLESS như Collect, cùng mọi ràng buộc của nó,
// khác ba chỗ: mỗi item vào sổ ĐỦ `amount` (DEPOSIT_BPS = 100%, không đọc `datum.cut_bps`) ·
// mọi `amount > 0` · mã lỗi DEPOSIT-*.
//
// Invariants (khớp custody.ak nhánh Deposit):
//   C-DEP-MINT  tx.mint == 0.
//   C-DEP-1     đúng 1 custody input + 1 custody output (đếm theo PAYMENT SCRIPT HASH).
//   C-NFT       cust_in/out mang đúng 1 NFT (seed_policy, instance_id).
//   C-DEP-2     datum params bảo toàn (instance_id, accepted, governance_ref, cut_bps, buckets,
//               consumed_proposals); epoch neo chain, không lùi.
//   C-DEP-5     mọi item: amount > 0 + asset ∈ accepted_assets.
//   C-DEP-CAT   mọi item: category ∈ buckets ∧ không phải bucket dành riêng.
//   C-DEP-11    Σ nạp per-asset > 0 (chặn items == []).
//   C-DEP-3     ledger_out == ledger_in + Σamount tại (category, asset), CANONICAL, ≤ trần dòng.
//   C-DEP-4     value_out == value_in ⊕ Σamount.
//
// Khác Collect ở phía builder: `seedPolicy` BẮT BUỘC (như Release) — C-NFT on-chain luôn kiểm,
// nên một builder cho phép bỏ qua nó chỉ dựng được tx mà validator chắc chắn từ chối.

import {
  Data, type LucidEvolution, type Network, type TxSignBuilder, type UTxO, type Validator,
} from "@lucid-evolution/lucid";

import type { CollectItem, CustodyDatum } from "./types.js";
import { custodyDatumToCbor, decodeCustodyDatum, depositRedeemerToCbor } from "./datum.js";
import {
  type AssetMap, DEPOSIT_BPS, applyCut, assetKey, cutValue, depositItemsValid, ledgerOk,
  planLedgerOut, valueOk,
} from "./collect.js";
import {
  assetsToMap, custodyOutputAddress, mapToAssets, sameEpochValidToMs,
} from "./collectBuilder.js";

export interface DepositParams {
  lucid:   LucidEvolution;
  network: Network;

  /** Custody UTxO (inline CustodyDatum bắt buộc). */
  custodyUtxo:   UTxO;
  custodyScript: Validator;

  /** Lô item nạp — mỗi `amount` vào kho TRỌN VẸN. */
  items: CollectItem[];

  /** validity_range lower bound (POSIX ms); out_datum.epoch = ⌊validFromMs / msPerEpoch⌋. */
  validFromMs: bigint;
  msPerEpoch:  bigint;

  /** seed_policy (PolicyId NFT chứng thực kho). BẮT BUỘC. */
  seedPolicy: string;
}

export interface DepositResult {
  tx:           TxSignBuilder;
  deposited:    AssetMap;       // tổng nạp vào kho (per-asset)
  newDatum:     CustodyDatum;
  custodyAfter: AssetMap;
  summary:      string;
}

/**
 * Plan thuần (không cần lucid). Ném lỗi khi vi phạm bất biến on-chain — fail-fast trước khi
 * trả phí.
 */
export function planDeposit(
  datum: CustodyDatum, valueIn: AssetMap, items: CollectItem[],
  newEpoch: bigint, seedPolicy: string,
): {
  newDatum: CustodyDatum; custodyAfter: AssetMap; deposited: AssetMap;
} {
  if (!/^[0-9a-f]{56}$/.test(seedPolicy)) {
    throw new Error(`DEPOSIT-SEED: seedPolicy phải là policy id 56 hex thường, nhận "${seedPolicy}"`);
  }
  // C-NFT
  if ((valueIn[assetKey(seedPolicy, datum.instance_id)] ?? 0n) !== 1n) {
    throw new Error(
      `DEPOSIT-NFT: cust_in thiếu NFT chứng thực (${seedPolicy}, ${datum.instance_id}) qty 1`,
    );
  }
  // C-DEP-5 + C-DEP-CAT
  if (!depositItemsValid(items, datum.accepted_assets, datum.buckets)) {
    throw new Error(
      "DEPOSIT-001: item không hợp lệ (amount ≤ 0, asset ∉ accepted_assets, hoặc category ∉ " +
      "buckets đã khai lúc seed / là bucket dành riêng)",
    );
  }
  // C-EPOCH
  if (newEpoch < datum.epoch) {
    throw new Error(`DEPOSIT-002: epoch lùi (${newEpoch} < ${datum.epoch})`);
  }

  const deposited = cutValue(items, DEPOSIT_BPS);
  // C-DEP-11: với mọi amount > 0, map rỗng ⇔ items == [].
  if (Object.keys(deposited).length === 0) {
    throw new Error("DEPOSIT-011: Σ nạp == 0 — Deposit no-op bị từ chối");
  }

  const custodyAfter = applyCut(valueIn, items, DEPOSIT_BPS);            // C-DEP-4
  const ledgerOut = planLedgerOut(datum.ledger, items, DEPOSIT_BPS);     // C-DEP-3

  const newDatum: CustodyDatum = {
    instance_id:        datum.instance_id,
    accepted_assets:    datum.accepted_assets,
    ledger:             ledgerOut,
    cut_bps:            datum.cut_bps,          // của Collect — Deposit không đọc, không đổi
    governance_ref:     datum.governance_ref,
    epoch:              newEpoch,
    consumed_proposals: datum.consumed_proposals,
    buckets:            datum.buckets,
  };

  if (!ledgerOk(datum.ledger, ledgerOut, items, DEPOSIT_BPS)) {
    throw new Error("DEPOSIT-003: ledger_out vi phạm ledger_ok (sổ không canonical / vượt trần dòng)");
  }
  if (!valueOk(valueIn, custodyAfter, items, DEPOSIT_BPS)) {
    throw new Error("DEPOSIT-004: value_out ≠ value_in ⊕ Σamount");
  }

  return { newDatum, custodyAfter, deposited };
}

export async function buildDepositTx(params: DepositParams): Promise<DepositResult> {
  const { lucid, custodyUtxo, custodyScript, items, validFromMs, msPerEpoch, seedPolicy } = params;

  if (!custodyUtxo.datum) throw new Error("DEPOSIT-000: custodyUtxo không có inline datum");
  const datum = decodeCustodyDatum(Data.from(custodyUtxo.datum));

  const valueIn = assetsToMap(custodyUtxo.assets);
  const newEpoch = validFromMs / msPerEpoch;
  const { newDatum, custodyAfter, deposited } =
    planDeposit(datum, valueIn, items, newEpoch, seedPolicy);

  // C-DEP-ADDR: địa chỉ kho MANG THEO từ input (kể cả stake credential).
  const custodyAddress = custodyOutputAddress(custodyUtxo.address, custodyScript);
  const validToMs = sameEpochValidToMs(validFromMs, msPerEpoch);

  // Người nạp cấp Σamount từ ví của mình (coin selection của lucid).
  const tx = await lucid
    .newTx()
    .collectFrom([custodyUtxo], depositRedeemerToCbor(items))
    .attach.SpendingValidator(custodyScript)
    .validFrom(Number(validFromMs))
    .validTo(Number(validToMs))
    .pay.ToAddressWithData(
      custodyAddress,
      { kind: "inline", value: custodyDatumToCbor(newDatum) },
      mapToAssets(custodyAfter),
    )
    .complete();

  const lines = Object.entries(deposited).map(([k, v]) => {
    const [p, n] = k.split("|");
    return `  ${p === "" ? "lovelace" : `${p}.${n}`}: +${v}`;
  });
  const summary = [
    `═══ Deposit ═══`,
    `Instance:   ${datum.instance_id}`,
    `Items:      ${items.length}`,
    `Deposited:`,
    ...lines,
    `Epoch:      ${datum.epoch} → ${newDatum.epoch}`,
  ].join("\n");

  return { tx, deposited, newDatum, custodyAfter, summary };
}
