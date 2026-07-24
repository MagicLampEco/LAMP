// Treasury seedBuilder — dựng tx GENESIS seed custody (custody_seed validator).
// Mirror onchain validators/custody_seed.ak (hardening v1).
//
// custody_seed = minting policy ONE-SHOT param bởi genesis_ref. Mint 1 NFT
// (seed_policy, instance_id) chỉ khi tx CONSUME đúng UTxO genesis → policy chạy đúng
// 1 lần → đúng 1 instance NFT. NFT là authenticity token của custody.
//
// Tx genesis (trong 1 tx):
//   - mint 1 NFT (seed_policy=mintingPolicyToId(custodySeed), name=instance_id), qty +1.
//     redeemer SeedGenesis{ reserved_min_ada } = Constr(0, [int]).
//   - CONSUME genesis_ref (one-shot).
//   - 1 output custody Ở SCRIPT (custody address) mang NFT + booked value + reserved ADA,
//     inline CustodyDatum hợp lệ (canonical sổ, consumed=[]).
//
// custody_seed ÉP (mirror): S-MINT-1, S-OUT-1, S-PARAM-0 (instance_id == NFT name),
//   S-ID-0, S-ACC-1, S-CUT-0 (0≤cut_bps≤10000), S-SEED-0 (value == sổ ⊕ reserved ⊕ NFT),
//   S-LEDGER-0 (sổ CANONICAL), S-ACC-0 (mọi dòng accepted), S-CONSUMED-0 (consumed==[]).
//
// Off-chain TỰ KIỂM seedDatumOk (gương đủ validator) TRƯỚC complete() — fail-fast.

import {
  Constr, Data, applyParamsToScript, credentialToAddress, mintingPolicyToId,
  scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type Network, type TxSignBuilder, type UTxO, type Validator,
} from "@lucid-evolution/lucid";

import type { CustodyDatum, OutputReference } from "./types.js";
import { custodyDatumToCbor, encodeOutputReference } from "./datum.js";
import {
  type AssetMap, assetKey, canonicalizeLedger, seedDatumOk, seedValue,
} from "./collect.js";
import { assetsToMap, mapToAssets } from "./collectBuilder.js";

// ── custody_seed redeemer ──────────────────────────────────────────────────
// CustodySeedRedeemer: SeedGenesis { reserved_min_ada: Int } = Constr(0, [int]).

export function encodeSeedRedeemer(reservedMinAda: bigint): Constr<Data> {
  if (reservedMinAda < 0n) throw new Error("SEED-RED: reserved_min_ada < 0");
  return new Constr(0, [reservedMinAda]);
}

export function seedRedeemerToCbor(reservedMinAda: bigint): string {
  return Data.to(encodeSeedRedeemer(reservedMinAda));
}

// ── apply param custody_seed (genesis_ref) → Validator + seed_policy ────────

/** Apply genesis_ref vào compiledCode custody_seed → Validator PlutusV3.
 *  compiledCode lấy từ onchain/plutus.json (title "custody_seed.custody_seed.mint"). */
export function applyCustodySeed(compiledCode: string, genesisRef: OutputReference): Validator {
  const ref = encodeOutputReference(genesisRef);
  return {
    type: "PlutusV3",
    script: applyParamsToScript(compiledCode, [ref] as never),
  };
}

/** seed_policy = PolicyId của custody_seed đã apply (= mintingPolicyToId). */
export function seedPolicyId(custodySeed: Validator): string {
  return mintingPolicyToId(custodySeed);
}

// ── plan thuần (không cần lucid) — dựng datum + value + tự kiểm seedDatumOk ──

export interface SeedPlan {
  datum:        CustodyDatum;   // CustodyDatum genesis (canonical sổ, consumed=[])
  custodyValue: AssetMap;       // value seed output = sổ ⊕ reserved ⊕ NFT
  seedPolicy:   string;         // PolicyId NFT authenticity (= seed_policy)
  nftName:      string;         // asset name NFT (= instance_id)
}

/**
 * Plan genesis seed. Dựng datum CANONICAL + value seed (gồm NFT) + tự kiểm seedDatumOk.
 * Ném lỗi nếu seed sai (mirror custody_seed validator) — fail-fast trước build tx.
 *
 * @param seedPolicy seed_policy = mintingPolicyToId(custody_seed đã apply).
 * @param reservedMinAda lovelace giữ cho min-UTxO (≥ 0, KHÔNG ghi sổ).
 */
