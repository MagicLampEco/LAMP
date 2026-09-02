// _canonical_v2.ts — WIRING DUY NHẤT của policy LAMP canonical (12 tham số, marker one-shot).
//
// VÌ SAO CÓ TỆP NÀY
//   Policy LAMP đang chạy trên mainnet (`55d3e01b…180f0`, đúc 2026-06-18) là bản KHỞI TẠO
//   8 tham số và nó có một ngõ cụt không sửa được: `meter_nft_policy` nướng vào nó là 28
//   byte 0 (`Genesis/offchain/src/deployed.ts:92`) ⇒ điều kiện
//   `count_inputs_holding_nft(...) == 1` của nhánh `ReserveDraw` không bao giờ thoả ⇒ 9,63
//   tỷ LAMP Reserve không rút được qua policy đó, mãi mãi (deployed.ts:118-119).
//   apply-param nướng vào policy-id nên KHÔNG có đường nâng cấp tại chỗ
//   (`Genesis/onchain/validators/lamp_mint.ak:34`). Cách duy nhất là một policy MỚI.
//
//   Tệp này là phần dựng tham số của policy mới đó. Nó KHÔNG gửi giao dịch nào — chỉ tính
//   ra policy-id / script-hash / địa chỉ từ MỘT hạt giống duy nhất, để mọi bước sau
//   (20/21/22/23 + verify) đọc CÙNG một nguồn và không thể trôi khác nhau.
//
// MỘT HẠT GIỐNG, MỌI MARKER
//   Mọi policy one-shot trong đường ống đều nhận `genesis_ref` làm tham số duy nhất hoặc
//   tham số đầu: `oneshot_nft` (Genesis), `treasury_nft` và `beacon_nft` (Distribution).
//   Một `OutputReference` chỉ tiêu được MỘT lần trong lịch sử chuỗi, nên tiêu nó trong
//   đúng một giao dịch là đúc xong toàn bộ marker, mỗi cái đúng một bản, vĩnh viễn.
//
//   Hệ quả thực dụng: `canonical_mint.ts` phải đòi `BEACON_NFT_POLICY` từ ngoài vì nó
//   không ghim `genesis_ref` nào (xem `requireBeaconPolicy()` ở tệp đó). Ở đây beacon
//   suy ra được từ chính hạt giống ⇒ hết một khe phải gõ tay, hết một chỗ gõ sai.
//
// KHÁC BẢN DIỄN TẬP CŨ Ở ĐÂU (đây là toàn bộ lý do viết mới thay vì sửa)
//   `canonical_mint.ts:108` đúc CẢ BỐN marker bằng `scriptFromNative({type:"sig"})`.
//   Native-sig KHÔNG one-shot: người giữ khoá ví đúc lại SUPPLY NFT bất cứ lúc nào ⇒
//   SupplyState thứ hai ⇒ `dist_minted` về 0 ⇒ đúc lại trọn cap. Cổng `assertOneShotMarkers`
//   (`_guards.ts`) biến lỗ đó thành một câu phải gõ ra, nhưng không lấp được nó.
//   Ở đây bốn marker đi qua `oneshot_nft.ak` / `treasury_nft.ak` — one-shot thật, nên cổng
//   MARKER-001 không có gì để bắt.

import {
  Constr, Data, fromText, toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash, applyParamsToScript,
  type Data as LucidData, type Script, type Validator, type MintingPolicy, type Network,
} from "@lucid-evolution/lucid";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORK, applyPolicy, policyId, rawValidator } from "./config.js";
import { assertParamCount as assertParamCountGate } from "../offchain/src/applyGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Hằng canonical — KHÔNG đổi giữa Preprod và mainnet trừ `token_name` ──────
// Đổi bất kỳ giá trị nào dưới đây là ra một policy-id khác, tức một token khác. Chúng nằm
// ở đây để đúng một chỗ, không rải trong từng script.

/** asset name thread NFT — "SUPPLY". Neo định danh SupplyState. */
export const SUPPLY_NAME = fromText("SUPPLY");
/** asset name registry NFT — "REG". Bảng token_tag → authority. */
export const REG_NAME = fromText("REG");
/** asset name meter NFT — "MET". Cửa duy nhất của nhánh ReserveDraw. */
export const MET_NAME = fromText("MET");
/** asset name kho NFT — "TRSY", ép bởi `treasury_nft.ak` (`lampdist/util.ak:154-156`). */
export const KHO_NAME = "54525359";
/** asset name beacon NFT — "DROP", ép bởi `beacon_nft.ak` (`lampdist/util.ak:146-149`). */
export const DROP_NAME = "44524f50";

