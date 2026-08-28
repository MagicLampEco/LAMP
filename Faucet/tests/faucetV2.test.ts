// Faucet v2 codec round-trip + constant sanity (DID-gated, drip/cooldown/reclaim).

import { describe, it, expect } from "vitest";
import { Data } from "@lucid-evolution/lucid";
import {
  faucetConfigToCbor, faucetConfigFromCbor, decodeFaucetConfig,
  faucetAccountToCbor, faucetAccountFromCbor, decodeFaucetAccount,
  poolClaimRedeemerToCbor, poolReclaimRedeemerToCbor,
  accountUseRedeemerToCbor, accountReclaimIdleRedeemerToCbor,
  mintPoolRedeemerToCbor, mintAccountRedeemerToCbor,
} from "../offchain/src/datum.js";
import {
  DRIP_OILDROP, DRIP_LAMP, COOLDOWN, RECLAIM, OILDROP_PER_LAMP,
  POOL_NFT_NAME, ACCT_NFT_NAME, msPerEpoch, assertMsPerEpochMatchesNetwork,
} from "../offchain/src/constants.js";

function hexToAscii(hex: string): string {
  let s = "";
  for (let i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return s;
}

describe("FaucetConfig codec", () => {
  const cfg = { drip_oildrop: DRIP_OILDROP, cooldown_epochs: COOLDOWN, reclaim_epochs: RECLAIM };

  it("round-trips drip/cooldown/reclaim", () => {
    expect(faucetConfigFromCbor(faucetConfigToCbor(cfg))).toEqual(cfg);
  });

  it("encodes as Constr(0, [int,int,int])", () => {
    const back = decodeFaucetConfig(Data.from(faucetConfigToCbor(cfg)));
    expect(back.drip_oildrop).toBe(1_001_000_000n);
    expect(back.cooldown_epochs).toBe(36n);
    expect(back.reclaim_epochs).toBe(1001n);
  });

  it("rejects wrong field count", () => {
    // d8799f01ff = Constr(0, [1]) → 1 field → reject (FaucetConfig cần 3).
    expect(() => decodeFaucetConfig(Data.from("d8799f01ff"))).toThrow(/3 field/);
  });
});

describe("FaucetAccount codec", () => {
  const acct = { did_name: "a11ce0", last_epoch: 100n };

  it("round-trips did_name + last_epoch", () => {
    expect(faucetAccountFromCbor(faucetAccountToCbor(acct))).toEqual(acct);
  });

  it("encodes did_name as hex bytes, last_epoch as int", () => {
    const back = decodeFaucetAccount(Data.from(faucetAccountToCbor(acct)));
    expect(back.did_name).toBe("a11ce0");
    expect(back.last_epoch).toBe(100n);
  });

  it("preserves arbitrary did_name (PhoenixKey DID asset name)", () => {
    const a2 = { did_name: "deadbeefcafe", last_epoch: 9999n };
    expect(faucetAccountFromCbor(faucetAccountToCbor(a2))).toEqual(a2);
  });
});

describe("redeemers (Constr index khớp onchain enum order)", () => {
  it("PoolRedeemer: Claim=Constr0, Reclaim=Constr1", () => {
    expect(poolClaimRedeemerToCbor()).toBe("d87980");        // Constr(0,[])
    expect(poolReclaimRedeemerToCbor()).toBe("d87a80");      // Constr(1,[])
  });
  it("AccountRedeemer: Use=Constr0, ReclaimIdle=Constr1", () => {
    expect(accountUseRedeemerToCbor()).toBe("d87980");
    expect(accountReclaimIdleRedeemerToCbor()).toBe("d87a80");
  });
  it("FaucetNftRedeemer: MintPool=Constr0, MintAccount=Constr1", () => {
    expect(mintPoolRedeemerToCbor()).toBe("d87980");
    expect(mintAccountRedeemerToCbor()).toBe("d87a80");
  });
});

describe("constants — drip 1001, cooldown 36, reclaim 1001", () => {
  it("DRIP = 1001 LAMP = 1_001_000_000 oildrop", () => {
    expect(DRIP_LAMP).toBe(1001n);
    expect(DRIP_OILDROP).toBe(1_001_000_000n);
    expect(DRIP_OILDROP).toBe(DRIP_LAMP * OILDROP_PER_LAMP);
  });
  it("COOLDOWN = 36 epoch", () => {
    expect(COOLDOWN).toBe(36n);
  });
  it("RECLAIM = 1001 epoch", () => {
    expect(RECLAIM).toBe(1001n);
  });
  it("NFT names: POOL=504f4f4c, ACCT=41434354", () => {
    expect(POOL_NFT_NAME).toBe("504f4f4c");
    expect(ACCT_NFT_NAME).toBe("41434354");
    // sanity: hex decode = ASCII "POOL" / "ACCT".
    expect(hexToAscii(POOL_NFT_NAME)).toBe("POOL");
    expect(hexToAscii(ACCT_NFT_NAME)).toBe("ACCT");
  });
  // Hằng cũ `MS_PER_EPOCH_PREVIEW = 432_000_000n` mang tên Preview nhưng giữ số của
  // Preprod/Mainnet — lệch 5×. Test cũ khoá chặt đúng con số sai đó, nên ai sửa hằng cho
  // khớp tên sẽ thấy test đỏ rồi revert. Thay bằng: ms/epoch phải THEO MẠNG.
  it("ms/epoch lấy theo mạng: Preview 86_400_000 · Preprod/Mainnet 432_000_000", () => {
    expect(msPerEpoch("Preview")).toBe(86_400_000n);
    expect(msPerEpoch("Preprod")).toBe(432_000_000n);
    expect(msPerEpoch("Mainnet")).toBe(432_000_000n);
  });

  it("FAUCET-EPOCH-001: cổng gác chặn nạp 432_000_000 (Preprod) vào Preview", () => {
    expect(() => assertMsPerEpochMatchesNetwork(432_000_000n, "Preview"))
      .toThrow(/FAUCET-EPOCH-001/);
    // và ngược lại — 86_400_000 nạp vào Preprod cũng phải chặn.
    expect(() => assertMsPerEpochMatchesNetwork(86_400_000n, "Preprod"))
      .toThrow(/FAUCET-EPOCH-001/);
    // đúng mạng thì im lặng đi qua.
    expect(() => assertMsPerEpochMatchesNetwork(86_400_000n, "Preview")).not.toThrow();
  });

  it("cooldown/reclaim quy ra ngày thật trên Preview (36 epoch = 36 ngày, không phải 180)", () => {
    const day = 86_400_000n;
    expect(COOLDOWN * msPerEpoch("Preview") / day).toBe(36n);
    expect(RECLAIM * msPerEpoch("Preview") / day).toBe(1001n);
  });
});

describe("rate-limit math (cooldown / reclaim epoch arithmetic)", () => {
  it("re-claim hợp lệ khi now ≥ last + cooldown", () => {
    const last = 100n;
    expect(last + COOLDOWN).toBe(136n);  // claim kế tiếp sớm nhất epoch 136
  });
  it("reclaim hợp lệ khi now ≥ last + reclaim", () => {
    const last = 100n;
    expect(last + RECLAIM).toBe(1101n);  // thu hồi sớm nhất epoch 1101
  });
});
