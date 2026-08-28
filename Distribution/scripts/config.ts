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
import { assertCommitteeShape } from "../offchain/src/committee.js";
import { assertParamCount as assertParamCountGate } from "../offchain/src/applyGate.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env từ repo root (../../.env so với LampDistribution/scripts/),
// không phụ thuộc cwd lúc chạy tsx.
// Secret: MỘT nguồn duy nhất — $AGENT_SECRETS (/Users/ductiger/Projects/Agents/.env).
// .env trong repo con đã BỎ; không đọc, không tạo lại.
dotenv.config({
  path: process.env.AGENT_SECRETS ?? "/Users/ductiger/Projects/Agents/.env",
});

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
    // GUARD (no-undo genesis): cận hình dạng committee sống ở offchain/src/committee.ts
    // để khớp một-đối-một với `committee_approved` on-chain VÀ để có test — module
    // scripts/ không có test runner. Ném COMMITTEE-004 (key trùng) / -005 (>16).
    assertCommitteeShape(keyHashes);
    const n = keyHashes.length;
    const byzantine = Math.ceil((2 * n) / 3); // ⌈2N/3⌉
    const th = process.env.COMMITTEE_THRESHOLD
      ? Number(process.env.COMMITTEE_THRESHOLD)
      : byzantine;
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

// ── LAMP token (test-LAMP self-contained: policy riêng để e2e không cần
// Genesis/Faucet deploy trước, NHƯNG asset NAME = canonical tLAMP để khớp
// token thật Genesis/Faucet mint — tránh deploy Distribution tìm sai asset) ──
// 02_mint_test_lamp.ts ghi policy + name vào deployed.json. Asset name "tLAMP".
export const LAMP_ASSET_NAME = "744c414d50"; // "tLAMP" — canonical (khớp Genesis/Faucet)

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
  return applyPolicy(raw.compiledCode, [outputRefToData(ref)]);
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
  return applyPolicy(raw.compiledCode, [outputRefToData(ref)]);
}

/** Policy id của one-shot treasury_nft cho genesis ref. */
export async function treasuryNftPolicyIdFromRef(ref: GenesisRef): Promise<string> {
  return mintingPolicyToId(await treasuryNftPolicyFromRef(ref));
}

// ── Account authenticity NFT (Aiken `claim_account_nft`) ───────────────
// 3 tham số: committee, threshold, treasury_nft_policy. Đúc đúng 1 NFT tên
// blake2b_256(owner) cho mỗi tài khoản; `claim_account` (C-ACC-0) đòi NFT đó có mặt ở
// mọi lần spend, còn `treasury.GrantEntitlement` nhánh CREATE (C-ACC-1) BẮT BUỘC tx phải
// đúc nó. Policy id là tham số THỨ 8 của claim_account và THỨ 6 của treasury ⇒ phải tính
// TRƯỚC hai validator kia ở 01_deploy, nếu không cả bộ địa chỉ sẽ lệch.

/** Compiled code (chưa apply) của minting validator claim_account_nft. */
export async function rawClaimAccountNft(): Promise<RawValidator> {
  return rawValidator("claim_account_nft.claim_account_nft.mint");
}

/** Applied claim_account_nft minting policy. */
export async function accountNftPolicy(
  committee: string[], threshold: bigint, treasuryNftPolicy: string,
): Promise<MintingPolicy> {
  const raw = await rawClaimAccountNft();
  return applyPolicy(raw.compiledCode, [committee, threshold, treasuryNftPolicy]);
}

