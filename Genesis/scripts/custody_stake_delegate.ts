// custody_stake_delegate.ts — đăng ký + uỷ quyền phần STAKE của địa chỉ kho canonical.
//
// VÌ SAO CẦN BƯỚC NÀY: kho canonical gieo ở địa chỉ BASE (payment = `custody`, stake =
// `treasury_stake`). Phần stake đó chỉ sinh thưởng khi credential đã đăng ký và đã uỷ quyền
// cho một pool; trước đó nhánh `StakeRewardIn` không có gì để ghi sổ. Builder dùng ở đây:
// `Treasury/offchain/src/stakeDelegationBuilder.ts` ▸ `buildStakeDelegation`.
//
// TRƯỚC KHI DỰNG, script đối chiếu ba thứ để chắc đang uỷ quyền ĐÚNG kho đang sống:
//   1. hash `treasury_stake` suy lại từ state == phần stake của `custodyAddr` suy lại;
//   2. UTxO mang custody NFT đang nằm ĐÚNG ở `custodyAddr` đó trên chuỗi;
//   3. ví đang ký là `delegation_admin` đã nướng vào script (`resolveDelegationAdmin`).
// Lệch một trong ba thì dừng — uỷ quyền nhầm credential tốn cọc đăng ký mà không rút lại được
// (nhánh huỷ đăng ký bị `certificate_ok` cấm).
//
// Trạng thái đăng ký đọc từ Blockfrost `/accounts/{stake}`: 404 hoặc `active=false` ⇒ đăng ký
// rồi uỷ quyền; `active=true` ⇒ chỉ uỷ quyền. Đã uỷ quyền đúng pool đích ⇒ không làm gì.
//
// Chạy: NETWORK=Preprod POOL_ID=pool1… [SUBMIT=true] tsx custody_stake_delegate.ts
// Không đặt SUBMIT=true ⇒ chạy khô: dựng và đánh giá giao dịch rồi dừng, không ký, không gửi.
// Mainnet bị chặn: pool uỷ quyền của kho Mainnet là quyết định của chủ dự án, không phải một
// tham số dòng lệnh.
import { getAddressDetails, validatorToScriptHash } from "@lucid-evolution/lucid";
import {
  NETWORK, BLOCKFROST_URL, BLOCKFROST_KEY, makeLucid, walletPkh, explorerTx, haltUnlessSubmit,
} from "./config.js";
import { rehydrate, canonicalWindowOrigin } from "./_canonical_v2.js";
import {
  deriveCustody, resolveDelegationAdmin, pointerPolicyFromState,
} from "./_reserve_layer2.js";
import {
  assertPoolId, buildStakeDelegation, planStakeDelegation, type StakeDelegationMode,
} from "../../Treasury/offchain/src/stakeDelegationBuilder.js";

interface AccountState { registered: boolean; poolId: string | null }

