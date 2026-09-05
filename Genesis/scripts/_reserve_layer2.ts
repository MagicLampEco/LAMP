// _reserve_layer2.ts — WIRING LỚP 2: đặt phanh lên nhánh Reserve.
//
// LỚP 1 ĐÃ CHỨNG MINH GÌ, VÀ NÓ THIẾU GÌ
//   Lớp 1 (`22_reserve_draw.ts`) chứng minh nhánh `ReserveDraw` của `lamp_mint` MỞ ĐƯỢC —
//   khác hẳn policy mồi mainnet, nơi `meter_nft_policy` là 28 byte 0 nên nhánh đó chết câm.
//   Nhưng ở Lớp 1, meter NFT nằm Ở VÍ. Khi nó bị tiêu, KHÔNG validator nào chạy. Nghĩa là:
//
//     đường thông  ✅          đường có phanh  ❌
//
//   Nói thẳng hệ quả: phát hành mainnet trong trạng thái đó thì người giữ khoá ví rút trọn
//   9,63 tỷ LAMP trong MỘT giao dịch, chi phí bằng phí mạng.
//
// LỚP 2 LÀ GÌ
//   Đưa meter NFT xuống dưới `reserve_draw.ak`. Lúc đó tiêu nó = chạy validator, và validator
//   ép bốn thứ mà ví không ép được (`reserve_draw.ak` Luật 3-4-5-7):
//     · ≤ 1 lượt rút mỗi epoch          (t > last_epoch)
//     · δ ≤ tổng/1000 mỗi epoch          (trần CỨNG ⇒ cạn pot mất ≥ 1000 epoch ≈ 13,7 năm)
//     · δ ≤ pot còn lại
//     · phải có auth NFT SPEND TỪ `reserve_gate` — tức phải kích cổng sàn của Treasury
//     · toàn bộ δ đi tới `reserve_dest`, ReserveState không được ôm LAMP
//
//   `reserve_draw.ak:16` chốt: "meter_nft = reserve_thread". Marker `MET` mà Lớp 1 đã đúc
//   đóng đúng vai đó — KHÔNG cần đúc lại, KHÔNG cần genesis mới. Lớp 2 hoàn toàn CỘNG THÊM
//   lên bản đã chạy: chỉ dời MET từ ví xuống địa chỉ `reserve_draw` kèm `ReserveState`.
//
// HAI HẠT GIỐNG, VÌ MỘT LUẬT ON-CHAIN BẮT THẾ
//   Lớp 1 gói mọi marker vào một hạt giống. Lớp 2 KHÔNG gói tiếp được: `custody_seed.ak`
//   có luật S-MINT-2 — `list.length(assets.policies(tx.mint)) == 1` — cấm giao dịch đúc
//   custody NFT mang thêm bất kỳ policy mint nào khác (least-authority). Nên custody NFT
//   phải đi một giao dịch RIÊNG, với hạt giống RIÊNG. Đó là ràng buộc của mã, không phải
//   lựa chọn ở đây; ghi ra để lần sau không ai "tối ưu" bằng cách gộp lại rồi gãy.
//
// THỨ TỰ PHỤ THUỘC — TUYẾN TÍNH, KHÔNG VÒNG
//   custodyRef → custody_seed → custodySeedPid
//              → custody(proposal_policy, custodySeedPid, ms_per_epoch) → custodyAddr
//   authRef    → reserve_auth(authRef, AUTH_NAME) → authPid
//   custodySeedPid + lampPid + authPid → reserve_gate(7 tham số) → gateHash
//   lampPid + metPid + custodyAddr + authPid + gateHash → reserve_draw(9 tham số) → drawAddr
//
//   `reserve_gate` KHÔNG nhận tham số nào của `reserve_draw` (`reserve_draw.ak:30-32` nói rõ
//   vì sao: "gate KHÔNG phụ thuộc reserve_draw → không vòng phụ thuộc"). Nếu chiều đó bị đảo
//   thì apply-param bất khả thi — hai script sẽ đòi hash của nhau.
import {
  Constr, Data, fromText, toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash, applyParamsToScript,
  type Data as LucidData, type Script, type Validator, type MintingPolicy, type Network,
} from "@lucid-evolution/lucid";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORK } from "./config.js";
import { assertParamCount as assertParamCountGate } from "../offchain/src/applyGate.js";
import type { CustodyDatum } from "../../Treasury/offchain/src/types.js";
import {
  MET_NAME, MS_PER_EPOCH, RESERVE_CAP, encodeOutputRef, type CanonicalWiring,
} from "./_canonical_v2.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Hằng Lớp 2 ───────────────────────────────────────────────────────────────

