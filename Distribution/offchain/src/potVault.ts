// potVault.ts — off-chain của két pot 8 (`Distribution/pot-vault`). Hợp đồng:
// `Distribution/pot-vault/CONTRACT.md` v1.1. Mã on-chain: `pot-vault/onchain/validators/pot_vault.ak`,
// `.../lib/magiclamp/potvault/{types,handlers,util}.ak` — mã thắng tài liệu khi lệch.
//
//   PotDatum         = Constr 0 [reserve_hash: bytes(28), drawn_total: int, last_window: int]
//   PotRedeemer      = Feed (0) | Absorb (1)          PotMintRedeemer = MintPot (0)
//   NFT pot          = (hash script pot, "")          địa chỉ pot = Script(hash) KHÔNG stake
//   NFT két swap     = (reserve_hash, "")             địa chỉ két = Script(reserve_hash) KHÔNG stake
//
// Datum/redeemer trả về dạng CHUỖI CBOR, không trả `Data`: bên gọi ở gói khác (Genesis/scripts)
// nạp một bản lucid khác, `Data.to` của bản đó không mã hoá được `Constr` của bản này.
//
// Builder trả `TxBuilder` CHƯA `complete()`: lượt đúc cần nguồn LAMP (pot development native script
// trên Preprod, ví thường trong Emulator) và chữ ký mà builder không biết; bên gọi gắn thêm rồi tự
// `complete()`. Lượt `Feed` cần validator + redeemer của két swap — pot không ép chúng (CONTRACT
// §Giới hạn đã biết), nên builder nhận một hàm gắn két do bên gọi đưa.
import {
  Constr, Data, applyParamsToScript, credentialToAddress, getAddressDetails, toUnit,
  validatorToScriptHash,
  type LucidEvolution, type Network, type TxBuilder, type UTxO,
} from "@lucid-evolution/lucid";

// ── Hằng khớp `types.ak` ─────────────────────────────────────────────────────

/** `types.ak` ▸ `pot_nft_name` = #"" (rỗng). */
export const POT_NFT_NAME = "";
/** `types.ak` ▸ `reserve_nft_name` = #"" — cùng giá trị, khác khái niệm (policy của két). */
export const RESERVE_NFT_NAME = "";
/** `types.ak` ▸ `max_range_ms` — trần `hi − lo` của một lượt `Feed`. */
export const POT_MAX_RANGE_MS = 3_600_000n;
/** `types.ak` ▸ `script_hash_length`. */
export const SCRIPT_HASH_BYTES = 28;

export const POT_SPEND = { Feed: 0, Absorb: 1 } as const;
export const POT_MINT = { MintPot: 0 } as const;

/** Thứ tự tham số của `validator pot_vault(` — CONTRACT v1.1 §Tham số biên dịch. */
export const POT_VAULT_PARAM_ORDER = [
  "genesis_ref", "lamp_policy", "lamp_name", "ms_per_epoch", "window_cap", "total_cap", "window_origin_ms",
] as const;

/** Tiêu đề validator trong `plutus.json`. `.mint`/`.spend`/`.else` dùng chung compiledCode. */
export const POT_VAULT_BLUEPRINT_TITLE = "pot_vault.pot_vault.spend";

/**
 * Trần của kênh pot 8 trên Preprod — CONTRACT v1.1 §Tham số biên dịch, cột "giá trị Preprod"
 * (oildrop, LAMP decimals 6). Đổi ở CONTRACT thì đổi ở đây, và hash pot đổi theo.
 */
export const POT_VAULT_PREPROD_CAPS = {
  windowCap: 1_000_000n * 1_000_000n,
  totalCap: 7_000_000n * 1_000_000n,
} as const;

const HEX = /^([0-9a-f]{2})*$/;
const HASH28 = /^[0-9a-f]{56}$/;
const TXHASH = /^[0-9a-f]{64}$/;

// ── Tham số ──────────────────────────────────────────────────────────────────

export interface OutRef {
  txHash: string;
  outputIndex: number;
}

export interface PotVaultParams {
  genesisRef: OutRef;
  lampPolicy: string;
  lampName: string;
  msPerEpoch: bigint;
  windowCap: bigint;
  totalCap: bigint;
  windowOriginMs: bigint;
}

