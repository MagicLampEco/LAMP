// demo_reserve_draw_resume.ts — chỉ chạy tx DRAW cuối (G1/R1/T1/A1 đã on-chain).
// Re-derive mọi policy/address từ 4 genesis ref CỐ ĐỊNH (đã dùng ở lần deploy trước).
// Sửa lỗi PastHorizon: validity range hẹp quanh now.

import {
  Lucid, Blockfrost, applyParamsToScript, mintingPolicyToId,
  validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  Constr, getAddressDetails, toUnit, Data,
  type MintingPolicy, type Validator,
} from "@lucid-evolution/lucid";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { reserveStateToCbor, drawRedeemerToCbor } from "../../Reserve/offchain/src/datum.js";
import {
  custodyDatumToCbor, custodyDatumFromCbor, custodyRedeemerToCbor,
} from "../../Treasury/offchain/src/datum.js";
import { RESERVE_SOURCE_TAG } from "../../Treasury/offchain/src/constants.js";
import { planMigrateDatum } from "../../Treasury/offchain/src/migrate.js";
import { attachGateSpend } from "../../Treasury/offchain/src/reserveGateBuilder.js";
import { msPerEpoch, assertMsPerEpochMatchesNetwork } from "../offchain/src/constants.js";
import { assertParamCount } from "../../Genesis/offchain/src/applyGate.js";

// Secret: MỘT nguồn duy nhất — $AGENT_SECRETS. KHÔNG có đường dự phòng nướng cứng.
// Đường dự phòng cũ trỏ vào bộ nhà agent ở chỗ cũ — chỗ đó đã dời, nên hằng số ấy là
// một con trỏ chết. Con trỏ chết im lặng theo HAI chiều: dotenv KHÔNG báo khi tệp
// không tồn tại (script chỉ gãy muộn hơn, ở một chỗ không liên quan), và nếu về sau có
// tệp thật mọc đúng đường đó thì nó được đọc mà không ai chọn.
if (!process.env.AGENT_SECRETS) {
  throw new Error(
    "SECRETS-001: thiếu $AGENT_SECRETS. Secret CHỈ đọc từ biến này, không có đường dự phòng.",
  );
}
dotenv.config({ path: process.env.AGENT_SECRETS });

const TOKEN_NAME = "744c414d50";
const SUPPLY_NAME = "535550504c59";
const RESERVE_THREAD_NAME = "524553564d4554";
const AUTH_NAME = "5054";
const INSTANCE_ID = "747265732d7265736576";
// ms/epoch theo mạng đích (Preview = 86_400_000). Là param của custody + reserve_draw
// ⇒ nướng vào script hash ⇒ ĐỔI SỐ = ĐỔI ĐỊA CHỈ.
// ⚠ 4 genesis ref hardcode bên dưới là của lần deploy CŨ chạy bằng 432_000_000 (số của
//   Preprod/Mainnet, lệch 5× trên Preview). Bản deploy đó nay mồ côi: muốn resume thì
//   chạy lại `demo_reserve_e2e.ts` rồi thay 4 ref bên dưới bằng ref của run mới.
const NETWORK = "Preview" as const;
const MS_PER_EPOCH = msPerEpoch(NETWORK);
assertMsPerEpochMatchesNetwork(MS_PER_EPOCH, NETWORK);
const PROPOSAL_POLICY = "00".repeat(28);
const FLOOR_OILDROP = 1_000_000n;
const DRAW_OILDROP = 1_000_000n;
const RESERVED_MIN_ADA = 2_000_000n;

// 4 genesis ref CỐ ĐỊNH (từ lần deploy trước).
const threadRef = new Constr(0, ["360b3313a1f7ac59681a177757711b4b4e4533563f21ba24f2f082fbaa0970f2", 1n]);
const reserveRef = new Constr(0, ["df167c4ce1166b0d40cad175f31a72004a9022bd3a48a2e9be15f2ddb5ec3f5b", 3n]);
const custodyRefData = new Constr(0, ["facf5831e65dbecbf4c7f4f96c0940a319543d232c28d1479da21909e39d1713", 1n]);
const authRef = new Constr(0, ["864f7298039e40cae164c0c0dcb7ae36728eea170c849927ddbfca39b8738bc5", 2n]);

