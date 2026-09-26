// LampDistribution/scripts/06_refill.ts — kiểm nhánh `Refill` THẬT trên chuỗi.
//
// Chạy (mặc định CHỈ DỰNG, không ký, không gửi):
//   STEP=loose  LOOSE_OILDROP=<n>    tsx 06_refill.ts   # đỗ n oildrop LAMP ở địa chỉ kho, KHÔNG datum
//   STEP=refill DEPOSIT_OILDROP=<n>  tsx 06_refill.ts   # gộp singleton + mọi UTxO không datum, nạp thêm n
//   … thêm SUBMIT=true để ký và gửi.
//
// Vì sao có bước `loose`: LAMP rót vào kho qua A-DEST (`Genesis/onchain/validators/lamp_mint.ak`,
// nhánh `DistributionVest`) hạ cánh thành một UTxO RIÊNG ở địa chỉ kho — trong sân kho, ngoài sổ
// kho. `Refill` là nhánh duy nhất đưa nó vào sổ. Bước `loose` dựng đúng hình dạng đó bằng một lượt
// chuyển thường, để nhánh gộp được kiểm trên đúng thứ nó sinh ra để xử lý.
//
// Sau `refill`, runner đọc lại kho trên chuỗi và đối chiếu: đúng MỘT UTxO mang TRSY, sổ nợ và
// `total_redeemed` KHÔNG đổi (C-REF-TOTAL), LAMP tăng đúng bằng phần gộp + phần nạp.

import { Data } from "@lucid-evolution/lucid";
import type { LucidEvolution, UTxO } from "@lucid-evolution/lucid";
import {
  NETWORK, TREASURY_NFT_ASSET_NAME,
  makeLucid, loadDeployed, reapplyValidators, toUnit, explorerTx, awaitTx,
} from "./config.js";
import { decodeTreasuryDatum } from "../offchain/src/datum.js";
import { buildRefillTx, bearsForeignTreasuryName } from "../offchain/src/refillBuilder.js";

const STEP = (process.env.STEP ?? "").trim();
const SUBMIT = (process.env.SUBMIT ?? "false").toLowerCase() === "true";

function oildropEnv(name: string, required: boolean): bigint {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) {
    if (required) throw new Error(`REFILL-RUN-001: thiếu ${name} (oildrop, 1 LAMP = 1.000.000).`);
    return 0n;
  }
  if (!/^[0-9]+$/.test(raw)) throw new Error(`REFILL-RUN-002: ${name}='${raw}' không phải số nguyên ≥ 0.`);
  return BigInt(raw);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function lampAt(lucid: LucidEvolution, address: string, unit: string): Promise<bigint> {
  return (await lucid.utxosAt(address)).reduce((s, u) => s + (u.assets[unit] ?? 0n), 0n);
}