/** `<txhash>#<idx>` → OutRef. Ném khi sai hình dạng — không đoán. */
export function parseOutRef(s: string): OutRef {
  const m = /^([0-9a-f]{64})#(\d+)$/.exec(s.trim());
  if (!m) throw new Error(`POTV-REF-001: '${s}' không phải <txhash 64 hex>#<chỉ số>.`);
  const outputIndex = Number(m[2]);
  if (!Number.isSafeInteger(outputIndex)) throw new Error(`POTV-REF-002: chỉ số '${m[2]}' quá lớn.`);
  return { txHash: m[1]!, outputIndex };
}

/** OutputReference (stdlib v2, Plutus V3) = Constr 0 [transaction_id: bytes, output_index: int]. */
function outRefData(r: OutRef): Constr<Data> {
  return new Constr(0, [r.txHash, BigInt(r.outputIndex)]);
}

/**
 * Bảy tham số theo đúng thứ tự `validator pot_vault(`. Ép phía off-chain cùng miền M-7 ép
 * on-chain (lượt đúc mới đọc được tham số, tức là sau khi tiền đã có chỗ đến) — sai ở đây thì
 * hỏng trước khi có địa chỉ.
 */
export function potVaultParamList(p: PotVaultParams): Data[] {
  if (!TXHASH.test(p.genesisRef.txHash) || !Number.isSafeInteger(p.genesisRef.outputIndex) || p.genesisRef.outputIndex < 0) {
    throw new Error("POTV-PARAM-001: genesis_ref sai hình dạng.");
  }
  if (!HASH28.test(p.lampPolicy)) throw new Error(`POTV-PARAM-002: lamp_policy '${p.lampPolicy}' không phải 28 byte hex.`);
  if (!HEX.test(p.lampName) || p.lampName.length > 64) throw new Error(`POTV-PARAM-003: lamp_name '${p.lampName}' không phải hex ≤ 32 byte.`);
  if (p.msPerEpoch <= 0n || p.windowCap <= 0n || p.totalCap <= 0n) {
    throw new Error("POTV-PARAM-004: ms_per_epoch, window_cap, total_cap phải > 0 (M-7).");
  }
  if (p.windowOriginMs < 0n) throw new Error("POTV-PARAM-005: window_origin_ms phải ≥ 0.");
  return [outRefData(p.genesisRef), p.lampPolicy, p.lampName, p.msPerEpoch, p.windowCap, p.totalCap, p.windowOriginMs];
}

// ── Áp blueprint ─────────────────────────────────────────────────────────────

interface BlueprintValidator {
  title: string;
  compiledCode: string;
  hash: string;
  parameters?: { title: string }[];
}

export interface AppliedPotVault {
  params: PotVaultParams;
  /** Validator đã áp (dạng thuần — bên gọi dùng được với bản lucid của gói mình). */
  script: { type: "PlutusV3"; script: string };
  /** Hash script = policy NFT pot = payment credential của địa chỉ pot. */
  scriptHash: string;
  /** Địa chỉ enterprise `Script(scriptHash)` = `pot_return` mà két swap nhận làm tham số. */
  address: string;
  /** Unit của NFT pot = scriptHash + "" (asset name rỗng). */
  nftUnit: string;
  lampUnit: string;
  network: Network;
}

/**
 * Áp 7 tham số vào blueprint `pot-vault/onchain/plutus.json`. Ép: có validator đúng tiêu đề,
 * blueprint khai ĐÚNG tên + thứ tự tham số của `POT_VAULT_PARAM_ORDER` (đổi chữ ký on-chain mà
 * quên bên này thì ném, không áp lệch), và LAMP ≠ NFT pot (vế cuối M-7).
 */
export function applyPotVault(blueprint: unknown, p: PotVaultParams, network: Network): AppliedPotVault {
  const vs = (blueprint as { validators?: BlueprintValidator[] })?.validators;
  if (!Array.isArray(vs)) throw new Error("POTV-BP-001: blueprint không có mảng 'validators'.");
  const v = vs.find((x) => x.title === POT_VAULT_BLUEPRINT_TITLE);
  if (!v) throw new Error(`POTV-BP-002: không thấy '${POT_VAULT_BLUEPRINT_TITLE}' — chạy 'aiken build' trong pot-vault/onchain.`);
  const titles = (v.parameters ?? []).map((x) => x.title);
  if (titles.join(",") !== POT_VAULT_PARAM_ORDER.join(",")) {
    throw new Error(`POTV-BP-003: blueprint khai tham số [${titles.join(", ")}], off-chain áp [${POT_VAULT_PARAM_ORDER.join(", ")}].`);
  }
  const list = potVaultParamList(p);
  const script = { type: "PlutusV3" as const, script: applyParamsToScript(v.compiledCode, list as never) };
  const scriptHash = validatorToScriptHash(script);
  if (p.lampPolicy === scriptHash && p.lampName === POT_NFT_NAME) {
    throw new Error("POTV-PARAM-006: LAMP trùng NFT pot (M-7).");
  }
  return {
    params: p,
    script,
    scriptHash,
    address: enterpriseScriptAddress(network, scriptHash),
    nftUnit: toUnit(scriptHash, POT_NFT_NAME),
    lampUnit: toUnit(p.lampPolicy, p.lampName),
    network,
  };
}