/** token_tag của LAMP trong bảng registry — đã chốt (`Genesis/kho-a-dest.md`). */
export const TOKEN_TAG = "4c414d50";

/** Cap Distribution: 26,37 tỷ LAMP tính bằng oildrop (1 LAMP = 1e6 oildrop). */
export const DIST_CAP = 26_370_000_000_000_000n;
/** Cap Reserve: 9,63 tỷ LAMP. Tổng hai cap = 36 tỷ, khớp `Treasury/CONTRACT.md §5`. */
export const RESERVE_CAP = 9_630_000_000_000_000n;

/** ms mỗi epoch trên Preprod/Preview (432000 slot × 1000 ms). */
export const MS_PER_EPOCH = 432_000_000n;

/** DID quản bảng registry trong màn diễn tập. Mainnet dùng OrgDID thật (mục D12). */
export const GOV_DID = "did:phoenix:org:magiclamp";

/** Redeemer `Constr(0, [])` — dùng chung cho MintGenesis / Void của mọi policy one-shot. */
export const MINT_GENESIS = Data.to(new Constr(0, []));

// ── OutputReference ─────────────────────────────────────────────────────────

/** `OutputReference = Constr(0, [transaction_id: bytes, output_index: int])`. */
export function encodeOutputRef(txHash: string, index: number): Constr<LucidData> {
  return new Constr(0, [txHash, BigInt(index)]);
}

// ── Blueprint Distribution (fail-closed, giống `canonical_mint.ts::applyDist`) ──

type RawDist = { title: string; compiledCode: string; parameters?: unknown[] };
let distCache: RawDist[] | undefined;

async function distValidators(): Promise<RawDist[]> {
  if (!distCache) {
    const p = resolve(__dirname, "../../Distribution/onchain/plutus.json");
    distCache = (JSON.parse(await readFile(p, "utf8")) as { validators: RawDist[] }).validators;
  }
  return distCache;
}

/**
 * Áp tham số cho validator Distribution, ÉP ĐÚNG số tham số blueprint khai.
 *
 * `applyParamsToScript` KHÔNG ném khi truyền THIẾU tham số — nó áp một phần rồi trả về một
 * script-hash khác, im lặng. Với `treasury.ak` thì "script-hash khác" nghĩa là địa chỉ KHO
 * khác, và LAMP không burn được (`Treasury/CONTRACT.md §5`) nên rót nhầm là kẹt vĩnh viễn.
 */
async function applyDist(title: string, params: unknown[]): Promise<Script> {
  const v = (await distValidators()).find((x) => x.title === title);
  if (!v) throw new Error(`Distribution '${title}' không có trong plutus.json — chạy 'aiken build' trong Distribution/onchain/.`);
  if (!Array.isArray(v.parameters)) {
    throw new Error(
      `APPLY-001: blueprint KHÔNG khai 'parameters' cho '${title}' — không suy đoán số tham số. ` +
      `Chạy lại 'aiken build' trong Distribution/onchain/ rồi thử lại.`,
    );
  }
  assertParamCountGate(title, v.parameters.length, params.length);
  return { type: "PlutusV3", script: applyParamsToScript(v.compiledCode, params as never) };
}

const hashOf = (s: Script) => validatorToScriptHash(s as Validator);
const addrOf = (h: string, n: Network) => credentialToAddress(n, scriptHashToCredential(h));

// ── Kết quả wiring ───────────────────────────────────────────────────────────

export interface CanonicalWiring {
  network: Network;
  /** UTxO hạt giống — mọi policy one-shot dưới đây nướng đúng cái này. */
  genesisRef: { txHash: string; outputIndex: number };
  /** pkh ví vận hành: authority trong registry + committee của Distribution. */
  pkh: string;
  tokenName: string;

  /** Bốn marker one-shot + beacon, mỗi cái một policy-id riêng từ CÙNG hạt giống. */
  markers: {
    threadPid: string;
    regPid: string;
    metPid: string;
    khoPid: string;
    beaconPid: string;
  };

  lampPid: string;
  lampUnit: string;
  threadUnit: string;
  regUnit: string;
  metUnit: string;
  khoUnit: string;

