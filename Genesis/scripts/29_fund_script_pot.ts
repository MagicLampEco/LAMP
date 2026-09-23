// 29_fund_script_pot.ts — rót LAMP từ ví vận hành vào KHO SCRIPT của một pot, bằng một lượt
// chuyển thường.
//
// Đây là bước cuối của đường "kho Distribution → Redeem về ví → chuyển thường tới pot". Đường
// `send` của `28_beacon_grant_redeem.ts` cố ý từ chối mọi đích là script (SEND-003): rót vào kho
// script mà không biết hình dạng UTxO kho đó nhận là rót mù. Runner này đòi người chạy NÓI RA
// hình dạng đó, và soát lại từng phần trước khi ký.
//
// Rót đúng ĐỊA CHỈ chưa phải rót vào SỔ. Một kho script nhận ra tài sản của nó bằng cái mà
// validator của nó đọc (datum, NFT, hình dạng value), không bằng địa chỉ. Nên trước khi gửi,
// người chạy phải trả lời được: "sau giao dịch này, nhánh nào của validator pot tiêu lại được
// UTxO vừa tạo, và điều kiện nào của nó được thoả?". Runner không trả lời hộ câu đó — nó chỉ
// bảo đảm UTxO tạo ra có ĐÚNG hình dạng người chạy khai.
//
// Hình dạng UTxO tạo ra:
//   địa chỉ  = POT_ADDRESS, payment credential là Script và hash == POT_SCRIPT_HASH (khai hai lần
//              để một lỗi gõ ở một chỗ không lọt qua);
//   value    = đúng {lovelace, LAMP} — không asset nào khác;
//   datum    = InlineDatum(POT_DATUM_CBOR) — BẮT BUỘC, không mặc định.
//
// Chạy (mặc định CHỈ DỰNG, không ký, không gửi):
//   NETWORK=Preprod LAMP_POLICY_ID=<pid> LAMP_ASSET_NAME=<hex> \
//   POT_ADDRESS=<addr> POT_SCRIPT_HASH=<hex28> POT_DATUM_CBOR=<cbor> AMOUNT_OILDROP=<n> \
//     tsx 29_fund_script_pot.ts
//   … thêm SUBMIT=true để ký và gửi.
//
// Mainnet bị chặn: cũng như 20–28, đây là công cụ diễn tập cho tới khi đường rót pot trên
// Mainnet được duyệt.

import { Data, getAddressDetails, toUnit } from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, makeLucid, explorerTx } from "./config.js";

function req(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`POT-FUND-001: thiếu ${name}. Không có giá trị mặc định cho bất cứ trường nào của lượt rót.`);
  return v;
}

