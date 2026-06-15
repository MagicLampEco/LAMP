// PlatformKit · collectAdapter sinh CollectItem đúng + lọc null + chặn amount âm.

import { describe, it, expect } from "vitest";
import {
  eventToCollectItem, eventsToCollectItems,
  type FeeEvent, type PriceFn,
} from "../offchain/src/collectAdapter.js";

const ADA = { policy: "", name: "" };

const fixedPrice: PriceFn = (ev: FeeEvent) => {
  if (ev.eventType === "skip") return null;
  if (ev.eventType === "neg") return { asset: ADA, amount: -1n, bucketCategory: 0n };
  return { asset: ADA, amount: 1_000_000n, bucketCategory: 2n };
};

describe("eventToCollectItem", () => {
  it("dịch event → CollectItem đúng field (app_id, asset, amount, category)", () => {
    const item = eventToCollectItem(
      { eventType: "pay", payer: "ab".repeat(28) }, fixedPrice,
    );
    expect(item).toEqual({
      app_id: "ab".repeat(28), policy: "", name: "", amount: 1_000_000n, category: 2n,
    });
  });

  it("priceFn trả null → item null (event không thu phí)", () => {
    expect(eventToCollectItem({ eventType: "skip", payer: "ab".repeat(28) }, fixedPrice)).toBeNull();
  });

  it("amount âm → ném lỗi (chống drain)", () => {
    expect(() => eventToCollectItem({ eventType: "neg", payer: "ab".repeat(28) }, fixedPrice))
      .toThrow(/âm/);
  });

  it("payer được chuẩn hoá hex lowercase + strip 0x", () => {
    const item = eventToCollectItem({ eventType: "pay", payer: "0xABCDEF" }, fixedPrice);
    expect(item?.app_id).toBe("abcdef");
  });
});

describe("eventsToCollectItems", () => {
  it("lọc bỏ event null, giữ thứ tự", () => {
    const events: FeeEvent[] = [
      { eventType: "pay", payer: "11".repeat(28) },
      { eventType: "skip", payer: "22".repeat(28) },
      { eventType: "pay", payer: "33".repeat(28) },
    ];
    const items = eventsToCollectItems(events, fixedPrice);
    expect(items.length).toBe(2);
    expect(items[0]!.app_id).toBe("11".repeat(28));
    expect(items[1]!.app_id).toBe("33".repeat(28));
  });
});