  /** Địa chỉ SupplyState (tầng 3) — nơi thread NFT sống. */
  ssHash: string;
  ssAddr: string;
  /** KHO A-DEST = `treasury.ak`. DistributionVest bắt buộc rót LAMP vào đây. */
  treHash: string;
  treAddr: string;
  claimHash: string;
  accountPid: string;
  /** Beacon (Distribution) — nơi DROP NFT hạ cánh. Xem ghi chú "đúc hết trong Tx A". */
  beaconHash: string;
  beaconAddr: string;

  caps: { dist: bigint; reserve: bigint };
}

/** Script đã áp tham số — giữ riêng khỏi `CanonicalWiring` để state JSON không phình CBOR. */
export interface CanonicalScripts {
  oneshotSupply: MintingPolicy;
  oneshotReg: MintingPolicy;
  oneshotMet: MintingPolicy;
  treasuryNft: MintingPolicy;
  beaconNft: MintingPolicy;
  lampMint: MintingPolicy;
  supplyState: Validator;
  treasury: Validator;
  beacon: Validator;
}

export interface DeriveOptions {
  genesisTxHash: string;
  genesisIndex: number;
  pkh: string;
  tokenName: string;
  network?: Network;
}

/**
 * Tính TOÀN BỘ đường ống từ một hạt giống. KHÔNG chạm mạng, KHÔNG gửi gì.
 *
 * Thứ tự phụ thuộc là TUYẾN TÍNH, không vòng — đây là điều kiện để apply-param được:
 *   genesis_ref → {thread, reg, met, kho, beacon} pid
 *              → lamp_mint(12 tham số) → lampPid
 *              → supply_state(lampPid, threadPid, token_name) → ssAddr
 *              → claim_account_nft → claim_account → treasury → treAddr
 * `treasury_nft` chỉ phụ thuộc hạt giống, nên `kho_nft_policy` biết TRƯỚC `lampPid`;
 * còn `treAddr` biết SAU. Không có chiều ngược lại nào.
 */
