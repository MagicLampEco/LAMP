// oneshot_cap_mint.ts — ĐÚC TRỌN QUOTA DISTRIBUTION TRONG ĐÚNG MỘT GIAO DỊCH, rồi
// CHỨNG MINH cổng đã chết bằng cách CỐ TÌNH đúc thêm và để chain từ chối.
//
// Điều kiện anh chốt 2026-08-18:
//   (1) BẮT BUỘC — đúc một lần chạm cap ⇒ cổng chết ⇒ xoay khoá OrgDID bao nhiêu
//       lần cũng không ảnh hưởng.
//   (2) Không để registry sống mãi.
//   (3) Tổng cung 36 tỷ — KHÔNG hạ.
//
// Khác canonical_mint.ts ở ba chỗ, và ba chỗ đó là toàn bộ lý do file này tồn tại:
//   • DELTA = TRỌN dist_cap (26,37 tỷ LAMP), không phải 10k tượng trưng.
//   • Có bước d: dựng tx đúc thêm 1 oildrop — tx này PHẢI hỏng. Script chỉ báo
//     THÀNH CÔNG khi nó hỏng. Đúc được thêm = cổng chưa chết = chạy mainnet là sai.
//   • Có bước e: thu hồi Registry NFT, rồi cho thấy registry sống hay chết KHÔNG
//     đổi kết quả — cổng đã chết vì số học.
//
// SỬA 2026-08-19 — LỖI NẶNG ở bản đầu, phải nói rõ vì nó phá cả cap:
//   Bản đầu (và canonical_mint.ts, canonical_compute.ts) dùng `scriptFromNative sig`
//   cho cả bốn marker NFT. Native-sig KHÔNG one-shot ⇒ người cầm khoá đúc được SUPPLY
//   NFT THỨ HAI bất cứ lúc nào ⇒ dựng SupplyState mới với dist_minted = 0 ⇒ đúc lại
//   TRỌN 26,37 tỷ. Cổng cũ chết, nhưng mở được cổng mới y hệt — nên "đúc trọn cap rồi
//   khoá vô tác dụng" là SAI với cách nối đó. `lamp_mint.ak:88-89` đã ghi rõ an toàn
//   dựa vào "thread_nft param genesis_ref", nhưng không script deploy nào làm theo.
//   Nay cả bốn marker dùng `oneshot_nft` (param genesis_ref + asset_name), CÙNG buộc
//   vào MỘT UTxO genesis ⇒ bốn policy-id khác nhau, cả bốn đúc gọn trong đúng một
//   giao dịch, và không policy nào chạy được lần thứ hai.
//
// 9,63 tỷ Reserve KHÔNG đi đường này. Nó ở lại quota ReserveDraw — nhánh không
// đọc registry, không đòi chữ ký, bị reserve_draw ép trần E/1000 mỗi epoch.
// Cổng Distribution chết KHÔNG kéo Reserve chết theo (test
// `reserve_alive_after_dist_gate_dead` ở lamp_mint.ak chứng minh ở tầng validator).

