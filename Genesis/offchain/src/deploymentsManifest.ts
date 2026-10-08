// deploymentsManifest — tệp định danh deploy MÁY ĐỌC ĐƯỢC theo mạng (`deployments/<mạng>.json`).
//
// VÌ SAO CÓ TỆP NÀY:
//   Bên tiêu thụ ngoài kho (app di động vendor tệp ở commit ghim, backend, bên thứ ba) không
//   import được TypeScript của kho này. Chúng cần một tệp JSON, sinh TẤT ĐỊNH từ đúng các nguồn
//   mà mã trong kho đang dùng, và một phép kiểm đỏ khi tệp đã commit lệch khỏi nguồn.
//
// NGUỒN (đọc bằng mã, không chép tay):
//   • `LAMP_POLICY_REGISTRY` + `activeLampPolicyId` (`./lampPolicies.ts`) — policy LAMP/tLAMP + trạng thái.
//   • `LAMP_MAINNET` (`./deployed.ts`) — bản ghi mainnet đầy đủ, kể cả `closure`.
//   • `MS_PER_EPOCH_BY_NETWORK` + `WINDOW_ORIGIN_MS_BY_NETWORK` (`Utils/src/index.ts`) — đồng hồ cửa sổ.
//   • `Genesis/deployed/preprod-oneshot-14param-final.wiring.json` — phần BẤT BIẾN của cụm Preprod
//     đang chạy, trích MỘT LẦN từ tệp trạng thái gitignored của lượt đúc. Bộ sinh KHÔNG BAO GIỜ đọc
//     tệp trạng thái đó (CI không có nó).
//
// LUẬT TRẠNG THÁI cho bên tiêu thụ: chỉ dựng giao dịch MỚI với `ACTIVE`; đọc số dư / rút phần cũ
// với `ACTIVE ∪ SUPERSEDED`; gặp `PENDING` thì NÉM — nó chưa có định danh.
//
// Hàm ở đây THUẦN: không đọc đĩa, không mạng, không đồng hồ. CLI ghi tệp ở
// `Genesis/scripts/emit_deployments.ts`.

import { MS_PER_EPOCH_BY_NETWORK, WINDOW_ORIGIN_MS_BY_NETWORK, type Network } from "../../../Utils/src/index.js";
import { LAMP_MAINNET, type LampNetwork } from "./deployed.js";
import { LAMP_POLICY_REGISTRY, activeLampPolicyId, type LampPolicyRecord } from "./lampPolicies.js";
import preprodFinalWiring from "../../deployed/preprod-oneshot-14param-final.wiring.json" with { type: "json" };

// ─────────────────────────────────────────────────────────────────────────────
// Hình dạng
// ─────────────────────────────────────────────────────────────────────────────

export const DEPLOYMENTS_SCHEMA_VERSION = 1 as const;

/** Enum ĐÓNG. Thêm vai = sửa cả mảng này lẫn `deployments/schema.json` (bài kiểm so hai bên). */
export const DEPLOYMENT_ROLES = [
  "lamp-token",
  "supply-marker",
  "registry-marker",
  "meter-marker",
  "treasury-marker",
  "beacon-marker",
  "reserve-custody-nft",
  "governance-pointer",
  "supply-state",
  "registry",
  "distribution-treasury",
  "claim-account",
  "claim-account-nft",
  "beacon",
  "faucet",
  "lock-vault",
  "treasury-custody",
] as const;
export type DeploymentRole = (typeof DEPLOYMENT_ROLES)[number];

export const DEPLOYMENT_STATUSES = ["ACTIVE", "SUPERSEDED", "PENDING"] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export interface DeploymentRecord {
  id: string;
  role: DeploymentRole;
  cluster: string;
  status: DeploymentStatus;
  supersededBy: string | null;
  policyId: string | null;
  assetName: string | null;
  scriptHash: string | null;
  address: string | null;
  params: Record<string, string>;
  mintClosed?: boolean;
  evidence: string[];
}

export interface DeploymentsManifest {
  schemaVersion: 1;
  network: LampNetwork;
  networkMagic: number;
  clock: { msPerEpoch: string; windowOriginMs: string | null };
  records: DeploymentRecord[];
}

/** Thứ tự khoá cố định — bộ sinh dựng đối tượng theo đúng thứ tự này, bộ kiểm đòi đúng tập này. */
export const MANIFEST_KEYS = ["schemaVersion", "network", "networkMagic", "clock", "records"] as const;
export const CLOCK_KEYS = ["msPerEpoch", "windowOriginMs"] as const;
export const RECORD_KEYS = [
  "id", "role", "cluster", "status", "supersededBy", "policyId", "assetName",
  "scriptHash", "address", "params", "mintClosed", "evidence",
] as const;
const RECORD_OPTIONAL_KEYS: ReadonlySet<string> = new Set(["mintClosed"]);

export const DEPLOYMENTS_NETWORKS: readonly LampNetwork[] = ["mainnet", "preprod", "preview"];

/**
 * Network magic theo mạng — hằng giao thức Cardano (cấu hình nút chính chủ:
 * book.world.dev.cardano.org/environments: mainnet 764824073, preprod 1, preview 2).
 * Kho chưa có nơi giữ nào khác cho giá trị này.
 */