const lucid = await Lucid(new Blockfrost(`https://cardano-preview.blockfrost.io/api/v0`, process.env.BLOCKFROST_KEY!), "Preview");
lucid.selectWallet.fromSeed((process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " "));
const myAddr = await lucid.wallet().address();
const pkh = getAddressDetails(myAddr).paymentCredential!.hash;

const gbp = JSON.parse(await readFile(resolve(process.cwd(), "../../Genesis/onchain/plutus.json"), "utf8"));
const tbp = JSON.parse(await readFile(resolve(process.cwd(), "../../Treasury/onchain/plutus.json"), "utf8"));
const rbp = JSON.parse(await readFile(resolve(process.cwd(), "../../Reserve/onchain/plutus.json"), "utf8"));
const gg = (t: string) => gbp.validators.find((v: { title: string }) => v.title === t).compiledCode;
const gt = (t: string) => tbp.validators.find((v: { title: string }) => v.title === t).compiledCode;
const gr = (t: string) => rbp.validators.find((v: { title: string }) => v.title === t).compiledCode;

// ── Cổng APPLY-001: mọi lượt apply-param phải đi qua đây ───────────────────────
// `applyParamsToScript` KHÔNG báo lỗi khi thiếu hoặc thừa tham số. Nó apply một phần rồi
// trả về script hash / policy id KHÁC, im lặng — script chạy êm vào một địa chỉ không ai
// giữ, và với `lamp_mint` thì đúc LAMP dưới policy id sai (LAMP không burn được,
// `Treasury/CONTRACT.md §5`). TypeScript không bắt được vì tham số đi theo `unknown[]`.
// Cổng thuần ở `Genesis/offchain/src/applyGate.ts`; ở đây chỉ nối số khai của blueprint vào.
const mkApply = (bp: { validators: Array<{ title: string; parameters?: unknown[]; compiledCode: string }> }) =>
  (title: string, params: unknown[]): string => {
    const v = bp.validators.find((x) => x.title === title);
    if (!v) throw new Error(`APPLY-002: blueprint không khai validator "${title}".`);
    assertParamCount(title, (v.parameters ?? []).length, params.length);
    return applyParamsToScript(v.compiledCode, params as never[]);
  };
const apG = mkApply(gbp);
const apT = mkApply(tbp);
const apR = mkApply(rbp);
const link = (h: string) => `https://preview.cexplorer.io/tx/${h}`;

const threadPid = mintingPolicyToId({ type: "PlutusV3", script: apG("thread_nft.thread_nft.mint", [threadRef]) });
const reserveThreadPolicy: MintingPolicy = { type: "PlutusV3", script: apR("reserve_thread.reserve_thread.mint", [reserveRef, RESERVE_THREAD_NAME]) };
const reserveThreadPid = mintingPolicyToId(reserveThreadPolicy);
// ── THỨ TỰ ĐÚC: custody_seed → lamp_mint → custody (xem demo_reserve_e2e.ts) ──
// `custody_seed` không còn nướng `custodyHash` (vòng seed↔custody đã bị phá on-chain), nên
// custodySeedPid tính được TRƯỚC, và lamp_mint mới lấy nó cho khe #13-14 (A-DEST Reserve).
const custodySeedPid = mintingPolicyToId({ type: "PlutusV3", script: apT("custody_seed.custody_seed.mint", [custodyRefData]) });
const custodyNftUnit = toUnit(custodySeedPid, INSTANCE_ID);

