// Reserve builder guard — recipientAddress phải là Script-cred khớp recipient_lock.
// Validator recipient_gets_delta CHỈ đếm tLAMP tại Script(recipient_lock) (bỏ qua
// VerificationKey). assertRecipientScriptLock bắt sớm tx chắc-chắn-fail on-chain.
import { describe, it, expect } from "vitest";
import {
  credentialToAddress,
  scriptHashToCredential,
  keyHashToCredential,
} from "@lucid-evolution/lucid";
import { assertRecipientScriptLock } from "../offchain/src/reserveDrawBuilder.js";

const LOCK = "00112233445566778899aabbccddeeff00112233445566778899aabb"; // 28-byte hex
const OTHER = "ffeeddccbbaa00998877665544332211ffeeddccbbaa009988776655";

const scriptAddr = credentialToAddress("Preview", scriptHashToCredential(LOCK));
const wrongScriptAddr = credentialToAddress("Preview", scriptHashToCredential(OTHER));
const keyAddr = credentialToAddress("Preview", keyHashToCredential(LOCK));

describe("assertRecipientScriptLock", () => {
  it("chấp nhận Script-cred khớp recipient_lock", () => {
    expect(() => assertRecipientScriptLock(scriptAddr, LOCK)).not.toThrow();
  });

  it("không phân biệt hoa/thường hex", () => {
    expect(() => assertRecipientScriptLock(scriptAddr, LOCK.toUpperCase())).not.toThrow();
  });

  it("từ chối key-cred (enterprise) dù hash trùng", () => {
    expect(() => assertRecipientScriptLock(keyAddr, LOCK)).toThrow(/RDB-011/);
  });

  it("từ chối Script-cred hash KHÔNG khớp recipient_lock", () => {
    expect(() => assertRecipientScriptLock(wrongScriptAddr, LOCK)).toThrow(/RDB-012/);
  });
});
