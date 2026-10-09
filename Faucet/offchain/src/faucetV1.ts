// faucetV1.ts — dựng giao dịch Claim CHƯA KÝ cho vòi v1 (`onchain/validators/faucet_v1.ak`).
//
// Vì sao có tệp này: người thử ứng dụng cần 100 tLAMP tự phục vụ. Ứng dụng ký được một giao
// dịch máy chủ dựng sẵn (thêm chữ ký vkey, giữ nguyên byte thân) nhưng không tự dựng được giao
// dịch script. Máy chủ (`Faucet/server/faucetBuild.ts`) gọi hàm ở đây, trả CBOR chưa ký.
//
// Hình dạng giao dịch (khớp C-FAU-0..5 của validator):
//   input  : MỘT UTxO pool (chọn NGẪU NHIÊN trong các UTxO hợp lệ — hai người claim cùng lúc
//            hiếm khi giẫm lên cùng một UTxO) + UTxO thuần ADA của người claim (phí, collateral);
//   output : pool — CÙNG địa chỉ, CÙNG byte datum, value = value vào − claim_amount tLAMP;
//            người claim — claim_amount tLAMP (lucid tự thêm min-ADA từ ADA của người claim);
//            tiền thối về người claim.
// Không mint, không đính reference script vào output pool.
//
// Ba mã lỗi phía người dùng (máy chủ dịch sang HTTP 4xx):
//   FAUCET-ADDR    địa chỉ không phải địa chỉ ví khoá (payment key) trên mạng thử;
//   FAUCET-EMPTY   không còn UTxO pool nào giữ đủ claim_amount tLAMP với datum hợp lệ;
//   FAUCET-NO-ADA  ví người claim thiếu ADA thuần cho phí + collateral.
// FAUCET-CONFIG là lỗi phía người vận hành (script/địa chỉ/đơn vị khai sai) — không phải lỗi
// người dùng, máy chủ trả 5xx.
//
// Hàm `buildFaucetV1ClaimTx` CHỌN VÍ người claim trên chính instance `lucid` được đưa vào
// (`selectWallet.fromAddress`). Instance đó KHÔNG được dùng chung cho hai lời gọi đồng thời —
// máy chủ dựng một instance mỗi yêu cầu (tham số giao thức đặt sẵn, không gọi mạng thêm).

import {
  Constr, Data, applyParamsToScript, getAddressDetails, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator,
} from "@lucid-evolution/lucid";

/** Tên validator trong `onchain/plutus.json`. */
export const FAUCET_V1_TITLE = "faucet_v1.faucet.spend";

/** Thứ tự tham số trong `validator faucet(tlamp_policy, tlamp_name)`. */
export const FAUCET_V1_PARAM_ORDER = ["tlamp_policy", "tlamp_name"] as const;

/**
 * tLAMP Preprod mà vòi v1 nhả.
 *
 * BẢN CHÉP CÓ NHÃN — nguồn: `Genesis/offchain/src/lampPolicies.ts` ▸ `activeLampPolicyId("preprod")`
 * (chép 2026-10-10, origin/main 51ff983). Không import thẳng được: tsconfig của package này đặt
 * `rootDir` = `Faucet/`. Chỗ đối chiếu nguồn: `Genesis/scripts/34_faucet_v1.ts` ném khi hai giá
 * trị lệch, trước khi in địa chỉ hay dựng gì.
 */
export const FAUCET_V1_PREPROD_TLAMP = {
  policyId: "493002cc03004e3e14fd607cfba59312bd946e478e69d6ab431ccfac",
  assetName: "744c414d50",
} as const;

/** 100 tLAMP = 100 × 10^6 oildrop — lượng mỗi Claim của pool Preprod. */
export const FAUCET_V1_CLAIM_OILDROP = 100_000_000n;

/** Collateral lucid đặt mặc định (`CompleteOptions.setCollateral`). Ví người claim phải có ít nhất chừng này ADA thuần. */
export const FAUCET_V1_MIN_PURE_LOVELACE = 5_000_000n;

export type FaucetV1Code = "FAUCET-ADDR" | "FAUCET-EMPTY" | "FAUCET-NO-ADA" | "FAUCET-CONFIG";

