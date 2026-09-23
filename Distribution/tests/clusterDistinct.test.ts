// Distribution/tests/clusterDistinct.test.ts — hai cụm KHÔNG được ra cùng địa chỉ.
//
// Cổng `DEPLOYED-POT-002/003/004/005` gác TỆP trạng thái: chúng bắt được lượt đọc nhầm tệp của
// pot khác. Chúng KHÔNG bắt được ca hai cụm dựng ra cùng script hash — lúc đó mỗi tệp tự khai
// đúng pot của nó và cả bốn cổng đều xanh, trong khi hai pot đang dùng chung một cái kho.
//
// Ca đó không phải giả thuyết: `01_deploy` KHÔNG gửi giao dịch nào, nên `pickGenesisRef` (sắp
// xếp UTxO ví rồi lấy phần tử đầu) trả CÙNG một giá trị ở hai lượt chạy liên tiếp. Mã pot không
// đi vào một apply-param nào của ba validator, nên genesis ref là thứ DUY NHẤT phân biệt hai cụm.
//
// Tệp này đo đúng đại lượng còn lại: script hash.

import { describe, it, expect, afterEach } from "vitest";
import { writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

process.env.NETWORK ??= "Preprod";
process.env.POT ??= "wakeme";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts");
const SIBLING = resolve(SCRIPTS, "deployed.Preprod.zz-fixture.json");

const { assertClusterDistinct, siblingClusters } = await import("../scripts/config.js");
type State = Parameters<typeof assertClusterDistinct>[0];

/** Mọi hash là tham số — một mẫu gõ cứng hash nào đó làm ca âm tính đỏ vì lý do sai. */
function cluster(pot: string, claim: string, beacon: string, treasury: string): State {
  return {
    network: "Preprod", pot, potBudgetOildrop: "0", msPerEpoch: "432000000",
    committee: { keyHashes: ["00".repeat(28)], threshold: 1, source: "fixture" },
    claimAccount: { hash: claim, address: "addr_fixture" },
    beacon:       { hash: beacon, address: "addr_fixture" },
    treasury:     { hash: treasury, address: "addr_fixture" },
    params: {
      msPerEpoch: "432000000", lampPolicy: "", lampName: "", beaconNftPolicy: "",
      treasuryNftPolicy: "", accountNftPolicy: "", claimAccountHash: claim,
    },
    beaconNftGenesisRef:   { txHash: "de".repeat(32), outputIndex: 0 },
    treasuryNftGenesisRef: { txHash: "de".repeat(32), outputIndex: 1 },
  } as State;
}

const A_CLAIM = "a1".repeat(28);
const A_BEACON = "a2".repeat(28);
const A_TREASURY = "a3".repeat(28);

async function layDownSibling(): Promise<void> {
  await writeFile(SIBLING, JSON.stringify(cluster("zz-fixture", A_CLAIM, A_BEACON, A_TREASURY), null, 2));
}

afterEach(async () => { await unlink(SIBLING).catch(() => {}); });

describe("hai cụm không được ra cùng địa chỉ", () => {
  it("đọc được cụm anh em cùng mạng, kèm các genesis ref nó đã nhận", async () => {
    await layDownSibling();
    const sibs = await siblingClusters("wakeme");
    const fixture = sibs.find((s) => s.pot === "zz-fixture");
    // Ca này đứng trước mọi ca khác: nó chứng minh phép đo còn NHÌN THẤY cụm anh em.
    // Một danh sách rỗng làm mọi ca dưới xanh mà không kiểm gì.
    expect(fixture, "không thấy tệp cụm anh em vừa đặt xuống").toBeDefined();
    expect(fixture!.genesisRefs).toHaveLength(2);
  });

  it.each([
    ["claim_account", A_CLAIM,      "b2".repeat(28), "b3".repeat(28)],
    ["beacon",        "b1".repeat(28), A_BEACON,     "b3".repeat(28)],
    ["treasury",      "b1".repeat(28), "b2".repeat(28), A_TREASURY],
  ])("ném khi trùng %s hash", async (_ten, claim, beacon, treasury) => {
    await layDownSibling();
    await expect(
      assertClusterDistinct(cluster("wakeme", claim, beacon, treasury)),
    ).rejects.toThrow(/CLUSTER-DISTINCT-001/);
  });

  it("KHÔNG ném khi cả ba hash đều khác — ca âm tính", async () => {
    await layDownSibling();
    await expect(
      assertClusterDistinct(cluster("wakeme", "b1".repeat(28), "b2".repeat(28), "b3".repeat(28))),
    ).resolves.toBeUndefined();
  });

  it("không có cụm anh em nào thì không ném", async () => {
    await expect(
      assertClusterDistinct(cluster("wakeme", A_CLAIM, A_BEACON, A_TREASURY)),
    ).resolves.toBeUndefined();
  });
});
