// _refillReadback.ts — RFL-010: đọc lại giao dịch Refill ĐÃ DỰNG, không tin số builder đã TÍNH.
//
// `refillBuilder.ts` tính `mergedAssets` rồi gọi `pay.ToAddressWithData(addr, datum, mergedAssets)`.
// `@lucid-evolution/lucid` (`Pay.ts ▸ ToAddressWithData`) dựng output bằng
// `with_asset_and_min_required_coin(...)` TRƯỚC — tức bằng MIN-ADA của bó tài sản — và chỉ thay
// bằng value mình khai khi lovelace mình khai LỚN HƠN HẲN min-ADA đó. Khai bằng hoặc nhỏ hơn ⇒
// Lucid ÂM THẦM nâng lovelace output lên min-ADA, không báo gì. `treasury.ak:232` ép value ra ==
// Σ value vào TUYỆT ĐỐI, nên một output bị nâng lovelace là một tx CHẮC CHẮN fail trên chuỗi —
// và `RefillResult.summary` vẫn in ra đúng con số ĐÃ TÍNH, không phải con số Lucid thật sự DỰNG.
//
// Khai theo HÌNH DẠNG (không import kiểu của lucid), cùng lý do `_custodySeedRef.ts` đã ghi:
// tệp này không kéo theo `config.ts` (đọc env ngay lúc nạp module), và một giao diện hình dạng
// thì bài kiểm dựng stub được mà không cần một giao dịch thật.

export interface BuiltTxOutputs {
  toTransaction(): {
    body(): {
      outputs(): {
        len(): number;
        get(i: number): {
          address(): { to_bech32(prefix?: string): string };
          amount(): { coin(): bigint };
        };
      };
    };
  };
}

/** Đếm output ở `diaChi` và tổng lovelace của chúng, đọc từ giao dịch ĐÃ DỰNG (không phải đã tính). */
export function outputsAt(tx: BuiltTxOutputs, diaChi: string): { count: number; lovelace: bigint } {
  const outs = tx.toTransaction().body().outputs();
  let count = 0;
  let lovelace = 0n;
  for (let i = 0; i < outs.len(); i++) {
    const o = outs.get(i);
    if (o.address().to_bech32(undefined) !== diaChi) continue;
    count += 1;
    lovelace += o.amount().coin();
  }
  return { count, lovelace };
}

/**
 * CỔNG RFL-010 — output Refill ĐÃ DỰNG phải mang ĐÚNG số lovelace builder đã TÍNH.
 *
 * Gọi ngay sau `buildRefillTx(...)`, TRƯỚC khi ký hay in ra bất cứ thứ gì cho người vận hành
 * đọc — `summary` của builder in số đã TÍNH, không phải số Lucid đã DỰNG, nên nếu không đọc lại
 * ở đây thì người vận hành sẽ thấy một bản tóm tắt "đúng" ngay trước một giao dịch chắc chắn hỏng.
 *
 * @param lovelaceDaTinh `result.outputLovelace` từ `buildRefillTx`.
 */
export function assertRefillOutputMatches(
  tx: BuiltTxOutputs, diaChi: string, lovelaceDaTinh: bigint,
): void {
  const { count, lovelace } = outputsAt(tx, diaChi);
  if (count !== 1) {
    throw new Error(
      `RFL-010: giao dịch ĐÃ DỰNG có ${count} output ở địa chỉ kho, \`treasury.ak:198\` đòi ` +
      `ĐÚNG 1. Builder cho là đã dựng 1 — hai con số lệch nhau nghĩa là bề mặt Lucid đã đổi.`,
    );
  }
  if (lovelace !== lovelaceDaTinh) {
    throw new Error(
      `RFL-010: output ĐÃ DỰNG mang ${lovelace} lovelace, builder đã TÍNH ${lovelaceDaTinh}. ` +
      `Lucid thường tự nâng lovelace lên min-ADA khi bó tài sản gộp mang nhiều loại (nhiều UTxO ` +
      `rác ở địa chỉ kho cộng vào). \`treasury.ak:232\` ép value ra == Σ value vào TUYỆT ĐỐI ⇒ ` +
      `tx này CHẮC CHẮN fail trên chuỗi và mất collateral. Bỏ UTxO rác khỏi tập gộp, hoặc thêm ` +
      `một UTxO nhiều ADA hơn vào REFILL_INPUTS.`,
    );
  }
}