/** asset name auth NFT Treasury-pull — "TPULL". Cùng giá trị ở `reserve_draw` và `reserve_gate`. */
export const AUTH_NAME = fromText("TPULL");

/**
 * `instance_id` của custody, ĐỒNG THỜI là asset name custody NFT.
 * `custody_seed.ak` luật S-PARAM-0 ép `datum.instance_id == nft_name` — hai chỗ lệch nhau thì
 * giao dịch đúc bị từ chối, không phải cảnh báo.
 */
export const INSTANCE_ID = fromText("lamp-reserve");

/**
 * SÀN của cổng cầu (oildrop). `reserve_gate` chỉ nhả auth NFT khi custody đang giữ ÍT HƠN
 * ngần này LAMP — "chỉ kéo Reserve khi Treasury thực sự cạn".
 *
 * 1.000 LAMP cho màn diễn tập: đủ nhỏ để nạp qua sàn bằng một giao dịch, nên KIỂM ĐƯỢC CẢ HAI
 * CHIỀU (dưới sàn → mở; trên sàn → chặn). Con số mainnet là quyết định của Treasury, không
 * phải của tệp này.
 */
export const FLOOR_OILDROP = 1_000_000_000n;

/** Tổng pot Reserve — ĐÚNG BẰNG `reserve_cap` của SupplyState. Hai số này lệch là kế toán vỡ. */
export const RESERVE_TOTAL = RESERVE_CAP;

/** Trần CỨNG mỗi epoch = tổng/1000 (`Reserve/…/math.ak:17` + `release_epochs = 1000`). */
export const MAX_PER_EPOCH = RESERVE_TOTAL / 1000n;

/**
 * `proposal_policy` của `custody.ak` trong màn diễn tập: 28 byte 0.
 *
 * ⚠ ĐÂY LÀ CÙNG MỘT HÌNH với khuyết tật đã giết nhánh Reserve của policy mồi mainnet — chuỗi
 * 28 byte 0 không có tiền ảnh blake2b-224, nên KHÔNG proposal NFT nào tồn tại được dưới policy
 * đó, và nhánh chi-theo-proposal của custody đóng vĩnh viễn. Ở đây điều đó là CỐ Ý và VÔ HẠI:
 * màn này chỉ diễn tập đường KÉO (Reserve → custody), không diễn tập đường CHI (custody →
 * người nhận), và custody chỉ vào giao dịch với tư cách reference input nên validator của nó
 * không chạy.
 *
 * Nhưng khi lên mainnet mà vẫn để giá trị này thì LAMP vào custody sẽ nằm chết — và LAMP
 * KHÔNG burn được (`Treasury/CONTRACT.md §5`). Ghi ra to ở đây vì bài học của bản mồi đúng là:
 * một hằng 28 byte 0 trông y hệt một chỗ chưa điền.
 */
export const PROPOSAL_POLICY_PLACEHOLDER = "00".repeat(28);

// ── Blueprint Treasury + Reserve, fail-closed như `applyDist` ─────────────────

type RawV = { title: string; compiledCode: string; parameters?: unknown[] };
const cache = new Map<string, RawV[]>();

async function validatorsOf(module: "Treasury" | "Reserve"): Promise<RawV[]> {
  let v = cache.get(module);
  if (!v) {
    const p = resolve(__dirname, `../../${module}/onchain/plutus.json`);
    v = (JSON.parse(await readFile(p, "utf8")) as { validators: RawV[] }).validators;
    cache.set(module, v);
  }
  return v;
}

/**
 * Áp tham số, ÉP ĐÚNG số tham số blueprint khai.
 *
 * Vì sao phải gác: `applyParamsToScript` KHÔNG ném khi truyền THIẾU tham số — nó áp một phần
 * rồi trả về một script-hash khác, im lặng. Bản demo cũ ở `Faucet/scripts/demo_reserve_e2e.ts`
 * chính là ví dụ sống: nó truyền 2 tham số cho `custody.custody.spend` (blueprint khai 3) và 2
 * cho `custody_seed.custody_seed.mint` (blueprint khai 1). Cổng này biến cả hai thành lỗi đọc
 * được thay vì một địa chỉ sai không ai nhìn ra.
 */
