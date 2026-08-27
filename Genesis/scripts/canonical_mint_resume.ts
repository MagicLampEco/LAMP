// canonical_mint_resume.ts — RESUME bước b (DistributionVest → KHO) khi genesis (bước a)
// đã chạy nhưng mint fail. Dùng ĐÚNG outref của genesis tx (thread ss0 sạch) thay vì
// .find() (tránh vớ phải thread ô nhiễm dist_minted≠0 trên mạng đã genesis nhiều lần).
//
// Chặn coin-selection vớ marker: nạp tay [ss0, fundUtxo(ADA thuần)] → inputs chỉ 1 thread.
//
// Chạy: GENESIS_TX=<hash> BEACON_NFT_POLICY=<pid> NETWORK=Preview SUBMIT=true tsx canonical_mint_resume.ts
//   BEACON_NFT_POLICY phải TRÙNG giá trị bước a đã dùng (canonical-state.json →
//   distNftPolicies.beacon) — lệch một ký tự là treAddr khác, rót tLAMP vào chỗ chết.
import {
  Data, Constr, fromText, toUnit, scriptFromNative, mintingPolicyToId,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash, applyParamsToScript,
  type Script, type Validator,
} from "@lucid-evolution/lucid";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORK, makeLucid, walletPkh, applyPolicy, policyId, rawValidator, explorerTx, SUBMIT } from "./config.js";
import { supplyStateToCbor, mintRouteToCbor } from "../offchain/src/datum.js";
import { assertParamCount as assertParamCountGate } from "../offchain/src/applyGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPPLY_NAME = "535550504c59", TLAMP_NAME = "744c414d50", TOKEN_TAG = "4c414d50";
const DIST_CAP = 26370000000000000n, RESERVE_CAP = 9630000000000000n;
const REG_NAME = fromText("REG"), KHO_NAME = fromText("KHO"), MET_NAME = fromText("MET");
const MS_PER_EPOCH = 432000000n, DELTA = 10_000n * 1_000_000n;

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
 * VÌ SAO BẮT BUỘC: `applyParamsToScript` KHÔNG ném lỗi khi truyền THIẾU tham số — nó áp một
 * phần rồi trả về script hash KHÁC, im lặng. Bản cũ của file này truyền 6/8 cho claim_account
 * và 3/6 cho treasury ⇒ treAddr sai. Ở đường RESUME cái sai đó còn độc hơn ở
 * `canonical_mint.ts`: kho-NFT đã nằm sẵn tại treAddr ĐÚNG từ bước a, resume tính ra treAddr
 * KHÁC thì rót tLAMP vào một địa chỉ không ai mở được (LAMP không burn được —
 * `Treasury/CONTRACT.md §5`).
 *
 * `config.ts::assertParamCount` chỉ tra blueprint GENESIS và FAIL-OPEN với code lạ, nên phải
 * có bản FAIL-CLOSED tại chỗ. (Khuôn lấy từ `oneshot_cap_mint.ts::applyDist`.)
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
 * beacon_nft_policy — FAIL-CLOSED, KHÔNG bịa. Xem lý do đầy đủ ở `canonical_mint.ts`.
 *
 * Ở đây có thêm một ràng buộc: bước a đã chạy rồi, kho-NFT đang nằm tại treAddr mà
 * `canonical_mint.ts` tính ra. Resume PHẢI truyền ĐÚNG giá trị BEACON_NFT_POLICY mà bước a
 * đã dùng, nếu không treAddr lệch và script sẽ dừng ở "không thấy kho-NFT tại ...".
 * Giá trị đó nằm trong `canonical-state.json` (`distNftPolicies.beacon`).
 */
function requireBeaconPolicy(): string {
  const pid = (process.env.BEACON_NFT_POLICY ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{56}$/.test(pid)) {
    throw new Error(
      "BEACON_NFT_POLICY chưa set (policy id 56 ký tự hex của beacon_nft). Nó là khe 6/8 của " +
      "claim_account, được nướng vào script ⇒ claimHash ⇒ treHash ⇒ địa chỉ KHO. beacon_nft là " +
      "one-shot theo genesis_ref (beacon_nft.ak:42) mà script này không có genesis_ref, nên " +
      "KHÔNG derive được — không đoán. Dùng ĐÚNG giá trị bước a đã dùng " +
      "(canonical-state.json → distNftPolicies.beacon).",
    );
  }
  return pid;
}

