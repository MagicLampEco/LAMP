// dripPot.ts — két drip: mã hoá datum/redeemer, tính lượng đến hạn, thẻ output đích (phần thuần),
// và bộ dựng giao dịch `Return` (§4.3). Hợp đồng: `Distribution/drip-pot/CONTRACT.md` v0.3.
//
//   DripDatum = Reserve                                   Constr 0 []   (CBOR d87980)
//             | Account{vault, entitlement, claimed, start_epoch}   Constr 1 [addr, int, int, int]
//   SpendRedeemer = Seed (0) | Claim (1) | Return (2)
//   MintRedeemer  = MintAccounts (0) | BurnAccount (1)
//   tag(input) = datum inline = OutputReference{transaction_id, output_index} = Constr 0 [bytes, int]
//
// Hai bản tham số cùng sống: v0.2 (8 tham số — két đang chạy Preprod, CONTRACT §10) và v0.3
// (10 tham số, thêm `return_script`, `treasury_nft_policy`). Bản v0.2 KHÔNG có nhánh `Return`.
import {
  Constr, Data, getAddressDetails, credentialToAddress, toUnit, validatorToScriptHash,
  type Credential, type LucidEvolution, type Network, type TxSignBuilder, type UTxO, type Validator,
} from "@lucid-evolution/lucid";

/** Asset name của token xác thực: utf8("account"). */
export const DRIP_ACCOUNT_TOKEN_NAME = "6163636f756e74";
export const DRIP_RESERVE_DATUM_CBOR = "d87980";
/** Asset name NFT carrier của kho Distribution: utf8("TREASURY") (DP-RET-7). */
export const DRIP_TREASURY_NFT_NAME = "5452454153555259";

export const DRIP_SPEND = { Seed: 0, Claim: 1, Return: 2 } as const;
export const DRIP_MINT = { MintAccounts: 0, BurnAccount: 1 } as const;

export interface DripAccount {
  vault: string;          // địa chỉ bech32
  entitlement: bigint;
  claimed: bigint;
  startEpoch: bigint;
}

/** Tám tham số đầu — chung cho v0.2 và v0.3, cùng thứ tự §1. */
export interface DripParamsV02 {
  campaignIdHex: string;
  lampPolicy: string;
  lampName: string;
  committee: string[];
  threshold: bigint;
  msPerEpoch: bigint;
  windowOriginMs: bigint;
  vestEpochs: bigint;
}

/** v0.3: thêm hai tham số CUỐI (§1). */
export interface DripParams extends DripParamsV02 {
  /** Hash script `treasury` (Distribution) nhận LAMP trả về. */
  returnScript: string;
  /** Policy NFT "TREASURY" của carrier kho đó. */
  treasuryNftPolicy: string;
}

const HEX28 = /^[0-9a-f]{56}$/;

function commonParams(p: DripParamsV02): Data[] {
  if (p.msPerEpoch <= 0n || p.vestEpochs <= 0n || p.windowOriginMs < 0n) {
    throw new Error("DRIP-PARAM-001: ms_per_epoch > 0, vest_epochs > 0, window_origin_ms ≥ 0 (DP-PARAM).");
  }
  const uniq = new Set(p.committee);
  if (p.committee.length > 16 || p.threshold < 1n || p.threshold > BigInt(uniq.size)) {
    throw new Error(`DRIP-PARAM-002: committee ${p.committee.length} khoá (${uniq.size} khác nhau), threshold ${p.threshold}.`);
  }
  return [p.campaignIdHex, p.lampPolicy, p.lampName, p.committee, p.threshold, p.msPerEpoch,
    p.windowOriginMs, p.vestEpochs];
}

/** v0.3 — 10 tham số theo đúng thứ tự §1, ở dạng `applyParamsToScript` nhận. */
export function dripParamList(p: DripParams): Data[] {
  if (!HEX28.test(p.returnScript) || !HEX28.test(p.treasuryNftPolicy)) {
    throw new Error(
      `DRIP-PARAM-003: return_script và treasury_nft_policy phải là 28 byte hex thường ` +
      `(nhận '${p.returnScript}', '${p.treasuryNftPolicy}') — DP-PARAM.`,
    );
  }
  return [...commonParams(p), p.returnScript, p.treasuryNftPolicy];
}

/** v0.2 — 8 tham số. Chỉ để dựng lại két v0.2 đã triển khai (CONTRACT §10); không có `Return`. */
export function dripParamListV02(p: DripParamsV02): Data[] {
  return commonParams(p);
}

