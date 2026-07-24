// PlatformKit/scripts/config.ts — Cấu hình deploy registry + onboard platform.
//
// Mẫu LampDistribution/scripts/config.ts. Registry validator NẰM TRONG Treasury onchain
// (registry, registry_beacon) → load Treasury/onchain/plutus.json. PlatformKit chỉ là
// SDK off-chain + platform config; on-chain dùng chung blueprint Treasury.
//
// PHÁ VÒNG dependency:
//   registry        param (registry_authority, beacon_policy)
//   registry_beacon param (registry_authority)  → beacon_policy = mintingPolicyToId(...)
//   beacon_policy CHỈ phụ thuộc authority → apply registry_beacon TRƯỚC (lấy beacon_policy),
//   rồi apply registry. Không vòng lặp.
//
// CLASS-IDENTITY: param registry/registry_beacon đều PHẲNG (hex string/bytes) — KHÔNG có
// Constr → an toàn dùng applyParamsToScript của lucid trong scripts/node_modules.

import dotenv from "dotenv";
import {
  Lucid, Blockfrost,
  getAddressDetails,
  applyParamsToScript, credentialToAddress,
  scriptHashToCredential, validatorToScriptHash, mintingPolicyToId,
  type LucidEvolution, type Validator,
} from "@lucid-evolution/lucid";
import { msPerEpoch, type Network } from "@magiclamp/protocol-utils";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env từ PlatformKit root (../.env so với PlatformKit/scripts/).
dotenv.config({ path: resolve(__dirname, "../.env") });

// ── Network + provider ─────────────────────────────────────────
export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
export const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? "";
export const PRIVATE_KEY    = process.env.PRIVATE_KEY ?? "";
export const WALLET_SEED    = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");

export const MS_PER_EPOCH = msPerEpoch(NETWORK);

export function hasCredentials(): boolean {
  return Boolean(BLOCKFROST_KEY && (PRIVATE_KEY || WALLET_SEED));
}

/** Khởi tạo Lucid nếu đủ cred; thiếu → null (DRY mode — apply-params không cần mạng). */
export async function makeLucidOrNull(): Promise<LucidEvolution | null> {
  if (!hasCredentials()) return null;
  const lucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  if (PRIVATE_KEY)      lucid.selectWallet.fromPrivateKey(PRIVATE_KEY);
  else if (WALLET_SEED) lucid.selectWallet.fromSeed(WALLET_SEED);
  return lucid;
}

export async function walletPkh(lucid: LucidEvolution): Promise<string> {
  const addr = await lucid.wallet().address();
  const { paymentCredential } = getAddressDetails(addr);
  if (!paymentCredential) throw new Error("không lấy được payment credential từ ví");
  return paymentCredential.hash;
}

// ── Treasury blueprint loader (registry, registry_beacon) ───────

const TREASURY_PLUTUS_JSON = resolve(__dirname, "../../Treasury/onchain/plutus.json");

interface RawValidator { title: string; compiledCode: string; hash: string; }

async function loadBlueprint(): Promise<RawValidator[]> {
  const json = JSON.parse(await readFile(TREASURY_PLUTUS_JSON, "utf8"));
  return json.validators as RawValidator[];
}

export async function rawValidator(title: string): Promise<RawValidator> {
  const vs = await loadBlueprint();
  const v = vs.find((x) => x.title === title);
  if (!v) {
    throw new Error(
      `validator '${title}' không có trong Treasury/onchain/plutus.json — `
      + `chạy 'aiken build' trong Treasury/onchain/ trước.`,
    );
  }
  return v;
}

export function applyValidator(compiledCode: string, params: unknown[]): Validator {
  return {
    type: "PlutusV3",
    script: applyParamsToScript(compiledCode, params as never),
  };
}

export function scriptAddress(script: Validator): string {
  return credentialToAddress(
    NETWORK,
    scriptHashToCredential(validatorToScriptHash(script)),
  );
}

export function scriptHash(script: Validator): string {
  return validatorToScriptHash(script);
}

// ── Apply registry (PHÁ VÒNG: beacon trước, registry sau) ───────

