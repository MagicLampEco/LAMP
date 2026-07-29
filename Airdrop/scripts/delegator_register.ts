// delegator_register.ts — đăng ký delegator cho pot Delegator (100M LAMP).
//
// Giống spo_register.ts nhưng ĐƠN GIẢN hơn: đối tượng là delegator thường (không phải
// operator). Ký bằng REWARD/STAKE key (key điều khiển ủy thác) — KHÔNG cần cold/KES/VRF.
//
// Dùng:
//   npx tsx delegator_register.ts --stake stake1...   --payment addr1...
//   npx tsx delegator_register.ts --payment addr1...   (tự resolve stake từ payment)
//
// 3 bước:
//   1. Hiển thị lịch sử stake MỌI POOL của delegator + tổng accStake (lovelace·epoch).
//      Chưa stake → in hướng dẫn delegate rồi đăng ký lại.
//   2. Tạo message + ký với reward/stake key (cardano-signer hoặc Eternl/Vespr).
//   3. Xuất delegator_registration.json.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { verify as edVerify, createPublicKey, randomBytes } from "node:crypto";
import { blake2b } from "@noble/hashes/blake2b";
import { bech32 } from "@scure/base";
import { getAddressDetails } from "@lucid-evolution/lucid";
import { bf, bfAll, BLOCKFROST_KEY, NETWORK } from "./config.js";

// Pool TIGER gợi ý (mọi pool đều hợp lệ để đủ điều kiện pot Delegator).
const TIGER_POOL_ID = "pool1q9kwa675j2z53jecrs6pn3fqsc9ypxrsypu5dgu6hammqkagy22";

// ── Types ────────────────────────────────────────────────────────────────

interface AccountInfo {
  stake_address: string;
  active: boolean;
  controlled_amount: string;
  pool_id: string | null;
}

interface HistoryRow {
  active_epoch: number;
  amount: string; // active stake (lovelace)
  pool_id: string | null;
}

export interface DelegatorRegistration {
  version: "1.0";
  stake_address: string;
  payment_address: string;
  epochs_active: number[];
  acc_stake_lovelace: string;
  current_pool_id: string | null;
  message: string;
  message_hex: string;
  signature: string;
  signing_pubkey: string;
  signed_at: string;
  nonce: string;
  network: string;
  signing_method: "cardano-signer-ed25519";
}

// ── Crypto helpers (đồng bộ spo_register.ts) ───────────────────────────────

const DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Verify Ed25519 với raw pubkey (32 byte hex). */
function verifyEd25519(messageHex: string, signatureHex: string, pubkeyHex: string): boolean {
  try {
    const pubkeyBytes = Buffer.from(pubkeyHex, "hex");
    if (pubkeyBytes.length !== 32) return false;
    const derKey = Buffer.concat([DER_PREFIX, pubkeyBytes]);
    const publicKey = createPublicKey({ key: derKey, format: "der", type: "spki" });
    // Ed25519 là thuật toán one-shot: PHẢI dùng crypto.verify(null, ...) —
    // createVerify("Ed25519") ném "Invalid digest" (Node ≥ 20), luôn rơi vào catch.
    return edVerify(null, Buffer.from(messageHex, "hex"), publicKey, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/** Raw Ed25519 pubkey (32 byte hex) → stake address (reward addr, key credential). */
function pubkeyToStakeAddr(pubkeyHex: string, network: string): string {
  const keyHash = Buffer.from(blake2b(Buffer.from(pubkeyHex, "hex"), { dkLen: 28 }));
  return stakeAddrFromCred(keyHash.toString("hex"), false, network);
}

/** stake credential hash (28 byte hex) → reward (stake) address bech32. */
function stakeAddrFromCred(hashHex: string, isScript: boolean, network: string): string {
  const keyHash = Buffer.from(hashHex, "hex");
  const isMainnet = network === "Mainnet";
  // header: reward addr = 0b1110 (key) / 0b1111 (script) ++ network id.
  const typeNibble = isScript ? 0xf0 : 0xe0;
  const header = typeNibble | (isMainnet ? 0x01 : 0x00);
  const addrBytes = new Uint8Array(29);
  addrBytes[0] = header;
  addrBytes.set(keyHash, 1);
  const prefix = isMainnet ? "stake" : "stake_test";
  return bech32.encode(prefix, bech32.toWords(addrBytes), 1000);
}

function genNonce(): string {
  return randomBytes(8).toString("hex");
}

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(): {
  stakeAddr: string | null;
  paymentAddr: string;
  outFile: string;
  noInteract: boolean;
  sig: string | null;
  pubkey: string | null;
} {
  const args = process.argv.slice(2);
  let stakeAddr: string | null = null;
  let paymentAddr = "";
  let outFile = resolve(process.cwd(), "delegator_registration.json");
  let noInteract = false;
  let sig: string | null = null;
  let pubkey: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--stake" && args[i + 1]) stakeAddr = args[++i]!;
    else if ((a === "--payment" || a === "--addr") && args[i + 1]) paymentAddr = args[++i]!;
    else if ((a === "--out" || a === "-o") && args[i + 1]) outFile = resolve(process.cwd(), args[++i]!);
    else if (a === "--no-interact") noInteract = true;
    else if (a === "--sig" && args[i + 1]) sig = args[++i]!;
    else if (a === "--pubkey" && args[i + 1]) pubkey = args[++i]!;
    else if (a === "--help" || a === "-h") {
      console.log(`
Dùng: npx tsx delegator_register.ts --payment <addr> [--stake <stake_addr>]

Options:
  --payment <addr>     Địa chỉ nhận LAMP (payment addr)  [bắt buộc]
  --stake <stake_addr> Stake/reward address (mặc định: resolve từ --payment)
  --out, -o <file>     File output (mặc định: delegator_registration.json)
  --sig <hex>          Signature đã ký (bỏ qua bước ký interactive)
  --pubkey <hex>       Public key tương ứng với --sig
  --no-interact        Không hỏi confirmation (dùng trong script)
`);
      process.exit(0);
    }
  }

  if (!paymentAddr) {
    console.error("Bắt buộc: --payment <addr>. Chạy --help.");
    process.exit(1);
  }
  return { stakeAddr, paymentAddr, outFile, noInteract, sig, pubkey };
}

// ── Resolve stake address từ payment address ──────────────────────────────

function resolveStakeAddr(paymentAddr: string): string {
  const det = getAddressDetails(paymentAddr);
  if (!det.stakeCredential) {
    throw new Error(
      `Địa chỉ payment không có stake credential (enterprise addr): ${paymentAddr}. ` +
      `Cung cấp --stake <stake_addr> tường minh.`,
    );
  }
  return stakeAddrFromCred(
    det.stakeCredential.hash,
    det.stakeCredential.type === "Script",
    NETWORK,
  );
}

// ── Fetch stake history (mọi pool) ─────────────────────────────────────────

async function fetchStakeData(stakeAddr: string): Promise<{
  info: AccountInfo | null;
  history: HistoryRow[];
  epochs: number[];
  accStake: bigint;
  currentPool: string | null;
}> {
  const info = await bf<AccountInfo>(`/accounts/${stakeAddr}`).catch(() => null);
  const history = await bfAll<HistoryRow>(`/accounts/${stakeAddr}/history`);
  history.sort((a, b) => a.active_epoch - b.active_epoch);

  const active = history.filter((h) => BigInt(h.amount) > 0n);
  const epochs = active.map((h) => h.active_epoch);
  const accStake = active.reduce((s, h) => s + BigInt(h.amount), 0n);
  const currentPool =
    info && "pool_id" in info ? (info as AccountInfo).pool_id : null;

  return { info: info as AccountInfo | null, history, epochs, accStake, currentPool };
}

// ── Interactive prompt ─────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (ans) => { rl.close(); res(ans.trim()); }));
}

function fmtAda(lovelace: string | bigint): string {
  return `${(BigInt(lovelace) / 1_000_000n).toLocaleString("en")} ADA`;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { stakeAddr: stakeArg, paymentAddr, outFile, noInteract, sig: providedSig, pubkey: providedPubkey } = parseArgs();
  if (!BLOCKFROST_KEY) throw new Error("thiếu BLOCKFROST_KEY — cấu hình .env");

  const stakeAddr = stakeArg ?? resolveStakeAddr(paymentAddr);
  const line = "═".repeat(70);

  console.log(`\nĐang tải lịch sử stake...\n`);
  const { history, epochs, accStake, currentPool } = await fetchStakeData(stakeAddr);

  console.log(line);
  console.log(`MAGICLAMP AIRDROP — Delegator Registration`);
  console.log(line);
  console.log(`Stake addr:  ${stakeAddr}`);
  console.log(`Payment:     ${paymentAddr}`);
  console.log(`Pool hiện tại: ${currentPool ?? "(chưa ủy thác)"}`);
  console.log();

  // Chưa từng stake → hướng dẫn delegate rồi quay lại.
  if (history.length === 0 || accStake === 0n) {
    console.log("Ví CHƯA có lịch sử ủy thác (stake) nào.");
    console.log();
    console.log("Hãy delegate stake của anh vào MỘT pool bất kỳ (khuyến nghị pool TIGER):");
    console.log(`  Pool TIGER: ${TIGER_POOL_ID}`);
    console.log("  (mọi pool đều đủ điều kiện — pot Delegator chia ∝ stake mọi pool)");
    console.log();
    console.log("Sau khi delegation kích hoạt (thường 1 epoch), chạy lại lệnh này để đăng ký.");
    process.exit(0);
  }

  console.log(`Epoch  ${"Active Stake".padEnd(20)} Pool`);
  console.log("─".repeat(60));
  for (const h of history) {
    if (BigInt(h.amount) <= 0n) continue;
    const isTiger = h.pool_id === TIGER_POOL_ID ? " ★TIGER" : "";
    console.log(
      `${String(h.active_epoch).padStart(5)}  ${fmtAda(h.amount).padEnd(20)} ` +
      `${(h.pool_id ?? "-").slice(0, 20)}${isTiger}`,
    );
  }
  console.log("─".repeat(60));
  console.log(`Tổng accStake (${epochs.length} epoch): ${fmtAda(accStake)} × epoch`);
  console.log(`  = ${accStake.toString()} lovelace·epoch`);
  console.log();

  console.log("LUẬT CHƠI DELEGATOR REGISTRATION:");
  console.log("  1. Pot Delegator (100.000.000 LAMP) chia ∝ accStake (mọi pool, mọi epoch).");
  console.log("  2. Ký xác nhận bằng reward/stake key (KHÔNG cần cold/KES/VRF key).");
  console.log("  3. Payment address đăng ký sẽ KHÔNG đổi sau khi nộp.");
  console.log("  4. Phần không đăng ký đúng hạn → chuyển về Treasury.");
  console.log();

  if (!noInteract) {
    const agree = await prompt("Anh đồng ý tham gia với luật chơi trên? (y/N): ");
    if (agree.toLowerCase() !== "y" && agree.toLowerCase() !== "yes") {
      console.log("Đã hủy.");
      process.exit(0);
    }
  }

  const nonce = genNonce();
  const timestamp = new Date().toISOString();
  const message = [
    "MAGICLAMP AIRDROP DELEGATOR REGISTRATION v1.0",
    "",
    `Stake Address:   ${stakeAddr}`,
    `Payment Address: ${paymentAddr}`,
    `Network:         ${NETWORK}`,
    `Timestamp:       ${timestamp}`,
    `Nonce:           ${nonce}`,
    `Epochs:          [${epochs.join(", ")}]`,
    `Acc Stake:       ${accStake.toString()} lovelace·epoch`,
    "",
    "Tôi là chủ sở hữu stake key trên xác nhận:",
    "1. Tôi ủy thác stake trong các epoch được liệt kê",
    "2. Tôi đồng ý với quy tắc MagicLamp Airdrop Delegator Registration",
    "3. Payment address trên sẽ nhận phần LAMP delegator",
  ].join("\n");
  const messageHex = Buffer.from(message, "utf8").toString("hex");

  console.log();
  console.log(line);
  console.log("BƯỚC KÝ XÁC NHẬN (dùng reward/stake key):");
  console.log(line);
  console.log("Message cần ký (hex):");
  console.log(messageHex);
  console.log();
  console.log("─── cardano-signer ───────────────────────────────────────────────");
  console.log(`  cardano-signer sign --data-hex "${messageHex}" \\`);
  console.log(`    --signing-key /path/to/stake.skey --out-file sig.json`);
  console.log();
  console.log("─── Eternl/Vespr (Sign Data, address = stake address ở trên) ─────");
  console.log("  Trả về CIP-0030 (COSESign1). Trích raw signature (64B) + pubkey (32B).");
  console.log();

  let finalSig: string;
  let finalPubkey: string;
  if (providedSig && providedPubkey) {
    finalSig = providedSig.trim().toLowerCase();
    finalPubkey = providedPubkey.trim().toLowerCase();
  } else {
    finalSig = (await prompt("Signature (hex, 128 ký tự): ")).trim().toLowerCase();
    finalPubkey = (await prompt("Public key (hex, 64 ký tự): ")).trim().toLowerCase();
  }

  if (!/^[0-9a-f]{128}$/.test(finalSig)) {
    console.error(`LỖI: Signature không hợp lệ (cần 128 hex, nhận ${finalSig.length}).`);
    process.exit(1);
  }
  if (!/^[0-9a-f]{64}$/.test(finalPubkey)) {
    console.error(`LỖI: Public key không hợp lệ (cần 64 hex, nhận ${finalPubkey.length}).`);
    process.exit(1);
  }

  if (!verifyEd25519(messageHex, finalSig, finalPubkey)) {
    console.error("LỖI: Chữ ký không hợp lệ — message/signature/pubkey không khớp.");
    process.exit(1);
  }
  console.log("  Chữ ký hợp lệ.");

  const derived = pubkeyToStakeAddr(finalPubkey, NETWORK);
  if (derived !== stakeAddr) {
    // FAIL-CLOSED (chống mạo danh): chữ ký hợp-lệ nhưng do KEY KHÁC tạo → kẻ tấn công
    // có thể khai stake_address (accStake cao) của nạn nhân + payment của mình.
    // Từ chối ở MỌI chế độ (kể cả --no-interact). KHÔNG có verifier phía delegator để chặn sau.
    console.error("  LỖI: pubkey KHÔNG khớp stake address đăng ký — TỪ CHỐI.");
    console.error(`  Stake khai báo: ${stakeAddr}`);
    console.error(`  Suy từ pubkey:  ${derived}`);
    console.error("  Chữ ký phải do CHÍNH key của stake address này tạo.");
    console.error("  (Stake dạng script/multisig chưa hỗ trợ luồng ký này — liên hệ Foundation.)");
    process.exit(1);
  }
  console.log("  Pubkey khớp stake address.");

  const reg: DelegatorRegistration = {
    version: "1.0",
    stake_address: stakeAddr,
    payment_address: paymentAddr,
    epochs_active: epochs,
    acc_stake_lovelace: accStake.toString(),
    current_pool_id: currentPool,
    message,
    message_hex: messageHex,
    signature: finalSig,
    signing_pubkey: finalPubkey,
    signed_at: timestamp,
    nonce,
    network: NETWORK,
    signing_method: "cardano-signer-ed25519",
  };

  await writeFile(outFile, JSON.stringify(reg, null, 2) + "\n", "utf8");
  console.log();
  console.log(line);
  console.log(`Đã ghi: ${outFile}`);
  console.log("Nộp file qua Discord #delegator-registration hoặc email airdrop@magiclamp.network");
  console.log(line);
}

main().catch((e) => {
  console.error("LỖI:", e instanceof Error ? e.message : e);
  process.exit(1);
});
