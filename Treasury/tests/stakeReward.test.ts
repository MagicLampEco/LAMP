// Gương off-chain của nhánh `StakeRewardIn` — bài kiểm.
//
// Nguyên tắc viết ca ở đây: TRƯỚC khi hỏi "ca này xanh hay đỏ", hỏi "đầu vào của ca này có
// phân biệt được hai bên đột biến không?". Nên mỗi chốt có một ca âm CÔ LẬP — chỉ sai đúng
// thứ nó canh, mọi thứ khác hợp lệ — chứ không phải một ca sai nhiều thứ cùng lúc rồi đỏ.

import { describe, it, expect } from "vitest";
import { Data } from "@lucid-evolution/lucid";
import {
  STAKE_REWARD_BUCKET_ID, REWARD_POLICY, REWARD_NAME,
  valueOk, ledgerRewardOk, planStakeRewardLedger, planStakeRewardDatum,
} from "../offchain/src/stakeReward.js";
import { RESERVE_INFLOW_BUCKET_ID } from "../offchain/src/constants.js";
import { allItemsValid, noReservedBucketLines } from "../offchain/src/collect.js";
import {
  CUSTODY_REDEEMER, encodeCustodyRedeemer, decodeCustodyRedeemer, custodyRedeemerToCbor,
} from "../offchain/src/datum.js";
import type { CustodyDatum, LedgerEntry } from "../offchain/src/types.js";

const ADA = { policy: "", name: "" };
const LAMP = "aa".repeat(28);
const TLAMP = "744c414d50";

const baseDatum: CustodyDatum = {
  instance_id: "6b686f",
  accepted_assets: [ADA],
  ledger: [],
  cut_bps: 500n,
  governance_ref: "bb".repeat(28),
  epoch: 7n,
  consumed_proposals: [],
};

// ══ Hằng bucket ════════════════════════════════════════════════════════
describe("STAKE_REWARD_BUCKET_ID", () => {
  // Vế `toBeTypeOf("bigint")` không thừa, và nó đã bắt được một lỗi thật trong chính tệp
  // này: import một hằng từ module KHÔNG tái xuất nó cho ra `undefined` chứ KHÔNG ném, và
  // `bucket_id: undefined` lọt qua mọi vế `!==` phía dưới. Đó là trạng thái KHÔNG ĐO ĐƯỢC
  // đội lốt màu xanh — phải kêu ở đây, trước khi các ca dưới dựa vào hai hằng này.
  it("hai hằng bucket đọc ra được, đúng kiểu, và KHÔNG trùng nhau", () => {
    expect(STAKE_REWARD_BUCKET_ID).toBeTypeOf("bigint");
    expect(RESERVE_INFLOW_BUCKET_ID).toBeTypeOf("bigint");
    expect(STAKE_REWARD_BUCKET_ID).toBe(1_000_001n);
    expect(STAKE_REWARD_BUCKET_ID).not.toBe(RESERVE_INFLOW_BUCKET_ID);
  });

  it("asset thưởng là ADA — `reward_policy` on-chain là #\"\"", () => {
    expect(REWARD_POLICY).toBe("");
    expect(REWARD_NAME).toBe("");
  });
});

// ══ Redeemer index 4 ═══════════════════════════════════════════════════
describe("CustodyRedeemer StakeRewardIn", () => {
  it("Constr index 4, và bốn index cũ KHÔNG xê dịch", () => {
    expect(CUSTODY_REDEEMER.Collect).toBe(0);
    expect(CUSTODY_REDEEMER.Release).toBe(1);
    expect(CUSTODY_REDEEMER.Rebalance).toBe(2);
    expect(CUSTODY_REDEEMER.MigrateIn).toBe(3);
    expect(CUSTODY_REDEEMER.StakeRewardIn).toBe(4);
    expect(encodeCustodyRedeemer({ kind: "StakeRewardIn", amount: 1n }).index).toBe(4);
  });

  // Δ đi qua vòng encode→decode phải NGUYÊN: validator ép nó bằng ĐẲNG THỨC với độ tăng
  // lovelace thật, nên lệch một đơn vị là tx chết sau khi đã trả phí.
  it("round-trip giữ nguyên Δ", () => {
    const back = decodeCustodyRedeemer(Data.from(custodyRedeemerToCbor({ kind: "StakeRewardIn", amount: 1234567n })));
    expect(back).toEqual({ kind: "StakeRewardIn", amount: 1234567n });
  });

  it("Δ lớn (thưởng gộp nhiều kỷ nguyên) không mất chính xác qua CBOR", () => {
    const big = 9_876_543_210_123n;
    const back = decodeCustodyRedeemer(Data.from(custodyRedeemerToCbor({ kind: "StakeRewardIn", amount: big })));
    expect(back).toEqual({ kind: "StakeRewardIn", amount: big });
  });

  it("ĐỎ: Constr 5 (nhánh chưa tồn tại) bị từ chối, không đọc nhầm thành nhánh 4", () => {
    expect(() => decodeCustodyRedeemer(new (Data.from(custodyRedeemerToCbor(
      { kind: "StakeRewardIn", amount: 1n },
    )).constructor as never)(5, [1n]) as never)).toThrow(/TDATUM-124/);
  });
});