async function main() {
  const genesisTx = (process.env.GENESIS_TX ?? "").trim();
  if (!genesisTx) throw new Error("thiếu GENESIS_TX=<hash bước a>");
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  const native = scriptFromNative({ type: "sig", keyHash: pkh });
  const nPid = mintingPolicyToId(native);

  const lampMint = applyPolicy((await rawValidator("lamp_mint.lamp_mint.mint")).compiledCode,
    [nPid, SUPPLY_NAME, TLAMP_NAME, DIST_CAP, RESERVE_CAP, nPid, REG_NAME, TOKEN_TAG, nPid, KHO_NAME, nPid, MET_NAME]);
  const lampPid = policyId(lampMint);
  const lampUnit = toUnit(lampPid, TLAMP_NAME);
  const committee = [pkh], threshold = 1n;

  // Ba policy NFT của Distribution — DERIVE, KHÔNG bịa (xem `applyDist`):
  //   • treasury_nft_policy = nPid (KHO NFT đúc dưới native policy nPid ở bước a)
  //   • account_nft_policy  = claim_account_nft(committee, threshold, nPid) (`claim_account_nft.ak:52-56`)
  //   • beacon_nft_policy   — không derive được ở đây ⇒ fail-closed qua env.
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
  const threadUnit = toUnit(nPid, SUPPLY_NAME), regUnit = toUnit(nPid, REG_NAME), khoUnit = toUnit(nPid, KHO_NAME);
  console.log(`=== RESUME mint (${NETWORK}) lampPid=${lampPid}\nKHO ${treAddr}\n`);

  // Genesis outputs: #0 SupplyState(ss0), #1 registry, #2 kho-NFT@treAddr.
  const [ss0, regU] = await lucid.utxosByOutRef([
    { txHash: genesisTx, outputIndex: 0 }, { txHash: genesisTx, outputIndex: 1 },
  ]);
  if (!ss0 || (ss0.assets[threadUnit] ?? 0n) !== 1n) throw new Error(`genesis#0 không mang thread NFT`);
  if (!regU || (regU.assets[regUnit] ?? 0n) !== 1n) throw new Error(`genesis#1 không mang reg NFT`);
  // xác nhận ss0 = dist_minted 0 (thread sạch)
  const s = Data.from(ss0.datum!) as Constr<Data>;
  if ((s.fields[0] as bigint) !== 0n) throw new Error(`ss0 dist_minted=${s.fields[0]} ≠ 0 (thread ô nhiễm, sai outref)`);
  const khoU = (await lucid.utxosAt(treAddr)).find((u) => (u.assets[khoUnit] ?? 0n) === 1n);
  if (!khoU) throw new Error(`không thấy kho-NFT tại ${treAddr}`);

  // fundUtxo: UTxO ADA THUẦN lớn nhất (không marker/tLAMP) → tránh vớ thread thứ 2.
  const all = await lucid.utxosAt(walletAddr);
  const clean = all.filter((u) => Object.keys(u.assets).every((k) => k === "lovelace"))
    .sort((a, b) => Number((b.assets.lovelace ?? 0n) - (a.assets.lovelace ?? 0n)));
  if (clean.length === 0) throw new Error("không có UTxO ADA thuần làm phí");
  const fundUtxo = clean[0];
  console.log(`ss0=${genesisTx}#0  fund=${fundUtxo.txHash}#${fundUtxo.outputIndex} (${(fundUtxo.assets.lovelace ?? 0n) / 1_000_000n} tADA)\n`);

  const ss1 = supplyStateToCbor({ dist_minted: DELTA, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  // TreasuryDatum có 2 trường (committee_hash, outstanding_entitlement) —
  // Distribution/onchain/lib/magiclamp/lampdist/types.ak:51-54. Ghi 1 trường thì
  // `expect out_datum: TreasuryDatum` hỏng ở MỌI nhánh treasury.spend ⇒ tLAMP vào kho
  // nằm chết, không nhánh nào rút ra được. outstanding_entitlement khởi tạo = 0 (chưa nợ ai).
  const treDatum = Data.to(new Constr(0, [pkh, 0n]));

  const mintTx = await lucid.newTx()
    .collectFrom([ss0, fundUtxo])
    .mintAssets({ [lampUnit]: DELTA }, mintRouteToCbor("DistributionVest"))
    .attach.MintingPolicy(lampMint)
    .readFrom([regU, khoU])
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ss1 }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: DELTA })
    .addSigner(walletAddr)
    .complete();

  if (!SUBMIT) { console.log("ℹ️ SUBMIT=false → build OK, không gửi."); return; }
  const mh = await (await mintTx.sign.withWallet().complete()).submit();
  console.log(`✅ mint TX: ${mh}\n   ${explorerTx(mh)}`);
  await lucid.awaitTx(mh);
  const khoLamp = (await lucid.utxosAt(treAddr)).reduce((s2, u) => s2 + (u.assets[lampUnit] ?? 0n), 0n);
  console.log(`   ✓ KHO giữ ${khoLamp / 1_000_000n} tLAMP (mong đợi ${DELTA / 1_000_000n})`);
  if (khoLamp < DELTA) throw new Error("A-DEST FAIL");
  const state = { network: NETWORK, nPid, lampPid, lampUnit, treHash, treAddr, claimHash, distNftPolicies: { beacon: beaconPid, treasury: nPid, account: accountPid }, committee, threshold: Number(threshold), msPerEpoch: MS_PER_EPOCH.toString(), delta: DELTA.toString(), genesisTx, mintTx: mh, treDatum, committeeHash: pkh };
  await writeFile(resolve(__dirname, "canonical-state.preview.json"), JSON.stringify(state, null, 2) + "\n");
  console.log(`\n✅ Preview canonical mint→kho xong. State → canonical-state.preview.json`);
}
main().catch((e) => { console.error("❌", e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); });