export interface AppliedRegistry {
  registryBeacon: Validator;   // minting policy (apply registry_authority)
  beaconPolicy:   string;      // = mintingPolicyToId(registryBeacon)
  registryScript: Validator;   // spend validator (apply registry_authority, beacon_policy)
  registryHash:   string;
  registryAddr:   string;
}

/**
 * Apply 2 validator registry.
 * @param registryAuthority payment key-hash (28-byte hex) committee→DAO (ký Register/Update).
 */
export async function applyRegistry(registryAuthority: string): Promise<AppliedRegistry> {
  const auth = registryAuthority.toLowerCase();
  if (!/^[0-9a-f]{56}$/.test(auth)) {
    throw new Error(`registry_authority không hợp lệ (cần 28-byte hex): ${auth}`);
  }

  // 1. registry_beacon(authority) → beacon_policy (CHỈ phụ thuộc authority).
  const rawBeacon = await rawValidator("registry_beacon.registry_beacon.mint");
  const registryBeacon = applyValidator(rawBeacon.compiledCode, [auth]);
  const beaconPolicy = mintingPolicyToId(registryBeacon);

  // 2. registry(authority, beacon_policy).
  const rawRegistry = await rawValidator("registry.registry.spend");
  const registryScript = applyValidator(rawRegistry.compiledCode, [auth, beaconPolicy]);
  const registryHash = scriptHash(registryScript);
  const registryAddr = scriptAddress(registryScript);

  return { registryBeacon, beaconPolicy, registryScript, registryHash, registryAddr };
}

// ── Treasury custody_seed apply (cho onboard — seed_policy) ──────
// DÙNG applyCustodySeed của Treasury SDK (dựng Constr nội bộ → tránh lệch class-identity
// khi apply OutputReference). KHÔNG tự dựng Constr ở đây.
import { applyCustodySeed, seedPolicyId } from "../../Treasury/offchain/src/seedBuilder.js";

// ── env helpers ────────────────────────────────────────────────

export function asciiToHex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 0xff) throw new Error(`asciiToHex: ký tự ngoài ASCII '${s[i]}'`);
    out += code.toString(16).padStart(2, "0");
  }
  return out;
}

export function padHash28(seedHex: string): string {
  const h = seedHex.toLowerCase().replace(/[^0-9a-f]/g, "");
  return (h + "0".repeat(56)).slice(0, 56);
}

/**
 * registry_authority: payment key-hash committee→DAO. Production: REGISTRY_AUTHORITY (.env).
 * DRY/dev trống → placeholder 28-byte (KHÔNG ký được — chỉ apply-params/in hash).
 */
export function resolveRegistryAuthority(): { authority: string; source: "env" | "placeholder" } {
  const env = (process.env.REGISTRY_AUTHORITY ?? "").trim().toLowerCase();
  if (env) {
    if (!/^[0-9a-f]{56}$/.test(env)) {
      throw new Error(`REGISTRY_AUTHORITY không hợp lệ (cần 28-byte hex): ${env}`);
    }
    return { authority: env, source: "env" };
  }
  return { authority: padHash28(asciiToHex("registry-authority")), source: "placeholder" };
}

/** proposal_policy (Governance beacon gác Release custody). Trống → placeholder. */
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
// Mirror Treasury/scripts/config.ts. Đủ cred NHƯNG param then-chốt (registry_authority/
// proposal_policy/genesis_ref/seed_policy/governance_ref) còn placeholder/rỗng → CHẶN LIVE,
// rơi DRY + cảnh báo. Chống deploy nhầm entry trỏ registry/governance KHÔNG tồn tại.

export interface LiveParam {
  name:        string;
  value:       string;
  placeholder: boolean;
}

export interface LiveGuardResult {
  allowLive: boolean;
  offending: LiveParam[];
  reason:    string;
}

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

export function warnLiveBlocked(res: LiveGuardResult): void {
  if (res.allowLive || res.offending.length === 0) return;
  console.warn("\n⚠️  F14 GUARD: build LIVE bị CHẶN — rơi về DRY.");
  console.warn(`   Lý do: ${res.reason}`);
  for (const p of res.offending) {
    console.warn(`   • ${p.name} = ${p.value || "(rỗng)"}  ← ${p.placeholder ? "PLACEHOLDER mẫu" : "RỖNG"}`);
  }
  console.warn("   Đặt giá trị THẬT vào .env rồi chạy lại để build tx LIVE.\n");
}

