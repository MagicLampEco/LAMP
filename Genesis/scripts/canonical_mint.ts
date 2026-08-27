// canonical_mint.ts — Canonical tLAMP mint→KHO(treasury.ak) trên Preprod (mô phỏng mainnet).
// Registry-gate (token_tag 4c414d50 → SinglePkh ví) + A-DEST ép tLAMP vào treasury.ak (kho vesting).
// Output kho KÈM TreasuryDatum để bước redeem (Distribution) nhả được. Ghi state ra canonical-state.json.
//
// Chạy: BEACON_NFT_POLICY=<pid 56 hex> NETWORK=Preprod tsx canonical_mint.ts
//   BEACON_NFT_POLICY bắt buộc — xem `requireBeaconPolicy()` bên dưới.
import {
  Data, Constr, fromText, toUnit, scriptFromNative, mintingPolicyToId,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash, applyParamsToScript,
  type Script, type Validator,
} from "@lucid-evolution/lucid";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORK, makeLucid, walletPkh, applyPolicy, policyId, rawValidator, explorerTx } from "./config.js";
import { supplyStateToCbor, mintRouteToCbor } from "../offchain/src/datum.js";
import { assertParamCount as assertParamCountGate } from "../offchain/src/applyGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPPLY_NAME = "535550504c59";
const TLAMP_NAME  = "744c414d50";                // tLAMP
const TOKEN_TAG   = "4c414d50";                  // token_tag (đã chốt)
const DIST_CAP    = 26370000000000000n;
const RESERVE_CAP = 9630000000000000n;
const REG_NAME = fromText("REG");
const KHO_NAME = fromText("KHO");
const MET_NAME = fromText("MET");
const MS_PER_EPOCH = 432000000n;
const DELTA = 10_000n * 1_000_000n;              // 10k tLAMP mint vào kho

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
 * VÌ SAO BẮT BUỘC: `applyParamsToScript` KHÔNG ném lỗi khi truyền THIẾU tham số. Nó áp một
 * phần rồi trả về script hash / policy id KHÁC, im lặng — TypeScript cũng không bắt được vì
 * tham số đi theo `unknown[]`. Bản cũ của file này truyền 6/8 cho claim_account và 3/6 cho
 * treasury ⇒ treAddr sai ⇒ 26,37 tỷ LAMP rót vào một địa chỉ KHÔNG validator nào mở được, mà
 * LAMP không burn được (`Treasury/CONTRACT.md §5`).
 *
 * Cổng sẵn có ở `config.ts::assertParamCount` chỉ tra blueprint của GENESIS và FAIL-OPEN với
 * code lạ (`if (!meta) return`); compiledCode Distribution rơi đúng khe fail-open đó. Nên
 * phải có bản FAIL-CLOSED tại chỗ, đọc `parameters` từ blueprint Distribution.
 * (Khuôn lấy từ `oneshot_cap_mint.ts::applyDist`.)
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

/**
 * beacon_nft_policy — FAIL-CLOSED, KHÔNG bịa.
 *
 * `beacon_nft` là one-shot theo `genesis_ref` (`Distribution/onchain/validators/beacon_nft.ak:42`).
 * Màn diễn này dùng marker native-sig, KHÔNG ghim UTxO genesis nào, và KHÔNG đúc beacon —
 * nên trong file này KHÔNG có dữ kiện để derive policy đó. Bản cũ nhét đại `nPid` vào khe
 * beacon_nft_policy: một giá trị vô nghĩa được nướng thẳng vào claim_account ⇒ claimHash ⇒
 * treHash ⇒ ĐỊA CHỈ KHO. Sai khe này là sai địa chỉ nhận tiền, im lặng.
 *
 * Vậy nên đòi giá trị THẬT từ ngoài: policy id của beacon_nft đã deploy (module Distribution).
 * `canonical_mint_resume.ts` đọc CÙNG biến này — hai file phải ra cùng treAddr, nếu không
 * resume sẽ rót LAMP vào một kho khác chỗ kho-NFT đang nằm.
 */