// ⛔ CHƯA NỐI ĐƯỢC — lamp_mint khai 14 tham số, dưới đây truyền 7. Cổng APPLY-001 sẽ NÉM ở
// đúng dòng này, và đó là hành vi ĐÚNG: fail-closed. KHÔNG điền giá trị bừa cho đủ số —
// apply-param nướng vào policy-id, giá trị bịa không sinh lỗi mà sinh MỘT TOKEN KHÁC, và LAMP
// đúc dưới policy-id sai thì không thu hồi được. Năm khe demo này chưa có dữ kiện: #4 dist_cap,
// #5 reserve_cap, #6-7 registry_nft_policy/name (WHO-gate v2), #8 token_tag, #9-10 kho
// Distribution. Lý do đầy đủ ở khối cùng tên trong `demo_reserve_e2e.ts`.
//
// ⛔ VÀ KHÔNG CHỈ `lamp_mint` — hai chữ ký nữa đã đổi sau bản demo này (11/09): `reserve_auth`
// 2 → 3 khe (thêm #3 `floor_oildrop`) và `reserve_draw` 11 → 12 khe (thêm #12 `reserve_cap`).
// Hai chỗ gọi bên dưới còn dựng mảng BẰNG TAY, tức đi vòng qua `reserveAuthParamList` /
// `reserveGateParamList` (FLOOR-PAIR-001) và `reserveDrawParamList` (APPLY-003 +
// RESERVE-CAP-002). Nối lại phải đi qua các hàm đó, không phải thêm một phần tử vào mảng tay.
const tlampPolicy: MintingPolicy = { type: "PlutusV3", script: apG("lamp_mint.lamp_mint.mint", [threadPid, SUPPLY_NAME, TOKEN_NAME, [pkh], 1n, reserveThreadPid, RESERVE_THREAD_NAME]) };
const tlampPid = mintingPolicyToId(tlampPolicy);
const lampUnit = toUnit(tlampPid, TOKEN_NAME);
const ssScript: Validator = { type: "PlutusV3", script: apG("supply_state.supply_state.spend", [tlampPid, threadPid, TOKEN_NAME]) };
const ssAddr = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(ssScript)));
const threadUnit = toUnit(threadPid, SUPPLY_NAME);

// custody: +2 khe LAMP (#4-5) để nhánh MigrateIn đo Δ — không đọc từ datum được, datum do
// người gửi đặt.
const custodyScript: Validator = { type: "PlutusV3", script: apT("custody.custody.spend", [
  PROPOSAL_POLICY, custodySeedPid, MS_PER_EPOCH, tlampPid, TOKEN_NAME,
]) };
const custodyHash = validatorToScriptHash(custodyScript);
const custodyAddr = credentialToAddress("Preview", scriptHashToCredential(custodyHash));
const authPolicy: MintingPolicy = { type: "PlutusV3", script: apT("reserve_auth.reserve_auth.mint", [authRef, AUTH_NAME]) };
const authPid = mintingPolicyToId(authPolicy);
const authUnit = toUnit(authPid, AUTH_NAME);
const gateScript: Validator = { type: "PlutusV3", script: apT("reserve_gate.reserve_gate.spend", [custodySeedPid, INSTANCE_ID, tlampPid, TOKEN_NAME, FLOOR_OILDROP, authPid, AUTH_NAME]) };
const gateHash = validatorToScriptHash(gateScript);
const gateAddr = credentialToAddress("Preview", scriptHashToCredential(gateHash));
// Khe #6 cũ là `reserve_dest: Address` — ĐỊA CHỈ. Đã bỏ: rót đúng địa chỉ mà sai hình dạng thì
// Δ nằm trong SÂN kho, ngoài SỔ kho. Nay kho định danh bằng NFT (#6-7) + ghim vào ĐÚNG
// validator giữ nó (#11), để chính `custody` nhánh MigrateIn ghi Δ vào sổ.
const reserveDrawScript: Validator = { type: "PlutusV3", script: apR("reserve_draw.reserve_draw.spend", [
  tlampPid, TOKEN_NAME,                        // #1-2  LAMP — đo Δ mint
  reserveThreadPid, RESERVE_THREAD_NAME,       // #3-4  reserve thread NFT (meter)
  MS_PER_EPOCH,                                // #5    quy đổi epoch
  custodySeedPid, INSTANCE_ID,                 // #6-7  KHO NFT — Luật 9
  authPid, AUTH_NAME,                          // #8-9  auth NFT Treasury-pull
  gateHash,                                    // #10   auth PHẢI tiêu TỪ gate này
  custodyHash,                                 // #11   Luật 10 — kho NFT ở ĐÚNG script custody
]) };
const reserveDrawAddr = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(reserveDrawScript)));
const reserveThreadUnit = toUnit(reserveThreadPid, RESERVE_THREAD_NAME);

