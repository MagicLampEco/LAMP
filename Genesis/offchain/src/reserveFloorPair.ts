// reserveFloorPair — cổng FLOOR-PAIR-001: ép `reserve_auth.floor_oildrop` (#3) TRÙNG
// `reserve_gate.floor_oildrop` (#5), và ép cả hai là một giá trị SỐNG.
//
// ⚠ VÌ SAO CỔNG NÀY TỒN TẠI (đọc trước khi nới):
// Đây là một RESIDUAL mà on-chain KHÔNG đóng được, và chính validator nói ra điều đó —
// `Treasury/onchain/validators/reserve_auth.ak`, khối `⚠ RESIDUAL` trong luật A-FLOOR-1:
//
//     `reserve_gate` nướng `auth_policy` (= policy-id của `reserve_auth`), nên `reserve_auth`
//     KHÔNG thể nướng ngược `gate_script_hash` — vòng apply-param. Hệ quả: truyền
//     `floor_oildrop = 5` vào `reserve_auth` và `= 0` vào `reserve_gate` thì HAI SCRIPT VẪN
//     ĐÚC ĐƯỢC, và cổng cầu vẫn chết vĩnh viễn. Không validator nào phát hiện được.
//
// Cùng hạng nguy hiểm với cặp `kho_nft_*` (`reserveKhoPair.ts`, cổng APPLY-003): số tham số
// vẫn đủ, `applyParamsToScript` vẫn trả về một định danh hợp lệ, cả hai vẫn xanh — chỗ đứt
// nằm ở tầng NỐI DÂY, và không tầng nào báo.
//
// Hai nửa của luật, đừng bỏ nửa nào:
//   · A-FLOOR-1 (on-chain, `reserve_auth.ak`) ép `floor_oildrop > 0` ở NHÁNH SINH — bắt được
//     ca "sàn chết" cho RIÊNG vế `reserve_auth`, một lần, vĩnh viễn.
//   · FLOOR-PAIR-001 (off-chain, tệp này) ép HAI VẾ BẰNG NHAU — thứ duy nhất bắt được ca
//     "mỗi script một con số", vì không script nào nhìn thấy tham số của script kia.
//
// Cổng là FAIL-CLOSED ở CẢ BA trạng thái, không chỉ hai:
//   · khớp            → im lặng
//   · lệch            → ném FLOOR-PAIR-001
//   · KHÔNG ĐỌC ĐƯỢC  → ném FLOOR-PAIR-001, KHÔNG cho qua.
// Trạng thái thứ ba là trạng thái mù. `undefined === undefined` và `0n === 0n` đều so ra
// BẰNG NHAU, và đó đúng là hai ca nguy hiểm nhất — hai chỗ chưa điền thì cổng nào chỉ so bằng
// cũng im lặng cho qua, tức nói "tôi không biết" bằng giọng của "ổn".

/**
 * Một vế sàn có ĐỌC ĐƯỢC không. Trả về lý do KHÔNG đọc được, hoặc `undefined` khi đọc được.
 *
 * Tách khỏi phép so sánh, đúng khuôn `reserveKhoPair.ts::khongDocDuoc`: phép so bằng chạy SAU,
 * và chỉ chạy trên hai giá trị đã biết là đọc được.
 */
function khongDocDuoc(v: bigint | undefined, nhan: string): string | undefined {
  if (v === undefined || v === null) return `${nhan} KHÔNG có (undefined)`;
  if (typeof v !== "bigint") {
    return (
      `${nhan} = ${JSON.stringify(String(v))} kiểu ${typeof v} — cần bigint. Khe này là ` +
      `\`Int\` của Plutus; một \`number\` JS không đi qua bộ tuần tự hoá của lucid theo cùng ` +
      `đường, nên nhận nó là nhận một giá trị chưa biết hình dạng.`
    );
  }
  if (v <= 0n) {
    return (
      `${nhan} = ${v} — GIÁ TRỊ CHẾT. \`reserve_gate\` ép \`parked < floor_oildrop\`, mà ` +
      `\`parked\` đo bằng \`quantity_of\` trên value nên sổ cái bảo đảm \`parked >= 0\`. Với ` +
      `sàn <= 0 thì bất đẳng thức đó KHÔNG BAO GIỜ đúng ⇒ auth NFT không rời gate được ⇒ ` +
      `\`reserve_draw\` Luật 5 vĩnh viễn không thoả ⇒ đường Reserve chết hẳn. Đây đúng ca mà ` +
      `A-FLOOR-1 (\`reserve_auth.ak\`) chặn trên chuỗi; chặn ở đây để lộ ra TRƯỚC khi dựng tx.`
    );
  }
  return undefined;
}