/**
 * Địa chỉ ENTERPRISE `Script(hash)` — không stake credential. Validator so ĐỊA CHỈ ĐẦY ĐỦ
 * (`util.script_address`), nên một địa chỉ có stake credential là địa chỉ KHÁC: tx tới đó bị từ
 * chối (pot, két), hoặc tệ hơn, UTxO lạc ở đó không ai hút về. Ép lại sau khi dựng.
 */
export function enterpriseScriptAddress(network: Network, hash: string): string {
  if (!HASH28.test(hash)) throw new Error(`POTV-ADDR-001: '${hash}' không phải script hash 28 byte.`);
  const addr = credentialToAddress(network, { type: "Script", hash });
  assertEnterpriseScript(addr, hash);
  return addr;
}

export function assertEnterpriseScript(addr: string, hash: string): void {
  const d = getAddressDetails(addr);
  if (d.paymentCredential?.type !== "Script" || d.paymentCredential.hash !== hash) {
    throw new Error(`POTV-ADDR-002: ${addr} không có payment credential Script(${hash}).`);
  }
  if (d.stakeCredential !== undefined || d.type !== "Enterprise") {
    throw new Error(`POTV-ADDR-003: ${addr} có stake credential — pot/két phải là địa chỉ enterprise.`);
  }
}

// ── Datum · redeemer ─────────────────────────────────────────────────────────

export interface PotDatum {
  reserveHash: string;
  drawnTotal: bigint;
  lastWindow: bigint;
}

export function encodePotDatum(d: PotDatum): string {
  if (!HASH28.test(d.reserveHash)) throw new Error(`POTV-DATUM-001: reserve_hash '${d.reserveHash}' không phải 28 byte.`);
  return Data.to(new Constr(0, [d.reserveHash, d.drawnTotal, d.lastWindow]));
}

/** Datum khởi tạo M-4: drawn_total = 0, last_window = −1 (cửa sổ 0 là cửa sổ thật). */
export function initialPotDatum(reserveHash: string): string {
  return encodePotDatum({ reserveHash, drawnTotal: 0n, lastWindow: -1n });
}

/** Đọc datum pot. Hình dạng lạ thì NÉM — chỉ UTxO mang NFT pot mới được đọc bằng hàm này. */
export function decodePotDatum(cbor: string): PotDatum {
  const c = Data.from(cbor) as Constr<Data>;
  if (!(c instanceof Constr) || c.index !== 0 || c.fields.length !== 3) {
    throw new Error("POTV-DATUM-002: datum pot không phải Constr 0 [bytes, int, int].");
  }
  const [h, drawn, last] = c.fields;
  if (typeof h !== "string" || !HASH28.test(h) || typeof drawn !== "bigint" || typeof last !== "bigint") {
    throw new Error("POTV-DATUM-003: trường datum pot sai kiểu.");
  }
  return { reserveHash: h, drawnTotal: drawn, lastWindow: last };
}

export const potRedeemer = (r: keyof typeof POT_SPEND): string => Data.to(new Constr(POT_SPEND[r], []));
export const potMintRedeemer = (): string => Data.to(new Constr(POT_MINT.MintPot, []));

// ── Cửa sổ thời gian (`util.get_epoch_pinned`) ───────────────────────────────

export interface FeedWindow {
  loMs: bigint;
  hiMs: bigint;
  window: bigint;
}

