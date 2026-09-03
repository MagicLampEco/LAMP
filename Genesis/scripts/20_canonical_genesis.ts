// 20_canonical_genesis.ts — Tx A của policy LAMP canonical MỚI: đúc trọn bộ marker one-shot.
//
// ĐÂY LÀ BƯỚC KHÔNG LÀM LẠI ĐƯỢC. Mọi policy dưới đây nướng cùng một `genesis_ref`, và một
// UTxO chỉ tiêu được MỘT lần trong lịch sử chuỗi. Marker nào không đúc trong giao dịch này
// thì KHÔNG BAO GIỜ đúc được nữa dưới các policy-id đã tính — mà `lamp_mint` lại nướng sẵn
// những policy-id ấy. Thiếu một marker = một nhánh chết vĩnh viễn.
//
// Đó chính xác là chuyện đã xảy ra trên mainnet: bản mồi 2026-06-18 nướng `meter_nft_policy`
// = 28 byte 0 (`Genesis/offchain/src/deployed.ts:92`) ⇒ nhánh `ReserveDraw` không bao giờ
// thoả ⇒ 9,63 tỷ LAMP Reserve không rút được qua policy đó (deployed.ts:118-119). Nên ở đây
// NĂM marker đúc trong ĐÚNG một giao dịch, không chia lượt, không để dành:
//
//   SUPPLY (oneshot_nft) → SupplyState, neo định danh bộ đếm cap
//   REG    (oneshot_nft) → bảng registry token_tag → authority (WHO-gate)
//   MET    (oneshot_nft) → cửa DUY NHẤT của nhánh ReserveDraw  ← khe đã chết ở mainnet
//   TRSY   (treasury_nft) → kho A-DEST, nơi DistributionVest bắt buộc rót LAMP vào
//   DROP   (beacon_nft)   → beacon của Distribution, cần cho đường claim/redeem về sau
//
// DROP nằm trong danh sách vì đúng cái lý do trên: `beaconPid` đã nướng vào `claim_account`
// ⇒ vào `treHash` ⇒ vào ĐỊA CHỈ KHO. Không đúc nó bây giờ thì địa chỉ kho vẫn đúng, nhưng
// đường claim/redeem chết câm y hệt nhánh Reserve của mainnet — và lúc phát hiện thì hạt
// giống đã tiêu, không quay lui được.
//
// Chạy:
//   NETWORK=Preprod tsx 20_canonical_genesis.ts               # dựng + eval, KHÔNG gửi
//   NETWORK=Preprod SUBMIT=true tsx 20_canonical_genesis.ts   # gửi thật
import { Constr, Data, mintingPolicyToId, scriptFromNative, type UTxO } from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, TOKEN_NAME, makeLucid, walletPkh, explorerTx } from "./config.js";
import { assertOneShotMarkers } from "./_guards.js";
import { supplyStateToCbor } from "../offchain/src/datum.js";
import {
  deriveWiring, printWiring, registryDatum, treasuryDatum,
  DIST_CAP, RESERVE_CAP, STATE_PATH, writeState, type CanonicalState,
} from "./_canonical_v2.js";

/** min-ADA mỗi UTxO mang đúng 1 NFT + datum nhỏ. Dư một chút cho an toàn. */
const NFT_ADA = 2_000_000n;
/** Năm output NFT + phí + trả lại. Dưới mức này thì Lucid gãy ở bước cân bằng, khó đọc. */
const MIN_BALANCE = 15_000_000n;