function hex(name: string, v: string, bytes?: number): string {
  const h = v.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]*$/.test(h) || h.length % 2 !== 0) throw new Error(`POT-FUND-002: ${name} không phải hex.`);
  if (bytes !== undefined && h.length !== bytes * 2) {
    throw new Error(`POT-FUND-003: ${name} phải dài ${bytes} byte, đang ${h.length / 2}.`);
  }
  return h;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") {
    throw new Error("POT-FUND-000: CHẶN trên Mainnet — runner này là công cụ diễn tập.");
  }

  const potAddress = req("POT_ADDRESS");
  const potHash = hex("POT_SCRIPT_HASH", req("POT_SCRIPT_HASH"), 28);
  const datumCbor = hex("POT_DATUM_CBOR", req("POT_DATUM_CBOR"));
  const lampPolicy = hex("LAMP_POLICY_ID", req("LAMP_POLICY_ID"), 28);
  const lampName = hex("LAMP_ASSET_NAME", req("LAMP_ASSET_NAME"));
  const amountRaw = req("AMOUNT_OILDROP");
  if (!/^[0-9]+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) {
    throw new Error(`POT-FUND-004: AMOUNT_OILDROP='${amountRaw}' phải là số nguyên dương.`);
  }
  const amount = BigInt(amountRaw);
  const lovelace = BigInt((process.env.POT_LOVELACE ?? "2000000").trim());

  // ── Địa chỉ: đúng mạng, credential là Script, hash khớp lời khai ──────────
  const det = getAddressDetails(potAddress);
  if (det.networkId !== 0) {   // Mainnet đã bị chặn ở đầu hàm ⇒ mọi mạng còn lại là testnet
    throw new Error(`POT-FUND-005: ${potAddress} thuộc networkId ${det.networkId}, không phải ${NETWORK}.`);
  }
  if (det.paymentCredential?.type !== "Script") {
    throw new Error(`POT-FUND-006: ${potAddress} không có payment credential kiểu Script — đây không phải kho script.`);
  }
  if (det.paymentCredential.hash !== potHash) {
    throw new Error(
      `POT-FUND-007: địa chỉ mang script hash ${det.paymentCredential.hash}, lời khai POT_SCRIPT_HASH là ` +
        `${potHash}. Hai nguồn lệch nhau thì không gửi.`,
    );
  }

  // ── Datum: phải giải mã được thành Plutus Data ─────────────────────────────
  try {
    Data.from(datumCbor);
  } catch (e) {
    throw new Error(`POT-FUND-008: POT_DATUM_CBOR không giải mã được thành Plutus Data (${String(e)}).`);
  }

  const lucid = await makeLucid();
  const lampUnit = toUnit(lampPolicy, lampName);
  const walletLamp = (await lucid.wallet().getUtxos()).reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  if (walletLamp < amount) {
    throw new Error(`POT-FUND-009: ví có ${walletLamp} oildrop LAMP, cần ${amount}.`);
  }

  console.log(`═══ Rót kho script (${NETWORK}) ═══`);
  console.log(`Đích:        ${potAddress}`);
  console.log(`Script hash: ${potHash}  (khớp địa chỉ)`);
  console.log(`LAMP:        ${amount} oildrop  (ví có ${walletLamp})`);
  console.log(`lovelace:    ${lovelace} (Lucid có thể nâng lên min-ADA)`);
  console.log(`Datum:       InlineDatum ${datumCbor}`);

  const tx = await lucid.newTx()
    .pay.ToContract(potAddress, { kind: "inline", value: datumCbor }, { lovelace, [lampUnit]: amount })
    .complete();

  if (!SUBMIT) {
    console.log("\n(SUBMIT=false ⇒ KHÔNG ký, KHÔNG gửi.) Hash thân giao dịch: " + tx.toHash());
    return;
  }
  const h = await (await tx.sign.withWallet().complete()).submit();
  console.log(`\n📤 ${h}\n   ${explorerTx(h)}`);
  await lucid.awaitTx(h);
  await sleep(20_000);

  // ── Đối chiếu trên chuỗi: UTxO vừa tạo có đúng hình dạng đã khai ──────────
  const made = (await lucid.utxosAt(potAddress)).filter((u) => u.txHash === h);
  const fails: string[] = [];
  if (made.length !== 1) fails.push(`có ${made.length} UTxO của tx này ở đích, cần đúng 1`);
  const u = made[0];
  if (u) {
    if ((u.assets[lampUnit] ?? 0n) !== amount) fails.push(`LAMP ${u.assets[lampUnit] ?? 0n} ≠ ${amount}`);
    const others = Object.keys(u.assets).filter((k) => k !== "lovelace" && k !== lampUnit);
    if (others.length > 0) fails.push(`mang asset lạ: ${others.join(",")}`);
    if ((u.datum ?? "").toLowerCase() !== datumCbor) fails.push(`datum ${u.datum ?? "không có"} ≠ ${datumCbor}`);
  }
  if (fails.length > 0) throw new Error(`POT-FUND-VERIFY-001: ${fails.join("; ")}`);
  console.log(`✅ Đối chiếu trên chuỗi: 1 UTxO · ${amount} oildrop LAMP · chỉ {ada, LAMP} · datum đúng.`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
