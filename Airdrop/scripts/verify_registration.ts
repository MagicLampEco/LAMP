// verify_registration.ts — Operator tool xác minh SPO registration JSON.
//
// Dùng:
//   npx tsx verify_registration.ts --file spo_registration.json
//   npx tsx verify_registration.ts --dir ./registrations/      # xác minh hàng loạt
//
// Quy trình xác minh:
//   1. Verify Ed25519 signature (message_hex, signature, signing_pubkey)
//   2. Verify signing_pubkey → stake addr == pool's reward_account (Blockfrost)
//   3. Verify pool tồn tại và active trong các epoch đã khai báo
//   4. Output: VALID / INVALID + lý do chi tiết

import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { verify as edVerify, createPublicKey } from "node:crypto";
import { blake2b } from "@noble/hashes/blake2b";
import { bech32 } from "@scure/base";
import { bf, bfAll, BLOCKFROST_KEY, NETWORK } from "./config.js";
import type { SpoRegistration } from "./spo_register.js";

// ── Crypto ──────────────────────────────────────────────────────────────────

const DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function verifyEd25519(messageHex: string, sigHex: string, pubkeyHex: string): boolean {
  try {
    const pubkeyBytes = Buffer.from(pubkeyHex, "hex");
    if (pubkeyBytes.length !== 32) return false;
    const derKey = Buffer.concat([DER_PREFIX, pubkeyBytes]);
    const pk = createPublicKey({ key: derKey, format: "der", type: "spki" });
    // Ed25519 KHÔNG dùng createVerify (streaming digest) — ném "Invalid digest".
    // Phải dùng one-shot crypto.verify(null, ...). Bug cũ luôn trả false → chặn đăng ký.
    return edVerify(null, Buffer.from(messageHex, "hex"), pk, Buffer.from(sigHex, "hex"));
  } catch {
    return false;
  }
}

function pubkeyToStakeAddr(pubkeyHex: string, network: string): string {
  const pubkeyBytes = Buffer.from(pubkeyHex, "hex");
  const keyHash = Buffer.from(blake2b(new Uint8Array(pubkeyBytes), { dkLen: 28 }));
  const networkByte = network === "Mainnet" ? 0xe1 : 0xe0;
  const addrBytes = new Uint8Array(29);
  addrBytes[0] = networkByte;
  addrBytes.set(keyHash, 1);
  const prefix = network === "Mainnet" ? "stake" : "stake_test";
  return bech32.encode(prefix, bech32.toWords(addrBytes), 1000);
}

// ── Blockfrost ──────────────────────────────────────────────────────────────

interface PoolInfo {
  pool_id: string;
  reward_account: string;
  active_epoch: number;
}

interface PoolHistory {
  epoch: number;
  active_stake: string;
  delegators_count: number;
}

// ── Verify logic ─────────────────────────────────────────────────────────────

interface VerifyResult {
  file: string;
  pool_id: string;
  payment_address: string;
  status: "VALID" | "INVALID" | "WARN";
  checks: { name: string; pass: boolean; detail: string }[];
  summary: string;
}

