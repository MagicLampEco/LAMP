// Genesis/scripts/verify_mainnet_supply.ts — XÁC MINH đường lazy-mint LAMP trên MAINNET.
// READ-ONLY (koios, không key). Đọc supply_state UTxO + kho, báo cap 36B + headroom còn mint.
// Chạy: npx tsx verify_mainnet_supply.ts

const KOIOS = "https://api.koios.rest/api/v1";
const OILDROP = 1_000_000n; // 1 LAMP = 10^6 oildrop

// Địa chỉ/hash đã xác minh trên mainnet (tx genesis db0610c2…):
const LAMP_POLICY = "55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0";
const LAMP_NAME = "4c414d50"; // "LAMP"
const KHO = "addr1w827sry6t2y9744ndkg4ks6nct57v7tm8pz46ywsq98dhdsf76slu";
const SUPPLY_STATE = "addr1wxz0dkz0v3rg6zeqz9c7cyxz9lg3ynkrlkqrapfkj7e5ppqexy5d3";
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

  // 2) kho balance
  const khoUtxos = await kpost<any[]>("/address_utxos", { _addresses: [KHO], _extended: true });
  let khoLamp = 0n;
  for (const u of khoUtxos) for (const a of u.asset_list || [])
    if (a.policy_id === LAMP_POLICY && a.asset_name === LAMP_NAME) khoLamp += BigInt(a.quantity);
  console.log(`\nKHO (${KHO.slice(0, 20)}…) giữ: ${lamp(khoLamp)}`);

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