import {
  Data, Constr, fromText, toUnit, mintingPolicyToId,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash, applyParamsToScript,
  type Script, type Validator, type MintingPolicy, type UTxO,
} from "@lucid-evolution/lucid";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NETWORK, makeLucid, walletPkh, applyPolicy, applyValidator, policyId, scriptAddress,
  rawValidator, explorerTx,
} from "./config.js";
import { supplyStateToCbor, mintRouteToCbor, supplyStateRedeemerToCbor } from "../offchain/src/datum.js";
import { assertParamCount as assertParamCountGate } from "../offchain/src/applyGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPPLY_NAME = "535550504c59";
const TLAMP_NAME  = "744c414d50";
const TOKEN_TAG   = "4c414d50";
const DIST_CAP    = 26_370_000_000_000_000n;   // 26,37 tỷ LAMP × 10^6 oildrop
const RESERVE_CAP =  9_630_000_000_000_000n;   //  9,63 tỷ — KHÔNG đúc ở đây
const TOTAL_CAP   = DIST_CAP + RESERVE_CAP;    // 36 tỷ, bất biến
const REG_NAME = fromText("REG");
const KHO_NAME = fromText("KHO");
const MET_NAME = fromText("MET");
// ms mỗi epoch — PHẢI theo mạng, không nướng cứng. Dòng chặn mạng bên dưới cho phép CẢ
// Preview, mà Preview có epoch 1 ngày (86 400 000 ms) chứ không phải 5 ngày. Số này đi vào
// `ReserveState.start_epoch/last_epoch` VÀ vào apply-param của `claim_account` — tức nó bị
// nướng vào script hash, sai là sai vĩnh viễn. Fail-closed với mạng lạ.
const MS_PER_EPOCH_BY_NETWORK: Record<string, bigint> = {
  Mainnet: 432_000_000n,
  Preprod: 432_000_000n,
  Preview:  86_400_000n,
};
const MS_PER_EPOCH = (() => {
  const v = MS_PER_EPOCH_BY_NETWORK[NETWORK];
  if (v === undefined) {
    throw new Error(
      `EPOCH-001: không biết ms/epoch của mạng '${NETWORK}'. Số này nướng vào apply-param của ` +
      `claim_account ⇒ sai thì ra script hash khác, im lặng, không sửa được sau khi gửi.`,
    );
  }
  return v;
})();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type DistRaw = { title: string; compiledCode: string; parameters?: unknown[] };

let distBlueprint: DistRaw[] | undefined;
async function distValidators(): Promise<DistRaw[]> {
  if (!distBlueprint) {
    const bp = JSON.parse(await readFile(resolve(__dirname, "../../Distribution/onchain/plutus.json"), "utf8"));
    distBlueprint = bp.validators as DistRaw[];
  }
  return distBlueprint;
}

/**
 * Áp tham số cho validator Distribution, ÉP ĐÚNG số tham số blueprint khai (APPLY-001).
 *
 * VÌ SAO CỔNG NÀY BẮT BUỘC: `applyParamsToScript` KHÔNG ném lỗi khi truyền thiếu tham số.
 * Nó áp một phần rồi trả về một script hash / policy id KHÁC, im lặng. TypeScript cũng
 * không bắt được vì tham số đi theo `unknown[]`. Thiếu tham số chỉ lộ ra khi tiền đã nằm
 * ở địa chỉ không ai mở được.
 *
 * Cổng sẵn có ở `config.ts::assertParamCount` chỉ tra được blueprint của GENESIS
 * (`paramCountByCode` nạp từ `Genesis/onchain/plutus.json`) và FAIL-OPEN với code lạ
 * (`if (!meta) return`). compiledCode của Distribution rơi đúng vào khe fail-open đó,
 * nên phải có bản FAIL-CLOSED tại chỗ, đọc `parameters` từ blueprint của Distribution.
 */
async function applyDist(title: string, params: unknown[]): Promise<Script> {
  const v = (await distValidators()).find((x) => x.title === title);
  if (!v) throw new Error(`Distribution '${title}' không có trong plutus.json`);
  // FAIL-CLOSED: blueprint không khai `parameters` → KHÔNG coi là 0, dừng ngay.
  if (!Array.isArray(v.parameters)) {
    throw new Error(
      `APPLY-001: blueprint KHÔNG khai 'parameters' cho '${title}' — không suy đoán số tham số. ` +
      `Chạy lại 'aiken build' trong Distribution/onchain/ rồi thử lại.`,
    );
  }
  assertParamCountGate(title, v.parameters.length, params.length);
  return { type: "PlutusV3", script: applyParamsToScript(v.compiledCode, params as never) };
}