export class FaucetV1Error extends Error {
  readonly code: FaucetV1Code;
  constructor(code: FaucetV1Code, message: string) {
    super(`${code}: ${message}`);
    this.name = "FaucetV1Error";
    this.code = code;
  }
}

// ── Script ───────────────────────────────────────────────────────────────────

interface BlueprintValidator { title: string; compiledCode: string; parameters?: unknown[] }

const HEX = /^([0-9a-f]{2})*$/;

/**
 * Áp tham số cho vòi v1 từ blueprint ĐÃ ĐỌC (caller đọc tệp — hàm này thuần).
 * Ép đúng số tham số blueprint khai: `applyParamsToScript` thiếu tham số không báo lỗi, nó sinh
 * script hash KHÁC, im lặng (cùng lý do với `Genesis/offchain/src/applyGate.ts`).
 */
export function faucetV1Validator(
  blueprint: { validators?: BlueprintValidator[] },
  tlamp: { policyId: string; assetName: string },
): { validator: Validator; scriptHash: string } {
  const v = blueprint.validators?.find((x) => x.title === FAUCET_V1_TITLE);
  if (!v) throw new FaucetV1Error("FAUCET-CONFIG", `blueprint không có '${FAUCET_V1_TITLE}' — chạy 'aiken build' trong Faucet/onchain.`);
  const declared = (v.parameters ?? []).length;
  if (declared !== FAUCET_V1_PARAM_ORDER.length) {
    throw new FaucetV1Error("FAUCET-CONFIG",
      `blueprint khai ${declared} tham số cho ${FAUCET_V1_TITLE}, mã off-chain áp ${FAUCET_V1_PARAM_ORDER.length}.`);
  }
  const policy = tlamp.policyId.toLowerCase();
  const name = tlamp.assetName.toLowerCase();
  if (policy.length !== 56 || !HEX.test(policy)) throw new FaucetV1Error("FAUCET-CONFIG", `policy id '${tlamp.policyId}' không phải 28 byte hex.`);
  if (name.length > 64 || !HEX.test(name)) throw new FaucetV1Error("FAUCET-CONFIG", `asset name '${tlamp.assetName}' không phải hex ≤ 32 byte.`);
  const validator: Validator = { type: "PlutusV3", script: applyParamsToScript(v.compiledCode, [policy, name]) };
  return { validator, scriptHash: validatorToScriptHash(validator) };
}

// ── Datum ────────────────────────────────────────────────────────────────────

/** `FaucetDatum { claim_amount }` = Constr(0, [Int]). */
export function encodeFaucetV1Datum(claimAmount: bigint): string {
  if (claimAmount <= 0n) throw new FaucetV1Error("FAUCET-CONFIG", `claim_amount phải > 0 (đang ${claimAmount}).`);
  return Data.to(new Constr(0, [claimAmount]));
}

/** Giải `FaucetDatum`. Hình dạng khác đúng Constr(0,[Int>0]) ⇒ NÉM (validator cũng từ chối). */
export function decodeFaucetV1Datum(cbor: string): bigint {
  const d = Data.from(cbor);
  if (!(d instanceof Constr) || d.index !== 0 || d.fields.length !== 1) {
    throw new Error(`datum không phải FaucetDatum Constr(0,[Int]).`);
  }
  const amt = d.fields[0];
  if (typeof amt !== "bigint" || amt <= 0n) throw new Error(`claim_amount không phải số nguyên dương.`);
  return amt;
}

// ── Chọn UTxO ────────────────────────────────────────────────────────────────

export interface PoolScan {
  usable: UTxO[];
  /** UTxO ở địa chỉ pool mà không dùng được — kèm lý do, để người vận hành thấy chứ không bị nuốt. */
  skipped: Array<{ outRef: string; reason: string }>;
}

/**
 * Lọc UTxO pool dùng được: datum INLINE giải ra đúng `claimAmount` của cấu hình, và giữ ≥
 * `claimAmount` tLAMP. Địa chỉ pool là cửa permissionless — ai cũng gửi được UTxO rác tới đó
 * (datum lạ, claim_amount 1 oildrop để người claim nhận bụi), nên lọc theo claim_amount ĐÚNG
 * BẰNG cấu hình chứ không theo "datum hợp lệ bất kỳ".
 */