// ══ C-STK-7 value_ok ═══════════════════════════════════════════════════
describe("valueOk (C-STK-7)", () => {
  const lamp = [{ policy: LAMP, name: TLAMP, amount: 500n }];

  it("XANH: lovelace tăng ĐÚNG Δ, phi-lovelace nguyên", () => {
    expect(valueOk(2_000_000n, 2_300_000n, lamp, lamp, 300_000n)).toBe(true);
  });

  // Đây là ca phân biệt `==` với `>=`. Nới thành `>=` thì ca này thành XANH, và đó là
  // đúng cái lỗ "ADA vào sân kho mà không vào sổ" của MigrateIn.
  it("ĐỎ: lovelace tăng NHIỀU hơn Δ khai báo — `>=` sẽ cho qua, `==` thì không", () => {
    expect(valueOk(2_000_000n, 2_400_000n, lamp, lamp, 300_000n)).toBe(false);
  });

  it("ĐỎ: lovelace tăng ÍT hơn Δ khai báo", () => {
    expect(valueOk(2_000_000n, 2_200_000n, lamp, lamp, 300_000n)).toBe(false);
  });

  it("ĐỎ: LAMP bị rút bớt trong cùng tx", () => {
    expect(valueOk(2_000_000n, 2_300_000n, lamp, [{ policy: LAMP, name: TLAMP, amount: 400n }], 300_000n)).toBe(false);
  });

  it("ĐỎ: nhét token rác vào kho (phình UTxO)", () => {
    const junk = [...lamp, { policy: "cc".repeat(28), name: "ff", amount: 1n }];
    expect(valueOk(2_000_000n, 2_300_000n, lamp, junk, 300_000n)).toBe(false);
  });

  it("dòng amount 0 không làm lệch phép so phi-lovelace", () => {
    const withZero = [...lamp, { policy: "cc".repeat(28), name: "ff", amount: 0n }];
    expect(valueOk(2_000_000n, 2_300_000n, lamp, withZero, 300_000n)).toBe(true);
  });
});

// ══ C-STK-8 ledger_ok ══════════════════════════════════════════════════
describe("ledgerRewardOk (C-STK-8)", () => {
  const lin: LedgerEntry[] = [{ bucket_id: 1n, policy: LAMP, name: TLAMP, amount: 100n }];

  it("XANH: thêm dòng thưởng mới đúng Δ", () => {
    expect(ledgerRewardOk(lin, planStakeRewardLedger(lin, 300_000n), 300_000n)).toBe(true);
  });

  it("XANH: cộng vào dòng thưởng đã có — số DÒNG không tăng", () => {
    const once = planStakeRewardLedger(lin, 300_000n);
    const twice = planStakeRewardLedger(once, 200_000n);
    expect(twice.length).toBe(once.length);
    expect(ledgerRewardOk(once, twice, 200_000n)).toBe(true);
  });

  it("ĐỎ: sổ tăng khác Δ", () => {
    expect(ledgerRewardOk(lin, planStakeRewardLedger(lin, 300_001n), 300_000n)).toBe(false);
  });

  // Ca then chốt: số ĐÚNG, bucket SAI. Nếu luật chỉ kiểm "tổng tăng đúng Δ" thì ca này lọt.
  it("ĐỎ: Δ đúng nhưng rót vào bucket Reserve thay vì bucket thưởng", () => {
    const wrong = [...lin, { bucket_id: RESERVE_INFLOW_BUCKET_ID, ...ADA, amount: 300_000n }];
    expect(ledgerRewardOk(lin, wrong, 300_000n)).toBe(false);
  });

  it("ĐỎ: Δ đúng, bucket đúng, nhưng một dòng sổ KHÁC bị đổi cùng lúc", () => {
    const out = planStakeRewardLedger(lin, 300_000n)
      .map((e) => (e.bucket_id === 1n ? { ...e, amount: 99n } : e));
    expect(ledgerRewardOk(lin, out, 300_000n)).toBe(false);
  });

  it("ĐỎ: sổ ra không canonical (hai dòng trùng khoá)", () => {
    const out = [...planStakeRewardLedger(lin, 300_000n), { bucket_id: STAKE_REWARD_BUCKET_ID, ...ADA, amount: 0n }];
    expect(ledgerRewardOk(lin, out, 300_000n)).toBe(false);
  });
});

