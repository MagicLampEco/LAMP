// Cross-check accountNftName off-chain ↔ on-chain (C-ACC-1, byte-perfect).
// Vector KHỚP Aiken test `account_nft_name_xcheck_offchain` trong account_nft.ak.

import { describe, it, expect } from "vitest";
import { accountNftName } from "../offchain/src/accountNft.js";

describe("accountNftName — byte-perfect với on-chain util.account_nft_name", () => {
  it("owner=0a0a channel=5445414d(TEAM) → vector cố định", () => {
    expect(accountNftName("0a0a", "5445414d")).toBe(
      "75b5f639e77e2233a728fb07499d76b8931597dd836dca9de3d87a6e6f9b6847",
    );
  });

  it("đổi channel → hash khác (không trùng)", () => {
    const team = accountNftName("0a0a", "5445414d");
    const reserve = accountNftName("0a0a", "5245534552564500");
    expect(reserve).not.toBe(team);
    expect(reserve).toHaveLength(64);
  });
});