export async function deriveWiring(
  o: DeriveOptions,
): Promise<{ wiring: CanonicalWiring; scripts: CanonicalScripts }> {
  const network = o.network ?? NETWORK;
  const genesisRef = encodeOutputRef(o.genesisTxHash, o.genesisIndex);

  // ── Tầng 1: bốn marker one-shot + beacon, cùng một hạt giống ──────────────
  // `oneshot_nft(genesis_ref, asset_name)` — asset_name là THAM SỐ, nên cùng một hạt
  // giống sinh ba policy-id khác nhau cho ba tên khác nhau, và cả ba đúc gọn trong
  // đúng giao dịch tiêu hạt giống (`oneshot_nft.ak` phần đầu).
  const oneshotCode = (await rawValidator("oneshot_nft.oneshot_nft.mint")).compiledCode;
  const oneshotSupply = applyPolicy(oneshotCode, [genesisRef, SUPPLY_NAME]);
  const oneshotReg    = applyPolicy(oneshotCode, [genesisRef, REG_NAME]);
  const oneshotMet    = applyPolicy(oneshotCode, [genesisRef, MET_NAME]);

  // KHO NFT dùng `treasury_nft.ak` chứ không phải `oneshot_nft`: ngoài tính one-shot nó
  // còn ÉP nơi hạ cánh — NFT phải nằm ở một Script, mang TreasuryDatum, sổ nợ mở = 0
  // (`treasury_nft.ak:42-52`). A-DEST đọc hash kho ĐỘNG từ chính ref input này, nên ràng
  // buộc "phải là script" là thứ giữ cho A-DEST không trỏ về một ví.
  const treasuryNft = { type: "PlutusV3" as const,
    script: (await applyDist("treasury_nft.treasury_nft.mint", [genesisRef])).script };
  // Beacon suy ra từ CÙNG hạt giống — không còn khe `BEACON_NFT_POLICY` phải gõ tay.
  const beaconNft = { type: "PlutusV3" as const,
    script: (await applyDist("beacon_nft.beacon_nft.mint", [genesisRef])).script };

  const threadPid = policyId(oneshotSupply);
  const regPid    = policyId(oneshotReg);
  const metPid    = policyId(oneshotMet);
  const khoPid    = policyId(treasuryNft);
  const beaconPid = policyId(beaconNft);

  // ── Tầng 2: lamp_mint 12 tham số ──────────────────────────────────────────
  // Thứ tự tham số lấy từ `lamp_mint.ak:97-108`. Sai thứ tự KHÔNG báo lỗi — nó ra một
  // policy-id khác, im lặng, và đó chính là lớp lỗi đã đẻ ra bản mồi mainnet.
  const lampMint = applyPolicy((await rawValidator("lamp_mint.lamp_mint.mint")).compiledCode, [
    threadPid, SUPPLY_NAME,          // #1-2  thread_nft_policy / name
    o.tokenName,                     // #3    token_name
    DIST_CAP, RESERVE_CAP,           // #4-5  cap 26,37 + 9,63 = 36 tỷ
    regPid, REG_NAME, TOKEN_TAG,     // #6-8  registry + token_tag (WHO-gate)
    khoPid, KHO_NAME,                // #9-10 kho NFT (A-DEST, hash kho đọc động)
    metPid, MET_NAME,                // #11-12 meter NFT — khe đã CHẾT ở bản mainnet
  ]);
  const lampPid = policyId(lampMint);

  // ── Tầng 3: supply_state ──────────────────────────────────────────────────
  const supplyState: Validator = {
    type: "PlutusV3",
    script: applyParamsToScript(
      (await rawValidator("supply_state.supply_state.spend")).compiledCode,
      [lampPid, threadPid, o.tokenName] as never,
    ),
  };
  const ssHash = hashOf(supplyState);

  // ── Distribution: claim_account → treasury (KHO), chia sẻ lampPid ─────────
  const committee = [o.pkh];
  const threshold = 1n;
  const accountPid = policyId({ type: "PlutusV3",
    script: (await applyDist("claim_account_nft.claim_account_nft.mint",
      [committee, threshold, khoPid])).script });
  const claimHash = hashOf(await applyDist("claim_account.claim_account.spend", [
    committee, threshold, MS_PER_EPOCH, lampPid, o.tokenName, beaconPid, khoPid, accountPid,
  ]));
  const treasury = { type: "PlutusV3" as const,
    script: (await applyDist("treasury.treasury.spend", [
      claimHash, lampPid, o.tokenName, committee, threshold, accountPid,
    ])).script };
  const treHash = hashOf(treasury);
  const beacon = { type: "PlutusV3" as const,
    script: (await applyDist("beacon.beacon.spend", [committee, threshold, beaconPid])).script };
  const beaconHash = hashOf(beacon);

  return {
    wiring: {
      network,
      genesisRef: { txHash: o.genesisTxHash, outputIndex: o.genesisIndex },
      pkh: o.pkh,
      tokenName: o.tokenName,
      markers: { threadPid, regPid, metPid, khoPid, beaconPid },
      lampPid,
      lampUnit:   toUnit(lampPid, o.tokenName),
      threadUnit: toUnit(threadPid, SUPPLY_NAME),
      regUnit:    toUnit(regPid, REG_NAME),
      metUnit:    toUnit(metPid, MET_NAME),
      khoUnit:    toUnit(khoPid, KHO_NAME),
      ssHash,
      ssAddr:  addrOf(ssHash, network),
      treHash,
      treAddr: addrOf(treHash, network),
      claimHash,
      accountPid,
      beaconHash,
      beaconAddr: addrOf(beaconHash, network),
      caps: { dist: DIST_CAP, reserve: RESERVE_CAP },
    },
    scripts: {
      oneshotSupply, oneshotReg, oneshotMet, treasuryNft, beaconNft,
      lampMint, supplyState, treasury, beacon,
    },
  };
}

// ── Datum dựng sẵn ───────────────────────────────────────────────────────────

/** `RegistryDatum = Constr(0, [governing_did, [RegistryEntry]])` (`registry.ak:41-44`). */
export function registryDatum(pkh: string, tag = TOKEN_TAG, did = GOV_DID): string {
  // RegistryEntry = Constr(0, [token_tag, Authority]); Authority.SinglePkh = Constr(0, [pkh]).
  return Data.to(new Constr(0, [fromText(did), [new Constr(0, [tag, new Constr(0, [pkh])])]]));
}

/**
 * `TreasuryDatum = Constr(0, [committee_hash, outstanding_entitlement])`
 * (`lampdist/types.ak:51-54`). Ghi thiếu trường thì `expect out_datum: TreasuryDatum`
 * hỏng ở MỌI nhánh `treasury.spend` ⇒ LAMP vào kho nằm chết, không nhánh nào rút ra.
 */
export function treasuryDatum(committeeHash: string, outstanding = 0n): string {
  return Data.to(new Constr(0, [committeeHash, outstanding]));
}

// ── State file ───────────────────────────────────────────────────────────────

