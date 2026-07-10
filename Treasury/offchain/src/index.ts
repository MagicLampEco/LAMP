// @magiclamp/treasury-sdk — Treasury off-chain SDK
// Custody collect (LAMP Treasury v1). Value bảo toàn TUYỆT ĐỐI per-asset (KHÔNG burn).

export * from "./types.js";
export * from "./datum.js";
export * from "./collect.js";
export * from "./collectBuilder.js";
export * from "./releaseBuilder.js";
export * from "./seedBuilder.js";

// Cầu Reserve↔Treasury (Treasury-pull): mint auth one-shot + spend gate ép sàn.
export * from "./reserveAuthBuilder.js";
export * from "./reserveGateBuilder.js";

// release.js: 5 hàm (ledgerOk/valueOk/planLedgerOut/eachOutLineOk/eachInLinePresent)
// trùng tên với collect.js (mỗi nhánh có bản riêng). Re-export có alias `release*`
// để barrel sạch — gọi bản nhánh Release qua `releaseLedgerOk`, v.v. Các hàm KHÔNG
// trùng (spendSpecHash, drawsCbor, applyDraws, planRecipientOutputs…) export thẳng.
export {
  SPEND_SPEC_PREFIX, type RecipientOutput,
  hexToBytes, bytesToHex, drawsCbor, spendSpecHash,
  drawnOfAsset, drawnOfLine, drawnValue, applyDraws,
  allDrawsNonneg, drawsWithinBalance,
  addressKey, toIsCustody, drawnTo, outputSumTo, recipientsOk, planRecipientOutputs,
  ledgerOk as releaseLedgerOk,
  valueOk as releaseValueOk,
  planLedgerOut as releasePlanLedgerOut,
  eachOutLineOk as releaseEachOutLineOk,
  eachInLinePresent as releaseEachInLinePresent,
} from "./release.js";