const NETWORK_MAGIC: Readonly<Record<LampNetwork, number>> = {
  mainnet: 764824073,
  preprod: 1,
  preview: 2,
};

const UTILS_NETWORK: Readonly<Record<LampNetwork, Network>> = {
  mainnet: "Mainnet",
  preprod: "Preprod",
  preview: "Preview",
};

// ─────────────────────────────────────────────────────────────────────────────
// Lỗi
// ─────────────────────────────────────────────────────────────────────────────

export const DEPLOY_MANIFEST_ERRORS = {
  SHAPE: "DEPLOY-MANIFEST-001-SHAPE",
  SUPERSEDE: "DEPLOY-MANIFEST-002-SUPERSEDE",
  PENDING_HAS_ID: "DEPLOY-MANIFEST-003-PENDING-HAS-ID",
  ADDRESS_INVALID: "DEPLOY-MANIFEST-004-ADDRESS-INVALID",
  ADDRESS_HASH_MISMATCH: "DEPLOY-MANIFEST-005-ADDRESS-HASH-MISMATCH",
  DUPLICATE_ACTIVE: "DEPLOY-MANIFEST-006-DUPLICATE-ACTIVE",
  LAMP_REGISTRY_MISMATCH: "DEPLOY-MANIFEST-007-LAMP-REGISTRY-MISMATCH",
  ID_ORDER: "DEPLOY-MANIFEST-008-ID-ORDER",
  CHECK_DRIFT: "DEPLOY-MANIFEST-009-CHECK-DRIFT",
  SOURCE_INVALID: "DEPLOY-MANIFEST-010-SOURCE-INVALID",
} as const;
export type DeployManifestErrorCode = (typeof DEPLOY_MANIFEST_ERRORS)[keyof typeof DEPLOY_MANIFEST_ERRORS];

export class DeploymentsManifestError extends Error {
  readonly code: DeployManifestErrorCode;
  constructor(code: DeployManifestErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "DeploymentsManifestError";
    this.code = code;
  }
}

function fail(code: DeployManifestErrorCode, message: string): never {
  throw new DeploymentsManifestError(code, message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bech32 — giải địa chỉ Shelley (CIP-19) để đối chiếu payment credential với scriptHash.
// Viết tại chỗ (~40 dòng) để mô-đun không kéo thư viện nặng và chạy được ngoài Node.
// ─────────────────────────────────────────────────────────────────────────────

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= BECH32_GEN[i]!;
  }
  return chk >>> 0;
}

/** Giải bech32 (không phải bech32m); sai checksum / ký tự lạ / trộn hoa-thường ⇒ NÉM 004. */
export function decodeBech32(s: string): { hrp: string; bytes: Uint8Array } {
  if (s !== s.toLowerCase()) fail(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID, `"${s}" không viết thường toàn bộ`);
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep + 7 > s.length) fail(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID, `"${s}" thiếu phần hrp/dữ liệu`);
  const hrp = s.slice(0, sep);
  const data: number[] = [];
  for (const c of s.slice(sep + 1)) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v < 0) fail(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID, `"${s}" có ký tự ngoài bảng bech32: "${c}"`);
    data.push(v);
  }
  const hrpExpanded = [...hrp].map((c) => c.charCodeAt(0) >> 5)
    .concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  if (bech32Polymod(hrpExpanded.concat(data)) !== 1) {
    fail(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID, `"${s}" sai checksum bech32`);
  }
  const words = data.slice(0, -6);
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) {
    fail(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID, `"${s}" có bit đệm khác 0`);
  }
  return { hrp, bytes: Uint8Array.from(out) };
}

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export interface ShelleyAddressInfo {
  hrp: string;
  /** 0 = testnet, 1 = mainnet (CIP-19 nibble thấp của header). */
  networkId: number;
  /** Kiểu địa chỉ CIP-19 (nibble cao của header), 0..7 cho địa chỉ có payment credential. */
  addressType: number;
  paymentIsScript: boolean;
  paymentCredential: string;
}

