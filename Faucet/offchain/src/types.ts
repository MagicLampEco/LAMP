// Faucet offchain types — mirror onchain types.ak + ledger.ak (v2).

/** [LEGACY] Datum Faucet pool v1. claim_amount = lượng tLAMP (oil) mỗi claim. */
export interface FaucetDatum {
  claim_amount: bigint;
}

// ── Faucet v2 (DID-gated) ────────────────────────────────────────────────

/** Cấu hình Faucet pool (datum POOL UTxO). Khớp ledger.FaucetConfig.
 *  Constr(0, [drip_oil, cooldown_epochs, reclaim_epochs]). */
export interface FaucetConfig {
  drip_oil: bigint;
  cooldown_epochs: bigint;
  reclaim_epochs: bigint;
}

/** Datum faucet-account per-DID. Khớp ledger.FaucetAccount.
 *  Constr(0, [did_name (hex bytes), last_epoch]). */
export interface FaucetAccount {
  /** Asset name của DID NFT (hex) = định danh per-DID. */
  did_name: string;
  /** Epoch claim/dùng gần nhất. */
  last_epoch: bigint;
}
