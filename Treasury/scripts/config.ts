// Treasury/scripts/config.ts — Cấu hình deploy riêng cho module Treasury (custody).
//
// Mẫu LampDistribution/scripts/config.ts: đọc .env (BLOCKFROST_KEY, PRIVATE_KEY/
// WALLET_SEED, NETWORK=Preview), khởi tạo Lucid, load Treasury onchain/plutus.json,
// apply params 2 validator (custody, custody_seed), tính address/hash, ghi state json.
//
// KHÁC Distribution: apply-params CHỈ cần compiledCode (KHÔNG cần mạng). Vì agent này
// KHÔNG có credential thật, mọi helper apply-params chạy offline; chỉ buildSeedTx mới
// cần Lucid (network). makeLucidOrNull() trả null khi thiếu cred → caller in plan tĩnh.

import dotenv from "dotenv";
import {
  Lucid, Blockfrost,
  getAddressDetails,
  applyParamsToScript, credentialToAddress,
  scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type Validator,
} from "@lucid-evolution/lucid";
import { msPerEpoch, type Network } from "@magiclamp/utils";
// SDK Treasury: import THẲNG từ ../offchain/src (như Distribution scripts) — package
// treasury-sdk không khai "exports", resolve theo đường dẫn nguồn .js (tsx/NodeNext).
//
// QUAN TRỌNG (class-identity): applyCustodySeed dựng Constr(OutputReference) BÊN TRONG
// SDK bằng lucid của offchain/node_modules. Nếu ở đây ta tự dựng Constr rồi gọi
// applyParamsToScript của scripts/node_modules, hai class Constr KHÁC danh tính →
// "Could not serialize: Unsupported type". Vì vậy DÙNG applyCustodySeed của SDK cho
// param Constr; chỉ tự apply cho param phẳng (string/bigint — không có class identity).
import { applyCustodySeed, seedPolicyId } from "../offchain/src/seedBuilder.js";
import type { OutputReference } from "../offchain/src/types.js";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env từ repo Treasury root (../.env so với Treasury/scripts/) — KHÔNG phụ thuộc cwd.
dotenv.config({ path: resolve(__dirname, "../.env") });

// ── Network + provider ─────────────────────────────────────────
export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
export const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? "";
export const PRIVATE_KEY    = process.env.PRIVATE_KEY ?? "";
export const WALLET_SEED    = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");

// ms_per_epoch THEO network (Preview/Preprod/Mainnet) — param vào custody validator.
export const MS_PER_EPOCH = msPerEpoch(NETWORK);

/** true khi đủ credential build tx thật. Thiếu → DRY mode (chỉ apply-params + in plan). */
export function hasCredentials(): boolean {
  return Boolean(BLOCKFROST_KEY && (PRIVATE_KEY || WALLET_SEED));
}

/**
 * Khởi tạo Lucid nếu đủ cred; thiếu → trả null (DRY mode). KHÔNG ném lỗi để script
 * vẫn chạy tới phần apply-params/in plan mà không cần mạng.
 */
export async function makeLucidOrNull(): Promise<LucidEvolution | null> {
  if (!hasCredentials()) return null;
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

// ── plutus.json loader + apply params ──────────────────────────

const PLUTUS_JSON_PATH = resolve(__dirname, "../onchain/plutus.json");

interface RawValidator { title: string; compiledCode: string; hash: string; }

async function loadBlueprint(): Promise<RawValidator[]> {
  const json = JSON.parse(await readFile(PLUTUS_JSON_PATH, "utf8"));
  return json.validators as RawValidator[];
}

/** Lấy compiledCode chưa apply cho validator theo title (vd "custody.custody.spend"). */
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

/** Plutus Data hex của 1 param list → applied Validator (PlutusV3). */
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

// ── Apply 2 validator Treasury (đúng thứ tự dependency) ─────────
//
// custody_seed.custody_seed.mint : [genesis_ref:OutputReference]
//     → seed_policy = mintingPolicyToId(custody_seed đã apply).
// custody.custody.spend          : [proposal_policy:PolicyId, seed_policy:PolicyId, ms_per_epoch:Int]
//
// DEPENDENCY: custody cần seed_policy → apply custody_seed TRƯỚC.

export interface AppliedCustody {
  custodySeed:   Validator;   // minting policy one-shot (apply genesis_ref)
  seedPolicy:    string;      // = mintingPolicyToId(custodySeed)
  custodyScript: Validator;   // spend validator (apply proposal_policy, seed_policy, ms_per_epoch)
  custodyHash:   string;
  custodyAddr:   string;
}

/**
 * Apply đầy đủ 2 validator custody cho MỘT instance.
 * @param genesisRef UTxO genesis tiêu khi seed (one-shot) → quyết định seed_policy.
 * @param proposalPolicy PolicyId beacon Governance (gác Release). Dev → placeholder.
 * @param msPerEpoch POSIX ms ↔ epoch (mặc định MS_PER_EPOCH theo network).
 */
export async function applyCustodyInstance(
  genesisRef: OutputReference,
  proposalPolicy: string,
  msPerEpochParam: bigint = MS_PER_EPOCH,
): Promise<AppliedCustody> {
  // 1. custody_seed (one-shot, param genesis_ref:OutputReference) → seed_policy.
  //    Dùng applyCustodySeed của SDK (dựng Constr nội bộ, tránh lệch class-identity).
  const rawSeed = await rawValidator("custody_seed.custody_seed.mint");
  const custodySeed = applyCustodySeed(rawSeed.compiledCode, genesisRef);
  const seedPolicy = seedPolicyId(custodySeed);

  // 2. custody (spend) cần seed_policy.
  const rawCustody = await rawValidator("custody.custody.spend");
  const custodyScript = applyValidator(rawCustody.compiledCode, [
    proposalPolicy,
    seedPolicy,
    msPerEpochParam,
  ]);
  const custodyHash = scriptHash(custodyScript);
  const custodyAddr = scriptAddress(custodyScript);

  return { custodySeed, seedPolicy, custodyScript, custodyHash, custodyAddr };
}

// ── env helpers (đọc param, có placeholder dev rõ ràng) ─────────

/** Pad/độ một chuỗi hex thành 28-byte (56 hex) — placeholder script hash dev. */
export function padHash28(seedHex: string): string {
  const h = seedHex.toLowerCase().replace(/[^0-9a-f]/g, "");
  return (h + "0".repeat(56)).slice(0, 56);
}

/** Encode ASCII → hex trần lowercase. */
export function asciiToHex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 0xff) throw new Error(`asciiToHex: ký tự ngoài ASCII '${s[i]}'`);
    out += code.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * proposal_policy (beacon Governance gác Release). Production: truyền PROPOSAL_POLICY_ID
 * (.env) = policy id của Governance proposal NFT. Dev/dry-run trống → placeholder 28-byte.
 */
