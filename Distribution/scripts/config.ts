// LampDistribution/scripts/config.ts — Cấu hình riêng cho module LampDistribution.
//
// Đọc .env (BLOCKFROST_KEY, PRIVATE_KEY/WALLET_SEED, NETWORK=Preview) + committee
// keys. KHÔNG hard-code secret. Cung cấp: Lucid provider, wallet select, committee
// resolution, đường dẫn deployed.json, helper apply params cho 3 validator.
//
// Committee model (SPEC §5/§7): M-of-N native multisig, ⌈2N/3⌉ threshold.
//   - Mặc định MVP Preview: committee 3 keyhash, threshold 2.
//   - Lấy committee từ đâu (giả định, ghi rõ để truy vết):
//       * COMMITTEE_KEYHASHES (.env): CSV 3 keyhash hex (28-byte). Ưu tiên nếu có.
//       * Nếu trống → DÙNG ví deploy làm committee 1-of-1 self-test (threshold 1).
//         Lý do: e2e SELF-CONTAINED — chỉ cần 1 ví ký để demo full flow. Production
//         committee 3 keyhash sẽ truyền qua COMMITTEE_KEYHASHES.
//     Đây là lựa chọn thiết kế MVP (4 trục: tối ưu — 1 ví đủ demo; bền vững —
//     production vẫn 3-of-N qua env). Ghi vào deployed.json để audit.

import dotenv from "dotenv";
import {
  Lucid, Blockfrost,
  getAddressDetails, validatorToScriptHash,
  credentialToAddress, scriptHashToCredential,
  applyParamsToScript, mintingPolicyToId, scriptFromNative,
  Constr,
  type LucidEvolution, type Validator, type MintingPolicy,
} from "@lucid-evolution/lucid";
import { msPerEpoch, type Network } from "@magiclamp/utils";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env từ repo root (../../.env so với LampDistribution/scripts/),
// không phụ thuộc cwd lúc chạy tsx.
dotenv.config({ path: resolve(__dirname, "../../.env") });

// ── Network + provider ─────────────────────────────────────────
export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
export const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? process.env.BLOCKFROST_TOKEN_GREENSUN ?? "";
export const PRIVATE_KEY    = process.env.PRIVATE_KEY ?? "";
export const WALLET_SEED    = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");

export const MS_PER_EPOCH = msPerEpoch(NETWORK);

/** Bắt lỗi rõ ràng khi thiếu credential — anh Aladin cấp .env sau. */
export function assertEnv(): void {
  if (!BLOCKFROST_KEY) {
    throw new Error(
      "thiếu BLOCKFROST_KEY trong .env — lấy từ https://blockfrost.io (project Preview).",
    );
  }
  if (!PRIVATE_KEY && !WALLET_SEED) {
    throw new Error(
      "thiếu PRIVATE_KEY hoặc WALLET_SEED trong .env — ví deploy testnet (KHÔNG dùng ví mainnet).",
    );
  }
}

/** Khởi tạo Lucid + chọn ví từ credential có sẵn. */
export async function makeLucid(): Promise<LucidEvolution> {
  assertEnv();
  const lucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  if (PRIVATE_KEY)      lucid.selectWallet.fromPrivateKey(PRIVATE_KEY);
  else if (WALLET_SEED) lucid.selectWallet.fromSeed(WALLET_SEED);
  return lucid;
}

/** Payment key-hash (PKH) của ví đang chọn. */
export async function walletPkh(lucid: LucidEvolution): Promise<string> {
  const addr = await lucid.wallet().address();
  const { paymentCredential } = getAddressDetails(addr);
  if (!paymentCredential) throw new Error("không lấy được payment credential từ ví");
  return paymentCredential.hash;
}

// ── Committee resolution (SPEC §5/§7) ──────────────────────────

export interface Committee {
  keyHashes: string[];   // hex 28-byte
  threshold: number;     // ⌈2N/3⌉ hoặc override
  source:    "env" | "wallet-self";
}

/**
 * Giải quyết committee:
 *   1. COMMITTEE_KEYHASHES (.env, CSV) → committee N keyhash, threshold ⌈2N/3⌉
 *      (hoặc COMMITTEE_THRESHOLD nếu set).
 *   2. Trống → ví deploy làm committee 1-of-1 (self-test, threshold 1).
 */