async function applyOf(module: "Treasury" | "Reserve", title: string, params: unknown[]): Promise<Script> {
  const v = (await validatorsOf(module)).find((x) => x.title === title);
  if (!v) {
    throw new Error(
      `${module} '${title}' không có trong plutus.json — chạy 'aiken build' trong ${module}/onchain/.`,
    );
  }
  if (!Array.isArray(v.parameters)) {
    throw new Error(
      `APPLY-001: blueprint KHÔNG khai 'parameters' cho '${title}' — không suy đoán số tham số. ` +
      `Chạy lại 'aiken build' trong ${module}/onchain/ rồi thử lại.`,
    );
  }
  assertParamCountGate(title, v.parameters.length, params.length);
  return { type: "PlutusV3", script: applyParamsToScript(v.compiledCode, params as never) };
}

const hashOf = (s: Script) => validatorToScriptHash(s as Validator);
const addrOf = (h: string, n: Network) => credentialToAddress(n, scriptHashToCredential(h));

/**
 * `Address = Constr(0, [payment_credential, Option<stake_credential>])`.
 * Script credential = `Constr(1, [hash])`; `None` = `Constr(1, [])`.
 *
 * Stake credential ở đây KHÔNG quan trọng: `reserve_draw` Luật 9 dùng `qty_to_credential`, so
 * **payment credential** thôi (`Reserve/…/util.ak:97-113`). Nhưng nó vẫn nướng vào script hash,
 * nên phải cố định — không được để bên gọi tuỳ ý.
 */
export function scriptAddressData(scriptHash: string): Constr<LucidData> {
  return new Constr(0, [new Constr(1, [scriptHash]), new Constr(1, [])]);
}

// ── Kết quả wiring Lớp 2 ─────────────────────────────────────────────────────

export interface ReserveWiring {
  /** Hạt giống RIÊNG cho custody NFT — bắt buộc riêng vì luật S-MINT-2 (xem đầu tệp). */
  custodyRef: { txHash: string; outputIndex: number };
  /** Hạt giống RIÊNG cho auth NFT. Có thể trùng giao dịch với việc dời MET, không trùng UTxO. */
  authRef: { txHash: string; outputIndex: number };

  custodySeedPid: string;
  custodyNftUnit: string;
  custodyHash: string;
  custodyAddr: string;

  authPid: string;
  authUnit: string;

  gateHash: string;
  gateAddr: string;

  drawHash: string;
  drawAddr: string;

  floorOildrop: bigint;
  reserveTotal: bigint;
  maxPerEpoch: bigint;
}

export interface ReserveScripts {
  custodySeed: MintingPolicy;
  custody: Validator;
  auth: MintingPolicy;
  gate: Validator;
  draw: Validator;
}

/**
 * Phần két, tách riêng vì nó KHÔNG phụ thuộc auth NFT.
 *
 * Tách ra là điều kiện để giao dịch đúc custody chạy TRƯỚC khi chọn hạt giống auth. Thứ tự đó
 * quan trọng: giao dịch đúc custody có coin-selection, và coin-selection có quyền tiêu bất kỳ
 * UTxO nào trong ví — kể cả cái vừa được chọn làm hạt giống auth. Chọn hạt giống auth SAU khi
 * custody đã lên chuỗi thì không còn cửa đó. (Bản demo cũ chọn cả bốn hạt giống trước rồi phải
 * dựng một câu lỗi để bắt đúng cảnh này — `demo_reserve_e2e.ts` bước A1.)
 */