// ══ planStakeRewardDatum ═══════════════════════════════════════════════
describe("planStakeRewardDatum", () => {
  it("XANH: chỉ ledger + epoch đổi, mọi trường khác NGUYÊN", () => {
    const out = planStakeRewardDatum(baseDatum, 300_000n, 9n);
    expect(out.epoch).toBe(9n);
    expect(out.instance_id).toBe(baseDatum.instance_id);
    expect(out.cut_bps).toBe(baseDatum.cut_bps);
    expect(out.governance_ref).toBe(baseDatum.governance_ref);
    expect(out.accepted_assets).toEqual(baseDatum.accepted_assets);
    expect(out.consumed_proposals).toEqual([]);
  });

  // `consumed_proposals` là marker single-use của Release. Nhánh thưởng chạm vào nó là
  // mở đường vòng cho Release chi lại một proposal đã chi.
  it("consumed_proposals bảo toàn kể cả khi kho đã chi vài proposal", () => {
    const d = { ...baseDatum, consumed_proposals: ["11", "22"] };
    expect(planStakeRewardDatum(d, 1n, 7n).consumed_proposals).toEqual(["11", "22"]);
  });

  it("ĐỎ: kho gieo THIẾU ADA trong accepted_assets — kêu ngay, không im", () => {
    const d = { ...baseDatum, accepted_assets: [{ policy: LAMP, name: TLAMP }] };
    expect(() => planStakeRewardDatum(d, 1n, 7n)).toThrow(/TSTK-002/);
  });

  it("ĐỎ: epoch lùi", () => {
    expect(() => planStakeRewardDatum(baseDatum, 1n, 6n)).toThrow(/TSTK-003/);
  });

  it("XANH: epoch đứng yên (hai lượt trong cùng kỷ nguyên)", () => {
    expect(planStakeRewardDatum(baseDatum, 1n, 7n).epoch).toBe(7n);
  });

  it("ĐỎ: Δ == 0 và Δ < 0", () => {
    expect(() => planStakeRewardLedger([], 0n)).toThrow(/TSTK-001/);
    expect(() => planStakeRewardLedger([], -1n)).toThrow(/TSTK-001/);
  });
});

// ══ Hai đầu cưỡng chế hằng bucket (gương phải ĐẾM BẰNG on-chain) ═══════
describe("bucket thưởng bị cấm ở hai đầu, y như bucket Reserve", () => {
  it("Collect KHÔNG ghi được vào bucket thưởng", () => {
    const item = { category: STAKE_REWARD_BUCKET_ID, policy: "", name: "", amount: 1n };
    expect(allItemsValid([item], [ADA])).toBe(false);
  });

  it("Collect vào bucket thường vẫn qua — vế cấm không bắt oan", () => {
    expect(allItemsValid([{ category: 7n, policy: "", name: "", amount: 1n }], [ADA])).toBe(true);
  });

  it("sổ genesis KHÔNG khai khống được số dư thưởng", () => {
    expect(noReservedBucketLines([{ bucket_id: STAKE_REWARD_BUCKET_ID, ...ADA, amount: 1n }])).toBe(false);
  });

  it("sổ genesis vẫn cấm bucket Reserve — vế cũ không bị vế mới đè", () => {
    expect(noReservedBucketLines([{ bucket_id: RESERVE_INFLOW_BUCKET_ID, ...ADA, amount: 1n }])).toBe(false);
  });

  it("sổ genesis bucket thường vẫn qua", () => {
    expect(noReservedBucketLines([{ bucket_id: 1n, ...ADA, amount: 1n }])).toBe(true);
  });
});
