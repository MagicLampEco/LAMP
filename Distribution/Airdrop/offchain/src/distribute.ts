// Airdrop distribution engine (§6.2) — tất định, bảo toàn oil.
//
// ─────────────────────────────────────────────────────────────────────────
// MỖI EPOCH e (chỉ pool ĐÃ ĐĂNG KÝ; S_p = Σ stake delegator trong pool p; S_tot = Σ S_p):
//
//   Delegator d ở pool p:  floor(B_del · s_d / S_tot)        (pro-rata stake TOÀN CỤC)
//   SPO của pool p:        floor(B_spo · S_p / S_tot)        — CHỈ khi pool đủ tư cách
//                          (sản xuất block trong epoch  ∧  S_p ≥ floor_stake)
//
//   • Sybil tách pool: vô hại — SPO chia theo S_p/S_tot, tách đôi ⇒ mỗi nửa nhận nửa.
//   • Pool không đủ tư cách: phần SPO của nó FORFEIT → leftover (về treasury), KHÔNG
//     chia cho pool khác (giữ tính trung lập + chống thông đồng "mượn block").
//   • Dư floor Delegator → ví stake lớn nhất; dư floor SPO (trong nhóm eligible) → pool
//     eligible stake lớn nhất. Tie → owner hex nhỏ nhất (tất định).
//
//   won_cumulative cộng dồn qua epoch ⇒ claim trễ vẫn đủ; leaf Merkle dùng cumulative.
//
//   Bất biến/epoch:  Σ wonThisEpoch + leftover == B_spo + B_del.

import type {
  EpochSnapshot, DistributeParams, AirdropEntitlement, PoolRegistration,
} from "./types.js";
import { buildMerkleTree, type MerkleTree } from "./merkle.js";