/**
 * Ném FLOOR-PAIR-001 khi sàn sắp nướng vào `reserve_auth` (#3) KHÁC sàn sắp nướng vào
 * `reserve_gate` (#5), hoặc khi một trong hai không đọc được.
 *
 * PHẢI gọi TRƯỚC `applyParamsToScript`. Sau khi apply thì con số đã nằm trong bytecode và
 * policy-id / script hash đã chốt — không sửa được. Và hỏng ở đây không hỏng kiểu ồn ào: hai
 * script vẫn đúc ra được, địa chỉ vẫn hợp lệ, chỉ là cổng cầu không bao giờ mở nữa, còn
 * LAMP trong két thì không burn được (`Treasury/CONTRACT.md §5`).
 *
 * @param reserveAuthFloor sàn sắp (hoặc đã) nướng vào `reserve_auth` khe #3.
 * @param reserveGateFloor sàn sắp (hoặc đã) nướng vào `reserve_gate` khe #5.
 */
export function assertFloorPair(
  reserveAuthFloor: bigint | undefined,
  reserveGateFloor: bigint | undefined,
): void {
  const loi =
    khongDocDuoc(reserveAuthFloor, "reserve_auth.floor_oildrop (#3)") ??
    khongDocDuoc(reserveGateFloor, "reserve_gate.floor_oildrop (#5)");
  if (loi) {
    throw new Error(
      `FLOOR-PAIR-001: không ĐỌC ĐƯỢC sàn cổng cầu — ${loi}. Cổng này ép hai validator dùng ` +
        `CÙNG một con số sàn; không đọc được một vế thì nó không đo được gì, và cho qua lúc đó ` +
        `là nói "tôi không biết" bằng giọng "ổn". Truyền cùng MỘT biến cấu hình cho CẢ HAI vế.`,
    );
  }
  const a = reserveAuthFloor as bigint;
  const b = reserveGateFloor as bigint;
  if (a !== b) {
    throw new Error(
      `FLOOR-PAIR-001: sàn cổng cầu LỆCH giữa hai validator.\n` +
        `  reserve_auth.floor_oildrop (#3) = ${a}\n` +
        `  reserve_gate.floor_oildrop (#5) = ${b}\n` +
        `Hai số này PHẢI bằng nhau và PHẢI lấy từ MỘT biến cấu hình. Trên chuỗi KHÔNG đóng được ` +
        `ràng buộc này: \`reserve_gate\` nướng \`auth_policy\` nên \`reserve_auth\` không nướng ` +
        `ngược \`gate_script_hash\` được (vòng apply-param) — xem khối RESIDUAL của A-FLOOR-1 ` +
        `trong \`Treasury/onchain/validators/reserve_auth.ak\`. Lệch thì CẢ HAI SCRIPT VẪN ĐÚC ` +
        `ĐƯỢC và cổng cầu vẫn chết vĩnh viễn; APPLY-001 chỉ đếm tham số nên không thấy gì. Đây ` +
        `là chỗ DUY NHẤT bắt được ca này.`,
    );
  }
}

// ── Danh sách tham số apply-param, dựng Ở MỘT CHỖ ────────────────────────────
//
// Cùng lý do với `reserveKhoPair.ts`: thứ tự tham số nướng thẳng vào policy-id / script hash,
// và truyền sai thứ tự KHÔNG báo lỗi. Gõ mảng ở mỗi script nghĩa là thứ tự ấy sống ở nhiều bản
// sao, mỗi bản chết im lặng theo kiểu riêng. Ở đây nó có ĐÚNG MỘT nguồn, nạp được trong bài
// kiểm mà không cần .env, không cần ví, không cần mạng.

