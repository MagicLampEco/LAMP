// campaignParams.test.ts — luật của tham số đợt. Mọi ca ĐỎ ở đây là một đợt chia tiền
// theo con số không ai duyệt; nên tất cả đều là ca fail-closed, không phải ca tiện dụng.
import { describe, it, expect } from "vitest";
import { parseCampaignParams, SET_ROOT_MODES } from "../src/campaignParams.js";

/** Bản ghi tối thiểu ĐÚNG — mọi ca hỏng bên dưới đều bẻ đúng MỘT trường từ đây. */
const KHONG_CO_SEALED = Symbol("bo-han-khoi-sealed");

/** `sealed = KHONG_CO_SEALED` để BỎ HẲN khối. Không dùng `undefined`: truyền `undefined`
 *  cho một tham số CÓ mặc định thì JS lấy lại mặc định — ca "thiếu sealed" sẽ không bao
 *  giờ thiếu, và test xanh trong khi cổng chưa được sờ tới. */
function ok(
  overridePublic: Record<string, unknown> = {},
  sealed: unknown = { e_open: 654, e_cut: 666 },
) {
  const c: Record<string, unknown> = {
    id: "airdrop-v2",
    params: {
      public: {
        n_min_epochs: 2,
        cap_oildrop: null,
        set_root_mode: "hai-hu-rieng",
        pot_delegator_lamp: "100000000",
        pot_spo_lamp: "5000000",
        pot_cs_lamp: "15000000",
        excluded_file: "Airdrop/data/excluded-self.json",
        ...overridePublic,
      },
    },
  };
  if (sealed !== KHONG_CO_SEALED) (c.params as Record<string, unknown>).sealed = sealed;
  return [c];
}

describe("parseCampaignParams — bản ghi đúng", () => {
  it("đọc đủ 9 trường, giữ nguyên đơn vị", () => {
    const p = parseCampaignParams(ok(), "airdrop-v2");
    expect(p.eOpen).toBe(654);
    expect(p.eCut).toBe(666);
    expect(p.nMinEpochs).toBe(2);
    expect(p.capOildrop).toBeNull();
    expect(p.setRootMode).toBe("hai-hu-rieng");
    expect(p.potDelegatorLamp).toBe(100_000_000n);
    expect(p.potSpoLamp).toBe(5_000_000n);
    expect(p.potCsLamp).toBe(15_000_000n);
    expect(p.excludedFile).toBe("Airdrop/data/excluded-self.json");
  });

  it("ngân sách là bigint, KHÔNG number — 100 triệu LAMP = 1e14 oildrop vượt an toàn Number", () => {
    const p = parseCampaignParams(ok(), "airdrop-v2");
    expect(typeof p.potDelegatorLamp).toBe("bigint");
  });

  it("ba tên phương án SetRoot đều nhận được", () => {
    for (const m of SET_ROOT_MODES) {
      expect(parseCampaignParams(ok({ set_root_mode: m }), "airdrop-v2").setRootMode).toBe(m);
    }
  });
});

describe("parseCampaignParams — FAIL-CLOSED", () => {
  it("thiếu hẳn khối params ⇒ ném, KHÔNG rơi về mặc định", () => {
    expect(() => parseCampaignParams([{ id: "airdrop-v2" }], "airdrop-v2"))
      .toThrow(/chưa có khối `params.public`/);
  });

  it("thiếu `sealed` (cửa sổ đo) ⇒ ném — đọc nhầm bản public đã bị lược sẽ dừng ở đây", () => {
    expect(() => parseCampaignParams(ok({}, KHONG_CO_SEALED), "airdrop-v2"))
      .toThrow(/thiếu `params.sealed`/);
  });

  it("cửa sổ hẹp hơn N+1 ⇒ ném (§1.5: không chứa nổi chuỗi giữ)", () => {
    expect(() => parseCampaignParams(ok({ n_min_epochs: 5 }, { e_open: 660, e_cut: 665 }), "airdrop-v2"))
      .toThrow(/không chứa nổi chuỗi giữ 5 epoch/);
  });

  it("cửa sổ đảo ngược (e_cut < e_open) ⇒ ném", () => {
    expect(() => parseCampaignParams(ok({}, { e_open: 666, e_cut: 654 }), "airdrop-v2")).toThrow();
  });

  it("`set_root_mode` lạ ⇒ ném, có liệt kê ba tên hợp lệ", () => {
    expect(() => parseCampaignParams(ok({ set_root_mode: "B" }), "airdrop-v2"))
      .toThrow(/mot-so-chung \| hai-hu-rieng \| hu-thay-niem-moi-ky/);
  });

  it("`cap_oildrop` = \"0\" ⇒ ném — trần 0 khoá sạch pot, không phải 'không trần'", () => {
    expect(() => parseCampaignParams(ok({ cap_oildrop: "0" }), "airdrop-v2")).toThrow(/khoá sạch pot/);
  });

  it("`cap_oildrop` là số (không phải chuỗi) ⇒ ném — bigint không đi qua Number", () => {
    expect(() => parseCampaignParams(ok({ cap_oildrop: 1000 }), "airdrop-v2")).toThrow();
  });

  it("`excluded_file` bỏ trống kiểu sai ⇒ ném — 'không loại ai' phải là null tường minh", () => {
    expect(() => parseCampaignParams(ok({ excluded_file: "" }), "airdrop-v2")).not.toThrow();
    expect(() => parseCampaignParams(ok({ excluded_file: 0 }), "airdrop-v2")).toThrow(/phải là đường dẫn hoặc null/);
  });

  it("`e_open` không phải số nguyên ⇒ ném", () => {
    expect(() => parseCampaignParams(ok({}, { e_open: "654", e_cut: 666 }), "airdrop-v2"))
      .toThrow(/phải là số nguyên/);
  });

  it("sai id đợt ⇒ ném, có liệt kê id đang có", () => {
    expect(() => parseCampaignParams(ok(), "airdrop-v3")).toThrow(/Có: airdrop-v2/);
  });
});