/** Policy id của claim_account_nft đã apply. */
export async function accountNftPolicyId(
  committee: string[], threshold: bigint, treasuryNftPolicy: string,
): Promise<string> {
  return mintingPolicyToId(await accountNftPolicy(committee, threshold, treasuryNftPolicy));
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
//
// Thân hàm nằm ở `./blueprint.ts`, KHÔNG nằm đây. Lý do: `config.ts` nạp `.env` (khoá
// Blockfrost, seed ví) ngay lúc import — cổng an toàn APPLY-001 không được đòi secret mới
// chạy được, nếu không thì test tự động phải có secret mới kiểm được nó. Re-export lại ở
// đây để MỌI chỗ gọi cũ (`import { applyValidator } from "./config.js"`) giữ nguyên.
export {
  PLUTUS_JSON_PATH,
  rawValidator,
  assertParamCount,
  applyValidator,
  applyPolicy,
  paramCountOf,
  type RawValidator,
} from "./blueprint.js";
import { applyValidator, applyPolicy, rawValidator, type RawValidator } from "./blueprint.js";

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
    /** claim_account_nft policy id — tham số 8 của claim_account, 6 của treasury. */
    accountNftPolicy: string;
    claimAccountHash: string;
    // tham số CUỐI (thứ 8 claim_account / thứ 6 treasury), thêm 2026-08-12 (PR #22
    // điểm 1) — policy id của claim_account_nft. XEM applyGate.ts / báo cáo vá
    // APPLY-001: thiếu trường này ở CẢ HAI validator là chính lỗi cổng này chặn.
    accountNftPolicy: string;
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
  // 2026-08-14: claimAccountA/B thành TUỲ CHỌN. Sau PR #22, tài khoản KHÔNG còn tạo được
  // ở 03_genesis: mở tài khoản đòi đúc NFT (A-ACC-6 cần MỘT INPUT mang TRSY, mà ở 03 TRSY
  // vừa được ĐÚC nên chưa có input nào) và đòi `treasury.GrantEntitlement` với granted > 0.
  // Tài khoản nay mở ở 04_e2e qua đường CREATE của claimBuilder.
  genesis?: {
    dropParamBeacon:  BeaconRef;
    treasuryUtxo:     BeaconRef;
    claimAccountA?:   BeaconRef;
    claimAccountB?:   BeaconRef;
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
 * Re-apply validator từ deployed.json params (deterministic). Dùng ở 04_e2e để lấy lại
 * Validator object cho builder. Verify hash khớp deployed.json (chống desync).
 *
 * Danh sách tham số PHẢI khớp blueprint — `applyValidator` chặn bằng APPLY-001. Sau PR #22:
 * claim_account 8 tham số (thêm `account_nft_policy`), treasury 6 (thêm `account_nft_policy`).
 */
export async function reapplyValidators(state: DeployedState): Promise<{
  claimScript: Validator;
  beaconScript: Validator;
  treasuryScript: Validator;
  accountNftScript: MintingPolicy;
}> {
  const p = state.params;
  const committee  = state.committee.keyHashes;
  const threshold  = BigInt(state.committee.threshold);
  const msPerEpochBaked = BigInt(p.msPerEpoch);

  // ── deployed.json ĐÃ CŨ so với bảng epoch hiện tại (fail-closed) ─────────────
  // Không phép kiểm hash nào bên dưới bắt được chuyện này: `ms_per_epoch` là tham số #3 của
  // claim_account nên nó nằm TRONG script hash, và ở đây ta re-apply bằng CHÍNH giá trị cũ
  // đọc từ file ⇒ hash khớp hoàn hảo. Nhưng `currentEpoch()`/`validFromMs` của 04/05 lại
  // tính bằng MS_PER_EPOCH suy từ NETWORK. Với deployed.json Preprod ghi trước PR #27
  // (86_400_000, nay là 432_000_000): off-chain gửi lower_bound = epoch·432_000_000 còn
  // validator đọc current_epoch = lower_bound/86_400_000 ⇒ lệch 5 lần ⇒ vested off-chain ≠
  // on-chain ⇒ tx bị từ chối sau khi đã submit, MẤT COLLATERAL. Cùng lý do phải chặn khi
  // chạy sai mạng: NETWORK=Preprod trên state deploy ở Preview thì mọi địa chỉ đều lệch.
  if (state.network !== NETWORK) {
    throw new Error(
      `deployed.json là của mạng ${state.network} nhưng đang chạy NETWORK=${NETWORK}. ` +
      `Địa chỉ script network-specific — dừng, đừng gửi tiền đi.`,
    );
  }
  if (msPerEpochBaked !== MS_PER_EPOCH) {
    throw new Error(
      `deployed.json ĐÃ CŨ: params.msPerEpoch=${msPerEpochBaked} nhưng bảng epoch của ` +
      `${NETWORK} nay là ${MS_PER_EPOCH}. Giá trị cũ nướng trong script hash nên re-apply ` +
      `vẫn khớp hash — desync này chỉ lộ ra trên chuỗi, sau khi mất collateral: off-chain ` +
      `gửi validity_range theo ${MS_PER_EPOCH} còn validator chia cho ${msPerEpochBaked}. ` +
      `Chạy lại 'npm run deploy' để sinh bộ địa chỉ khớp bảng mới.`,
    );
  }

  if (!p.accountNftPolicy) {
    throw new Error(
      "deployed.json thiếu params.accountNftPolicy — state này deploy TRƯỚC khi có NFT tài " +
      "khoản (PR #22). Chạy lại 'npm run deploy' để sinh bộ địa chỉ mới; bộ cũ không còn " +
      "khớp validator nào trên chain.",
    );
  }

  const accountNftScript = await accountNftPolicy(committee, threshold, p.treasuryNftPolicy);
  if (mintingPolicyToId(accountNftScript) !== p.accountNftPolicy) {
    throw new Error(
      `account_nft policy desync: ${mintingPolicyToId(accountNftScript)} ≠ ${p.accountNftPolicy}`,
    );
  }

  const rawClaim = await rawValidator("claim_account.claim_account.spend");
  const claimScript = applyValidator(rawClaim.compiledCode, [
    committee, threshold, msPerEpochBaked, p.lampPolicy, p.lampName,
    p.beaconNftPolicy, p.treasuryNftPolicy, p.accountNftPolicy,
  ]);
  const rawBeacon = await rawValidator("beacon.beacon.spend");
  const beaconScript = applyValidator(rawBeacon.compiledCode, [
    committee, threshold, p.beaconNftPolicy,
  ]);
  const rawTreasury = await rawValidator("treasury.treasury.spend");
  const treasuryScript = applyValidator(rawTreasury.compiledCode, [
    p.claimAccountHash, p.lampPolicy, p.lampName, committee, threshold, p.accountNftPolicy,
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
  return { claimScript, beaconScript, treasuryScript, accountNftScript };
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

export function lampToOildrop(lamp: bigint): bigint {
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
