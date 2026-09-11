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
// BIẾN BẮT BUỘC: `RESERVE_KHO_NFT_POLICY` (khe #13) và `CUSTODY_SEED_TX`/`CUSTODY_SEED_IDX` —
// UTxO hạt giống đã sinh ra policy id ấy. Hai thứ này là HAI MẶT của một sự thật, nên bước này
// đòi cả hai: có policy mà không có hạt giống thì không đo được việc hạt giống còn sống hay đã
// bị chính giao dịch này tiêu mất.
//
// Chạy:
//   NETWORK=Preprod CUSTODY_SEED_TX=… CUSTODY_SEED_IDX=… tsx 20_canonical_genesis.ts   # dựng + eval
//   NETWORK=Preprod CUSTODY_SEED_TX=… CUSTODY_SEED_IDX=… SUBMIT=true tsx 20_canonical_genesis.ts
import { Constr, Data, mintingPolicyToId, scriptFromNative, type UTxO } from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, TOKEN_NAME, makeLucid, walletPkh, explorerTx } from "./config.js";
import { assertOneShotMarkers } from "./_guards.js";
import { supplyStateToCbor } from "../offchain/src/datum.js";
import {
  deriveWiring, printWiring, registryDatum, treasuryDatum,
  DIST_CAP, RESERVE_CAP, STATE_PATH, writeState, type CanonicalState,
} from "./_canonical_v2.js";
import {
  assertSeedNotCustody, custodySeedRefFromEnv, refKey, type OutputRef,
} from "./_custodySeedRef.js";

/** min-ADA mỗi UTxO mang đúng 1 NFT + datum nhỏ. Dư một chút cho an toàn. */
const NFT_ADA = 2_000_000n;
/** Năm output NFT + phí + trả lại. Dưới mức này thì Lucid gãy ở bước cân bằng, khó đọc. */
const MIN_BALANCE = 15_000_000n;

/**
 * `instance_id` mặc định của instance custody đích = asset name kho NFT (khe #14 `lamp_mint`).
 * Khớp `_reserve_layer2.ts::INSTANCE_ID` (`fromText("lamp-reserve")`), giữ dạng hex ở đây để
 * tệp này không phải import `_reserve_layer2.ts` — chiều import ngược lại đã có.
 */
const RESERVE_KHO_NAME_MAC_DINH = "6c616d702d72657365727665"; // "lamp-reserve"

/**
 * Cặp NFT kho Treasury custody cho khe #13-14 của `lamp_mint` — FAIL-CLOSED, không mặc định
 * cho `policy`.
 *
 * Vì sao nó là ĐẦU VÀO của bước genesis chứ không phải kết quả: `custody_seed` nướng một hạt
 * giống RIÊNG (luật S-MINT-2 cấm gộp giao dịch đúc custody NFT với policy mint khác), nên
 * `custody_seed` policy id KHÔNG suy ra được từ `genesis_ref` của lượt này. Mà `lamp_mint`
 * nướng nó vào policy-id, nên nó phải biết TRƯỚC giao dịch không-làm-lại-được này.
 *
 * Cách lấy: chọn UTxO hạt giống custody, rồi
 * `deriveCustody(txHash, idx, {...}).custodySeedPid` (`_reserve_layer2.ts`).
 */