export async function resolveCommittee(lucid: LucidEvolution): Promise<Committee> {
  const raw = (process.env.COMMITTEE_KEYHASHES ?? "").trim();
  if (raw) {
    const keyHashes = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (keyHashes.length === 0) throw new Error("COMMITTEE_KEYHASHES rỗng sau khi parse");
    for (const k of keyHashes) {
      if (!/^[0-9a-f]{56}$/.test(k)) {
        throw new Error(`COMMITTEE_KEYHASHES: keyhash không hợp lệ (cần 28-byte hex): ${k}`);
      }
    }
    const n = keyHashes.length;
    const byzantine = Math.ceil((2 * n) / 3); // ⌈2N/3⌉
    const th = process.env.COMMITTEE_THRESHOLD
      ? Number(process.env.COMMITTEE_THRESHOLD)
      : byzantine;
    // GUARD (no-undo genesis): threshold sai → 3 validator hash sai, vốn khoá vĩnh viễn.
    if (!Number.isInteger(th) || th < 1 || th > n) {
      throw new Error(
        `COMMITTEE_THRESHOLD không hợp lệ: ${process.env.COMMITTEE_THRESHOLD} ` +
        `(cần số nguyên 1 ≤ threshold ≤ N=${n}). ` +
        `threshold=0/1 với N lớn phá Byzantine 2/3; threshold>N không bao giờ đủ chữ ký.`,
      );
    }
    if (th < byzantine) {
      console.warn(
        `⚠ CẢNH BÁO: threshold=${th} < ⌈2N/3⌉=${byzantine} (N=${n}) — KHÔNG đạt ` +
        `chịu lỗi Byzantine 2/3. Production nên đặt threshold ≥ ${byzantine}. ` +
        `Đặt COMMITTEE_THRESHOLD_ACK=1 để xác nhận chủ ý hạ ngưỡng.`,
      );
      if (NETWORK === "Mainnet" && process.env.COMMITTEE_THRESHOLD_ACK !== "1") {
        throw new Error(
          `Mainnet từ chối threshold=${th} < ⌈2N/3⌉=${byzantine} khi chưa xác nhận. ` +
          `Đặt COMMITTEE_THRESHOLD_ACK=1 nếu thật sự muốn.`,
        );
      }
    }
    return { keyHashes, threshold: th, source: "env" };
  }
  // Fallback self-test: ví deploy là committee duy nhất.
  // FAIL-CLOSED: KHÔNG cho self-test 1-of-1 trên Mainnet (1 key = không có Byzantine
  // fault tolerance, committee compromise = drain ngay). Production PHẢI set COMMITTEE_KEYHASHES.
  if (NETWORK === "Mainnet") {
    throw new Error(
      "Mainnet bắt buộc COMMITTEE_KEYHASHES (≥3 keyhash, threshold ⌈2N/3⌉). " +
      "Fallback ví-self 1-of-1 chỉ dành cho Preview self-test.",
    );
  }
  const pkh = await walletPkh(lucid);
  return { keyHashes: [pkh], threshold: 1, source: "wallet-self" };
}

// ── LAMP token name — PARAM theo NETWORK (mirror Genesis constants.ts) ──
// LAMP và tLAMP tồn tại ĐỒNG THỜI: tLAMP cho testnet (dev dùng), LAMP cho mainnet.
// Token = PolicyID + AssetName; policyId KHÁC nhau giữa tLAMP/LAMP (neo bởi genesis_ref)
// → 2 token độc lập, AssetName chỉ là nhãn. testnet → tLAMP, mainnet → LAMP.
// 01_deploy.ts cho override qua env LAMP_ASSET_NAME (dùng tLAMP thật Genesis/Faucet);
// nếu không set, lấy mặc định theo network dưới đây.
export const TLAMP_NAME = "744c414d50"; // "tLAMP" — testnet (khớp Genesis/Faucet)
export const LAMP_NAME  = "4c414d50";   // "LAMP"  — mainnet
export const LAMP_ASSET_NAME = NETWORK === "Mainnet" ? LAMP_NAME : TLAMP_NAME;

// ── Beacon NFT (authenticity) ──────────────────────────────────
// CONTRACT v2 "Capped Drop": chỉ còn 1 beacon DropParam{D} duy nhất. Bỏ
// PParam/Randomness/MerkleRoot (cơ chế lottery đã gỡ). Asset name "DROP".
// MVP self-contained: 03_genesis.ts mint 1 beacon NFT bằng NATIVE sig policy của
// ví deploy (one-shot), ghi policy id vào deployed.json. Khi agent beacon_nft ship
// policy thật, đọc từ blueprint thay native. PHẢI khớp offchain
// DEFAULT_BEACON_ASSET_NAMES.DropParam + onchain util.beacon_name.
export const DROP_ASSET_NAME = "44524f50"; // "DROP"

