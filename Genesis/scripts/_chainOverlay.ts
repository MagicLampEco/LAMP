// _chainOverlay.ts — phần THUẦN của chế độ nối chuỗi giao dịch (`CHAIN_DEPTH` > 1) trong
// `30_feeder_accounts.ts`: không mạng, không khoá, có bài kiểm (`Genesis/tests/chainOverlay.test.ts`).
//
// VÌ SAO CẦN. Kho Distribution có ĐÚNG MỘT UTxO carrier (TRSY); mọi Grant/Redeem tiêu nó và tạo
// carrier mới. Chờ từng giao dịch vào block rồi đọc lại chỉ mục nhà cung cấp thì một lượt tốn
// ~143 s (đo trên vòng grant, `_Agents/council-2026-10-01/onchain-redeem.md` mục 3d), và chỉ mục
// trễ làm lượt kế chết vì "All inputs are spent". Mempool của node nhận giao dịch tiêu output của
// giao dịch còn nằm trong mempool, nên nhiều giao dịch nối nhau vào được cùng một block — miễn
// bên dựng biết trước các output đó. Tệp này giữ cái "biết trước" ấy: một LỚP PHỦ trên ảnh chụp
// chuỗi, cập nhật bằng hiệu ứng (input đã tiêu, output đã tạo) của từng giao dịch vừa dựng.
//
// FAIL-CLOSED, ba chỗ:
//   · đọc một địa chỉ KHÔNG nằm trong ảnh chụp ⇒ ném (FEED-CHAIN-003), không trả mảng rỗng —
//     "không có UTxO" và "lớp phủ không theo dõi địa chỉ này" là hai trạng thái khác nhau;
//   · giao dịch tiêu một input lớp phủ không biết ⇒ ném (FEED-CHAIN-002) — lớp phủ không còn
//     bảo đảm được gì về trạng thái sau giao dịch đó;
//   · output trùng ref đã có, hoặc mang txHash khác hash giao dịch ⇒ ném (FEED-CHAIN-002).
import { coreToTxOutput, type TxSignBuilder, type UTxO } from "@lucid-evolution/lucid";

/** `txHash#index` — cùng khuôn `refKey` ở `_distributionScripts.ts` (không import để tệp này không kéo `node:fs`). */
export const outRef = (u: { txHash: string; outputIndex: number }) => `${u.txHash}#${u.outputIndex}`;

/**
 * Trần độ sâu chuỗi. Mempool của node chứa khoảng hai thân block (Preprod: 2 × 90.112 byte) dùng
 * chung với mọi người; một Redeem ~9 KB, một Grant nhỏ hơn ⇒ ~20 giao dịch đã chạm trần trong ca
 * mempool trống. Sâu hơn thì node bắt đầu từ chối ở giữa chuỗi — đúng chỗ đắt nhất để hỏng.
 */
export const CHAIN_DEPTH_MAX = 20;

/**
 * FEED-ENV-001: CHAIN_DEPTH không phải số nguyên. FEED-CHAIN-004: ngoài [1, CHAIN_DEPTH_MAX].
 * Trống ⇒ 1 = hành vi cũ (gửi một giao dịch, chờ vào block, đọc lại chuỗi).
 */
export function chainDepthFromEnv(raw: string | undefined): number {
  const v = (raw ?? "").trim();
  if (!v) return 1;
  if (!/^[0-9]+$/.test(v)) throw new Error(`FEED-ENV-001: CHAIN_DEPTH='${raw}' không phải số nguyên không âm.`);
  const n = Number(v);
  if (n < 1 || n > CHAIN_DEPTH_MAX) {
    throw new Error(`FEED-CHAIN-004: CHAIN_DEPTH=${n} ngoài [1, ${CHAIN_DEPTH_MAX}] (trần mempool, xem CHAIN_DEPTH_MAX).`);
  }
  return n;
}

/** Hiệu ứng của MỘT giao dịch lên tập UTxO: input nó tiêu, output nó tạo. */
export interface TxEffects {
  txHash:  string;
  /** `txHash#index` của mọi input thường (KHÔNG gồm collateral, KHÔNG gồm reference input). */
  spent:   string[];
  created: UTxO[];
}

/**
 * Hiệu ứng của giao dịch ĐÃ DỰNG, trích từ chính thân giao dịch — không tin cái người dựng định
 * làm. Input thường thôi: collateral chỉ bị tiêu khi script hỏng (lúc đó chuỗi đã gãy), reference
 * input không bị tiêu. Hash = hash thân, chữ ký không đổi nó.
 */
export function txEffects(tx: TxSignBuilder): TxEffects {
  const body = tx.toTransaction().body();
  const txHash = tx.toHash();
  const spent: string[] = [];
  const ins = body.inputs();
  for (let k = 0; k < ins.len(); k++) {
    const i = ins.get(k);
    spent.push(`${i.transaction_id().to_hex()}#${Number(i.index())}`);
  }
  const created: UTxO[] = [];
  const outs = body.outputs();
  for (let k = 0; k < outs.len(); k++) created.push({ txHash, outputIndex: k, ...coreToTxOutput(outs.get(k)) });
  return { txHash, spent, created };
}

