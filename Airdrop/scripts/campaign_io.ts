// campaign_io.ts — lớp mỏng đọc campaign record từ đĩa rồi giao cho phần kiểm THUẦN.
//
// Ranh giới: mọi LUẬT (cửa sổ đo, trần, chế độ root) nằm ở `offchain/src/campaignParams.ts`
// và kiểm được bằng test thường. Ở đây chỉ có mở tệp + phân giải đường dẫn — thứ không
// đáng và không nên kéo node types vào gói SDK.

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCampaignParams, type CampaignParams } from "../offchain/src/campaignParams.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Gốc repo, suy từ vị trí tệp này (`Airdrop/scripts/` → lên 2 bậc). */
export function repoRoot(): string {
  return resolve(__dirname, "../..");
}

/** Tệp campaign mặc định = nguồn mà `PATCH /admin/campaigns/:id` ghi vào
 *  (`LaunchAPI/src/content.ts:10,28`) ⇒ đọc tệp này là đọc đúng thứ quản trị vừa sửa. */
export function defaultCampaignsFile(): string {
  return process.env.LAUNCH_CAMPAIGNS_FILE
    ? resolve(process.cwd(), process.env.LAUNCH_CAMPAIGNS_FILE)
    : resolve(repoRoot(), "LaunchAPI/data/campaigns.json");
}

/** `excludedFile` trả về đã PHÂN GIẢI tuyệt đối theo gốc repo (hoặc null). */
export async function loadCampaignParams(
  campaignId: string,
  campaignsFile: string = defaultCampaignsFile(),
): Promise<CampaignParams> {
  let raw: string;
  try {
    raw = await readFile(campaignsFile, "utf8");
  } catch (e) {
    throw new Error(
      `CAMPAIGN-PARAMS: không đọc được ${campaignsFile} (${e instanceof Error ? e.message : e}). ` +
      `Đặt LAUNCH_CAMPAIGNS_FILE nếu tệp nằm chỗ khác.`,
    );
  }
  let list: unknown;
  try { list = JSON.parse(raw); } catch { throw new Error(`CAMPAIGN-PARAMS: ${campaignsFile} không phải JSON hợp lệ`); }

  const p = parseCampaignParams(list, campaignId);
  return { ...p, excludedFile: p.excludedFile === null ? null : resolve(repoRoot(), p.excludedFile) };
}
