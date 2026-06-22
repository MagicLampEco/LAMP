// Airdrop offchain types (§6.2). Mọi field tiền = oil; stake = lovelace.

/** Đăng ký pool on-chain: SPO mint registration-NFT (§6.2).
 *  Off-chain keeper đọc tập này để biết pool nào đủ tư cách nhận phân phối. */
export interface PoolRegistration {
  /** bech32 / hex pool id. */
  poolId: string;
  /** payment-credential hash (pkh hex) ví NHẬN LAMP của SPO (= reward owner trên Merkle). */
  spoRewardOwner: string;
  /** epoch SPO đăng ký (nhận phân phối TỪ epoch này trở đi). */
  epochRegistered: bigint;
}

/** 1 dòng stake của 1 delegator trong 1 pool, tại 1 epoch snapshot. */
export interface DelegatorStake {
  /** payment-credential hash (pkh hex) — đích nhận LAMP. */
  owner: string;
  /** pool delegator đang ủy thác. */
  poolId: string;
  /** stake (lovelace) trong epoch của snapshot. */
  stake: bigint;
}

/** Trạng thái đủ-điều-kiện của 1 pool trong 1 epoch (cho phần thưởng SPO). */
export interface PoolEpochStatus {
  poolId: string;
  /** SPO có sản xuất block trong epoch không (§6.2 — điều kiện nhận thưởng SPO). */
  producedBlock: boolean;
}

/** Snapshot 1 epoch: pool đã đăng ký + trạng thái + stake delegator. */
export interface EpochSnapshot {
  epoch: bigint;
  /** Pool đã đăng ký TÍNH ĐẾN epoch này (epochRegistered ≤ epoch). */
  registrations: PoolRegistration[];
  /** Trạng thái block per pool (thiếu pool ⇒ coi như KHÔNG sản xuất block). */
  poolStatus: PoolEpochStatus[];
  /** Stake delegator trong epoch. */
  delegators: DelegatorStake[];
}

/** Tham số phân phối 1 epoch. */
export interface DistributeParams {
  /** Ngân sách SPO epoch này (oil). Mặc định B_spo = PER_EPOCH × 20/120. */
  spoBudgetOil: bigint;
  /** Ngân sách Delegator epoch này (oil). Mặc định B_del = PER_EPOCH × 100/120. */
  delegatorBudgetOil: bigint;
  /** Sàn stake (lovelace) để pool đủ tư cách nhận thưởng SPO (chống Sybil tách pool). */
  floorStake: bigint;
}

/** Entitlement 1 owner trong 1 epoch (đã gộp vai trò SPO + delegator nếu trùng ví). */
export interface AirdropEntitlement {
  /** payment-credential hash (pkh hex). */
  owner: string;
  /** Phân bổ epoch NÀY (oil). */
  wonThisEpoch: bigint;
  /** Cộng dồn qua mọi epoch ≤ hiện tại (oil) — chính là giá trị leaf Merkle. */
  wonCumulative: bigint;
}

/** Kết quả phân phối 1 epoch. */
export interface DistributeResult {
  entitlements: AirdropEntitlement[];
  /** oil không phân bổ được (pool SPO không đủ tư cách → forfeit) — về treasury. */
  leftover: bigint;
  /** tổng phân bổ epoch này = Σ wonThisEpoch. */
  distributed: bigint;
}
