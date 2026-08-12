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
  caveats: [
    "Đây là bản MỒI. Sẽ bị thay bởi policy uỷ quyền OrgDID — POLICY-ID SẼ KHÁC. Đừng nhúng cứng.",
    "dist_dest (địa chỉ kho) nướng vào tham số ⇒ đổi kho = đổi script hash = policy-id khác. " +
      "Kho-NFT động chỉ có ở bản 12 tham số CHƯA phát hành.",
    "Kho đang chạy là dist_treasury 1-pkh (bootstrap): MỘT chữ ký chuyển được LAMP ra khỏi kho. " +
      "Không trần, không lịch.",
    "Nhánh ReserveDraw KHÔNG dùng được trên bản này: meter_nft_policy = 28 byte 0, nên điều kiện " +
      "count_inputs_holding_nft(...) == 1 không bao giờ thoả ⇒ 9,63 tỷ Reserve không rút được qua policy này.",
    "supply_state và dist_treasury CHƯA đối chiếu byte với repo (tính tới 2026-08-12). " +
      "Chỉ lamp_mint đã đối chiếu.",
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
