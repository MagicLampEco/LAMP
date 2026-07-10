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

export interface LaunchCampaign {
  id: string;                // "srcl-1", "tiger-airdrop", "ispo-s1"
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
