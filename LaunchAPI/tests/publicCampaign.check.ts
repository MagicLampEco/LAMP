// publicCampaign.check.ts — cổng lược `params.sealed` khỏi mọi đường ra công khai.
//
// Chạy: npm run check   (dùng node:assert + tsx, KHÔNG thêm phụ thuộc mới)
//
// Vì sao là tệp kiểm riêng chứ không phải một dòng ghi chú: `sealed` giữ cửa sổ đo
// `[e_open, e_cut)`. Rò nó ra trước khi cửa sổ đóng = báo trước ngày cần đẹp sổ, ai
// cũng thuê stake đúng 12 epoch rồi rút. `/events` (SSE) KHÔNG có auth, nên một chỗ
// quên là rò cho toàn mạng, không phải cho một người.
import assert from "node:assert/strict";
import { publicCampaign } from "../src/push.js";

const campaign = {
  id: "airdrop-v2",
  push_targets: [{ name: "affiso", webhook_url: "https://x", webhook_secret: "S3CR3T", enabled: true }],
  params: {
    public: { n_min_epochs: 2, cap_oildrop: null, set_root_mode: "hai-hu-rieng" },
    sealed: { e_open: 654, e_cut: 666 },
  },
};

const safe = publicCampaign(campaign) as { params?: Record<string, unknown> };
const wire = JSON.stringify(safe);

assert.ok(!("push_targets" in safe), "push_targets phải bị lược");
assert.ok(!wire.includes("S3CR3T"), "webhook_secret không được lọt ra chuỗi đi dây");

assert.ok(safe.params, "params.public phải còn — nó là thứ cần hiện cho người đọc");
assert.equal((safe.params as { public: { set_root_mode: string } }).public.set_root_mode, "hai-hu-rieng");

assert.ok(!("sealed" in (safe.params as object)), "params.sealed PHẢI bị lược khỏi bản public");
assert.ok(!wire.includes("e_open"), "e_open không được lọt ra chuỗi đi dây");
assert.ok(!wire.includes("654"), "giá trị cửa sổ đo không được lọt ra chuỗi đi dây");

// Lược là tạo bản mới, KHÔNG cắt vào bản gốc trong bộ nhớ đệm — cắt vào gốc thì lượt
// ghi kế tiếp của quản trị mất luôn cửa sổ đo khỏi đĩa.
assert.deepEqual(campaign.params.sealed, { e_open: 654, e_cut: 666 }, "bản gốc phải nguyên vẹn");

console.log("✅ publicCampaign: lược push_targets + params.sealed, giữ params.public, không đụng bản gốc");