export const STATE_PATH = resolve(__dirname, "canonical-v2-state.json");

export interface CanonicalState {
  wiring: CanonicalWiring;
  /** Giao dịch đã gửi, theo thứ tự các bước. Thiếu bước nào = bước đó chưa chạy. */
  tx: Partial<Record<"genesis" | "vest" | "reserveDraw", string>>;
  /** Số oildrop đã đúc theo từng đường, để verify đối chiếu với datum on-chain. */
  minted: { dist: string; reserve: string };
  /** Bằng chứng phủ định: đúc marker lượt hai bị chặn. */
  oneshotProof?: { attemptedAt: string; blocked: boolean; error: string };
}

export async function writeState(s: CanonicalState): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(s, null, 2) + "\n");
}

export async function readState(): Promise<CanonicalState> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8")) as CanonicalState;
  } catch {
    throw new Error(
      `chưa có ${STATE_PATH} — chạy '20_canonical_genesis.ts' trước. ` +
      `State này giữ genesis_ref; thiếu nó thì KHÔNG dựng lại được policy-id nào.`,
    );
  }
}

/**
 * Dựng lại wiring từ state ĐÃ GHI và ĐỐI CHIẾU lại từng policy-id.
 *
 * Không tin số trong JSON: tính lại từ `genesis_ref` rồi so. Lệch một chữ nghĩa là mã
 * hoặc blueprint đã đổi kể từ lượt genesis — và đi tiếp lúc đó là dựng giao dịch cho một
 * policy KHÁC cái đang giữ token.
 */
export async function rehydrate(): Promise<{
  state: CanonicalState; wiring: CanonicalWiring; scripts: CanonicalScripts;
}> {
  const state = await readState();
  const { wiring, scripts } = await deriveWiring({
    genesisTxHash: state.wiring.genesisRef.txHash,
    genesisIndex:  state.wiring.genesisRef.outputIndex,
    pkh:           state.wiring.pkh,
    tokenName:     state.wiring.tokenName,
    network:       state.wiring.network,
  });
  // So MỌI trường chuỗi, kể cả trong `markers` — đó chính là chỗ đáng canh nhất: policy-id
  // của marker lệch một chữ nghĩa là mọi bước sau dựng giao dịch cho một NFT khác.
  const drift = [
    ...(Object.keys(wiring) as Array<keyof CanonicalWiring>)
      .filter((k) => typeof wiring[k] === "string" && wiring[k] !== state.wiring[k]),
    ...(Object.keys(wiring.markers) as Array<keyof CanonicalWiring["markers"]>)
      .filter((k) => wiring.markers[k] !== state.wiring.markers?.[k])
      .map((k) => `markers.${k}`),
  ];
  if (drift.length) {
    throw new Error(
      `DRIFT: dựng lại từ genesis_ref ra khác state đã ghi ở ${drift.join(", ")}. ` +
      `Mã hoặc blueprint đã đổi sau lượt genesis. Đi tiếp = dựng tx cho một policy KHÁC ` +
      `cái đang giữ token. Kiểm 'git status' trong Genesis/onchain và Distribution/onchain.`,
    );
  }
  return { state, wiring, scripts };
}

/** In wiring ra màn hình theo một khuôn duy nhất, để log các bước đối chiếu được nhau. */
export function printWiring(w: CanonicalWiring): void {
  console.log(`genesis_ref:   ${w.genesisRef.txHash}#${w.genesisRef.outputIndex}`);
  console.log(`pkh:           ${w.pkh}`);
  console.log(`token_name:    ${w.tokenName}`);
  console.log(`thread(SUPPLY):${w.markers.threadPid}`);
  console.log(`registry(REG): ${w.markers.regPid}`);
  console.log(`meter(MET):    ${w.markers.metPid}`);
  console.log(`kho(TRSY):     ${w.markers.khoPid}`);
  console.log(`beacon(DROP):  ${w.markers.beaconPid}`);
  console.log(`lamp_policy:   ${w.lampPid}`);
  console.log(`supply_state:  ${w.ssHash}`);
  console.log(`   → addr:     ${w.ssAddr}`);
  console.log(`KHO(treasury): ${w.treHash}`);
  console.log(`   → addr:     ${w.treAddr}`);
  console.log(`claim_account: ${w.claimHash}`);
  console.log(`beacon:        ${w.beaconHash}`);
  console.log(`cap:           dist ${w.caps.dist} + reserve ${w.caps.reserve} oildrop`);
}
