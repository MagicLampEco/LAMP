// custodyParams — NƠI DUY NHẤT dựng danh sách apply-param của validator `custody`.
//
// VÌ SAO CÓ TỆP NÀY: `custody.custody.spend` khai FIVE khe theo đúng thứ tự
//   [proposal_policy, seed_policy, ms_per_epoch, lamp_policy, token_name]
// (`Treasury/onchain/validators/custody.ak:89-95`). Hai khe cuối được thêm cùng nhánh
// MigrateIn; `Treasury/scripts/config.ts` và `PlatformKit/scripts/03_onboard_platform.ts`
// đều còn áp BA khe cũ. Hai chỗ gọi ở hai kho con khác nhau, cùng một danh sách — nên danh
// sách phải sống ở MỘT nơi, không thì lần thêm khe sau lại lệch đúng kiểu này.
//
// ⚠ `lamp_policy`/`token_name` là tham số apply-time ⇒ nướng thẳng vào script hash của kho.
// Sai một trong hai ⇒ địa chỉ kho KHÁC ⇒ LAMP rót vào đó không rút ra được, và LAMP KHÔNG
// burn (`Treasury/CONTRACT.md §5`) ⇒ sai là không sửa được.
//
// Tệp này CỐ Ý không import `./config.js`: config nạp `.env` ngay lúc import, còn tệp này
// được `PlatformKit/scripts/` dùng chung — kéo theo `.env` của Treasury sang kho khác là sai.

import { LAMP_NAME, TLAMP_NAME } from "../../Genesis/offchain/src/constants.js";
import {
  activeLampPolicyId, LampPolicySourceError, type LampNetwork,
} from "../../Genesis/offchain/src/lampPolicies.js";
import type { Network } from "@magiclamp/utils";

/** Tên validator trong blueprint Treasury — dùng chung cho cổng đếm khe. */
export const CUSTODY_TITLE = "custody.custody.spend";
export const CUSTODY_SEED_TITLE = "custody_seed.custody_seed.mint";
/** `treasury_stake` khai hai handler (`withdraw`, `publish`) dùng CHUNG một thân, nên hai
 *  mục blueprint có cùng hash và cùng danh sách khe. Lấy `withdraw` làm mục tra cứu —
 *  đọc mục nào cũng ra cùng số khe, nhưng ghim một mục thì cổng đếm khe không phụ thuộc
 *  thứ tự các mục trong `plutus.json`. Thứ tự khe dựng ở `offchain/src/stakeBuilder.ts`. */
export const TREASURY_STAKE_TITLE = "treasury_stake.treasury_stake.withdraw";

/**
 * `token_name` theo mạng: Mainnet → "LAMP", mọi testnet → "tLAMP".
 *
 * Giá trị lấy từ `Genesis/offchain/src/constants.ts` (`LAMP_NAME`/`TLAMP_NAME`) — nơi giữ
 * DUY NHẤT của hai nhãn này. Không khai lại hằng ở đây: nhãn token là thứ vào script hash
 * của cả `lamp_mint` lẫn `custody`, một bản sao lệch là một địa chỉ kho lệch.
 */
export function custodyTokenName(network: Network): string {
  return network === "Mainnet" ? LAMP_NAME : TLAMP_NAME;
}

/** Nguồn của `lamp_policy` đã giải — đi thẳng vào cờ placeholder của van F14. */
export type LampPolicySource = "env" | "registry" | "placeholder";

export interface ResolvedLampPolicy {
  policy: string;
  source: LampPolicySource;
  /** Vì sao ra nguồn đó — in ra khi van F14 chặn LIVE, để người đọc biết phải đặt gì. */
  reason: string;
}

/** Đổi nhãn mạng của Utils sang nhãn của sổ policy LAMP. */
function toLampNetwork(network: Network): LampNetwork {
  return network.toLowerCase() as LampNetwork;
}

/**
 * `lamp_policy` cho một mạng, theo thứ tự: biến `LAMP_POLICY_ID` → sổ policy chính thức
 * (`Genesis/offchain/src/lampPolicies.ts`) → placeholder DEV.
 *
 * Placeholder KHÔNG phải giá trị đệm im lặng: nó trả về kèm `source: "placeholder"`, và van
 * F14 ở `config.ts::evaluateLiveGuards` ép rơi về DRY nên không tx nào ra mạng với nó. Sổ
 * policy hiện khai `PENDING-MINT` cho cả Preview lẫn Preprod (chưa đúc bản 14 tham số) nên
 * đường giữa NÉM là chuyện bình thường, và câu ném đó được giữ nguyên trong `reason` — nó
 * nói được người đọc phải làm gì, câu "không lấy được policy" thì không.
 *
 * @param env bảng biến môi trường (tiêm vào để bài kiểm không phải đụng `process.env` thật)
 */
export function resolveLampPolicy(
  network: Network,
  env: Record<string, string | undefined> = process.env,
): ResolvedLampPolicy {
  const fromEnv = (env.LAMP_POLICY_ID ?? "").trim().toLowerCase();
  if (fromEnv) {
    if (!/^[0-9a-f]{56}$/.test(fromEnv)) {
      throw new Error(
        `LAMP_POLICY_ID không hợp lệ (cần 28-byte hex thường, 56 ký tự): "${fromEnv}". ` +
        `lamp_policy là apply-param của custody ⇒ sai hình dạng là sai địa chỉ kho.`,
      );
    }
    return { policy: fromEnv, source: "env", reason: "đọc từ biến LAMP_POLICY_ID" };
  }
  try {
    const policy = activeLampPolicyId(toLampNetwork(network));
    return {
      policy,
      source: "registry",
      reason: `bản ACTIVE trong sổ policy LAMP cho mạng ${network}`,
    };
  } catch (e) {
    if (!(e instanceof LampPolicySourceError)) throw e;
    return {
      policy: PLACEHOLDER_LAMP_POLICY,
      source: "placeholder",
      reason:
        `sổ policy LAMP chưa có bản ACTIVE cho ${network} — ${e.message} ` +
        `Đặt LAMP_POLICY_ID=… để chạy LIVE.`,
    };
  }
}

/**
 * Placeholder DEV cho `lamp_policy`: 28 byte `ee`. Chọn một giá trị KHÔNG phải toàn `00` có
 * chủ ý — `00`×28 là một giá trị người ta thật sự gõ vào khi muốn "tắt" một tham số
 * (`Genesis/scripts/03_mint_more.ts:88`), nên nó lẫn được với giá trị cố ý. `ee`×28 thì
 * không lẫn với gì cả.
 */
export const PLACEHOLDER_LAMP_POLICY = "ee".repeat(28);

export interface CustodyParams {
  proposalPolicy: string;
  seedPolicy: string;
  msPerEpoch: bigint;
  lampPolicy: string;
  tokenName: string;
}

/**
 * Danh sách apply-param của `custody`, ĐÚNG thứ tự blueprint khai. Mọi chỗ apply custody
 * phải đi qua đây — thứ tự khe không được viết lần thứ hai ở bất cứ đâu.
 *
 * KHÔNG tự kiểm số khe ở đây: việc đó là của cổng đếm khe đọc từ blueprint
 * (`Genesis/offchain/src/blueprintSource.ts`). Hai chỗ cùng ép một luật thì luật lệch nhau
 * lúc nào không ai biết.
 */
export function custodyParamList(p: CustodyParams): unknown[] {
  return [p.proposalPolicy, p.seedPolicy, p.msPerEpoch, p.lampPolicy, p.tokenName];
}