async function accountState(rewardAddress: string): Promise<AccountState> {
  const r = await fetch(`${BLOCKFROST_URL}/accounts/${rewardAddress}`, {
    headers: { project_id: BLOCKFROST_KEY },
  });
  if (r.status === 404) return { registered: false, poolId: null };
  if (!r.ok) throw new Error(`Blockfrost /accounts trả HTTP ${r.status} — không biết credential đã đăng ký chưa.`);
  const j = (await r.json()) as { active?: unknown; pool_id?: unknown };
  if (typeof j.active !== "boolean") {
    throw new Error("Blockfrost /accounts: thiếu trường `active` — không suy được trạng thái đăng ký.");
  }
  return { registered: j.active, poolId: typeof j.pool_id === "string" ? j.pool_id : null };
}

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") {
    throw new Error("CHẶN: pool uỷ quyền của kho Mainnet là quyết định của chủ dự án; script này chỉ chạy mạng thử.");
  }
  const poolId = assertPoolId(process.env.POOL_ID ?? "");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const { state, wiring } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);
  if (!state.reserve?.custodyRef) {
    throw new Error("chưa gieo kho — chạy 'tsx 24_reserve_layer2_init.ts' trước.");
  }

  // Cùng tham số với `deriveReserveWiring` (bước 25/26) — nhưng gọi thẳng `deriveCustody`, vì
  // chỉ nó trả về chính script `treasury_stake` (bên kia chỉ trả hash).
  const delegationAdmin = resolveDelegationAdmin(wiring.pkh);
  const reserve = await deriveCustody(state.reserve.custodyRef.txHash, state.reserve.custodyRef.outputIndex, {
    pointerPolicy: pointerPolicyFromState(state),
    lampPid: wiring.lampPid, tokenName: wiring.tokenName, network: wiring.network,
    windowOriginMs: canonicalWindowOrigin(wiring.network),
    delegationAdminPkh: delegationAdmin,
  });
  const stakeScript = reserve.treasuryStake;

  // ── Đối chiếu 1: hash suy lại == phần stake của địa chỉ kho ────────────────
  const stakeHash = validatorToScriptHash(stakeScript);
  const addrStake = getAddressDetails(reserve.custodyAddr).stakeCredential;
  if (stakeHash !== reserve.treasuryStakeHash || addrStake?.type !== "Script" || addrStake.hash !== stakeHash) {
    throw new Error(
      `LỆCH STAKE: script ${stakeHash}, wiring ${reserve.treasuryStakeHash}, phần stake địa chỉ kho ` +
      `${addrStake ? `${addrStake.type}:${addrStake.hash}` : "không có"}.`,
    );
  }

  // ── Đối chiếu 2: kho đang sống ĐÚNG ở địa chỉ đó ───────────────────────────
  const atCustody = (await lucid.utxosAt(reserve.custodyAddr))
    .filter((u) => (u.assets[reserve.custodyNftUnit] ?? 0n) === 1n);
  if (atCustody.length !== 1) {
    throw new Error(`cần ĐÚNG 1 UTxO mang custody NFT tại ${reserve.custodyAddr}, tìm thấy ${atCustody.length}.`);
  }

  // ── Đối chiếu 3: ví ký là delegation_admin ──────────────────────────────
  if (pkh !== delegationAdmin) {
    throw new Error(
      `ví ${pkh} không phải delegation_admin ${delegationAdmin} đã nướng vào treasury_stake — ` +
      "certificate_ok sẽ từ chối. Ký bằng khoá admin đó.",
    );
  }

  const probe = planStakeDelegation({
    network: NETWORK, stakeScript, poolId, delegationAdmin, mode: "delegate",
  });
  const acct = await accountState(probe.rewardAddress);
  console.log(`=== Uỷ quyền phần stake của kho (${NETWORK}) ===`);
  console.log(`kho:            ${reserve.custodyAddr}`);
  console.log(`stake:          ${probe.rewardAddress}`);
  console.log(`treasury_stake: ${stakeHash}`);
  console.log(`admin:          ${delegationAdmin}`);
  console.log(`trạng thái:     ${acct.registered ? "đã đăng ký" : "chưa đăng ký"}, pool hiện tại ${acct.poolId ?? "không có"}`);
  console.log(`pool đích:      ${poolId}`);

  if (acct.registered && acct.poolId === poolId) {
    console.log("\nĐã uỷ quyền cho đúng pool đích — không làm gì.");
    return;
  }
  const mode: StakeDelegationMode = acct.registered ? "delegate" : "register-and-delegate";
  const plan = planStakeDelegation({ network: NETWORK, stakeScript, poolId, delegationAdmin, mode });
  console.log(`chứng chỉ:      ${plan.certs.join(" → ")}\n`);

  const tx = await buildStakeDelegation(lucid, {
    network: NETWORK, stakeScript, poolId, delegationAdmin, mode,
  }).complete();
  haltUnlessSubmit(`uỷ quyền phần stake của kho (${plan.certs.join(" + ")})`);
  const hash = await (await tx.sign.withWallet().complete()).submit();
  console.log(`📤 Uỷ quyền: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);
  console.log("✓ đã vào chuỗi. Blockfrost có thể chậm vài phút mới phản ánh `active`/`pool_id`.");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
