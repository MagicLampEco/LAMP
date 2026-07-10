// spo_register.ts — Interactive SPO registration cho TIGER Airdrop.
//
// Dùng reward stake key (KHÔNG cần cold key / KES / VRF / AirGap).
// Key dùng: stake.skey (reward address key) — cùng key SPO dùng để rút thưởng.
//
// Dùng:
//   npx tsx spo_register.ts --pool pool1... --payment addr1...
//
// 3 bước:
//   1. Hiển thị thống kê pool 6 epoch snapshot + luật chơi → SPO xác nhận
//   2. Tạo message + hướng dẫn ký với reward stake key (cardano-signer hoặc Node.js)
//   3. Xuất spo_registration.json (nộp cho MagicLamp Foundation)
//
// TẠI SAO AN TOÀN:
//   Pool cold key → AirGap (đăng ký/thoát pool). KHÔNG dùng ở đây.
//   KES key → Server nóng (block signing). KHÔNG dùng ở đây.
//   VRF key → Server nóng (leader schedule). KHÔNG dùng ở đây.
//   Reward stake key → SPO dùng mỗi epoch để rút thưởng.
//     Đây là key chứng minh quyền sở hữu pool (reward_account công khai trên chain).
//     Hỗ trợ Ledger/Trezor qua Eternl wallet.

import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verify as edVerify, createPublicKey, randomBytes } from "node:crypto";
import { blake2b } from "@noble/hashes/blake2b";
import { bech32 } from "@scure/base";
import { bf, bfAll, BLOCKFROST_KEY, BLOCKFROST_URL, NETWORK } from "./config.js";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Types ───────────────────────────────────────────────────────────────────

interface PoolInfo {
  pool_id: string;
  reward_account: string;
  active_epoch: number;
}

interface PoolHistory {
  epoch: number;
  blocks: number;
  active_stake: string;
  delegators_count: number;
}

interface PoolMetadata {
  name?: string;
  ticker?: string;
}

export interface SpoRegistration {
  version: "1.0";
  pool_id: string;
  pool_name: string;
  reward_stake_address: string;
  payment_address: string;
  epochs_active: number[];
  total_stake_lovelace: string;
  message: string;
  message_hex: string;
  signature: string;
  signing_pubkey: string;
  signed_at: string;
  nonce: string;
  network: string;
  signing_method: "cardano-signer-ed25519" | "node-ed25519";
}

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(): {
  pool: string;
  paymentAddr: string;
  epochCount: number;
  explicitEpochs: number[] | null;
  outFile: string;
  noInteract: boolean;
  sig: string | null;
  pubkey: string | null;
} {
  const args = process.argv.slice(2);
  let pool = "";
  let paymentAddr = "";
  let epochCount = 6;
  let explicitEpochs: number[] | null = null;
  let outFile = resolve(process.cwd(), "spo_registration.json");
  let noInteract = false;
  let sig: string | null = null;
  let pubkey: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if ((a === "--pool" || a === "-p") && args[i + 1]) pool = args[++i]!;
    else if ((a === "--payment" || a === "--addr") && args[i + 1]) paymentAddr = args[++i]!;
    else if (a === "--count" && args[i + 1]) epochCount = parseInt(args[++i]!, 10);
    else if (a === "--epochs" && args[i + 1]) explicitEpochs = args[++i]!.split(",").map(Number);
    else if ((a === "--out" || a === "-o") && args[i + 1]) outFile = resolve(process.cwd(), args[++i]!);
    else if (a === "--no-interact") noInteract = true;
    else if (a === "--sig" && args[i + 1]) sig = args[++i]!;
    else if (a === "--pubkey" && args[i + 1]) pubkey = args[++i]!;
    else if (a === "--help" || a === "-h") {
      console.log(`
Dùng: npx tsx spo_register.ts --pool <pool_id> --payment <addr>

Options:
  --pool, -p <pool_id>    Pool ID (bech32, pool1...)  [bắt buộc]
  --payment <addr>        Địa chỉ nhận LAMP (payment addr, không phải stake)  [bắt buộc]
  --epochs <e1,e2,...>    Danh sách epoch snapshot cụ thể
  --count <n>             Số epoch gần nhất (mặc định: 6)
  --out, -o <file>        File output (mặc định: spo_registration.json)
  --sig <hex>             Signature đã ký (bỏ qua bước ký interactive)
  --pubkey <hex>          Public key tương ứng với --sig
  --no-interact           Không hỏi confirmation (dùng trong script)
  --help, -h              Hiển thị trợ giúp

Ví dụ:
  npx tsx spo_register.ts \\
    --pool pool1xs2yx... \\
    --payment addr1qx... \\
    --epochs 580,581,582
`);
      process.exit(0);
    }
  }

  if (!pool) {
    console.error("Bắt buộc: --pool <pool_id>. Chạy --help.");
    process.exit(1);
  }
  if (!paymentAddr) {
    console.error("Bắt buộc: --payment <addr>. Chạy --help.");
    process.exit(1);
  }

  return { pool, paymentAddr, epochCount, explicitEpochs, outFile, noInteract, sig, pubkey };
}

