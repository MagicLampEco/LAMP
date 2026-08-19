// canonical_release.ts — Phase 2: kho(treasury.ak) → claim → redeem → FOUNDATION.
// ms_per_epoch = 432_000_000 (KHỚP canonical_mint — cùng đơn vị đồng hồ vesting).
// beacon+claim = ví deploy (committee, non-Plutus); redeem = ví FOUNDATION (owner, Plutus).
import {
  Data, applyParamsToScript, validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  scriptFromNative, mintingPolicyToId, toUnit as u, getAddressDetails, Lucid, Blockfrost,
  type Validator,
} from "@lucid-evolution/lucid";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NETWORK, BLOCKFROST_URL, BLOCKFROST_KEY, makeLucid, walletPkh, explorerTx, awaitTx, tipPosixMs,
} from "./config.js";
import { TREASURY_NFT_ASSET_NAME, MS_PER_EPOCH } from "./config.js";
import { beaconDatumToCbor, decodeClaimAccountDatum } from "../offchain/src/datum.js";
import { buildClaimTx } from "../offchain/src/claimBuilder.js";
import { buildRedeemTx } from "../offchain/src/redeemBuilder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPPLY_NAME = "535550504c59", TLAMP_NAME = "744c414d50", TOKEN_TAG = "4c414d50";
const DIST_CAP = 26370000000000000n, RESERVE_CAP = 9630000000000000n;
const REG = "524547", KHO = "4b484f", MET = "4d4554", DROP = "44524f50";
const DELTA = 10_000n * 1_000_000n;
// ms_per_epoch là THAM SỐ #3 của claim_account (claim_account.ak:26) ⇒ nó nằm TRONG script hash.
// Nướng cứng 432_000_000n (mainnet) rồi chạy trên Preview/Preprod ⇒ apply ra claim_account KHÁC HASH
// với bộ 01_deploy đã ghi vào deployed.json, mà cổng APPLY-001 KHÔNG bắt được (đủ 8 tham số, chỉ
// SAI GIÁ TRỊ). Lấy DẪN XUẤT theo mạng thay vì chép tay — bỏ một cửa, không phải thêm một phép kiểm.
const MS_EPOCH = MS_PER_EPOCH;
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

