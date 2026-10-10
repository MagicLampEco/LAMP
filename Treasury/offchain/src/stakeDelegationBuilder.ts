// Treasury stakeDelegationBuilder — đăng ký + uỷ quyền phần STAKE của địa chỉ kho.
//
// VÌ SAO CẦN TỆP NÀY: địa chỉ kho là địa chỉ BASE (payment = `custody`, stake =
// `treasury_stake`, xem `stakeBuilder.ts` ▸ `custodyBaseAddress`). Phần stake đó chỉ sinh
// thưởng khi credential đã ĐĂNG KÝ và đã UỶ QUYỀN cho một pool. Có địa chỉ base mà không có
// hai chứng chỉ này thì kho đứng yên đúng như một địa chỉ enterprise, và nhánh
// `StakeRewardIn` không bao giờ có gì để ghi sổ.
//
// LUẬT ON-CHAIN mà builder này phục vụ: `Treasury/onchain/lib/magiclamp/treasury/stake.ak`
// ▸ `certificate_ok`
//   RegisterCredential / DelegateCredential / RegisterAndDelegateCredential → chữ ký
//     `delegation_admin` (khe thứ ba của `treasury_stake`) phải có trong extra_signatories.
//   UnregisterCredential → luôn TỪ CHỐI (cọc đăng ký không rút ra được, kho không tự tắt).
//   Mọi chứng chỉ khác (kể cả uỷ quyền phiếu DRep) → TỪ CHỐI.
//   Redeemer bị bỏ qua ⇒ dùng `Data.void()`.
//
// VÌ SAO HAI CHỨNG CHỈ RIÊNG (`reg_cert` + `stake_delegation`) chứ không gộp
// `stake_reg_deleg_cert`: hai cách đều qua `certificate_ok`, nhưng bộ giả lập của lucid
// (`Emulator`) không xử lý loại gộp — nó bỏ qua chứng chỉ đó và không ghi trạng thái, nên
// không có bài kiểm nào chạy được đường gộp tới cuối. Đường tách thì bộ giả lập chạy trọn,
// kể cả đánh giá script. Giá phải trả: script chạy hai lần thay vì một (hai redeemer chứng
// chỉ), và giao dịch nặng thêm vài chục byte.
//
// VÌ SAO ĐĂNG KÝ ĐI QUA `reg_cert` CÓ REDEEMER chứ không qua `stake_registration` kiểu cũ:
// lucid dựng kiểu cũ khi không truyền redeemer, và kiểu cũ KHÔNG đòi nhân chứng ⇒ script
// không chạy ⇒ ai cũng đăng ký hộ được. Vô hại về tiền (cọc nằm lại vĩnh viễn vì nhánh huỷ
// đăng ký bị cấm), nhưng nó bỏ qua đúng cổng chữ ký mà `certificate_ok` dựng ra. Truyền
// redeemer ⇒ lucid dựng `reg_cert` (Conway) ⇒ script chạy ⇒ cổng chữ ký có hiệu lực.

import {
  CML, Data, validatorToRewardAddress,
  type LucidEvolution, type Network, type TxBuilder, type Validator,
} from "@lucid-evolution/lucid";

/** `register-and-delegate`: credential chưa đăng ký (lần đầu).
 *  `delegate`: đã đăng ký, chỉ đổi pool. */
export type StakeDelegationMode = "register-and-delegate" | "delegate";

export interface StakeDelegationParams {
  network: Network;
  /** `treasury_stake` ĐÃ apply ba khe — cùng script làm phần stake của địa chỉ kho. */
  stakeScript: Validator;
  /** Pool đích, dạng bech32 `pool1…`. */
  poolId: string;
  /** Khoá `delegation_admin` đã nướng vào `stakeScript`. Builder không đọc ngược được khe
   *  này từ script đã apply; truyền sai khoá thì giao dịch chết ở bước đánh giá script. */
  delegationAdmin: string;
  mode: StakeDelegationMode;
}

export interface StakeDelegationPlan {
  rewardAddress: string;
  poolId: string;
  delegationAdmin: string;
  /** Chứng chỉ sẽ dựng, đúng thứ tự trong giao dịch. */
  certs: Array<"register" | "delegate">;
}

/** Kiểm pool id: bech32 tiền tố `pool`, đúng checksum, 28 byte. Trả lại chuỗi đã chuẩn hoá. */
export function assertPoolId(poolId: string): string {
  const s = poolId.trim();
  if (!s.startsWith("pool1")) {
    throw new Error(`TDELEG-001: pool id phải là bech32 tiền tố "pool1", nhận: ${poolId}`);
  }
  try {
    return CML.Ed25519KeyHash.from_bech32(s).to_bech32("pool");
  } catch {
    throw new Error(`TDELEG-002: pool id không giải mã được (sai checksum hoặc sai độ dài): ${poolId}`);
  }
}

function assertAdmin(admin: string): string {
  const h = admin.trim().toLowerCase();
  if (!/^[0-9a-f]{56}$/.test(h)) {
    throw new Error(`TDELEG-003: delegation_admin phải là 28 byte hex (56 ký tự), nhận ${admin.length} ký tự.`);
  }
  return h;
}

/** Phần thuần: kiểm đầu vào + tính reward address + danh sách chứng chỉ. Không cần provider. */
export function planStakeDelegation(p: StakeDelegationParams): StakeDelegationPlan {
  if (p.mode !== "register-and-delegate" && p.mode !== "delegate") {
    throw new Error(`TDELEG-004: mode phải là "register-and-delegate" hoặc "delegate", nhận: ${String(p.mode)}`);
  }
  return {
    rewardAddress: validatorToRewardAddress(p.network, p.stakeScript),
    poolId: assertPoolId(p.poolId),
    delegationAdmin: assertAdmin(p.delegationAdmin),
    certs: p.mode === "register-and-delegate" ? ["register", "delegate"] : ["delegate"],
  };
}

/**
 * Dựng giao dịch đăng ký (nếu cần) + uỷ quyền. Trả `TxBuilder` CHƯA `complete()` để bên gọi
 * tự chọn ví trả phí và tự ký.
 *
 * Chữ ký `delegation_admin` là bắt buộc. Builder thêm nó vào `required_signers`; ví ký phải
 * giữ đúng khoá đó, nếu không giao dịch không qua bước đánh giá script.
 */
export function buildStakeDelegation(lucid: LucidEvolution, p: StakeDelegationParams): TxBuilder {
  const plan = planStakeDelegation(p);
  let tx = lucid.newTx();
  if (plan.certs.includes("register")) {
    tx = tx.register.Stake(plan.rewardAddress, Data.void());
  }
  return tx
    .delegate.ToPool(plan.rewardAddress, plan.poolId, Data.void())
    .attach.CertificateValidator(p.stakeScript)
    .addSignerKey(plan.delegationAdmin);
}