// ── Crypto helpers ──────────────────────────────────────────────────────────

const DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Verify Ed25519 signature với raw pubkey (32 bytes hex). */
function verifyEd25519(messageHex: string, signatureHex: string, pubkeyHex: string): boolean {
  try {
    const pubkeyBytes = Buffer.from(pubkeyHex, "hex");
    if (pubkeyBytes.length !== 32) return false;
    const derKey = Buffer.concat([DER_PREFIX, pubkeyBytes]);
    const publicKey = createPublicKey({ key: derKey, format: "der", type: "spki" });
    // Ed25519 KHÔNG dùng createVerify (streaming digest) — ném "Invalid digest".
    // Phải dùng one-shot crypto.verify(null, ...). Bug cũ luôn trả false → chặn đăng ký SPO.
    return edVerify(null, Buffer.from(messageHex, "hex"), publicKey, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/** Derive stake address từ raw Ed25519 pubkey (32 bytes hex). */
function pubkeyToStakeAddr(pubkeyHex: string, network: string): string {
  const pubkeyBytes = Buffer.from(pubkeyHex, "hex");
  const keyHash = Buffer.from(blake2b(new Uint8Array(pubkeyBytes), { dkLen: 28 }));
  // Cardano stake addr: [network_byte(1)] + [key_hash(28)]
  // network byte: 0xE1 = mainnet, 0xE0 = testnet (Preview/Preprod)
  const networkByte = network === "Mainnet" ? 0xe1 : 0xe0;
  const addrBytes = new Uint8Array(29);
  addrBytes[0] = networkByte;
  addrBytes.set(keyHash, 1);
  const prefix = network === "Mainnet" ? "stake" : "stake_test";
  return bech32.encode(prefix, bech32.toWords(addrBytes), 1000);
}

/** Tạo nonce ngẫu nhiên (8 bytes hex). */
function genNonce(): string {
  return randomBytes(8).toString("hex");
}

// ── Pool data ───────────────────────────────────────────────────────────────

async function fetchPoolData(pool: string, epochCount: number, explicitEpochs: number[] | null): Promise<{
  info: PoolInfo;
  poolName: string;
  history: PoolHistory[];
  firstActiveEpoch: number;
  totalStakeLovelace: bigint;
}> {
  const info = await bf<PoolInfo>(`/pools/${pool}`);
  if (!info || typeof info !== "object" || !("pool_id" in info)) {
    throw new Error(`Pool không tìm thấy: ${pool}`);
  }

  const meta = await bf<PoolMetadata>(`/pools/${pool}/metadata`).catch(() => ({}));
  const poolName = (meta as PoolMetadata).ticker ?? (meta as PoolMetadata).name ?? pool.slice(0, 12) + "...";

  const allHistory = await bfAll<PoolHistory>(`/pools/${pool}/history`);
  allHistory.sort((a, b) => b.epoch - a.epoch);

  let history: PoolHistory[];
  if (explicitEpochs) {
    const eSet = new Set(explicitEpochs);
    history = allHistory.filter((h) => eSet.has(h.epoch));
  } else {
    history = allHistory.slice(0, epochCount);
  }
  history.sort((a, b) => a.epoch - b.epoch);

  const firstActiveEpoch = allHistory[allHistory.length - 1]?.epoch ?? history[0]!.epoch;
  const totalStakeLovelace = history.reduce((s, h) => s + BigInt(h.active_stake), 0n);

  return { info, poolName, history, firstActiveEpoch, totalStakeLovelace };
}

// ── Interactive prompt ───────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function fmtAda(lovelace: string): string {
  return `${(BigInt(lovelace) / 1_000_000n).toLocaleString("en")} ADA`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { pool, paymentAddr, epochCount, explicitEpochs, outFile, noInteract, sig: providedSig, pubkey: providedPubkey } = parseArgs();

  if (!BLOCKFROST_KEY) throw new Error("thiếu BLOCKFROST_KEY — cấu hình .env");

  // 1. Fetch pool data
  console.log(`\nĐang tải dữ liệu pool...\n`);
  const { info, poolName, history, firstActiveEpoch, totalStakeLovelace } = await fetchPoolData(
    pool, epochCount, explicitEpochs,
  );

  const epochs = history.map((h) => h.epoch);
  const line = "═".repeat(70);

  // 2. Hiển thị thống kê
  console.log(line);
  console.log(`TIGER AIRDROP — SPO Registration`);
  console.log(line);
  console.log(`Pool:        ${pool}`);
  console.log(`Tên:         ${poolName}`);
  console.log(`Reward Acct: ${info.reward_account}`);
  console.log(`Tham gia từ: Epoch ${firstActiveEpoch}`);
  console.log();
  console.log(`Epoch  ${"Active Stake".padEnd(20)} Delegators  Blocks`);
  console.log("─".repeat(55));
  for (const h of history) {
    const first = h.epoch === firstActiveEpoch ? " ← lần đầu" : "";
    console.log(
      `${String(h.epoch).padStart(5)}  ${fmtAda(h.active_stake).padEnd(20)} ` +
      `${String(h.delegators_count).padStart(10)}  ${String(h.blocks).padStart(6)}${first}`,
    );
  }
  console.log("─".repeat(55));
  console.log(`Tổng stake × ${history.length} epoch: ${fmtAda(totalStakeLovelace.toString())}`);
  console.log();

  // 3. Luật chơi (model 3-pot — chốt 2026-07-11; xem SPO-CS-SPEC-Vi.md)
  console.log("LUẬT CHƠI AIRDROP SPO REGISTRATION (model 3-pot):");
  console.log("  1. Đăng ký để CHỨNG MINH tư cách SPO hợp lệ (đã sản xuất block, đủ");
  console.log("     tuổi pool, pledge tối thiểu, dedupe owner) → nhận phần SPO");
  console.log("     5.000.000 LAMP chia ĐỀU cho mọi SPO qua cổng — KHÔNG theo stake.");
  console.log("  2. Đăng ký cũng mở nhóm ProofChat để đo Social/Community support");
  console.log("     (SC 15.000.000 LAMP) theo đóng góp cộng đồng — cần DID sinh trắc.");
  console.log("  3. Operator phải ký xác nhận bằng reward stake key (KHÔNG cần cold key)");
  console.log("  4. Payment address đăng ký sẽ KHÔNG thay đổi sau khi nộp");
  console.log("  5. Deadline đăng ký: xem magiclamp.network/airdrop");
  console.log("  6. SPO không đăng ký / không qua cổng đúng hạn → phần dư về Treasury");
  console.log("  Chi tiết công thức SPO 5M + SC 15M: xem SPO-CS-SPEC-Vi.md");
  console.log();

  if (!noInteract) {
    const agree = await prompt("Anh đồng ý tham gia với luật chơi trên? (y/N): ");
    if (agree.toLowerCase() !== "y" && agree.toLowerCase() !== "yes") {
      console.log("Đã hủy.");
      process.exit(0);
    }
  }

  // 4. Tạo message
  const nonce = genNonce();
  const timestamp = new Date().toISOString();
  const epochList = epochs.join(", ");

  const message = [
    "TIGER AIRDROP SPO REGISTRATION v1.0",
    "",
    `Pool:            ${pool}`,
    `Reward Address:  ${info.reward_account}`,
    `Payment Address: ${paymentAddr}`,
    `Network:         ${NETWORK}`,
    `Timestamp:       ${timestamp}`,
    `Nonce:           ${nonce}`,
    `Epochs:          [${epochList}]`,
    `Total Stake:     ${totalStakeLovelace.toString()} lovelace`,
    "",
    "Tôi là operator của pool trên xác nhận:",
    "1. Tôi vận hành pool trong các epoch snapshot được liệt kê",
    "2. Tôi đồng ý với quy tắc TIGER Airdrop SPO Registration",
    "3. Payment address trên sẽ nhận phần LAMP SPO share",
  ].join("\n");

  const messageHex = Buffer.from(message, "utf8").toString("hex");

  console.log();
  console.log(line);
  console.log("BƯỚC KÝ XÁC NHẬN (dùng reward stake key — KHÔNG cần cold key):");
  console.log(line);
  console.log();
  console.log("Message cần ký (hex):");
  console.log(messageHex);
  console.log();

  console.log("─── Phương thức A: cardano-signer (khuyến nghị) ──────────────────────");
  console.log("Chạy lệnh sau với stake.skey (REWARD stake key, không phải cold.skey):");
  console.log();
  console.log(`  cardano-signer sign \\`);
  console.log(`    --data-hex "${messageHex}" \\`);
  console.log(`    --signing-key /path/to/stake.skey \\`);
  console.log(`    --out-file sig.json`);
  console.log();
  console.log("  # Sau đó lấy signature và pubkey từ sig.json:");
  console.log(`  cat sig.json`);
  console.log();

  console.log("─── Phương thức B: Eternl/Vespr wallet (hardware wallet Ledger) ──────");
  console.log("1. Mở Eternl → Settings → Sign Data");
  console.log(`2. Address: ${info.reward_account} (reward stake address)`);
  console.log("3. Payload (hex): (dán message hex ở trên)");
  console.log("4. Ký → copy signature + key từ JSON kết quả");
  console.log();
  console.log("   LƯU Ý: Eternl trả về CIP-0030 format (COSESign1 + COSEKey).");
  console.log("   Cần trích xuất raw signature (64 bytes) và pubkey (32 bytes).");
  console.log("   Hoặc nộp nguyên JSON Eternl cho MagicLamp Foundation để verify.");
  console.log();

  // 5. Nhập signature
  let finalSig: string;
  let finalPubkey: string;
  let signingMethod: "cardano-signer-ed25519" | "node-ed25519";

  if (providedSig && providedPubkey) {
    finalSig = providedSig.trim().toLowerCase();
    finalPubkey = providedPubkey.trim().toLowerCase();
    signingMethod = "cardano-signer-ed25519";
    console.log("Đang dùng signature từ --sig và --pubkey...");
  } else {
    console.log(line);
    console.log("Nhập kết quả ký:");
    console.log();
    finalSig = await prompt("Signature (hex, 64 bytes = 128 ký tự hex): ");
    finalPubkey = await prompt("Public key (hex, 32 bytes = 64 ký tự hex):  ");
    finalSig = finalSig.trim().toLowerCase();
    finalPubkey = finalPubkey.trim().toLowerCase();
    signingMethod = "cardano-signer-ed25519";
  }

  // 6. Verify signature
  console.log();
  console.log("Đang xác minh chữ ký...");

  if (!/^[0-9a-f]{128}$/.test(finalSig)) {
    console.error(`LỖI: Signature không hợp lệ (cần 128 ký tự hex, nhận ${finalSig.length}).`);
    process.exit(1);
  }
  if (!/^[0-9a-f]{64}$/.test(finalPubkey)) {
    console.error(`LỖI: Public key không hợp lệ (cần 64 ký tự hex, nhận ${finalPubkey.length}).`);
    process.exit(1);
  }

  const sigValid = verifyEd25519(messageHex, finalSig, finalPubkey);
  if (!sigValid) {
    console.error("LỖI: Chữ ký không hợp lệ — message, signature, hoặc pubkey không khớp.");
    process.exit(1);
  }
  console.log("  Chữ ký hợp lệ.");

  // 7. Verify pubkey → stake address khớp reward_account
  const derivedStakeAddr = pubkeyToStakeAddr(finalPubkey, NETWORK);
  console.log(`  Stake addr từ pubkey: ${derivedStakeAddr}`);
  console.log(`  Reward acct on-chain: ${info.reward_account}`);

  const addrMatch = derivedStakeAddr === info.reward_account;
  if (!addrMatch) {
    console.warn();
    console.warn("  CẢNH BÁO: Public key không khớp với reward_account của pool!");
    console.warn("  Có thể bạn đã ký sai key. Kiểm tra lại.");
    console.warn(`  Expected: ${info.reward_account}`);
    console.warn(`  Got:      ${derivedStakeAddr}`);
    console.warn();
    if (!noInteract) {
      const cont = await prompt("  Tiếp tục dù địa chỉ không khớp? (y/N): ");
      if (cont.toLowerCase() !== "y") {
        console.log("Đã hủy.");
        process.exit(1);
      }
    }
  } else {
    console.log("  Pubkey khớp reward_account của pool.");
  }

  // 8. Tạo registration JSON
  const reg: SpoRegistration = {
    version: "1.0",
    pool_id: pool,
    pool_name: poolName,
    reward_stake_address: info.reward_account,
    payment_address: paymentAddr,
    epochs_active: epochs,
    total_stake_lovelace: totalStakeLovelace.toString(),
    message,
    message_hex: messageHex,
    signature: finalSig,
    signing_pubkey: finalPubkey,
    signed_at: timestamp,
    nonce,
    network: NETWORK,
    signing_method: signingMethod,
  };

  await writeFile(outFile, JSON.stringify(reg, null, 2) + "\n", "utf8");

  console.log();
  console.log(line);
  console.log(`Đã ghi: ${outFile}`);
  console.log();
  console.log("Bước tiếp theo:");
  console.log("  Nộp file spo_registration.json qua:");
  console.log("  • Discord: #spo-registration channel (magiclamp.network/discord)");
  console.log("  • Email:   spo@magiclamp.network");
  console.log();
  console.log("Operator verify bằng: npx tsx verify_registration.ts --file spo_registration.json");
  console.log(line);
  console.log();
}

main().catch((e) => {
  console.error("LỖI:", e instanceof Error ? e.message : e);
  process.exit(1);
});