export async function deriveCustody(
  custodyTxHash: string, custodyIndex: number, network: Network = NETWORK,
): Promise<{
  custodySeed: MintingPolicy; custody: Validator;
  custodySeedPid: string; custodyNftUnit: string; custodyHash: string; custodyAddr: string;
}> {
  // CỔNG POISON-002, fail-closed trên mạng thật.
  //
  // Vì sao phải đặt Ở ĐÂY chứ không dựa vào cổng đã có: `_guards.ts::isPoison` bắt đúng lớp lỗi
  // này (toàn 0 / toàn f, "đúng dạng" nên đi lọt), nhưng nó chỉ chạy trong `requiredHashParam`
  // /`requiredHexParam` — tức chỉ cho tham số ĐỌC TỪ ENV. Một hằng gõ cứng trong mã không đi
  // qua cổng nào. Cổng dựng ra để chặn lớp lỗi này mù đúng chỗ lớp lỗi đó đang nằm.
  if (network === "Mainnet" && /^0+$|^f+$/i.test(PROPOSAL_POLICY_PLACEHOLDER)) {
    throw new Error(
      `POISON-002: deriveCustody() chạy trên Mainnet với proposal_policy = ` +
        `${PROPOSAL_POLICY_PLACEHOLDER.slice(0, 8)}…(${PROPOSAL_POLICY_PLACEHOLDER.length / 2} byte) — ` +
        `GIÁ TRỊ CHẾT. Chuỗi toàn 0 / toàn f không có tiền ảnh blake2b-224 ⇒ không proposal NFT ` +
        `nào tồn tại được dưới policy đó ⇒ nhánh chi-theo-proposal của custody đóng VĨNH VIỄN, và ` +
        `LAMP đã vào két thì không burn được (Treasury/CONTRACT.md §5). Đây đúng cùng một hình ` +
        `với khuyết tật đã giết nhánh Reserve của policy mồi mainnet. Truyền proposal_policy thật ` +
        `vào deriveCustody() trước khi chạy mạng này.`,
    );
  }

  const custodyRef = encodeOutputRef(custodyTxHash, custodyIndex);
  const custodySeed = { type: "PlutusV3" as const,
    script: (await applyOf("Treasury", "custody_seed.custody_seed.mint", [custodyRef])).script };
  const custodySeedPid = validatorToScriptHash(custodySeed as Validator);

  const custody = await applyOf("Treasury", "custody.custody.spend", [
    PROPOSAL_POLICY_PLACEHOLDER,  // #1 proposal_policy — xem cảnh báo 28 byte 0 ở trên
    custodySeedPid,               // #2 seed_policy — ghim NFT one-shot làm định danh két
    MS_PER_EPOCH,                 // #3 ms_per_epoch
  ]) as Validator;
  const custodyHash = hashOf(custody);
  return {
    custodySeed, custody, custodySeedPid,
    custodyNftUnit: toUnit(custodySeedPid, INSTANCE_ID),
    custodyHash, custodyAddr: addrOf(custodyHash, network),
  };
}

export interface ReserveDeriveOptions {
  custodyTxHash: string;
  custodyIndex: number;
  authTxHash: string;
  authIndex: number;
  network?: Network;
}

/**
 * Tính wiring Lớp 2 từ wiring Lớp 1 + hai hạt giống. KHÔNG chạm mạng, KHÔNG gửi gì.
 *
 * `w` phải là wiring Lớp 1 ĐÃ triển khai — `lampPid`, `metPid` và `treAddr` của nó nướng thẳng
 * vào `reserve_gate` và `reserve_draw`, nên hai lớp buộc phải cùng một bản. Truyền nhầm wiring
 * của lần chạy khác thì ra một `drawAddr` khác, và MET dời xuống đó sẽ nằm ở một script mà
 * `lamp_mint` hiện hành không công nhận: MET kẹt, nhánh Reserve đóng, không lấy lại được.
 */