/**
 * Nghĩa vụ off-chain của `Feed` (CONTRACT §Nghĩa vụ off-chain, công thức ĐÚNG theo mã
 * `util.get_epoch_pinned` — có trừ gốc `window_origin_ms`):
 *   lo = now (làm tròn XUỐNG về giây: slot Preprod rộng 1 s, lo không thẳng giây sẽ bị lucid hạ
 *        về đầu slot và hi − lo on-chain dài thêm tới 999 ms);
 *   hi = min(lo + ttl, o + (w + 1)·m − 1),  w = (lo − o) / m.
 * Phần còn lại của cửa sổ ngắn hơn `minTtlMs` ⇒ NÉM (chờ cửa sổ sau), KHÔNG nới `hi`.
 */
export function feedWindow(nowMs: bigint, msPerEpoch: bigint, originMs: bigint, ttlMs: bigint, minTtlMs = 120_000n): FeedWindow {
  if (msPerEpoch <= 0n) throw new Error("POTV-TIME-001: ms_per_epoch phải > 0.");
  if (ttlMs <= 0n || ttlMs > POT_MAX_RANGE_MS) throw new Error(`POTV-TIME-002: ttl ${ttlMs} ngoài (0, ${POT_MAX_RANGE_MS}].`);
  if (minTtlMs <= 0n || minTtlMs > ttlMs) throw new Error(`POTV-TIME-003: minTtl ${minTtlMs} ngoài (0, ttl].`);
  const lo = (nowMs / 1000n) * 1000n;
  if (lo < originMs) throw new Error("POTV-TIME-004: thời điểm trước gốc cửa sổ.");
  const window = (lo - originMs) / msPerEpoch;
  const windowEnd = originMs + (window + 1n) * msPerEpoch - 1n;
  const hi = lo + ttlMs < windowEnd ? lo + ttlMs : windowEnd;
  if (hi - lo < minTtlMs) {
    throw new Error(`POTV-TIME-005: cửa sổ ${window} chỉ còn ${hi - lo} ms (< ${minTtlMs}) — CHỜ sang cửa sổ ${window + 1n}, không nới hi.`);
  }
  return { loMs: lo, hiMs: hi, window };
}

// ── Builder ──────────────────────────────────────────────────────────────────

const qty = (u: UTxO, unit: string): bigint => u.assets[unit] ?? 0n;

/** Value chỉ ADA + NFT pot + LAMP (F-3 / A-3 / M-5) — mọi unit khác là lỗi. */
function onlyAdaNftLamp(assets: Record<string, bigint>, pot: AppliedPotVault): boolean {
  return Object.keys(assets).every((k) => k === "lovelace" || k === pot.nftUnit || k === pot.lampUnit);
}

export interface MintPotArgs {
  lucid: LucidEvolution;
  pot: AppliedPotVault;
  /** UTxO đúng bằng `genesis_ref` (M-1). Bên gọi chịu phần chữ ký của địa chỉ chứa nó. */
  genesisUtxo: UTxO;
  reserveHash: string;
  initialLamp: bigint;
  potLovelace: bigint;
}

/**
 * Lượt đúc `MintPot`: tiêu genesis_ref, đúc {(hash,""): 1}, output pot ở địa chỉ enterprise, không
 * reference script, datum khởi tạo M-4, value ADA + NFT + (tuỳ) LAMP. LAMP do bên gọi đưa vào tx
 * (coin selection của ví, hoặc chi từ một kho riêng).
 */
export function buildMintPotTx(a: MintPotArgs): TxBuilder {
  const { pot } = a;
  if (a.genesisUtxo.txHash !== pot.params.genesisRef.txHash || a.genesisUtxo.outputIndex !== pot.params.genesisRef.outputIndex) {
    throw new Error("POTV-MINT-001: UTxO đưa vào không phải genesis_ref đã áp vào script (M-1).");
  }
  if (!HASH28.test(a.reserveHash)) throw new Error("POTV-MINT-002: reserve_hash phải 28 byte (M-4).");
  if (a.reserveHash === pot.scriptHash) throw new Error("POTV-MINT-003: reserve_hash trùng hash pot (M-6).");
  if (a.initialLamp < 0n) throw new Error("POTV-MINT-004: LAMP ban đầu âm.");
  const value: Record<string, bigint> = { lovelace: a.potLovelace, [pot.nftUnit]: 1n };
  if (a.initialLamp > 0n) value[pot.lampUnit] = a.initialLamp;
  return a.lucid.newTx()
    .collectFrom([a.genesisUtxo])
    .mintAssets({ [pot.nftUnit]: 1n }, potMintRedeemer())
    .attach.MintingPolicy(pot.script)
    .pay.ToContract(pot.address, { kind: "inline", value: initialPotDatum(a.reserveHash) }, value);
}

