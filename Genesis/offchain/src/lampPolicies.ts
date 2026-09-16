// lampPolicies — SỔ POLICY LAMP/tLAMP theo mạng. **NƠI GIỮ DUY NHẤT của policy id testnet.**
//
// VÌ SAO CÓ TỆP NÀY (nguyên nhân gốc, không phải tiện tay gom):
//   Trên Preprod có HAI policy tLAMP cùng được gọi là "canonical" trong tài liệu:
//   `7a1a7aed…` (marker neo bằng native-sig ví deploy) và `d9c09230…` (marker one-shot theo
//   genesis_ref). Không tệp nào trong repo nói cái nào thay cái nào, nên mỗi nhà đọc phải một
//   bản khác nhau rồi gõ cứng giá trị mình gặp trước. Bản sao kiểu đó chết IM LẶNG: nó không
//   sai cú pháp, không đỏ test, chỉ trỏ vào một token khác.
//
//   Chỗ này giữ GIÁ TRỊ + TRẠNG THÁI. Trạng thái mới là phần mà một hằng số trần không mang
//   được: "bản này đã bị thay bởi bản nào" là thứ duy nhất cứu được người đọc sau.
//
// VÌ SAO KHÔNG ĐẶT Ở `.env`:
//   `.env` bị `.gitignore` chặn ⇒ người clone kho về KHÔNG thấy gì, và quy ước nội bộ cấm agent
//   đọc `.env` của project con. Cơ chế "ai đọc phải cũng biết" sẽ chết đúng ở chỗ nó cần sống.
//   Nguồn phải là tệp ĐƯỢC GIT THEO DÕI và IMPORT ĐƯỢC.
//
// CÁCH DÙNG — đọc bằng hàm, đừng đọc bằng mắt rồi chép:
//   import { activeLampPolicyId } from "@magiclamp/genesis-sdk";
//   const pid = activeLampPolicyId("preprod");   // ném nếu chưa có bản ACTIVE
//
// ⚠ KHÔNG SỬA `policyId` của một bản ghi đã lên chuỗi. Định danh on-chain là bất biến lịch sử.
//   Thay bản mới = THÊM một bản ghi + đặt `supersededBy` ở bản cũ. Không ghi đè.

import { LAMP_MAINNET, type LampNetwork } from "./deployed.js";

export type { LampNetwork };

/** Vòng đời một policy trong sổ. */
export type PolicyStatus =
  /** Đang là bản canonical của mạng đó. Mỗi mạng nhiều nhất MỘT bản ACTIVE. */
  | "ACTIVE"
  /** Đã bị một bản khác thay. Vẫn có token trên chuỗi, nhưng KHÔNG được dùng cho tích hợp mới. */
  | "SUPERSEDED"
  /** Đã chốt sẽ đúc, CHƯA đúc ⇒ chưa có policy id. Đọc ra phải NÉM, không được trả rỗng. */
  | "PENDING-MINT";

/** Cách bốn khe marker của `lamp_mint` được neo — quyết định policy có đúc lại được không. */
export type MintAnchor =
  /** Marker đúc dưới `scriptFromNative({type:"sig"})` ⇒ MỘT khoá đúc lại được bao nhiêu lần tuỳ ý. */
  | "native-sig-markers"
  /** Marker đúc dưới `oneshot_nft.ak` (genesis_ref + asset_name) ⇒ hạt giống tiêu rồi là hết. */
  | "oneshot-markers"
  /** Không có marker registry: WHO-gate là danh sách pkh nướng sẵn vào tham số (bản mainnet 8 tham số). */
  | "baked-pkh-list";

export interface LampPolicyRecord {
  /** Khoá tra cứu, duy nhất toàn sổ. Đặt theo `<mạng>-<cách neo>-<số tham số>`, KHÔNG theo trạng thái
   *  (trạng thái đổi, khoá thì không được đổi — đổi khoá là làm gãy mọi `supersededBy` trỏ tới nó). */
  id: string;
  network: LampNetwork;
  /** Asset name (hex). `4c414d50` = "LAMP", `744c414d50` = "tLAMP". */
  assetName: string;
  /** `null` ⇔ `status === "PENDING-MINT"`. Mọi giá trị khác phải là 56 ký tự hex thường. */
  policyId: string | null;
  status: PolicyStatus;
  /** Số tham số apply-param của `lamp_mint` đã dùng. Đổi số này ⇒ policy id KHÁC. */
  mintParamCount: 8 | 12 | 14;
  anchor: MintAnchor;
  /** Một câu nói rõ hệ quả của cách neo, để người đọc không phải suy. */
  anchorNote: string;
  /** `id` của bản ghi đã thay bản này. `null` khi chưa bị thay. */
  supersededBy: string | null;
  /** Ngày ghi/ cập nhật bản ghi (YYYY-MM-DD). */
  recordedAt: string;
  /** Con trỏ kiểm được: `tệp:dòng`, tx hash, tệp trạng thái. Không có thì đừng ghi bản ghi. */
  evidence: string[];
  /** Thứ phải đọc trước khi tích hợp. */
  caveats: string[];
}