async function verifyOne(filePath: string): Promise<VerifyResult> {
  const checks: VerifyResult["checks"] = [];
  let pool_id = "unknown";
  let payment_address = "unknown";

  const raw = await readFile(filePath, "utf8");
  let reg: SpoRegistration;
  try {
    reg = JSON.parse(raw) as SpoRegistration;
    pool_id = reg.pool_id ?? "unknown";
    payment_address = reg.payment_address ?? "unknown";
  } catch (e) {
    return {
      file: filePath,
      pool_id,
      payment_address,
      status: "INVALID",
      checks: [{ name: "JSON parse", pass: false, detail: String(e) }],
      summary: "File không phải JSON hợp lệ",
    };
  }

  // CHECK 1: Version + required fields
  const requiredFields = [
    "version", "pool_id", "reward_stake_address", "payment_address",
    "message", "message_hex", "signature", "signing_pubkey",
    "signed_at", "nonce", "epochs_active", "network",
  ];
  const missingFields = requiredFields.filter((f) => !(f in reg));
  checks.push({
    name: "Trường bắt buộc",
    pass: missingFields.length === 0,
    detail: missingFields.length === 0
      ? "Đủ tất cả trường"
      : `Thiếu: ${missingFields.join(", ")}`,
  });
  if (missingFields.length > 0) {
    return { file: filePath, pool_id, payment_address, status: "INVALID", checks, summary: "Thiếu trường bắt buộc" };
  }

  // CHECK 2: Network khớp
  const networkMatch = reg.network === NETWORK;
  checks.push({
    name: "Network khớp",
    pass: networkMatch,
    detail: networkMatch
      ? `Cả hai là ${NETWORK}`
      : `Registration: ${reg.network}, Operator: ${NETWORK}`,
  });

  // CHECK 3: Message hex khớp message text
  const recomputedHex = Buffer.from(reg.message, "utf8").toString("hex");
  const msgMatch = recomputedHex === reg.message_hex;
  checks.push({
    name: "message_hex khớp message",
    pass: msgMatch,
    detail: msgMatch
      ? "hex(message) == message_hex"
      : `Expected: ${recomputedHex.slice(0, 20)}..., Got: ${reg.message_hex.slice(0, 20)}...`,
  });

  // CHECK 4: Signature format
  const sigFmt = /^[0-9a-f]{128}$/.test(reg.signature);
  const pkFmt = /^[0-9a-f]{64}$/.test(reg.signing_pubkey);
  checks.push({
    name: "Signature format",
    pass: sigFmt && pkFmt,
    detail: !sigFmt
      ? `signature không hợp lệ (${reg.signature.length} ký tự, cần 128)`
      : !pkFmt
      ? `signing_pubkey không hợp lệ (${reg.signing_pubkey.length} ký tự, cần 64)`
      : "OK (128-hex sig, 64-hex pubkey)",
  });

  // CHECK 5: Ed25519 signature verify
  const sigValid = msgMatch && sigFmt && pkFmt
    ? verifyEd25519(reg.message_hex, reg.signature, reg.signing_pubkey)
    : false;
  checks.push({
    name: "Ed25519 signature",
    pass: sigValid,
    detail: sigValid
      ? "Chữ ký hợp lệ"
      : !msgMatch || !sigFmt || !pkFmt
      ? "Bỏ qua (check trước fail)"
      : "Chữ ký không hợp lệ — message/sig/pubkey không khớp",
  });

  // CHECK 6: Pubkey → stake addr == reward_stake_address (khai báo)
  let derivedAddr = "";
  let addrSelfMatch = false;
  if (pkFmt) {
    derivedAddr = pubkeyToStakeAddr(reg.signing_pubkey, reg.network);
    addrSelfMatch = derivedAddr === reg.reward_stake_address;
  }
  checks.push({
    name: "Pubkey → stake addr khớp reward_stake_address khai báo",
    pass: addrSelfMatch,
    detail: addrSelfMatch
      ? derivedAddr
      : `Derived: ${derivedAddr || "n/a"}, Khai báo: ${reg.reward_stake_address}`,
  });

  // CHECK 7: Pool tồn tại trên Blockfrost
  let poolInfo: PoolInfo | null = null;
  let poolFetchOk = false;
  try {
    poolInfo = await bf<PoolInfo>(`/pools/${reg.pool_id}`);
    poolFetchOk = !!(poolInfo && typeof poolInfo === "object" && "pool_id" in poolInfo);
  } catch { /* handled below */ }
  checks.push({
    name: "Pool tồn tại (Blockfrost)",
    pass: poolFetchOk,
    detail: poolFetchOk
      ? `Epoch đăng ký: ${poolInfo!.active_epoch}`
      : `Pool ${reg.pool_id} không tìm thấy trên ${NETWORK}`,
  });

  // CHECK 8: Pubkey → stake addr == pool's reward_account on-chain
  let chainAddrMatch = false;
  if (poolFetchOk && addrSelfMatch) {
    chainAddrMatch = derivedAddr === poolInfo!.reward_account;
  }
  checks.push({
    name: "Pubkey → stake addr khớp reward_account on-chain",
    pass: chainAddrMatch,
    detail: poolFetchOk
      ? chainAddrMatch
        ? `${poolInfo!.reward_account}`
        : `On-chain: ${poolInfo!.reward_account}, Derived: ${derivedAddr}`
      : "Bỏ qua (pool không fetch được)",
  });

  // CHECK 9: Epochs khai báo có trong lịch sử pool
  let epochsOk = false;
  let epochDetail = "";
  if (poolFetchOk && reg.epochs_active?.length > 0) {
    const history = await bfAll<PoolHistory>(`/pools/${reg.pool_id}/history`);
    const histEpochs = new Set(history.map((h) => h.epoch));
    const claimedEpochs: number[] = reg.epochs_active;
    const missing = claimedEpochs.filter((e) => !histEpochs.has(e));
    epochsOk = missing.length === 0;
    epochDetail = epochsOk
      ? `${claimedEpochs.length} epoch đã xác minh: [${claimedEpochs.join(", ")}]`
      : `Epoch không tìm thấy trong lịch sử pool: [${missing.join(", ")}]`;
  }
  checks.push({
    name: "Epochs khai báo có trong lịch sử pool",
    pass: epochsOk,
    detail: epochDetail || "Bỏ qua (pool không fetch hoặc epochs_active rỗng)",
  });

  // CHECK 10: Payment address format cơ bản
  const payAddrOk = /^addr1[0-9a-z]+$/.test(reg.payment_address) ||
                    /^addr_test1[0-9a-z]+$/.test(reg.payment_address);
  checks.push({
    name: "Payment address format",
    pass: payAddrOk,
    detail: payAddrOk
      ? reg.payment_address
      : `Không phải bech32 addr: ${reg.payment_address.slice(0, 30)}...`,
  });

  // Tổng kết
  const critical = [
    "Trường bắt buộc",
    "Ed25519 signature",
    "Pubkey → stake addr khớp reward_account on-chain",
    "Epochs khai báo có trong lịch sử pool",
  ];
  const critFailed = checks.filter((c) => critical.includes(c.name) && !c.pass);
  const warns = checks.filter((c) => !critical.includes(c.name) && !c.pass);

  let status: "VALID" | "INVALID" | "WARN";
  let summary: string;
  if (critFailed.length > 0) {
    status = "INVALID";
    summary = `Lỗi: ${critFailed.map((c) => c.name).join(", ")}`;
  } else if (warns.length > 0) {
    status = "WARN";
    summary = `Cảnh báo: ${warns.map((c) => c.name).join(", ")}`;
  } else {
    status = "VALID";
    summary = "Tất cả kiểm tra đều qua";
  }

  return { file: filePath, pool_id: reg.pool_id, payment_address: reg.payment_address, status, checks, summary };
}

