// LAMP — ĐỊNH DANH ĐÃ LÊN CHAIN, theo mạng. **NƠI GIỮ DUY NHẤT.**
//
// Vì sao có file này: trước đây policy-id mainnet nằm chép tay ở ≥2 script
// (`scripts/verify_mainnet_supply.ts`, `scripts/mint_release_plan.ts`) và rải trong tài liệu.
// Nhà tích hợp (PhoenixKey, SuperApp, MAGIC) không có chỗ nào để ĐỌC — nên hoặc gõ tay,
// hoặc đọc file tài liệu bên repo LAMP, cả hai đều sai cách. File này là con trỏ chính thức:
// import từ `@magiclamp/genesis-sdk`, soft-pin theo mạng, KHÔNG chép giá trị sang repo khác.
//
// ⚠️ KHÔNG ĐƯỢC XOÁ / KHÔNG ĐƯỢC SỬA GIÁ TRỊ đã lên chain. Định danh on-chain là bất biến
// lịch sử; muốn đổi thì THÊM một bản ghi mạng mới, không sửa bản ghi cũ.

/** Mạng được hỗ trợ. */
export type LampNetwork = "mainnet" | "preview" | "preprod";

/** Vòng đời một lần phát hành policy. */
export type PolicyLifecycle =
  /** Bản mồi — sẽ bị thay bởi bản uỷ quyền OrgDID (policy-id KHÁC). */
  | "bootstrap"
  /** Bản chính thức, uỷ quyền mint qua PhoenixKey OrgDID. */
  | "did-authorized";

export interface DeployedLamp {
  network: LampNetwork;
  /** PolicyId của token LAMP. Đây là định danh DUY NHẤT của tài sản. */
  policyId: string;
  /** Asset name (hex). */
  assetName: string;
  /** Số tham số apply-param của validator `lamp_mint` đang chạy. */
  mintParamCount: 8 | 12;
  lifecycle: PolicyLifecycle;
  /** Địa chỉ script giữ UTxO SupplyState (thread NFT "SUPPLY"). */
  supplyStateAddress: string;
  /** Script hash của validator `supply_state`. */
  supplyStateHash: string;
  /** Địa chỉ KHO mà mọi lượt mint bị ép rót vào (A-DEST). */
  khoAddress: string;
  /** Script hash của kho A-DEST. */
  khoHash: string;
  /** Cách WHO-gate quyết định AI được mint. */
  mintAuthority:
    | { kind: "baked-pkh-list"; note: string }
    | { kind: "registry-nft"; note: string };
  /**
   * TOÀN BỘ tham số apply-param đã nướng vào script đang chạy, theo ĐÚNG thứ tự.
   * Không phải tài liệu tham khảo — đây là thứ dựng lại được script từ mã nguồn.
   * Lấy bằng cách ĐỌC NGƯỢC bytecode thật trên chain (koios `/script_info`), rồi dựng lại
   * và đối chiếu byte, chứ không chép từ ghi chép nội bộ.
   */
  mintParams: { name: string; cborHex: string; note: string }[];
  /** Bằng chứng tái lập: commit nguồn + kết quả đối chiếu byte. */
  provenance: { script: string; hash: string; sourceCommit: string; byteMatch: boolean; onChainSize: number | null }[];
  /** Cảnh báo phải đọc trước khi tích hợp. */
  caveats: string[];
}

/**
 * MAINNET — bản MỒI 8 tham số, deploy 2026-06-18 (tx genesis `db0610c2…`).
 * Tái lập được từ commit `457f312`: dựng lại + áp 8 tham số ⇒ CBOR trùng byte, hash trùng
 * (đối chiếu 2026-08-09).
 */