/**
 * tLAMP đúc bởi `canonical_mint.ts` (đã xoá khỏi kho — tra
 * `git show 930480e:Genesis/scripts/canonical_mint.ts`) — policy id GIỐNG NHAU trên Preprod
 * và Preview.
 * Giống nhau KHÔNG phải trùng hợp: cả bốn khe marker đều là policy của
 * `scriptFromNative({type:"sig", keyHash: pkh_ví_deploy})`, mà native-sig chỉ phụ thuộc khoá
 * ⇒ mạng nào cũng ra cùng một giá trị. Chính tính chất làm nó "tiện" là tính chất làm nó hỏng.
 * Khai MỘT LẦN ở đây, hai bản ghi bên dưới cùng trỏ vào — không gõ lại chuỗi lần thứ hai.
 */
const NATIVE_SIG_TLAMP_POLICY_ID =
  "7a1a7aed5ec47acc37b6fa82695c1219bf76895b505b01161367adf9";

const NATIVE_SIG_ANCHOR_NOTE =
  "Bốn khe marker (thread/registry/kho/meter) đều trỏ vào policy native-sig của ví deploy " +
  "(`Genesis/scripts/canonical_mint.ts:109-123` — tệp đã xoá khỏi kho, tra " +
  "`git show 930480e:Genesis/scripts/canonical_mint.ts`). " +
  "Native-sig KHÔNG one-shot ⇒ người giữ MỘT khoá " +
  "đúc lại SUPPLY NFT lượt hai ⇒ dựng SupplyState thứ hai với `dist_minted = 0` ⇒ đúc lại trọn cap; " +
  "và đúc MET giữ ở ví ⇒ nhánh ReserveDraw thoả mà không validator nào chạy. Hệ quả ghi nguyên văn " +
  "ở `Genesis/scripts/_guards.ts:52-56` (`CONSEQUENCE_REMINTABLE_MARKERS`).";