/** Ảnh chụp chuỗi của một tập địa chỉ ĐÃ CHỌN, cộng mọi giao dịch đã chồng lên nó. Bất biến. */
export interface ChainView {
  readonly tracked: ReadonlySet<string>;
  readonly utxos:   readonly UTxO[];
  /** Hash các giao dịch đã chồng lên ảnh chụp, theo thứ tự. */
  readonly applied: readonly string[];
}

/**
 * Dựng lớp phủ từ ảnh chụp `địa chỉ → UTxO` vừa đọc từ nhà cung cấp. Một ref xuất hiện ở hai
 * địa chỉ (hoặc hai lần) ⇒ ném: ảnh chụp đã không nhất quán thì mọi thứ dựng trên nó cũng không.
 */
export function makeView(snapshot: ReadonlyMap<string, readonly UTxO[]>): ChainView {
  const seen = new Set<string>();
  const utxos: UTxO[] = [];
  for (const [addr, us] of snapshot) {
    for (const u of us) {
      if (u.address !== addr) {
        throw new Error(`FEED-CHAIN-002: ảnh chụp ${addr} chứa ${outRef(u)} của địa chỉ khác (${u.address}).`);
      }
      const r = outRef(u);
      if (seen.has(r)) throw new Error(`FEED-CHAIN-002: ảnh chụp có ${r} hai lần.`);
      seen.add(r);
      utxos.push(u);
    }
  }
  return { tracked: new Set(snapshot.keys()), utxos, applied: [] };
}

/**
 * Chồng hiệu ứng của một giao dịch lên lớp phủ: bỏ input đã tiêu, thêm output rơi vào địa chỉ
 * được theo dõi (output đi địa chỉ khác — LAMP về feeder, v.v. — bỏ qua, lớp phủ không hứa gì về
 * chúng). Trả lớp phủ MỚI; lớp cũ không đổi.
 */
export function applyTx(view: ChainView, eff: TxEffects): ChainView {
  if (!/^[0-9a-f]{64}$/.test(eff.txHash)) {
    throw new Error(`FEED-CHAIN-002: hash giao dịch '${eff.txHash}' không phải 32 byte hex.`);
  }
  if (view.applied.includes(eff.txHash)) {
    throw new Error(`FEED-CHAIN-002: giao dịch ${eff.txHash} đã chồng lên lớp phủ rồi.`);
  }
  if (eff.spent.length === 0) {
    // Giao dịch không input không tồn tại trên Cardano; mảng rỗng ở đây là hàm trích hiệu ứng hỏng.
    throw new Error(`FEED-CHAIN-002: giao dịch ${eff.txHash} không tiêu input nào — hiệu ứng trích sai.`);
  }
  const have = new Set(view.utxos.map(outRef));
  const spent = new Set<string>();
  for (const r of eff.spent) {
    if (!have.has(r)) {
      throw new Error(`FEED-CHAIN-002: giao dịch ${eff.txHash} tiêu ${r} mà lớp phủ không có ` +
        `(đã tiêu ở giao dịch trước, hoặc nằm ngoài các địa chỉ đang theo dõi).`);
    }
    if (spent.has(r)) throw new Error(`FEED-CHAIN-002: giao dịch ${eff.txHash} tiêu ${r} hai lần.`);
    spent.add(r);
  }
  const kept = view.utxos.filter((u) => !spent.has(outRef(u)));
  const keptRefs = new Set(kept.map(outRef));
  const added: UTxO[] = [];
  for (const u of eff.created) {
    if (u.txHash !== eff.txHash) {
      throw new Error(`FEED-CHAIN-002: output ${outRef(u)} mang txHash khác giao dịch ${eff.txHash}.`);
    }
    if (keptRefs.has(outRef(u))) throw new Error(`FEED-CHAIN-002: output ${outRef(u)} trùng ref đã có.`);
    keptRefs.add(outRef(u));
    if (view.tracked.has(u.address)) added.push(u);
  }
  return { tracked: view.tracked, utxos: [...kept, ...added], applied: [...view.applied, eff.txHash] };
}

/** UTxO hiện có ở `addr` theo lớp phủ. Địa chỉ không được theo dõi ⇒ ném (FEED-CHAIN-003), không trả []. */
export function viewUtxosAt(view: ChainView, addr: string): UTxO[] {
  if (!view.tracked.has(addr)) {
    throw new Error(`FEED-CHAIN-003: lớp phủ không theo dõi ${addr} — không trả lời được, không đoán là rỗng.`);
  }
  return view.utxos.filter((u) => u.address === addr);
}

/** `viewUtxosAt` lọc theo một unit (số lượng > 0) — thay cho `utxosAtWithUnit` của nhà cung cấp. */
export function viewUtxosAtWithUnit(view: ChainView, addr: string, unit: string): UTxO[] {
  return viewUtxosAt(view, addr).filter((u) => (u.assets[unit] ?? 0n) > 0n);
}

