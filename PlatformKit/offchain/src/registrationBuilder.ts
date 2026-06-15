// PlatformKit registrationBuilder — dựng dữ liệu tx ĐĂNG KÝ + CẬP NHẬT một platform
// vào Registry on-chain. Mirror validators/registry_beacon.ak + registry.ak.
//
// planRegister: mint 1 beacon NFT (registry_beacon, name=platform_id) + 1 output entry
//   UTxO ở registry script address mang NFT + datum PlatformEntry well-formed.
//   Tự kiểm entry_well_formed (gương R-WF) + R-NAME fail-fast TRƯỚC khi build tx.
//   R-BIND (MỚI): tx PHẢI reference 1 custody UTxO mang đúng 1 NFT authenticity
//   (entry.seed_policy, entry.instance_id) Ở ĐÚNG Script(entry.custody_hash). planRegister
//   nhận custodyUtxo + gương R-BIND fail-fast (NFT qty==1 & address script hash==custody_hash).
//
// planUpdateEntry: cập nhật field khả biến. Tự kiểm identity_preserved (U-ID) +
//   mutable_fields_valid (U-MUT) + giữ beacon NFT (U-NFT) fail-fast.
//   U-TERMINAL (MỚI): reject nếu entryIn.status === "Retired" (Retired là trạng thái CUỐI,
//   không revive — gương expect entry_in.status != Retired).
//
// Builder THUẦN (không cần lucid) — trả "plan" (datum + value map + redeemer cbor +
// nft unit). Caller (deploy script) dựng tx thật từ plan. Tách thuần để test trực tiếp.

import type { AssetKey, PlatformConfig, PlatformEntry, PlatformStatus } from "./types.js";
import {
  platformEntryToCbor, registerPlatformRedeemerToCbor, updateEntryRedeemerToCbor,
} from "./registryDatum.js";

// ── Value map (mirror Treasury AssetMap "policy|name" → bigint) ─────────────
export type AssetMap = Record<string, bigint>;

const LOVELACE_KEY = "|";

function normHex(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return h.toLowerCase();
}

/** Khóa AssetMap cho beacon NFT (policy|name). policy="" → lovelace key "|". */
export function nftKey(policy: string, name: string): string {
  const p = normHex(policy);
  if (p === "") return LOVELACE_KEY;
  return `${p}|${normHex(name)}`;
}

/** Quantity của (policy, name) trong một AssetMap. Khớp khoá "policy|name" của AssetMap. */
export function quantityOf(value: AssetMap, policy: string, name: string): bigint {
  return value[nftKey(policy, name)] ?? 0n;
}

// ── CustodyRef + R-BIND mirror ──────────────────────────────────────────────
// Custody UTxO mà tx đăng ký PHẢI reference (readFrom). Off-chain chỉ cần đủ để gương
// R-BIND: value (kiểm NFT authenticity) + payment credential script hash của địa chỉ
// (kiểm == entry.custody_hash). Caller suy từ bước seed (Treasury planSeed → custodyValue
// ở Script(custodyHash)).

export interface CustodyRef {
  /** value UTxO custody (khoá AssetMap "policy|name", lovelace "|"). */
  value: AssetMap;
  /** payment credential của địa chỉ custody = SCRIPT HASH (hex 28-byte). Gương custody_hash. */
  scriptHash: string;
  /** ngữ cảnh tham chiếu (tuỳ chọn — caller giữ để readFrom khi build tx thật). */
  txHash?: string;
  outputIndex?: number;
}

/**
 * Gương R-BIND (registry_beacon.ak): custody ref PHẢI mang đúng 1 NFT authenticity
 * (seed_policy, instance_id) Ở ĐÚNG Script(custody_hash). Trả {ok, reason} thay vì ném —
 * dùng được cả ở builder (fail-fast) lẫn audit query.
 */
export function verifyCustodyBinding(
  custody: CustodyRef, seedPolicy: string, instanceId: string, custodyHash: string,
): { ok: boolean; reason?: string } {
  const qty = quantityOf(custody.value, seedPolicy, instanceId);
  if (qty !== 1n) {
    return {
      ok: false,
      reason: `custody UTxO mang ${qty} NFT (seed_policy=${normHex(seedPolicy)}, `
        + `instance_id=${normHex(instanceId)}) — kỳ vọng đúng 1 (R-BIND)`,
    };
  }
  if (normHex(custody.scriptHash) !== normHex(custodyHash)) {
    return {
      ok: false,
      reason: `custody address script hash (${normHex(custody.scriptHash)}) != `
        + `entry.custody_hash (${normHex(custodyHash)}) — custody không khớp (R-BIND)`,
    };
  }
  return { ok: true };
}

