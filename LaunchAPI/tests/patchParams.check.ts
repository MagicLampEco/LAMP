// patchParams.check.ts — PATCH một tham số công khai KHÔNG được làm mất cửa sổ đo.
//
// Chạy: npm run check:patch
//
// Bẫy đang gác: `patchCampaign` gộp NÔNG. `params` là khối lồng, nên
// `{params:{public:{…}}}` gửi từ giao diện sẽ THAY nguyên khối `params` và cuốn theo
// `sealed`. Mất lặng lẽ, mất đúng thứ quyết định ai được chia tiền, và không ai bấm nút xoá.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "lampapi-"));
const file = join(dir, "campaigns.json");
const seed = [{
  id: "airdrop-v2",
  params: {
    public: { n_min_epochs: 2, cap_oildrop: null, set_root_mode: "hai-hu-rieng" },
    sealed: { e_open: 654, e_cut: 666 },
  },
}];
await writeFile(file, JSON.stringify(seed, null, 2), "utf8");
process.env.LAUNCH_CAMPAIGNS_FILE = file;

const { patchCampaign } = await import("../src/content.js");

// 1. sửa MỘT tham số công khai — cửa sổ đo phải còn nguyên
const a = await patchCampaign("airdrop-v2", { params: { public: { n_min_epochs: 3 } } } as never);
assert.ok(a, "phải tìm thấy đợt");
assert.equal(a!.params!.public.n_min_epochs, 3, "trường vừa sửa phải đổi");
assert.equal(a!.params!.public.set_root_mode, "hai-hu-rieng", "trường công khai KHÁC phải còn");
assert.deepEqual(a!.params!.sealed, { e_open: 654, e_cut: 666 }, "cửa sổ đo PHẢI còn nguyên");

// 2. và phải còn nguyên TRÊN ĐĨA, không chỉ trong giá trị trả về
const onDisk = JSON.parse(await readFile(file, "utf8"));
assert.deepEqual(onDisk[0].params.sealed, { e_open: 654, e_cut: 666 }, "cửa sổ đo PHẢI còn trên đĩa");

// 3. mở niêm vẫn làm được — nhưng phải NÓI RA
const b = await patchCampaign("airdrop-v2", { params: { public: {}, sealed: null } } as never);
assert.ok(!b!.params!.sealed, "sealed: null tường minh ⇒ mở niêm");

console.log("✅ patchCampaign: sửa tham số công khai không cuốn mất cửa sổ đo; mở niêm phải tường minh");