/**
 * Carrier (UTxO mang đúng 1 NFT `unit`) ở `addr` theo lớp phủ. Khác 1 ⇒ ném FEED-CHAIN-005: ở
 * giữa chuỗi, 0 hay 2 carrier nghĩa là lớp phủ đã lệch khỏi luật singleton của kho — gửi tiếp là
 * gửi một giao dịch chắc chắn hỏng. Không thay `pickTreasury` (TRSY-001/002 vẫn chạy ở runner);
 * hàm này cho ref carrier mà bước đọc lại phải thấy trên nhà cung cấp.
 */
export function viewCarrier(view: ChainView, addr: string, unit: string): UTxO {
  const cs = viewUtxosAt(view, addr).filter((u) => (u.assets[unit] ?? 0n) === 1n);
  if (cs.length !== 1) {
    throw new Error(`FEED-CHAIN-005: lớp phủ thấy ${cs.length} carrier ${unit} ở ${addr}, cần đúng 1.`);
  }
  return cs[0]!;
}

/**
 * Nhà cung cấp đã bắt kịp chuỗi chưa: mọi ref trong `mustSee` có mặt và không ref nào trong
 * `mustNotSee` (input chuỗi đã tiêu) còn hiện. Dùng sau khi giao dịch CUỐI vào block, trước khi
 * mở chuỗi kế — chỉ mục trễ một block thì lượt kế dựng trên carrier đã chết.
 */
export function providerCaughtUp(seen: readonly UTxO[], mustSee: readonly string[],
                                 mustNotSee: readonly string[]): boolean {
  const refs = new Set(seen.map(outRef));
  return mustSee.every((r) => refs.has(r)) && mustNotSee.every((r) => !refs.has(r));
}

/** Mọi input mà các giao dịch của chuỗi đã tiêu, theo thứ tự — để bước đọc lại soát "đã biến mất". */
export function spentByChain(effects: readonly TxEffects[]): string[] {
  return effects.flatMap((e) => e.spent);
}

/**
 * Còn được DỰNG thêm một giao dịch trong cửa sổ `w` của chuỗi không. Cả chuỗi dùng MỘT `w`
 * (tính một lần lúc mở chuỗi) để mọi giao dịch cùng cửa sổ với kế hoạch. Không dựng khi:
 *   · `now` đã rời cửa sổ của `w` (nhãn cửa sổ trong datum/kế hoạch sẽ sai);
 *   · `now + marginMs > w.hiMs` — giao dịch dựng xong chưa chắc tới node trước đầu trên;
 *   · `w` tự nó vắt qua biên cửa sổ (không thể với `epochWindow`, nhưng rẻ để chặn).
 * Trả lý do (chuỗi) khi KHÔNG được dựng, `null` khi được.
 */
export function chainWindowBlock(w: { loMs: bigint; hiMs: bigint; epoch: bigint }, msPerEpoch: bigint,
                                 windowOriginMs: bigint, nowMs: bigint, marginMs: bigint): string | null {
  if (msPerEpoch <= 0n) throw new Error(`FEED-CHAIN-004: msPerEpoch phải > 0 (đang ${msPerEpoch}).`);
  // Cửa sổ = `(t − window_origin_ms) / ms_per_epoch` (Specs/Window/CONTRACT.md v1.0). Mốc TRƯỚC gốc
  // phải chặn riêng: chia BigInt cắt về 0 nên `(t − o) / m` trả 0 cho cả dải `(o − m, o)` — một
  // nhãn "cửa sổ 0" giả cho thời điểm chưa thuộc cửa sổ nào.
  if (w.loMs < windowOriginMs || w.hiMs < windowOriginMs) {
    return `khoảng [${w.loMs}, ${w.hiMs}] nằm TRƯỚC gốc cửa sổ ${windowOriginMs}`;
  }
  if (nowMs < windowOriginMs) return `đồng hồ ${nowMs} nằm TRƯỚC gốc cửa sổ ${windowOriginMs}`;
  if (w.loMs > w.hiMs) return `khoảng hiệu lực âm [${w.loMs}, ${w.hiMs}]`;
  const nowWindow = (nowMs - windowOriginMs) / msPerEpoch;
  if ((w.loMs - windowOriginMs) / msPerEpoch !== w.epoch || (w.hiMs - windowOriginMs) / msPerEpoch !== w.epoch) {
    return `khoảng [${w.loMs}, ${w.hiMs}] vắt ra ngoài cửa sổ ${w.epoch}`;
  }
  if (nowWindow !== w.epoch) return `đồng hồ đã sang cửa sổ ${nowWindow}, chuỗi mở ở ${w.epoch}`;
  if (nowMs < w.loMs) return `đồng hồ ${nowMs} trước đầu dưới ${w.loMs}`;
  if (nowMs + marginMs > w.hiMs) return `còn < ${marginMs} ms tới đầu trên ${w.hiMs}`;
  return null;
}
