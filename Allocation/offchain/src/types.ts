// LAMP Allocation offchain types — mirror onchain lib/magiclamp/allocation/types.ak.
// HARD-CAP PER-CHANNEL (Capped Drop tất định). Mọi giá trị là oildrop (1 LAMP = 10^6 oildrop).
// PHẢI khớp byte-perfect: Constr index = thứ tự khai báo trong types.ak (Aiken từ 0).
//
// Bất biến (types.ak §): 0 ≤ redeemed ≤ entitlement; vested cộng dồn cap E.
//   vested(t)  = min(entitlement, D · drops_per_epoch · max(0, t − start_epoch))
//   redeemable = vested − redeemed
// Σ entitlement đã cấp của kênh ≤ ChannelBudget gốc (Lớp A); treasury con value = budget (Lớp B).

/** Per-wallet account tại claim_account script.
 *  = Constr(0, [bytes, int, int, int, int, bytes]) — channel_id là field CUỐI. */
export interface ClaimAccountDatum {
  owner           : string;  // PKH hex (28-byte)
  entitlement     : bigint;  // E — tổng LAMP được phân bổ (oildrop)
  redeemed        : bigint;  // đã nhận tích lũy (oildrop)
  start_epoch     : bigint;  // t0 (đặt lùi = cliff)
  drops_per_epoch : bigint;  // nhịp nhả
  channel_id      : string;  // kênh hex ("TEAM"/"RESERVE"... bind vào budget NFT name)
}

/** Beacon ngân sách kênh (Lớp A). authenticity = NFT riêng (name = channel_id).
 *  = Constr(0, [bytes, int]). */
export interface ChannelBudgetDatum {
  channel_id    : string;  // định danh kênh hex (bind vào budget NFT name)
  remaining_oildrop : bigint;  // oildrop còn được phép CẤP (entitlement) cho kênh
}

/** Treasury con per-channel (Lớp B). Giữ LAMP pool ĐÚNG budget kênh.
 *  = Constr(0, [bytes, bytes]). */
export interface TreasuryDatum {
  committee_hash : string;  // hex
  channel_id     : string;  // hex — ép account redeem từ treasury đúng kênh
}

/** ClaimAccountRedeemer: Claim{amount}=Constr(0,[int]); Redeem=Constr(1,[]). */
export type ClaimAccountRedeemer =
  | { kind: "Claim"; amount: bigint }
  | { kind: "Redeem" };

/** ChannelBudgetRedeemer: Decrement{amount}=Constr(0,[int]). */
export type ChannelBudgetRedeemer = { kind: "Decrement"; amount: bigint };

/** TreasuryRedeemer: ReleaseForRedeem=Constr(0,[]). */
export type TreasuryRedeemer = "ReleaseForRedeem";

/** BudgetNftRedeemer: MintGenesis=Constr(0,[]) (budget_nft.ak one-shot). */
export type BudgetNftRedeemer = "MintGenesis";
