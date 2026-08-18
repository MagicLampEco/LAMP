// tests/epochTable.test.ts — bảng epoch của Airdrop KHÔNG được là một bản chép.
//
// Lỗi được vá ở đây: `Airdrop/offchain/src/constants.ts` khai lại bảng ms/epoch với
// `Preprod: 86_400_000n` (xếp Preprod cùng nhóm Preview), trong khi chú thích ngay trên nó
// tự xưng "khớp @magiclamp/utils". Bản chép lệch mang nhãn đã-đối-chiếu: trình biên dịch
// không kêu, không test nào đỏ, và nó trông y hệt một bảng đúng.
//
// Bản vá bỏ hẳn nơi khai thứ hai (tái xuất từ Utils). Bộ test này canh cho nó đừng bị
// khai lại lần nữa — chỗ lệch phải KÊU, chứ không phải chờ người đối chiếu bằng mắt.
import { describe, it, expect } from "vitest";
import { MS_PER_EPOCH_BY_NETWORK } from "../src/constants.js";
import {
  MS_PER_EPOCH_BY_NETWORK as UTILS_TABLE,
  SLOTS_PER_EPOCH_BY_NETWORK,
  MS_PER_SLOT,
  msPerEpoch,
  type Network,
} from "@magiclamp/utils";

const NETWORKS: Network[] = ["Preview", "Preprod", "Mainnet"];

describe("Airdrop ms/epoch — một nguồn, không có bản chép thứ hai", () => {
  it("bảng Airdrop KHỚP TỪNG MẠNG với @magiclamp/utils", () => {
    for (const n of NETWORKS) {
      expect(MS_PER_EPOCH_BY_NETWORK[n]).toBe(UTILS_TABLE[n]);
    }
  });

  it("không mạng nào bị thiếu ở bảng Airdrop — thiếu cũng là một dạng lệch", () => {
    expect(Object.keys(MS_PER_EPOCH_BY_NETWORK).sort()).toEqual([...NETWORKS].sort());
  });

  it("Preprod soi gương MAINNET, KHÔNG soi Preview — đây chính là con số cũ sai", () => {
    expect(MS_PER_EPOCH_BY_NETWORK.Preprod).toBe(432_000_000n);
    expect(MS_PER_EPOCH_BY_NETWORK.Preprod).toBe(MS_PER_EPOCH_BY_NETWORK.Mainnet);
    expect(MS_PER_EPOCH_BY_NETWORK.Preprod).not.toBe(MS_PER_EPOCH_BY_NETWORK.Preview);
    // Con số bản cũ ghi cho Preprod. Nếu ca này đỏ, ai đó vừa chép lại bảng.
    expect(MS_PER_EPOCH_BY_NETWORK.Preprod).not.toBe(86_400_000n);
  });

  it("khớp cả ShelleyGenesis: ms = epochLength × 1000 cho mọi mạng", () => {
    for (const n of NETWORKS) {
      expect(MS_PER_EPOCH_BY_NETWORK[n]).toBe(SLOTS_PER_EPOCH_BY_NETWORK[n] * MS_PER_SLOT);
    }
  });

  it("hàm msPerEpoch() và bảng Airdrop không được nói hai điều khác nhau", () => {
    for (const n of NETWORKS) {
      expect(MS_PER_EPOCH_BY_NETWORK[n]).toBe(msPerEpoch(n));
    }
  });
});
