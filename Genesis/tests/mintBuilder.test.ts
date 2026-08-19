// mintBuilder — HAI nhánh validator (8 tham số mainnet / 12 tham số registry-gate),
// ràng buộc A-DEST, và cổng APPLY-001.
//
// Vì sao có tệp này: trước 2026-08-05 `buildMintTx` còn ở hình dạng v1/anchor — không
// `readFrom`, không biết registry/kho — nên MỌI tx nó dựng đều bị `lamp_mint` canonical
// từ chối, mà không test nào bắt được (module chưa từng có test builder). SuperApp bị
// chặn ở đó. Test dưới khoá lại hai điều: (1) A-DEST sai bị chặn Ở OFFCHAIN, trước khi
// tốn phí; (2) hai reference input là tham số BẮT BUỘC của hợp đồng gọi.
//
// 2026-08-16 — bản vá ngược lại cũng phải khoá. Sau lần vá trên, builder chỉ còn dựng
// được tx cho bản 12 tham số CHƯA PHÁT HÀNH: `.readFrom([registry, kho])` gọi VÔ ĐIỀU KIỆN.
// Mainnet đang chạy bản **8 tham số** (`deployed.ts:65`) — nó không đọc reference input nào,
// và dưới policy đó KHÔNG TỒN TẠI registry UTxO để mà truyền. Tức builder chắn ngang đường
// đúc LAMP thật. Nhóm test "nhánh 8 tham số" dưới khoá: dựng được KHÔNG ref-input, và TỪ
// CHỐI khi bị nhét ref-input vào (im lặng nuốt thì cái hiểu sai đi tiếp vào tích hợp).
//
// APPLY-001 nằm chung tệp (không tách file riêng) vì thư mục `tests/` không nhìn thấy
// `offchain/node_modules` — mỗi tệp test mới thêm một dòng đỏ TS2307 cho `npx tsc --noEmit`
// mà chẳng liên quan gì tới nội dung test.

import { describe, it, expect } from "vitest";
import {
  buildMintTx, readSupplyState,
  type MintParams, type MintParamsV8, type MintParamsV12,
} from "../offchain/src/mintBuilder.js";
import { assertParamCount } from "../offchain/src/applyGate.js";
import { supplyStateToCbor } from "../offchain/src/datum.js";
import { SUPPLY_NAME } from "../offchain/src/constants.js";
import { genesisSupplyState } from "../offchain/src/supplyState.js";
import type { UTxO } from "@lucid-evolution/lucid";

const THREAD_PID = "aa".repeat(28);
const LAMP_PID = "bb".repeat(28);
const REG_PID = "cc".repeat(28);
const KHO_PID = "dd".repeat(28);
const TOKEN_NAME = "744c414d50"; // "tLAMP"

const KHO_ADDR = "addr_test1wp352dwggnhckv369dj66htazjmpvtfl0v5aqn807pdp7gq2u06sl";
const VI_THUONG = "addr_test1qqh9u9qc4l2q9eyzx2c58pmpqn9vvxy2gjux0lah2wp33axx7cqq55f75fypagzqnelz3uzwxf764qzjx8kvaaw3q3yq8fyl7p";

function utxo(address: string, assets: Record<string, bigint>, datum?: string): UTxO {
  return {
    txHash: "00".repeat(32),
    outputIndex: 0,
    address,
    assets: { lovelace: 2_000_000n, ...assets },
    ...(datum === undefined ? {} : { datum }),
  } as UTxO;
}

// ── Lucid giả: ghi lại HÌNH DẠNG tx được dựng ────────────────────────────────
// Cần một cái để trả lời câu "nhánh 8 tham số có gắn reference input không?". Không kiểm
// được bằng cách bắt lỗi — tx hợp lệ thì không ném gì cả. Fake này ghi từng lời gọi.
interface TxTrace {
  readFrom: unknown[][];
  toContract: { address: string; value: unknown }[];
  signers: string[];
  completed: number;
}

function fakeLucid(): { trace: TxTrace; lucid: MintParams["lucid"] } {
  const trace: TxTrace = { readFrom: [], toContract: [], signers: [], completed: 0 };
  const b: Record<string, unknown> = {};
  b.collectFrom = () => b;
  b.mintAssets = () => b;
  b.readFrom = (us: unknown[]) => { trace.readFrom.push(us); return b; };
  b.addSignerKey = (kh: string) => { trace.signers.push(kh); return b; };
  b.attach = { SpendingValidator: () => b, MintingPolicy: () => b };
  b.pay = {
    ToContract: (address: string, _datum: unknown, value: unknown) => {
      trace.toContract.push({ address, value });
      return b;
    },
  };
  b.complete = async () => { trace.completed += 1; return "TX-GIA"; };
  return { trace, lucid: { newTx: () => b } as unknown as MintParams["lucid"] };
}