// ── entry_well_formed (gương R-WF — platform.ak) ───────────────────────────
// e.platform_id != "" && instance_id != "" && custody_hash != "" && governance_ref != ""
//   && seed_policy != "" && accepted_assets != [] && 0 ≤ cut_bps ≤ 10000
//   && created_epoch ≥ 0 && status == Active

export function entryWellFormed(e: PlatformEntry): boolean {
  return e.platform_id !== "" && e.instance_id !== "" && e.custody_hash !== ""
    && e.governance_ref !== "" && e.seed_policy !== "" && e.accepted_assets.length > 0
    && e.cut_bps >= 0n && e.cut_bps <= 10000n
    && e.created_epoch >= 0n && e.status === "Active";
}

// ── identity_preserved (gương U-ID) ─────────────────────────────────────────
// 5 field bất biến: platform_id, instance_id, custody_hash, seed_policy, created_epoch.

export function identityPreserved(a: PlatformEntry, b: PlatformEntry): boolean {
  return normHex(a.platform_id) === normHex(b.platform_id)
    && normHex(a.instance_id) === normHex(b.instance_id)
    && normHex(a.custody_hash) === normHex(b.custody_hash)
    && normHex(a.seed_policy) === normHex(b.seed_policy)
    && a.created_epoch === b.created_epoch;
}

// ── mutable_fields_valid (gương U-MUT) ──────────────────────────────────────
// governance_ref != "" && accepted_assets != [] && 0 ≤ cut_bps ≤ 10000.

export function mutableFieldsValid(e: PlatformEntry): boolean {
  return e.governance_ref !== "" && e.accepted_assets.length > 0
    && e.cut_bps >= 0n && e.cut_bps <= 10000n;
}

// ── planRegister ─────────────────────────────────────────────────────────────

export interface RegisterPlan {
  /** Datum PlatformEntry well-formed cho output entry UTxO. */
  entry: PlatformEntry;
  /** CBOR inline datum (Data.to(PlatformEntry)). */
  entryDatumCbor: string;
  /** beacon NFT policy (registry_beacon đã apply authority). */
  beaconPolicy: string;
  /** asset name NFT = platform_id (hex). */
  nftName: string;
  /** unit NFT = policy ‖ name (hex). */
  nftUnit: string;
  /** value tối thiểu output entry — chứa đúng 1 beacon NFT (caller thêm min-ADA). */
  entryValue: AssetMap;
  /** redeemer mint (RegisterPlatform = Constr(0,[])). */
  mintRedeemerCbor: string;
  /** key-hash PHẢI ký tx (registry_authority — R-SIG). */
  requiredSigner: string;
  /** custody UTxO tx PHẢI readFrom (R-BIND). Caller dùng txHash/outputIndex để reference. */
  custodyRef: CustodyRef;
  summary: string;
}

export interface RegisterParams {
  config: PlatformConfig;
  /** beacon NFT policy = hash(registry_beacon(authority)). Caller cấp sau aiken build+apply. */
  beaconPolicy: string;
  /** custody script hash của platform (custody.ak đã apply) — vào entry.custody_hash. */
  custodyHash: string;
  /** seed_policy custody (custody_seed đã apply genesisRef) — vào entry.seed_policy.
   *  Nếu config.seedPolicy set thì ưu tiên config (đã biết trước). */
  seedPolicy: string;
  /** epoch đăng ký (created_epoch) ≥ 0. */
  createdEpoch: bigint;
  /** custody UTxO tx PHẢI reference (R-BIND). PHẢI mang đúng 1 NFT authenticity
   *  (seed_policy, instance_id) Ở Script(custodyHash). Suy từ bước SEED đã submit (custody
   *  vừa tạo). THIẾU/SAI → planRegister ném REG-BIND fail-fast. */
  custodyUtxo: CustodyRef;
}

/**
 * Dựng plan đăng ký platform = mint beacon NFT + output entry UTxO well-formed.
 * Tự kiểm R-WF (entryWellFormed) + R-NAME (entry.platform_id == nftName) fail-fast.
 */