console.log(`tlampPid=${tlampPid} reserveThreadPid=${reserveThreadPid}`);
console.log(`custodyAddr=${custodyAddr} gateAddr=${gateAddr} reserveDrawAddr=${reserveDrawAddr}`);

// Đọc UTxO on-chain.
const reserveUtxo = (await lucid.utxosAt(reserveDrawAddr)).find((u) => (u.assets[reserveThreadUnit] ?? 0n) === 1n)!;
const supplyUtxo = (await lucid.utxosAt(ssAddr)).find((u) => (u.assets[threadUnit] ?? 0n) === 1n)!;
const authUtxo = (await lucid.utxosAt(gateAddr)).find((u) => (u.assets[authUnit] ?? 0n) === 1n)!;
const custodyUtxo = (await lucid.utxosAt(custodyAddr)).find((u) => (u.assets[custodyNftUnit] ?? 0n) === 1n)!;
if (!reserveUtxo || !supplyUtxo || !authUtxo || !custodyUtxo) throw new Error("thiếu 1 UTxO tiền-điều-kiện trên chain");

const rIn = Data.from(reserveUtxo.datum!) as Constr<Data>;
const start = rIn.fields[0] as bigint, total = rIn.fields[1] as bigint, drawn = rIn.fields[2] as bigint, lastEpoch = rIn.fields[3] as bigint;
const loMs = Date.now() - 60_000;
let hiMs = loMs + 90_000;
const t = BigInt(Math.floor(loMs / Number(MS_PER_EPOCH)));
if (BigInt(Math.floor(hiMs / Number(MS_PER_EPOCH))) !== t) hiMs = Number((t + 1n) * MS_PER_EPOCH) - 1000;
if (!(t > lastEpoch)) throw new Error(`t=${t} ≤ last_epoch=${lastEpoch}`);
console.log(`draw epoch t=${t} (last=${lastEpoch}) lo=${loMs} hi=${hiMs}`);
const rOut = { start_epoch: start, total_oildrop: total, drawn_oildrop: drawn + DRAW_OILDROP, last_epoch: t };
const sIn = Data.from(supplyUtxo.datum!) as Constr<Data>;
const sOut = new Constr(0, [sIn.fields[0], (sIn.fields[1] as bigint) + DRAW_OILDROP, sIn.fields[2], sIn.fields[3]]);

// ── KHO': Δ vào VALUE **VÀ** vào SỔ, cùng một tx ──────────────────────────────
// Bản cũ ở đây làm `.pay.ToAddress(custodyAddr, …)` — một UTxO KHÔNG datum tại địa chỉ kho.
// Validator kho đòi datum ⇒ Δ nằm trong SÂN kho, ngoài SỔ kho, không tiêu lại được. Nay kho
// bị TIÊU (MigrateIn) và TÁI TẠO với sổ đã cộng Δ.
const custodyDatumIn = custodyDatumFromCbor(custodyUtxo.datum!);
const custodyDatumOut = planMigrateDatum(custodyDatumIn, tlampPid, TOKEN_NAME, DRAW_OILDROP, t);
// ⚠ Lovelace giữ NGUYÊN ở đây (C-MIG-7 nới `>=` nên tăng cũng hợp lệ). Ledger từ chối vì
// min-UTxO thì đường sửa là SEED kho dư ADA hơn, KHÔNG phải hạ Δ — xem chú thích cùng chỗ ở
// `demo_reserve_e2e.ts` (nguồn: `Treasury/onchain/lib/magiclamp/treasury/migrate.ak`, F5).
const custodyValueOut = {
  ...custodyUtxo.assets,
  [lampUnit]: (custodyUtxo.assets[lampUnit] ?? 0n) + DRAW_OILDROP,
};