/** Tham số `validator reserve_auth(` — 3 khe, đúng thứ tự chữ ký on-chain. */
export interface ReserveAuthParamValues {
  /** #1 `genesis_ref` — `Constr(0, [txHash, index])`, one-shot. */
  genesisRef: unknown;
  /** #2 asset name auth NFT (hex). Phải khớp `treasury_auth_name` của `reserve_draw` + `reserve_gate`. */
  authName: string;
  /** #3 sàn cổng cầu. KHÔNG dùng để so sánh trong `reserve_auth` — chỉ để A-FLOOR-1 bác cấu hình chết. */
  floorOildrop: bigint;
  /**
   * Sàn sắp nướng vào `reserve_gate` (#5) — vế đối chiếu, KHÔNG đi vào danh sách tham số.
   *
   * Bắt buộc, không có mặc định: không có nó thì cổng FLOOR-PAIR-001 mất vế so sánh và việc
   * "ép hai chỗ khớp nhau" quay về một lời hứa bằng chữ.
   */
  reserveGateFloorOildrop: bigint;
}

/**
 * Dựng danh sách 3 tham số cho `reserve_auth.reserve_auth.mint`, SAU khi ép sàn khớp với
 * `reserve_gate` (#5).
 *
 * Thứ tự gọi có nghĩa: cổng chạy TRƯỚC khi mảng được dựng, nên không có đường nào lấy được
 * danh sách tham số của một cặp lệch.
 */
export function reserveAuthParamList(p: ReserveAuthParamValues): unknown[] {
  assertFloorPair(p.floorOildrop, p.reserveGateFloorOildrop);
  return [
    p.genesisRef,     // #1
    p.authName,       // #2
    p.floorOildrop,   // #3
  ];
}

/** Tham số `validator reserve_gate(` — 7 khe, đúng thứ tự chữ ký on-chain. */
export interface ReserveGateParamValues {
  /** #1-2 NFT định danh két custody — gate đọc `parked` từ ĐÚNG két thật. */
  custodyNftPolicy: string;
  custodyNftName: string;
  /** #3-4 LAMP — đơn vị đo `parked`. */
  lampPolicy: string;
  tokenName: string;
  /** #5 sàn cổng cầu: gate chỉ nhả auth NFT khi `parked < floor_oildrop`. */
  floorOildrop: bigint;
  /** #6-7 auth NFT bị khoá tại gate này. */
  authPolicy: string;
  authName: string;
  /**
   * Sàn ĐÃ nướng vào `reserve_auth` (#3) — vế đối chiếu, KHÔNG đi vào danh sách tham số.
   *
   * Bắt buộc, không có mặc định — cùng lý do với `reserveGateFloorOildrop` ở trên.
   */
  reserveAuthFloorOildrop: bigint;
}

/**
 * Dựng danh sách 7 tham số cho `reserve_gate.reserve_gate.spend`, SAU khi ép sàn khớp với
 * `reserve_auth` (#3).
 *
 * Thứ tự tham số lấy từ chữ ký `validator reserve_gate(` — trích theo TÊN, không theo số dòng.
 * Sai thứ tự không báo lỗi: nó ra một `gateHash` khác, và `reserve_draw` sẽ đòi auth NFT ở một
 * script không tồn tại ⇒ nhánh Reserve đóng câm.
 */
export function reserveGateParamList(p: ReserveGateParamValues): unknown[] {
  assertFloorPair(p.reserveAuthFloorOildrop, p.floorOildrop);
  return [
    p.custodyNftPolicy, p.custodyNftName,   // #1-2
    p.lampPolicy, p.tokenName,              // #3-4
    p.floorOildrop,                          // #5
    p.authPolicy, p.authName,               // #6-7
  ];
}