/**
 * Native one-shot minting policy (sig của ví deploy) — dùng cho cả test-LAMP (02)
 * và beacon NFT (03). Policy id DETERMINISTIC từ keyhash ví → 01_deploy có thể tính
 * trước beacon_nft_policy để bake vào claim_account/beacon validator, mà NFT thật
 * chỉ mint ở 03. (Khi agent kia ship beacon_nft minting validator, thay hàm này.)
 */
export function nativeSigPolicy(ownerKeyHash: string): MintingPolicy {
  return scriptFromNative({ type: "sig", keyHash: ownerKeyHash });
}

export function nativeSigPolicyId(ownerKeyHash: string): string {
  return mintingPolicyToId(nativeSigPolicy(ownerKeyHash));
}

// ── Beacon NFT ONE-SHOT (Aiken minting validator `beacon_nft`) ─────────
// One-shot: policy parameterized bởi 1 genesis OutputReference. Mint chỉ hợp lệ khi
// tx CONSUME đúng UTxO đó → supply 1 NFT TUYỆT ĐỐI, KHÔNG re-mint. Tách hẳn khỏi ví
// deploy (khác native-sig: native-sig cho phép chủ key re-mint NFT giả vô hạn).
// Quy trình: 01_deploy chọn genesis_ref (1 UTxO ví) → tính policy id → bake vào
// claim_account/beacon; 03_genesis mint qua attach.MintingPolicy(beaconNftPlutus) +
// consume đúng genesis_ref.

export interface GenesisRef { txHash: string; outputIndex: number; }

/** OutputReference Plutus = Constr(0, [transaction_id: bytes, output_index: int]). */
function outputRefToData(ref: GenesisRef): Constr<unknown> {
  return new Constr(0, [ref.txHash.toLowerCase(), BigInt(ref.outputIndex)]);
}

/** Compiled code (chưa apply) của minting validator beacon_nft. */
export async function rawBeaconNft(): Promise<RawValidator> {
  return rawValidator("beacon_nft.beacon_nft.mint");
}

/** Applied one-shot minting policy (Validator) từ genesis ref. */
export async function beaconNftPolicyFromRef(ref: GenesisRef): Promise<MintingPolicy> {
  const raw = await rawBeaconNft();
  return {
    type: "PlutusV3",
    script: applyParamsToScript(raw.compiledCode, [outputRefToData(ref)] as never),
  };
}

/** Policy id của one-shot beacon_nft cho genesis ref. */
export async function beaconNftPolicyIdFromRef(ref: GenesisRef): Promise<string> {
  return mintingPolicyToId(await beaconNftPolicyFromRef(ref));
}

// ── Treasury authenticity NFT ONE-SHOT (Aiken `treasury_nft`) ──────────
// Cùng mẫu one-shot beacon_nft: policy parameterized bởi 1 genesis OutputReference.
// Mint chỉ hợp lệ khi tx CONSUME đúng UTxO đó → supply 1 NFT "TRSY" TUYỆT ĐỐI.
// Policy id phải tính TRƯỚC ở 01_deploy để bake vào claim_account (param 7), NFT thật
// chỉ mint ở 03_genesis (consume đúng genesis_ref). Treasury_nft KHÔNG có native-sig
// fallback — authenticity treasury là sống còn cho solvency, luôn one-shot.

/** Asset-name hex treasury authenticity NFT — PHẢI khớp onchain util.treasury_nft_name. */
export const TREASURY_NFT_ASSET_NAME = "54525359"; // "TRSY"

/** Compiled code (chưa apply) của minting validator treasury_nft. */
export async function rawTreasuryNft(): Promise<RawValidator> {
  return rawValidator("treasury_nft.treasury_nft.mint");
}

/** Applied one-shot treasury_nft minting policy (Validator) từ genesis ref. */
export async function treasuryNftPolicyFromRef(ref: GenesisRef): Promise<MintingPolicy> {
  const raw = await rawTreasuryNft();
  return {
    type: "PlutusV3",
    script: applyParamsToScript(raw.compiledCode, [outputRefToData(ref)] as never),
  };
}

/** Policy id của one-shot treasury_nft cho genesis ref. */
export async function treasuryNftPolicyIdFromRef(ref: GenesisRef): Promise<string> {
  return mintingPolicyToId(await treasuryNftPolicyFromRef(ref));
}