function credentialData(c: { type: "Key" | "Script"; hash: string }): Constr<Data> {
  return new Constr(c.type === "Key" ? 0 : 1, [c.hash]);
}

/** Address Plutus: Constr 0 [payment_credential, Option<StakeCredential>]. Chỉ nhận stake inline. */
export function addressToData(bech32: string): Constr<Data> {
  const d = getAddressDetails(bech32);
  if (!d.paymentCredential) throw new Error(`DRIP-ADDR-001: ${bech32} không có payment credential.`);
  const stake = d.stakeCredential
    ? new Constr(0, [new Constr(0, [credentialData(d.stakeCredential)])])
    : new Constr(1, []);
  return new Constr(0, [credentialData(d.paymentCredential), stake]);
}

/**
 * Chiều ngược của `addressToData`. Ném với địa chỉ con trỏ hay hình dạng lạ; rồi đối chiếu
 * mã hoá lại phải ra ĐÚNG Data ban đầu — output tiếp nối so datum bằng hệt (DP-CLAIM-5).
 */
export function dataToAddress(network: Network, data: Data): string {
  const cred = (x: Data): Credential => {
    const c = x as Constr<Data>;
    if (!(c.index === 0 || c.index === 1) || c.fields.length !== 1 || typeof c.fields[0] !== "string") {
      throw new Error("DRIP-ADDR-002: credential lạ.");
    }
    return { type: c.index === 0 ? "Key" : "Script", hash: c.fields[0] as string };
  };
  const a = data as Constr<Data>;
  if (a.index !== 0 || a.fields.length !== 2) throw new Error("DRIP-ADDR-003: address lạ.");
  const st = a.fields[1] as Constr<Data>;
  let stake: Credential | undefined;
  if (st.index === 0) {
    const inner = st.fields[0] as Constr<Data>;
    if (inner.index !== 0) throw new Error("DRIP-ADDR-004: stake con trỏ — không hỗ trợ.");
    stake = cred(inner.fields[0]!);
  } else if (st.index !== 1) throw new Error("DRIP-ADDR-003: address lạ.");
  const bech = credentialToAddress(network, cred(a.fields[0]!), stake);
  if (Data.to(addressToData(bech)) !== Data.to(data)) throw new Error("DRIP-ADDR-005: mã hoá lại lệch Data gốc.");
  return bech;
}

/**
 * Khoá so sánh đích: CBOR của Address Plutus. Trả CHUỖI chứ không trả Data — bên gọi ở gói khác
 * nạp một bản lucid khác, `Data.to` của bản đó không mã hoá được `Constr` của bản này.
 */
export function vaultKey(bech32: string): string {
  return Data.to(addressToData(bech32));
}

export function encodeAccountDatum(a: DripAccount): string {
  return Data.to(new Constr(1, [addressToData(a.vault), a.entitlement, a.claimed, a.startEpoch]));
}

/**
 * Đọc datum Account; trả `null` nếu là Reserve. Ném nếu hình dạng lạ — không đoán.
 * `vault` trả về dạng Data (để so bằng hệt khi dựng output tiếp nối), địa chỉ bech32 do bên gọi giữ.
 */
export function decodeDripDatum(cbor: string): null | { vaultData: Data; entitlement: bigint; claimed: bigint; startEpoch: bigint } {
  const c = Data.from(cbor) as Constr<Data>;
  if (c.index === 0 && c.fields.length === 0) return null;
  if (c.index !== 1 || c.fields.length !== 4) throw new Error(`DRIP-DATUM-001: datum lạ (Constr ${c.index}, ${c.fields.length} trường).`);
  const [vaultData, e, cl, s] = c.fields;
  if (typeof e !== "bigint" || typeof cl !== "bigint" || typeof s !== "bigint") {
    throw new Error("DRIP-DATUM-002: entitlement/claimed/start_epoch phải là số nguyên.");
  }
  return { vaultData: vaultData!, entitlement: e, claimed: cl, startEpoch: s };
}

/** vested(E, s, e) = E · min(N, max(0, e − s + 1)) / N — §3. */
export function dripVested(entitlement: bigint, startEpoch: bigint, epoch: bigint, vestEpochs: bigint): bigint {
  let k = epoch - startEpoch + 1n;
  if (k < 0n) k = 0n;
  if (k > vestEpochs) k = vestEpochs;
  return (entitlement * k) / vestEpochs;
}