function normHex(h: string): string {
  return (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
}

/** stake giảm dần, tie → owner hex tăng dần. */
function byStakeDescOwnerAsc(a: [string, bigint], b: [string, bigint]): number {
  if (a[1] !== b[1]) return a[1] > b[1] ? -1 : 1;
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

export interface EpochDistribution {
  epoch: bigint;
  /** Union mọi owner có cumulative > 0 (sort owner hex asc) — leaf set của Merkle epoch này. */
  entitlements: AirdropEntitlement[];
  /** oil forfeit (pool SPO không đủ tư cách) — về treasury. */
  leftover: bigint;
  /** Σ wonThisEpoch. */
  distributed: bigint;
  /** cumulative đầy đủ (mọi owner) để chain sang epoch sau. */
  cumulative: Map<string, bigint>;
}

/** Phân phối 1 epoch. prevCumulative = cumulative SAU epoch trước (rỗng nếu epoch đầu). */
export function distributeEpoch(
  snapshot: EpochSnapshot,
  params: DistributeParams,
  prevCumulative: ReadonlyMap<string, bigint> = new Map(),
): EpochDistribution {
  const { spoBudgetOil, delegatorBudgetOil, floorStake } = params;
  if (spoBudgetOil < 0n || delegatorBudgetOil < 0n) throw new Error("DIST-000: budget ≥ 0");
  if (floorStake < 0n) throw new Error("DIST-004: floorStake ≥ 0");

  // pool đã đăng ký TÍNH ĐẾN epoch này — dedup pool_id TẤT ĐỊNH (KHÔNG throw).
  // on-chain airdrop_registry R1 chỉ kiểm trong-1-tx; NFT registry bất biến, không state
  // thread ⇒ KHÔNG chặn được mint lại cùng pool_id ở tx khác. Đăng ký TRÙNG là hợp lệ về
  // ledger, nên throw ở đây = 1 tx mint-trùng rẻ tiền làm SẬP cả epoch cho MỌI pool (DoS).
  // Luật dedup: earliest-registration wins (epochRegistered nhỏ nhất; hòa → giữ dòng gặp
  // trước theo thứ tự snapshot — ổn định) ⇒ đăng ký muộn KHÔNG ghi đè được pool đã đăng ký.
  // ponytail: dedup earliest-wins; anti-hijack đầy đủ (đối chiếu reward_owner với reward
  // account thật của pool) thuộc bộ dựng snapshot của committee, ngoài engine tất định này.
  // poolId chuẩn hoá normHex làm key (như owner) — chặn "ABCD" vs "abcd" lách dedup / lệch match.
  const registered = new Map<string, PoolRegistration>();
  for (const r of snapshot.registrations) {
    if (r.epochRegistered > snapshot.epoch) continue; // chưa tới hiệu lực
    const pid = normHex(r.poolId);
    const prev = registered.get(pid);
    if (prev === undefined || r.epochRegistered < prev.epochRegistered) registered.set(pid, r);
  }
  const blockOf = new Map<string, boolean>();
  for (const s of snapshot.poolStatus) blockOf.set(normHex(s.poolId), s.producedBlock);

  // S_p (chỉ pool đã đăng ký) + S_tot
  const Sp = new Map<string, bigint>();
  const delegatorRows: { owner: string; stake: bigint }[] = [];
  for (const d of snapshot.delegators) {
    const pid = normHex(d.poolId);
    if (!registered.has(pid)) continue; // pool chưa đăng ký → delegator không tính
    if (d.stake <= 0n) continue;
    delegatorRows.push({ owner: normHex(d.owner), stake: d.stake });
    Sp.set(pid, (Sp.get(pid) ?? 0n) + d.stake);
  }
  let Stot = 0n;
  for (const v of Sp.values()) Stot += v;

  const thisEpoch = new Map<string, bigint>();
  let leftover = 0n;

  if (Stot === 0n) {
    leftover = spoBudgetOil + delegatorBudgetOil; // không ai đủ điều kiện
  } else {
    // ── Delegator: floor(B_del · s_d / S_tot), gộp theo owner; dư → ví lớn nhất ──
    const delByOwner = new Map<string, bigint>();
    const stakeByOwner = new Map<string, bigint>();
    for (const r of delegatorRows) {
      delByOwner.set(r.owner, (delByOwner.get(r.owner) ?? 0n) + (delegatorBudgetOil * r.stake) / Stot);
      stakeByOwner.set(r.owner, (stakeByOwner.get(r.owner) ?? 0n) + r.stake);
    }
    let delSum = 0n;
    for (const v of delByOwner.values()) delSum += v;
    const delDust = delegatorBudgetOil - delSum; // ≥ 0
    if (delDust > 0n) {
      const target = [...stakeByOwner.entries()].sort(byStakeDescOwnerAsc)[0]![0];
      delByOwner.set(target, (delByOwner.get(target) ?? 0n) + delDust);
    }
    for (const [o, v] of delByOwner) thisEpoch.set(o, (thisEpoch.get(o) ?? 0n) + v);

    // ── SPO: chỉ pool đủ tư cách (block ∧ S_p ≥ floor); floor(B_spo · S_p / S_tot) ──
    let eligibleStakeTot = 0n;
    const spoByOwner = new Map<string, bigint>();
    const eligiblePools: { owner: string; sp: bigint }[] = [];
    for (const [poolId, sp] of Sp) {
      const eligible = (blockOf.get(poolId) ?? false) && sp >= floorStake;
      if (!eligible) continue;
      eligibleStakeTot += sp;
      const owner = normHex(registered.get(poolId)!.spoRewardOwner);
      spoByOwner.set(owner, (spoByOwner.get(owner) ?? 0n) + (spoBudgetOil * sp) / Stot);
      eligiblePools.push({ owner, sp });
    }
    let spoSum = 0n;
    for (const v of spoByOwner.values()) spoSum += v;
    // tổng phần eligible "đáng nhận" (gồm dư floor nội bộ); phần còn lại = forfeit → leftover.
    const eligibleShareTotal = (spoBudgetOil * eligibleStakeTot) / Stot;
    const spoDust = eligibleShareTotal - spoSum; // ≥ 0 (dư floor giữa các pool eligible)
    if (spoDust > 0n && eligiblePools.length > 0) {
      const tgt = [...eligiblePools]
        .sort((a, b) => (a.sp !== b.sp ? (a.sp > b.sp ? -1 : 1) : a.owner < b.owner ? -1 : 1))[0]!.owner;
      spoByOwner.set(tgt, (spoByOwner.get(tgt) ?? 0n) + spoDust);
    }
    for (const [o, v] of spoByOwner) thisEpoch.set(o, (thisEpoch.get(o) ?? 0n) + v);

    leftover = spoBudgetOil - eligibleShareTotal; // forfeit pool không đủ tư cách + floor remainder
  }

  let distributed = 0n;
  for (const v of thisEpoch.values()) distributed += v;

  // cumulative union (prev + thisEpoch)
  const cumulative = new Map<string, bigint>(prevCumulative);
  for (const [o, v] of thisEpoch) cumulative.set(o, (cumulative.get(o) ?? 0n) + v);

  const entitlements: AirdropEntitlement[] = [...cumulative.entries()]
    .map(([owner, wonCumulative]) => ({ owner, wonThisEpoch: thisEpoch.get(owner) ?? 0n, wonCumulative }))
    .filter((e) => e.wonCumulative > 0n)
    .sort((a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0));

  return { epoch: snapshot.epoch, entitlements, leftover, distributed, cumulative };
}

/** Merkle tree (root + proof) của 1 epoch từ entitlement cumulative. */
export function epochMerkle(entitlements: AirdropEntitlement[]): MerkleTree {
  return buildMerkleTree(entitlements.map((e) => ({ owner: e.owner, wonCumulative: e.wonCumulative })));
}

export interface AirdropEpochOutput extends EpochDistribution {
  /** root để committee post lên beacon epoch này (§6.2). */
  rootHex: string;
  proofs: Map<string, string[]>;
}

/** Chạy nhiều epoch liên tiếp: fold cumulative + build Merkle mỗi epoch.
 *  params: 1 DistributeParams dùng chung, hoặc 1 mảng theo từng epoch. */
export function runAirdrop(
  snapshots: EpochSnapshot[],
  params: DistributeParams | DistributeParams[],
): AirdropEpochOutput[] {
  const out: AirdropEpochOutput[] = [];
  let cumulative: Map<string, bigint> = new Map();
  snapshots.forEach((snap, i) => {
    const p = Array.isArray(params) ? params[i]! : params;
    const dist = distributeEpoch(snap, p, cumulative);
    cumulative = dist.cumulative;
    const tree = dist.entitlements.length > 0
      ? epochMerkle(dist.entitlements)
      : { rootHex: "", proofs: new Map<string, string[]>(), leafCount: 0 };
    out.push({ ...dist, rootHex: tree.rootHex, proofs: tree.proofs });
  });
  return out;
}