export function scanFaucetV1Pool(utxos: UTxO[], tlampUnit: string, claimAmount: bigint): PoolScan {
  const usable: UTxO[] = [];
  const skipped: PoolScan["skipped"] = [];
  for (const u of utxos) {
    const outRef = `${u.txHash}#${u.outputIndex}`;
    if (!u.datum) { skipped.push({ outRef, reason: u.datumHash ? "datum hash, không inline" : "không datum" }); continue; }
    let amt: bigint;
    try { amt = decodeFaucetV1Datum(u.datum); } catch (e) {
      skipped.push({ outRef, reason: (e as Error).message }); continue;
    }
    if (amt !== claimAmount) { skipped.push({ outRef, reason: `claim_amount ${amt} ≠ ${claimAmount}` }); continue; }
    const held = u.assets[tlampUnit] ?? 0n;
    if (held < claimAmount) { skipped.push({ outRef, reason: `giữ ${held} < ${claimAmount} tLAMP` }); continue; }
    usable.push(u);
  }
  return { usable, skipped };
}

/** UTxO thuần ADA: chỉ lovelace, không datum, không reference script. */
export function isPureAda(u: UTxO): boolean {
  const units = Object.keys(u.assets);
  return units.length === 1 && units[0] === "lovelace" && !u.scriptRef && !u.datum && !u.datumHash;
}

/** Địa chỉ người claim: bech32 mạng thử, payment credential là KHOÁ. Ném FAUCET-ADDR. */
export function assertClaimerAddress(address: unknown): string {
  if (typeof address !== "string" || address.trim() === "") {
    throw new FaucetV1Error("FAUCET-ADDR", `thiếu địa chỉ ví.`);
  }
  const a = address.trim();
  let det: ReturnType<typeof getAddressDetails>;
  try { det = getAddressDetails(a); } catch {
    throw new FaucetV1Error("FAUCET-ADDR", `'${a.slice(0, 120)}' không phải địa chỉ Cardano đọc được.`);
  }
  if (det.networkId !== 0 || !a.startsWith("addr_test1")) {
    throw new FaucetV1Error("FAUCET-ADDR", `địa chỉ không thuộc mạng thử Preprod.`);
  }
  if (det.paymentCredential?.type !== "Key") {
    throw new FaucetV1Error("FAUCET-ADDR", `địa chỉ không có payment credential kiểu khoá (ví script hoặc địa chỉ stake không nhận được).`);
  }
  return a;
}

// ── Dựng giao dịch ───────────────────────────────────────────────────────────

export interface FaucetV1ClaimOpts {
  /** Địa chỉ pool (script faucet v1, có thể kèm stake credential — giữ nguyên ở output). */
  poolAddress: string;
  /** Địa chỉ ví người claim (payment key, mạng thử). */
  claimer: string;
  /** policyId ‖ assetName của tLAMP mà pool nhả. */
  tlampUnit: string;
  /** Lượng mỗi Claim — chỉ UTxO pool có datum đúng bằng số này mới được chọn. */
  claimAmount: bigint;
  /** UTxO mang reference script của faucet v1. Có thì đọc script từ đây (tx nhỏ hơn). */
  refScriptUtxo?: UTxO | undefined;
  /** Script faucet v1 đính kèm trực tiếp — dùng khi không có reference script. */
  validator?: Validator | undefined;
  /** Nguồn ngẫu nhiên [0,1) cho việc chọn UTxO pool; mặc định `Math.random`. */
  random?: (() => number) | undefined;
}

export interface FaucetV1ClaimResult {
  txCbor: string;
  txHash: string;
  poolUtxo: UTxO;
  scan: PoolScan;
}

