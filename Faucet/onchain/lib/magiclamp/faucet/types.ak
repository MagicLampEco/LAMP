// Faucet onchain types — tLAMP canonical testnet token + Faucet pool.
//
// FaucetDatum: hằng số trên pool UTxO. KHÔNG mang state per-claim (pool
// permissionless, ai cũng claim đúng 100 tLAMP). `claim_amount` để DAO/test
// chỉnh lượng/claim mà không recompile (tham số hoá runtime, không cần redeploy).
//
//   FaucetDatum{ claim_amount } = Constr(0, [int])
//
// FaucetRedeemer: chỉ 1 action `Claim`. KHÔNG có Drain/Admin — pool test
// đơn giản, value tự bảo toàn qua validator (pool_out = pool_in − claim_amount).
//
//   Claim = Constr(0, [])

/// Datum của Faucet pool UTxO.
pub type FaucetDatum {
  /// Lượng tLAMP (oil) mỗi lần claim. MVP = 100 × 10^6 = 100_000_000.
  claim_amount: Int,
}

/// Redeemer của Faucet spend. Chỉ Claim (permissionless).
pub type FaucetRedeemer {
  Claim
}