export const LAMP_MAINNET: DeployedLamp = {
  network: "mainnet",
  policyId: "55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0",
  assetName: "4c414d50", // "LAMP"
  mintParamCount: 8,
  lifecycle: "bootstrap",
  supplyStateAddress: "addr1wxz0dkz0v3rg6zeqz9c7cyxz9lg3ynkrlkqrapfkj7e5ppqexy5d3",
  supplyStateHash: "84f6d84f64468d0b201171ec10c22fd1124ec3fd803e853697b34084",
  khoAddress: "addr1w827sry6t2y9744ndkg4ks6nct57v7tm8pz46ywsq98dhdsf76slu",
  khoHash: "d5e80c9a5a885f56b36d915b4353c2e9e6797b38455d11d0014edbb6",
  mintAuthority: {
    kind: "baked-pkh-list",
    note:
      "dist_authority = danh sách pkh NƯỚNG SẴN vào tham số + auth_threshold, kiểm bằng " +
      "extra_signatories. KHÔNG đọc registry, KHÔNG đọc DID. Không xoay khoá được.",
  },

  // ── 8 tham số, ĐÚNG thứ tự apply-param ────────────────────────────────────
  // Đọc ngược từ bytecode thật trên chain 2026-08-12, KHÔNG chép từ ghi chép nội bộ.
  // Bằng chứng: áp đúng 8 giá trị này vào bản build từ `457f312` ⇒ ra ĐÚNG policy-id
  // 55d3e01b…180f0 và ĐÚNG 2121 byte trùng khớp bytecode koios. Sai một byte thì hash khác.
  mintParams: [
    { name: "thread_nft_policy", cborHex: "581c97213f2442271e01410abd26e0737982cf7d6b9b05e1ccddf0ae77f0",
      note: "policy NFT one-shot định danh UTxO SupplyState" },
    { name: "thread_nft_name", cborHex: "46535550504c59", note: '"SUPPLY"' },
    { name: "token_name", cborHex: "444c414d50", note: '"LAMP" — asset name của chính token' },
    { name: "dist_authority", cborHex: "9f581c180a5c176e47bd16c5ed63281f3fc5f4350f5b6a8f15271509ee0441ff",
      note: "DANH SÁCH MỘT PHẦN TỬ. Đúng một khoá mở được cổng mint." },
    { name: "auth_threshold", cborHex: "01", note: "1-of-1" },
    { name: "dist_dest", cborHex: "581cd5e80c9a5a885f56b36d915b4353c2e9e6797b38455d11d0014edbb6",
      note: "script hash KHO — A-DEST ép toàn bộ delta mint rót vào đây" },
    { name: "meter_nft_policy", cborHex: "581c00000000000000000000000000000000000000000000000000000000",
      note: "28 byte 0 — KHÔNG có tiền ảnh ⇒ nhánh ReserveDraw chết vĩnh viễn" },
    { name: "meter_nft_name", cborHex: "434d4554", note: '"MET"' },
  ],

  // ── Tái lập được, đã đối chiếu byte 2026-08-12 ────────────────────────────
  provenance: [
    { script: "lamp_mint", hash: "55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0",
      sourceCommit: "457f312", byteMatch: true, onChainSize: 2121 },
    { script: "supply_state", hash: "84f6d84f64468d0b201171ec10c22fd1124ec3fd803e853697b34084",
      sourceCommit: "457f312", byteMatch: true, onChainSize: 528 },
    // Kho CHƯA từng bị tiêu nên bytecode chưa lên chain (koios /script_info không trả) —
    // đối chiếu bằng HASH: dựng `dist_treasury.ak` từ 60f7e3a + áp authority = pkh trên
    // ⇒ ra đúng d5e80c9a…. Không so được byte vì trên chain chưa có byte để so.
    { script: "dist_treasury", hash: "d5e80c9a5a885f56b36d915b4353c2e9e6797b38455d11d0014edbb6",
      sourceCommit: "60f7e3a", byteMatch: false, onChainSize: null },
  ],

  caveats: [
    "Đây là bản MỒI. Sẽ bị thay bởi policy uỷ quyền OrgDID — POLICY-ID SẼ KHÁC. Đừng nhúng cứng.",
    "dist_dest (địa chỉ kho) nướng vào tham số ⇒ đổi kho = đổi script hash = policy-id khác. " +
      "Kho-NFT động chỉ có ở bản 12 tham số CHƯA phát hành.",
    "🔴 MỘT KHOÁ HAI CỔNG: dist_authority[0] và authority của kho dist_treasury là CÙNG MỘT pkh " +
      "(180a5c17…ee0441 — đo 2026-08-12 bằng cách đọc ngược cả hai script). Nghĩa là A-DEST " +
      "KHÔNG chia quyền cho ai: người ký được lệnh mint cũng ký được lệnh rút kho. Nó là một " +
      "khúc vòng hai giao dịch, không phải một cái khoá thứ hai. Đừng mô tả nó như biện pháp bảo vệ.",
    "Nhánh ReserveDraw KHÔNG dùng được trên bản này: meter_nft_policy = 28 byte 0, nên điều kiện " +
      "count_inputs_holding_nft(...) == 1 không bao giờ thoả ⇒ 9,63 tỷ Reserve không rút được qua policy này.",
    "Kho CHƯA TỪNG BỊ TIÊU: koios /script_info không trả bytecode cho d5e80c9a… — trên Cardano " +
      "byte của script chỉ lên chain khi nó được dùng. Tức tới 2026-08-12 chưa ai mở kho lần nào.",
  ],
};

/** Tra định danh theo mạng. Ném lỗi thay vì trả undefined — fail-closed. */
export function deployedLamp(network: LampNetwork): DeployedLamp {
  switch (network) {
    case "mainnet":
      return LAMP_MAINNET;
    case "preview":
    case "preprod":
      throw new Error(
        `LAMP-DEPLOYED-001: chưa có bản ghi phát hành cho mạng "${network}". ` +
          `Đừng suy từ mainnet — policy-id phụ thuộc apply-param nên MỖI MẠNG một policy khác.`,
      );
  }
}