/** Dựng tx và mong nó HỎNG. Trả về thông điệp lỗi. Dựng được = hỏng cả kế hoạch. */
async function mustFail(label: string, build: () => Promise<unknown>): Promise<string> {
  try {
    await build();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`   ✓ ${label} — bị TỪ CHỐI đúng như phải thế`);
    console.log(`     lý do: ${msg.slice(0, 300).replace(/\s+/g, " ")}`);
    return msg;
  }
  throw new Error(
    `🔴 ${label} DỰNG ĐƯỢC. Cổng CHƯA chết — điều kiện bắt buộc của anh KHÔNG thoả. ` +
    `TUYỆT ĐỐI không chạy bản này lên mainnet.`,
  );
}

async function main() {
  if (NETWORK !== "Preprod" && NETWORK !== "Preview") throw new Error(`CHẶN mạng: ${NETWORK}`);
  if (DIST_CAP + RESERVE_CAP !== 36_000_000_000_000_000n) throw new Error("tổng cap ≠ 36 tỷ");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  console.log(`=== ĐÚC TRỌN CAP MỘT LƯỢT + CHỨNG MINH CỔNG CHẾT (${NETWORK}) ===`);
  console.log(`ví deploy: ${walletAddr}\npkh: ${pkh}\n`);

  // ── Bốn marker one-shot, CÙNG buộc vào MỘT UTxO genesis ──
  // UTxO đó tiêu đúng một lần trong lịch sử chain ⇒ mỗi policy chạy đúng một lần.
  // asset_name là param nên bốn tên khác nhau ⇒ bốn policy-id khác nhau.
  const wUtxos = await lucid.utxosAt(walletAddr);
  const seed: UTxO | undefined = wUtxos.sort((a, b) =>
    Number((b.assets.lovelace ?? 0n) - (a.assets.lovelace ?? 0n)))[0];
  if (!seed) throw new Error("ví rỗng — không có UTxO nào làm genesis_ref");
  const genesisRef = new Constr(0, [seed.txHash, BigInt(seed.outputIndex)]);
  console.log(`UTxO genesis (one-shot): ${seed.txHash}#${seed.outputIndex}\n`);

  const oneshotCode = (await rawValidator("oneshot_nft.oneshot_nft.mint")).compiledCode;
  const mkOneshot = (name: string): MintingPolicy =>
    applyPolicy(oneshotCode, [genesisRef, name]);
  const supplyPol = mkOneshot(SUPPLY_NAME);
  const regPol = mkOneshot(REG_NAME);
  const khoPol = mkOneshot(KHO_NAME);
  const metPol = mkOneshot(MET_NAME);
  const supplyPid = policyId(supplyPol);
  const regPid = policyId(regPol);
  const khoPid = policyId(khoPol);
  const metPid = policyId(metPol);

  const lampMint = applyPolicy((await rawValidator("lamp_mint.lamp_mint.mint")).compiledCode, [
    supplyPid, SUPPLY_NAME, TLAMP_NAME, DIST_CAP, RESERVE_CAP,
    regPid, REG_NAME, TOKEN_TAG, khoPid, KHO_NAME, metPid, MET_NAME,
  ]);
  const lampPid = policyId(lampMint);
  const lampUnit = toUnit(lampPid, TLAMP_NAME);

  // ⚠ PREPROD-ONLY — "M-of-N" ở đây là GIẢ: 1-of-1 với CHÍNH khoá đang ký giao dịch này.
  //   Không có tách quyền nào cả; mất một khoá là mất tất cả. Cố ý để vậy vì thứ diễn tập
  //   này cần chứng minh là CỔNG SỐ HỌC (cap), không phải cổng chữ ký.
  //   TUYỆT ĐỐI KHÔNG chép cặp giá trị này sang mainnet. Mainnet phải là M-of-N thật, N khoá
  //   do N người khác nhau giữ. Cap không cứu được một committee 1-of-1 bị lộ khoá.
  const committee = [pkh]; const threshold = 1n;

  // Ba policy NFT của Distribution — DERIVE từ nguồn, KHÔNG bịa, vì thiếu/sai một cái là
  // claimHash/treHash lệch mà không ai báo (xem `applyDist` ở trên).
  //   • treasury_nft_policy = khoPid — KHO NFT ở trên CHÍNH LÀ NFT đánh dấu treasury.
  //   • beacon_nft_policy   — one-shot theo genesis_ref (`beacon_nft.ak:42`).
  //   • account_nft_policy  — claim_account_nft(committee, threshold, treasury_nft_policy)
  //                           (`claim_account_nft.ak:52-56`).
  // RANH GIỚI: diễn tập này KHÔNG đúc beacon NFT (seed tiêu hết ở tx a) ⇒ đường Claim/Redeem
  // không chạy được sau đó. Chấp nhận được: script này chứng minh cổng mint Distribution
  // chết + A-DEST, không diễn vòng đời vesting.
  const beaconPol = await applyDist("beacon_nft.beacon_nft.mint", [genesisRef]);
  const beaconPid = policyId(beaconPol);
  const accountPol = await applyDist("claim_account_nft.claim_account_nft.mint", [committee, threshold, khoPid]);
  const accountPid = policyId(accountPol);

  // claim_account: 8 tham số (`claim_account.ak:23-35`) — committee, threshold, ms_per_epoch,
  // lamp_policy, lamp_name, beacon_nft_policy, treasury_nft_policy, account_nft_policy.
  const claimS: Validator = await applyDist("claim_account.claim_account.spend", [
    committee, threshold, MS_PER_EPOCH, lampPid, TLAMP_NAME, beaconPid, khoPid, accountPid,
  ]);
  const claimHash = validatorToScriptHash(claimS);
  // treasury: 6 tham số (`treasury.ak:38-49`) — claim_account_hash, lamp_policy, lamp_name,
  // committee, threshold, account_nft_policy.
  const treS: Validator = await applyDist("treasury.treasury.spend", [
    claimHash, lampPid, TLAMP_NAME, committee, threshold, accountPid,
  ]);
  const treHash = validatorToScriptHash(treS);
  const treAddr = credentialToAddress(NETWORK, scriptHashToCredential(treHash));

  console.log(`lamp_policy: ${lampPid}`);
  console.log(`KHO (treasury.ak): ${treAddr}`);
  console.log(`cap: dist ${DIST_CAP} + reserve ${RESERVE_CAP} = ${TOTAL_CAP} oildrop (36 tỷ LAMP)\n`);

  // 🔴 REG nằm ở ĐỊA CHỈ SCRIPT của `oneshot_nft` — mà `oneshot_nft` KHÔNG có nhánh `spend`
  // (`oneshot_nft.ak:32` chỉ có `mint`, `:42` là `else(_) { fail }`). Nghĩa là UTxO registry
  // này **không bao giờ tiêu được**. Đọc làm reference input thì vẫn chạy, nên cổng WHO của
  // `lamp_mint` vẫn đúng — nhưng lời hứa ở `lamp_mint.ak` ("xoay khoá vận hành = sửa entry
  // registry, KHÔNG phải redeploy") thì CHẾT trong lượt deploy này.
  //
  // Ở đây là CỐ Ý và vô hại: lượt này đúc trọn cap trong đúng một tx ⇒ nhánh DistributionVest
  // chết ngay sau đó ⇒ không còn gì để xoay khoá cho. Dòng chặn mạng ở trên đã cấm Mainnet.
  //
  // ĐỪNG CHÉP CÁCH NÀY SANG MAINNET. `registry.ak:137-138` đòi `Registry-NFT policy ≡ registry
  // script hash`, và `:148-150` ép carrier nằm ở `Script(policy)` — nên REG mainnet phải do
  // CHÍNH validator `registry` đúc, không phải do `oneshot_nft`.
  const regAddr = credentialToAddress(NETWORK, scriptHashToCredential(regPid));
  const threadUnit = toUnit(supplyPid, SUPPLY_NAME);
  const regUnit = toUnit(regPid, REG_NAME);
  const khoUnit = toUnit(khoPid, KHO_NAME);
  const metUnit = toUnit(metPid, MET_NAME);
  console.log(`marker one-shot: SUPPLY ${supplyPid}\n                 REG    ${regPid}\n                 KHO    ${khoPid}\n                 MET    ${metPid}\n`);

  // ── Tầng 3: supply_state — NƠI SupplyState UTxO BẮT BUỘC NGỒI ──
  // apply(lamp_policy, thread_nft_policy, token_name) — 3 tham số, `supply_state.ak:25-29`.
  // VÌ SAO KHÔNG ĐƯỢC ĐỂ Ở VÍ: trần phân phối nằm TRONG datum SupplyState. Datum ngồi ở địa
  // chỉ VÍ thì KHÔNG validator nào canh nó — chủ ví tự viết lại dist_minted về 0 rồi đúc trọn
  // 26,37 tỷ lần nữa, và cả màn "cổng chết" ở bước d chỉ là diễn. Ngồi ở script này thì mỗi
  // lần tiêu SupplyState đều buộc kèm mint LAMP (Δ>0) ⇒ lamp_mint LUÔN chạy ⇒ transition LUÔN
  // bị kiểm. Cap chỉ có nghĩa từ đây.
  const ssScript: Validator = applyValidator(
    (await rawValidator("supply_state.supply_state.spend")).compiledCode,
    [lampPid, supplyPid, TLAMP_NAME],
  );
  const ssAddr = scriptAddress(ssScript);
  console.log(`supply_state addr: ${ssAddr}`);

  // ── MET (meter NFT) — CŨNG KHÔNG ĐƯỢC Ở VÍ ──
  // Nhánh ReserveDraw của lamp_mint KHÔNG đòi chữ ký. Nó chỉ đòi tx SPEND đúng 1 UTxO mang
  // meter NFT (`lamp_mint.ak:214-218`). Cái ép nhịp δ ≤ E/1000 là validator NGỒI DƯỚI UTxO đó:
  // reserve_draw (`reserve_draw.ak:44-54`; orchestrator chốt meter_nft = reserve_thread, xem
  // `reserve_thread.ak:10-18`). MET nằm ở ví ⇒ chủ ví tự tiêu nó ⇒ KHÔNG validator nào chạy
  // ⇒ rút trọn 9,63 tỷ Reserve trong đúng một giao dịch. Nên MET phải hạ cánh ở reserve_draw.
  //
  // Script này KHÔNG tự dựng được reserve_draw: 9 tham số của nó gồm reserve_dest,
  // treasury_auth_policy/name và gate_script_hash (reserve_gate của Treasury,
  // `Treasury/onchain/validators/reserve_gate.ak:55-62`) — chưa nơi nào trong repo chốt giá
  // trị. FAIL-CLOSED: đòi RESERVE_DRAW_HASH, thiếu thì DỪNG, KHÔNG rơi ngược về ví.
  const reserveDrawHash = (process.env.RESERVE_DRAW_HASH ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{56}$/.test(reserveDrawHash)) {
    throw new Error(
      "RESERVE_DRAW_HASH chưa set (phải là script hash 56 ký tự hex của reserve_draw). " +
      "MET = meter NFT: nhánh ReserveDraw của lamp_mint KHÔNG đòi chữ ký, chỉ đòi spend 1 UTxO " +
      "mang MET. Rót MET về ví = tự tay mở đường rút trọn 9,63 tỷ Reserve. Deploy reserve_draw " +
      "(module Reserve) trước, rồi truyền script hash của nó vào biến môi trường này.",
    );
  }
  const meterAddr = credentialToAddress(NETWORK, scriptHashToCredential(reserveDrawHash));
  console.log(`meter (reserve_draw) addr: ${meterAddr}\n`);

  // ReserveState kèm MET — thiếu inline datum thì UTxO đó KHÔNG spend nổi
  // (`reserve_draw.ak` đọc `expect s: ReserveState = util.inline_datum(own_out)`) và 9,63 tỷ
  // Reserve chết cứng. Constr(0, [start_epoch, total_oildrop, drawn_oildrop, last_epoch])
  // theo `Reserve/onchain/lib/magiclamp/reserve/types.ak:19-24`.
  // last_epoch = epoch hiện tại ⇒ draw đầu tiên sớm nhất là epoch kế (luật t > last_epoch).
  const nowEpoch = BigInt(Date.now()) / MS_PER_EPOCH;
  const reserveStateDatum = Data.to(new Constr(0, [nowEpoch, RESERVE_CAP, 0n, nowEpoch]));

  const ssFresh = supplyStateToCbor({ dist_minted: 0n, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  const ssFull  = supplyStateToCbor({ dist_minted: DIST_CAP, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  const regDatum = Data.to(new Constr(0, [fromText("did:phoenix:org:greensun"), [new Constr(0, [TOKEN_TAG, new Constr(0, [pkh])])]]));
  // TreasuryDatum = Constr(0, [committee_hash: ByteArray, outstanding_entitlement: Int]) —
  // HAI trường (`Distribution/onchain/lib/magiclamp/lampdist/types.ak:51-53`, mirror offchain
  // `Distribution/offchain/src/datum.ts:178-181`). Bản cũ chỉ có 1 trường: kho nhận trọn
  // 26,37 tỷ với datum KHÔNG decode được ⇒ `expect out_datum: TreasuryDatum` hỏng ở MỌI nhánh
  // của treasury.spend ⇒ toàn bộ số đó nằm chết tại địa chỉ script (LAMP không burn được).
  // outstanding_entitlement = 0 vì chưa cấp entitlement cho ai.
  const treDatum = Data.to(new Constr(0, [pkh, 0n]));

  // ── a. genesis: 4 marker NFT + SupplyState trắng + registry + kho-NFT@treasury ──
  console.log("── a. genesis (4 marker + SupplyState + registry + kho-NFT) ──");
  const genTx = await lucid.newTx()
    .collectFrom([seed])                       // TIÊU UTxO genesis → mở one-shot đúng 1 lần
    .mintAssets({ [threadUnit]: 1n }, Data.void()).attach.MintingPolicy(supplyPol)
    .mintAssets({ [regUnit]: 1n }, Data.void()).attach.MintingPolicy(regPol)
    .mintAssets({ [khoUnit]: 1n }, Data.void()).attach.MintingPolicy(khoPol)
    .mintAssets({ [metUnit]: 1n }, Data.void()).attach.MintingPolicy(metPol)
    // SupplyState → ĐỊA CHỈ SCRIPT supply_state, KHÔNG phải ví (xem ghi chú ở ssScript).
    .pay.ToAddressWithData(ssAddr, { kind: "inline", value: ssFresh }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    // Registry NFT PHẢI nằm ở địa chỉ script == chính policy của nó (`registry.ak:148`),
    // không phải ví. Và `oneshot_nft` có `else(_) { fail }` nên UTxO đó KHÔNG tiêu được:
    // registry đóng băng ngay từ lúc sinh — không ai viết lại authority, kể cả anh.
    .pay.ToAddressWithData(regAddr, { kind: "inline", value: regDatum }, { lovelace: 2_000_000n, [regUnit]: 1n })
    .pay.ToAddress(treAddr, { lovelace: 2_000_000n, [khoUnit]: 1n })
    // MET → reserve_draw kèm ReserveState, KHÔNG phải ví (xem ghi chú ở meterAddr).
    .pay.ToAddressWithData(meterAddr, { kind: "inline", value: reserveStateDatum }, { lovelace: 2_000_000n, [metUnit]: 1n })
    .complete();
  const gh = await (await genTx.sign.withWallet().complete()).submit();
  console.log(`   TX: ${gh}\n   ${explorerTx(gh)}`); await lucid.awaitTx(gh); await sleep(20_000);

  const findAt = async (addr: string, unit: string) =>
    (await lucid.utxosAt(addr)).find((u) => (u.assets[unit] ?? 0n) === 1n);
  let ssU = await findAt(ssAddr, threadUnit);
  const regU = await findAt(regAddr, regUnit);
  const khoU = await findAt(treAddr, khoUnit);
  if (!ssU || !regU || !khoU) throw new Error("không resolve được UTxO genesis");

  // ── b. ĐÚC TRỌN 26,37 TỶ TRONG ĐÚNG MỘT GIAO DỊCH ──
  console.log(`\n── b. đúc TRỌN ${DIST_CAP / 1_000_000n} tLAMP trong MỘT tx → KHO ──`);
  const mintTx = await lucid.newTx()
    .collectFrom([ssU], supplyStateRedeemerToCbor())   // Advance — SupplyState nay ở SCRIPT
    .attach.SpendingValidator(ssScript)
    .mintAssets({ [lampUnit]: DIST_CAP }, mintRouteToCbor("DistributionVest"))
    .attach.MintingPolicy(lampMint)
    .readFrom([regU, khoU])
    .pay.ToAddressWithData(ssAddr, { kind: "inline", value: ssFull }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: DIST_CAP })
    .addSigner(walletAddr)
    .complete();
  const mh = await (await mintTx.sign.withWallet().complete()).submit();
  console.log(`   TX: ${mh}\n   ${explorerTx(mh)}`); await lucid.awaitTx(mh); await sleep(20_000);

  const khoLamp = (await lucid.utxosAt(treAddr)).reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  console.log(`   KHO giữ ${khoLamp} oildrop (mong đợi ${DIST_CAP})`);
  if (khoLamp !== DIST_CAP) throw new Error(`A-DEST FAIL: kho giữ ${khoLamp} ≠ ${DIST_CAP}`);
  console.log(`   ✓ trọn quota Distribution nằm trong kho, đúng MỘT giao dịch`);

  // ── c. sổ on-chain đã chạm cap ──
  ssU = await findAt(ssAddr, threadUnit);
  if (!ssU) throw new Error("mất SupplyState sau khi đúc");
  console.log(`\n── c. SupplyState on-chain: dist_minted == dist_cap ──`);
  console.log(`   datum: ${ssU.datum}`);

  // ── d. CỔNG CHẾT — ba đường thử, cả ba PHẢI hỏng ──
  console.log(`\n── d. cố tình đúc thêm — cả ba đường PHẢI bị từ chối ──`);
  const ssOver = supplyStateToCbor({ dist_minted: DIST_CAP + 1n, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  const rejects: Record<string, string> = {};

  rejects.plus_one = await mustFail("d1. đúc thêm 1 oildrop, khoá vận hành ký đúng", () =>
    lucid.newTx()
      .collectFrom([ssU!], supplyStateRedeemerToCbor())
      .attach.SpendingValidator(ssScript)
      .mintAssets({ [lampUnit]: 1n }, mintRouteToCbor("DistributionVest"))
      .attach.MintingPolicy(lampMint)
      .readFrom([regU, khoU])
      .pay.ToAddressWithData(ssAddr, { kind: "inline", value: ssOver }, { lovelace: 2_000_000n, [threadUnit]: 1n })
      .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: 1n })
      .addSigner(walletAddr)
      .complete());

  rejects.unbooked = await mustFail("d2. đúc thêm mà KHÔNG ghi sổ (giữ nguyên dist_minted)", () =>
    lucid.newTx()
      .collectFrom([ssU!], supplyStateRedeemerToCbor())
      .attach.SpendingValidator(ssScript)
      .mintAssets({ [lampUnit]: 1_000_000n }, mintRouteToCbor("DistributionVest"))
      .attach.MintingPolicy(lampMint)
      .readFrom([regU, khoU])
      .pay.ToAddressWithData(ssAddr, { kind: "inline", value: ssFull }, { lovelace: 2_000_000n, [threadUnit]: 1n })
      .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: 1_000_000n })
      .addSigner(walletAddr)
      .complete());

  const ssRollback = supplyStateToCbor({ dist_minted: DIST_CAP - 1_000_000n, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  rejects.rollback = await mustFail("d3. quay ngược sổ để mở lại quota", () =>
    lucid.newTx()
      .collectFrom([ssU!], supplyStateRedeemerToCbor())
      .attach.SpendingValidator(ssScript)
      .mintAssets({ [lampUnit]: 1_000_000n }, mintRouteToCbor("DistributionVest"))
      .attach.MintingPolicy(lampMint)
      .readFrom([regU, khoU])
      .pay.ToAddressWithData(ssAddr, { kind: "inline", value: ssRollback }, { lovelace: 2_000_000n, [threadUnit]: 1n })
      .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: 1_000_000n })
      .addSigner(walletAddr)
      .complete());

  // ── e. KHOÁ CÒN LÀM ĐƯỢC GÌ? — thử đúc SUPPLY NFT THỨ HAI ──
  // Đây là câu hỏi thật: cổng chết rồi thì người cầm seed có dựng được SupplyState
  // MỚI (dist_minted=0) để đúc lại trọn cap không. Chỉ one-shot mới trả lời được KHÔNG.
  console.log(`\n── e. thử đúc SUPPLY NFT thứ hai (đường phá cap) ──`);
  rejects.second_supply_nft = await mustFail(
    "e1. đúc SUPPLY NFT thứ hai để dựng SupplyState mới",
    () => lucid.newTx()
      .mintAssets({ [threadUnit]: 1n }, Data.void())
      .attach.MintingPolicy(supplyPol)
      .pay.ToAddress(walletAddr, { lovelace: 2_000_000n, [threadUnit]: 1n })
      .complete());
  console.log(`   ⟹ UTxO genesis đã tiêu, policy one-shot không chạy lần hai được.`);
  console.log(`      Không dựng nổi SupplyState thứ hai ⇒ cap 36 tỷ đứng vững.`);

  const state = {
    network: NETWORK,
    genesisSeedUtxo: `${seed.txHash}#${seed.outputIndex}`,
    markerPolicies: { supply: supplyPid, registry: regPid, kho: khoPid, meter: metPid },
    distNftPolicies: { beacon: beaconPid, treasury: khoPid, account: accountPid },
    lampPid, lampUnit, treHash, treAddr, claimHash,
    supplyStateAddr: ssAddr, meterAddr, reserveDrawHash,
    distCap: DIST_CAP.toString(), reserveCap: RESERVE_CAP.toString(), totalCap: TOTAL_CAP.toString(),
    genesisTx: gh, oneshotMintTx: mh,
    khoHolds: khoLamp.toString(), supplyStateDatum: ssU.datum, gateDeathRejects: rejects,
  };
  await writeFile(resolve(__dirname, "oneshot-cap-state.json"), JSON.stringify(state, null, 2) + "\n");

  console.log(`\n✅ XONG:`);
  console.log(`   • ${DIST_CAP / 1_000_000n} tLAMP đúc trong ĐÚNG một giao dịch, toàn bộ vào kho`);
  console.log(`   • ba đường đúc thêm đều bị chain từ chối — cổng chết`);
  console.log(`   • không đúc nổi SUPPLY NFT thứ hai — không dựng lại được cổng`);
  console.log(`   • 9,63 tỷ Reserve còn nguyên quota, đi đường ReserveDraw không chữ ký`);
  console.log(`   state → oneshot-cap-state.json`);
}
main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
