// Genesis/scripts/verify_mainnet_supply.ts — XÁC MINH đường lazy-mint LAMP trên MAINNET.
// READ-ONLY (koios, không key). Đọc supply_state UTxO + kho, báo cap 36B + headroom còn mint.
// Chạy: npx tsx verify_mainnet_supply.ts

const KOIOS = "https://api.koios.rest/api/v1";
const OILDROP = 1_000_000n; // 1 LAMP = 10^6 oildrop

// Địa chỉ/hash đã xác minh trên mainnet (tx genesis db0610c2…).
// NƠI GIỮ DUY NHẤT = offchain/src/deployed.ts — script này chỉ ĐỌC, không chép lại giá trị.
import { LAMP_MAINNET } from "../offchain/src/deployed.js";

const LAMP_POLICY = LAMP_MAINNET.policyId;
const LAMP_NAME = LAMP_MAINNET.assetName;
// Kho đếm theo PAYMENT CREDENTIAL, không theo một địa chỉ. A-DEST so bằng
// payment_credential và BỎ QUA stake credential (util.ak:72,83-90), và có test khẳng định
// biến thể staked vẫn PASS (lamp_mint.ak:605-625) ⇒ kho là một HỌ địa chỉ, không phải một
// địa chỉ. Hỏi bằng `khoAddress` (biến thể enterprise) thì một lượt rót hợp lệ vào biến thể
// có stake credential sẽ VÔ HÌNH ⇒ khoLamp thiếu ⇒ con số lưu hành công bố bị thổi phồng
// đúng bằng lượng đó.
const KHO_HASH = LAMP_MAINNET.khoHash;
// supply_state thì NGƯỢC LẠI — hỏi bằng địa chỉ đầy đủ là đúng: validator ép
// `s_out.address == s_in.address` (lamp_mint.ak:95), so cả stake part, nên nó đứng yên
// một địa chỉ. Hai kho hai luật khác nhau; đừng đồng nhất cách hỏi.
const SUPPLY_STATE = LAMP_MAINNET.supplyStateAddress;
const SUPPLY_NFT_NAME = "535550504c59"; // "SUPPLY"

