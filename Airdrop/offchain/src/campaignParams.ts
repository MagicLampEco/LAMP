// campaignParams.ts — đọc tham số vận hành của một đợt từ campaign record.
//
// VÌ SAO CÓ TỆP NÀY. `E_open`/`E_cut`/`N`/`cap`/`excluded` trước đây chỉ sống dưới
// dạng cờ dòng lệnh, còn trang giới thiệu đợt (`LaunchAPI/data/campaigns.json`) tự
// khai mốc epoch riêng trong `phases`. Hai nguồn, không ai đối chiếu. Đó đúng là lớp
// lỗi vừa phải trả giá ở "SPO chia đều": sáu chỗ trong tài liệu dạy chia đều trong
// khi mã chia ∝ stake, và người vận hành không có cách nào biết bên nào đúng.
//
// Nay campaign record là NGUỒN DUY NHẤT, và nó sửa được qua `PATCH /admin/campaigns/:id`
// — tức sửa trên giao diện quản trị, không phải sửa mã rồi phát hành lại.
//
// FAIL-CLOSED: thiếu `params`, thiếu `sealed`, hay sai luật cửa sổ đều NÉM, không
// lặng lẽ rơi về mặc định. Một mặc định im lặng ở đây là một đợt chia tiền theo cửa
// sổ mà không ai chọn.

/** Cách nạp Merkle root — tên gọi + hệ quả ở `Airdrop/CONTRACT.md §2`. */
export type SetRootMode = "mot-so-chung" | "hai-hu-rieng" | "hu-thay-niem-moi-ky";

export const SET_ROOT_MODES: readonly SetRootMode[] = [
  "mot-so-chung",
  "hai-hu-rieng",
  "hu-thay-niem-moi-ky",
] as const;

export interface CampaignParams {
  eOpen: number;
  eCut: number;
  nMinEpochs: number;
  capOildrop: bigint | null;
  setRootMode: SetRootMode;
  potDelegatorLamp: bigint;
  potSpoLamp: bigint;
  potCsLamp: bigint;
  /** Đường dẫn TƯƠNG ĐỐI gốc repo; `null` = tường minh KHÔNG loại ai (khớp `--no-excluded`). */
  excludedFile: string | null;
}

function num(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new Error(`CAMPAIGN-PARAMS: \`${field}\` phải là số nguyên, nhận ${JSON.stringify(v)}`);
  }
  return v;
}

/** Chuỗi bigint (không dùng `number`: 100 triệu LAMP = 1e14 oildrop, vượt an toàn của Number). */
function big(v: unknown, field: string): bigint {
  if (typeof v !== "string" || !/^\d+$/.test(v)) {
    throw new Error(`CAMPAIGN-PARAMS: \`${field}\` phải là chuỗi số nguyên không âm, nhận ${JSON.stringify(v)}`);
  }
  return BigInt(v);
}

/** Kiểm + chuẩn hoá `params` của một đợt từ danh sách campaign ĐÃ PARSE.
 *
 *  THUẦN — không đọc đĩa, không đọc biến môi trường. Phần đáng kiểm của việc này là
 *  luật (cửa sổ, trần, chế độ root), không phải thao tác mở tệp; tách ra thì luật
 *  kiểm được bằng test thường, và gói SDK không phải kéo theo node types.
 *  Đường dẫn tệp + phân giải `excludedFile` là việc của phía gọi (xem `scripts/`).
 *
 *  Ném nếu thiếu hoặc sai luật — không có đường rơi về mặc định. Một mặc định im
 *  lặng ở đây là một đợt chia tiền theo cửa sổ mà không ai chọn. */