/**
 * Chọn 1 UTxO ví deploy làm genesis_ref one-shot (tất định: sort theo txHash#index,
 * lấy phần tử đầu). UTxO này PHẢI còn sống tới 03_genesis (mint consume nó). Nếu ví
 * tiêu nó ở bước trung gian → 03 phải re-pick (nhưng policy đã bake ở 01 sẽ desync →
 * fail-closed, an toàn hơn mint sai).
 */
export async function pickGenesisRef(lucid: LucidEvolution): Promise<GenesisRef> {
  const utxos = await lucid.wallet().getUtxos();
  if (utxos.length === 0) throw new Error("ví deploy không có UTxO nào để làm genesis_ref one-shot");
  const sorted = [...utxos].sort((a, b) =>
    a.txHash === b.txHash ? a.outputIndex - b.outputIndex : a.txHash.localeCompare(b.txHash),
  );
  const u = sorted[0]!;
  return { txHash: u.txHash, outputIndex: u.outputIndex };
}

// ── plutus.json loader + apply params ──────────────────────────

const PLUTUS_JSON_PATH = resolve(__dirname, "../onchain/plutus.json");

interface RawValidator { title: string; compiledCode: string; hash: string; }

async function loadBlueprint(): Promise<RawValidator[]> {
  const json = JSON.parse(await readFile(PLUTUS_JSON_PATH, "utf8"));
  return json.validators as RawValidator[];
}

/** Lấy compiledCode chưa apply cho validator theo title (spend variant). */
export async function rawValidator(title: string): Promise<RawValidator> {
  const vs = await loadBlueprint();
  const v = vs.find((x) => x.title === title);
  if (!v) {
    throw new Error(
      `validator '${title}' không có trong onchain/plutus.json — chạy 'aiken build' trong onchain/ trước.`,
    );
  }
  return v;
}

/** Plutus Data hex của 1 param list → applied Validator. */
export function applyValidator(compiledCode: string, params: unknown[]): Validator {
  return {
    type: "PlutusV3",
    script: applyParamsToScript(compiledCode, params as never),
  };
}

/** script hash → bech32 address (network-specific). */
export function scriptAddress(script: Validator): string {
  return credentialToAddress(
    NETWORK,
    scriptHashToCredential(validatorToScriptHash(script)),
  );
}

export function scriptHash(script: Validator): string {
  return validatorToScriptHash(script);
}

// ── Epoch (POSIX-derived, khớp validator get_current_epoch) ─────

/** Đọc tip POSIX ms từ Blockfrost (time giây → ms). */
export async function tipPosixMs(): Promise<bigint> {
  const res = await fetch(`${BLOCKFROST_URL}/blocks/latest`, {
    headers: { project_id: BLOCKFROST_KEY },
  });
  if (!res.ok) throw new Error(`Blockfrost /blocks/latest lỗi ${res.status}`);
  const tip = (await res.json()) as { time: number };
  return BigInt(tip.time) * 1000n;
}

/** current epoch = tipPosixMs / ms_per_epoch (khớp Aiken posix_ms_to_epoch). */
export async function currentEpoch(): Promise<bigint> {
  return (await tipPosixMs()) / MS_PER_EPOCH;
}

// ── deployed.json (state file giữa các bước) ───────────────────

export const DEPLOYED_PATH = resolve(__dirname, "deployed.json");

export interface BeaconRef {
  txHash: string;
  outputIndex: number;
}

export interface DeployedState {
  network: Network;
  msPerEpoch: string;             // bigint as string
  committee: { keyHashes: string[]; threshold: number; source: string };
  // applied script hashes + addresses
  claimAccount: { hash: string; address: string };
  beacon:       { hash: string; address: string };
  treasury:     { hash: string; address: string };
  // validator params (để re-apply deterministically ở bước sau)
  params: {
    msPerEpoch: string;
    lampPolicy: string;
    lampName: string;
    beaconNftPolicy: string;
    treasuryNftPolicy: string;
    claimAccountHash: string;
  };
  // test-LAMP token (02)
  testLamp?: { policyId: string; assetName: string; minted: string };
  // beacon NFT policy (03)
  beaconNftPolicy?: string;
  // beacon NFT mode + one-shot genesis ref (01 → 03). "oneshot" = Aiken beacon_nft
  // validator (genesisRef baked vào policy id); "native-sig" = MVP fallback (Preview).
  beaconNftMode?: "oneshot" | "native-sig";
  beaconNftGenesisRef?: GenesisRef;
  // treasury authenticity NFT (TRSY) one-shot genesis ref (01 → 03). LUÔN one-shot Aiken
  // treasury_nft. policyId baked vào claim_account (param 7); NFT mint ở 03 consume ref.
  treasuryNftGenesisRef?: GenesisRef;
  // genesis UTxOs (03) — txHash#index để bước sau resolve.
  // v2: 1 beacon DropParam duy nhất (bỏ pparam/randomness/merkle).
  genesis?: {
    dropParamBeacon:  BeaconRef;
    treasuryUtxo:     BeaconRef;
    claimAccountA:    BeaconRef;
    claimAccountB:    BeaconRef;
  };
  // test wallets (A, B) — owner PKH; ví A = ví deploy, B = phụ (xem genesis)
  wallets?: { aPkh: string; bPkh: string };
}