function supplyUtxo(): UTxO {
  return utxo(
    "addr_test1wsupplystate",
    { [`${THREAD_PID}${SUPPLY_NAME}`]: 1n },
    supplyStateToCbor(genesisSupplyState()),
  );
}

/** Phần chung hai nhánh. `lucid` mặc định null — guard ném TRƯỚC `.newTx()`. */
function commonParams() {
  return {
    lucid: null as unknown as MintParams["lucid"],
    supplyUtxo: supplyUtxo(),
    supplyStateScript: { type: "PlutusV3", script: "00" } as MintParams["supplyStateScript"],
    supplyStateAddress: "addr_test1wsupplystate",
    tlampPolicy: { type: "PlutusV3", script: "00" } as MintParams["tlampPolicy"],
    tlampPolicyId: LAMP_PID,
    tokenName: TOKEN_NAME,
    threadPolicyId: THREAD_PID,
    route: "DistributionVest" as const,
    amount: 10_000n * 1_000_000n,
    recipient: KHO_ADDR,
    recipientDatum: "d87980",
    authoritySigners: ["ee".repeat(28)],
  };
}

/** Bản 12 tham số (registry-gate, CHƯA deploy) — hai reference input bắt buộc. */
function params12(overrides: Partial<MintParamsV12> = {}): MintParamsV12 {
  return {
    ...commonParams(),
    mintParamCount: 12,
    registryRefUtxo: utxo("addr_test1wregistry", { [`${REG_PID}524547`]: 1n }, "d87980"),
    registryNftPolicyId: REG_PID,
    khoRefUtxo: utxo(KHO_ADDR, { [`${KHO_PID}4b484f`]: 1n }),
    khoNftPolicyId: KHO_PID,
    ...overrides,
  };
}

/** Bản 8 tham số (bản mồi — ĐANG CHẠY MAINNET) — KHÔNG reference input, A-DEST tĩnh. */
function params8(overrides: Partial<MintParamsV8> = {}): MintParamsV8 {
  return {
    ...commonParams(),
    mintParamCount: 8,
    distDestAddress: KHO_ADDR,
    ...overrides,
  };
}

describe("buildMintTx — nhánh 8 tham số (bản ĐANG CHẠY mainnet)", () => {
  it("dựng được tx mà KHÔNG cần reference input nào", async () => {
    // Đây là ca chắn đường đúc LAMP thật: trước bản vá, builder gọi `.readFrom` vô điều
    // kiện nên chỗ gọi buộc phải bịa ra registry/kho UTxO — mà dưới policy 8 tham số
    // (55d3e01b…) không tồn tại cái nào.
    const { trace, lucid } = fakeLucid();
    const { nextState } = await buildMintTx(params8({ lucid }));

    expect(trace.readFrom).toHaveLength(0);          // ← điều kiện SỐNG CÒN của nhánh này
    expect(trace.completed).toBe(1);                 // tx đã .complete() thật, không ném giữa chừng
    expect(nextState.dist_minted).toBe(10_000n * 1_000_000n);
    // Vẫn rót vào kho kèm datum: SupplyState' + output kho.
    expect(trace.toContract).toHaveLength(2);
    expect(trace.toContract[1]?.address).toBe(KHO_ADDR);
    expect(trace.signers).toEqual(["ee".repeat(28)]);
  });

  it("TỪ CHỐI khi bị truyền khoRefUtxo (GMB-007)", async () => {
    const p = { ...params8(), khoRefUtxo: utxo(KHO_ADDR, { [`${KHO_PID}4b484f`]: 1n }) };
    await expect(buildMintTx(p as unknown as MintParams)).rejects.toThrow(/GMB-007/);
  });

  it("TỪ CHỐI khi bị truyền registryRefUtxo (GMB-007)", async () => {
    const p = { ...params8(), registryRefUtxo: utxo("addr_test1wregistry", {}, "d87980") };
    await expect(buildMintTx(p as unknown as MintParams)).rejects.toThrow(/GMB-007/);
  });

  it("TỪ CHỐI cả hai policy-id ref-input, và NÊU TÊN từng trường thừa", async () => {
    const p = { ...params8(), registryNftPolicyId: REG_PID, khoNftPolicyId: KHO_PID };
    await expect(buildMintTx(p as unknown as MintParams)).rejects.toThrow(
      /GMB-007[\s\S]*registryNftPolicyId[\s\S]*khoNftPolicyId/,
    );
  });

  it("GMB-007 chạy TRƯỚC mọi guard khác (nói đúng nguyên nhân gốc)", async () => {
    // Nhét ref-input VÀ recipient sai VÀ Δ vượt cap: lỗi phải là GMB-007, vì hình dạng lời
    // gọi sai thì mọi kiểm tra sau đó đang kiểm một hợp đồng khác.
    const s = genesisSupplyState();
    const p = {
      ...params8({ recipient: VI_THUONG, amount: s.dist_cap + 1n }),
      khoRefUtxo: utxo(VI_THUONG, {}),
    };
    await expect(buildMintTx(p as unknown as MintParams)).rejects.toThrow(/GMB-007/);
  });

  it("A-DEST vẫn được canh: recipient KHÁC distDestAddress bị chặn (GMB-004)", async () => {
    // Bản 8 tham số nướng `dist_dest` vào policy nên không có kho-NFT để đọc động — nguồn
    // đối chiếu là `distDestAddress` do chỗ gọi cấp (từ deployed.ts).
    await expect(
      buildMintTx(params8({ recipient: VI_THUONG })),
    ).rejects.toThrow(/GMB-004/);
  });

  it("thiếu distDestAddress ⇒ GMB-009, KHÔNG lặng lẽ bỏ qua A-DEST", async () => {
    const p = params8();
    delete (p as { distDestAddress?: string }).distDestAddress;
    await expect(buildMintTx(p)).rejects.toThrow(/GMB-009/);
  });

  it("recipientDatum vẫn BẮT BUỘC (GMB-006)", async () => {
    await expect(buildMintTx(params8({ recipientDatum: "" }))).rejects.toThrow(/GMB-006/);
  });
});