function printResult(r: VerifyResult): void {
  const icon = r.status === "VALID" ? "✓" : r.status === "WARN" ? "⚠" : "✗";
  const line = "─".repeat(70);

  console.log(line);
  console.log(`${icon} [${r.status}] ${r.file}`);
  console.log(`  Pool:    ${r.pool_id}`);
  console.log(`  Payment: ${r.payment_address}`);
  console.log();

  for (const c of r.checks) {
    const mark = c.pass ? "  ✓" : "  ✗";
    console.log(`${mark}  ${c.name}`);
    if (!c.pass || process.argv.includes("--verbose")) {
      console.log(`       ${c.detail}`);
    }
  }

  console.log();
  console.log(`  Kết quả: ${r.summary}`);
  console.log();
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileArg = args.find((_, i) => args[i - 1] === "--file");
  const dirArg = args.find((_, i) => args[i - 1] === "--dir");

  if (!BLOCKFROST_KEY) throw new Error("thiếu BLOCKFROST_KEY — cấu hình .env");

  if (!fileArg && !dirArg) {
    console.error(`Dùng:
  npx tsx verify_registration.ts --file spo_registration.json
  npx tsx verify_registration.ts --dir ./registrations/
  npx tsx verify_registration.ts --file <f> --verbose   # in chi tiết tất cả check`);
    process.exit(1);
  }

  const files: string[] = [];
  if (fileArg) {
    files.push(resolve(process.cwd(), fileArg));
  } else if (dirArg) {
    const entries = await readdir(resolve(process.cwd(), dirArg));
    for (const e of entries) {
      if (e.endsWith(".json")) files.push(join(resolve(process.cwd(), dirArg), e));
    }
    if (files.length === 0) throw new Error(`Không có file .json trong ${dirArg}`);
  }

  console.log(`\nNetwork: ${NETWORK}`);
  console.log(`Xác minh ${files.length} file registration...\n`);

  const results: VerifyResult[] = [];
  for (const f of files) {
    const r = await verifyOne(f);
    printResult(r);
    results.push(r);
  }

  // Tổng kết
  const valid = results.filter((r) => r.status === "VALID").length;
  const warns = results.filter((r) => r.status === "WARN").length;
  const invalid = results.filter((r) => r.status === "INVALID").length;

  console.log("═".repeat(70));
  console.log(`TỔNG KẾT: ${valid} VALID  ${warns} WARN  ${invalid} INVALID / ${results.length} tổng`);
  if (invalid > 0) {
    console.log(`\n[ACTION] ${invalid} registration INVALID — KHÔNG đưa vào snapshot SPO.`);
  }
  if (valid > 0) {
    console.log(`\n[ACTION] ${valid} registration VALID → sao chép payment_address vào spo_snapshot.json.`);
  }
  console.log();

  process.exit(invalid > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("LỖI:", e instanceof Error ? e.message : e);
  process.exit(1);
});
