// Faucet offchain types — mirror onchain types.ak.

/** Datum của Faucet pool UTxO. claim_amount = lượng tLAMP (oil) mỗi claim. */
export interface FaucetDatum {
  claim_amount: bigint;
}
