// canonical_compute.ts — Tính TOÀN BỘ wiring pipeline canonical Preprod (KHÔNG submit).
// Nối Genesis mint (lamp_mint 12-param) ↔ Distribution release (claim/beacon/treasury),
// chia sẻ lamp_policy. Kho A-DEST = treasury.ak (Distribution). Verify mắc xích khớp.
import { fromText, toUnit, applyParamsToScript, validatorToScriptHash, credentialToAddress, scriptHashToCredential, mintingPolicyToId, scriptFromNative } from "@lucid-evolution/lucid";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeLucid, walletPkh, rawValidator, applyPolicy, policyId, NETWORK } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Hằng canonical
const SUPPLY_NAME = "535550504c59";              // "SUPPLY"
const TLAMP_NAME  = "744c414d50";                // "tLAMP"
const TOKEN_TAG   = "4c414d50";                  // "LAMP" (đã chốt, dev-doc)
const DIST_CAP    = 26370000000000000n;          // 26,37 tỷ LAMP (oil)
const RESERVE_CAP = 9630000000000000n;           // 9,63 tỷ LAMP (oil)
const REG_NAME = fromText("REG");
const KHO_NAME = fromText("KHO");
const MET_NAME = fromText("MET");
const MS_PER_EPOCH_PREPROD = 432000000n;         // 432000 slot × 1000 ms

// Load Distribution blueprint (validators claim/beacon/treasury)
async function distValidator(title: string): Promise<string> {
  const p = resolve(__dirname, "../../Distribution/onchain/plutus.json");
  const bp = JSON.parse(await readFile(p, "utf8"));
  const v = (bp.validators as { title: string; compiledCode: string }[]).find((x) => x.title === title);
  if (!v) throw new Error(`Distribution validator '${title}' không có trong plutus.json`);
  return v.compiledCode;
}
const applyDist = (code: string, params: unknown[]) => ({ type: "PlutusV3" as const, script: applyParamsToScript(code, params as never) });
const hashOf = (s: { type: "PlutusV3"; script: string }) => validatorToScriptHash(s);
const addrOf = (h: string) => credentialToAddress(NETWORK, scriptHashToCredential(h));

async function main() {
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const myAddr = await lucid.wallet().address();

  // native-sig policy (deploy wallet) — đúc 4 marker NFT: thread/registry/kho/meter
  const native = scriptFromNative({ type: "sig", keyHash: pkh });
  const nPid = mintingPolicyToId(native);

  // ── Genesis: lamp_mint 12-param → lamp_policy canonical ──
  const lampMint = applyPolicy((await rawValidator("lamp_mint.lamp_mint.mint")).compiledCode, [
    nPid, SUPPLY_NAME, TLAMP_NAME,        // thread + token_name(tLAMP)
    DIST_CAP, RESERVE_CAP,                // cap 36 tỷ
    nPid, REG_NAME, TOKEN_TAG,            // registry + token_tag(4c414d50)
    nPid, KHO_NAME,                       // kho NFT
    nPid, MET_NAME,                       // meter
  ]);
  const lampPid = policyId(lampMint);
  const lampUnit = toUnit(lampPid, TLAMP_NAME);

  // ── Distribution: claim_account → treasury(kho) → beacon, chia sẻ lampPid ──
  const committee = [pkh];
  const threshold = 1n;
  const claimScript = applyDist(await distValidator("claim_account.claim_account.spend"), [
    committee, threshold, MS_PER_EPOCH_PREPROD, lampPid, TLAMP_NAME, nPid,
  ]);
  const claimHash = hashOf(claimScript);
  const treasuryScript = applyDist(await distValidator("treasury.treasury.spend"), [
    claimHash, lampPid, TLAMP_NAME,
  ]);
  const treasuryHash = hashOf(treasuryScript);
  const treasuryAddr = addrOf(treasuryHash);   // ← KHO A-DEST
  const beaconScript = applyDist(await distValidator("beacon.beacon.spend"), [
    committee, threshold, nPid,
  ]);
  const beaconHash = hashOf(beaconScript);

  console.log("=== WIRING canonical pipeline (Preprod) — KHÔNG submit ===\n");
  console.log(`deploy wallet:    ${myAddr}`);
  console.log(`deploy pkh:       ${pkh}`);
  console.log(`native marker pid:${nPid}`);
  console.log(`\n── Genesis mint ──`);
  console.log(`lamp_policy:      ${lampPid}  (token_name=tLAMP, token_tag=4c414d50)`);
  console.log(`lamp_unit:        ${lampUnit}`);
  console.log(`cap:              dist ${DIST_CAP} + reserve ${RESERVE_CAP} = 36 tỷ LAMP`);
  console.log(`\n── Distribution (chia sẻ lamp_policy) ──`);
  console.log(`claim_account:    ${claimHash}`);
  console.log(`treasury (KHO):   ${treasuryHash}`);
  console.log(`   → KHO addr:    ${treasuryAddr}`);
  console.log(`beacon:           ${beaconHash}`);
  console.log(`\n✓ Mắc xích: lamp_mint A-DEST đọc kho-NFT (${nPid}/KHO) đặt tại treasury addr trên.`);
  console.log(`  Mint DistributionVest → tLAMP vào KHO=treasury.ak → claim(owner=FOUNDATION) → redeem nhả về FOUNDATION.`);
  console.log(JSON.stringify({ nPid, lampPid, lampUnit, claimHash, treasuryHash, treasuryAddr, beaconHash }, null, 2));
}
main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