async function kpost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${KOIOS}${path}`, {
    method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`koios ${res.status} ${path}`);
  return res.json() as Promise<T>;
}

const lamp = (oildrop: bigint) => (oildrop / OILDROP).toLocaleString("en-US") + " LAMP";

async function main() {
  console.log("═".repeat(64));
  console.log("XÁC MINH LAMP LAZY-MINT — mainnet (read-only)");
  console.log("═".repeat(64));

  // 1) supply_state UTxO + datum
  const utxos = await kpost<any[]>("/address_utxos", { _addresses: [SUPPLY_STATE], _extended: true });
  const su = utxos.find((u) => u.inline_datum);
  if (!su) throw new Error("KHÔNG thấy supply_state UTxO có inline datum — lazy-mint CHƯA wired?");

  const hasNft = (su.asset_list || []).some((a: any) => a.policy_id === LAMP_POLICY ? false : a.asset_name === SUPPLY_NFT_NAME) ||
    (su.asset_list || []).some((a: any) => a.asset_name === SUPPLY_NFT_NAME);
  const fields = su.inline_datum.value.fields.map((f: any) => BigInt(f.int));
  const [distMinted, reserveMinted, distCap, reserveCap] = fields;

  console.log(`\nSUPPLY thread NFT có mặt: ${hasNft ? "CÓ ✓" : "KHÔNG ✗"}`);
  console.log(`supply_state datum (constructor 0, 4 field oildrop):`);
  console.log(`  dist_minted    = ${lamp(distMinted)}`);
  console.log(`  reserve_minted = ${lamp(reserveMinted)}`);
  console.log(`  dist_cap       = ${lamp(distCap)}`);
  console.log(`  reserve_cap    = ${lamp(reserveCap)}`);

  const totalCap = distCap + reserveCap;
  const totalMinted = distMinted + reserveMinted;
  console.log(`\n  TỔNG CAP       = ${lamp(totalCap)}  ${totalCap === 36_000_000_000n * OILDROP ? "✓ = 36 tỷ" : "✗ ≠ 36 tỷ"}`);
  console.log(`  ĐÃ MINT        = ${lamp(totalMinted)}`);
  console.log(`  CÒN MINT ĐƯỢC  = ${lamp(distCap - distMinted)} (distribution) + ${lamp(reserveCap - reserveMinted)} (reserve)`);
  // "Còn mint được" ở cột reserve là headroom THEO DATUM, không phải theo đường đi thật.
  // Nhánh ReserveDraw gác bằng meter NFT, mà meter_nft_policy của bản này = 28 byte 0
  // (deployed.ts:92-93, 118-119) — không có tiền ảnh blake2b-224 ⇒ điều kiện
  // count_inputs_holding_nft(...) == 1 không bao giờ thoả. Script này ĐỌC chain, nên nó
  // phải nói ra chỗ con số của chain khác với con số rút được thật.
  const meterParam = LAMP_MAINNET.mintParams.find((p) => p.name === "meter_nft_policy");
  const meterIsZero = !!meterParam && /^581c0{56}$/.test(meterParam.cborHex);
  if (meterIsZero && reserveCap > reserveMinted) {
    console.log(
      `  ⚠ CỘT RESERVE Ở TRÊN LÀ HEADROOM THEO DATUM, KHÔNG PHẢI LƯỢNG RÚT ĐƯỢC:\n` +
      `    meter_nft_policy nướng vào policy này = 28 byte 0 ⇒ điều kiện\n` +
      `    count_inputs_holding_nft(...) == 1 của nhánh ReserveDraw không bao giờ thoả.\n` +
      `    Trần phát hành THỰC TẾ của policy ${LAMP_POLICY.slice(0, 8)}… = ${lamp(distCap)}, KHÔNG phải ${lamp(totalCap)}.`,
    );
  }

  // 2) kho balance — quét THEO CREDENTIAL, gom mọi biến thể stake của cùng payment credential.
  const khoUtxos = await kpost<any[]>("/credential_utxos", {
    _payment_credentials: [KHO_HASH], _extended: true,
  });
  let khoLamp = 0n;
  for (const u of khoUtxos) for (const a of u.asset_list || [])
    if (a.policy_id === LAMP_POLICY && a.asset_name === LAMP_NAME) khoLamp += BigInt(a.quantity);
  console.log(`\nKHO (credential ${KHO_HASH.slice(0, 16)}…) giữ: ${lamp(khoLamp)}`);
  // Nói ra biến thể nào đang giữ: một biến thể lạ xuất hiện là tin cần biết, không phải nhiễu.
  const khoVariants = [...new Set(khoUtxos.map((u) => u.address as string))];
  console.log(`  ${khoUtxos.length} UTxO tại ${khoVariants.length} biến thể địa chỉ:`);
  for (const v of khoVariants) {
    console.log(`    ${v}${v === LAMP_MAINNET.khoAddress ? "  (enterprise — bản ghi ở deployed.ts)" : "  ⚠ BIẾN THỂ KHÁC"}`);
  }

  // 3) headroom cho 3 đợt launch
  const need = { ETD: 12_000_000n, Airdrop: 120_000_000n, SRCL: 381_000_000n }; // LAMP
  const needOildrop = Object.values(need).reduce((s, x) => s + x, 0n) * OILDROP;
  console.log(`\nNhu cầu 3 đợt (ETD 12M + Airdrop 120M + SRCL ~381M) = ${lamp(needOildrop)}`);
  console.log(`Headroom distribution ${(distCap - distMinted) >= needOildrop ? "ĐỦ ✓" : "THIẾU ✗"} (còn ${lamp(distCap - distMinted)}).`);

  console.log(`\nKẾT LUẬN: lazy-mint validator B ${hasNft && totalCap === 36_000_000_000n * OILDROP ? "ĐÃ wired trên mainnet" : "CẦN kiểm tra thêm"}.`);
  console.log("Để mint THẬT cho pot: cần (a) registry WHO-gate + khoá authority (Tuân giữ),");
  console.log("(b) builder advance supply_state + mint→kho + release→pot. Xem HANDOFF.");
  console.log("═".repeat(64));
}
main().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
