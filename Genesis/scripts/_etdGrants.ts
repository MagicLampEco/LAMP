// _etdGrants.ts — đọc và soát DANH SÁCH CẤP của đợt ETD (pot `early-tiger-deleg`), thuần, không
// đọc chuỗi. `32_etd_claim.ts` dùng nó trước mọi lượt cấp; bài kiểm ở `Genesis/tests/etdGrants.test.ts`.
//
// HỢP ĐỒNG DỮ LIỆU (bên lập danh sách — Launch — ghi tệp, LAMP đọc):
//   {
//     "schema":  "etd-grants/1",
//     "network": "Preprod" | "Preview" | "Mainnet",
//     "pot":     "early-tiger-deleg",
//     "grants": [
//       { "stake_address": "stake_test1…",       // ví delegator đã ký CIP-8 bằng stake key
//         "payment_address": "addr_test1…",       // ví nhận do chính chữ ký đó chỉ định
//         "entitlement_oildrop": "123000000" }    // chuỗi số nguyên dương, đơn vị oildrop
//     ]
//   }
//
// VÌ SAO `payment_address` PHẢI LÀ VÍ KHOÁ. Tài khoản `claim_account` có `owner` là key-hash:
// Redeem đòi chính khoá đó ký (`claim_account.ak` ▸ Redeem, C-RDM-6) và đếm LAMP chỉ ở output có
// payment credential `VerificationKey(owner)` (`util.ak` ▸ `is_owned_by`, `lamp_to_owner`). Nên
// đích cuối là ví script (Phoenix vault = địa chỉ `did_payment`) thì đi HAI giao dịch: Redeem về ví
// khoá của người dùng trong app, rồi app chuyển tiếp vào vault. Đặt thẳng địa chỉ vault vào đây thì
// tài khoản mở được nhưng không bao giờ rút được — nên cổng ETD-GRANT-005 chặn từ lúc đọc.
//
// MỘT OWNER MỘT TÀI KHOẢN. Tên NFT tài khoản = blake2b_256(owner) (`accountNft.ts`), nên hai dòng
// cùng ví nhận là hai lượt CREATE đúc trùng tên. Bên lập danh sách gộp trước; ở đây trùng là NÉM.
import { getAddressDetails } from "@lucid-evolution/lucid";

import { potBudgetOildrop } from "../../Distribution/offchain/src/pots.js";

export const ETD_GRANTS_SCHEMA = "etd-grants/1";
export const ETD_POT_ID = "early-tiger-deleg" as const;

export type EtdNetwork = "Preprod" | "Preview" | "Mainnet";

export interface EtdGrant {
  stakeAddress:       string;
  paymentAddress:     string;
  /** Hash của payment credential: key-hash với `claim_account`; với két drip có thể là script hash. */
  ownerPkh:           string;
  entitlementOildrop: bigint;
}

/**
 * Nơi danh sách sẽ được mở tài khoản. Cổng ETD-GRANT-005 phụ thuộc vào nó:
 *  - `claim_account` (mặc định, `32_etd_claim.ts`): chỉ nhận ví KHOÁ — lý do ở đầu tệp.
 *  - `drip` (`33_drip_pot.ts`): nhận cả ví script. Két drip trả LAMP thẳng vào `vault` mà không cần
 *    người nhận ký (`Distribution/drip-pot/CONTRACT.md` v0.2), nên `did_payment` là đích hợp lệ.
 */
export type EtdGrantTarget = "claim_account" | "drip";

function fail(code: string, msg: string): never {
  throw new Error(`${code}: ${msg}`);
}

const networkIdOf = (n: EtdNetwork): 0 | 1 => (n === "Mainnet" ? 1 : 0);

/**
 * Đọc + soát danh sách. Ném ở lỗi ĐẦU TIÊN, kèm chỉ số dòng — danh sách sai một dòng thì không
 * cấp dòng nào, vì tổng ngân sách chỉ đúng khi cả danh sách đúng.
 */