/** Bảng tra CHÍNH. Thứ tự trong mảng không mang nghĩa — tra bằng `id` hoặc bằng `network`. */
export const LAMP_POLICY_REGISTRY: readonly LampPolicyRecord[] = [
  // ── MAINNET ────────────────────────────────────────────────────────────────
  {
    // Giá trị lấy TỪ `LAMP_MAINNET`, không gõ lại: `deployed.ts` vẫn là nơi giữ bản ghi mainnet
    // đầy đủ (mintParams + provenance). Sổ này chỉ thêm TRẠNG THÁI cho nó.
    id: "mainnet-baked-pkh-8param",
    network: "mainnet",
    assetName: LAMP_MAINNET.assetName,
    policyId: LAMP_MAINNET.policyId,
    status: "ACTIVE",
    mintParamCount: LAMP_MAINNET.mintParamCount,
    anchor: "baked-pkh-list",
    anchorNote:
      "WHO-gate = danh sách pkh nướng sẵn + ngưỡng chữ ký, KHÔNG đọc registry. " +
      "Chi tiết + toàn bộ tham số: `Genesis/offchain/src/deployed.ts` khối `LAMP_MAINNET`.",
    supersededBy: null,
    recordedAt: "2026-09-11",
    evidence: [
      "Genesis/offchain/src/deployed.ts:61-123 (bản ghi đầy đủ, provenance byteMatch)",
      "tx genesis mainnet `db0610c2…` (deployed.ts:57)",
    ],
    caveats: [
      "Bản MỒI. Sẽ bị thay bởi policy uỷ quyền OrgDID — policy id SẼ KHÁC. Đừng nhúng cứng.",
      "Nhánh ReserveDraw chết vĩnh viễn: `meter_nft_policy` = 28 byte 0 (deployed.ts:92-93).",
    ],
  },

  // ── PREPROD ────────────────────────────────────────────────────────────────
  {
    id: "preprod-native-sig-12param",
    network: "preprod",
    assetName: "744c414d50",
    policyId: NATIVE_SIG_TLAMP_POLICY_ID,
    status: "SUPERSEDED",
    mintParamCount: 12,
    anchor: "native-sig-markers",
    anchorNote: NATIVE_SIG_ANCHOR_NOTE,
    supersededBy: "preprod-oneshot-12param",
    recordedAt: "2026-09-11",
    evidence: [
      "Faucet/deployed-artifacts.md:15-19 (policy id + câu khai native-sig, không one-shot)",
      "Faucet/scripts/deployed-faucet.preprod.json:6",
      "Genesis/scripts/canonical_mint.ts:109-123 (đường đúc: native marker + lamp_mint 12 tham số; " +
        "tệp đã xoá khỏi kho, tra `git show 930480e:Genesis/scripts/canonical_mint.ts`)",
    ],
    caveats: [
      "ĐANG CÓ HẠ NGUỒN GÕ CỨNG giá trị này (CarpetMint). Đổi sang bản mới là việc DI TRÚ có " +
        "lịch, không phải việc sửa một dòng — bản cũ vẫn còn token trên chuỗi và vẫn tiêu được.",
      "`mintParamCount: 12` là SUY từ đường đúc (`canonical_mint.ts`, đã xoá khỏi kho — tra " +
        "`git show 930480e:Genesis/scripts/canonical_mint.ts`, truyền 12 giá trị), CHƯA " +
        "đối chiếu byte với bytecode trên chuỗi. Cần chắc thì đọc ngược `/script_info` rồi dựng lại.",
      "Ba tệp `Faucet/scripts/deployed-faucet*.json` từng khai bản này là 'registry-gate + A-DEST' " +
        "trống trơn. Validator ĐÚNG là registry-gate, nhưng câu đó bỏ mất vế quyết định: marker " +
        "neo bằng native-sig ⇒ cổng WHO có thật mà trần 36 tỷ thì không.",
    ],
  },
  {
    id: "preprod-oneshot-12param",
    network: "preprod",
    assetName: "744c414d50",
    policyId: "d9c09230079b810ab5ed92e8db4c190d42efc42db6aac028656f7e07",
    status: "SUPERSEDED",
    mintParamCount: 12,
    anchor: "oneshot-markers",
    anchorNote:
      "Marker đúc bằng `oneshot_nft.ak` neo `genesis_ref` = `525b80f4…e301#1`; hạt giống đã tiêu ⇒ " +
      "lượt đúc SUPPLY NFT thứ hai bị chặn (bằng chứng phủ định ghi trong " +
      "`Genesis/scripts/canonical-v2-state.json` khối `oneshotProof`).",
    supersededBy: "preprod-oneshot-14param",
    recordedAt: "2026-09-11",
    evidence: [
      "Genesis/scripts/canonical-v2-state.json (`wiring.lampPid`, `tx.*`, `oneshotProof.blocked`)",
      "Genesis/canonical-preprod-runbook.md:148",
      "Genesis/mainnet-deploy-plan.md:149",
    ],
    caveats: [
      "Sinh từ bản `lamp_mint` **12 tham số**. Mã hôm nay là **14** " +
        "(`Genesis/onchain/validators/lamp_mint.ak:9`, `:60`) ⇒ dựng lại từ mã hiện tại ra policy " +
        "id KHÁC. Không có đường 'build lại cho khớp' — tham số nằm TRONG policy id.",
      "Cổng APPLY-001 (`Genesis/offchain/src/applyGate.ts:25`) sẽ ném nếu ai chạy lại đường 12 " +
        "tham số trên blueprint 14 — đó là hành vi ĐÚNG, đừng nới cổng để 'chạy cho xong'.",
    ],
  },
  {
    // `id` GIỮ NGUYÊN từ lúc bản ghi này còn PENDING-MINT. `preprod-oneshot-12param`
    // đang trỏ tới đúng chuỗi này ở `supersededBy` — đổi `id` là gãy con trỏ đó, im lặng.
    id: "preprod-oneshot-14param",
    network: "preprod",
    assetName: "744c414d50",
    policyId: "8169b76cdaba83cf7c9ae32ebd2bb3a58aa215c7dc0b62c8f5e268dd",
    status: "ACTIVE",
    mintParamCount: 14,
    anchor: "oneshot-markers",
    anchorNote:
      "Đúc theo đường registry-gate với `lamp_mint` 14 tham số " +
      "(`Genesis/onchain/validators/lamp_mint.ak`). Cả bốn khe marker neo `oneshot_nft.ak` — " +
      "cổng `MARKER-001` của `20_canonical_genesis.ts` đã xác nhận không khe nào là native-sig " +
      "trước khi dựng giao dịch. Hạt giống genesis: `a00ab3de…1fee#5`. Khe #13-14 " +
      "(`reserve_kho_nft_*`) = policy id của `custody_seed` áp trên hạt giống custody " +
      "`a00ab3de…1fee#4`, tức `b4f9a9ee5373f5201928f0db79e6ba87fff2f06b920cef743d42ce23`.",
    supersededBy: null,
    recordedAt: "2026-09-14",
    evidence: [
      "Tx A (genesis, 5 marker one-shot): 612525047f0912518ca53aae732aa11fc418d38b8b55f84ceb84fc9b81ed36a6",
      "Tx B (DistributionVest → KHO): 47679b091e4db1d633efbd28f0747dfb8ddc0ddf403128c6f2bafe4532e2da39",
      "Blockfrost preprod /addresses/addr_test1wqcnq8kkza7kw8409pt8ytywgeat4strz5sxt0g5wdl9a8q0r2v2g/utxos " +
        "(2026-09-14): kho giữ 10000000000 oildrop dưới đúng policy này.",
      "Blueprint dựng lại từ mã cùng lượt: `lamp_mint.lamp_mint.mint` khai 14 tham số.",
    ],
    caveats: [
      "Đây là bản ACTIVE DUY NHẤT của preprod. `activeLampPolicyId(\"preprod\")` nay TRẢ VỀ " +
        "thay vì ném. Đường đọc không đổi, nhưng ĐỪNG đọc câu đó thành \"không có gì đổi\": " +
        "có một van fail-closed cắm đúng vào cái NÉM đó, và nó vừa mở. " +
        "`Treasury/scripts/custodyParams.ts::resolveLampPolicy` bắt `LampPolicySourceError` " +
        "rồi lùi về `PLACEHOLDER_LAMP_POLICY`; `Treasury/scripts/01_seed_custody.ts` khai khe " +
        "`lamp_policy` là placeholder khi `source === \"placeholder\"`, và đó là MỘT trong các " +
        "van F14 ép rơi về DRY. Từ nay Preprod không còn nằm trong danh sách đó. " +
        "Nói đúng mức: F14 ghép bằng VÀ trên nhiều tham số, nên riêng van này mở CHƯA làm " +
        "Preprod chạy LIVE — `proposal_policy`/`governance_ref`/`delegation_admin` vẫn " +
        "placeholder nếu không đặt biến. Đây là mất MỘT lớp, không phải thủng.",
      "Hệ quả thứ hai, xuyên module: `lamp_policy` là apply-param #4 của `custody` " +
        "(`Treasury/scripts/custodyParams.ts::custodyParamList`), nên nó nướng vào " +
        "`custody_hash` và `custodyAddr`. Trước bản ghi này Preprod áp `PLACEHOLDER_LAMP_POLICY`; " +
        "từ nay áp `8169b76c…`. Cùng một mã, KHÁC địa chỉ két. Địa chỉ custody Preprod nào đã " +
        "được chép ra ngoài trước 2026-09-14 thì nay lệch, và không dòng nào tự kêu.",
      "Lớp 2 (rút Reserve) CHƯA chạy: `24_reserve_layer2_init.ts` dừng ở `GOV-REF-001` vì " +
        "`GOVERNANCE_SCRIPT_HASH` chưa có giá trị, và trong kho chưa có validator nào tên " +
        "`governance`. Nên policy này đã đúc được và rót vào kho được, nhưng nhánh `ReserveDraw` " +
        "của nó chưa có lượt chạy nào trên chuỗi — đừng đọc 'ACTIVE' thành 'mọi nhánh đã thông'.",
      "Cổng `POISON-002` trong `deriveCustody` chỉ fail-closed khi `network === \"Mainnet\"`; " +
        "trên preprod `proposal_policy` giữ chỗ đi lọt CÓ CHỦ Ý. Một lượt preprod xanh KHÔNG " +
        "chứng minh nhánh chi của két thông.",
    ],
  },

  // ── PREVIEW ────────────────────────────────────────────────────────────────
  {
    id: "preview-native-sig-12param",
    network: "preview",
    assetName: "744c414d50",
    policyId: NATIVE_SIG_TLAMP_POLICY_ID,
    status: "SUPERSEDED",
    mintParamCount: 12,
    anchor: "native-sig-markers",
    anchorNote: NATIVE_SIG_ANCHOR_NOTE,
    supersededBy: "preview-oneshot-14param",
    recordedAt: "2026-09-11",
    evidence: [
      "Faucet/scripts/deployed-faucet.preview.json:6",
      "Faucet/deployed-artifacts.md:18-19 (vì sao TRÙNG policy id với Preprod)",
    ],
    caveats: [
      "TRÙNG policy id với bản ghi `preprod-native-sig-12param` — cùng một giá trị, hai mạng. " +
        "Đó là TRIỆU CHỨNG của neo native-sig, không phải tính năng: policy id không còn phân " +
        "biệt được mạng nào, nên một giao dịch dựng nhầm mạng vẫn 'trông đúng'.",
      "Mạng Preview còn nhiều thread/beacon từ các lượt genesis cũ (native-sig đúc lại được). " +
        "Xem `Faucet/deployed-artifacts.md:44-45`.",
    ],
  },
  {
    id: "preview-oneshot-14param",
    network: "preview",
    assetName: "744c414d50",
    policyId: null,
    status: "PENDING-MINT",
    mintParamCount: 14,
    anchor: "oneshot-markers",
    anchorNote:
      "Bản sẽ đúc lại theo đường registry-gate 14 tham số, marker one-shot theo `genesis_ref` mới.",
    supersededBy: null,
    recordedAt: "2026-09-11",
    evidence: ["Chưa có tx."],
    caveats: [
      "CHƯA ĐÚC ⇒ chưa có policy id. Đọc ra là NÉM.",
      "Sau khi đúc: điền `policyId`, đổi `status` → `ACTIVE`, ĐỂ NGUYÊN `id`.",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ĐỌC — fail-closed
//
// Ba trạng thái phải phân biệt được, và trạng thái thứ ba KHÔNG được trả về giá trị:
//   • khớp            → trả policy id.
//   • lệch            → bản ghi có thật nhưng KHÔNG phải thứ bên gọi xin (đã bị thay) ⇒ NÉM.
//   • KHÔNG ĐỌC ĐƯỢC  → thiếu bản ghi / rỗng / sai hình dạng / mạng chưa có bản ACTIVE ⇒ NÉM.
//
// Trả `""` hay `undefined` ở nhánh thứ ba là dựng một cái vỏ im lặng: chuỗi rỗng đi tiếp vào
// `toUnit(policyId, name)` rồi ra một unit trông hợp lệ, và tài sản rót vào một policy không ai
// giữ. LAMP không burn ⇒ sai là không sửa được.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN GIẢ DẠNG — mang asset name "LAMP"/"tLAMP" nhưng KHÔNG do `lamp_mint` đúc
//
// Vì sao chúng không nằm trong `LAMP_POLICY_REGISTRY`: mọi trường của bản ghi kia
// (`mintParamCount`, `anchor`) giả định token do `lamp_mint` sinh ra. Nhét một token
// không-phải-LAMP vào đó là nói dối bằng kiểu dữ liệu — nó sẽ đọc như một bản LAMP hợp lệ.
//
// Vì sao vẫn phải khai ở đây: một sổ "nguồn duy nhất" mà IM LẶNG về một token đang sống trên
// chuỗi với đúng cái tên ấy thì nó không phải nguồn duy nhất — người tra một policy id không
// thấy gì và kết luận "không liên quan", trong khi thứ họ đang cầm là một token 72 tỷ.
// ─────────────────────────────────────────────────────────────────────────────

export interface LookalikePolicyRecord {
  policyId: string;
  network: LampNetwork;
  assetName: string;
  /** Vì sao nó KHÔNG phải LAMP, và điều gì đã xảy ra với nó. */
  whatItActuallyIs: string;
  /**
   * Ảnh chụp cung, KHÔNG phải thuộc tính của bản ghi.
   *
   * Số lượng của một token đang sống là thứ ĐỌC TỪ CHUỖI. Đóng băng nó thành một hằng ở đây là
   * tạo một bản sao chết im lặng: nó đổi ở nơi khác và không gì báo cho tệp này. Nên trường này
   * bắt buộc mang mốc đo — `measuredAt` là phần làm nó tự khai được là ảnh chụp.
   */
  supplySnapshot: {
    /** Số oildrop đo được tại `measuredAt`. Chuỗi, vì nó vượt `Number.MAX_SAFE_INTEGER`. */
    quantityOildrop: string;
    mintOrBurnCount: number;
    measuredAt: string;
    /** Lệnh đo lại — để người đọc không phải đi tìm. */
    howToRemeasure: string;
  };
  evidence: string[];
}

export const NON_LAMP_LOOKALIKE_POLICIES: readonly LookalikePolicyRecord[] = [
  {
    policyId: "28e916b097be13ed955330f00710bd93e2ea74bbc89aa5f5cd0f12b4",
    network: "preprod",
    assetName: "744c414d50",
    whatItActuallyIs:
      "Token diễn tập đời đầu, đúc bằng một chính sách chữ-ký-đơn của ví triển khai — KHÔNG đi " +
      "qua `lamp_mint`, nên KHÔNG có SupplyState, KHÔNG có cổng WHO, và KHÔNG có trần nào. Hệ quả " +
      "đã xảy ra thật chứ không phải rủi ro lý thuyết: có lúc cung lên tới 72.000.000.000.000.000 " +
      "oildrop = 72 tỷ LAMP, GẤP ĐÔI trần 36 tỷ. Đã được đưa về đúng trần bằng một lượt đúc ÂM " +
      "(chính sách chữ-ký-đơn không chặn mint âm, giữ khoá là đốt được). " +
      "⚠ Việc đó KHÔNG mâu thuẫn luật no-burn của LAMP, và cũng không phải ngoại lệ của luật ấy: " +
      "luật no-burn áp cho token do `lamp_mint` sinh ra, còn token này chưa bao giờ đi qua đó. " +
      "Suy từ 'LAMP không burn' ra 'token này không đốt được' là nối hai mệnh đề KHÁC LOẠI — một " +
      "luật sản phẩm và một phát biểu về chuỗi — bằng một dấu suy ra không có thật. " +
      "Cái VĨNH VIỄN là DẤU VẾT, không phải số dư: `mint_or_burn_count` chỉ tăng, nên lần đúc " +
      "thừa ở lại mãi trong lịch sử tài sản kể cả khi số dư đã về đúng trần.",
    supplySnapshot: {
      quantityOildrop: "36000000000000000",
      mintOrBurnCount: 3,
      measuredAt: "2026-09-11",
      howToRemeasure:
        "Hỏi tx trước, bảng tổng hợp sau. Bảng tổng hợp tài sản (Blockfrost `/assets/<unit>`, " +
        "koios `asset_info`) NHẤT QUÁN DẦN: nó còn trả số cũ một lúc sau khi giao dịch đã vào " +
        "khối. Đo bằng một lần hỏi bảng ngay sau lượt đốt thì một lượt ĐÃ THÀNH CÔNG đọc y hệt " +
        "một lượt hỏng — và đó là ngay sau thao tác bất khả hồi, đúng lúc người vận hành cần câu " +
        "trả lời đúng nhất. Đường không trễ: `/txs/<hash>` của chính giao dịch đúc/đốt.",
    },
    evidence: [
      "Blockfrost preprod /txs/b08692d0044bdbc64439cad9cf31e384a50649040a9c627f1513a4e704810600 — block 5164905, asset_mint_or_burn_count 1 (lượt đốt −36×10¹⁵)",
      "Blockfrost preprod /assets/28e916b0…744c414d50 (2026-09-11, SAU lượt đốt): quantity 36000000000000000, mint_or_burn_count 3",
      "Distribution/scripts/live-deploy-preview.md:19 (khai 'Native sig (ví deploy)')",
      "Faucet/deployed-artifacts.md:103 (đã đánh dấu bỏ)",
    ],
  },
  {
    policyId: "3628b069a032490ca24863f48fe36f902d6cf676e1f5b5d3e7845d44",
    network: "preprod",
    assetName: "744c414d50",
    whatItActuallyIs:
      "Native script `sig` neo vào payment key hash của một ví trả phí trên Preprod, đúc " +
      "2026-07-31, cung 1.000.000 oildrop. KHÔNG đi qua `lamp_mint`: không SupplyState, " +
      "không cổng WHO, không trần phát hành — giữ khoá là đúc thêm được. " +
      "Đây là token thử của một đợt cũ, đã hết dùng. " +
      "⚠ Lý do nó phải nằm trong sổ này KHÔNG phải nguồn gốc của nó mà là VỊ TRÍ của nó: " +
      "nó nằm SẴN trong UTxO của một ví triển khai. Ba bản nhái kia phải đi tìm mới gặp; " +
      "bản này thì đã ở trong túi. Một vòng chọn tài sản theo TÊN hiển thị (`asset_name` == " +
      "`744c414d50`) thay vì theo `policy_id` sẽ nhặt đúng nó TRƯỚC bản thật, và không cần " +
      "một kẻ tấn công nào — chỉ cần một vòng lặp đọc ví. Đó là kịch bản hỏng bản ghi này chặn.",
    supplySnapshot: {
      quantityOildrop: "1000000",
      mintOrBurnCount: 1,
      measuredAt: "2026-09-16",
      howToRemeasure:
        "Koios preprod `script_info` cho hash trên (xác nhận là native `sig`, đọc `keyHash` " +
        "trong thân script), rồi `asset_history` cho unit `3628b069…744c414d50`. Hỏi " +
        "`asset_history` TRƯỚC `asset_info` — cùng lý do đã ghi ở bản ghi `28e916b0…`: bảng " +
        "tổng hợp nhất quán dần, lịch sử giao dịch thì không.",
    },
    evidence: [
      "Koios preprod script_info (đo 2026-09-16): type `timelock`, value {\"type\":\"sig\",\"keyHash\":\"7c0f99bdc7f0a9377af5f31f1149e23fe69d40e5634efd87f87981e3\"}, creation_tx 9840a0c2ae9065c64d3f50702d5e225cbb99e772214b287389099bc6ea86dd4a",
      "Koios preprod asset_history unit 3628b069…744c414d50 (đo 2026-09-16): ĐÚNG MỘT minting_tx 9840a0c2…, quantity 1000000, block_time 1785506897 (2026-07-31)",
      "Koios preprod asset_info (đo 2026-09-16): total_supply 1000000, mint_cnt 1, burn_cnt 0 — ở bản ghi NÀY bảng tổng hợp khớp lịch sử; đừng suy từ đó ra rằng nó khớp ở bản ghi khác (xem `28e916b0…`)",
    ],
  },
] as const;

/**
 * Tra một policy id bất kỳ xem nó có phải token giả dạng đã biết không.
 *
 * Dùng ở nhánh lỗi: người tra một policy id lạ phải nhận được câu "đây là cái gì", không phải
 * câu "không tìm thấy". "Không tìm thấy" là phát biểu về vùng quét, không phải về policy.
 */
export function lookalikePolicy(policyId: string): LookalikePolicyRecord | null {
  const needle = policyId.trim().toLowerCase();
  return NON_LAMP_LOOKALIKE_POLICIES.find((r) => r.policyId === needle) ?? null;
}

/**
 * CỔNG LOOKALIKE-001/002 — chặn một policy id trước khi nó đi vào apply-param.
 *
 * VÌ SAO CẦN MỘT HÀM NÉM KHI ĐÃ CÓ `lookalikePolicy`
 *   `lookalikePolicy` trả `record | null`. Một hàm trả `null` là một cuốn TỪ ĐIỂN, không phải
 *   một cái cổng: đường mặc định của nó là đường ĐI TIẾP, và người gọi phải nhớ tự kiểm. Đo
 *   được ở kho này trước bản vá: hàm ấy có 0 chỗ gọi trong mã sản xuất — chỗ duy nhất nhắc tới
 *   nó là định nghĩa của chính nó và bài kiểm của chính nó. Một cổng không ai gọi thì nó không
 *   phải cổng lỏng, nó là cổng VẮNG MẶT.
 *
 *   Và cổng vắng mặt là lớp lỗi mà phép đo đảo KHÔNG bắt được: đảo một chốt không tồn tại thì
 *   không sinh ra tín hiệu nào. Phép đo đảo phát hiện *cổng đo sai đại lượng*; nó không phát
 *   hiện *chỗ lẽ ra phải có cổng*. Hai việc khác nhau.
 *
 * BA TRẠNG THÁI, KHÔNG PHẢI HAI
 *   nhận được · là hàng nhái · KHÔNG ĐỌC ĐƯỢC. Trạng thái thứ ba ném TRƯỚC, vì nó là trạng thái
 *   mù: một chuỗi rỗng không có trong sổ hàng nhái, nên một cổng chỉ tra sổ sẽ cho nó đi qua và
 *   apply-param vẫn ra bytes, vẫn ra script hash, vẫn deploy êm — địa chỉ sai vĩnh viễn.
 *
 * @param slot tên khe đang điền, để câu lỗi nói được hỏng ở đâu (`"reserve_draw #1 lamp_policy"`).
 */
export function assertNotLookalike(policyId: string, slot: string): string {
  const v = (policyId ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{56}$/.test(v)) {
    throw new Error(
      `${LAMP_POLICY_ERRORS.POLICY_ID_MALFORMED}: khe ${slot} nhận "${policyId}" — cần policy id ` +
        `28 byte (56 ký tự hex). Đây là trạng thái MÙ, không phải trạng thái "chưa có trong sổ ` +
        `hàng nhái": một chuỗi rỗng cũng không có trong sổ đó. Giá trị này sắp đi vào apply-param, ` +
        `mà apply-param nhận rác vẫn ra bytes, vẫn ra script hash, vẫn deploy êm — và địa chỉ sai ` +
        `thì sai vĩnh viễn, không lỗi nào được ném ở bất cứ tầng nào sau đây.`,
    );
  }
  const nhai = lookalikePolicy(v);
  if (nhai) {
    throw new Error(
      `LOOKALIKE-001: khe ${slot} nhận một policy ĐÃ BIẾT là hàng nhái, không phải LAMP.\n` +
        `  policy id : ${v}\n` +
        `  mạng      : ${nhai.network}\n` +
        `  asset name: ${nhai.assetName}\n` +
        `  thực chất : ${nhai.whatItActuallyIs.split(".")[0]}.\n` +
        `Asset name trùng KHÔNG phải bằng chứng: policy id là điều kiện ĐỦ, còn asset name chỉ ` +
        `phân biệt các dòng BÊN TRONG một policy đã được xác thực. Tra sổ đầy đủ ở ` +
        `NON_LAMP_LOOKALIKE_POLICIES. Lấy policy đúng bằng activeLampPolicyId(<mạng>) — hàm đó ` +
        `NÉM khi mạng chưa có bản ACTIVE, và đó là câu trả lời đúng, không phải một giá trị đoán.`,
    );
  }
  return v;
}

/** Mã lỗi của sổ policy. Tên gợi nhớ, không ký hiệu trơ. */
export const LAMP_POLICY_ERRORS = {
  MISSING_RECORD: "TLAMP-SRC-001-MISSING-RECORD",
  POLICY_ID_EMPTY: "TLAMP-SRC-002-POLICY-ID-EMPTY",
  POLICY_ID_MALFORMED: "TLAMP-SRC-003-POLICY-ID-MALFORMED",
  SUPERSEDED: "TLAMP-SRC-004-SUPERSEDED",
  NO_ACTIVE_RECORD: "TLAMP-SRC-005-NO-ACTIVE-RECORD",
  AMBIGUOUS_ACTIVE: "TLAMP-SRC-006-AMBIGUOUS-ACTIVE",
} as const;

/** Lỗi của sổ policy — mang mã tra được, để chỗ gọi phân biệt được bốn nguyên nhân. */
export class LampPolicySourceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "LampPolicySourceError";
    this.code = code;
  }
}

const POLICY_ID_SHAPE = /^[0-9a-f]{56}$/;

/** Tra một bản ghi theo `id`. Ném khi không có — KHÔNG trả `undefined`. */
export function lampPolicyRecord(id: string): LampPolicyRecord {
  const found = LAMP_POLICY_REGISTRY.find((r) => r.id === id);
  if (!found) {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.MISSING_RECORD,
      `không có bản ghi policy nào mang id "${id}". Sổ hiện có: ` +
        `${LAMP_POLICY_REGISTRY.map((r) => r.id).join(", ")}. ` +
        `Nguồn duy nhất: Genesis/offchain/src/lampPolicies.ts — đừng gõ tay policy id.`,
    );
  }
  return found;
}