export async function loadDeployed(): Promise<DeployedState> {
  try {
    return JSON.parse(await readFile(DEPLOYED_PATH, "utf8")) as DeployedState;
  } catch {
    throw new Error(
      `chưa có deployed.json (${DEPLOYED_PATH}) — chạy 'npm run deploy' rồi 'npm run genesis' trước.`,
    );
  }
}

import { writeFile } from "node:fs/promises";
export async function saveDeployed(state: DeployedState): Promise<void> {
  await writeFile(DEPLOYED_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// ── misc helpers ───────────────────────────────────────────────

/**
 * Re-apply 3 validator từ deployed.json params (deterministic). Dùng ở 04_e2e để
 * lấy lại Validator object cho builder. Verify hash khớp deployed.json (chống desync).
 */
export async function reapplyValidators(state: DeployedState): Promise<{
  claimScript: Validator;
  beaconScript: Validator;
  treasuryScript: Validator;
}> {
  const p = state.params;
  const committee  = state.committee.keyHashes;
  const threshold  = BigInt(state.committee.threshold);
  const msPerEpoch = BigInt(p.msPerEpoch);

  const rawClaim = await rawValidator("claim_account.claim_account.spend");
  const claimScript = applyValidator(rawClaim.compiledCode, [
    committee, threshold, msPerEpoch, p.lampPolicy, p.lampName,
    p.beaconNftPolicy, p.treasuryNftPolicy,
  ]);
  const rawBeacon = await rawValidator("beacon.beacon.spend");
  const beaconScript = applyValidator(rawBeacon.compiledCode, [
    committee, threshold, p.beaconNftPolicy,
  ]);
  const rawTreasury = await rawValidator("treasury.treasury.spend");
  const treasuryScript = applyValidator(rawTreasury.compiledCode, [
    p.claimAccountHash, p.lampPolicy, p.lampName, committee, threshold,
  ]);

  // verify hash khớp
  if (scriptHash(claimScript) !== state.claimAccount.hash) {
    throw new Error(`claim_account hash desync: ${scriptHash(claimScript)} ≠ ${state.claimAccount.hash}`);
  }
  if (scriptHash(beaconScript) !== state.beacon.hash) {
    throw new Error(`beacon hash desync: ${scriptHash(beaconScript)} ≠ ${state.beacon.hash}`);
  }
  if (scriptHash(treasuryScript) !== state.treasury.hash) {
    throw new Error(`treasury hash desync: ${scriptHash(treasuryScript)} ≠ ${state.treasury.hash}`);
  }
  return { claimScript, beaconScript, treasuryScript };
}

/** Lấy 1 UTxO theo BeaconRef (txHash#index) tại address. */
export async function utxoByRef(
  lucid: LucidEvolution, address: string, ref: BeaconRef,
) {
  const utxos = await lucid.utxosAt(address);
  const u = utxos.find((x) => x.txHash === ref.txHash && x.outputIndex === ref.outputIndex);
  if (!u) {
    // có thể UTxO đã bị spend (bước trước) — caller phải re-resolve theo datum/asset.
    throw new Error(`UTxO ${ref.txHash}#${ref.outputIndex} không còn tại ${address} (đã spend?)`);
  }
  return u;
}

export function toUnit(policyId: string, assetName: string): string {
  return policyId + assetName;
}

export function lampToOil(lamp: bigint): bigint {
  return lamp * 1_000_000n;
}

export function explorerTx(hash: string): string {
  return `https://${NETWORK.toLowerCase()}.cardanoscan.io/transaction/${hash}`;
}

/** Đợi tx settle: poll Blockfrost cho tới khi UTxO của txHash xuất hiện. */
export async function awaitTx(lucid: LucidEvolution, txHash: string, label = ""): Promise<void> {
  process.stdout.write(`   ⏳ đợi confirm ${label} ${txHash.slice(0, 12)}… `);
  const ok = await lucid.awaitTx(txHash);
  if (!ok) throw new Error(`tx ${txHash} không confirm sau timeout`);
  console.log("✓");
}