/** Giải một địa chỉ Shelley có payment credential (kiểu 0..7). Kiểu khác / độ dài lạ ⇒ NÉM 004. */
export function decodeShelleyAddress(addr: string): ShelleyAddressInfo {
  const { hrp, bytes } = decodeBech32(addr);
  if (hrp !== "addr" && hrp !== "addr_test") {
    fail(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID, `"${addr}" có hrp "${hrp}", không phải addr/addr_test`);
  }
  const header = bytes[0];
  if (header === undefined) return fail(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID, `"${addr}" rỗng`);
  const addressType = header >> 4;
  const networkId = header & 0x0f;
  if (addressType > 7) {
    fail(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID, `"${addr}" kiểu ${addressType} không có payment credential`);
  }
  // Kiểu 0-3 mang stake credential 28 byte; 4 (pointer) dài thay đổi; 6-7 enterprise.
  const expectedLen = addressType <= 3 ? 57 : addressType >= 6 ? 29 : null;
  if ((expectedLen !== null && bytes.length !== expectedLen) || bytes.length < 29) {
    fail(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID, `"${addr}" dài ${bytes.length} byte, sai với kiểu ${addressType}`);
  }
  if ((hrp === "addr") !== (networkId === 1)) {
    fail(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID, `"${addr}": hrp "${hrp}" mâu thuẫn network id ${networkId}`);
  }
  return {
    hrp,
    networkId,
    addressType,
    paymentIsScript: (addressType & 1) === 1,
    paymentCredential: toHex(bytes.subarray(1, 29)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Kiểm — `validateDeployments`
// ─────────────────────────────────────────────────────────────────────────────

const HEX56 = /^[0-9a-f]{56}$/;
const ASSET_NAME = /^(?:[0-9a-f]{2}){0,32}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)?$/;
const CLUSTER_RE = /^[a-z0-9][a-z0-9-]*$/;
const PARAM_KEY_RE = /^[a-z][A-Za-z0-9]*$/;
const DECIMAL_RE = /^(?:0|[1-9][0-9]*)$/;
const EVIDENCE_RE = /^(?:tx:[0-9a-f]{64}|file:[A-Za-z0-9._\/-]+)$/;

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function exactKeys(o: Record<string, unknown>, required: readonly string[], optional: ReadonlySet<string>, where: string): void {
  for (const k of Object.keys(o)) {
    if (!required.includes(k)) fail(DEPLOY_MANIFEST_ERRORS.SHAPE, `${where}: khoá lạ "${k}"`);
  }
  for (const k of required) {
    if (!(k in o) && !optional.has(k)) fail(DEPLOY_MANIFEST_ERRORS.SHAPE, `${where}: thiếu khoá "${k}"`);
  }
}

function nullableMatch(v: unknown, re: RegExp, where: string): string | null {
  if (v === null) return null;
  if (typeof v !== "string" || !re.test(v)) fail(DEPLOY_MANIFEST_ERRORS.SHAPE, `${where}: giá trị sai hình dạng ${JSON.stringify(v)}`);
  return v as string;
}

/**
 * Kiểm một manifest (đã `JSON.parse`) theo `deployments/schema.json` CỘNG các luật chéo mà JSON
 * Schema không diễn được. Hợp lệ ⇒ trả lại chính nó với kiểu đã thu hẹp; hỏng ⇒ NÉM mã riêng.
 */
export function validateDeployments(obj: unknown): DeploymentsManifest {
  const E = DEPLOY_MANIFEST_ERRORS;
  if (!isObj(obj)) return fail(E.SHAPE, "gốc không phải object");
  exactKeys(obj, MANIFEST_KEYS, new Set(), "gốc");
  if (obj.schemaVersion !== DEPLOYMENTS_SCHEMA_VERSION) fail(E.SHAPE, `schemaVersion ${JSON.stringify(obj.schemaVersion)} ≠ 1`);
  const network = obj.network;
  if (typeof network !== "string" || !(DEPLOYMENTS_NETWORKS as readonly string[]).includes(network)) {
    return fail(E.SHAPE, `network lạ ${JSON.stringify(network)}`);
  }
  const net = network as LampNetwork;
  if (obj.networkMagic !== NETWORK_MAGIC[net]) fail(E.SHAPE, `networkMagic ${JSON.stringify(obj.networkMagic)} ≠ ${NETWORK_MAGIC[net]} của ${net}`);
  const clock = obj.clock;
  if (!isObj(clock)) return fail(E.SHAPE, "clock không phải object");
  exactKeys(clock, CLOCK_KEYS, new Set(), "clock");
  if (typeof clock.msPerEpoch !== "string" || !DECIMAL_RE.test(clock.msPerEpoch) || clock.msPerEpoch === "0") {
    fail(E.SHAPE, `clock.msPerEpoch sai ${JSON.stringify(clock.msPerEpoch)}`);
  }
  nullableMatch(clock.windowOriginMs, DECIMAL_RE, "clock.windowOriginMs");

  if (!Array.isArray(obj.records)) return fail(E.SHAPE, "records không phải mảng");
  const records = obj.records as unknown[];
  const testnet = net !== "mainnet";
  const seen = new Map<string, DeploymentRecord>();
  let prevId: string | null = null;

  for (const [i, raw] of records.entries()) {
    const where = `records[${i}]`;
    if (!isObj(raw)) return fail(E.SHAPE, `${where} không phải object`);
    exactKeys(raw, RECORD_KEYS, RECORD_OPTIONAL_KEYS, where);
    const id = raw.id;
    if (typeof id !== "string" || !ID_RE.test(id)) return fail(E.SHAPE, `${where}.id sai ${JSON.stringify(id)}`);
    if (prevId !== null && !(prevId < id)) fail(E.ID_ORDER, `${where}.id "${id}" trùng hoặc không tăng sau "${prevId}"`);
    prevId = id;
    const w = `record "${id}"`;
    if (typeof raw.role !== "string" || !(DEPLOYMENT_ROLES as readonly string[]).includes(raw.role)) fail(E.SHAPE, `${w}: role lạ ${JSON.stringify(raw.role)}`);
    if (typeof raw.cluster !== "string" || !CLUSTER_RE.test(raw.cluster)) fail(E.SHAPE, `${w}: cluster sai ${JSON.stringify(raw.cluster)}`);
    if (typeof raw.status !== "string" || !(DEPLOYMENT_STATUSES as readonly string[]).includes(raw.status)) fail(E.SHAPE, `${w}: status lạ ${JSON.stringify(raw.status)}`);
    nullableMatch(raw.supersededBy, ID_RE, `${w}.supersededBy`);
    const policyId = nullableMatch(raw.policyId, HEX56, `${w}.policyId`);
    nullableMatch(raw.assetName, ASSET_NAME, `${w}.assetName`);
    const scriptHash = nullableMatch(raw.scriptHash, HEX56, `${w}.scriptHash`);
    const address = raw.address;
    if (address !== null && typeof address !== "string") fail(E.SHAPE, `${w}.address không phải chuỗi/null`);
    const params = raw.params;
    if (!isObj(params)) return fail(E.SHAPE, `${w}.params không phải object`);
    const pkeys = Object.keys(params);
    for (const k of pkeys) {
      if (!PARAM_KEY_RE.test(k)) fail(E.SHAPE, `${w}.params khoá sai "${k}"`);
      if (typeof params[k] !== "string") fail(E.SHAPE, `${w}.params.${k} không phải chuỗi`);
    }
    if (pkeys.join("\u0000") !== [...pkeys].sort().join("\u0000")) fail(E.SHAPE, `${w}.params không sắp theo khoá`);
    if ("mintClosed" in raw) {
      if (typeof raw.mintClosed !== "boolean") fail(E.SHAPE, `${w}.mintClosed không phải boolean`);
      if (raw.role !== "lamp-token") fail(E.SHAPE, `${w}: mintClosed chỉ dành cho lamp-token`);
    }
    if (!Array.isArray(raw.evidence)) return fail(E.SHAPE, `${w}.evidence không phải mảng`);
    for (const ev of raw.evidence as unknown[]) {
      if (typeof ev !== "string" || !EVIDENCE_RE.test(ev)) fail(E.SHAPE, `${w}.evidence mục sai ${JSON.stringify(ev)}`);
    }
    if (raw.status !== "PENDING" && (raw.evidence as unknown[]).length === 0) fail(E.SHAPE, `${w}: thiếu evidence`);

    // ── PENDING ⇒ chưa có định danh nào ───────────────────────────────────────
    if (raw.status === "PENDING" && (policyId !== null || scriptHash !== null || address !== null)) {
      fail(E.PENDING_HAS_ID, `${w}: PENDING nhưng mang policyId/scriptHash/address`);
    }
    // ── supersededBy ≠ null ⇔ SUPERSEDED ─────────────────────────────────────
    if ((raw.supersededBy !== null) !== (raw.status === "SUPERSEDED")) {
      fail(E.SUPERSEDE, `${w}: status ${String(raw.status)} với supersededBy ${JSON.stringify(raw.supersededBy)}`);
    }
    // ── địa chỉ: hợp lệ, đúng mạng, payment credential là script, khớp scriptHash ──
    if (typeof address === "string") {
      const info = decodeShelleyAddress(address);
      if ((info.hrp === "addr_test") !== testnet) fail(E.ADDRESS_INVALID, `${w}: địa chỉ "${address}" sai mạng ${net}`);
      if (!info.paymentIsScript) fail(E.ADDRESS_HASH_MISMATCH, `${w}: payment credential của "${address}" là khoá, không phải script`);
      if (scriptHash !== null && info.paymentCredential !== scriptHash) {
        fail(E.ADDRESS_HASH_MISMATCH, `${w}: địa chỉ giải ra ${info.paymentCredential} ≠ scriptHash ${scriptHash}`);
      }
    }
    seen.set(id, raw as unknown as DeploymentRecord);
  }

  // ── supersededBy trỏ id có thật, cùng role, không vòng ─────────────────────
  for (const r of seen.values()) {
    if (r.supersededBy === null) continue;
    const visited = new Set<string>([r.id]);
    let cur: DeploymentRecord = r;
    while (cur.supersededBy !== null) {
      const next = seen.get(cur.supersededBy);
      if (next === undefined) fail(E.SUPERSEDE, `record "${cur.id}": supersededBy "${cur.supersededBy}" không có trong tệp`);
      const n = next as DeploymentRecord;
      if (n.role !== cur.role) fail(E.SUPERSEDE, `record "${cur.id}": bị thay bởi "${n.id}" khác role (${n.role})`);
      if (visited.has(n.id)) fail(E.SUPERSEDE, `record "${r.id}": chuỗi supersededBy có vòng qua "${n.id}"`);
      visited.add(n.id);
      cur = n;
    }
  }

  // ── ≤1 ACTIVE mỗi (role, cluster) ─────────────────────────────────────────
  const activeKey = new Map<string, string>();
  for (const r of seen.values()) {
    if (r.status !== "ACTIVE") continue;
    const k = `${r.role}\u0000${r.cluster}`;
    const other = activeKey.get(k);
    if (other !== undefined) fail(E.DUPLICATE_ACTIVE, `"${other}" và "${r.id}" cùng ACTIVE cho role ${r.role}, cluster ${r.cluster}`);
    activeKey.set(k, r.id);
  }

  // ── lamp-token ACTIVE == sổ policy; mainnet đóng ⇔ LAMP_MAINNET.closure ─────
  const activeTokens = [...seen.values()].filter((r) => r.role === "lamp-token" && r.status === "ACTIVE");
  const registryHasActive = LAMP_POLICY_REGISTRY.some((r) => r.network === net && r.status === "ACTIVE");
  const expected = registryHasActive ? activeLampPolicyId(net) : null;
  if (activeTokens.length !== (expected === null ? 0 : 1)) {
    fail(E.LAMP_REGISTRY_MISMATCH, `${net}: ${activeTokens.length} lamp-token ACTIVE, sổ policy có ${expected === null ? 0 : 1}`);
  }
  for (const t of activeTokens) {
    if (t.policyId !== expected) fail(E.LAMP_REGISTRY_MISMATCH, `${net}: lamp-token ACTIVE ${t.policyId} ≠ activeLampPolicyId ${expected}`);
  }
  for (const t of seen.values()) {
    if (t.role !== "lamp-token") continue;
    const closed = net === "mainnet" && LAMP_MAINNET.closure !== undefined && t.policyId === LAMP_MAINNET.policyId;
    if ((t.mintClosed === true) !== closed) {
      fail(E.LAMP_REGISTRY_MISMATCH, `record "${t.id}": mintClosed ${String(t.mintClosed)} lệch LAMP_MAINNET.closure`);
    }
  }
  return obj as unknown as DeploymentsManifest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sinh — `buildDeployments`
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_FROM_REGISTRY: Readonly<Record<LampPolicyRecord["status"], DeploymentStatus>> = {
  ACTIVE: "ACTIVE",
  SUPERSEDED: "SUPERSEDED",
  "PENDING-MINT": "PENDING",
};

/** Dựng bản ghi với khoá theo ĐÚNG thứ tự `RECORD_KEYS`; `params` sắp theo khoá. */
function rec(r: {
  id: string; role: DeploymentRole; cluster: string; status: DeploymentStatus; supersededBy?: string | null;
  policyId?: string | null; assetName?: string | null; scriptHash?: string | null; address?: string | null;
  params?: Record<string, string>; mintClosed?: boolean; evidence: string[];
}): DeploymentRecord {
  const params: Record<string, string> = {};
  for (const k of Object.keys(r.params ?? {}).sort()) params[k] = r.params![k]!;
  const out: DeploymentRecord = {
    id: r.id,
    role: r.role,
    cluster: r.cluster,
    status: r.status,
    supersededBy: r.supersededBy ?? null,
    policyId: r.policyId ?? null,
    assetName: r.assetName ?? null,
    scriptHash: r.scriptHash ?? null,
    address: r.address ?? null,
    params,
    evidence: r.evidence,
  };
  if (r.mintClosed === undefined) return out;
  // chèn mintClosed ngay trước evidence để giữ thứ tự RECORD_KEYS
  const { evidence, ...head } = out;
  return { ...head, mintClosed: r.mintClosed, evidence };
}

const tokenRecordId = (registryId: string): string => `${registryId}/lamp-token`;

const LAMP_POLICIES_FILE = "file:Genesis/offchain/src/lampPolicies.ts";
const DEPLOYED_FILE = "file:Genesis/offchain/src/deployed.ts";
const PREPROD_WIRING_FILE = "file:Genesis/deployed/preprod-oneshot-14param-final.wiring.json";

/** Mọi bản ghi lamp-token của một mạng, sinh từ sổ policy (kể cả SUPERSEDED/PENDING). */
function lampTokenRecords(net: LampNetwork): DeploymentRecord[] {
  return LAMP_POLICY_REGISTRY.filter((r) => r.network === net).map((r) => {
    const txs = r.evidence.flatMap((e) => e.match(/\b[0-9a-f]{64}\b/g) ?? []);
    return rec({
      id: tokenRecordId(r.id),
      role: "lamp-token",
      cluster: r.id,
      status: STATUS_FROM_REGISTRY[r.status],
      supersededBy: r.supersededBy === null ? null : tokenRecordId(r.supersededBy),
      policyId: r.policyId,
      assetName: r.assetName,
      params: { anchor: r.anchor, mintParamCount: String(r.mintParamCount) },
      ...(net === "mainnet" && r.policyId === LAMP_MAINNET.policyId && LAMP_MAINNET.closure !== undefined
        ? { mintClosed: true }
        : {}),
      evidence: [LAMP_POLICIES_FILE, ...[...new Set(txs)].map((t) => `tx:${t}`)],
    });
  });
}

/** Giải `581c<28 byte>` / bytestring CBOR ngắn (major type 2) thành hex; hình dạng khác ⇒ NÉM. */
function cborBytesHex(cbor: string, where: string): string {
  const head = parseInt(cbor.slice(0, 2), 16);
  let len: number;
  let body: string;
  if (head >= 0x40 && head <= 0x57) {
    len = head - 0x40;
    body = cbor.slice(2);
  } else if (head === 0x58) {
    len = parseInt(cbor.slice(2, 4), 16);
    body = cbor.slice(4);
  } else {
    return fail(DEPLOY_MANIFEST_ERRORS.SOURCE_INVALID, `${where}: CBOR "${cbor}" không phải bytestring`);
  }
  if (body.length !== len * 2 || !/^[0-9a-f]*$/.test(body)) {
    fail(DEPLOY_MANIFEST_ERRORS.SOURCE_INVALID, `${where}: CBOR "${cbor}" sai độ dài`);
  }
  return body;
}

function mainnetParam(name: string): string {
  const p = LAMP_MAINNET.mintParams.find((x) => x.name === name);
  if (p === undefined) return fail(DEPLOY_MANIFEST_ERRORS.SOURCE_INVALID, `LAMP_MAINNET.mintParams thiếu "${name}"`);
  return p.cborHex;
}

function mainnetRecords(): DeploymentRecord[] {
  const cluster = LAMP_POLICY_REGISTRY.find((r) => r.network === "mainnet" && r.policyId === LAMP_MAINNET.policyId)?.id;
  if (cluster === undefined) return fail(DEPLOY_MANIFEST_ERRORS.SOURCE_INVALID, "sổ policy không có bản ghi cho LAMP_MAINNET.policyId");
  const closure = LAMP_MAINNET.closure;
  const closureTx = closure === undefined ? [] : [`tx:${closure.closeMintTx}`, `tx:${closure.closeLockTx}`];
  const out: DeploymentRecord[] = [
    rec({
      id: `${cluster}/supply-marker`, role: "supply-marker", cluster, status: "ACTIVE",
      policyId: cborBytesHex(mainnetParam("thread_nft_policy"), "thread_nft_policy"),
      assetName: cborBytesHex(mainnetParam("thread_nft_name"), "thread_nft_name"),
      evidence: [DEPLOYED_FILE],
    }),
    rec({
      id: `${cluster}/supply-state`, role: "supply-state", cluster, status: "ACTIVE",
      scriptHash: LAMP_MAINNET.supplyStateHash, address: LAMP_MAINNET.supplyStateAddress,
      evidence: [DEPLOYED_FILE],
    }),
    rec({
      id: `${cluster}/distribution-treasury`, role: "distribution-treasury", cluster, status: "ACTIVE",
      scriptHash: LAMP_MAINNET.khoHash, address: LAMP_MAINNET.khoAddress,
      evidence: [DEPLOYED_FILE, ...closureTx],
    }),
  ];
  if (closure !== undefined) {
    // scriptHash để null: kho chỉ có ĐỊA CHỈ của lock_vault; suy hash từ chính địa chỉ đó rồi so
    // lại với nó là một phép kiểm vòng tròn, không phải bằng chứng.
    out.push(rec({
      id: `${cluster}/lock-vault`, role: "lock-vault", cluster, status: "ACTIVE",
      address: closure.lockVaultAddress,
      evidence: [DEPLOYED_FILE, `tx:${closure.closeLockTx}`],
    }));
  }
  return out;
}

// ── Nguồn wiring Preprod: kiểm hình dạng trước khi dùng ──────────────────────

interface PreprodWiring {
  registryId: string;
  network: string;
  genesisRef: { txHash: string; outputIndex: number };
  tokenName: string;
  committee: { pkhs: string[]; threshold: string };
  markers: { threadPid: string; regPid: string; metPid: string; khoPid: string; beaconPid: string };
  lampPid: string;
  lampUnit: string;
  threadUnit: string;
  regUnit: string;
  metUnit: string;
  khoUnit: string;
  beaconUnit: string;
  reserveKhoPid: string;
  reserveKhoName: string;
  ssHash: string;
  ssAddr: string;
  regAddr: string;
  treHash: string;
  treAddr: string;
  claimHash: string;
  accountPid: string;
  beaconHash: string;
  beaconAddr: string;
  caps: { dist: string; reserve: string };
  reserve: { pointer: { policy: string; assetName: string; seedRef: { txHash: string; outputIndex: number };
    changeDelayMs: string; holderAddress: string } };
  treasuryCustody: { scriptHash: string; address: string };
  tx: { genesis: string; custodySeed: string; pointerMint: string; vest: string };
  observed: { at: string; how: string };
}

function src(cond: boolean, msg: string): void {
  if (!cond) fail(DEPLOY_MANIFEST_ERRORS.SOURCE_INVALID, `preprod wiring: ${msg}`);
}

/** Kiểm nguồn wiring; trả lại với kiểu đã thu hẹp. Xuất ra để bài kiểm dùng được. */
export function parsePreprodWiring(raw: unknown): PreprodWiring {
  src(isObj(raw), "không phải object");
  const w = raw as PreprodWiring;
  const hex56 = (v: unknown, k: string) => src(typeof v === "string" && HEX56.test(v), `${k} không phải hex56`);
  const hex64 = (v: unknown, k: string) => src(typeof v === "string" && /^[0-9a-f]{64}$/.test(v), `${k} không phải tx hash`);
  src(w.network === "Preprod", `network ${JSON.stringify(w.network)} ≠ "Preprod"`);
  src(typeof w.registryId === "string", "thiếu registryId");
  src(isObj(w.markers) && isObj(w.committee) && isObj(w.caps) && isObj(w.reserve) && isObj(w.reserve?.pointer)
    && isObj(w.treasuryCustody) && isObj(w.tx) && isObj(w.genesisRef), "thiếu khối con");
  for (const k of ["threadPid", "regPid", "metPid", "khoPid", "beaconPid"] as const) hex56(w.markers[k], `markers.${k}`);
  for (const k of ["lampPid", "reserveKhoPid", "ssHash", "treHash", "claimHash", "accountPid", "beaconHash"] as const) hex56(w[k], k);
  hex56(w.reserve.pointer.policy, "reserve.pointer.policy");
  hex56(w.treasuryCustody.scriptHash, "treasuryCustody.scriptHash");
  for (const k of ["genesis", "custodySeed", "pointerMint", "vest"] as const) hex64(w.tx[k], `tx.${k}`);
  hex64(w.genesisRef.txHash, "genesisRef.txHash");
  hex64(w.reserve.pointer.seedRef?.txHash, "reserve.pointer.seedRef.txHash");
  src(Array.isArray(w.committee.pkhs) && w.committee.pkhs.length > 0, "committee.pkhs rỗng");
  w.committee.pkhs.forEach((p, i) => hex56(p, `committee.pkhs[${i}]`));
  for (const v of [w.committee.threshold, w.caps.dist, w.caps.reserve, w.reserve.pointer.changeDelayMs]) {
    src(typeof v === "string" && DECIMAL_RE.test(v), `số ${JSON.stringify(v)} không phải chuỗi thập phân`);
  }
  for (const k of ["tokenName", "reserveKhoName"] as const) src(typeof w[k] === "string" && ASSET_NAME.test(w[k]), `${k} sai`);
  src(ASSET_NAME.test(w.reserve.pointer.assetName), "reserve.pointer.assetName sai");
  for (const v of [w.ssAddr, w.regAddr, w.treAddr, w.beaconAddr, w.reserve.pointer.holderAddress, w.treasuryCustody.address]) {
    src(typeof v === "string", "địa chỉ không phải chuỗi");
  }
  return w;
}

/** Tách `unit` thành (policy, name) và đòi khớp policy đã biết. */
function nameOfUnit(unit: string, policy: string, where: string): string {
  src(typeof unit === "string" && unit.startsWith(policy) && ASSET_NAME.test(unit.slice(56)), `${where} không bắt đầu bằng ${policy}`);
  return unit.slice(56);
}

const outRef = (r: { txHash: string; outputIndex: number }): string => `${r.txHash}#${r.outputIndex}`;

function preprodClusterRecords(): DeploymentRecord[] {
  const w = parsePreprodWiring(preprodFinalWiring);
  const cluster = w.registryId;
  const reg = LAMP_POLICY_REGISTRY.find((r) => r.id === cluster);
  src(reg !== undefined && reg.network === "preprod", `registryId "${cluster}" không có trong sổ policy Preprod`);
  src(reg!.policyId === w.lampPid, `lampPid ${w.lampPid} ≠ sổ policy ${String(reg!.policyId)}`);
  src(nameOfUnit(w.lampUnit, w.lampPid, "lampUnit") === w.tokenName, "lampUnit lệch tokenName");
  // Cụm không ACTIVE thì hạ tầng của nó cũng không ACTIVE — nhưng chưa có bản thay để trỏ tới.
  src(reg!.status === "ACTIVE", `cụm "${cluster}" không còn ACTIVE trong sổ policy: cần bản ghi hạ tầng của cụm thay thế`);

  const genesis = `tx:${w.tx.genesis}`;
  const wiringEv = [PREPROD_WIRING_FILE, genesis];
  // Ủy ban (committee) là THAM SỐ đã nướng vào claim_account_nft · claim_account · treasury · beacon
  // (`Genesis/scripts/_canonical_v2.ts::deriveWiring`, `canonicalCommittee(o.pkh)`): đổi nó là đổi
  // script hash. Nên nó thuộc định danh hợp đồng, không phải chỉ là khoá vận hành, và ghi ở `params`.
  const committee = { committee: w.committee.pkhs.join(","), committeeThreshold: w.committee.threshold };
  const base = { cluster, status: "ACTIVE" as const };
  return [
    rec({ ...base, id: `${cluster}/supply-marker`, role: "supply-marker", policyId: w.markers.threadPid,
      assetName: nameOfUnit(w.threadUnit, w.markers.threadPid, "threadUnit"),
      params: { genesisRef: outRef(w.genesisRef) }, evidence: wiringEv }),
    rec({ ...base, id: `${cluster}/registry-marker`, role: "registry-marker", policyId: w.markers.regPid,
      assetName: nameOfUnit(w.regUnit, w.markers.regPid, "regUnit"),
      params: { genesisRef: outRef(w.genesisRef) }, evidence: wiringEv }),
    rec({ ...base, id: `${cluster}/meter-marker`, role: "meter-marker", policyId: w.markers.metPid,
      assetName: nameOfUnit(w.metUnit, w.markers.metPid, "metUnit"),
      params: { genesisRef: outRef(w.genesisRef) }, evidence: wiringEv }),
    rec({ ...base, id: `${cluster}/treasury-marker`, role: "treasury-marker", policyId: w.markers.khoPid,
      assetName: nameOfUnit(w.khoUnit, w.markers.khoPid, "khoUnit"),
      params: { genesisRef: outRef(w.genesisRef) }, evidence: wiringEv }),
    rec({ ...base, id: `${cluster}/beacon-marker`, role: "beacon-marker", policyId: w.markers.beaconPid,
      assetName: nameOfUnit(w.beaconUnit, w.markers.beaconPid, "beaconUnit"),
      params: { genesisRef: outRef(w.genesisRef) }, evidence: wiringEv }),
    rec({ ...base, id: `${cluster}/reserve-custody-nft`, role: "reserve-custody-nft", policyId: w.reserveKhoPid,
      assetName: w.reserveKhoName, evidence: [PREPROD_WIRING_FILE, `tx:${w.tx.custodySeed}`] }),
    // `governance_pointer` là script đa mục đích: NFT con trỏ nằm ở `Script(pointer_policy)`
    // (`Genesis/scripts/_genesisReservePlacement.ts::txPMarkerTargets`) ⇒ scriptHash = policy.
    rec({ ...base, id: `${cluster}/governance-pointer`, role: "governance-pointer",
      policyId: w.reserve.pointer.policy, assetName: w.reserve.pointer.assetName,
      scriptHash: w.reserve.pointer.policy, address: w.reserve.pointer.holderAddress,
      params: { changeDelayMs: w.reserve.pointer.changeDelayMs, seedRef: outRef(w.reserve.pointer.seedRef) },
      evidence: [PREPROD_WIRING_FILE, `tx:${w.tx.pointerMint}`] }),
    rec({ ...base, id: `${cluster}/supply-state`, role: "supply-state", scriptHash: w.ssHash, address: w.ssAddr,
      params: { distCap: w.caps.dist, reserveCap: w.caps.reserve }, evidence: wiringEv }),
    // `oneshot_nft` là PlutusV3 một-script ⇒ hash nhánh spend ≡ policy id của REGISTRY marker.
    rec({ ...base, id: `${cluster}/registry`, role: "registry", scriptHash: w.markers.regPid, address: w.regAddr,
      evidence: wiringEv }),
    rec({ ...base, id: `${cluster}/distribution-treasury`, role: "distribution-treasury", scriptHash: w.treHash,
      address: w.treAddr, params: committee, evidence: [...wiringEv, `tx:${w.tx.vest}`] }),
    rec({ ...base, id: `${cluster}/claim-account`, role: "claim-account", scriptHash: w.claimHash,
      params: committee, evidence: wiringEv }),
    rec({ ...base, id: `${cluster}/claim-account-nft`, role: "claim-account-nft", policyId: w.accountPid,
      params: committee, evidence: wiringEv }),
    rec({ ...base, id: `${cluster}/beacon`, role: "beacon", scriptHash: w.beaconHash, address: w.beaconAddr,
      params: committee, evidence: wiringEv }),
    rec({ ...base, id: `${cluster}/treasury-custody`, role: "treasury-custody", scriptHash: w.treasuryCustody.scriptHash,
      address: w.treasuryCustody.address, evidence: [PREPROD_WIRING_FILE, `tx:${w.tx.custodySeed}`] }),
  ];
}

/** Sinh manifest của một mạng. Thuần, tất định; tự chạy `validateDeployments` trước khi trả. */
export function buildDeployments(network: LampNetwork): DeploymentsManifest {
  if (!(DEPLOYMENTS_NETWORKS as readonly string[]).includes(network)) {
    return fail(DEPLOY_MANIFEST_ERRORS.SOURCE_INVALID, `mạng lạ ${JSON.stringify(network)}`);
  }
  const u = UTILS_NETWORK[network];
  const origin = WINDOW_ORIGIN_MS_BY_NETWORK[u];
  const records = [
    ...lampTokenRecords(network),
    ...(network === "mainnet" ? mainnetRecords() : []),
    ...(network === "preprod" ? preprodClusterRecords() : []),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const manifest: DeploymentsManifest = {
    schemaVersion: DEPLOYMENTS_SCHEMA_VERSION,
    network,
    networkMagic: NETWORK_MAGIC[network],
    clock: {
      msPerEpoch: MS_PER_EPOCH_BY_NETWORK[u].toString(),
      windowOriginMs: origin === undefined ? null : origin.toString(),
    },
    records,
  };
  return validateDeployments(manifest);
}

/** Văn bản tệp đúng từng byte: JSON thụt 2, xuống dòng cuối. */
export function serializeDeployments(m: DeploymentsManifest): string {
  return JSON.stringify(m, null, 2) + "\n";
}
