// Cổng soát hình dạng lượt rót pot (`_potShape.ts`) — dùng chung cho `29_fund_script_pot.ts` và
// `30_feeder_accounts.ts` STEP=fundpot. Mỗi cổng có một ca ĐỎ riêng, đầu vào chỉ khác ca xanh ở
// đúng chỗ cổng đó soát — để gỡ cổng nào thì đúng ca của cổng đó đổi màu.
import { describe, it, expect } from "vitest";
import {
  credentialToAddress, keyHashToCredential, scriptHashToCredential,
} from "@lucid-evolution/lucid";

import {
  potTarget, potTargetFromEnv, assertPotOutputs, potOutputFailures, potOutputAssets, positiveBig, hexField, unitAt,
  type OutputShape,
} from "../scripts/_potShape.js";

// Pot Wakeme trên Preprod — cũng chính là bộ tham số của lệnh chạy khô mẫu.
const WAKEME_ADDR = "addr_test1wqqahpte0zlers5caxenwqmjdz3f5u4v4lk87g8peqsplqcu4s7df";
const WAKEME_HASH = "01db857978bf91c298e9b337037268a29a72acafec7f20e1c8201f83";
const DATUM = "4100";
const LAMP_UNIT = "ab".repeat(28) + "744c414d50";
const OTHER_UNIT = "cd".repeat(28) + "58";

const good = { address: WAKEME_ADDR, scriptHash: WAKEME_HASH, datumCbor: DATUM };

describe("potTarget — đích pot: Script, hash khớp, datum bắt buộc", () => {
  it("bộ tham số Wakeme ⇒ qua, hex được thường hoá", () => {
    expect(potTarget({ ...good, scriptHash: "0x" + WAKEME_HASH.toUpperCase() }, 0)).toEqual(good);
  });

  it("đích là ví payment-key (không phải Script) ⇒ POT-FUND-006", () => {
    const vk = credentialToAddress("Preprod", keyHashToCredential(WAKEME_HASH));
    expect(() => potTarget({ ...good, address: vk }, 0)).toThrow(/POT-FUND-006/);
  });

  it("hash khai lệch hash trong địa chỉ ⇒ POT-FUND-007", () => {
    const other = WAKEME_HASH.slice(0, -2) + "84";
    expect(() => potTarget({ ...good, scriptHash: other }, 0)).toThrow(/POT-FUND-007/);
  });

  it("địa chỉ script đúng hash nhưng sai mạng ⇒ POT-FUND-005", () => {
    const mainnet = credentialToAddress("Mainnet", scriptHashToCredential(WAKEME_HASH));
    expect(() => potTarget({ ...good, address: mainnet }, 0)).toThrow(/POT-FUND-005/);
  });

  it("thiếu datum ⇒ POT-FUND-001 (không mặc định)", () => {
    expect(() => potTarget({ ...good, datumCbor: undefined }, 0)).toThrow(/POT-FUND-001.*POT_DATUM_CBOR/);
    expect(() => potTarget({ ...good, datumCbor: "  " }, 0)).toThrow(/POT-FUND-001/);
  });

  it("datum không giải mã được thành Plutus Data ⇒ POT-FUND-008", () => {
    expect(() => potTarget({ ...good, datumCbor: "ff" }, 0)).toThrow(/POT-FUND-008/);
  });

  it("thiếu địa chỉ / hash ⇒ POT-FUND-001; hash sai độ dài ⇒ POT-FUND-003", () => {
    expect(() => potTarget({ ...good, address: "" }, 0)).toThrow(/POT-FUND-001.*POT_ADDRESS/);
    expect(() => potTarget({ ...good, scriptHash: undefined }, 0)).toThrow(/POT-FUND-001.*POT_SCRIPT_HASH/);
    expect(() => potTarget({ ...good, scriptHash: "01db" }, 0)).toThrow(/POT-FUND-003/);
  });

  it("hex lẻ / ký tự lạ ⇒ POT-FUND-002", () => {
    expect(() => hexField("X", "abc")).toThrow(/POT-FUND-002/);
    expect(() => hexField("X", "zz")).toThrow(/POT-FUND-002/);
  });
});

