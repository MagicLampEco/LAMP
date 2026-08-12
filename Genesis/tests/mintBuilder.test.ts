// mintBuilder — ràng buộc A-DEST + hình dạng tham số v2 (registry/kho reference input).
//
// Vì sao có tệp này: trước 2026-08-05 `buildMintTx` còn ở hình dạng v1/anchor — không
// `readFrom`, không biết registry/kho — nên MỌI tx nó dựng đều bị `lamp_mint` canonical
// từ chối, mà không test nào bắt được (module chưa từng có test builder). SuperApp bị
// chặn ở đó. Test dưới khoá lại hai điều: (1) A-DEST sai bị chặn Ở OFFCHAIN, trước khi
// tốn phí; (2) hai reference input là tham số BẮT BUỘC của hợp đồng gọi.

import { describe, it, expect } from "vitest";
import { buildMintTx, readSupplyState, type MintParams } from "../offchain/src/mintBuilder.js";
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

function params(overrides: Partial<MintParams> = {}): MintParams {
  const supplyUtxo = utxo(
    "addr_test1wsupplystate",
    { [`${THREAD_PID}${SUPPLY_NAME}`]: 1n },
    supplyStateToCbor(genesisSupplyState()),
  );
  return {
    // `lucid` không bao giờ được chạm trong các ca dưới — guard ném TRƯỚC `.newTx()`.
    lucid: null as unknown as MintParams["lucid"],
    supplyUtxo,
    supplyStateScript: { type: "PlutusV3", script: "00" } as MintParams["supplyStateScript"],
    supplyStateAddress: "addr_test1wsupplystate",
    tlampPolicy: { type: "PlutusV3", script: "00" } as MintParams["tlampPolicy"],
    tlampPolicyId: LAMP_PID,
    tokenName: TOKEN_NAME,
    threadPolicyId: THREAD_PID,
    route: "DistributionVest",
    amount: 10_000n * 1_000_000n,
    recipient: KHO_ADDR,
    recipientDatum: "d87980",
    registryRefUtxo: utxo("addr_test1wregistry", { [`${REG_PID}524547`]: 1n }, "d87980"),
    registryNftPolicyId: REG_PID,
    khoRefUtxo: utxo(KHO_ADDR, { [`${KHO_PID}4b484f`]: 1n }),
    khoNftPolicyId: KHO_PID,
    authoritySigners: ["ee".repeat(28)],
    ...overrides,
  };
}

describe("buildMintTx — A-DEST", () => {
  it("chặn recipient KHÁC địa chỉ kho (GMB-004)", async () => {
    // Đây là ca đắt nhất nếu lọt: LAMP không burn được, rót nhầm chỗ là kẹt vĩnh viễn.
    await expect(buildMintTx(params({ recipient: VI_THUONG }))).rejects.toThrow(/GMB-004/);
  });

  it("thông điệp lỗi nêu ĐỦ cả hai địa chỉ để đối chiếu", async () => {
    await expect(buildMintTx(params({ recipient: VI_THUONG }))).rejects.toThrow(
      new RegExp(`${VI_THUONG}[\\s\\S]*${KHO_ADDR}`),
    );
  });

  it("fail-fast cap/quota chạy TRƯỚC guard A-DEST (Δ vượt cap bị bắt trước)", async () => {
    // Thứ tự có ý nghĩa: lỗi cap nói đúng nguyên nhân gốc, không bị guard địa chỉ che.
    const s = genesisSupplyState();
    await expect(
      buildMintTx(params({ amount: s.dist_cap + 1n, recipient: VI_THUONG })),
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
    const p = params();
    delete (p as { recipientDatum?: string }).recipientDatum;
    await expect(buildMintTx(p)).rejects.toThrow(/GMB-006/);
  });

  it("chặn khi recipientDatum rỗng", async () => {
    await expect(buildMintTx(params({ recipientDatum: "" }))).rejects.toThrow(/GMB-006/);
  });
});

describe("buildMintTx — reference input phải THẬT (GMB-005)", () => {
  it("chặn khoRefUtxo không mang kho-NFT", async () => {
    // Ca này lọt qua GMB-004 vì recipient == khoRefUtxo.address — guard địa chỉ tự thoả
    // khi chính khoRefUtxo sai. Phải kiểm NFT mới bắt được.
    const fake = utxo(VI_THUONG, {});
    await expect(
      buildMintTx(params({ khoRefUtxo: fake, recipient: VI_THUONG })),
    ).rejects.toThrow(/GMB-005/);
  });

  it("chặn registryRefUtxo không mang registry-NFT", async () => {
    await expect(
      buildMintTx(params({ registryRefUtxo: utxo("addr_test1wregistry", {}, "d87980") })),
    ).rejects.toThrow(/GMB-005/);
  });

  it("GMB-005 chạy TRƯỚC GMB-004 (bắt đúng nguyên nhân gốc)", async () => {
    const fake = utxo(VI_THUONG, {});
    await expect(
      buildMintTx(params({ khoRefUtxo: fake })),
    ).rejects.not.toThrow(/GMB-004/);
  });
});

describe("buildMintTx — hợp đồng tham số v2", () => {
  it("registryRefUtxo + khoRefUtxo là tham số BẮT BUỘC", () => {
    // Khoá hình dạng: bỏ một trong hai là quay lại bản v1 hỏng-mọi-tx. TypeScript đã ép
    // ở chỗ gọi; khẳng định ở đây để lần refactor sau không lặng lẽ nới thành optional.
    const p = params();
    expect(p.registryRefUtxo).toBeDefined();
    expect(p.khoRefUtxo).toBeDefined();
    expect(p.khoRefUtxo.address).toBe(p.recipient);
    // recipientDatum BẮT BUỘC — xem GMB-006. Đừng nới lại thành optional.
    expect(p.recipientDatum).toBeDefined();
  });
});

describe("readSupplyState", () => {
  it("đọc SupplyState từ inline datum", () => {
    const s = readSupplyState(params().supplyUtxo);
    expect(s.dist_minted).toBe(0n);
    expect(s.dist_cap).toBe(genesisSupplyState().dist_cap);
  });

  it("ném GMB-001 khi UTxO thiếu inline datum", () => {
    expect(() => readSupplyState(utxo(KHO_ADDR, {}))).toThrow(/GMB-001/);
  });
});