describe("buildMintTx — mintParamCount là hợp đồng gọi (GMB-008)", () => {
  it("thiếu mintParamCount ⇒ ném, KHÔNG đoán bản validator", async () => {
    const p = params12();
    delete (p as { mintParamCount?: number }).mintParamCount;
    await expect(buildMintTx(p)).rejects.toThrow(/GMB-008/);
  });

  it("số lạ (vd 10) ⇒ ném", async () => {
    const p = { ...params12(), mintParamCount: 10 };
    await expect(buildMintTx(p as unknown as MintParams)).rejects.toThrow(/GMB-008/);
  });

  it("kiểu TS chặn gọi sai nhánh ngay lúc biên dịch", () => {
    // @ts-expect-error — nhánh 8 CẤM khoRefUtxo (`?: never`). Nếu dòng này ngừng lỗi thì
    // hàng rào kiểu đã bị nới, và test sẽ đỏ ở `tsc` chứ không âm thầm mất.
    const sai: MintParamsV8 = { ...params8(), khoRefUtxo: utxo(KHO_ADDR, {}) };
    expect(sai.mintParamCount).toBe(8);

    // @ts-expect-error — nhánh 12 CẤM distDestAddress (A-DEST đọc động từ kho-NFT).
    const sai12: MintParamsV12 = { ...params12(), distDestAddress: KHO_ADDR };
    expect(sai12.mintParamCount).toBe(12);
  });
});

describe("buildMintTx — nhánh 12 tham số vẫn nguyên hành vi cũ", () => {
  it("GẮN đúng hai reference input vào tx", async () => {
    const { trace, lucid } = fakeLucid();
    const p = params12({ lucid });
    await buildMintTx(p);
    expect(trace.readFrom).toHaveLength(1);
    expect(trace.readFrom[0]).toEqual([p.registryRefUtxo, p.khoRefUtxo]);
  });

  it("registryRefUtxo + khoRefUtxo là tham số BẮT BUỘC", () => {
    // Khoá hình dạng: bỏ một trong hai là quay lại bản v1 hỏng-mọi-tx. TypeScript đã ép
    // ở chỗ gọi; khẳng định ở đây để lần refactor sau không lặng lẽ nới thành optional.
    const p = params12();
    expect(p.registryRefUtxo).toBeDefined();
    expect(p.khoRefUtxo).toBeDefined();
    expect(p.khoRefUtxo.address).toBe(p.recipient);
    // recipientDatum BẮT BUỘC — xem GMB-006. Đừng nới lại thành optional.
    expect(p.recipientDatum).toBeDefined();
  });
});

describe("buildMintTx — A-DEST", () => {
  it("chặn recipient KHÁC địa chỉ kho (GMB-004)", async () => {
    // Đây là ca đắt nhất nếu lọt: LAMP không burn được, rót nhầm chỗ là kẹt vĩnh viễn.
    await expect(buildMintTx(params12({ recipient: VI_THUONG }))).rejects.toThrow(/GMB-004/);
  });

  it("thông điệp lỗi nêu ĐỦ cả hai địa chỉ để đối chiếu", async () => {
    await expect(buildMintTx(params12({ recipient: VI_THUONG }))).rejects.toThrow(
      new RegExp(`${VI_THUONG}[\\s\\S]*${KHO_ADDR}`),
    );
  });

  it("fail-fast cap/quota chạy TRƯỚC guard A-DEST (Δ vượt cap bị bắt trước)", async () => {
    // Thứ tự có ý nghĩa: lỗi cap nói đúng nguyên nhân gốc, không bị guard địa chỉ che.
    const s = genesisSupplyState();
    await expect(
      buildMintTx(params12({ amount: s.dist_cap + 1n, recipient: VI_THUONG })),
    ).rejects.not.toThrow(/GMB-004/);
  });
});