export function planRegister(params: RegisterParams): RegisterPlan {
  const { config, beaconPolicy, custodyHash, createdEpoch, custodyUtxo } = params;
  const seedPolicy = config.seedPolicy ?? params.seedPolicy;

  const platformId = normHex(config.platformId);
  const nftName = platformId;                       // R-NAME: NFT name == platform_id.
  const beaconPol = normHex(beaconPolicy);
  const nftUnit = beaconPol + nftName;

  // Đăng ký LUÔN khởi tạo status Active (R-WF ép status == Active).
  const entry: PlatformEntry = {
    platform_id:     platformId,
    instance_id:     normHex(config.instanceId),
    custody_hash:    normHex(custodyHash),
    seed_policy:     normHex(seedPolicy),
    governance_ref:  normHex(config.governanceRef),
    accepted_assets: config.acceptedAssets.map(normAssetKey),
    cut_bps:         config.cutBps,
    created_epoch:   createdEpoch,
    status:          "Active",
  };

  // R-NAME (off-chain gương): entry.platform_id == nftName.
  if (entry.platform_id !== nftName) {
    throw new Error(`REG-NAME: entry.platform_id (${entry.platform_id}) != NFT name (${nftName})`);
  }
  // R-WF (off-chain gương đủ): well-formed trước khi build tx.
  if (!entryWellFormed(entry)) {
    throw new Error(
      "REG-WF: PlatformEntry không well-formed (kiểm id/instance/custody/gov/seed khác rỗng, "
      + "accepted không rỗng, cut_bps∈[0,10000], created_epoch≥0, status=Active)",
    );
  }

  // R-BIND (off-chain gương): custody ref PHẢI mang đúng 1 NFT authenticity
  // (entry.seed_policy, entry.instance_id) Ở Script(entry.custody_hash). On-chain ép qua
  // reference_input → tx PHẢI readFrom UTxO này. Custody phải seed TRƯỚC khi đăng ký.
  if (!custodyUtxo) {
    throw new Error(
      "REG-BIND: thiếu custodyUtxo — RegisterPlatform PHẢI reference custody UTxO mang NFT "
      + "authenticity (seed custody TRƯỚC khi đăng ký)",
    );
  }
  const bind = verifyCustodyBinding(custodyUtxo, entry.seed_policy, entry.instance_id, entry.custody_hash);
  if (!bind.ok) {
    throw new Error(`REG-BIND: ${bind.reason}`);
  }

  const entryValue: AssetMap = { [nftKey(beaconPol, nftName)]: 1n };

  const summary = [
    `═══ Register Platform ═══`,
    `Platform id:  ${entry.platform_id}`,
    `Instance id:  ${entry.instance_id}`,
    `Custody hash: ${entry.custody_hash}`,
    `Seed policy:  ${entry.seed_policy}`,
    `Gov ref:      ${entry.governance_ref}`,
    `Cut bps:      ${entry.cut_bps}`,
    `Created epoch:${entry.created_epoch}`,
    `Accepted:     ${entry.accepted_assets.length} asset(s)`,
    `Beacon NFT:   ${nftUnit} (qty 1)`,
    `Custody ref:  ${custodyUtxo.txHash ?? "?"}#${custodyUtxo.outputIndex ?? "?"} `
      + `(readFrom — R-BIND: NFT ${normHex(seedPolicy)}|${entry.instance_id} @ Script(${entry.custody_hash}))`,
    `Authority:    ${normHex(config.registryAuthority)} (must sign)`,
  ].join("\n");

  return {
    entry,
    entryDatumCbor:   platformEntryToCbor(entry),
    beaconPolicy:     beaconPol,
    nftName,
    nftUnit,
    entryValue,
    mintRedeemerCbor: registerPlatformRedeemerToCbor(),
    requiredSigner:   normHex(config.registryAuthority),
    custodyRef:       custodyUtxo,
    summary,
  };
}

// ── planUpdateEntry ──────────────────────────────────────────────────────────

/** Field khả biến cho phép cập nhật (U-MUT). identity (5 field) KHÔNG đổi. */
export interface EntryChanges {
  status?:          PlatformStatus;
  governance_ref?:  string;       // hex
  accepted_assets?: AssetKey[];
  cut_bps?:         bigint;
}