/** `BeaconDatum = Constr(0, [epoch, BeaconKind, drop_value])` (`lampdist/types.ak:30-34`). */
function beaconDatum(epoch: bigint, dropValue: bigint): string {
  return Data.to(new Constr(0, [epoch, new Constr(0, []), dropValue]));
}

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") {
    throw new Error(
      "CHẶN: script này là DIỄN TẬP. Phát hành mainnet đi theo runbook riêng " +
      "(`Genesis/mainnet-deploy-plan.md` mục D) và chỉ sau khi mục C xanh.",
    );
  }

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  console.log(`=== Tx A — genesis canonical v2 (${NETWORK}) === SUBMIT=${SUBMIT}\n`);

  // ── Chọn hạt giống ───────────────────────────────────────────────────────
  // Ưu tiên UTxO THUẦN ADA: token lạ đi kèm sẽ chảy vào output trả lại, thêm một thứ phải
  // cân mà không đổi gì về bảo đảm. Nhưng KHÔNG đòi cho bằng được — ví vận hành thật
  // thường không còn UTxO trắng nào, và chặn ở đây là chặn cả lượt phát hành vì một lý do
  // thẩm mỹ. Không có UTxO trắng thì lấy UTxO nhiều ADA nhất và nói rõ ra.
  //
  // Cũng không lấy bừa `utxos[0]`: thứ tự UTxO do nhà cung cấp trả về, không ổn định giữa
  // hai lượt gọi — mà `genesis_ref` là thứ nướng vào MỌI policy-id dưới đây.
  const utxos = await lucid.wallet().getUtxos();
  const balance = utxos.reduce((s, u) => s + (u.assets.lovelace ?? 0n), 0n);
  console.log(`ví: ${walletAddr}\nsố dư: ${balance / 1_000_000n} ADA (${utxos.length} UTxO)`);
  if (balance < MIN_BALANCE) {
    throw new Error(`cần ≥ ${MIN_BALANCE / 1_000_000n} ADA để dựng 5 output NFT + phí; đang có ${balance / 1_000_000n}.`);
  }
  // ── Chạy lại được: hạt giống của lượt trước đã tiêu thì NHẶT LẠI, không đúc lần hai ──
  // Vì sao cần: giao dịch lên chuỗi rồi thì không quay lui được, nên bất kỳ lỗi nào SAU bước gửi
  // (ghi tệp, mất mạng, tắt máy) sẽ để lại một lượt chạy có marker trên chuỗi mà không có state —
  // và các bước sau đọc `genesis_ref` từ state, nên chúng đứng hình. Đã xảy ra thật ở lượt Tx A
  // đầu tiên trên Preprod (2026-09-03): tx thành công, `JSON.stringify` ném vì BigInt.
  const adopt = (process.env.ADOPT_GENESIS_TX ?? "").trim().toLowerCase();
  if (adopt) {
    const idx = Number(process.env.ADOPT_GENESIS_IDX ?? "0");
    if (!/^[0-9a-f]{64}$/.test(adopt)) throw new Error("ADOPT_GENESIS_TX phải là 64 ký tự hex.");
    return adoptExisting(lucid, pkh, adopt, idx);
  }

  const byAda = (a: UTxO, b: UTxO) => Number((b.assets.lovelace ?? 0n) - (a.assets.lovelace ?? 0n));
  const enough = utxos.filter((u) => (u.assets.lovelace ?? 0n) >= 5_000_000n).sort(byAda);
  const pure = enough.filter((u) => Object.keys(u.assets).length === 1);
  const seed: UTxO | undefined = pure[0] ?? enough[0];
  if (!seed) throw new Error("không có UTxO nào ≥ 5 ADA để làm hạt giống one-shot.");
  const extra = Object.keys(seed.assets).length - 1;
  console.log(`hạt giống: ${seed.txHash}#${seed.outputIndex}` +
    (extra > 0 ? `  (mang thêm ${extra} loại token — sẽ chảy vào output trả lại)` : "  (thuần ADA)"));
  console.log();

  // ── Tính toàn bộ wiring từ hạt giống ─────────────────────────────────────
  const { wiring, scripts } = await deriveWiring({
    genesisTxHash: seed.txHash, genesisIndex: seed.outputIndex, pkh, tokenName: TOKEN_NAME,
  });
  printWiring(wiring);

  // ── Cổng MARKER-001: không khe nào được là native-sig ────────────────────
  // Cổng này tồn tại vì bản diễn tập cũ (`canonical_mint.ts:108`) đúc cả bốn marker bằng
  // `scriptFromNative({type:"sig"})` — đúc lại được bao nhiêu lần tuỳ ý. Ở đây nó phải im
  // lặng: bốn khe đều là policy one-shot. Nó kêu = wiring đã trôi, DỪNG.
  assertOneShotMarkers(
    { thread: wiring.markers.threadPid, registry: wiring.markers.regPid,
      kho: wiring.markers.khoPid, meter: wiring.markers.metPid },
    { submit: true, nativePolicyId: mintingPolicyToId(scriptFromNative({ type: "sig", keyHash: pkh })),
      env: process.env, warn: (m: string) => console.warn(m) },
  );
  console.log("\n✓ MARKER-001: bốn khe marker đều one-shot (không khe nào là native-sig).");

  // ── Dựng Tx A ────────────────────────────────────────────────────────────
  const ss0 = supplyStateToCbor({
    dist_minted: 0n, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP,
  });

  const tx = await lucid.newTx()
    .collectFrom([seed])                                   // tiêu hạt giống — một lần duy nhất
    .mintAssets({ [wiring.threadUnit]: 1n }, Data.void()).attach.MintingPolicy(scripts.oneshotSupply)
    .mintAssets({ [wiring.regUnit]: 1n },    Data.void()).attach.MintingPolicy(scripts.oneshotReg)
    .mintAssets({ [wiring.metUnit]: 1n },    Data.void()).attach.MintingPolicy(scripts.oneshotMet)
    .mintAssets({ [wiring.khoUnit]: 1n }, Data.to(new Constr(0, []))).attach.MintingPolicy(scripts.treasuryNft)
    .mintAssets({ [toDropUnit(wiring)]: 1n }, Data.to(new Constr(0, []))).attach.MintingPolicy(scripts.beaconNft)
    // SupplyState tại tầng 3 — KHÔNG để ở ví. Ở ví thì mọi lần tiêu chỉ cần chữ ký, và
    // `supply_state.ak` (ép "tiêu SupplyState PHẢI kèm mint LAMP") không bao giờ chạy.
    .pay.ToContract(wiring.ssAddr, { kind: "inline", value: ss0 },
      { lovelace: NFT_ADA, [wiring.threadUnit]: 1n })
    // Registry PHẢI nằm ở `Script(regPid)` — không phải ở ví. `find_registry_datum` ép
    // `payment_credential == Script(registry_nft_policy)`, vì reference input không cần chữ ký
    // của ai: registry NFT nằm ở ví thì người giữ nó tự viết `entries` và tự cấp quyền đúc LAMP.
    // Mainnet dùng `registry_write` (gác bằng TAAD/OrgDID, tiêu được ⇒ xoay khoá được); màn diễn
    // tập dùng chính `oneshot_nft`, nên bảng registry ở đây BẤT BIẾN — xem runbook.
    .pay.ToContract(wiring.regAddr, { kind: "inline", value: registryDatum(pkh) },
      { lovelace: NFT_ADA, [wiring.regUnit]: 1n })
    // KHO A-DEST: TRSY NFT bắt buộc hạ cánh ở một Script, mang TreasuryDatum, nợ mở = 0
    // (`treasury_nft.ak:50-56`). Chính ràng buộc này giữ cho A-DEST không trỏ về một ví.
    .pay.ToContract(wiring.treAddr, { kind: "inline", value: treasuryDatum(pkh) },
      { lovelace: NFT_ADA, [wiring.khoUnit]: 1n })
    // MET ở ví: bước 22 sẽ TIÊU nó để mở nhánh ReserveDraw. Đây là mức Lớp 1 — nó chứng
    // minh nhánh MỞ ĐƯỢC, KHÔNG chứng minh trần nhịp δ ≤ E/1000 (việc của `reserve_draw`).
    .pay.ToAddress(walletAddr, { lovelace: NFT_ADA, [wiring.metUnit]: 1n })
    .pay.ToContract(wiring.beaconAddr, { kind: "inline", value: beaconDatum(0n, 0n) },
      { lovelace: NFT_ADA, [toDropUnit(wiring)]: 1n })
    .complete();

  console.log(`\n✓ Tx A dựng xong + eval script OK (CBOR ${tx.toCBOR().length / 2} byte).`);

  if (!SUBMIT) {
    console.log(
      "\n(SUBMIT=false ⇒ KHÔNG gửi, KHÔNG ghi state.)\n" +
      "Hạt giống chưa tiêu nên chạy lại vẫn ra CHÍNH các policy-id trên.\n" +
      "Gửi thật: SUBMIT=true tsx 20_canonical_genesis.ts",
    );
    return;
  }

  const hash = await (await tx.sign.withWallet().complete()).submit();
  console.log(`\n📤 Tx A: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);

  const state: CanonicalState = {
    wiring, tx: { genesis: hash }, minted: { dist: "0", reserve: "0" },
  };
  await writeState(state);
  console.log(`\n✅ Genesis xong. State → ${STATE_PATH}`);
  console.log("Bước kế: tsx 21_vest_to_kho.ts");
}

/** unit của DROP NFT — beacon policy + tên "DROP" ép bởi `beacon_nft.ak:55-56`. */
function toDropUnit(w: { markers: { beaconPid: string } }): string {
  return w.markers.beaconPid + "44524f50";
}

/**
 * Nhặt lại state cho một lượt genesis ĐÃ GỬI — không đúc gì thêm.
 *
 * Chỉ ghi state sau khi ĐỐI CHIẾU trên chuỗi rằng cả năm marker có thật và nằm đúng chỗ. Không
 * đối chiếu mà ghi bừa thì state trỏ vào một policy không ai giữ, và bước sau dựng giao dịch cho
 * nó — im lặng, không lỗi nào kêu.
 */
async function adoptExisting(
  lucid: Awaited<ReturnType<typeof makeLucid>>,
  pkh: string, txHash: string, idx: number,
): Promise<void> {
  console.log(`=== NHẶT LẠI state của lượt genesis đã gửi ===`);
  console.log(`genesis_ref: ${txHash}#${idx}\n`);
  const { wiring } = await deriveWiring({
    genesisTxHash: txHash, genesisIndex: idx, pkh, tokenName: TOKEN_NAME,
  });
  printWiring(wiring);

  const cnt = (us: { assets: Record<string, bigint> }[], u: string) =>
    us.reduce((s, x) => s + (x.assets[u] ?? 0n), 0n);
  const atSs = await lucid.utxosAt(wiring.ssAddr);
  const atTre = await lucid.utxosAt(wiring.treAddr);
  const atBcn = await lucid.utxosAt(wiring.beaconAddr);
  const atWlt = await lucid.wallet().getUtxos();

  const atReg = await lucid.utxosAt(wiring.regAddr);
  const checks: [string, bigint][] = [
    ["SUPPLY @ supply_state", cnt(atSs, wiring.threadUnit)],
    ["TRSY   @ KHO",          cnt(atTre, wiring.khoUnit)],
    ["DROP   @ beacon",       cnt(atBcn, toDropUnit(wiring))],
    ["MET    @ ví",           cnt(atWlt, wiring.metUnit)],
  ];
  let bad = 0;
  console.log();
  for (const [name, n] of checks) {
    console.log(`${n === 1n ? "✓" : "✗"} ${name}: ${n}`);
    if (n !== 1n) bad++;
  }
  // REG kiểm riêng: nó có thể còn ở ví (lượt genesis dựng trước bản vá đặt nó ở ví). Đó KHÔNG
  // phải hỏng genesis — cổng WHO chỉ đọc REG lúc Tx B, nên còn kịp dời. Nói rõ chứ không đếm
  // chung vào `bad`, vì hai tình huống cần hai hành động khác nhau.
  const regAtScript = cnt(atReg, wiring.regUnit);
  const regAtWallet = cnt(atWlt, wiring.regUnit);
  if (regAtScript === 1n) {
    console.log(`✓ REG    @ Script(regPid): 1`);
  } else if (regAtWallet === 1n) {
    console.log(`⚠ REG    @ ví: 1 — SAI CHỖ. Cổng WHO đòi nó ở Script(regPid).`);
    console.log(`  Chạy 'tsx 20b_place_registry.ts' để dời trước khi vest.`);
  } else {
    console.log(`✗ REG: không thấy ở Script(regPid) lẫn ở ví`);
    bad++;
  }
  if (bad > 0) {
    throw new Error(
      `${bad} marker KHÔNG đúng 1 bản đúng chỗ ⇒ genesis_ref này không phải lượt đang sống. ` +
      `Không ghi state. Kiểm lại ADOPT_GENESIS_TX/IDX.`,
    );
  }

  await writeState({ wiring, tx: { genesis: txHash }, minted: { dist: "0", reserve: "0" } });
  console.log(`\n✅ State đã nhặt lại → ${STATE_PATH}`);
  console.log("Bước kế: tsx 21_vest_to_kho.ts");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