export async function buildFaucetV1ClaimTx(lucid: LucidEvolution, opts: FaucetV1ClaimOpts): Promise<FaucetV1ClaimResult> {
  const claimer = assertClaimerAddress(opts.claimer);

  // Cấu hình người vận hành — lỗi ở đây là FAUCET-CONFIG, không phải lỗi người dùng.
  if (opts.claimAmount <= 0n) throw new FaucetV1Error("FAUCET-CONFIG", `claimAmount phải > 0.`);
  if (!/^[0-9a-f]{56}([0-9a-f]{2}){0,32}$/.test(opts.tlampUnit)) {
    throw new FaucetV1Error("FAUCET-CONFIG", `tlampUnit '${opts.tlampUnit}' không phải policy(28 byte)+tên hex.`);
  }
  if ((opts.refScriptUtxo === undefined) === (opts.validator === undefined)) {
    throw new FaucetV1Error("FAUCET-CONFIG", `khai ĐÚNG MỘT trong refScriptUtxo / validator.`);
  }
  const script = opts.refScriptUtxo ? opts.refScriptUtxo.scriptRef : opts.validator;
  if (!script) throw new FaucetV1Error("FAUCET-CONFIG", `refScriptUtxo không mang reference script.`);
  const scriptHash = validatorToScriptHash(script);
  let poolCred: ReturnType<typeof getAddressDetails>["paymentCredential"];
  try { poolCred = getAddressDetails(opts.poolAddress).paymentCredential; } catch {
    throw new FaucetV1Error("FAUCET-CONFIG", `poolAddress '${opts.poolAddress}' không đọc được.`);
  }
  if (poolCred?.type !== "Script" || poolCred.hash !== scriptHash) {
    throw new FaucetV1Error("FAUCET-CONFIG",
      `poolAddress mang credential ${poolCred?.type}:${poolCred?.hash}, script khai có hash ${scriptHash}.`);
  }

  // Chọn UTxO pool ngẫu nhiên.
  const scan = scanFaucetV1Pool(await lucid.utxosAt(opts.poolAddress), opts.tlampUnit, opts.claimAmount);
  if (scan.usable.length === 0) {
    throw new FaucetV1Error("FAUCET-EMPTY",
      `vòi đã cạn: không UTxO pool nào giữ đủ ${opts.claimAmount} oildrop tLAMP (bỏ qua ${scan.skipped.length} UTxO không hợp lệ).`);
  }
  const r = (opts.random ?? Math.random)();
  if (!(r >= 0 && r < 1)) throw new FaucetV1Error("FAUCET-CONFIG", `random() trả ${r}, cần [0,1).`);
  const poolUtxo = scan.usable[Math.floor(r * scan.usable.length)]!;

  // Ví người claim: CHỈ UTxO thuần ADA (phí + collateral). UTxO mang token để nguyên.
  const pure = (await lucid.utxosAt(claimer)).filter(isPureAda);
  const pureTotal = pure.reduce((s, u) => s + u.assets.lovelace!, 0n);
  if (pureTotal < FAUCET_V1_MIN_PURE_LOVELACE) {
    throw new FaucetV1Error("FAUCET-NO-ADA",
      `ví có ${pureTotal} lovelace thuần ADA, cần ít nhất ${FAUCET_V1_MIN_PURE_LOVELACE} cho collateral + phí.`);
  }
  lucid.selectWallet.fromAddress(claimer, pure);

  // Output pool: value vào − claimAmount tLAMP, mọi asset khác giữ nguyên (C-FAU-3).
  const poolOut: Record<string, bigint> = { ...poolUtxo.assets };
  const left = (poolOut[opts.tlampUnit] ?? 0n) - opts.claimAmount;
  if (left === 0n) delete poolOut[opts.tlampUnit]; else poolOut[opts.tlampUnit] = left;

  let tx = lucid.newTx()
    .collectFrom([poolUtxo], Data.to(new Constr(0, [])))   // FaucetRedeemer.Claim
    .pay.ToContract(opts.poolAddress, { kind: "inline", value: poolUtxo.datum! }, poolOut)
    .pay.ToAddress(claimer, { [opts.tlampUnit]: opts.claimAmount });
  tx = opts.refScriptUtxo ? tx.readFrom([opts.refScriptUtxo]) : tx.attach.SpendingValidator(opts.validator!);

  let built;
  try {
    built = await tx.complete({ changeAddress: claimer, presetWalletInputs: pure });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not have enough funds/.test(msg)) {
      throw new FaucetV1Error("FAUCET-NO-ADA", `ví không đủ ADA thuần cho phí + collateral + min-ADA của output tLAMP.`);
    }
    throw e;
  }
  return { txCbor: built.toCBOR(), txHash: built.toHash(), poolUtxo, scan };
}