describe("potOutputAssets / positiveBig — value đúng {lovelace, LAMP}", () => {
  it("dựng đúng hai khoá", () => {
    expect(potOutputAssets(2_000_000n, LAMP_UNIT, 5n)).toEqual({ lovelace: 2_000_000n, [LAMP_UNIT]: 5n });
  });
  it("lượng 0 ⇒ POT-FUND-004; đơn vị không phải policy+tên ⇒ POT-FUND-002", () => {
    expect(() => potOutputAssets(2_000_000n, LAMP_UNIT, 0n)).toThrow(/POT-FUND-004/);
    expect(() => potOutputAssets(2_000_000n, "lovelace", 5n)).toThrow(/POT-FUND-002/);
  });
  it("positiveBig: 0 / âm / không số ⇒ POT-FUND-004", () => {
    expect(positiveBig("A", "7")).toBe(7n);
    for (const bad of ["0", "-1", "1e3", "x"]) expect(() => positiveBig("A", bad)).toThrow(/POT-FUND-004/);
  });
});

describe("assertPotOutputs — output ĐÃ DỰNG / ĐÃ LÊN CHUỖI phải đúng hình dạng", () => {
  const expectPot = { lampUnit: LAMP_UNIT, amount: 1_000n, datumCbor: DATUM };
  const potOut: OutputShape = {
    address: WAKEME_ADDR, assets: { lovelace: 2_000_000n, [LAMP_UNIT]: 1_000n }, datum: DATUM,
  };
  const change: OutputShape = { address: "addr_test1_change", assets: { lovelace: 5n, [LAMP_UNIT]: 7n } };

  it("đúng 1 output pot đúng hình dạng ⇒ qua (output khác địa chỉ không tính)", () => {
    expect(() => assertPotOutputs([change, potOut], WAKEME_ADDR, expectPot, "T")).not.toThrow();
    expect(potOutputFailures(potOut, expectPot)).toEqual([]);
  });

  it("asset lạ ⇒ đỏ", () => {
    const bad = { ...potOut, assets: { ...potOut.assets, [OTHER_UNIT]: 1n } };
    expect(() => assertPotOutputs([bad], WAKEME_ADDR, expectPot, "T")).toThrow(/T: .*asset lạ/);
  });

  it("thiếu inline datum ⇒ đỏ; chỉ có datum hash ⇒ đỏ; datum khác ⇒ đỏ", () => {
    expect(() => assertPotOutputs([{ ...potOut, datum: undefined }], WAKEME_ADDR, expectPot, "T"))
      .toThrow(/không có inline datum/);
    expect(() => assertPotOutputs([{ ...potOut, datum: null, datumHash: "aa" }], WAKEME_ADDR, expectPot, "T"))
      .toThrow(/datum là HASH/);
    expect(() => assertPotOutputs([{ ...potOut, datum: "4101" }], WAKEME_ADDR, expectPot, "T"))
      .toThrow(/datum 4101/);
  });

  it("LAMP lệch số ⇒ đỏ; mang script ref ⇒ đỏ", () => {
    const less = { ...potOut, assets: { ...potOut.assets, [LAMP_UNIT]: 999n } };
    expect(() => assertPotOutputs([less], WAKEME_ADDR, expectPot, "T")).toThrow(/LAMP 999/);
    expect(() => assertPotOutputs([{ ...potOut, scriptRef: { type: "PlutusV3", script: "00" } }],
      WAKEME_ADDR, expectPot, "T")).toThrow(/script ref/);
  });

  it("0 hoặc 2 output ở pot ⇒ đỏ", () => {
    expect(() => assertPotOutputs([change], WAKEME_ADDR, expectPot, "T")).toThrow(/có 0 output/);
    expect(() => assertPotOutputs([potOut, potOut], WAKEME_ADDR, expectPot, "T")).toThrow(/có 2 output/);
  });

  it("unitAt cộng đúng một đơn vị ở một địa chỉ", () => {
    expect(unitAt([change, potOut, change], "addr_test1_change", LAMP_UNIT)).toBe(14n);
    expect(unitAt([potOut], "addr_test1_change", LAMP_UNIT)).toBe(0n);
  });
});

describe("potTargetFromEnv — đọc đúng ba tên env", () => {
  it("đọc POT_ADDRESS / POT_SCRIPT_HASH / POT_DATUM_CBOR; thiếu một ⇒ POT-FUND-001", () => {
    const env = { POT_ADDRESS: WAKEME_ADDR, POT_SCRIPT_HASH: WAKEME_HASH, POT_DATUM_CBOR: DATUM };
    expect(potTargetFromEnv(env, 0)).toEqual(good);
    expect(() => potTargetFromEnv({ ...env, POT_DATUM_CBOR: undefined }, 0)).toThrow(/POT-FUND-001/);
  });
});
