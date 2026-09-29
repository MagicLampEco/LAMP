// Faucet v3 constants sanity + acctName (DID-anchored ACCT NFT asset name).
//
// Codec (FaucetConfig/PoolDatum/FaucetAccount/redeemers) đã chuyển sang `datum.test.ts` —
// tệp này giữ tên cũ ("V2") vì lịch sử, nội dung nay CHỈ còn constants + acctName + rate-limit
// math (không phải codec, xem `Forall §Một tài liệu = MỘT file nguồn`).

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DRIP_OILDROP, DRIP_LAMP, COOLDOWN, RECLAIM, OILDROP_PER_LAMP,
  POOL_NFT_NAME, ACCT_NFT_NAME, MAX_CLAIMS_CEILING, acctName,
  msPerEpoch, assertMsPerEpochMatchesNetwork,
} from "../offchain/src/constants.js";

function hexToAscii(hex: string): string {
  let s = "";
  for (let i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return s;
}

describe("constants — drip 1001, cooldown 36, reclaim 72, max_claims ceiling 100", () => {
  it("DRIP = 1001 LAMP = 1_001_000_000 oildrop", () => {
    expect(DRIP_LAMP).toBe(1001n);
    expect(DRIP_OILDROP).toBe(1_001_000_000n);
    expect(DRIP_OILDROP).toBe(DRIP_LAMP * OILDROP_PER_LAMP);
  });
  it("COOLDOWN = 36 cửa sổ", () => {
    expect(COOLDOWN).toBe(36n);
  });
  it("RECLAIM = 72 cửa sổ (hằng compile-time on-chain, không còn trường datum)", () => {
    expect(RECLAIM).toBe(72n);
  });
  // Bản chép có nhãn phải khớp NGUỒN: đọc thẳng `reclaim_epochs_const` trong `handlers.ak`.
  // Không tìm thấy dòng khai ⇒ ĐỎ (không đo được thì không được xanh).
  it("RECLAIM khớp `reclaim_epochs_const` trong onchain/lib/magiclamp/faucet/handlers.ak", async () => {
    const src = await readFile(resolve(process.cwd(), "../onchain/lib/magiclamp/faucet/handlers.ak"), "utf8");
    const m = src.match(/^\s*(?:pub\s+)?const\s+reclaim_epochs_const\s*:\s*Int\s*=\s*([0-9_]+)\s*$/m);
    expect(m, "không tìm thấy dòng khai reclaim_epochs_const trong handlers.ak").not.toBeNull();
    expect(BigInt(m![1]!.replace(/_/g, ""))).toBe(RECLAIM);
  });
  it("MAX_CLAIMS_CEILING = 100 (trần compile-time C-MP-7)", () => {
    expect(MAX_CLAIMS_CEILING).toBe(100n);
  });
  it("NFT names: POOL=504f4f4c, tiền tố ACCT=41434354", () => {
    expect(POOL_NFT_NAME).toBe("504f4f4c");
    expect(ACCT_NFT_NAME).toBe("41434354");
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
    expect(() => assertMsPerEpochMatchesNetwork(86_400_000n, "Preprod"))
      .toThrow(/FAUCET-EPOCH-001/);
    expect(() => assertMsPerEpochMatchesNetwork(86_400_000n, "Preview")).not.toThrow();
  });

  it("cooldown/reclaim quy ra ngày thật trên Preview (36 epoch = 36 ngày, không phải 180)", () => {
    const day = 86_400_000n;
    expect(COOLDOWN * msPerEpoch("Preview") / day).toBe(36n);
    expect(RECLAIM * msPerEpoch("Preview") / day).toBe(72n);
  });
});

describe("acctName — ACCT NFT neo vào DID, đúng 32 byte", () => {
  it("prefix 4 byte + digest 28 byte = 32 byte (đúng trần asset name Cardano)", () => {
    const name = acctName("a11ce0");
    expect(name.length).toBe(64);           // 32 byte = 64 hex char
    expect(name.startsWith(ACCT_NFT_NAME)).toBe(true);
    expect(name.slice(0, 8)).toBe("41434354");
  });

  it("acctName(\"\") = \"ACCT\" ‖ BLAKE2b-224(\"\") theo vector RFC 7693 — neo hàm vào hằng ngoài, không vào thư viện nó dùng", () => {
    expect(acctName("")).toBe(ACCT_NFT_NAME + "836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07");
  });

  it("digest dài đúng 28 byte, tổng 32 byte (trần asset name)", () => {
    expect(acctName("a11ce0").length).toBe(64);
  });

  it("hai DID khác nhau → asset name khác nhau (không đụng namespace)", () => {
    expect(acctName("a11ce0")).not.toBe(acctName("b0b0b0"));
  });

  it("cùng DID → asset name ỔN ĐỊNH (deterministic, không random)", () => {
    expect(acctName("a11ce0")).toBe(acctName("a11ce0"));
  });

  it("ném lỗi có mã khi did_name không phải hex hợp lệ — hình dạng lạ thì NÉM, không đệm", () => {
    expect(() => acctName("not-hex!")).toThrow(/FAUCET-ACCTNAME-001/);
    expect(() => acctName("abc")).toThrow(/FAUCET-ACCTNAME-001/);   // độ dài lẻ
  });
});

describe("rate-limit math (cooldown / reclaim epoch arithmetic — offchain mirror)", () => {
  it("re-claim hợp lệ khi now ≥ last_claim_epoch + cooldown", () => {
    const last = 100n;
    expect(last + COOLDOWN).toBe(136n);  // claim kế tiếp sớm nhất epoch 136
  });
  it("reclaim hợp lệ khi now ≥ last_touch_epoch + reclaim", () => {
    const last = 100n;
    expect(last + RECLAIM).toBe(172n);  // thu hồi sớm nhất epoch 172 (khớp biên `faucet_account.ak`)
  });
});