export async function deriveReserveWiring(
  w: CanonicalWiring,
  o: ReserveDeriveOptions,
): Promise<{ reserve: ReserveWiring; scripts: ReserveScripts }> {
  const network = o.network ?? NETWORK;
  const custodyRef = encodeOutputRef(o.custodyTxHash, o.custodyIndex);
  const authRef = encodeOutputRef(o.authTxHash, o.authIndex);

  if (o.custodyTxHash === o.authTxHash && o.custodyIndex === o.authIndex) {
    throw new Error(
      "SEED-001: custodyRef và authRef là CÙNG một UTxO. Mỗi one-shot phải tiêu một UTxO riêng — " +
      "dùng chung thì giao dịch thứ hai không còn gì để tiêu và policy đó không bao giờ đúc được.",
    );
  }

  // ── custody: seed one-shot → két ────────────────────────────────────────────
  const { custodySeed, custody, custodySeedPid, custodyHash, custodyAddr } =
    await deriveCustody(o.custodyTxHash, o.custodyIndex, network);

  // ── auth NFT: credential "kéo" của Treasury ─────────────────────────────────
  const auth = { type: "PlutusV3" as const,
    script: (await applyOf("Treasury", "reserve_auth.reserve_auth.mint", [authRef, AUTH_NAME])).script };
  const authPid = validatorToScriptHash(auth as Validator);

  // ── gate: nơi DUY NHẤT ép sàn ───────────────────────────────────────────────
  // Thứ tự tham số lấy từ `reserve_gate.ak:57-65`. Sai thứ tự không báo lỗi — ra một
  // gateHash khác, và `reserve_draw` sẽ đòi auth NFT ở một script không tồn tại ⇒ nhánh
  // Reserve đóng câm, giống hệt kiểu hỏng của bản mồi mainnet.
  const gate = await applyOf("Treasury", "reserve_gate.reserve_gate.spend", [
    custodySeedPid, INSTANCE_ID,   // #1-2 custody NFT (đọc parked từ đúng két thật)
    w.lampPid, w.tokenName,        // #3-4 LAMP (đo parked)
    FLOOR_OILDROP,                 // #5   sàn
    authPid, AUTH_NAME,            // #6-7 auth NFT bị khoá tại đây
  ]);
  const gateHash = hashOf(gate);

  // ── draw: nơi ép trần nhịp ──────────────────────────────────────────────────
  // Thứ tự tham số lấy từ `reserve_draw.ak:43-53`.
  const draw = await applyOf("Reserve", "reserve_draw.reserve_draw.spend", [
    w.lampPid, w.tokenName,                 // #1-2 LAMP — đo Δ mint
    w.markers.metPid, MET_NAME,             // #3-4 meter NFT = reserve thread (`reserve_draw.ak:16`)
    MS_PER_EPOCH,                           // #5   mẫu số quy đổi epoch
    scriptAddressData(custodyHash),         // #6   reserve_dest = két Treasury
    authPid, AUTH_NAME,                     // #7-8 auth NFT Treasury-pull
    gateHash,                               // #9   auth PHẢI được tiêu TỪ gate này
  ]);
  const drawHash = hashOf(draw);

  return {
    reserve: {
      custodyRef: { txHash: o.custodyTxHash, outputIndex: o.custodyIndex },
      authRef: { txHash: o.authTxHash, outputIndex: o.authIndex },
      custodySeedPid,
      custodyNftUnit: toUnit(custodySeedPid, INSTANCE_ID),
      custodyHash,
      custodyAddr,
      authPid,
      authUnit: toUnit(authPid, AUTH_NAME),
      gateHash,
      gateAddr: addrOf(gateHash, network),
      drawHash,
      drawAddr: addrOf(drawHash, network),
      floorOildrop: FLOOR_OILDROP,
      reserveTotal: RESERVE_TOTAL,
      maxPerEpoch: MAX_PER_EPOCH,
    },
    scripts: { custodySeed, custody, auth, gate, draw },
  };
}

// ── Datum ────────────────────────────────────────────────────────────────────

/**
 * `ReserveState = Constr(0, [start_epoch, total_oildrop, drawn_oildrop, last_epoch])`
 * (`Reserve/…/types.ak:19-24`).
 *
 * `start_epoch` và `total_oildrop` là BẤT BIẾN — `reserve_draw` Luật 7 ép mọi lượt rút giữ
 * nguyên hai trường này. Ghi sai ở lượt khởi tạo là sai vĩnh viễn: không nhánh nào sửa được.
 */
export function reserveStateDatum(
  startEpoch: bigint, total = RESERVE_TOTAL, drawn = 0n, lastEpoch = 0n,
): string {
  return Data.to(new Constr(0, [startEpoch, total, drawn, lastEpoch]));
}

/** Datum của gate = `Void` (`reserve_gate.ak:66` — gate không giữ trạng thái, chỉ là khoá logic). */
export const VOID_DATUM = Data.to(new Constr(0, []));

/**
 * `CustodyDatum` khởi tạo — SỔ RỖNG.
 *
 * `custody_seed.ak` luật S-SEED-0 gọi `collect.seed_value_ok`, và luật đó là một đẳng thức
 * CHÍNH XÁC (`collect.ak:202-206`):
 *
 *     value == value_of(ledger) + lovelace(reserved_min_ada) + NFT(policy, name, 1)
 *
 * NFT được CỘNG THÊM ngoài sổ. Nên ghi custody NFT thành một dòng sổ là đếm nó HAI LẦN: vế
 * phải đòi NFT qty 2, output chỉ có 1, giao dịch bị từ chối. Bản demo cũ
 * (`Faucet/scripts/demo_reserve_e2e.ts`) ghi đúng dòng đó — thêm một dấu nữa cho thấy nó viết
 * trước bản `custody_seed` hiện hành.
 *
 * Sổ rỗng cũng làm S-ACC-0 (mọi dòng thuộc `accepted_assets`) và S-LEDGER-0 (sổ canonical)
 * đúng hiển nhiên, và `reserved_min_ada` khi đó PHẢI đúng bằng lovelace đặt lên output.
 */