/**
 * Ép hình dạng policy id. Tách riêng để MỌI đường đọc dùng CÙNG một phép kiểm — hai bản kiểm
 * cạnh nhau là cách một bản lỏng hơn bản kia mà không ai giải thích được vì sao.
 *
 * Xuất ra ngoài có chủ ý: nhánh "sai hình dạng" chỉ dựng được bằng một bản ghi hỏng, mà sổ thật
 * thì không có bản ghi hỏng nào (đúng như mong muốn). Không có seam này thì nhánh đó không có
 * bài kiểm nào, và "đã được ghim" trở thành một câu không đo được.
 */
export function readPolicyIdOf(record: LampPolicyRecord): string {
  const pid = record.policyId;
  if (pid === null || pid === undefined || pid.trim() === "") {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.POLICY_ID_EMPTY,
      `bản ghi "${record.id}" (${record.network}) chưa có policy id — trạng thái ` +
        `${record.status}. Chưa đúc thì KHÔNG có giá trị để đọc; đừng đệm rỗng, đừng suy từ ` +
        `mạng khác (policy id phụ thuộc apply-param ⇒ mỗi mạng một giá trị khác).`,
    );
  }
  if (!POLICY_ID_SHAPE.test(pid)) {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.POLICY_ID_MALFORMED,
      `bản ghi "${record.id}" có policyId sai hình dạng: cần đúng 56 ký tự hex thường ` +
        `(28 byte script hash), nhận được ${pid.length} ký tự "${pid}".`,
    );
  }
  return pid;
}