export interface UpdatePlan {
  entryOut: PlatformEntry;
  entryDatumCbor: string;
  /** beacon NFT unit phải BẢO TOÀN ở input & output (U-NFT). */
  nftUnit: string;
  /** value tối thiểu output entry — giữ đúng 1 beacon NFT. */
  entryValue: AssetMap;
  redeemerCbor: string;             // UpdateEntry = Constr(0,[]).
  requiredSigner: string;           // registry_authority (U-SIG).
  summary: string;
}

/**
 * Dựng plan cập nhật entry. identity (5 field) BẤT BIẾN — chỉ áp thay đổi field khả biến.
 * Tự kiểm U-ID (identityPreserved) + U-MUT (mutableFieldsValid) fail-fast.
 * @param beaconPolicy policy beacon NFT (để dựng nftUnit giữ NFT — U-NFT).
 * @param registryAuthority key-hash phải ký (U-SIG).
 */
export function planUpdateEntry(
  entryIn: PlatformEntry, changes: EntryChanges,
  beaconPolicy: string, registryAuthority: string,
): UpdatePlan {
  // U-TERMINAL: Retired là trạng thái CUỐI — không update/revive (gương expect
  // entry_in.status != Retired). Chặn cả Retired→Active lẫn Retired→Retired.
  if (entryIn.status === "Retired") {
    throw new Error(
      "UPD-TERMINAL: entryIn.status == Retired — Retired là trạng thái CUỐI, không cập nhật/revive "
      + "(gương U-TERMINAL: entry_in.status != Retired)",
    );
  }

  // Áp thay đổi field KHẢ BIẾN; identity giữ NGUYÊN từ entryIn.
  const entryOut: PlatformEntry = {
    // identity bất biến (U-ID)
    platform_id:   normHex(entryIn.platform_id),
    instance_id:   normHex(entryIn.instance_id),
    custody_hash:  normHex(entryIn.custody_hash),
    seed_policy:   normHex(entryIn.seed_policy),
    created_epoch: entryIn.created_epoch,
    // field khả biến (U-MUT)
    governance_ref:  changes.governance_ref !== undefined
      ? normHex(changes.governance_ref) : normHex(entryIn.governance_ref),
    accepted_assets: (changes.accepted_assets ?? entryIn.accepted_assets).map(normAssetKey),
    cut_bps:         changes.cut_bps ?? entryIn.cut_bps,
    status:          changes.status ?? entryIn.status,
  };

  // U-ID: identity bất biến giữa in & out.
  if (!identityPreserved(entryIn, entryOut)) {
    throw new Error(
      "UPD-ID: identity (platform_id/instance_id/custody_hash/seed_policy/created_epoch) bị đổi — "
      + "cấm khi UpdateEntry",
    );
  }
  // U-MUT: field khả biến hợp lệ sau cập nhật.
  if (!mutableFieldsValid(entryOut)) {
    throw new Error(
      "UPD-MUT: field khả biến không hợp lệ (governance_ref khác rỗng, accepted không rỗng, "
      + "cut_bps∈[0,10000])",
    );
  }

  const nftUnit = normHex(beaconPolicy) + entryOut.platform_id;   // U-NFT bảo toàn.
  const entryValue: AssetMap = { [nftKey(beaconPolicy, entryOut.platform_id)]: 1n };

  const summary = [
    `═══ Update Entry ═══`,
    `Platform id: ${entryOut.platform_id} (identity giữ nguyên)`,
    `Status:      ${entryIn.status} → ${entryOut.status}`,
    `Cut bps:     ${entryIn.cut_bps} → ${entryOut.cut_bps}`,
    `Gov ref:     ${entryOut.governance_ref}`,
    `Accepted:    ${entryOut.accepted_assets.length} asset(s)`,
    `Beacon NFT:  ${nftUnit} (giữ qty 1)`,
    `Authority:   ${normHex(registryAuthority)} (must sign)`,
  ].join("\n");

  return {
    entryOut,
    entryDatumCbor: platformEntryToCbor(entryOut),
    nftUnit,
    entryValue,
    redeemerCbor:   updateEntryRedeemerToCbor(),
    requiredSigner: normHex(registryAuthority),
    summary,
  };
}

/** Chuẩn hoá AssetKey về hex trần (khớp encode datum). */
function normAssetKey(a: AssetKey): AssetKey {
  return { policy: normHex(a.policy), name: normHex(a.name) };
}