/**
 * Apply param + ÉP đủ số tham số blueprint khai.
 * `applyParamsToScript` KHÔNG báo lỗi khi thiếu param — nó apply một phần và trả về một
 * script hash KHÁC, im lặng. Script này trỏ vào deployment đã có, nên sai hash = gửi tiền
 * vào địa chỉ trống. Thêm param vào validator (vd `treasury_nft_policy`) phải làm hỏng ở
 * ĐÂY, ngay lúc chạy, chứ không phải hỏng trên chuỗi.
 */
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
  // treasury_nft (TRSY) là ONE-SHOT theo genesis_ref — KHÔNG có fallback native-sig, nên
  // script này không tự dựng được; phải lấy policy id của deployment đang chạy.
  const TRSY_POLICY = (process.env.TREASURY_NFT_POLICY ?? "").trim();
  if (!TRSY_POLICY) {
    throw new Error(
      "thiếu TREASURY_NFT_POLICY. Kho nay giữ sổ cái solvency, xác thực bằng NFT TRSY " +
      "one-shot (không có bản native-sig để tự dựng). Lấy `params.treasuryNftPolicy` từ " +
      "deployed.json của deployment đang chạy rồi đặt vào .env.",
    );
  }
  const trsyUnit = u(TRSY_POLICY, TREASURY_NFT_ASSET_NAME);
  // account_nft_policy: tham số THỨ 8 của claim_account và THỨ 6 của treasury → dựng TRƯỚC.
  const accNftS = applyV(await gCode("Distribution", "claim_account_nft.claim_account_nft.mint"),
    [committee, threshold, TRSY_POLICY]);
  const accNftPid = mintingPolicyToId(accNftS);
  const claimS = applyV(await gCode("Distribution", "claim_account.claim_account.spend"),
    [committee, threshold, MS_EPOCH, lampPid, TLAMP_NAME, nPid, TRSY_POLICY, accNftPid]);
  const claimHash = validatorToScriptHash(claimS);
  const claimAddr = credentialToAddress(NETWORK, scriptHashToCredential(claimHash));
  const treS = applyV(await gCode("Distribution", "treasury.treasury.spend"),
    [claimHash, lampPid, TLAMP_NAME, committee, threshold, accNftPid]);
  const treAddr = credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(treS)));
  const beaconS = applyV(await gCode("Distribution", "beacon.beacon.spend"), [committee, threshold, nPid]);
  const beaconAddr = credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(beaconS)));
  const dropNft = u(nPid, DROP);

  const fSeed = (process.env.FOUNDATION_WALLET_SEED ?? "").trim().replace(/\s+/g, " ");
  const fLucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  fLucid.selectWallet.fromSeed(fSeed);
  const fAddr = await fLucid.wallet().address();
  const fPkh = getAddressDetails(fAddr).paymentCredential!.hash;

  const treLamp = (await lucid.utxosAt(treAddr)).reduce((s, x) => s + (x.assets[lampUnit] ?? 0n), 0n);
  console.log(`treAddr=${treAddr}\n  tLAMP trong kho: ${treLamp / 1_000_000n}\nFOUNDATION=${fAddr}\n`);
  if (treLamp < DELTA) throw new Error(`kho không đủ tLAMP (${treLamp}) — sai treAddr?`);

  // fund FOUNDATION (redeem cần fee+collateral)
  const fBal = (await fLucid.wallet().getUtxos()).reduce((s, x) => s + (x.assets.lovelace ?? 0n), 0n);
  if (fBal < 20_000_000n) {
    console.log(`── fund FOUNDATION (bal ${fBal / 1_000_000n} tADA) ──`);
    const t = await lucid.newTx()
      .pay.ToAddress(fAddr, { lovelace: 12_000_000n }).pay.ToAddress(fAddr, { lovelace: 8_000_000n }).complete();
    const h = await (await t.sign.withWallet().complete()).submit(); await awaitTx(lucid, h, "fund F"); await sleep(50_000);
  }

  // ── 1. Beacon DropParam (ví deploy, native mint) — idempotent ──
  console.log("── 1. beacon DropParam ──");
  const existBeacon = (await lucid.utxosAt(beaconAddr)).find((x) => (x.assets[dropNft] ?? 0n) === 1n);
  if (existBeacon) {
    console.log(`   beacon đã có (skip mint): ${existBeacon.txHash}#${existBeacon.outputIndex}`);
  } else {
    const bTx = await lucid.newTx()
      .mintAssets({ [dropNft]: 1n }, Data.void()).attach.MintingPolicy(native)
      .pay.ToAddressWithData(beaconAddr, { kind: "inline", value: beaconDatumToCbor({ epoch: await epochNow(), kind: "DropParam", drop_value: DELTA }) },
        { lovelace: 2_000_000n, [dropNft]: 1n }).complete();
    const bh = await (await bTx.sign.withWallet().complete()).submit();
    console.log(`   ${explorerTx(bh)}`); await awaitTx(lucid, bh, "beacon"); await sleep(50_000);
  }

  // ── 2. Claim create FOUNDATION account (ví deploy = committee) — idempotent ──
  console.log("── 2. claim create ──");
  const existAcc = (await lucid.utxosAt(claimAddr)).find((x) => {
    if (!x.datum) return false; try { return norm(decodeClaimAccountDatum(Data.from(x.datum)).owner) === norm(fPkh); } catch { return false; }
  });
  if (existAcc) { console.log(`   account FOUNDATION đã có (skip claim): ${existAcc.txHash}#${existAcc.outputIndex}`); }
  else {
    const startEpoch = (await epochNow()) - 2n;
    // Treasury co-spend BẮT BUỘC (C-SOLV-1): sổ cái nợ += DELTA, ép ≤ pool.
    const treClaimU = (await lucid.utxosAt(treAddr)).find((x) => (x.assets[trsyUnit] ?? 0n) === 1n);
    if (!treClaimU) throw new Error("không tìm thấy treasury UTxO mang NFT TRSY (kho chưa genesis?)");
    const claim = await buildClaimTx({
      lucid, claimScript: claimS, network: NETWORK, ownerPkh: fPkh, amount: DELTA,
      currentEpoch: startEpoch, committeeKeyHashes: committee, threshold: 1, validFromMs: startEpoch * MS_EPOCH,
      treasury: {
        utxo: treClaimU, script: treS,
        nftPolicy: TRSY_POLICY, nftAssetName: TREASURY_NFT_ASSET_NAME,
      },
      // CREATE: C-ACC-1 buộc tx phải đúc NFT tên blake2b_256(owner) — không có thì tx fail.
      accountNft: { script: accNftS },
    });
    const ch = await (await claim.tx.sign.withWallet().complete()).submit();
    console.log(`   ${explorerTx(ch)}`); await awaitTx(lucid, ch, "claim"); await sleep(50_000);
  }

  // ── 3. Redeem (FOUNDATION owner) → tLAMP về FOUNDATION ──
  console.log("── 3. redeem ──");
  const accUtxo = (await fLucid.utxosAt(claimAddr)).find((x) => {
    if (!x.datum) return false; try { return norm(decodeClaimAccountDatum(Data.from(x.datum)).owner) === norm(fPkh); } catch { return false; }
  });
  if (!accUtxo) throw new Error("không tìm thấy claim_account FOUNDATION");
  // Kho được xác thực bằng NFT TRSY, KHÔNG bằng số dư LAMP: claim_account.ak:138-148 đòi đúng 1
  // input mang TRSY. Địa chỉ kho có thể có nhiều UTxO (A-DEST hạ cánh không datum, Refill) ⇒ chọn
  // theo số dư là có ngày vớ trúng cái không mang TRSY ⇒ tx bị từ chối, mất collateral.
  const treUtxo = (await fLucid.utxosAt(treAddr))
    .find((x) => (x.assets[trsyUnit] ?? 0n) === 1n && (x.assets[lampUnit] ?? 0n) > 0n);
  if (!treUtxo) throw new Error("không tìm thấy treasury UTxO mang TRSY + còn tLAMP");
  const beaconUtxo = (await fLucid.utxosAt(beaconAddr)).find((x) => (x.assets[dropNft] ?? 0n) === 1n)!;
  const rEpoch = await epochNow();
  const redeem = await buildRedeemTx({
    lucid: fLucid, network: NETWORK, claimAccountUtxo: accUtxo, claimScript: claimS,
    treasuryUtxo: treUtxo, treasuryScript: treS, dropBeaconUtxo: beaconUtxo,
    currentEpoch: rEpoch, validFromMs: rEpoch * MS_EPOCH, lampPolicyId: lampPid, lampAssetName: TLAMP_NAME,
    treasuryNftPolicy: TRSY_POLICY,
    destinationAddress: fAddr,
  });
  console.log(`   vested=${redeem.vested / 1_000_000n} amount=${redeem.amount / 1_000_000n} tLAMP`);
  const rh = await (await redeem.tx.sign.withWallet().complete()).submit();
  console.log(`   ${explorerTx(rh)}`); await awaitTx(fLucid, rh, "redeem"); await sleep(15_000);

  const fLamp = (await fLucid.utxosAt(fAddr)).reduce((s, x) => s + (x.assets[lampUnit] ?? 0n), 0n);
  console.log(`\n✅ FOUNDATION nhận ${fLamp / 1_000_000n} tLAMP. PIPELINE CANONICAL HOÀN TẤT.`);
}
main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