function requireBeaconPolicy(): string {
  const pid = (process.env.BEACON_NFT_POLICY ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{56}$/.test(pid)) {
    throw new Error(
      "BEACON_NFT_POLICY chưa set (phải là policy id 56 ký tự hex của beacon_nft đã deploy). " +
      "claim_account nhận beacon_nft_policy ở khe 6/8 và giá trị đó được nướng vào script ⇒ " +
      "quyết định claimHash ⇒ treHash ⇒ địa chỉ KHO. beacon_nft là one-shot theo genesis_ref " +
      "(beacon_nft.ak:42) mà script này không ghim genesis_ref nào, nên KHÔNG derive được — " +
      "không đoán. Lấy policy id từ lần deploy beacon_nft của Distribution rồi truyền vào đây " +
      "(canonical_mint_resume.ts phải dùng ĐÚNG giá trị này).",
    );
  }
  return pid;
}

async function main() {
  if (NETWORK !== "Preprod" && NETWORK !== "Preview") throw new Error(`CHẶN mạng: ${NETWORK}`);
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  console.log(`=== Canonical mint→kho (${NETWORK}) === pkh=${pkh}\n`);

  const native = scriptFromNative({ type: "sig", keyHash: pkh });
  const nPid = mintingPolicyToId(native);

  // lamp_mint 12-param → lamp_policy
  const lampMint = applyPolicy((await rawValidator("lamp_mint.lamp_mint.mint")).compiledCode, [
    nPid, SUPPLY_NAME, TLAMP_NAME, DIST_CAP, RESERVE_CAP,
    nPid, REG_NAME, TOKEN_TAG, nPid, KHO_NAME, nPid, MET_NAME,
  ]);
  const lampPid = policyId(lampMint);
  const lampUnit = toUnit(lampPid, TLAMP_NAME);

  // Distribution: claim_account → treasury(kho) — chia sẻ lampPid
  const committee = [pkh]; const threshold = 1n;

  // Ba policy NFT của Distribution — DERIVE từ nguồn, KHÔNG bịa (xem `applyDist` ở trên):
  //   • treasury_nft_policy = nPid — KHO NFT ở màn diễn này đúc dưới native policy nPid,
  //     và chính nó là NFT đánh dấu treasury.
  //   • account_nft_policy  = claim_account_nft(committee, threshold, treasury_nft_policy)
  //     (`claim_account_nft.ak:52-56`) — đủ dữ kiện, derive được.
  //   • beacon_nft_policy   — one-shot theo genesis_ref, KHÔNG derive được ở đây ⇒ fail-closed.
  const beaconPid = requireBeaconPolicy();
  const accountPid = policyId(await applyDist("claim_account_nft.claim_account_nft.mint",
    [committee, threshold, nPid]));

  // claim_account: 8 tham số (`claim_account.ak:23-35`) — committee, threshold, ms_per_epoch,
  // lamp_policy, lamp_name, beacon_nft_policy, treasury_nft_policy, account_nft_policy.
  const claimS: Validator = await applyDist("claim_account.claim_account.spend", [
    committee, threshold, MS_PER_EPOCH, lampPid, TLAMP_NAME, beaconPid, nPid, accountPid,
  ]);
  const claimHash = validatorToScriptHash(claimS);
  // treasury: 6 tham số (`treasury.ak:38-49`) — claim_account_hash, lamp_policy, lamp_name,
  // committee, threshold, account_nft_policy.
  const treS: Validator = await applyDist("treasury.treasury.spend", [
    claimHash, lampPid, TLAMP_NAME, committee, threshold, accountPid,
  ]);
  const treHash = validatorToScriptHash(treS);
  const treAddr = credentialToAddress(NETWORK, scriptHashToCredential(treHash));
  console.log(`lamp_policy: ${lampPid}\nKHO(treasury) addr: ${treAddr}\n`);

  const threadUnit = toUnit(nPid, SUPPLY_NAME);
  const regUnit = toUnit(nPid, REG_NAME);
  const khoUnit = toUnit(nPid, KHO_NAME);

  const ss0 = supplyStateToCbor({ dist_minted: 0n, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  const ss1 = supplyStateToCbor({ dist_minted: DELTA, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  // RegistryDatum Constr0[gov_did, [Entry Constr0[tag, Authority SinglePkh Constr0[pkh]]]]
  const regDatum = Data.to(new Constr(0, [fromText("did:phoenix:org:magiclamp"), [new Constr(0, [TOKEN_TAG, new Constr(0, [pkh])])]]));
  // TreasuryDatum Constr0[committee_hash]  (committee_hash = pkh, MVP self-committee)
  // TreasuryDatum có 2 trường (committee_hash, outstanding_entitlement) —
  // Distribution/onchain/lib/magiclamp/lampdist/types.ak:51-54. Ghi 1 trường thì
  // `expect out_datum: TreasuryDatum` hỏng ở MỌI nhánh treasury.spend ⇒ tLAMP vào kho
  // nằm chết, không nhánh nào rút ra được. outstanding_entitlement khởi tạo = 0 (chưa nợ ai).
  const treDatum = Data.to(new Constr(0, [pkh, 0n]));

  // ── Tx a: genesis — mint 3 marker + SupplyState/registry ở ví, kho-NFT tại treasury ──
  console.log("── a. genesis (markers + SupplyState + registry + kho-NFT@treasury) ──");
  const genTx = await lucid.newTx()
    .mintAssets({ [threadUnit]: 1n, [regUnit]: 1n, [khoUnit]: 1n })
    .attach.MintingPolicy(native)
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ss0 }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: regDatum }, { lovelace: 2_000_000n, [regUnit]: 1n })
    .pay.ToAddress(treAddr, { lovelace: 2_000_000n, [khoUnit]: 1n })   // kho-NFT tại treasury (ref marker, no datum)
    .complete();
  const gh = await (await genTx.sign.withWallet().complete()).submit();
  console.log(`   TX: ${gh}\n   ${explorerTx(gh)}`); await lucid.awaitTx(gh); await sleep(20_000);

  const atWallet = await lucid.utxosAt(walletAddr);
  const ssU = atWallet.find((u) => (u.assets[threadUnit] ?? 0n) === 1n)!;
  const regU = atWallet.find((u) => (u.assets[regUnit] ?? 0n) === 1n)!;
  const khoU = (await lucid.utxosAt(treAddr)).find((u) => (u.assets[khoUnit] ?? 0n) === 1n)!;
  if (!ssU || !regU || !khoU) throw new Error("không resolve genesis UTxO");

  // ── Tx b: mint DistributionVest → tLAMP vào kho (treasury) KÈM TreasuryDatum ──
  console.log("\n── b. mint DistributionVest → KHO ──");
  const mintTx = await lucid.newTx()
    .collectFrom([ssU])
    .mintAssets({ [lampUnit]: DELTA }, mintRouteToCbor("DistributionVest"))
    .attach.MintingPolicy(lampMint)
    .readFrom([regU, khoU])
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ss1 }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: DELTA })
    .addSigner(walletAddr)
    .complete();
  const mh = await (await mintTx.sign.withWallet().complete()).submit();
  console.log(`   TX: ${mh}\n   ${explorerTx(mh)}`); await lucid.awaitTx(mh); await sleep(20_000);

  const khoLamp = (await lucid.utxosAt(treAddr)).reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  console.log(`   ✓ KHO giữ ${khoLamp / 1_000_000n} tLAMP (mong đợi ${DELTA / 1_000_000n})`);
  if (khoLamp < DELTA) throw new Error("A-DEST FAIL: tLAMP không vào kho");

  // Ghi cả ba policy NFT: thiếu một cái là không ai dựng lại được treAddr này về sau.
  const state = { network: NETWORK, nPid, lampPid, lampUnit, treHash, treAddr, claimHash, distNftPolicies: { beacon: beaconPid, treasury: nPid, account: accountPid }, committee, threshold: Number(threshold), msPerEpoch: MS_PER_EPOCH.toString(), delta: DELTA.toString(), genesisTx: gh, mintTx: mh, treDatum, committeeHash: pkh };
  await writeFile(resolve(__dirname, "canonical-state.json"), JSON.stringify(state, null, 2) + "\n");
  console.log(`\n✅ Canonical mint→kho xong. State → canonical-state.json`);
}
main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