function reserveKhoParams(): { pid: string; name: string } {
  const pid = (process.env.RESERVE_KHO_NFT_POLICY ?? "").trim().toLowerCase();
  const name = (process.env.RESERVE_KHO_NFT_NAME ?? RESERVE_KHO_NAME_MAC_DINH).trim().toLowerCase();
  if (!/^[0-9a-f]{56}$/.test(pid)) {
    throw new Error(
      `RESERVE-KHO-001: chưa đặt RESERVE_KHO_NFT_POLICY (nhận "${pid}"). Đây là policy id của ` +
      `'custody_seed' áp trên HẠT GIỐNG CUSTODY — khe #13 của lamp_mint, đích đường ReserveDraw. ` +
      `Nó KHÔNG suy ra được từ genesis_ref của lượt này (custody_seed nướng hạt giống riêng, ` +
      `luật S-MINT-2), nên phải chọn hạt giống custody TRƯỚC bước genesis. Lấy bằng ` +
      `deriveCustody(txHash, idx, {...}).custodySeedPid trong _reserve_layer2.ts. Bỏ trống là ` +
      `nướng một cặp kho sai vào policy-id: lamp_mint cho Δ rót vào kho A, reserve_draw đòi tiêu ` +
      `NFT của kho B, không tầng nào báo, và apply-param không sửa được sau khi gửi.`,
    );
  }
  if (!/^[0-9a-f]+$/.test(name) || name.length % 2 !== 0 || name.length > 64) {
    throw new Error(
      `RESERVE-KHO-002: RESERVE_KHO_NFT_NAME = "${name}" — cần hex độ dài chẵn, tối đa 32 byte. ` +
      `Đây là instance_id của instance custody đích (custody_seed luật S-PARAM-0 ép ` +
      `datum.instance_id == nft_name).`,
    );
  }
  return { pid, name };
}

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
  // ── Hạt giống CUSTODY: phải biết ở đây, và phải SỐNG SÓT qua bước này ────
  //
  // Khe #13 `reserve_kho_nft_policy` dưới đây là policy id của `custody_seed` áp trên một UTxO
  // hạt giống RIÊNG, và nó nướng vào policy-id của `lamp_mint` ở chính giao dịch không-làm-lại-
  // được này. Giữa đây và lúc bước Lớp 2 tiêu nó có sáu giao dịch, mỗi cái có coin-selection tự
  // do trên ví — và phép chọn hạt giống genesis bên dưới lấy UTxO NHIỀU ADA NHẤT, rất có thể
  // đúng cái vừa dành cho custody.
  //
  // Không đọc được hạt giống custody thì KHÔNG đo được va chạm đó. Trạng thái mù ở đây phải
  // kêu, không được cho qua: đây là bước duy nhất còn quay lui được.
  const custodySeed: OutputRef = custodySeedRefFromEnv(process.env);
  if (!utxos.some((u) => refKey(u) === refKey(custodySeed))) {
    throw new Error(
      `CUSTODY-SEED-004: hạt giống custody ${refKey(custodySeed)} KHÔNG có trong ví lúc này. ` +
      `Khe #13 của lamp_mint là policy id của \`custody_seed\` áp trên đúng UTxO đó, và nó nướng ` +
      `vào policy-id ở giao dịch này. Hạt giống đã tiêu ⇒ policy trong khe #13 không bao giờ đúc ` +
      `được ⇒ nhánh ReserveDraw của token sắp đúc chết ngay từ lúc sinh. Chọn một hạt giống ` +
      `custody còn sống, tính lại RESERVE_KHO_NFT_POLICY từ nó, rồi chạy lại.`,
    );
  }

  const adopt = (process.env.ADOPT_GENESIS_TX ?? "").trim().toLowerCase();
  if (adopt) {
    const idx = Number(process.env.ADOPT_GENESIS_IDX ?? "0");
    if (!/^[0-9a-f]{64}$/.test(adopt)) throw new Error("ADOPT_GENESIS_TX phải là 64 ký tự hex.");
    assertSeedNotCustody({ txHash: adopt, outputIndex: idx }, custodySeed, "genesis_ref nhặt lại");
    return adoptExisting(lucid, pkh, adopt, idx);
  }

  const byAda = (a: UTxO, b: UTxO) => Number((b.assets.lovelace ?? 0n) - (a.assets.lovelace ?? 0n));
  const enough = utxos.filter((u) => (u.assets.lovelace ?? 0n) >= 5_000_000n).sort(byAda);
  // Loại hạt giống custody khỏi TẬP ỨNG VIÊN, không chỉ cảnh báo sau khi đã chọn. Hai lớp, vì
  // chúng hỏng theo hai kiểu: bộ lọc sửa được ca thường gặp mà không bắt người chạy làm gì;
  // cổng SEED-002 bên dưới bắt ca bộ lọc bị gỡ hoặc đi vòng.
  const free = enough.filter((u) => refKey(u) !== refKey(custodySeed));
  const pure = free.filter((u) => Object.keys(u.assets).length === 1);
  const seed: UTxO | undefined = pure[0] ?? free[0];
  if (!seed) {
    throw new Error(
      "không có UTxO nào ≥ 5 ADA để làm hạt giống one-shot (đã loại hạt giống custody " +
      `${refKey(custodySeed)}). Tách thêm một UTxO rồi chạy lại.`,
    );
  }
  assertSeedNotCustody(seed, custodySeed, "hạt giống genesis");
  const extra = Object.keys(seed.assets).length - 1;
  console.log(`hạt giống: ${seed.txHash}#${seed.outputIndex}` +
    (extra > 0 ? `  (mang thêm ${extra} loại token — sẽ chảy vào output trả lại)` : "  (thuần ADA)"));
  console.log();

  // ── Tính toàn bộ wiring từ hạt giống ─────────────────────────────────────
  const reserveKho = reserveKhoParams();
  const { wiring, scripts } = await deriveWiring({
    genesisTxHash: seed.txHash, genesisIndex: seed.outputIndex, pkh, tokenName: TOKEN_NAME,
    reserveKhoPid: reserveKho.pid, reserveKhoName: reserveKho.name,
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
  const reserveKho = reserveKhoParams();
  const { wiring } = await deriveWiring({
    genesisTxHash: txHash, genesisIndex: idx, pkh, tokenName: TOKEN_NAME,
    reserveKhoPid: reserveKho.pid, reserveKhoName: reserveKho.name,
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