export function parseCampaignParams(list: unknown, campaignId: string): CampaignParams {
  if (!Array.isArray(list)) throw new Error("CAMPAIGN-PARAMS: dữ liệu campaign phải là MẢNG");

  const c = (list as { id?: unknown; params?: unknown }[]).find((x) => x.id === campaignId);
  if (!c) {
    const ids = (list as { id?: unknown }[]).map((x) => String(x.id)).join(", ");
    throw new Error(`CAMPAIGN-PARAMS: không có đợt \`${campaignId}\`. Có: ${ids}`);
  }

  const p = c.params as { public?: Record<string, unknown>; sealed?: Record<string, unknown> } | undefined;
  if (!p?.public) {
    throw new Error(
      `CAMPAIGN-PARAMS: đợt \`${campaignId}\` chưa có khối \`params.public\`. ` +
      `Tham số vận hành phải nằm ở campaign record để sửa được trên giao diện quản trị, ` +
      `KHÔNG nướng trong mã. Xem \`LaunchAPI/src/types.ts\` (CampaignParams).`,
    );
  }
  if (!p.sealed) {
    // Vắng `sealed` nghĩa là quản trị đã MỞ NIÊM (chuyển e_open/e_cut lên `public`)
    // — hoặc quên khai. Không đoán hộ: cửa sổ đo quyết định ai được chia tiền.
    throw new Error(
      `CAMPAIGN-PARAMS: đợt \`${campaignId}\` thiếu \`params.sealed\` (\`e_open\`/\`e_cut\`). ` +
      `Lưu ý: bản đọc qua API PUBLIC luôn bị lược \`sealed\` — dùng bản admin hoặc đọc thẳng tệp.`,
    );
  }

  const pub = p.public;
  const sealed = p.sealed;

  const eOpen = num(sealed.e_open, "sealed.e_open");
  const eCut = num(sealed.e_cut, "sealed.e_cut");
  const nMinEpochs = num(pub.n_min_epochs, "public.n_min_epochs");
  if (nMinEpochs < 1) throw new Error("CAMPAIGN-PARAMS: `n_min_epochs` phải ≥ 1");
  if (eCut - eOpen < nMinEpochs + 1) {
    throw new Error(
      `CAMPAIGN-PARAMS: cửa sổ [${eOpen}, ${eCut}) không chứa nổi chuỗi giữ ${nMinEpochs} epoch. ` +
      `Cần e_cut − e_open ≥ n_min_epochs + 1 (§1.5).`,
    );
  }

  const mode = pub.set_root_mode;
  if (typeof mode !== "string" || !SET_ROOT_MODES.includes(mode as SetRootMode)) {
    throw new Error(
      `CAMPAIGN-PARAMS: \`set_root_mode\` phải là một trong ${SET_ROOT_MODES.join(" | ")}, nhận ${JSON.stringify(mode)}`,
    );
  }

  const capRaw = pub.cap_oildrop;
  if (capRaw !== null && typeof capRaw !== "string") {
    throw new Error("CAMPAIGN-PARAMS: `cap_oildrop` phải là chuỗi số hoặc null (null = KHÔNG trần)");
  }
  const capOildrop = capRaw === null ? null : big(capRaw, "public.cap_oildrop");
  if (capOildrop !== null && capOildrop <= 0n) {
    throw new Error("CAMPAIGN-PARAMS: `cap_oildrop` > 0, hoặc null. Trần 0 khoá sạch pot.");
  }

  const excludedRaw = pub.excluded_file;
  // Chuỗi RỖNG bị từ chối cùng chỗ với kiểu sai: `""` phân giải thành CHÍNH thư mục gốc repo,
  // nên nó không dừng ở đây mà chết muộn hơn với một lỗi đọc-tệp khó lần. Và về nghĩa nó là
  // chỗ bỏ trống, đúng thứ `null` sinh ra để thay thế.
  if (excludedRaw !== null && (typeof excludedRaw !== "string" || excludedRaw === "")) {
    throw new Error(
      "CAMPAIGN-PARAMS: `excluded_file` phải là đường dẫn hoặc null. " +
      "null = tường minh CHẤP NHẬN không loại ai — phải là lựa chọn, không phải chỗ bỏ trống.",
    );
  }

  return {
    eOpen,
    eCut,
    nMinEpochs,
    capOildrop,
    setRootMode: mode as SetRootMode,
    potDelegatorLamp: big(pub.pot_delegator_lamp, "public.pot_delegator_lamp"),
    potSpoLamp: big(pub.pot_spo_lamp, "public.pot_spo_lamp"),
    potCsLamp: big(pub.pot_cs_lamp, "public.pot_cs_lamp"),
    excludedFile: excludedRaw === null ? null : excludedRaw,
  };
}
