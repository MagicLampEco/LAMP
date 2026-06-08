// Faucet mintBuilder — deploy tLAMP pool (one-shot mint TOÀN BỘ supply 1 lần).
//
// FIRST-PRINCIPLES: tLAMP fixed-supply → mint 1 lần, vào thẳng Faucet pool UTxO,
// rồi policy tự khóa (genesis_ref đã spent → không mint lại được). KHÔNG mint mỗi
// claim. Faucet sau đó chỉ chuyển token pool → dev (xem claimBuilder).
//
// Input:
//   - genesisUtxo: 1 UTxO bất kỳ của ví deploy → CONSUME để one-shot. policy đã
//     parameterized bởi OutputReference của UTxO này (caller apply trước, ở scripts).
// Mint:
//   - (tLAMP, +TOTAL_SUPPLY_OIL) đúng tổng cung.
// Output:
//   - Faucet pool UTxO: nhận TOÀN BỘ tLAMP + datum FaucetDatum{claim_amount}.
//
// Invariant:
//   C-MINT-1  mint đúng total supply (validator onchain ép quantity == total).
//   C-MINT-2  genesisUtxo bị consume (one-shot — validator ép).
//   C-POOL-1  toàn bộ tLAMP vào pool (không giữ lại ví → pool = nguồn claim duy nhất).

import {
  Data, toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type MintingPolicy, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/protocol-utils";

import { TLAMP_ASSET_NAME, TOTAL_SUPPLY_OIL, CLAIM_AMOUNT_OIL } from "./constants.js";
import { faucetDatumToCbor, mintGenesisRedeemerToCbor } from "./datum.js";
import type { FaucetDatum } from "./types.js";

export interface MintPoolParams {
  lucid:   LucidEvolution;
  network: Network;

  /** Applied tLAMP minting policy (đã apply genesis_ref + total_supply). */
  tlampPolicy: MintingPolicy;
  /** policyId của tlampPolicy (caller tính = mintingPolicyToId). */
  tlampPolicyId: string;

  /** Applied Faucet spend validator (đã apply tlamp_policy + tlamp_name). */
  faucetScript: Validator;

  /** UTxO genesis BẮT BUỘC consume (one-shot). Phải khớp OutputReference đã apply. */
  genesisUtxo: UTxO;

  /** Tổng cung (oil). Mặc định TOTAL_SUPPLY_OIL = 3.6e16. */
  totalSupplyOil?: bigint;
  /** claim_amount đặt vào pool datum (oil). Mặc định 100 LAMP. */
  claimAmountOil?: bigint;
  /** ADA (lovelace) kèm pool UTxO (min-ADA). Mặc định 5 tADA. */
  poolLovelace?: bigint;
  /** Asset name tLAMP. Mặc định "tLAMP". */
  tlampAssetName?: string;
}

export interface MintPoolResult {
  tx:           TxSignBuilder;
  poolAddress:  string;
  tlampUnit:    string;
  totalSupply:  bigint;
  poolDatum:    FaucetDatum;
  summary:      string;
}

export async function buildMintPoolTx(params: MintPoolParams): Promise<MintPoolResult> {
  const {
    lucid, network, tlampPolicy, tlampPolicyId, faucetScript, genesisUtxo,
  } = params;
  const totalSupply  = params.totalSupplyOil ?? TOTAL_SUPPLY_OIL;
  const claimAmount  = params.claimAmountOil ?? CLAIM_AMOUNT_OIL;
  const poolLovelace = params.poolLovelace ?? 5_000_000n;
  const assetName    = params.tlampAssetName ?? TLAMP_ASSET_NAME;

  if (totalSupply <= 0n) throw new Error("MINT-001: totalSupply must be > 0");
  if (claimAmount <= 0n) throw new Error("MINT-002: claimAmount must be > 0");
  if (claimAmount > totalSupply) throw new Error("MINT-003: claimAmount > totalSupply");

  const tlampUnit = toUnit(tlampPolicyId, assetName);

  const poolAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(faucetScript)),
  );

  const poolDatum: FaucetDatum = { claim_amount: claimAmount };

  // Pool UTxO nhận TOÀN BỘ tLAMP + min-ADA.
  const poolAssets: Record<string, bigint> = {
    lovelace: poolLovelace,
    [tlampUnit]: totalSupply,
  };

  const tx = await lucid
    .newTx()
    .collectFrom([genesisUtxo])                          // C-MINT-2: consume genesis (one-shot)
    .mintAssets({ [tlampUnit]: totalSupply }, mintGenesisRedeemerToCbor())  // C-MINT-1
    .attach.MintingPolicy(tlampPolicy)
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: faucetDatumToCbor(poolDatum) },
      poolAssets,                                         // C-POOL-1: toàn bộ vào pool
    )
    .complete();

  const summary = [
    `═══ Deploy tLAMP pool (one-shot mint) ═══`,
    `Policy id:    ${tlampPolicyId}`,
    `tLAMP unit:   ${tlampUnit}`,
    `Total supply: ${totalSupply} oil = ${totalSupply / 1_000_000n} LAMP`,
    `Pool address: ${poolAddress}`,
    `claim_amount: ${claimAmount} oil = ${claimAmount / 1_000_000n} LAMP/claim`,
    `Genesis ref:  ${genesisUtxo.txHash}#${genesisUtxo.outputIndex} (consumed → locked)`,
  ].join("\n");

  void Data;  // keep import for tooling parity
  return { tx, poolAddress, tlampUnit, totalSupply, poolDatum, summary };
}