/**
 * Policy id ĐANG hiệu lực của một mạng.
 *
 * Ném khi: mạng không có bản ghi nào · không bản nào `ACTIVE` (kèm tên bản đang chờ đúc) ·
 * có nhiều hơn một bản `ACTIVE` (sổ tự mâu thuẫn — đó là trạng thái KHÔNG ĐỌC ĐƯỢC, không
 * phải chỗ để đoán) · policy id rỗng hoặc sai hình dạng.
 */
export function activeLampPolicyId(network: LampNetwork): string {
  return selectActivePolicyId(LAMP_POLICY_REGISTRY, network);
}

/**
 * Lõi của `activeLampPolicyId`, nhận bảng tra làm tham số.
 *
 * Xuất ra ngoài có chủ ý (cùng lý do với `readPolicyIdOf`): hai nhánh "không bản nào ACTIVE" và
 * "nhiều hơn một bản ACTIVE" chỉ dựng được bằng một bảng tra bịa ra. Đây là seam ĐỌC, không phải
 * đường ghi — nó không cho ai thêm bản ghi vào sổ thật.
 */
export function selectActivePolicyId(
  registry: readonly LampPolicyRecord[],
  network: LampNetwork,
): string {
  const ofNetwork = registry.filter((r) => r.network === network);
  if (ofNetwork.length === 0) {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.MISSING_RECORD,
      `sổ không có bản ghi nào cho mạng "${network}".`,
    );
  }
  const active = ofNetwork.filter((r) => r.status === "ACTIVE");
  if (active.length > 1) {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.AMBIGUOUS_ACTIVE,
      `mạng "${network}" có ${active.length} bản ACTIVE (${active.map((r) => r.id).join(", ")}). ` +
        `Mỗi mạng nhiều nhất MỘT bản canonical — sổ đang tự mâu thuẫn, sửa sổ trước khi dựng tx.`,
    );
  }
  const one = active[0];
  if (!one) {
    const pending = ofNetwork.filter((r) => r.status === "PENDING-MINT").map((r) => r.id);
    const superseded = ofNetwork.filter((r) => r.status === "SUPERSEDED").map((r) => r.id);
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.NO_ACTIVE_RECORD,
      `mạng "${network}" chưa có bản ACTIVE. Đang chờ đúc: ` +
        `${pending.length ? pending.join(", ") : "(không có)"}. ` +
        `Bản đã bị thay: ${superseded.length ? superseded.join(", ") : "(không có)"}. ` +
        `Cần giá trị lịch sử thì gọi historicalLampPolicyId("<id>") và tự chịu trách nhiệm — ` +
        `đừng để đường ACTIVE rơi ngược về bản cũ.`,
    );
  }
  return readPolicyIdOf(one);
}