export function planSeed(
  datumIn: CustodyDatum, seedPolicy: string, reservedMinAda: bigint,
): SeedPlan {
  if (reservedMinAda < 0n) throw new Error("SEED-002: reserved_min_ada < 0");

  // S-LEDGER-0: dựng sổ CANONICAL (prune dòng 0 + sort theo khóa; reject âm).
  const ledger = canonicalizeLedger(datumIn.ledger);

  // S-CONSUMED-0: genesis CHƯA chi proposal nào.
  const datum: CustodyDatum = {
    ...datumIn,
    ledger,
    consumed_proposals: [],
  };

  const nftName = datum.instance_id;   // S-PARAM-0: NFT name == instance_id.

  // value seed = ledgerValue ⊕ reserved_min_ada ⊕ 1 NFT (seed_policy, instance_id).
  const custodyValue = seedValue(ledger, reservedMinAda, seedPolicy, nftName);

  // TỰ KIỂM gương ĐỦ validator (S-ID-0/S-ACC-1/S-CUT-0/S-SEED-0/S-LEDGER-0/S-ACC-0/S-CONSUMED-0).
  if (!seedDatumOk(custodyValue, datum, reservedMinAda, seedPolicy)) {
    throw new Error(
      "SEED-001: seed datum không hợp lệ (seedDatumOk fail — kiểm id/accepted/cut_bps/value/canonical/consumed)",
    );
  }

  return { datum, custodyValue, seedPolicy, nftName };
}

// ── tx builder ──────────────────────────────────────────────────────────────

export interface SeedParams {
  lucid:   LucidEvolution;
  network: Network;

  /** custody_seed đã apply genesis_ref (minting policy one-shot). */
  custodySeed: Validator;
  /** custody validator đã apply (proposal_policy, seed_policy, ms_per_epoch). Lấy address. */
  custodyScript: Validator;

  /** UTxO genesis PHẢI tiêu (one-shot — khớp genesis_ref đã apply vào custodySeed). */
  genesisUtxo: UTxO;

  /** CustodyDatum genesis (instance_id, accepted_assets, ledger, cut_bps, governance_ref, epoch).
   *  ledger sẽ được canonical hoá; consumed_proposals ép []. instance_id = NFT name. */
  datum: CustodyDatum;

  /** lovelace giữ cho min-UTxO (≥ 0, KHÔNG ghi sổ). */
  reservedMinAda: bigint;
}

export interface SeedResult {
  tx:           TxSignBuilder;
  datum:        CustodyDatum;
  custodyValue: AssetMap;
  seedPolicy:   string;
  nftName:      string;
  summary:      string;
}

export async function buildSeedTx(params: SeedParams): Promise<SeedResult> {
  const { lucid, network, custodySeed, custodyScript, genesisUtxo, datum, reservedMinAda } = params;

  const seedPolicy = seedPolicyId(custodySeed);
  const { datum: outDatum, custodyValue, nftName } = planSeed(datum, seedPolicy, reservedMinAda);

  const nftUnit = seedPolicy + nftName;                 // unit = policy ‖ name (hex).
  const custodyAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(custodyScript)),
  );

  // value output custody (gồm NFT). Tự kiểm: NFT qty 1 nằm trong custodyValue.
  if ((custodyValue[assetKey(seedPolicy, nftName)] ?? 0n) !== 1n) {
    throw new Error("SEED-003: custodyValue thiếu NFT authenticity qty 1 (bug build)");
  }
  const custodyOutAssets = mapToAssets(custodyValue);

  const tx = await lucid
    .newTx()
    .collectFrom([genesisUtxo])                          // ONE-SHOT: tiêu genesis_ref.
    .mintAssets({ [nftUnit]: 1n }, seedRedeemerToCbor(reservedMinAda))
    .attach.MintingPolicy(custodySeed)
    .pay.ToAddressWithData(
      custodyAddress,
      { kind: "inline", value: custodyDatumToCbor(outDatum) },
      custodyOutAssets,
    )
    .complete();

  const ledgerLines = outDatum.ledger.map((e) => {
    const label = e.policy === "" ? "lovelace" : `${e.policy}.${e.name}`;
    return `  bucket ${e.bucket_id} → ${label} ${e.amount}`;
  });

  const summary = [
    `═══ Seed (genesis) ═══`,
    `Instance:    ${outDatum.instance_id}`,
    `Seed policy: ${seedPolicy}`,
    `NFT:         ${nftUnit} (qty 1)`,
    `Cut bps:     ${outDatum.cut_bps}`,
    `Reserved:    ${reservedMinAda} lovelace`,
    `Ledger (canonical):`,
    ...(ledgerLines.length ? ledgerLines : ["  (empty)"]),
    `Custody at:  ${custodyAddress}`,
  ].join("\n");

  return { tx, datum: outDatum, custodyValue, seedPolicy, nftName, summary };
}

/** Cầu nối: lucid Assets ↔ AssetMap (re-export tiện dùng trong deploy script). */
export { assetsToMap, mapToAssets };