export function resolveProposalPolicy(): { policy: string; source: "env" | "placeholder" } {
  const env = (process.env.PROPOSAL_POLICY_ID ?? "").trim().toLowerCase();
  if (env) {
    if (!/^[0-9a-f]{56}$/.test(env)) {
      throw new Error(`PROPOSAL_POLICY_ID không hợp lệ (cần 28-byte hex): ${env}`);
    }
    return { policy: env, source: "env" };
  }
  return { policy: padHash28(asciiToHex("treasury-proposal")), source: "placeholder" };
}

// ── F14: VAN chặn LIVE khi tham số còn PLACEHOLDER ─────────────
// Khi đủ credential, script sẽ build tx LIVE (dry-run .complete() → có thể ký+submit).
// Nếu param then-chốt (proposal_policy/governance_ref/genesis_ref/seed_policy) còn rỗng
// hoặc giá trị MẪU (placeholder) → ÉP rơi về DRY + in cảnh báo rõ. KHÔNG build tx LIVE
// với param giả (chống deploy nhầm custody gắn governance/proposal KHÔNG tồn tại).

/** Một param cần kiểm trước LIVE: tên + giá trị + có-phải-placeholder. */
export interface LiveParam {
  name:        string;
  value:       string;
  placeholder: boolean;
}

export interface LiveGuardResult {
  /** true = ĐƯỢC build LIVE (đủ cred ∧ không param placeholder). */
  allowLive:   boolean;
  /** Danh sách param còn placeholder (rỗng nếu sạch). */
  offending:   LiveParam[];
  /** Lý do (in cảnh báo). */
  reason:      string;
}

/**
 * F14: quyết định có cho LIVE không. allowLive = đủ cred ∧ MỌI param không placeholder.
 * Thiếu cred → DRY (bình thường). Đủ cred NHƯNG có placeholder → CHẶN LIVE, rơi DRY.
 * @param params danh sách param then-chốt (mỗi cái có cờ placeholder).
 */
export function evaluateLiveGuards(params: LiveParam[]): LiveGuardResult {
  const offending = params.filter((p) => p.placeholder || p.value.trim() === "");
  if (!hasCredentials()) {
    return { allowLive: false, offending, reason: "thiếu credential (BLOCKFROST_KEY + PRIVATE_KEY/WALLET_SEED)" };
  }
  if (offending.length > 0) {
    return {
      allowLive: false,
      offending,
      reason: `param còn PLACEHOLDER/rỗng: ${offending.map((p) => p.name).join(", ")}`,
    };
  }
  return { allowLive: true, offending: [], reason: "đủ cred + mọi param thật" };
}

/** In cảnh báo F14 khi LIVE bị chặn vì placeholder (gọi khi allowLive=false do offending). */
export function warnLiveBlocked(res: LiveGuardResult): void {
  if (res.allowLive) return;
  if (res.offending.length === 0) return;   // chỉ thiếu cred — DRY bình thường, không cảnh báo gắt
  console.warn("\n⚠️  F14 GUARD: build LIVE bị CHẶN — rơi về DRY.");
  console.warn(`   Lý do: ${res.reason}`);
  for (const p of res.offending) {
    console.warn(`   • ${p.name} = ${p.value || "(rỗng)"}  ← ${p.placeholder ? "PLACEHOLDER mẫu" : "RỖNG"}`);
  }
  console.warn("   Đặt giá trị THẬT vào .env rồi chạy lại để build tx LIVE.\n");
}

// ── output state file (instance_id, custody_hash, seed_policy) ──

export const SEEDED_PATH = resolve(__dirname, "seeded.json");

export interface SeededInstance {
  network:        Network;
  msPerEpoch:     string;          // bigint as string
  instanceId:     string;          // hex (= NFT name)
  custodyHash:    string;
  custodyAddress: string;
  seedPolicy:     string;
  proposalPolicy: string;
  proposalSource: string;          // "env" | "placeholder"
  genesisRef:     { transaction_id: string; output_index: string };
  cutBps:         string;
  reservedMinAda: string;
  datumCbor:      string;          // CustodyDatum genesis (inline)
  dryRun:         boolean;         // true = chưa submit (thiếu credential)
  txHash?:        string;          // điền khi submit thật
}

export async function saveSeeded(state: SeededInstance): Promise<void> {
  await writeFile(SEEDED_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function explorerTx(hash: string): string {
  return `https://${NETWORK.toLowerCase()}.cardanoscan.io/transaction/${hash}`;
}
