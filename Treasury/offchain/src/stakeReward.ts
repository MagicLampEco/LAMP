// Gương off-chain của nhánh `StakeRewardIn` — toán SỔ thuần, không dựng tx.
//
// Nguồn cưỡng chế: `Treasury/onchain/lib/magiclamp/treasury/stake_reward.ak`
//   • `stake_reward_bucket_id` (= STAKE_REWARD_BUCKET_ID ở `constants.ts`)
//   • `reward_policy` = #"" ⇒ CHỈ ADA
//   • `value_ok`  — ĐẲNG THỨC lovelace, và phi-lovelace bảo toàn
//   • `ledger_ok` — sổ ra == sổ vào + Δ tại ĐÚNG MỘT dòng (bucket thưởng, ADA)
//
// Vì sao tệp này tồn tại dù chưa có bộ dựng tx: nhánh on-chain đã sống, nên off-chain
// thiếu gương là chỗ hai bên trôi nhau trong im lặng. Bộ dựng tx (`stakeRewardBuilder.ts`)
// chỉ cần khi thưởng uỷ quyền thật sự về — sau khi kho đã uỷ quyền và qua đủ số kỷ nguyên.
//
// KHÁC `migrate.ts` ở đúng hai chỗ, cả hai đều SIẾT chứ không nới:
//   1. asset cố định ADA, không nhận (policy, name) từ người gọi — thưởng uỷ quyền trên
//      Cardano không có biến thể nào khác, nên một tham số ở đây chỉ mở bề mặt chọn.
//   2. không có nhãn nguồn (`source`) để kiểm — nhánh này không mint, nên không có gì để
//      gắn nhãn; thay vào đó `amount` bị ép bằng ĐẲNG THỨC với độ tăng lovelace thật.

import { ledgerOk } from "./migrate.js";
import { assetKey, sortLedger } from "./collect.js";
import { STAKE_REWARD_BUCKET_ID } from "./constants.js";
import type { CustodyDatum, LedgerEntry } from "./types.js";

export { STAKE_REWARD_BUCKET_ID };

/** policy/name của asset thưởng — ADA, ghim theo `stake_reward.reward_policy`. */
export const REWARD_POLICY = "";
export const REWARD_NAME = "";

/** Gương `stake_reward.value_ok`: lovelace ra == lovelace vào + Δ (ĐẲNG THỨC, không phải
 *  `>=`), và mọi asset phi-lovelace bảo toàn nguyên.
 *
 *  Vì sao đẳng thức chứ không `>=` như `MigrateIn`: `>=` cho phép ADA chảy vào kho mà
 *  KHÔNG có dòng sổ tương ứng — chính cái lỗ mà docstring `migrate.value_ok` đã khai nhận
 *  và chấp nhận vì sức ép min-UTxO lúc mint. Nhánh này không mint nên không có sức ép đó,
 *  nên không có lý do nới. */
export function valueOk(
  lovelaceIn: bigint, lovelaceOut: bigint,
  nonAdaIn: ReadonlyArray<{ policy: string; name: string; amount: bigint }>,
  nonAdaOut: ReadonlyArray<{ policy: string; name: string; amount: bigint }>,
  delta: bigint,
): boolean {
  if (lovelaceOut !== lovelaceIn + delta) return false;
  const norm = (xs: ReadonlyArray<{ policy: string; name: string; amount: bigint }>) =>
    xs.filter((x) => x.amount !== 0n)
      .map((x) => `${assetKey(x.policy, x.name)}:${x.amount}`)
      .sort()
      .join("|");
  return norm(nonAdaIn) === norm(nonAdaOut);
}

/** Gương `stake_reward.ledger_ok` — tái dùng `ledgerOk` của `migrate.ts` với bucket + asset
 *  của nhánh thưởng. KHÔNG chép lại phần thân: hai bên phải sai cùng lúc hoặc đúng cùng lúc. */
export function ledgerRewardOk(ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[], delta: bigint): boolean {
  return ledgerOk(ledgerIn, ledgerOut, STAKE_REWARD_BUCKET_ID, REWARD_POLICY, REWARD_NAME, delta);
}

/** Sổ SAU khi nạp Δ thưởng vào dòng (STAKE_REWARD_BUCKET_ID, ADA), dạng canonical.
 *
 *  Cộng vào dòng đã có, hoặc thêm dòng mới. Không prune: Δ > 0 nên không dòng nào về 0.
 *  ⟹ số DÒNG sổ không tăng sau lượt thưởng thứ hai trở đi — đây là tính chất đáng giữ,
 *  vì kho là MỘT UTxO và datum phình là đường kho tự khoá mình khỏi chi tiêu. */
export function planStakeRewardLedger(ledgerIn: LedgerEntry[], delta: bigint): LedgerEntry[] {
  if (delta <= 0n) {
    throw new Error(`TSTK-001: delta phải > 0 (nhận ${delta}) — C-STK-6 từ chối lượt rỗng.`);
  }
  const target = assetKey(REWARD_POLICY, REWARD_NAME);
  let hit = false;
  const out = ledgerIn.map((e) => {
    if (e.bucket_id === STAKE_REWARD_BUCKET_ID && assetKey(e.policy, e.name) === target) {
      hit = true;
      return { ...e, amount: e.amount + delta };
    }
    return { ...e };
  });
  if (!hit) {
    out.push({ bucket_id: STAKE_REWARD_BUCKET_ID, policy: REWARD_POLICY, name: REWARD_NAME, amount: delta });
  }
  return sortLedger(out);
}

/** Datum custody SAU lượt StakeRewardIn: CHỈ `ledger` và `epoch` đổi (C-STK-3).
 *
 *  `consumed_proposals` bảo toàn nguyên — nhánh này KHÔNG được làm đường vòng cho `Release`.
 *  Ném sớm khi ADA chưa nằm trong `accepted_assets`: on-chain C-STK-9 sẽ từ chối, và nếu
 *  kho đã gieo thiếu ADA thì thưởng kẹt vĩnh viễn, nên đây là chỗ phải kêu TO — điều kiện
 *  gieo, không phải lỗi lúc chạy. */
export function planStakeRewardDatum(datumIn: CustodyDatum, delta: bigint, epoch: bigint): CustodyDatum {
  const adaAccepted = datumIn.accepted_assets.some(
    (a) => assetKey(a.policy, a.name) === assetKey(REWARD_POLICY, REWARD_NAME),
  );
  if (!adaAccepted) {
    throw new Error(
      "TSTK-002: ADA KHÔNG nằm trong accepted_assets của kho — C-STK-9 sẽ từ chối mọi lượt " +
      "StakeRewardIn. Đây là ĐIỀU KIỆN GIEO: kho đã gieo thiếu ADA thì thưởng uỷ quyền không " +
      "có đường vào sổ, và không có cách sửa nào ngoài gieo lại instance khác.",
    );
  }
  if (epoch < datumIn.epoch) {
    throw new Error(`TSTK-003: epoch ra (${epoch}) < epoch vào (${datumIn.epoch}) — C-STK-4 ép epoch không lùi.`);
  }
  return { ...datumIn, ledger: planStakeRewardLedger(datumIn.ledger, delta), epoch };
}