/**
 * Policy id của MỘT bản ghi cụ thể, kể cả bản đã bị thay.
 *
 * Dùng cho việc đọc lịch sử và di trú (quét số dư dưới policy cũ). Đường này CỐ Ý bắt gọi bằng
 * `id` chứ không bằng mạng: xin một bản đã chết thì phải gõ tên nó ra, và gõ ra thì có vết.
 */
export function historicalLampPolicyId(id: string): string {
  return readPolicyIdOf(lampPolicyRecord(id));
}

/**
 * Giống `historicalLampPolicyId` nhưng TỪ CHỐI bản đã bị thay — dùng khi chỗ gọi tự tin mình
 * đang cầm id của bản còn hiệu lực. Đây là nhánh "lệch": bản ghi đọc được, nhưng không phải
 * thứ bên gọi xin.
 */
export function lampPolicyIdRequireActive(id: string): string {
  const record = lampPolicyRecord(id);
  if (record.status === "SUPERSEDED") {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.SUPERSEDED,
      `bản ghi "${record.id}" đã bị thay` +
        `${record.supersededBy ? ` bởi "${record.supersededBy}"` : ""}. ` +
        `Chỗ gọi xin bản ACTIVE ⇒ từ chối. Dùng activeLampPolicyId("${record.network}") để lấy ` +
        `bản đang hiệu lực, hoặc historicalLampPolicyId("${record.id}") nếu THẬT SỰ cần bản cũ.`,
    );
  }
  // PENDING-MINT KHÔNG đi qua nhánh trên có chủ ý: nó không phải "bản cũ", nó là "chưa có giá
  // trị". Hai nguyên nhân khác nhau thì phải ra hai mã khác nhau, không thì người đọc lỗi đi
  // tìm bản thay thế cho một thứ chưa từng tồn tại. Nó rơi xuống readPolicyIdOf ⇒ 002.
  return readPolicyIdOf(record);
}
