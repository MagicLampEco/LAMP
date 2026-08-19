// Genesis/scripts/verify_mainnet_supply.ts — XÁC MINH đường lazy-mint LAMP trên MAINNET.
// READ-ONLY (koios, không key). Đọc supply_state UTxO + kho, báo cap 36B + headroom còn mint.
// Chạy: npx tsx verify_mainnet_supply.ts

const KOIOS = "https://api.koios.rest/api/v1";
const OILDROP = 1_000_000n; // 1 LAMP = 10^6 oildrop

// Địa chỉ/hash đã xác minh trên mainnet (tx genesis db0610c2…).
// NƠI GIỮ DUY NHẤT = offchain/src/deployed.ts — script này chỉ ĐỌC, không chép lại giá trị.
import { LAMP_MAINNET } from "../offchain/src/deployed.js";
import { pathToFileURL } from "node:url";

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
// NHƯNG: địa chỉ chỉ là chỗ HỎI, không phải bằng chứng ĐỊNH DANH — ai cũng gửi UTxO vào một
// địa chỉ script được. Cái chọn ra UTxO thật là thread NFT, xem pickSupplyState().
const SUPPLY_STATE = LAMP_MAINNET.supplyStateAddress;

/**
 * Đọc một tham số apply-param đã nướng vào script, lột đúng prefix CBOR bytestring đã biết.
 * NÉM khi thiếu param — không trả undefined. Vì sao: nếu một entry bị đổi tên hay bỏ đi (rất dễ
 * khi lên bản 12 tham số) mà ta chỉ lặng lẽ bỏ qua phép kiểm, script vẫn in ra số như thường,
 * và số đó là số đem CÔNG BỐ. Fail-closed, cùng lối với `deployedLamp()` bên deployed.ts.
 */
function paramBytes(name: string, cborPrefix: string): string {
  const p = LAMP_MAINNET.mintParams.find((x) => x.name === name);
  if (!p) throw new Error(`deployed.ts THIẾU mintParams["${name}"] — không kiểm được, DỪNG.`);
  if (!p.cborHex.startsWith(cborPrefix))
    throw new Error(`mintParams["${name}"] không mở đầu bằng CBOR ${cborPrefix}: ${p.cborHex}`);
  return p.cborHex.slice(cborPrefix.length);
}

// Định danh SupplyState là THREAD NFT (policy + name) chứ không phải địa chỉ — xem pickSupplyState().
// Lấy thẳng từ tham số đã nướng vào policy, đừng chép tay: chép tay là đường vào drift.
const THREAD_NFT_POLICY = paramBytes("thread_nft_policy", "581c");
const SUPPLY_NFT_NAME = paramBytes("thread_nft_name", "46"); // "SUPPLY"
const METER_NFT_POLICY = paramBytes("meter_nft_policy", "581c");

export interface KoiosAsset { policy_id: string; asset_name: string; quantity: string }
export interface KoiosUtxo {
  address?: string;
  inline_datum?: { value?: { fields?: { int: string | number }[] } };
  asset_list?: KoiosAsset[];
}