export interface FeedArgs {
  lucid: LucidEvolution;
  pot: AppliedPotVault;
  potUtxo: UTxO;
  reserveUtxo: UTxO;
  /** Redeemer của két swap (CBOR) — việc của két, pot không đọc. Bỏ trống khi két là native script. */
  reserveRedeemer?: string;
  /** Datum inline của output két (CBOR) — pot không ép; két tự ép output tiếp nối của nó. */
  reserveOutDatum: string;
  /** Gắn validator của két (inline hoặc reference) + chữ ký két cần, nếu có. */
  attachReserve: (tx: TxBuilder) => TxBuilder;
  /** Lượng LAMP rót sang két (oildrop). Validator suy `d` từ hiệu value, không đọc từ redeemer. */
  d: bigint;
  nowMs: bigint;
  ttlMs?: bigint;
  minTtlMs?: bigint;
  /** false ⇒ bỏ các phép kiểm trước (chỉ cho bài kiểm phải-bị-từ-chối chạm validator thật). */
  preflight?: boolean;
}

/** Lượt `Feed` (F-0..F-7): pot −d LAMP, két +d LAMP, datum pot {drawn + d, last_window = cửa sổ hiện tại}. */
export function buildFeedTx(a: FeedArgs): { tx: TxBuilder; window: FeedWindow; nextDatum: PotDatum } {
  const { pot } = a;
  const preflight = a.preflight ?? true;
  if (qty(a.potUtxo, pot.nftUnit) !== 1n || !a.potUtxo.datum) throw new Error("POTV-FEED-001: UTxO pot không mang NFT pot hoặc thiếu datum inline.");
  const din = decodePotDatum(a.potUtxo.datum);
  const reserveNft = toUnit(din.reserveHash, RESERVE_NFT_NAME);
  const reserveAddr = enterpriseScriptAddress(pot.network, din.reserveHash);
  const w = feedWindow(a.nowMs, pot.params.msPerEpoch, pot.params.windowOriginMs, a.ttlMs ?? 1_800_000n, a.minTtlMs);
  const next: PotDatum = { reserveHash: din.reserveHash, drawnTotal: din.drawnTotal + a.d, lastWindow: w.window };
  const potLamp = qty(a.potUtxo, pot.lampUnit);
  const reserveLampOut = qty(a.reserveUtxo, pot.lampUnit) + a.d;
  if (preflight) {
    if (a.d <= 0n) throw new Error("POTV-FEED-002: d phải > 0 (F-4).");
    if (a.d > potLamp) throw new Error(`POTV-FEED-003: pot giữ ${potLamp}, rót ${a.d}.`);
    if (w.window <= din.lastWindow) throw new Error(`POTV-FEED-004: cửa sổ ${w.window} ≤ last_window ${din.lastWindow} — mỗi cửa sổ một lượt (F-1).`);
    if (next.drawnTotal > pot.params.totalCap) throw new Error(`POTV-FEED-005: drawn_total ${next.drawnTotal} > total_cap ${pot.params.totalCap} (F-4).`);
    if (qty(a.reserveUtxo, reserveNft) !== 1n || a.reserveUtxo.address !== reserveAddr) {
      throw new Error("POTV-FEED-006: UTxO két không mang NFT két hoặc không ở địa chỉ enterprise Script(reserve_hash) (F-5).");
    }
    if (reserveLampOut > pot.params.windowCap) throw new Error(`POTV-FEED-007: LAMP két sau lượt rót ${reserveLampOut} > window_cap ${pot.params.windowCap} (F-6).`);
    if (!onlyAdaNftLamp(a.potUtxo.assets, pot)) throw new Error("POTV-FEED-008: UTxO pot mang token lạ.");
  }
  const potOut: Record<string, bigint> = { ...a.potUtxo.assets, [pot.lampUnit]: potLamp - a.d };
  if (potOut[pot.lampUnit] === 0n) delete potOut[pot.lampUnit];
  const reserveOut: Record<string, bigint> = { ...a.reserveUtxo.assets, [pot.lampUnit]: reserveLampOut };
  let tx = a.lucid.newTx()
    .collectFrom([a.potUtxo], potRedeemer("Feed"))
    .attach.SpendingValidator(pot.script)
    .collectFrom([a.reserveUtxo], a.reserveRedeemer)
    .pay.ToContract(pot.address, { kind: "inline", value: encodePotDatum(next) }, potOut)
    .pay.ToContract(reserveAddr, { kind: "inline", value: a.reserveOutDatum }, reserveOut)
    .validFrom(Number(w.loMs))
    .validTo(Number(w.hiMs));
  tx = a.attachReserve(tx);
  return { tx, window: w, nextDatum: next };
}

