// Genesis pots — dựng 4 CustodyDatum (tái dùng Treasury custody schema) + tự kiểm
// bất biến seed sổ↔value TRƯỚC khi build genesis tx.
//
// Mỗi pot = 1 custody UTxO mang authenticity NFT (name = instance_id = POT_ID) +
// inline CustodyDatum với 1 dòng sổ tLAMP (pot rỗng ⇒ sổ tLAMP rỗng). Tách hash
// mỗi pot do param `pot_tag` ở validator genesis_pot (off-chain chỉ dựng datum/value).

import type { AssetKey, CustodyDatum, LedgerEntry } from "@magiclamp/treasury-sdk";
import { type AssetMap, assetKey, seedDatumOk, ledgerValue } from "@magiclamp/treasury-sdk";
import {
  POT_ID, type PotName, type PotShare, genesisPots, sumPots, TOTAL_SUPPLY_OIL,
} from "./split.js";

/** Asset tLAMP (Faucet): name "tLAMP" = #"744c414d50", 6 decimals. */
export const TLAMP_ASSET_NAME = "744c414d50";

/** Bucket id mặc định cho dòng sổ chính mỗi pot. */
export const GENESIS_BUCKET = 1n;

export interface TLampAsset {
  policy: string; // hex 28-byte policy id của tLAMP
  name:   string; // hex asset name (mặc định TLAMP_ASSET_NAME)
}

export interface PotDatumPlan {
  pot:        PotName;
  instanceId: string;       // = POT_ID[pot]
  datum:      CustodyDatum;
  /** value tLAMP-oil booked trong sổ (= share genesis). */
  value:      bigint;
  /** AssetMap kỳ vọng custody UTxO (tLAMP booked + reserved lovelace). */
  expectedValue: AssetMap;
}

/** accepted_assets chung 4 pot: ADA (min-UTxO) + tLAMP. */
function acceptedAssets(tlamp: TLampAsset): AssetKey[] {
  return [
    { policy: "", name: "" },               // ADA (lovelace)
    { policy: tlamp.policy, name: tlamp.name },
  ];
}

/** Sổ 1 pot: 1 dòng tLAMP nếu value > 0; pot rỗng ⇒ sổ rỗng. */
function potLedger(tlamp: TLampAsset, value: bigint): LedgerEntry[] {
  if (value === 0n) return [];
  return [{ bucket_id: GENESIS_BUCKET, policy: tlamp.policy, name: tlamp.name, amount: value }];
}

export interface BuildPotsParams {
  tlamp:          TLampAsset;
  governanceRef:  string;         // hex script hash Governance (DAO gate)
  cutBps:         bigint;         // bps cắt phí về bucket (DAO chỉnh) ∈ [0,10000]
  epoch:          bigint;         // epoch genesis
  reservedMinAda: bigint;         // lovelace giữ min-UTxO mỗi custody (không booked)
  total?:         bigint;         // tổng cung oil (mặc định 36e9 × 1e6)
}

/**
 * Dựng kế hoạch 4 pot datum + tự kiểm:
 *   - Σ value 4 pot == total (G-SUM).
 *   - mỗi pot seedDatumOk (G-SEED): value == ledgerValue ⊕ reserved ∧ no_dup ∧ accepted.
 * @throws nếu bất kỳ bất biến nào vi phạm (fail-fast trước khi build tx tốn phí).
 */
export function planGenesisPots(params: BuildPotsParams): PotDatumPlan[] {
  const { tlamp, governanceRef, cutBps, epoch, reservedMinAda } = params;
  const total = params.total ?? TOTAL_SUPPLY_OIL;
  if (cutBps < 0n || cutBps > 10_000n) throw new Error("POTS-001: cut_bps ∉ [0,10000]");
  if (reservedMinAda < 0n) throw new Error("POTS-002: reserved_min_ada < 0");

  const pots: PotShare[] = genesisPots(total);

  // G-SUM: Σ 4 pot == total.
  const sum = sumPots(pots);
  if (sum !== total) {
    throw new Error(`POTS-003: Σ pots = ${sum} ≠ total = ${total} (G-SUM vi phạm)`);
  }

  const accepted = acceptedAssets(tlamp);
  const lampK = assetKey(tlamp.policy, tlamp.name);
  const lovelaceK = assetKey("", "");

  return pots.map((p) => {
    const ledger = potLedger(tlamp, p.value);
    const datum: CustodyDatum = {
      instance_id:        POT_ID[p.pot],
      accepted_assets:    accepted,
      ledger,
      cut_bps:            cutBps,
      governance_ref:     governanceRef,
      epoch,
      consumed_proposals: [],
    };

    // expectedValue = ledgerValue ⊕ reserved (lovelace). Dùng so với custody UTxO khi build.
    const expectedValue: AssetMap = { ...ledgerValue(ledger) };
    if (reservedMinAda !== 0n) {
      expectedValue[lovelaceK] = (expectedValue[lovelaceK] ?? 0n) + reservedMinAda;
    }

    // G-SEED: tự kiểm gương đủ custody_seed validator.
    if (!seedDatumOk(expectedValue, datum, reservedMinAda)) {
      throw new Error(`POTS-004: pot ${p.pot} vi phạm seedDatumOk (sổ≠value/dup/unaccepted)`);
    }
    // tLAMP booked == share.
    if ((expectedValue[lampK] ?? 0n) !== p.value) {
      throw new Error(`POTS-005: pot ${p.pot} tLAMP booked ${expectedValue[lampK] ?? 0n} ≠ ${p.value}`);
    }

    return { pot: p.pot, instanceId: POT_ID[p.pot], datum, value: p.value, expectedValue };
  });
}
