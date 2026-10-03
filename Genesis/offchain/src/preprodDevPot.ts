// Pot "development" THAY THẾ trên mạng thử — một địa chỉ native script `sig(khoá vận hành)`.
//
// VÌ SAO CÓ: tLAMP rời kho Treasury chỉ qua hai đường, và không đường nào tới được một ví thường
// trong cùng một epoch:
//   • `FundPot` chỉ rót vào địa chỉ Script có datum inline (FP-5a);
//   • `Grant → Redeem` mở tài khoản ở epoch e, rút sớm nhất từ epoch e + 1.
// Pot Development trên Mainnet sẽ là một script có luật riêng (chưa có). Trên mạng thử, pot đó
// được thay bằng địa chỉ native script này: FundPot rót trọn ngân sách pot vào đây, rồi khoá vận
// hành chi ra ví thường cho các đội tích hợp cần tLAMP để kiểm thử ngay.
//
// Đây là script CHI, không phải chính sách ĐÚC. Cổng one-shot của marker (`assertOneShotMarkers`)
// không áp ở đây: không có token nào được đúc bằng script này.
//
// CHẶN Mainnet: một pot do MỘT khoá giữ là trái mô hình committee của Treasury.

import { scriptFromNative, validatorToAddress, validatorToScriptHash } from "@lucid-evolution/lucid";
import type { Network, Script } from "@lucid-evolution/lucid";

/** Datum inline của mọi output pot (FP-5c đòi có datum). `Constr 0 []` — không mang nghĩa gì. */
export const DEV_POT_DATUM_CBOR = "d87980";

export interface DevPot {
  script:     Script;
  scriptHash: string;
  address:    string;
}

export function preprodDevPot(network: Network, operatorPkh: string): DevPot {
  if (network === "Mainnet") {
    throw new Error("DEVPOT-001: pot development thay thế bằng một khoá chỉ dùng trên mạng thử.");
  }
  if (!/^[0-9a-f]{56}$/.test(operatorPkh)) {
    throw new Error(`DEVPOT-002: khoá vận hành '${operatorPkh}' không phải key-hash 28 byte.`);
  }
  const script = scriptFromNative({ type: "sig", keyHash: operatorPkh });
  return {
    script,
    scriptHash: validatorToScriptHash(script),
    address:    validatorToAddress(network, script),
  };
}