export interface AbsorbArgs {
  lucid: LucidEvolution;
  pot: AppliedPotVault;
  potUtxo: UTxO;
  /** UTxO lạc ở địa chỉ pot (không mang NFT pot). ADA + token lạ của chúng đi theo người dọn. */
  strays: UTxO[];
  preflight?: boolean;
}

/** Lượt `Absorb` (A-1..A-4): datum pot y nguyên, LAMP pot += Σ LAMP lạc, ADA pot giữ nguyên. */
export function buildAbsorbTx(a: AbsorbArgs): TxBuilder {
  const { pot } = a;
  if (qty(a.potUtxo, pot.nftUnit) !== 1n || !a.potUtxo.datum) throw new Error("POTV-ABS-001: UTxO pot không mang NFT pot hoặc thiếu datum inline.");
  decodePotDatum(a.potUtxo.datum);
  if ((a.preflight ?? true)) {
    if (a.strays.length === 0) throw new Error("POTV-ABS-002: không có UTxO lạc nào để hút (A-3).");
    for (const s of a.strays) {
      if (s.address !== pot.address) throw new Error(`POTV-ABS-003: ${s.txHash}#${s.outputIndex} không ở địa chỉ pot.`);
      if (qty(s, pot.nftUnit) !== 0n) throw new Error(`POTV-ABS-004: ${s.txHash}#${s.outputIndex} mang NFT pot — không phải UTxO lạc.`);
    }
  }
  const strayLamp = a.strays.reduce((s, u) => s + qty(u, pot.lampUnit), 0n);
  const potOut: Record<string, bigint> = { ...a.potUtxo.assets, [pot.lampUnit]: qty(a.potUtxo, pot.lampUnit) + strayLamp };
  if (potOut[pot.lampUnit] === 0n) delete potOut[pot.lampUnit];
  return a.lucid.newTx()
    .collectFrom([a.potUtxo, ...a.strays], potRedeemer("Absorb"))
    .attach.SpendingValidator(pot.script)
    .pay.ToContract(pot.address, { kind: "inline", value: a.potUtxo.datum }, potOut);
}

// ── Đọc lại giao dịch đã dựng ────────────────────────────────────────────────

export interface ShapedOutput {
  address: string;
  assets: Record<string, bigint>;
  datum?: string | null;
  scriptRef?: unknown;
}

/**
 * Soát output pot của một giao dịch ĐÃ DỰNG (đọc từ CBOR thân, không từ ý định builder). Trả danh
 * sách lỗi; rỗng ⇔ đúng một output mang NFT pot, ở đúng địa chỉ pot, không reference script, datum
 * inline đúng `expectDatum`, value chỉ ADA + NFT + LAMP với LAMP đúng `expectLamp`.
 */
export function potOutputFailures(outputs: ShapedOutput[], pot: AppliedPotVault, expectDatum: string, expectLamp: bigint): string[] {
  const f: string[] = [];
  const withNft = outputs.filter((o) => (o.assets[pot.nftUnit] ?? 0n) > 0n);
  const atPot = outputs.filter((o) => o.address === pot.address);
  if (withNft.length !== 1) f.push(`${withNft.length} output mang NFT pot (cần 1)`);
  if (atPot.length !== 1) f.push(`${atPot.length} output ở địa chỉ pot (cần 1)`);
  const o = withNft[0];
  if (!o) return f;
  if (o.address !== pot.address) f.push(`NFT pot ở ${o.address}, không ở địa chỉ pot`);
  if (o.assets[pot.nftUnit] !== 1n) f.push("NFT pot số lượng ≠ 1");
  if (o.scriptRef) f.push("output pot mang reference script");
  if (o.datum !== expectDatum) f.push(`datum ${o.datum ?? "(không có)"} ≠ ${expectDatum}`);
  if (!onlyAdaNftLamp(o.assets, pot)) f.push("value pot có token ngoài ADA/NFT/LAMP");
  if ((o.assets[pot.lampUnit] ?? 0n) !== expectLamp) f.push(`LAMP pot ${o.assets[pot.lampUnit] ?? 0n} ≠ ${expectLamp}`);
  return f;
}