describe("buildMintTx — no-datum LÀ MẤT TIỀN (GMB-006)", () => {
  // Ca đắt nhất TUYỆT ĐỐI trong builder này, và là ca DUY NHẤT mà chuỗi không cứu được:
  // kho là địa chỉ script; `lamp_mint` cấp phép A-DEST bằng `qty_to_script` — đếm theo
  // payment credential, KHÔNG nhìn datum — nên tx thiếu datum vẫn HỢP LỆ và mint thành
  // công. UTxO sinh ra thì `treasury.ak:27 expect Some(datum)` từ chối vĩnh viễn, mà LAMP
  // không burn được. Bản trước để `recipientDatum` là tuỳ chọn và mặc định rơi vào
  // `pay.ToAddress` — tức đường MẶC ĐỊNH là đường mất tiền.
  it("chặn khi thiếu recipientDatum", async () => {
    const p = params12();
    delete (p as { recipientDatum?: string }).recipientDatum;
    await expect(buildMintTx(p)).rejects.toThrow(/GMB-006/);
  });

  it("chặn khi recipientDatum rỗng", async () => {
    await expect(buildMintTx(params12({ recipientDatum: "" }))).rejects.toThrow(/GMB-006/);
  });
});

describe("buildMintTx — reference input phải THẬT (GMB-005)", () => {
  it("chặn khoRefUtxo không mang kho-NFT", async () => {
    // Ca này lọt qua GMB-004 vì recipient == khoRefUtxo.address — guard địa chỉ tự thoả
    // khi chính khoRefUtxo sai. Phải kiểm NFT mới bắt được.
    const fake = utxo(VI_THUONG, {});
    await expect(
      buildMintTx(params12({ khoRefUtxo: fake, recipient: VI_THUONG })),
    ).rejects.toThrow(/GMB-005/);
  });

  it("chặn registryRefUtxo không mang registry-NFT", async () => {
    await expect(
      buildMintTx(params12({ registryRefUtxo: utxo("addr_test1wregistry", {}, "d87980") })),
    ).rejects.toThrow(/GMB-005/);
  });

  it("GMB-005 chạy TRƯỚC GMB-004 (bắt đúng nguyên nhân gốc)", async () => {
    const fake = utxo(VI_THUONG, {});
    await expect(
      buildMintTx(params12({ khoRefUtxo: fake })),
    ).rejects.not.toThrow(/GMB-004/);
  });
});

describe("cổng APPLY-001 — apply thiếu tham số KHÔNG báo lỗi, nó đổi policy-id", () => {
  // Cổng đắt nhất trong Genesis: `applyParamsToScript` thiếu tham số vẫn trả về một script
  // hash KHÁC, im lặng. Đúc LAMP dưới policy-id sai là mất vĩnh viễn (LAMP không burn).
  it("ném khi truyền THIẾU tham số (8 vào validator 12 tham số)", () => {
    expect(() => assertParamCount("lamp_mint.lamp_mint.mint", 12, 8)).toThrow(/APPLY-001/);
  });

  it("ném khi truyền THỪA tham số (12 vào validator 8 tham số)", () => {
    expect(() => assertParamCount("lamp_mint.lamp_mint.mint", 8, 12)).toThrow(/APPLY-001/);
  });

  it("thông điệp nêu tên validator + cả hai con số để đối chiếu", () => {
    expect(() => assertParamCount("lamp_mint.lamp_mint.mint", 12, 8)).toThrow(
      /lamp_mint\.lamp_mint\.mint khai 12 tham số, chỗ gọi truyền 8/,
    );
  });

  it("im lặng khi khớp — cả 8 lẫn 12", () => {
    expect(() => assertParamCount("lamp_mint.lamp_mint.mint", 8, 8)).not.toThrow();
    expect(() => assertParamCount("lamp_mint.lamp_mint.mint", 12, 12)).not.toThrow();
  });
});

describe("readSupplyState", () => {
  it("đọc SupplyState từ inline datum", () => {
    const s = readSupplyState(supplyUtxo());
    expect(s.dist_minted).toBe(0n);
    expect(s.dist_cap).toBe(genesisSupplyState().dist_cap);
  });

  it("ném GMB-001 khi UTxO thiếu inline datum", () => {
    expect(() => readSupplyState(utxo(KHO_ADDR, {}))).toThrow(/GMB-001/);
  });
});
