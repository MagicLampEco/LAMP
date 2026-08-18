// types.ts — Data model cho MagicLamp Launch API.
// Single source of truth cho 3 consumer: affiso.net, magiclamp.network, SuperApp.

export type LaunchStatus = "upcoming" | "active" | "ended" | "paused";
export type LaunchMechanism = "SRCL" | "Airdrop" | "RedBack" | "Direct";
export type PhaseStatus = "upcoming" | "active" | "ended";

export interface LaunchPhase {
  id: string;
  title: string;
  status: PhaseStatus;
  start_epoch: number;
  end_epoch: number;
  lamp_amount: string;           // bigint string
  description_md: string;
  eligibility: string;           // ai được tham gia (hiển thị cho user)
}

export interface LaunchStats {
  participants: number;
  total_contribution_lovelace: string;  // ADA đóng góp (bigint string)
  lamp_distributed: string;             // LAMP đã phân bổ (bigint string)
  current_epoch: number;
  last_updated_epoch: number;
}

// ── Tham số vận hành của đợt (Q5, 2026-08-18) ────────────────────────────────
//
// VÌ SAO Ở ĐÂY chứ không nướng trong script: trước đây `E_open`/`E_cut`/`N`/`cap`
// chỉ tồn tại dưới dạng cờ dòng lệnh của `build_delegator_snapshot.ts`, còn trang
// giới thiệu đợt lại tự khai mốc epoch của riêng nó trong `phases`. Hai nguồn,
// không ai đối chiếu — đúng lớp lỗi đã trả giá ở "SPO chia đều": tài liệu dạy một
// đằng, mã trả tiền một nẻo. Nay campaign record là NGUỒN DUY NHẤT, và nó sửa được
// qua `PATCH /admin/campaigns/:id` (tức sửa trên UI), không phải sửa mã rồi deploy.
//
// CHIA HAI TẦNG, và ranh giới này là RÀNG BUỘC AN NINH chứ không phải cách sắp xếp:
//   • `public`  — hiện cho mọi người ngay.
//   • `sealed`  — cửa sổ ĐO. `publicCampaign()` lược nó khỏi MỌI đường ra công khai
//     (GET, SSE, webhook). Công bố trước `[e_open, e_cut)` là báo trước ngày cần đẹp
//     sổ ⇒ thuê stake đúng cửa sổ rồi rút, tức là trả tiền cho hành vi mình muốn
//     chặn. Mở niêm = một lượt sửa CÓ CHỦ Ý của quản trị (chuyển trường từ `sealed`
//     lên `public`), không phải một phép so mốc thời gian tự chạy — cổng tự mở theo
//     đồng hồ là cổng sẽ mở nhầm một lần nào đó.
export type SetRootMode =
  | "mot-so-chung"          // A — gộp mọi leaf thành MỘT root, niêm một lần tại genesis
  | "hai-hu-rieng"          // B — HAI pool-UTxO cùng validator, khác genesis NFT, hai root độc lập
  | "hu-thay-niem-moi-ky";  // C — MỘT hũ, root ghi đè mỗi epoch (đòi thêm redeemer `SetRoot`)

export interface AirdropParamsPublic {
  /** Số epoch giữ delegation liên tiếp tối thiểu (§1.5). */
  n_min_epochs: number;
  /** Trần oildrop mỗi người nhận; `null` = KHÔNG trần. Xem ghi chú quyết định ở `Airdrop/CONTRACT.md §6`. */
  cap_oildrop: string | null;
  /** Cách nạp root — xem `Airdrop/CONTRACT.md §2`. */
  set_root_mode: SetRootMode;
  /** Ngân sách mỗi pot, LAMP (không phải oildrop). */
  pot_delegator_lamp: string;
  pot_spo_lamp: string;
  pot_cs_lamp: string;
  /** Đường dẫn (tương đối gốc repo) tới danh sách loại trừ self-dealing; `null` = tường minh KHÔNG loại ai. */
  excluded_file: string | null;
}

export interface AirdropParamsSealed {
  /** Đầu cửa sổ đo, BAO GỒM. */
  e_open: number;
  /** Cuối cửa sổ đo, KHÔNG bao gồm. Luật: `e_cut - e_open >= n_min_epochs + 1`. */
  e_cut: number;
}

export interface CampaignParams {
  public: AirdropParamsPublic;
  // `sealed: null` trong một PATCH = MỞ NIÊM có chủ ý (xoá khối). Bỏ trống = giữ nguyên.
  /** Vắng mặt = đã mở niêm (quản trị đã chuyển lên `public`), hoặc đợt này không có cửa sổ đo. */
  sealed?: AirdropParamsSealed | null;
}

export interface LaunchCampaign {
  id: string;                // "srcl-1", "tiger-airdrop"
  project: "MagicLamp";     // chỉ dùng cho MagicLamp-level launch
  slug: string;              // URL slug, khớp id
  title: string;
  tagline: string;           // 1 dòng ngắn

  mechanism: LaunchMechanism;
  status: LaunchStatus;

  // Timing (epoch-based)
  registration_open_epoch: number;
  start_epoch: number;
  end_epoch: number;
  claim_deadline_epoch: number;

  // Token
  pot_lamp: string;          // tổng LAMP của đợt (bigint string)
  lamp_source: string;       // nguồn: "SRCL_POT" | "REDBACK_POT" | "AIRDROP_POT" | ...

  // Content (Markdown)
  summary_md: string;        // tóm tắt ngắn (~200 chữ)
  description_md: string;    // nội dung đầy đủ

  // Links
  docs_url: string;          // magiclamp.network/...
  chat_url: string;          // SuperApp chat deep link
  participate_url: string;   // action URL (affiso.net hoặc trong SuperApp)

  // Phases
  phases: LaunchPhase[];

  // Tham số vận hành (nguồn DUY NHẤT cho script off-chain; sửa qua PATCH /admin)
  params?: CampaignParams;

  // Live stats (updated by epoch keeper)
  stats?: LaunchStats;

  // Config
  geofence?: string[];       // ["VN", "SG", ...] null = mở
  max_per_participant_lamp?: string;
  requires_did: boolean;
  requires_wallet_connect: boolean;

  // Webhooks đã đăng ký nhận push (operator cấu hình)
  push_targets?: PushTarget[];

  // Meta
  created_at: string;
  updated_at: string;
}

export interface PushTarget {
  name: "affiso" | "magiclamp-network" | "superapp";
  webhook_url: string;
  webhook_secret: string;   // HMAC-SHA256 signing secret
  enabled: boolean;
}

// ── Request / Response types ─────────────────────────────────────────────────

export interface PushPayload {
  event: "campaign.updated" | "campaign.status_changed" | "stats.updated" | "phase.started" | "phase.ended";
  campaign_id: string;
  campaign: LaunchCampaign;
  changed_fields?: string[];
  timestamp: string;
}

export interface AdminUpdateRequest {
  campaign?: Partial<LaunchCampaign>;
  stats?: LaunchStats;
  event?: PushPayload["event"];
  changed_fields?: string[];
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