// ── F14: kiểm KHÔNG hai instance chung governance_ref ──────────
// Hai custody instance dùng CÙNG governance_ref ⇒ MỘT proposal Executed (cùng spec_hash)
// có thể chi ở CẢ HAI (replay chéo instance). F10 (spend_spec_hash gồm instance_id) đã chặn
// ở on-chain, nhưng cảnh báo sớm ở deploy giúp tránh cấu hình nhầm. Đọc lịch sử onboard
// (danh sách instance) từ file json; cảnh báo nếu governance_ref mới trùng instance đã có.

export const ONBOARDED_LIST_PATH = resolve(__dirname, "onboarded-instances.json");

export interface OnboardedInstanceRef {
  platform:      string;
  instanceId:    string;
  governanceRef: string;
}

/** Đọc danh sách instance đã onboard (history). Thiếu file → []. */
export async function loadOnboardedList(): Promise<OnboardedInstanceRef[]> {
  try {
    const raw = JSON.parse(await readFile(ONBOARDED_LIST_PATH, "utf8"));
    return Array.isArray(raw) ? (raw as OnboardedInstanceRef[]) : [];
  } catch {
    return [];
  }
}

/**
 * Cảnh báo nếu governanceRef mới TRÙNG governance_ref của instance KHÁC đã onboard.
 * Trả danh sách instance trùng (rỗng = sạch). KHÔNG ném — chỉ cảnh báo (deploy vẫn tiếp).
 * So sánh bỏ qua chính instanceId mình (re-onboard cùng instance không tính trùng).
 */
export function checkGovernanceRefCollision(
  existing: OnboardedInstanceRef[],
  newInstanceId: string,
  newGovernanceRef: string,
): OnboardedInstanceRef[] {
  const g = newGovernanceRef.toLowerCase();
  return existing.filter(
    (e) => e.governanceRef.toLowerCase() === g
      && e.instanceId.toLowerCase() !== newInstanceId.toLowerCase(),
  );
}

export function warnGovernanceRefCollision(collisions: OnboardedInstanceRef[], gov: string): void {
  if (collisions.length === 0) return;
  console.warn("\n⚠️  F14 GUARD: governance_ref TRÙNG instance khác đã onboard.");
  console.warn(`   governance_ref = ${gov}`);
  for (const c of collisions) {
    console.warn(`   • đã dùng bởi platform '${c.platform}' (instance ${c.instanceId})`);
  }
  console.warn("   Mỗi instance NÊN có governance_ref riêng (cô lập replay chéo).\n");
}

/** Cập nhật history: thêm/ghi-đè entry theo instanceId, ghi lại file list. */
export async function appendOnboardedList(entry: OnboardedInstanceRef): Promise<OnboardedInstanceRef[]> {
  const list = await loadOnboardedList();
  const next = list.filter((e) => e.instanceId.toLowerCase() !== entry.instanceId.toLowerCase());
  next.push(entry);
  await writeFile(ONBOARDED_LIST_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

// ── re-export Treasury custody apply (dùng trong 03_onboard) ────
export { applyCustodySeed, seedPolicyId };

// ── output state files ─────────────────────────────────────────

export const REGISTRY_PATH = resolve(__dirname, "registry.json");
export const ONBOARDED_PATH = resolve(__dirname, "onboarded.json");

export interface RegistryState {
  network:           Network;
  registryAuthority: string;
  authoritySource:   string;
  beaconPolicy:      string;
  registryHash:      string;
  registryAddress:   string;
}

export async function saveRegistry(state: RegistryState): Promise<void> {
  await writeFile(REGISTRY_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function loadRegistry(): Promise<RegistryState> {
  try {
    return JSON.parse(await readFile(REGISTRY_PATH, "utf8")) as RegistryState;
  } catch {
    throw new Error(`chưa có registry.json (${REGISTRY_PATH}) — chạy 'npm run deploy-registry' trước.`);
  }
}

export async function saveOnboarded(state: unknown): Promise<void> {
  await writeFile(ONBOARDED_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function explorerTx(hash: string): string {
  return `https://${NETWORK.toLowerCase()}.cardanoscan.io/transaction/${hash}`;
}
