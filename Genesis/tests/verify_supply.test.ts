// Phần THUẦN của công cụ kiểm cung mainnet (scripts/verify_mainnet_supply.ts).
// Số script đó in ra là số đem CÔNG BỐ, nên phép CHỌN UTxO SupplyState phải fail-closed:
// định danh nằm ở SUPPLY thread NFT (policy + name), không nằm ở địa chỉ và cũng không nằm ở
// "có inline datum". Import file script không bắn koios — main() có guard argv.

import { describe, it, expect } from "vitest";
import { pickSupplyState, parseSupplyDatum, type KoiosUtxo } from "../scripts/verify_mainnet_supply.js";
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
