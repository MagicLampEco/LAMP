// Genesis builder — dựng tx genesis: mint A oil tLAMP + 4 NFT pot (one-shot) →
// 4 custody output (mỗi pot 1 UTxO mang đúng share + NFT + inline CustodyDatum).
//
// Bất biến builder (khớp genesis_mint.ak / custody_seed.ak):
//   G-MINT-1  mint == A oil tLAMP + 4 NFT pot (mỗi pot 1, name = instance_id), không hơn.
//   G-SUM     Σ output tLAMP-value (4 custody) == A — token KHÔNG rơi ngoài 4 pot.
//   G-SEED    mỗi custody output: value == ledgerValue ⊕ reserved (đã tự kiểm ở planGenesisPots).
//
// Builder KHÔNG submit. Tham số nhận script/address từ caller (deploy script áp params
// per-pot → 4 hash riêng). planGenesisPots đã tự kiểm Σ + seed trước khi tới đây.

import {
  Data, type Assets, type LucidEvolution, type Network, type TxSignBuilder,
  type Validator, type MintingPolicy,
} from "@lucid-evolution/lucid";
import {
  credentialToAddress, scriptHashToCredential, validatorToScriptHash, mintingPolicyToId,
} from "@lucid-evolution/lucid";
import { custodyDatumToCbor } from "@magiclamp/treasury-sdk";

import { POT_ID, type PotName, TOTAL_SUPPLY_OIL } from "./split.js";
import { type PotDatumPlan, planGenesisPots, type BuildPotsParams, TLAMP_ASSET_NAME } from "./pots.js";

/** Script + value mỗi pot custody output. */
export interface PotCustody {
  pot:      PotName;
  /** Validator custody của pot (param pot_tag khác → hash khác). */
  script:   Validator;
  /** reserved_min_ada (lovelace) cho UTxO custody này. */
  minAda:   bigint;
}

export interface GenesisBuildParams extends BuildPotsParams {
  lucid:        LucidEvolution;
  network:      Network;

  /** Minting policy genesis one-shot (mint tLAMP + 4 NFT pot). */
  genesisPolicy: MintingPolicy;
  /** Redeemer CBOR cho genesis mint (mặc định Data.void()). */
  mintRedeemer?: string;

  /** 4 custody script (đúng 4 pot D/R/T/Dep). */
  custodies:    PotCustody[];
}

export interface GenesisBuildResult {
  tx:          TxSignBuilder;
  plans:       PotDatumPlan[];
  policyId:    string;
  tlampUnit:   string;
  mintedOil:   bigint;
  potOutputs:  { pot: PotName; address: string; assets: Assets }[];
  summary:     string;
}

const POT_ORDER: PotName[] = ["Distribution", "Reserve", "Treasury", "Deposits"];

/** Đổi tLAMP-oil value → lucid Assets (tLAMP unit + reserved lovelace). */
function custodyAssets(tlampUnit: string, value: bigint, minAda: bigint): Assets {
  const a: Assets = { lovelace: minAda };
  if (value > 0n) a[tlampUnit] = value;
  return a;
}

/**
 * Dựng genesis tx. Self-check Σ output tLAMP == A trước khi trả (G-SUM, đòn #5).
 * @throws nếu thiếu/thừa pot, hoặc Σ output ≠ mint.
 */
export async function buildGenesisTx(params: GenesisBuildParams): Promise<GenesisBuildResult> {
  const { lucid, network, genesisPolicy, custodies } = params;
  const total = params.total ?? TOTAL_SUPPLY_OIL;

  // planGenesisPots tự kiểm Σ==total + seed mỗi pot.
  const plans = planGenesisPots({ ...params, total });
  const planByPot = new Map<PotName, PotDatumPlan>(plans.map((p) => [p.pot, p]));

  // đúng 4 custody, đúng 4 pot.
  if (custodies.length !== 4) throw new Error("GBUILD-001: cần đúng 4 custody");
  const custByPot = new Map<PotName, PotCustody>(custodies.map((c) => [c.pot, c]));
  for (const pot of POT_ORDER) {
    if (!custByPot.has(pot)) throw new Error(`GBUILD-002: thiếu custody pot ${pot}`);
    if (!planByPot.has(pot)) throw new Error(`GBUILD-003: thiếu plan pot ${pot}`);
  }

  const policyId = mintingPolicyToId(genesisPolicy);
  const tlampUnit = `${policyId}${params.tlamp.name}`;

  // ── Mint value: A oil tLAMP + 4 NFT pot (mỗi pot 1) ─────────────────────
  const mint: Assets = { [tlampUnit]: total };
  for (const pot of POT_ORDER) {
    mint[`${policyId}${POT_ID[pot]}`] = 1n;
  }

  // ── 4 custody output ────────────────────────────────────────────────────
  let txb = lucid.newTx()
    .mintAssets(mint, params.mintRedeemer ?? Data.void())
    .attach.MintingPolicy(genesisPolicy);

  const potOutputs: { pot: PotName; address: string; assets: Assets }[] = [];
  let outSumOil = 0n;

  for (const pot of POT_ORDER) {
    const plan = planByPot.get(pot)!;
    const cust = custByPot.get(pot)!;
    const address = credentialToAddress(
      network, scriptHashToCredential(validatorToScriptHash(cust.script)),
    );
    // value pot = tLAMP share + NFT pot + reserved lovelace.
    const assets = custodyAssets(tlampUnit, plan.value, cust.minAda);
    assets[`${policyId}${POT_ID[pot]}`] = 1n;

    txb = txb.pay.ToAddressWithData(
      address, { kind: "inline", value: custodyDatumToCbor(plan.datum) }, assets,
    );
    potOutputs.push({ pot, address, assets });
    outSumOil += plan.value;
  }

  // G-SUM self-check: Σ output tLAMP == mint (đòn #5 — token không rơi ngoài 4 pot).
  if (outSumOil !== total) {
    throw new Error(`GBUILD-004: Σ output tLAMP = ${outSumOil} ≠ mint = ${total} (token rơi ngoài pot)`);
  }

  const tx = await txb.complete();

  const summary = [
    `═══ Genesis 4-POT ═══`,
    `Mint:      ${total} oil tLAMP (${total / 1_000_000n} tLAMP) + 4 NFT pot`,
    `Policy:    ${policyId}`,
    ...plans.map((p) => `  ${p.pot.padEnd(13)} ${p.value} oil (${p.value / 1_000_000n} tLAMP)`),
    `Σ output:  ${outSumOil} oil == mint ✓`,
    `circulating @genesis: ${total - outSumOil} oil (= 0)`,
  ].join("\n");

  return { tx, plans, policyId, tlampUnit, mintedOil: total, potOutputs, summary };
}
