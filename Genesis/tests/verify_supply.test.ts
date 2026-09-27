// Phần THUẦN của công cụ kiểm cung mainnet (scripts/verify_mainnet_supply.ts).
// Số script đó in ra là số đem CÔNG BỐ, nên phép CHỌN UTxO SupplyState phải fail-closed:
// định danh nằm ở SUPPLY thread NFT (policy + name), không nằm ở địa chỉ và cũng không nằm ở
// "có inline datum". Import file script không bắn koios — main() có guard argv.

import { describe, it, expect } from "vitest";
import { pickSupplyState, parseSupplyDatum, closureVerdict, type KoiosUtxo } from "../scripts/verify_mainnet_supply.js";
import { LAMP_MAINNET } from "../offchain/src/deployed.js";

const THREAD = LAMP_MAINNET.mintParams.find((p) => p.name === "thread_nft_policy")!.cborHex.slice(4);
const SUPPLY_NAME = "535550504c59"; // "SUPPLY"

const datum = (...ints: number[]) => ({ value: { fields: ints.map((i) => ({ int: String(i) })) } });

/** UTxO SupplyState thật: mang thread NFT + datum 4 field. */
const real: KoiosUtxo = {
  inline_datum: datum(26_370_000_000_000_000, 0, 26_370_000_000_000_000, 9_630_000_000_000_000),
  asset_list: [{ policy_id: THREAD, asset_name: SUPPLY_NAME, quantity: "1" }],
};

/** Kẻ tấn công: ~1 ADA + inline datum bịa gửi vào supplyStateAddress. Ai cũng làm được. */
const forged: KoiosUtxo = { inline_datum: datum(1, 2, 3, 4), asset_list: [] };

/** Kẻ tấn công khá hơn: đúc token TÊN "SUPPLY" dưới policy của chính họ. */
const forgedWithFakeNft: KoiosUtxo = {
  inline_datum: datum(1, 2, 3, 4),
  asset_list: [{ policy_id: "ff".repeat(28), asset_name: SUPPLY_NAME, quantity: "1" }],
};

describe("pickSupplyState", () => {
  it("chọn UTxO mang thread NFT dù nó KHÔNG đứng đầu danh sách", () => {
    expect(pickSupplyState([forged, real])).toBe(real);
  });

  it("ném khi chỉ có UTxO datum bịa — thà dừng còn hơn in số của kẻ khác", () => {
    expect(() => pickSupplyState([forged])).toThrow(/thread NFT/);
  });

  it("ném khi NFT giả chỉ trùng asset_name, khác policy", () => {
    expect(() => pickSupplyState([forgedWithFakeNft])).toThrow(/thread NFT/);
  });

  it("ném khi không có UTxO nào", () => {
    expect(() => pickSupplyState([])).toThrow(/thread NFT/);
  });
});

describe("parseSupplyDatum", () => {
  it("đọc đủ 4 field theo đúng thứ tự", () => {
    expect(parseSupplyDatum(real)).toEqual([
      26_370_000_000_000_000n, 0n, 26_370_000_000_000_000n, 9_630_000_000_000_000n,
    ]);
  });

  it("ném khi datum không đúng 4 field", () => {
    expect(() => parseSupplyDatum({ inline_datum: datum(1, 2) })).toThrow(/chờ 4/);
  });
});

describe("closureVerdict", () => {
  const LOCK = LAMP_MAINNET.closure!.lockVaultAddress;
  const CAP = 26_370_000_000_000_000n;
  const closedObs = {
    distMinted: CAP, reserveMinted: 0n, distCap: CAP, khoLamp: 0n,
    holders: [{ address: LOCK, quantity: CAP }],
  };

  it("trạng thái mainnet sau hai tx đóng ⇒ ĐÃ ĐÓNG", () => {
    expect(closureVerdict(closedObs, LOCK).closed).toBe(true);
  });

  it("quota chưa cạn ⇒ chưa đóng", () => {
    const r = closureVerdict({ ...closedObs, distMinted: CAP - 1n, holders: [{ address: LOCK, quantity: CAP - 1n }] }, LOCK);
    expect(r.closed).toBe(false);
    expect(r.reasons.join()).toMatch(/dist_minted == dist_cap/);
  });

  it("kho còn LAMP ⇒ chưa đóng", () => {
    expect(closureVerdict({ ...closedObs, khoLamp: 1n }, LOCK).closed).toBe(false);
  });

  it("một địa chỉ ngoài lock_vault giữ LAMP ⇒ chưa đóng (dù tổng ở lock_vault vẫn khớp)", () => {
    // lock_vault giữ ĐỦ tổng đã đúc ⇒ chỉ chốt "ngoài lock_vault" phân biệt được ca này.
    const r = closureVerdict({ ...closedObs, holders: [{ address: LOCK, quantity: CAP }, { address: "addr1qxx", quantity: 5n }] }, LOCK);
    expect(r.closed).toBe(false);
    expect(r.reasons.join()).toMatch(/ngoài lock_vault/);
  });

  it("holders thiếu một phần (tổng ở lock_vault < tổng đã đúc) ⇒ chưa đóng", () => {
    const r = closureVerdict({ ...closedObs, holders: [{ address: LOCK, quantity: CAP - 5n }] }, LOCK);
    expect(r.closed).toBe(false);
    expect(r.reasons.join()).toMatch(/tổng đã đúc/);
  });

  it("không có địa chỉ lock_vault ⇒ không kết luận ĐÃ ĐÓNG", () => {
    expect(closureVerdict(closedObs, null).closed).toBe(false);
  });

  it("không có địa chỉ lock_vault ⇒ không kết luận ĐÃ ĐÓNG, kể cả khi cung = 0 làm mọi phép so tổng tự khớp", () => {
    const empty = { distMinted: 0n, reserveMinted: 0n, distCap: 0n, khoLamp: 0n, holders: [] };
    expect(closureVerdict(empty, null).closed).toBe(false);
  });
});