/** Lượng rút được ngay ở cửa sổ `epoch` (≤ 0 ⇒ chưa có gì). */
export function dripClaimable(a: { entitlement: bigint; claimed: bigint; startEpoch: bigint }, epoch: bigint, vestEpochs: bigint): bigint {
  return dripVested(a.entitlement, a.startEpoch, epoch, vestEpochs) - a.claimed;
}

/** tag(i): datum inline của output đích = OutputReference của input két đang chi (DP-CLAIM-4). */
export function dripTagDatum(txHash: string, outputIndex: number): string {
  return Data.to(new Constr(0, [txHash, BigInt(outputIndex)]));
}

export function epochAt(ms: bigint, windowOriginMs: bigint, msPerEpoch: bigint): bigint {
  if (ms < windowOriginMs) throw new Error("DRIP-TIME-001: thời điểm trước gốc cửa sổ.");
  return (ms - windowOriginMs) / msPerEpoch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Return (§4.3) — committee trả LAMP của MỘT Reserve về kho Distribution
// ─────────────────────────────────────────────────────────────────────────────
//
// Hình dạng giao dịch (mỗi dòng ứng một chốt; ném DRIP-RET-xxx khi bên gọi đưa vào thứ không
// dựng được — không sửa hộ, không lọc im lặng):
//   input    : đúng MỘT input két — Reserve (datum inline d87980, không token xác thực)  DP-RET-2
//              + UTxO THUẦN ADA của ví trả phí, ví đó là ví KHOÁ                         DP-RET-2b/3
//   ref input: carrier kho — UTxO duy nhất ở Script(return_script) mang 1 TREASURY        DP-RET-7
//   output   : đúng MỘT output tới địa chỉ BẰNG HỆT carrier, KHÔNG datum, chỉ ADA+LAMP,
//              LAMP = r − k                                                               DP-RET-6
//              + tuỳ chọn MỘT Reserve tiếp nối (k LAMP, 0 < k < r) ở địa chỉ input       DP-RET-5
//   ký       : committee (khoá PHÂN BIỆT ≥ threshold)                                     DP-RET-1
//   mint     : không                                                                      DP-RET-4
//
// Vì sao output trả về KHÔNG datum: carrier gộp nó qua nhánh `Refill` của `treasury.ak`
// (CONTRACT §4.3, đoạn "Vì sao đích này là SỔ"); DP-RET-6 ép `NoDatum` phía két.

export interface DripReturnParams {
  lucid: LucidEvolution;
  /** Két v0.3 đã áp 10 tham số (spend + mint cùng script). */
  script: Validator;
  /** Input két đang trả về kho. */
  reserve: UTxO;
  /** LAMP giữ lại ở Reserve tiếp nối (k). 0 = trả trọn, không output két. Đòi 0 ≤ k < r. */
  keepLamp?: bigint;
  /** Lovelace của Reserve tiếp nối (k > 0). Mặc định 2 ADA. */
  reserveLovelace?: bigint;
  /** Lovelace output trả về; vắng ⇒ min-ADA do Lucid tính. Phần này ở lại carrier (CONTRACT §8). */
  returnLovelace?: bigint;
  /** MỌI UTxO hiện ở `Script(returnScript)` — builder tự tìm carrier, đòi đúng một. */
  treasuryUtxos: UTxO[];
  /** Tham số #9, #10 đã áp vào `script` — builder không đọc ngược được từ bytecode, bên gọi khai. */
  returnScript: string;
  treasuryNftPolicy: string;
  lampPolicy: string;
  lampName: string;
  /** Khoá committee sẽ ký (pkh); phải ⊆ `committee`, PHÂN BIỆT ≥ `threshold`. */
  signers: string[];
  committee: string[];
  threshold: bigint;
  /** UTxO ví dùng trả phí + collateral; vắng ⇒ đọc ví. Chỉ UTxO THUẦN ADA ở địa chỉ KHOÁ được dùng. */
  walletUtxos?: UTxO[];
}

export interface DripReturnResult {
  tx: TxSignBuilder;
  /** r — LAMP của Reserve vào. */
  reserveLamp: bigint;
  /** k — LAMP ở Reserve tiếp nối (0 nếu không có). */
  keptLamp: bigint;
  /** r − k — LAMP tới carrier. */
  returnedLamp: bigint;
  carrier: UTxO;
  /** Địa chỉ A (= địa chỉ carrier) mà output trả về đặt vào. */
  returnAddress: string;
}

const refOf = (u: UTxO) => `${u.txHash}#${u.outputIndex}`;
const normHex = (h: string) => (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();

/** UTxO chỉ mang lovelace, không datum, không reference script. */
export function isPureAdaUtxo(u: UTxO): boolean {
  return Object.keys(u.assets).every((k) => k === "lovelace") && !u.datum && !u.datumHash && !u.scriptRef;
}

function paymentCredOf(addr: string): Credential {
  const d = getAddressDetails(addr);
  if (!d.paymentCredential) throw new Error(`DRIP-ADDR-001: ${addr} không có payment credential.`);
  return d.paymentCredential;
}

export async function buildDripReturnTx(p: DripReturnParams): Promise<DripReturnResult> {
  const own = validatorToScriptHash(p.script);
  const returnScript = normHex(p.returnScript);
  const nftPolicy = normHex(p.treasuryNftPolicy);
  const lampUnit = toUnit(normHex(p.lampPolicy), normHex(p.lampName));
  const tokenUnit = toUnit(own, DRIP_ACCOUNT_TOKEN_NAME);
  const nftUnit = toUnit(nftPolicy, DRIP_TREASURY_NFT_NAME);

  // ── DP-PARAM phía két: return_script khác chính két, cả hai 28 byte ──────────
  if (!HEX28.test(returnScript) || !HEX28.test(nftPolicy)) {
    throw new Error(`DRIP-RET-010: return_script/treasury_nft_policy phải là 28 byte hex (DP-PARAM).`);
  }
  if (returnScript === own) {
    throw new Error(`DRIP-RET-010: return_script == hash chính két (${own}) — DP-PARAM từ chối.`);
  }

  // ── DP-RET-2: input là Reserve của CHÍNH két ───────────────────────────────
  const rc = paymentCredOf(p.reserve.address);
  if (rc.type !== "Script" || rc.hash !== own) {
    throw new Error(`DRIP-RET-001: ${refOf(p.reserve)} không ở Script(${own}) — không phải input két.`);
  }
  if (p.reserve.datumHash || p.reserve.datum !== DRIP_RESERVE_DATUM_CBOR) {
    throw new Error(
      `DRIP-RET-001: ${refOf(p.reserve)} không mang datum inline Reserve (d87980) ` +
      `(${p.reserve.datumHash ? "datum-hash" : p.reserve.datum ? `inline ${p.reserve.datum.slice(0, 16)}…` : "không datum"}) — DP-RET-2.`,
    );
  }
  if ((p.reserve.assets[tokenUnit] ?? 0n) !== 0n) {
    throw new Error(`DRIP-RET-001: ${refOf(p.reserve)} giữ token xác thực — đó là Account, không phải Reserve (DP-RET-2).`);
  }

  // ── DP-RET-5: 0 ≤ k < r ───────────────────────────────────────────────────
  const r = p.reserve.assets[lampUnit] ?? 0n;
  const k = p.keepLamp ?? 0n;
  if (k < 0n || k >= r) {
    throw new Error(`DRIP-RET-002: LAMP giữ lại k = ${k}, Reserve có r = ${r}; DP-RET-5 đòi 0 ≤ k < r.`);
  }

  // ── DP-RET-7: đúng MỘT carrier ở Script(return_script) ─────────────────────
  for (const u of p.treasuryUtxos) {
    const c = paymentCredOf(u.address);
    if (c.type !== "Script" || c.hash !== returnScript) {
      throw new Error(`DRIP-RET-005: ${refOf(u)} không ở Script(return_script = ${returnScript}) — treasuryUtxos phải là tập UTxO của kho.`);
    }
  }
  const carriers = p.treasuryUtxos.filter((u) => (u.assets[nftUnit] ?? 0n) === 1n);
  if (carriers.length === 0) {
    throw new Error(
      `DRIP-RET-003: không UTxO nào ở Script(${returnScript}) mang 1 ${nftUnit} — không có carrier ` +
      `(DP-RET-7). Kho sai policy, hoặc tập UTxO kho đọc thiếu.`,
    );
  }
  if (carriers.length > 1) {
    throw new Error(
      `DRIP-RET-004: ${carriers.length} UTxO cùng mang ${nftUnit} (${carriers.map(refOf).join(", ")}) — ` +
      `DP-RET-7 đòi đúng một carrier. Policy one-shot nói trạng thái này không thể có: DỪNG, đối chiếu chuỗi.`,
    );
  }
  const carrier = carriers[0]!;
  const A = carrier.address;

  // ── DP-RET-1: committee ───────────────────────────────────────────────────
  const committee = new Set(p.committee.map(normHex));
  const signers = [...new Set(p.signers.map(normHex))];
  const outsiders = signers.filter((s) => !committee.has(s));
  if (outsiders.length > 0 || BigInt(signers.length) < p.threshold) {
    throw new Error(
      `DRIP-RET-008: ${signers.length} khoá ký phân biệt (ngoài committee: ${outsiders.length}), ` +
      `threshold ${p.threshold} — DP-RET-1 từ chối.`,
    );
  }

  // ── DP-RET-2b/3: ví trả phí là ví KHOÁ, chỉ UTxO thuần ADA ─────────────────
  const walletAddr = await p.lucid.wallet().address();
  if (paymentCredOf(walletAddr).type !== "Key") {
    throw new Error(
      `DRIP-RET-006: ví trả phí ${walletAddr} là địa chỉ script — DP-RET-2b cấm mọi input script ` +
      `ngoài Reserve. Dùng ví khoá.`,
    );
  }
  const walletUtxos = p.walletUtxos ?? await p.lucid.wallet().getUtxos();
  for (const u of walletUtxos) {
    if (paymentCredOf(u.address).type !== "Key") {
      throw new Error(`DRIP-RET-006: UTxO ví ${refOf(u)} ở địa chỉ script ${u.address} — DP-RET-2b.`);
    }
  }
  const pure = walletUtxos.filter(isPureAdaUtxo);
  if (pure.length === 0) {
    throw new Error(`DRIP-RET-007: ví ${walletAddr} không có UTxO thuần ADA để trả phí + collateral.`);
  }

  // ── Dựng ─────────────────────────────────────────────────────────────────
  const back: Record<string, bigint> = { [lampUnit]: r - k };
  if (p.returnLovelace !== undefined) back.lovelace = p.returnLovelace;
  let tx = p.lucid.newTx()
    .collectFrom([p.reserve], Data.to(new Constr(DRIP_SPEND.Return, [])))
    .attach.SpendingValidator(p.script)
    .readFrom([carrier])
    .pay.ToAddress(A, back);   // KHÔNG datum — DP-RET-6
  if (k > 0n) {
    tx = tx.pay.ToContract(p.reserve.address, { kind: "inline", value: DRIP_RESERVE_DATUM_CBOR },
      { lovelace: p.reserveLovelace ?? 2_000_000n, [lampUnit]: k });
  }
  for (const s of signers) tx = tx.addSignerKey(s);
  const built = await tx.complete({ presetWalletInputs: pure, changeAddress: walletAddr });

  // ── Đọc lại giao dịch ĐÃ DỰNG — Lucid tự thêm input/output, đừng tin bản kê ở trên ──
  const body = built.toTransaction().body();
  const allowed = new Set([refOf(p.reserve), ...pure.map(refOf)]);
  const ins = body.inputs();
  for (let i = 0; i < ins.len(); i++) {
    const x = ins.get(i);
    const ref = `${x.transaction_id().to_hex()}#${Number(x.index())}`;
    if (!allowed.has(ref)) throw new Error(`DRIP-RET-009: giao dịch đã dựng tiêu ${ref} ngoài Reserve + UTxO thuần ADA của ví (DP-RET-2b).`);
  }
  const outs = body.outputs();
  let atK = 0;
  for (let i = 0; i < outs.len(); i++) {
    const o = outs.get(i);
    const addr = o.address().to_bech32(undefined);
    const c = paymentCredOf(addr);
    if (c.type === "Script" && c.hash === returnScript) {
      atK++;
      if (addr !== A || o.datum() !== undefined) {
        throw new Error(`DRIP-RET-009: output #${i} ở Script(return_script) lệch địa chỉ carrier hoặc mang datum (DP-RET-6).`);
      }
    }
  }
  if (atK !== 1) throw new Error(`DRIP-RET-009: giao dịch đã dựng có ${atK} output ở Script(return_script), DP-RET-6 đòi đúng 1.`);

  return { tx: built, reserveLamp: r, keptLamp: k, returnedLamp: r - k, carrier, returnAddress: A };
}