async function kpost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${KOIOS}${path}`, {
    method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`koios ${res.status} ${path}`);
  return res.json() as Promise<T>;
}

// Koios cắt CỨNG 1000 dòng/response và KHÔNG báo lỗi khi cắt — nó chỉ trả đúng 1000 dòng.
// Kho không bao giờ được gom (deployed.ts: "Kho CHƯA TỪNG BỊ TIÊU") và A-DEST ép mọi Δ mint
// chảy vào đó ⇒ số UTxO của kho chỉ TĂNG. Hai đường chạm mốc 1000: (a) tự nhiên, sau 1000 lượt
// vest; (b) griefing — rót 1000 UTxO bụi ~1 ADA vào BẤT KỲ biến thể base-address nào của
// credential đó (~1000 ADA, không cần khoá gì). Quá mốc mà không phân trang thì khoLamp thiếu
// đúng phần bị cắt ⇒ "lưu hành = đã mint − kho" bị THỔI PHỒNG, im lặng. Nên: luôn phân trang.
const PAGE = 1000; // trần cứng của koios
async function kpostAll<T>(path: string, body: unknown): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await kpost<T[]>(`${path}?offset=${offset}&limit=${PAGE}`, body);
    rows.push(...page);
    if (page.length < PAGE) return rows; // trang chưa đầy = hết dữ liệu
  }
}

/**
 * UTxO có mang đúng SUPPLY thread NFT không — so CẢ policy LẪN asset name.
 * So mỗi asset name là vô nghĩa: ai cũng đúc được token tên "SUPPLY" dưới policy của họ.
 */
export const holdsThreadNft = (u: KoiosUtxo): boolean =>
  (u.asset_list ?? []).some((a) => a.policy_id === THREAD_NFT_POLICY && a.asset_name === SUPPLY_NFT_NAME);

/**
 * Chọn UTxO SupplyState THẬT trong đám UTxO nằm tại supplyStateAddress.
 * On-chain neo định danh SupplyState bằng THREAD NFT, KHÔNG bằng địa chỉ (lamp_mint.ak:81-89,
 * ghi chú D8-#1). Lấy "cái đầu tiên có inline datum" là mời người ngoài viết báo cáo hộ: gửi
 * ~1 ADA kèm inline datum bịa (constructor 0 + 4 int tuỳ ý) vào supplyStateAddress, koios xếp
 * nó trước UTxO thật, thế là script in NGUYÊN BỘ SỐ của kẻ gửi — kể cả dòng "TỔNG CAP ✓ = 36 tỷ".
 * Vậy điều kiện mang NFT phải nằm TRONG phép chọn, và không thấy thì NÉM chứ không in số.
 */
export function pickSupplyState(utxos: KoiosUtxo[]): KoiosUtxo {
  const hits = utxos.filter((u) => u.inline_datum && holdsThreadNft(u));
  if (hits.length !== 1)
    throw new Error(
      `Chờ ĐÚNG 1 UTxO mang SUPPLY thread NFT (${THREAD_NFT_POLICY.slice(0, 8)}…) + inline datum, ` +
      `thấy ${hits.length} trong ${utxos.length} UTxO tại supply_state — KHÔNG in số.`,
    );
  return hits[0]!;
}

/** 4 field int của datum SupplyState. Số field khác 4 = đang đọc nhầm thứ ⇒ ném, đừng đoán. */
export function parseSupplyDatum(u: KoiosUtxo): [bigint, bigint, bigint, bigint] {
  const fs = u.inline_datum?.value?.fields ?? [];
  if (fs.length !== 4) throw new Error(`supply_state datum có ${fs.length} field, chờ 4 — DỪNG.`);
  return fs.map((f) => BigInt(f.int)) as [bigint, bigint, bigint, bigint];
}

const lamp = (oildrop: bigint) => (oildrop / OILDROP).toLocaleString("en-US") + " LAMP";

async function main() {
  console.log("═".repeat(64));
  console.log("XÁC MINH LAMP LAZY-MINT — mainnet (read-only)");
  console.log("═".repeat(64));

  // 1) supply_state UTxO + datum
  const utxos = await kpostAll<KoiosUtxo>("/address_utxos", { _addresses: [SUPPLY_STATE], _extended: true });
  const su = pickSupplyState(utxos); // ném nếu không có UTxO mang thread NFT — không in số bịa
  const [distMinted, reserveMinted, distCap, reserveCap] = parseSupplyDatum(su);

  console.log(`\nSUPPLY thread NFT (policy ${THREAD_NFT_POLICY.slice(0, 8)}…) có mặt: CÓ ✓`);
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
  const meterIsZero = /^0{56}$/.test(METER_NFT_POLICY); // paramBytes() đã ném nếu thiếu param
  if (meterIsZero && reserveCap > reserveMinted) {
    // Trần THỰC TẾ = distCap + reserve ĐÃ mint. Phần reserve đã mint thì đã ra khỏi cổng và
    // đang lưu hành — ReserveDraw chết không thu hồi lại được nó; chỉ phần CHƯA mint mới là
    // phần bị khoá lại. Hiện reserve_minted = 0 nên hai cách viết ra cùng một số, nhưng công
    // thức phải đúng cho lần sau, không phải đúng nhờ may.
    const realCap = distCap + reserveMinted;
    console.log(
      `  ⚠ CỘT RESERVE Ở TRÊN LÀ HEADROOM THEO DATUM, KHÔNG PHẢI LƯỢNG RÚT ĐƯỢC:\n` +
      `    meter_nft_policy nướng vào policy này = 28 byte 0 ⇒ điều kiện\n` +
      `    count_inputs_holding_nft(...) == 1 của nhánh ReserveDraw không bao giờ thoả.\n` +
      `    Trần phát hành THỰC TẾ của policy ${LAMP_POLICY.slice(0, 8)}… = ${lamp(realCap)}, KHÔNG phải ${lamp(totalCap)}.`,
    );
  }

  // 2) kho balance — quét THEO CREDENTIAL, gom mọi biến thể stake của cùng payment credential.
  const khoUtxos = await kpostAll<KoiosUtxo>("/credential_utxos", {
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

  // pickSupplyState() đã bảo đảm thread NFT có mặt (không thì đã ném) ⇒ chỉ còn kiểm cap.
  console.log(`\nKẾT LUẬN: lazy-mint validator B ${totalCap === 36_000_000_000n * OILDROP ? "ĐÃ wired trên mainnet" : "CẦN kiểm tra thêm"}.`);
  console.log("Để mint THẬT cho pot: cần (a) registry WHO-gate + khoá authority (Tuân giữ),");
  console.log("(b) builder advance supply_state + mint→kho + release→pot. Xem HANDOFF.");
  console.log("═".repeat(64));
}
// Chỉ chạy khi được gọi TRỰC TIẾP. File này export mấy hàm thuần để test được (tests/
// verify_supply.test.ts); nếu để main() chạy ở top-level thì mỗi lần import là một lượt bắn
// koios thật, và test sẽ phụ thuộc mạng.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
}
