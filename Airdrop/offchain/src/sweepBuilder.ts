// sweepBuilder — TIGER Airdrop Sweep. Sau deadline_epoch → toàn bộ LAMP dư trong
// pool hoàn về treasury_dest (Treasury custody) + (tùy chọn) gom slot CHƯA claim
// còn ở registry: tiêu slot → BURN NFT slot, min-ADA slot về Treasury. Permissionless.
//
// FLOW:
//   1. Spend POOL UTxO (AirdropRedeemer::Sweep). validFrom (lower_bound) ≥ deadline.
//   2. (tùy chọn) Spend các slot UTxO chưa claim ở registry (marker validator).
//   3. BURN mọi slot NFT đó (airdrop_nft policy, name=leaf, qty -1) redeemer BurnSlot.
//   4. Output treasury_dest ← toàn bộ LAMP còn lại + POOL NFT + ADA (gồm min-ADA slot).
//   POOL NFT + min-ADA: builder gửi kèm về treasury (onchain chỉ ép LAMP → treasury).

import {
  toUnit,
  type LucidEvolution, type UTxO, type Validator, type MintingPolicy,
  type TxSignBuilder, type Redeemer,
} from "@lucid-evolution/lucid";

import { sweepRedeemerToCbor, burnSlotRedeemerToCbor } from "./datum.js";
import type { AirdropPool } from "./types.js";

export interface SweepParams {
  lucid: LucidEvolution;

  /** POOL UTxO (datum AirdropPool, POOL NFT, kho LAMP dư). */
  poolUtxo: UTxO;
  /** Datum pool đã decode (cần treasury_dest + deadline_epoch). */
  pool: AirdropPool;
  airdropPoolScript: Validator;

  lamp_policy: string;
  lamp_name: string;

  /** Khoảng hợp lệ: lower_bound (POSIX ms) PHẢI ≥ deadline (onchain ép). Caller set. */
  validFromMs: number;

  /** Slot UTxO CHƯA claim còn ở registry (gom về Treasury, burn NFT). Mặc định []. */
  unclaimedSlotUtxos?: UTxO[];
  /** Marker (registry) validator — cần khi gom slot. */
  airdropMarkerScript?: Validator;
  /** Minting policy airdrop_nft — cần khi burn slot. */
  airdropNftPolicy?: MintingPolicy;
  /** policyId airdrop_nft — cần khi burn slot. */
  airdropNftPolicyId?: string;
  /** Redeemer spend slot (marker bỏ qua) — mặc định Void. */
  slotRedeemer?: Redeemer;
}

export interface SweepResult {
  tx: TxSignBuilder;
  swept: bigint;
  burnedSlots: number;
  summary: string;
}

/** Void redeemer (Plutus unit) — marker validator không đọc redeemer. */
const VOID_REDEEMER: Redeemer = "d87980";

export async function buildSweepTx(params: SweepParams): Promise<SweepResult> {
  const {
    lucid, poolUtxo, pool, airdropPoolScript, lamp_policy, lamp_name, validFromMs,
  } = params;

  const unclaimedSlots = params.unclaimedSlotUtxos ?? [];
  const slotRedeemer = params.slotRedeemer ?? VOID_REDEEMER;

  const lampUnit = toUnit(lamp_policy, lamp_name);
  const swept = poolUtxo.assets[lampUnit] ?? 0n;

  // Gom value pool (LAMP dư + POOL NFT + ADA) → treasury; cộng min-ADA của các slot.
  const treasuryAssets: Record<string, bigint> = { ...poolUtxo.assets };
  const burnMint: Record<string, bigint> = {};

  for (const slot of unclaimedSlots) {
    // cộng min-ADA slot vào Treasury.
    treasuryAssets.lovelace = (treasuryAssets.lovelace ?? 0n) + (slot.assets.lovelace ?? 0n);
    // các NFT slot (policy airdrop_nft) → burn (-1); KHÔNG đưa về Treasury.
    for (const [unit, qty] of Object.entries(slot.assets)) {
      if (unit === "lovelace") continue;
      if (params.airdropNftPolicyId && unit.startsWith(params.airdropNftPolicyId)) {
        burnMint[unit] = (burnMint[unit] ?? 0n) - qty;
      } else {
        // asset lạ (không nên có) → chuyển về Treasury an toàn.
        treasuryAssets[unit] = (treasuryAssets[unit] ?? 0n) + qty;
      }
    }
  }

  let txb = lucid
    .newTx()
    .validFrom(validFromMs)
    .collectFrom([poolUtxo], sweepRedeemerToCbor())
    .attach.SpendingValidator(airdropPoolScript);

  if (unclaimedSlots.length > 0) {
    if (!params.airdropMarkerScript || !params.airdropNftPolicy) {
      throw new Error("SWEEP-010: gom slot cần airdropMarkerScript + airdropNftPolicy");
    }
    txb = txb.collectFrom(unclaimedSlots, slotRedeemer).attach.SpendingValidator(params.airdropMarkerScript);
    txb = txb.mintAssets(burnMint, burnSlotRedeemerToCbor()).attach.MintingPolicy(params.airdropNftPolicy);
  }

  const tx = await txb.pay.ToAddress(pool.treasury_dest, treasuryAssets).complete();

  const summary = [
    `═══ TIGER Airdrop Sweep (dư → Treasury) ═══`,
    `Treasury:     ${pool.treasury_dest}`,
    `Swept LAMP:   ${swept / 1_000_000n} LAMP (${swept} oildrop)`,
    `Slot burned:  ${unclaimedSlots.length} (chưa claim)`,
    `Deadline:     epoch ${pool.deadline_epoch} (đã qua)`,
    `Đã claim:     ${pool.claimed_count} leaf`,
  ].join("\n");

  return { tx, swept, burnedSlots: unclaimedSlots.length, summary };
}