/**
 * Datum cho lượt SINH custody.
 *
 * `governanceRef` BẮT BUỘC và phải là script hash thật 28 byte — không có mặc định.
 *
 * Vì sao không cho rỗng: `custody.ak:79` và `:133` ép `governance_ref` BẤT BIẾN ở cả hai
 * nhánh, nên giá trị ghi ở đây là giá trị vĩnh viễn của instance; và `release.ak:52-53` dùng
 * nó làm cổng cứng. Ghi rỗng một lần ⇒ nhánh `Release` không bao giờ thoả ⇒ két chỉ NHẬN,
 * không bao giờ CHI ⇒ mọi LAMP vào đó mất vĩnh viễn, mà LAMP KHÔNG burn được
 * (`Treasury/CONTRACT.md §5`). Bản trước điền `""` lặng lẽ; nay `custody_seed.ak` luật
 * S-GOV-0 từ chối thẳng, và cổng dưới đây bắt sớm hơn với câu nói được nguyên nhân.
 */
export function custodySeedDatum(
  lampPid: string, tokenName: string, governanceRef: string,
): CustodyDatum {
  if (!/^[0-9a-fA-F]{56}$/.test(governanceRef)) {
    throw new Error(
      `GOV-REF-001: governance_ref = "${governanceRef}" — cần script hash 28 byte (56 ký tự hex). ` +
        `Trường này BẤT BIẾN sau lượt sinh (custody.ak:79,133) và là cổng cứng của nhánh Release ` +
        `(release.ak:52-53). Sai một lần là két thành hố một chiều: LAMP vào được, không bao giờ ` +
        `ra, và không đốt được. Truyền script hash của validator governance thật.`,
    );
  }
  return {
    instance_id: INSTANCE_ID,
    // S-ACC-1 đòi danh sách KHÔNG rỗng. Két này nhận LAMP (Reserve rót vào) và lovelace.
    accepted_assets: [
      { policy: lampPid, name: tokenName },
      { policy: "", name: "" },                       // "" / "" = lovelace (quy ước types.ts:10-11)
    ],
    ledger: [],
    cut_bps: 1000n,
    governance_ref: governanceRef,
    epoch: 0n,
    consumed_proposals: [],
  };
}

/** Epoch hiện tại theo mẫu số của mạng. Lùi 90 s cho an toàn biên (giống `reserve_draw` đọc lower_bound). */
export function epochNow(msPerEpoch = MS_PER_EPOCH): bigint {
  return BigInt(Math.floor((Date.now() - 90_000) / Number(msPerEpoch)));
}

/**
 * Cửa sổ hiệu lực cho một lượt rút: `lo` và `hi` PHẢI rơi cùng một epoch.
 *
 * `reserve_draw` Luật 2b ép `hi / ms_per_epoch == t` với `t` tính từ `lo`. Không ép thì epoch
 * trôi theo ttl của node và người rút chọn được nhịp. Hàm này kéo `hi` về sát cuối epoch khi
 * cửa sổ mặc định vắt qua biên.
 */
export function drawWindow(msPerEpoch = MS_PER_EPOCH): { loMs: number; hiMs: number; t: bigint } {
  const loMs = Date.now() - 60_000;
  const t = BigInt(Math.floor(loMs / Number(msPerEpoch)));
  let hiMs = loMs + 90_000;
  if (BigInt(Math.floor(hiMs / Number(msPerEpoch))) !== t) {
    hiMs = Number((t + 1n) * msPerEpoch) - 1000;
  }
  return { loMs, hiMs, t };
}

export function printReserveWiring(r: ReserveWiring): void {
  console.log(`custody seed:  ${r.custodySeedPid}`);
  console.log(`custody addr:  ${r.custodyAddr}`);
  console.log(`auth policy:   ${r.authPid}`);
  console.log(`gate addr:     ${r.gateAddr}`);
  console.log(`draw addr:     ${r.drawAddr}`);
  console.log(`sàn:           ${r.floorOildrop} oildrop`);
  console.log(`trần/epoch:    ${r.maxPerEpoch} oildrop (= tổng ${r.reserveTotal} / 1000)`);
}
