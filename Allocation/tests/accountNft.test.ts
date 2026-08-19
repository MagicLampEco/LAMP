// Cross-check accountNftName off-chain ↔ on-chain (C-ACC-1, byte-perfect).
// Vector KHỚP Aiken test `account_nft_name_xcheck_offchain` trong account_nft.ak.
//
// Owner ở đây là 28 byte — hình dạng THẬT của pkh, và cũng là điều kiện cổng mint ép
// (`expect bytearray.length(ad.owner) == 28`). Vector cũ dùng owner 2 byte nên nó chưa
// bao giờ chạy qua hình dạng mà hệ thật dùng.

import { describe, it, expect } from "vitest";
import { accountNftName } from "../offchain/src/accountNft.js";

describe("accountNftName — byte-perfect với on-chain util.account_nft_name", () => {
  const OWNER = "0a".repeat(28);

  it("owner=0a×28 channel=5445414d(TEAM) → vector cố định", () => {
    expect(accountNftName(OWNER, "5445414d")).toBe(
      "57cab37b93654b7afaec9e1bc9a1e9c37fd99ea4c57b47c04bd4f405991b3066",
    );
  });

  it("owner sai độ dài bị chặn NGAY — biên owner‖channel mập mờ nếu không ghim", () => {
    expect(() => accountNftName("0a0a", "5445414d")).toThrow(/ACC-NFT-001/);
    expect(() => accountNftName(OWNER + "0a", "5445414d")).toThrow(/ACC-NFT-001/);
  });

  it("đổi channel → hash khác (không trùng)", () => {
    const team = accountNftName(OWNER, "5445414d");
    const reserve = accountNftName(OWNER, "5245534552564500");
    expect(reserve).not.toBe(team);
    expect(reserve).toHaveLength(64);
  });
});
