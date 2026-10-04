// dripPot.ts — phần thuần (không mạng) của két drip: mã hoá datum/redeemer, tính lượng đến hạn,
// thẻ output đích. Hợp đồng: `Distribution/drip-pot/CONTRACT.md` v0.2.
//
//   DripDatum = Reserve                                   Constr 0 []   (CBOR d87980)
//             | Account{vault, entitlement, claimed, start_epoch}   Constr 1 [addr, int, int, int]
//   SpendRedeemer = Seed (0) | Claim (1)      MintRedeemer = MintAccounts (0) | BurnAccount (1)
//   tag(input) = datum inline = OutputReference{transaction_id, output_index} = Constr 0 [bytes, int]
import {
  Constr, Data, getAddressDetails, credentialToAddress, type Credential, type Network,
} from "@lucid-evolution/lucid";

/** Asset name của token xác thực: utf8("account"). */
export const DRIP_ACCOUNT_TOKEN_NAME = "6163636f756e74";
export const DRIP_RESERVE_DATUM_CBOR = "d87980";

export const DRIP_SPEND = { Seed: 0, Claim: 1 } as const;
export const DRIP_MINT = { MintAccounts: 0, BurnAccount: 1 } as const;

export interface DripAccount {
  vault: string;          // địa chỉ bech32
  entitlement: bigint;
  claimed: bigint;
  startEpoch: bigint;
}

export interface DripParams {
  campaignIdHex: string;
  lampPolicy: string;
  lampName: string;
  committee: string[];
  threshold: bigint;
  msPerEpoch: bigint;
  windowOriginMs: bigint;
  vestEpochs: bigint;
}

/** Tham số theo đúng thứ tự §1, ở dạng `applyParamsToScript` nhận. */
export function dripParamList(p: DripParams): Data[] {
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
