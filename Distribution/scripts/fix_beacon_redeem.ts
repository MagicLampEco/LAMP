// fix_beacon_redeem.ts — sửa beacon cũ (drop_value nhỏ) → drop_value=DELTA rồi redeem FOUNDATION.
// Beacon.ak: spend cần committee-sig + epoch tăng + kind/NFT bất biến; drop_value tự do đổi.
// Sau đó redeem tham chiếu beacon MỚI → vested = min(E, DELTA·dpe·elapsed) đủ cap.
import {
  Data, Constr, applyParamsToScript, validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  scriptFromNative, mintingPolicyToId, toUnit as u, getAddressDetails, Lucid, Blockfrost, type Validator,
} from "@lucid-evolution/lucid";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORK, BLOCKFROST_URL, BLOCKFROST_KEY, makeLucid, walletPkh, explorerTx, awaitTx, tipPosixMs } from "./config.js";
import { beaconDatumToCbor, decodeClaimAccountDatum } from "../offchain/src/datum.js";
import { buildRedeemTx } from "../offchain/src/redeemBuilder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPPLY_NAME = "535550504c59", TLAMP_NAME = "744c414d50", TOKEN_TAG = "4c414d50";
const DIST_CAP = 26370000000000000n, RESERVE_CAP = 9630000000000000n;
const REG = "524547", KHO = "4b484f", MET = "4d4554", DROP = "44524f50";
const DELTA = 10_000n * 1_000_000n, MS_EPOCH = 432_000_000n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (h: string) => (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();

/** Một validator trong blueprint + SỐ tham số nó khai — dùng để chặn apply thiếu param. */
interface BpValidator { title: string; compiledCode: string; nParams: number }

async function gCode(mod: string, title: string): Promise<BpValidator> {
  const bp = JSON.parse(await readFile(resolve(__dirname, `../../${mod}/onchain/plutus.json`), "utf8"));
  const v = (bp.validators as { title: string; compiledCode: string; parameters?: unknown[] }[])
    .find((x) => x.title === title);
  if (!v) throw new Error(`${title} not found`);
  return { title, compiledCode: v.compiledCode, nParams: (v.parameters ?? []).length };
}

/** Apply param + ÉP đủ số tham số (xem ghi chú APPLY-001 ở `canonical_release.ts`). */
const applyV = (v: BpValidator, p: unknown[]): Validator => {
  if (p.length !== v.nParams) {
    throw new Error(
      `APPLY-001: ${v.title} khai ${v.nParams} tham số, script này truyền ${p.length}. ` +
      `Validator đã đổi — cập nhật danh sách tham số (và địa chỉ deploy) trước khi chạy tiếp.`,
    );
  }
  return { type: "PlutusV3", script: applyParamsToScript(v.compiledCode, p as never) };
};
const epochNow = async () => (await tipPosixMs()) / MS_EPOCH;

async function main() {
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const native = scriptFromNative({ type: "sig", keyHash: pkh });
  const nPid = mintingPolicyToId(native);
  const lampMint = applyV(await gCode("Genesis", "lamp_mint.lamp_mint.mint"),
    [nPid, SUPPLY_NAME, TLAMP_NAME, DIST_CAP, RESERVE_CAP, nPid, REG, TOKEN_TAG, nPid, KHO, nPid, MET]);
  const lampPid = validatorToScriptHash(lampMint);
  const lampUnit = u(lampPid, TLAMP_NAME);
  const committee = [pkh], threshold = 1n;
  const claimS = applyV(await gCode("Distribution", "claim_account.claim_account.spend"),
    [committee, threshold, MS_EPOCH, lampPid, TLAMP_NAME, nPid]);
  const claimAddr = credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(claimS)));
  const treS = applyV(await gCode("Distribution", "treasury.treasury.spend"), [validatorToScriptHash(claimS), lampPid, TLAMP_NAME]);
  const treAddr = credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(treS)));
  const beaconS = applyV(await gCode("Distribution", "beacon.beacon.spend"), [committee, threshold, nPid]);
  const beaconAddr = credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(beaconS)));
  const dropNft = u(nPid, DROP);

  const fSeed = (process.env.FOUNDATION_WALLET_SEED ?? "").trim().replace(/\s+/g, " ");
  const fLucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  fLucid.selectWallet.fromSeed(fSeed);
  const fAddr = await fLucid.wallet().address();
  const fPkh = getAddressDetails(fAddr).paymentCredential!.hash;

  // ── 1. Cập nhật beacon: spend cũ → recreate drop_value=DELTA, epoch tăng ──
  const beaconUtxo = (await lucid.utxosAt(beaconAddr)).find((x) => (x.assets[dropNft] ?? 0n) === 1n);
  if (!beaconUtxo) throw new Error("không thấy beacon");
  const oldD = Data.from(beaconUtxo.datum!) as Constr<Data>;
  const oldEpoch = oldD.fields[0] as bigint;
  const oldDrop = oldD.fields[2] as bigint;
  const now = await epochNow();
  const newEpoch = now > oldEpoch ? now : oldEpoch + 1n;
  console.log(`beacon cũ: epoch=${oldEpoch} drop_value=${oldDrop} → mới: epoch=${newEpoch} drop_value=${DELTA}`);
  if (oldDrop >= DELTA / 2n) {
    console.log("   beacon đã đủ lớn — bỏ qua cập nhật.");
  } else {
    const bTx = await lucid.newTx()
      .collectFrom([beaconUtxo], Data.void())
      .attach.SpendingValidator(beaconS)
      .pay.ToAddressWithData(beaconAddr, { kind: "inline", value: beaconDatumToCbor({ epoch: newEpoch, kind: "DropParam", drop_value: DELTA }) },
        { lovelace: 2_000_000n, [dropNft]: 1n })
      .addSigner(await lucid.wallet().address())
      .complete();
    const bh = await (await bTx.sign.withWallet().complete()).submit();
    console.log(`   beacon updated: ${explorerTx(bh)}`); await awaitTx(lucid, bh, "beacon-fix"); await sleep(40_000);
  }

  // ── 2. Redeem FOUNDATION tham chiếu beacon mới ──
  const accUtxo = (await fLucid.utxosAt(claimAddr)).find((x) => {
    if (!x.datum) return false; try { return norm(decodeClaimAccountDatum(Data.from(x.datum)).owner) === norm(fPkh); } catch { return false; }
  });
  if (!accUtxo) throw new Error("không thấy claim_account FOUNDATION");
  const treUtxo = (await fLucid.utxosAt(treAddr)).find((x) => (x.assets[lampUnit] ?? 0n) > 0n)!;
  // Preview ô nhiễm đa-beacon → chọn beacon có drop_value LỚN NHẤT (bản đã set DELTA).
  const beacons = (await fLucid.utxosAt(beaconAddr)).filter((x) => (x.assets[dropNft] ?? 0n) === 1n && x.datum);
  const beaconNew = beacons.sort((a, b) => {
    const da = (Data.from(a.datum!) as Constr<Data>).fields[2] as bigint;
    const db = (Data.from(b.datum!) as Constr<Data>).fields[2] as bigint;
    return Number(db - da);
  })[0];
  if (!beaconNew) throw new Error("không thấy beacon");
  console.log(`redeem tham chiếu beacon drop_value=${(Data.from(beaconNew.datum!) as Constr<Data>).fields[2]}`);
  const rEpoch = await epochNow();
  const redeem = await buildRedeemTx({
    lucid: fLucid, network: NETWORK, claimAccountUtxo: accUtxo, claimScript: claimS,
    treasuryUtxo: treUtxo, treasuryScript: treS, dropBeaconUtxo: beaconNew,
    currentEpoch: rEpoch, validFromMs: rEpoch * MS_EPOCH, lampPolicyId: lampPid, lampAssetName: TLAMP_NAME,
    destinationAddress: fAddr,
  });
  console.log(`redeem: vested=${redeem.vested} amount=${redeem.amount} oil (${redeem.amount / 1_000_000n} tLAMP)`);
  const rh = await (await redeem.tx.sign.withWallet().complete()).submit();
  console.log(`   ${explorerTx(rh)}`); await awaitTx(fLucid, rh, "redeem"); await sleep(15_000);
  const fLamp = (await fLucid.utxosAt(fAddr)).reduce((s, x) => s + (x.assets[lampUnit] ?? 0n), 0n);
  console.log(`\n✅ FOUNDATION giữ ${fLamp / 1_000_000n} tLAMP. HOÀN TẤT.`);
}
main().catch((e) => { console.error("❌", e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); });