async function main(): Promise<void> {
  console.log(`=== LampDistribution Step 6: Refill (${NETWORK}) ===\n`);
  if (STEP !== "loose" && STEP !== "refill") {
    throw new Error("REFILL-RUN-000: đặt STEP=loose hoặc STEP=refill.");
  }

  const state = await loadDeployed();
  if (!state.testLamp) throw new Error("REFILL-RUN-003: deployed.json thiếu testLamp.");
  const lucid = await makeLucid();
  const { treasuryScript } = await reapplyValidators(state); // ném nếu hash lệch mã trên đĩa

  const treAddr  = state.treasury.address;
  const lampUnit = toUnit(state.testLamp.policyId, state.testLamp.assetName);
  const trsyUnit = toUnit(state.params.treasuryNftPolicy, TREASURY_NFT_ASSET_NAME);

  if (STEP === "loose") {
    const n = oildropEnv("LOOSE_OILDROP", true);
    if (n === 0n) throw new Error("REFILL-RUN-004: LOOSE_OILDROP phải > 0.");
    // Cố ý KHÔNG datum: đúng hình dạng một UTxO A-DEST vừa hạ cánh.
    const tx = await lucid.newTx()
      .pay.ToAddress(treAddr, { lovelace: 2_000_000n, [lampUnit]: n })
      .complete();
    console.log(`Đỗ ${n} oildrop LAMP (không datum) ở ${treAddr}`);
    if (!SUBMIT) { console.log("\n(SUBMIT=false ⇒ KHÔNG ký, KHÔNG gửi.)"); return; }
    const h = await (await tx.sign.withWallet().complete()).submit();
    console.log(`📤 loose: ${h}\n   ${explorerTx(h)}`);
    await awaitTx(lucid, h, "loose");
    return;
  }

  // STEP=refill — singleton mang TRSY + mọi UTxO KHÔNG datum ở địa chỉ kho. Diễn tập cố ý giữ tập
  // gộp HẸP hơn chuỗi cho phép: `treasury.ak` ▸ `carrier_ledger` bỏ qua datum của mọi input không
  // phải carrier nên gộp được cả UTxO mang datum lạ, nhưng runner này chỉ lấy đúng hình dạng A-DEST
  // (không datum) để phép đối chiếu LAMP bên dưới biết chính xác phần nào đã gộp. UTxO mang tài sản
  // tên TRSY dưới policy KHÁC thì loại — chuỗi nhận carrier theo TÊN, gộp vào là 2 carrier ⇒ từ
  // chối (builder cũng loại, `bearsForeignTreasuryName`; loại ở đây để `loose` khớp tập đã gộp).
  const all = await lucid.utxosAt(treAddr);
  const single = all.filter((u) => (u.assets[trsyUnit] ?? 0n) === 1n);
  if (single.length !== 1) {
    throw new Error(`REFILL-RUN-005: cần đúng 1 UTxO mang TRSY ở kho, thấy ${single.length}.`);
  }
  const loose = all.filter((u) =>
    (u.assets[trsyUnit] ?? 0n) === 0n && !u.datum && !u.datumHash &&
    !bearsForeignTreasuryName(u, state.params.treasuryNftPolicy));
  const skipped = all.length - 1 - loose.length;
  const inputs: UTxO[] = [single[0]!, ...loose];
  const before = decodeTreasuryDatum(Data.from(single[0]!.datum!));
  const lampBefore = await lampAt(lucid, treAddr, lampUnit);
  const deposit = oildropEnv("DEPOSIT_OILDROP", false);

  console.log(`UTxO ở kho: ${all.length} · gộp ${inputs.length} (singleton + ${loose.length} không datum)` +
    ` · bỏ qua ${skipped} (có datum hoặc mang TRSY policy khác)`);

  const res = await buildRefillTx({
    lucid, treasuryUtxos: inputs, treasuryScript,
    committeeSigners: state.committee.keyHashes, committeeThreshold: state.committee.threshold,
    lampPolicyId: state.testLamp.policyId, lampAssetName: state.testLamp.assetName,
    treasuryNftPolicy: state.params.treasuryNftPolicy,
    depositOildrop: deposit,
  });
  console.log(res.summary);
  if (!SUBMIT) { console.log("\n(SUBMIT=false ⇒ KHÔNG ký, KHÔNG gửi.)"); return; }

  const h = await (await res.tx.sign.withWallet().complete()).submit();
  console.log(`📤 refill: ${h}\n   ${explorerTx(h)}`);
  await awaitTx(lucid, h, "refill");
  await sleep(20_000);

  // ── Đối chiếu trên chuỗi ────────────────────────────────────────────────
  const after = await lucid.utxosAt(treAddr);
  const singles = after.filter((u) => (u.assets[trsyUnit] ?? 0n) === 1n);
  if (singles.length !== 1) throw new Error(`REFILL-VERIFY-001: sau refill có ${singles.length} UTxO mang TRSY.`);
  const d = decodeTreasuryDatum(Data.from(singles[0]!.datum!));
  const lampSingle = singles[0]!.assets[lampUnit] ?? 0n;
  const lampLoose = loose.reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  const expectSingle = (single[0]!.assets[lampUnit] ?? 0n) + lampLoose + deposit;
  const fails: string[] = [];
  if (d.outstanding_entitlement !== before.outstanding_entitlement) {
    fails.push(`sổ nợ ${before.outstanding_entitlement} → ${d.outstanding_entitlement}`);
  }
  if (d.total_redeemed !== before.total_redeemed) {
    fails.push(`total_redeemed ${before.total_redeemed} → ${d.total_redeemed} (C-REF-TOTAL)`);
  }
  if (d.committee_hash !== before.committee_hash) fails.push("committee_hash đổi");
  if (lampSingle !== expectSingle) fails.push(`LAMP singleton ${lampSingle} ≠ kỳ vọng ${expectSingle}`);
  if (fails.length > 0) throw new Error(`REFILL-VERIFY-002: ${fails.join("; ")}`);

  console.log(
    `\n✅ Refill đối chiếu xong trên chuỗi: 1 UTxO mang TRSY · sổ nợ ${d.outstanding_entitlement} · ` +
    `total_redeemed ${d.total_redeemed} (không đổi) · LAMP singleton ${lampSingle} ` +
    `(= ${expectSingle}) · LAMP cả địa chỉ ${lampBefore} → ${await lampAt(lucid, treAddr, lampUnit)}.`,
  );
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