export function parseEtdGrants(
  raw: unknown,
  network: EtdNetwork,
  opts: { target?: EtdGrantTarget } = {},
): EtdGrant[] {
  const target: EtdGrantTarget = opts.target ?? "claim_account";
  if (typeof raw !== "object" || raw === null) fail("ETD-GRANT-001", "tệp không phải một đối tượng JSON.");
  const o = raw as Record<string, unknown>;
  if (o.schema !== ETD_GRANTS_SCHEMA) {
    fail("ETD-GRANT-001", `schema '${String(o.schema)}', chờ '${ETD_GRANTS_SCHEMA}'.`);
  }
  if (o.network !== network) {
    fail("ETD-GRANT-002", `danh sách cho mạng '${String(o.network)}', đang chạy '${network}'.`);
  }
  if (o.pot !== ETD_POT_ID) fail("ETD-GRANT-003", `pot '${String(o.pot)}', chờ '${ETD_POT_ID}'.`);
  if (!Array.isArray(o.grants) || o.grants.length === 0) {
    fail("ETD-GRANT-004", "`grants` phải là mảng không rỗng.");
  }

  const wantNet = networkIdOf(network);
  const owners = new Map<string, number>();
  const stakes = new Map<string, number>();
  const out: EtdGrant[] = [];
  let sum = 0n;

  o.grants.forEach((g: unknown, i: number) => {
    const at = `dòng #${i}`;
    if (typeof g !== "object" || g === null) fail("ETD-GRANT-004", `${at} không phải đối tượng.`);
    const r = g as Record<string, unknown>;
    const stake = r.stake_address;
    const pay = r.payment_address;
    const ent = r.entitlement_oildrop;
    if (typeof stake !== "string" || typeof pay !== "string" || typeof ent !== "string") {
      fail("ETD-GRANT-004", `${at} thiếu stake_address / payment_address / entitlement_oildrop (cả ba là chuỗi).`);
    }

    let sd: ReturnType<typeof getAddressDetails>;
    try { sd = getAddressDetails(stake); } catch { fail("ETD-GRANT-006", `${at} stake_address không giải mã được.`); }
    if (sd.type !== "Reward" || !sd.stakeCredential) {
      fail("ETD-GRANT-006", `${at} stake_address không phải địa chỉ stake (reward).`);
    }
    if (sd.networkId !== wantNet) fail("ETD-GRANT-006", `${at} stake_address khác mạng ${network}.`);

    let pd: ReturnType<typeof getAddressDetails>;
    try { pd = getAddressDetails(pay); } catch { fail("ETD-GRANT-005", `${at} payment_address không giải mã được.`); }
    if (!pd.paymentCredential) fail("ETD-GRANT-005", `${at} payment_address không có payment credential.`);
    if (target === "claim_account" && pd.paymentCredential.type !== "Key") {
      fail(
        "ETD-GRANT-005",
        `${at} payment_address không phải ví khoá. Tài khoản claim_account chỉ trả về ví khoá của ` +
          `owner; ví script (Phoenix vault) nhận bằng một giao dịch chuyển tiếp SAU Redeem.`,
      );
    }
    if (pd.networkId !== wantNet) fail("ETD-GRANT-005", `${at} payment_address khác mạng ${network}.`);

    if (!/^[1-9][0-9]*$/.test(ent)) {
      fail("ETD-GRANT-009", `${at} entitlement_oildrop '${ent}' không phải số nguyên dương.`);
    }
    const e = BigInt(ent);

    const owner = pd.paymentCredential.hash.toLowerCase();
    const seenOwner = owners.get(owner);
    if (seenOwner !== undefined) {
      fail("ETD-GRANT-007", `${at} trùng ví nhận với dòng #${seenOwner} — một owner một tài khoản; gộp trước khi giao.`);
    }
    owners.set(owner, i);
    const stakeKey = sd.stakeCredential.hash.toLowerCase();
    const seenStake = stakes.get(stakeKey);
    if (seenStake !== undefined) fail("ETD-GRANT-008", `${at} trùng stake key với dòng #${seenStake}.`);
    stakes.set(stakeKey, i);

    sum += e;
    out.push({ stakeAddress: stake, paymentAddress: pay, ownerPkh: owner, entitlementOildrop: e });
  });

  const budget = potBudgetOildrop(ETD_POT_ID);
  if (sum > budget) {
    fail("ETD-GRANT-010", `tổng ${sum} oildrop vượt ngân sách pot ${ETD_POT_ID} ${budget} oildrop.`);
  }
  return out;
}

/** Tài khoản đã có trên chuỗi của một owner — chỉ những trường kế hoạch cần. */
export interface ExistingAccount {
  ref:         string;
  entitlement: bigint;
}

export interface EtdGrantPlan {
  /** Chưa có tài khoản ⇒ cấp mới. */
  toGrant: EtdGrant[];
  /** Đã có ĐÚNG MỘT tài khoản mang đúng E ⇒ lượt trước đã cấp, bỏ qua. */
  done:    EtdGrant[];
  /** Có tài khoản mà E lệch, hoặc nhiều hơn một ⇒ không tự xử, in ra cho người vận hành. */
  conflicts: { grant: EtdGrant; accounts: ExistingAccount[] }[];
}

/**
 * Chia danh sách theo trạng thái chuỗi. Chạy lại sau khi đứt giữa chừng là chạy tiếp, không cấp
 * trùng. Tài khoản có E khác số trong danh sách KHÔNG được nạp thêm tự động: `topup` dời mốc vesting
 * về cửa sổ hiện tại (C-ACC-3), tức đổi lịch nhả của người dùng — việc đó phải là một quyết định.
 */
export function planEtdGrants(grants: EtdGrant[], existing: Map<string, ExistingAccount[]>): EtdGrantPlan {
  const plan: EtdGrantPlan = { toGrant: [], done: [], conflicts: [] };
  for (const g of grants) {
    const accs = existing.get(g.ownerPkh) ?? [];
    if (accs.length === 0) plan.toGrant.push(g);
    else if (accs.length === 1 && accs[0]!.entitlement === g.entitlementOildrop) plan.done.push(g);
    else plan.conflicts.push({ grant: g, accounts: accs });
  }
  return plan;
}