let txb = lucid.newTx()
  .collectFrom([reserveUtxo], drawRedeemerToCbor())
  .attach.SpendingValidator(reserveDrawScript)
  .pay.ToContract(reserveDrawAddr, { kind: "inline", value: reserveStateToCbor(rOut) }, { lovelace: RESERVED_MIN_ADA, [reserveThreadUnit]: 1n })
  .mintAssets({ [lampUnit]: DRAW_OILDROP }, Data.to(new Constr(1, [])))
  .attach.MintingPolicy(tlampPolicy)
  .collectFrom([supplyUtxo], Data.to(new Constr(0, [])))
  .attach.SpendingValidator(ssScript)
  .pay.ToContract(ssAddr, { kind: "inline", value: Data.to(sOut) }, { lovelace: supplyUtxo.assets.lovelace, [threadUnit]: 1n })
  // KHO custody: TIÊU (MigrateIn) rồi TÁI TẠO — Luật 9+10 của reserve_draw ép đúng việc này.
  // Địa chỉ ra lấy TỪ CHÍNH custodyUtxo (C-MIG-ADDR giữ nguyên cả stake credential).
  .collectFrom([custodyUtxo], custodyRedeemerToCbor({ kind: "MigrateIn", source: RESERVE_SOURCE_TAG }))
  .attach.SpendingValidator(custodyScript)
  .pay.ToContract(custodyUtxo.address, { kind: "inline", value: custodyDatumToCbor(custodyDatumOut) }, custodyValueOut)
  .validFrom(loMs).validTo(hiMs)
  .addSignerKey(pkh);

// custody ở vai INPUT — đang bị TIÊU ở trên; PlutusV3 cấm một TxIn nằm đồng thời ở
// tx.inputs và tx.reference_inputs, nên vai mặc định "reference" ở đây không dựng nổi tx.
txb = attachGateSpend(txb, {
  lucid, authUtxo, gateScript, gateAddress: gateAddr,
  authPolicyId: authPid, authName: AUTH_NAME,
  custodyUtxo, custodyRole: "input",
  lampPolicyId: tlampPid, tokenName: TOKEN_NAME, floorOildrop: FLOOR_OILDROP,
});

const tx = await txb.complete({ coinSelection: true });
const h = await (await tx.sign.withWallet().complete()).submit();
console.log(`[DRAW] Reserve→Treasury pull ${DRAW_OILDROP} oildrop (t=${t}) ${link(h)}`);
await lucid.awaitTx(h);
await writeFile(resolve(process.cwd(), "demo-reserve-e2e-out.json"), JSON.stringify({
  network: "Preview", tlampPid, reserveThreadPid, custodyAddr, gateAddr, reserveDrawAddr,
  deploy: { G1: "b784c0953f225c864485245dd77682c7e9369064f3c8721b3abe3ecae475c1d6", R1: "09847f047e8e8e3294b54e26c8477c03b90d513fb3d6b42beff838fb29bc1a02", T1: "b3d46e1c67b4525166daf21cf556c2d0a129b408bbe38e344305ec25ef611056", A1: "afcc994051af2420715dc1140a995f3f8c139f2a2c767b57a98ae1a1fa81c307" },
  DRAW: { hash: h, link: link(h), deltaOildrop: DRAW_OILDROP.toString(), epoch: t.toString(), reserveDest: custodyAddr },
}, null, 2) + "\n");
console.log("DONE. DRAW submitted + out written.");
