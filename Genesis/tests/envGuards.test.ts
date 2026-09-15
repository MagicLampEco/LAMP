// Cổng gác tham số apply-param — `Genesis/scripts/_guards.ts`.
//
// Ca gốc (hồi quy): trước bản vá, `METER_NFT_POLICY` KHÔNG có cổng trong khi `DIST_DEST`
// ngay dưới 6 dòng thì có (`ddfa2c6`). Bản mồi mainnet mang hệ quả: meter_nft_policy =
// 28 byte 0 (`Genesis/offchain/src/deployed.ts:92`) ⇒ nhánh ReserveDraw chết vĩnh viễn.
// Bộ test dưới ép hai tham số CÙNG LOẠI hành xử GIỐNG NHAU — đó mới là thứ hỏng, không
// phải một biến cụ thể nào.

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  requiredHashParam, requiredHexParam, CONSEQUENCE_METER, CONSEQUENCE_DIST_DEST,
  assertOneShotMarkers, REMINTABLE_ACK,
} from "../scripts/_guards.js";

const HASH28 = "ab".repeat(28);
const ZERO28 = "00".repeat(28);
const silent = () => {};

/** Thư mục script — cả hai phép quét dưới đây đều lấy vùng đo từ đây, không gõ danh sách.
 *  Đường dẫn tương đối theo cwd của vitest = `Genesis/offchain` (nơi có vitest.config).
 *  Cố ý KHÔNG dùng `import.meta.url` + node:path: tsconfig của offchain build ra CommonJS
 *  và không nạp @types/node, nên chúng chỉ thêm lỗi `tsc --noEmit` cho module khác. Sai
 *  đường dẫn thì `readdirSync` ném ENOENT — đỏ ồn ào, không im lặng xanh. */
const SCRIPTS_DIR = "../scripts";

/** Tệp `.ts` trong thư mục script, đã sắp. Vùng quét tự lớn theo kho.
 *  Vế `length` là cổng chống MÙ: thư mục sai đường thì mảng rỗng, vòng lặp không chạy lần
 *  nào, và bài xanh đúng lúc nó không đo được gì. */
const scriptFiles = (): string[] => {
  const files = readdirSync(SCRIPTS_DIR).filter((f: string) => f.endsWith(".ts")).sort();
  expect(files.length, `${SCRIPTS_DIR}: không thấy tệp .ts nào — sai đường dẫn?`)
    .toBeGreaterThan(5);
  return files;
};

/** Dòng MÃ, bỏ chú thích và `import`. Ở module scope vì cả hai phép quét cần nó — một bộ
 *  dò đọc chú thích thành lời gọi sẽ bắt nhầm ca hợp lệ, và một bộ dò bắt nhầm sẽ bị ai đó
 *  tắt, lúc tắt nó mang theo cả ca thật. */
const codeLines = (src: string): string[] =>
  src.split("\n")
    .map((l) => l.trimStart())
    .filter((l) => !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("import"));

describe("requiredHashParam — SUBMIT bật + thiếu biến ⇒ NÉM", () => {
  it("METER_NFT_POLICY thiếu ⇒ ném", () => {
    expect(() =>
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER, env: {}, warn: silent,
      }),
    ).toThrow(/METER_NFT_POLICY chưa set/);
  });

  it("DIST_DEST thiếu ⇒ ném", () => {
    expect(() =>
      requiredHashParam("DIST_DEST", {
        submit: true, consequence: CONSEQUENCE_DIST_DEST, env: {}, warn: silent,
      }),
    ).toThrow(/DIST_DEST chưa set/);
  });

  it("chuỗi rỗng / toàn khoảng trắng tính là thiếu", () => {
    for (const v of ["", "   ", "\t\n"]) {
      expect(() =>
        requiredHashParam("METER_NFT_POLICY", {
          submit: true, consequence: CONSEQUENCE_METER,
          env: { METER_NFT_POLICY: v }, warn: silent,
        }),
      ).toThrow(/chưa set/);
    }
  });

  it("thông điệp lỗi nói HẬU QUẢ, không chỉ nói 'thiếu biến'", () => {
    let msg = "";
    try {
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER, env: {}, warn: silent,
      });
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/APPLY-PARAM/);
    expect(msg).toMatch(/KẸT VĨNH VIỄN/);
    expect(msg).toMatch(/KHÔNG burn/);
    expect(msg).toMatch(/policy-id/);
    expect(msg).toMatch(/ReserveDraw/);            // hậu quả riêng của meter
  });

  it("hậu quả DIST_DEST nói đúng đường A-DEST, không dán nhầm hậu quả của meter", () => {
    let msg = "";
    try {
      requiredHashParam("DIST_DEST", {
        submit: true, consequence: CONSEQUENCE_DIST_DEST, env: {}, warn: silent,
      });
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/A-DEST/);
    expect(msg).toMatch(/Script\(00×28\)/);
    expect(msg).not.toMatch(/ReserveDraw/);
  });
});

describe("requiredHashParam — SUBMIT tắt ⇒ KHÔNG ném", () => {
  it("thiếu biến ⇒ trả placeholder 00×28, không ném", () => {
    const got = requiredHashParam("METER_NFT_POLICY", {
      submit: false, consequence: CONSEQUENCE_METER, env: {}, warn: silent,
    });
    expect(got.value).toBe(ZERO28);
    expect(got.source).toBe("placeholder");
  });

  it("placeholder LUÔN kèm cảnh báo có nêu hậu quả (im lặng là cách lỗi cũ lọt)", () => {
    const warn = vi.fn();
    requiredHashParam("METER_NFT_POLICY", {
      submit: false, consequence: CONSEQUENCE_METER, env: {}, warn,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/ReserveDraw/);
  });

  it("có biến ⇒ dùng biến, không cảnh báo", () => {
    const warn = vi.fn();
    const got = requiredHashParam("METER_NFT_POLICY", {
      submit: false, consequence: CONSEQUENCE_METER,
      env: { METER_NFT_POLICY: HASH28 }, warn,
    });
    expect(got).toEqual({ name: "METER_NFT_POLICY", value: HASH28, source: "env" });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("requiredHashParam — có giá trị thì luôn kiểm dạng, kể cả khi không gửi", () => {
  it("thiếu/thừa byte ⇒ ném ở CẢ hai chế độ", () => {
    for (const submit of [true, false]) {
      expect(() =>
        requiredHashParam("METER_NFT_POLICY", {
          submit, consequence: CONSEQUENCE_METER,
          env: { METER_NFT_POLICY: "ab".repeat(27) }, warn: silent,
        }),
      ).toThrow(/sai dạng/);
    }
  });

  it("ký tự không phải hex ⇒ ném", () => {
    expect(() =>
      requiredHashParam("DIST_DEST", {
        submit: true, consequence: CONSEQUENCE_DIST_DEST,
        env: { DIST_DEST: "zz".repeat(28) }, warn: silent,
      }),
    ).toThrow(/sai dạng/);
  });

  it("hex CHỮ HOA được chấp nhận và chuẩn hoá về chữ thường", () => {
    const got = requiredHashParam("DIST_DEST", {
      submit: true, consequence: CONSEQUENCE_DIST_DEST,
      env: { DIST_DEST: "AB".repeat(28) }, warn: silent,
    });
    expect(got.value).toBe(HASH28);
  });

  it("độ dài byte đổi được qua opts.bytes (tx-hash 32 byte)", () => {
    expect(() =>
      requiredHashParam("GENESIS_TX", {
        submit: true, consequence: "x", bytes: 32,
        env: { GENESIS_TX: HASH28 }, warn: silent,
      }),
    ).toThrow(/64 ký tự hex/);
  });
});

describe("requiredHexParam — asset-name cũng qua cổng (gác nửa cặp = tái lập lỗi cũ)", () => {
  it("SUBMIT bật + thiếu ⇒ ném", () => {
    expect(() =>
      requiredHexParam("METER_NFT_NAME", {
        submit: true, placeholder: "4d4554", consequence: CONSEQUENCE_METER,
        env: {}, warn: silent,
      }),
    ).toThrow(/METER_NFT_NAME chưa set/);
  });

  it("SUBMIT tắt + thiếu ⇒ trả placeholder, không ném", () => {
    const got = requiredHexParam("METER_NFT_NAME", {
      submit: false, placeholder: "4d4554", consequence: CONSEQUENCE_METER,
      env: {}, warn: silent,
    });
    expect(got).toEqual({ name: "METER_NFT_NAME", value: "4d4554", source: "placeholder" });
  });

  it("hex lẻ ký tự ⇒ ném (không có nửa byte)", () => {
    expect(() =>
      requiredHexParam("METER_NFT_NAME", {
        submit: true, placeholder: "4d4554", consequence: CONSEQUENCE_METER,
        env: { METER_NFT_NAME: "4d455" }, warn: silent,
      }),
    ).toThrow(/sai dạng/);
  });

  // Trước đây chỉ có ca ĐỘ DÀI lẻ. Độ dài chẵn + ký tự không-hex là ca thật hay gặp hơn:
  // `TOKEN_NAME=LAMP`, `METER_NFT_NAME=tLAMP` — gõ ASCII thay vì hex, dài chẵn, đi lọt
  // mọi phép kiểm độ dài.
  it("độ dài CHẴN nhưng có ký tự không-hex ⇒ ném (ASCII gõ nhầm vào ô hex)", () => {
    for (const v of ["LAMP", "4d4554zz", "0x4d4554"]) {
      expect(() =>
        requiredHexParam("TOKEN_NAME", {
          submit: true, placeholder: "4d4554", consequence: "x",
          env: { TOKEN_NAME: v }, warn: silent,
        }),
      ).toThrow(/sai dạng/);
    }
  });

  it("đường placeholder CÓ gọi warn (im lặng là cách lỗi cũ lọt)", () => {
    const warn = vi.fn();
    requiredHexParam("METER_NFT_NAME", {
      submit: false, placeholder: "4d4554", consequence: CONSEQUENCE_METER,
      env: {}, warn,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/METER_NFT_NAME chưa set/);
    expect(warn.mock.calls[0]![0]).toMatch(/ReserveDraw/);   // cảnh báo phải nêu hậu quả
  });

  it("độ dài tự do được chấp nhận (asset-name không cố định 28 byte)", () => {
    const got = requiredHexParam("METER_NFT_NAME", {
      submit: true, placeholder: "4d4554", consequence: CONSEQUENCE_METER,
      env: { METER_NFT_NAME: "535550504c59" }, warn: silent,
    });
    expect(got.value).toBe("535550504c59");
  });
});

describe("ĐỐI XỨNG — hai tham số cùng loại phải hành xử y hệt", () => {
  // Đây là bài kiểm chính. Lỗi gốc KHÔNG phải "quên một biến", mà là "hai tham số cùng
  // loại có hai mức bảo vệ khác nhau". Test này đỏ ngay khi ai đó gác lại một nửa.
  const HASH_PARAMS = ["METER_NFT_POLICY", "DIST_DEST"] as const;

  it("SUBMIT bật: MỌI tham số hash thiếu đều ném", () => {
    for (const name of HASH_PARAMS) {
      expect(() =>
        requiredHashParam(name, { submit: true, consequence: "hậu quả", env: {}, warn: silent }),
      ).toThrow(new RegExp(`${name} chưa set`));
    }
  });

  it("SUBMIT tắt: MỌI tham số hash thiếu đều trả placeholder, không cái nào ném", () => {
    for (const name of HASH_PARAMS) {
      const got = requiredHashParam(name, {
        submit: false, consequence: "hậu quả", env: {}, warn: silent,
      });
      expect(got.source).toBe("placeholder");
      expect(got.value).toBe(ZERO28);
    }
  });

  it("cặp meter (policy + name) cùng mức gác — không cái nào lọt khi cái kia chặn", () => {
    const env = {}; // cả hai đều thiếu
    expect(() =>
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER, env, warn: silent,
      }),
    ).toThrow();
    expect(() =>
      requiredHexParam("METER_NFT_NAME", {
        submit: true, placeholder: "4d4554", consequence: CONSEQUENCE_METER, env, warn: silent,
      }),
    ).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// GIÁ TRỊ CHẾT — cổng gác cũ chỉ chặn THIẾU biến, không chặn giá trị "đúng dạng
// nhưng không thể có tiền ảnh". Đó chính xác là kẽ mà bản mồi mainnet chui qua:
// deployed.ts:92 ghi meter_nft_policy = 28 byte 0, và nó ĐÃ đi qua mọi phép kiểm dạng.
// ══════════════════════════════════════════════════════════════
describe("giá trị CHẾT — đúng dạng vẫn phải bị chặn khi GỬI", () => {
  it("METER_NFT_POLICY = 00×28 bị chặn khi submit=true (đây là ca đã giết mainnet)", () => {
    expect(() =>
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER,
        env: { METER_NFT_POLICY: ZERO28 }, warn: silent,
      }),
    ).toThrow(/GIÁ TRỊ CHẾT/);
  });

  it("DIST_DEST = 00×28 cũng bị chặn — luật một, không có ngoại lệ theo tên biến", () => {
    expect(() =>
      requiredHashParam("DIST_DEST", {
        submit: true, consequence: CONSEQUENCE_DIST_DEST,
        env: { DIST_DEST: ZERO28 }, warn: silent,
      }),
    ).toThrow(/GIÁ TRỊ CHẾT/);
  });

  it("toàn f cũng là giá trị chết", () => {
    expect(() =>
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER,
        env: { METER_NFT_POLICY: "f".repeat(56) }, warn: silent,
      }),
    ).toThrow(/GIÁ TRỊ CHẾT/);
  });

  it("asset-name cũng qua cùng cổng — gác nửa cặp là tái lập lỗi cũ", () => {
    expect(() =>
      requiredHexParam("METER_NFT_NAME", {
        submit: true, consequence: CONSEQUENCE_METER, placeholder: "4d4554",
        env: { METER_NFT_NAME: "0000" }, warn: silent,
      }),
    ).toThrow(/GIÁ TRỊ CHẾT/);
  });

  it("submit=false vẫn cho 00×28 — chế độ dựng-thử phải xem được CBOR", () => {
    const got = requiredHashParam("METER_NFT_POLICY", {
      submit: false, consequence: CONSEQUENCE_METER,
      env: { METER_NFT_POLICY: ZERO28 }, warn: silent,
    });
    expect(got).toEqual({ name: "METER_NFT_POLICY", value: ZERO28, source: "env" });
  });

  it("giá trị thật KHÔNG bị chặn — guard không được bắt nhầm", () => {
    expect(() =>
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER,
        env: { METER_NFT_POLICY: HASH28 }, warn: silent,
      }),
    ).not.toThrow();
  });

  it("hash có nhiều số 0 nhưng KHÔNG toàn 0 thì hợp lệ", () => {
    const mostlyZero = "0".repeat(54) + "1a";
    expect(() =>
      requiredHashParam("DIST_DEST", {
        submit: true, consequence: CONSEQUENCE_DIST_DEST,
        env: { DIST_DEST: mostlyZero }, warn: silent,
      }),
    ).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// CALL-SITE — bộ "ĐỐI XỨNG" ở trên khoá HÀM, không khoá NƠI GỌI.
//
// `HASH_PARAMS` của nó là danh sách CHÉP TAY ngay trong tệp test này: nó chứng minh
// `requiredHashParam("METER_NFT_POLICY", …)` và `requiredHashParam("DIST_DEST", …)` hành xử
// giống nhau, nhưng KHÔNG chứng minh script nào thật sự gọi chúng. Bằng chứng nó không khoá
// được: `genesis_ref` — apply-param GỐC RỄ sinh ra `threadPid`, mà `threadPid` lại là
// apply-param của cả `lamp_mint` lẫn `supply_state` — từng là literal Preview nướng cứng ở
// `02`/`03`, hoàn toàn ngoài cổng gác, mà suite vẫn xanh 100%.
//
// Test dưới đọc THẲNG mã nguồn: mọi `process.env.<TÊN>` mà tên trông như tham số hash/hex
// (hậu tố `_POLICY`/`_NAME`/`_HASH`/`_DEST`) phải xuất hiện trong một lời gọi
// `requiredHashParam("<TÊN>"` / `requiredHexParam("<TÊN>"` trong CÙNG tệp. Regex là đủ: cái
// cần bắt là "đọc env trần rồi nhét thẳng vào applyParamsToScript", không phải luồng dữ
// liệu tinh vi — parse AST ở đây chỉ biến một tệp test thành một trình biên dịch nhỏ.
// ══════════════════════════════════════════════════════════════
describe("CALL-SITE — không apply-param nào đi vòng cổng gác", () => {
  // QUÉT THƯ MỤC, KHÔNG GÕ DANH SÁCH — cùng lý lẽ với phép quét native-sig ở dưới. Bản
  // trước liệt kê bốn tên tệp, và danh sách gõ tay hỏng được theo HAI chiều mà không chiều
  // nào kêu: thêm một script mới đọc apply-param từ env thì nó đứng ngoài vòng đo, còn xoá
  // một tệp trong danh sách thì `readFileSync` ném ENOENT — một bài đỏ nói về tệp thiếu chứ
  // không nói về cổng. Chiều thứ nhất đã xảy ra thật: `_canonical_v2.ts`,
  // `24_reserve_layer2_init.ts`, `_reserve_layer2.ts`, `v2_wiring_dry.ts`,
  // `_custodySeedRef.ts` ra đời sau danh sách và không tệp nào trong số đó từng được đo.

  /** Tên env trông như tham số hash / policy-id / asset-name ⇒ phải qua cổng gác. */
  const LOOKS_LIKE_PARAM = /(_POLICY|_NAME|_HASH|_DEST)$/;
  /** `process.env.X` và `process.env["X"]`. */
  const ENV_READ = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])/g;

  // Quét DÒNG MÃ, không quét văn bản thô: một chú thích giải thích vì sao đường cũ đọc
  // `process.env.X_POLICY` trần sẽ bị đọc thành một lần đọc env thật.
  const scan = (src: string): string[] =>
    [...codeLines(src).join("\n").matchAll(ENV_READ)]
      .map((m) => m[1] ?? m[2]!)
      .filter((name) => LOOKS_LIKE_PARAM.test(name));

  it("MỌI script: env dạng hash/hex đều đi qua required*Param", () => {
    const viPham: string[] = [];
    for (const file of scriptFiles()) {
      const src = readFileSync(`${SCRIPTS_DIR}/${file}`, "utf8");
      const ungated = scan(src)
        .filter((name) => !src.includes(`requiredHashParam("${name}"`))
        .filter((name) => !src.includes(`requiredHexParam("${name}"`));
      for (const name of new Set(ungated)) viPham.push(`${file}: ${name}`);
    }

    // Thông điệp lỗi phải NÊU TÊN TỆP và TÊN BIẾN sót — "có gì đó chưa gác" là vô dụng
    // lúc 3h sáng, và với vùng quét cả thư mục thì thiếu tên tệp còn tệ hơn nữa.
    expect(
      viPham,
      `apply-param đọc từ env mà KHÔNG qua _guards.ts — nó nằm trong policy-id/script-hash, ` +
      `sai là không sửa được (LAMP không burn). Bọc bằng requiredHashParam/requiredHexParam, ` +
      `hoặc đổi tên biến nếu nó không phải apply-param.`,
    ).toEqual([]);
  });

  // Nửa còn lại của cùng một lỗ: gác hết env vẫn chưa đủ nếu tham số KHÔNG đọc từ env mà
  // nướng thẳng literal vào mã — đúng cách `GENESIS_REF_HASH` (64 hex, neo one-shot Preview)
  // sống ngoài cổng gác ở `02`/`03`. Literal đủ dài để là hash/policy-id thì phải đi qua env
  // + `_guards.ts`, không có ngoại lệ "giá trị này chắc đúng".
  const LONG_HEX_LITERAL = /["'`]([0-9a-fA-F]{40,})["'`]/g;

  // Vùng quét rộng ra cả thư mục thì xuất hiện ca hợp lệ ĐẦU TIÊN: một CBOR datum nướng cứng
  // (`mint_release_plan.ts::MAINNET_SUPPLY_STATE_CBOR`) — không phải apply-param, nên bị bắt
  // là bắt nhầm. Đã thử lọc nó bằng độ dài và ĐO RA LÀ SAI: chuỗi đó dài đúng 64 ký tự, trùng
  // khít hình dạng tx-hash của `genesis_ref`. Không có phép đo nào trên chính chuỗi đó phân
  // biệt được hai bên.
  //
  // Nên miễn trừ phải là thứ người viết KHAI, và khai TẠI CHỖ: một dấu `APPLY-PARAM-EXEMPT`
  // trên cùng dòng với literal. Ba tính chất, đều cần:
  //   · nó đi cùng mã, nên không trôi khỏi thứ nó miễn trừ;
  //   · nó hiện trong diff, nên thêm một miễn trừ là một việc ai cũng thấy;
  //   · danh sách kỳ vọng dưới đây là danh sách ĐÓNG — thêm một miễn trừ mà không sửa bài
  //     kiểm thì bài đỏ. Một cơ chế loại trừ không đếm được là một phép đo nói "đúng" trong
  //     khi nó chỉ đúng trên phần còn lại.
  const EXEMPT_MARK = "APPLY-PARAM-EXEMPT";
  const MIEN_TRU_DA_KHAI = ["mint_release_plan.ts"] as const;

  it("MỌI script: không nướng cứng literal hash/policy-id vào mã", () => {
    const viPham: string[] = [];
    const mienTru: string[] = [];
    for (const file of scriptFiles()) {
      const src = readFileSync(`${SCRIPTS_DIR}/${file}`, "utf8");
      // Quét DÒNG MÃ: tx-hash dẫn trong chú thích là BẰNG CHỨNG, không phải apply-param.
      // Quét văn bản thô thì mọi chú thích dẫn chứng đều thành vi phạm, và một bộ dò bắt
      // nhầm ca hợp lệ sẽ bị ai đó tắt — lúc tắt nó mang theo cả ca thật.
      for (const line of codeLines(src)) {
        if (![...line.matchAll(LONG_HEX_LITERAL)].length) continue;
        if (line.includes(EXEMPT_MARK)) mienTru.push(file);
        else viPham.push(`${file}: ${line.slice(0, 40)}…`);
      }
    }

    expect(
      viPham,
      `hex ≥ 20 byte nướng cứng trong dòng mã. Nếu nó là apply-param (genesis_ref, policy-id, ` +
      `script-hash) thì nó ĐÚNG trên đúng một network và SAI im lặng trên mọi network khác — ` +
      `đọc từ env qua requiredHashParam thay vì hard-code. Nếu nó KHÔNG phải apply-param thì ` +
      `khai tại chỗ bằng dấu ${EXEMPT_MARK} kèm lý do, và bổ sung tên tệp vào danh sách ` +
      `MIEN_TRU_DA_KHAI của bài kiểm này — miễn trừ phải đếm được.`,
    ).toEqual([]);

    // Vế ĐẾM phần bị loại. Khai một chỗ trông đã giống xử lý xong, nhưng một lời khai không
    // thay được một phép đếm: danh sách phải khớp CẢ HAI CHIỀU. Thừa ⇒ có miễn trừ mới lẻn
    // vào; thiếu ⇒ một dấu miễn trừ đã chết mà không ai gỡ, và nó sẽ che ca thật sau này.
    expect(
      [...new Set(mienTru)].sort(),
      `số miễn trừ ${EXEMPT_MARK} đang có hiệu lực không khớp danh sách đã khai`,
    ).toEqual([...MIEN_TRU_DA_KHAI]);
  });

  it("chính bộ dò này phải bắt được ca hồi quy (kẻo nó xanh vì regex hỏng)", () => {
    // Literal Preview cũ ở 02/03 — bộ dò literal phải thấy nó.
    const old = `const GENESIS_REF_HASH = "689c56e05a6c4cb97ea59c26f9b2bb271ca2cf6ae52ee3dba08fb9c7a9204973";`;
    expect([...old.matchAll(LONG_HEX_LITERAL)]).toHaveLength(1);
    // asset-name ngắn ("SUPPLY", "tLAMP") KHÔNG bị bắt nhầm.
    expect([...`const S = "535550504c59";`.matchAll(LONG_HEX_LITERAL)]).toHaveLength(0);
    // policy-id / script-hash 28 byte — hình dạng apply-param phổ biến nhất. PHẢI bắt.
    expect([...`const P = "${"ab".repeat(28)}";`.matchAll(LONG_HEX_LITERAL)]).toHaveLength(1);
  });

  it(`dấu ${EXEMPT_MARK} phải miễn trừ ĐÚNG dòng mang nó, không miễn trừ dòng hàng xóm`, () => {
    // Ca đối xứng cho cơ chế miễn trừ. Thiếu nó thì một lần sửa biến phép kiểm "dòng này có
    // dấu không" thành "tệp này có dấu không", và khi đó MỘT dấu mở cửa cho CẢ TỆP —
    // đúng kiểu hỏng mà không màu nào đổi.
    const co = `const C = "${"d8".repeat(32)}"; // ${EXEMPT_MARK}: datum, không phải apply-param`;
    const khong = `const P = "${"ab".repeat(28)}";`;
    const lines = codeLines([co, khong].join("\n"));
    expect(lines.filter((l) => [...l.matchAll(LONG_HEX_LITERAL)].length)).toHaveLength(2);
    expect(lines.filter((l) => l.includes(EXEMPT_MARK))).toHaveLength(1);
  });

  it("bộ dò env phải bắt được ca hồi quy (kẻo nó xanh vì regex hỏng)", () => {
    // Đúng hình dạng lỗi cũ: đọc env trần rồi nhét thẳng vào applyParamsToScript.
    expect(scan(`const meterPid = process.env.METER_NFT_POLICY ?? "00".repeat(28);`))
      .toEqual(["METER_NFT_POLICY"]);
    expect(scan(`const nm = process.env["LAMP_ASSET_NAME"];`)).toEqual(["LAMP_ASSET_NAME"]);
    // …và KHÔNG bắt nhầm biến không phải apply-param.
    expect(scan(`BigInt(process.env.MINT_OILDROP ?? "0"); process.env.BLOCKFROST_KEY;`))
      .toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MARKER-001 — marker đúc dưới native-sig thì KHÔNG one-shot.
//
// Ca gốc (hồi quy): `0630c28` vá đúng MỘT tệp (`oneshot_cap_mint.ts`, đã xoá khỏi kho — tra
// `git show b9a795d -- Genesis/scripts/oneshot_cap_mint.ts`) và để nguyên bốn tệp
// bên cạnh vẫn nhét `nPid` (native-sig ví deploy) vào cả bốn khe marker của `lamp_mint`.
// Cùng một mẫu "vá bản sao đang nhìn, để nguyên bản sống bên cạnh" đã đẻ ra chính `_guards.ts`.
// Bộ test dưới ép CẢ BỐN tệp phải đi qua cổng — đó mới là thứ hỏng, không phải một tệp nào.

describe("assertOneShotMarkers — MARKER-001", () => {
  // `SCRIPTS_DIR`, `scriptFiles()` và `codeLines()` nay ở module scope — khối CALL-SITE ở
  // trên dùng chung đúng ba thứ đó. Hai bản sao của cùng một bộ dò sẽ trôi khỏi nhau, và
  // chiều trôi nguy hiểm là bản này siết còn bản kia nới: cả hai vẫn xanh.
  //
  // `codeLines` không phải bộ tách cú pháp — chú thích khối và chuỗi có chứa `//` vẫn lọt.
  // Cố ý dừng ở mức đó: cái cần loại là dòng văn xuôi giải thích lịch sử, và dựng một trình
  // phân tích cú pháp trong tệp kiểm là đổi một lỗ nhỏ lấy một lỗ khác khó soi hơn.

  const NATIVE = "cd".repeat(28);
  const ONESHOT = "ef".repeat(28);
  const io = (env: Record<string, string | undefined>, warn = silent) => ({
    submit: true, nativePolicyId: NATIVE, env, warn,
  });

  it("bốn khe đều one-shot ⇒ im lặng đi tiếp", () => {
    const warn = vi.fn();
    expect(() => assertOneShotMarkers(
      { thread: ONESHOT, registry: ONESHOT, kho: ONESHOT, meter: ONESHOT },
      { ...io({}), warn },
    )).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("cả bốn khe là native-sig + sắp GỬI ⇒ ném, và nêu đủ bốn khe", () => {
    let msg = "";
    try {
      assertOneShotMarkers(
        { thread: NATIVE, registry: NATIVE, kho: NATIVE, meter: NATIVE }, io({}),
      );
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("MARKER-001");
    for (const slot of ["thread", "registry", "kho", "meter"]) expect(msg).toContain(slot);
    expect(msg).toContain(REMINTABLE_ACK);
  });

  it("CHỈ khe meter lệch cũng phải ném — 9,63 tỷ Reserve treo ở đúng khe đó", () => {
    expect(() => assertOneShotMarkers(
      { thread: ONESHOT, registry: ONESHOT, kho: ONESHOT, meter: NATIVE }, io({}),
    )).toThrow(/MARKER-001[\s\S]*meter/);
  });

  it("CHỈ khe thread lệch cũng phải ném — SUPPLY NFT thứ hai = bộ đếm về 0", () => {
    expect(() => assertOneShotMarkers(
      { thread: NATIVE, registry: ONESHOT, kho: ONESHOT, meter: ONESHOT }, io({}),
    )).toThrow(/MARKER-001[\s\S]*thread/);
  });

  it("so khớp KHÔNG phân biệt hoa/thường — hex viết HOA vẫn phải bị bắt", () => {
    expect(() => assertOneShotMarkers(
      { thread: NATIVE.toUpperCase(), registry: ONESHOT, kho: ONESHOT, meter: ONESHOT }, io({}),
    )).toThrow(/MARKER-001/);
  });

  it("chế độ KHÔNG gửi ⇒ cảnh báo chứ không ném", () => {
    const warn = vi.fn();
    expect(() => assertOneShotMarkers(
      { thread: NATIVE, registry: NATIVE, kho: NATIVE, meter: NATIVE },
      { submit: false, nativePolicyId: NATIVE, env: {}, warn },
    )).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("MARKER-001");
  });

  it("gõ ĐÚNG chuỗi xác nhận ⇒ đi tiếp, nhưng phải kêu to", () => {
    const warn = vi.fn();
    expect(() => assertOneShotMarkers(
      { thread: NATIVE, registry: NATIVE, kho: NATIVE, meter: NATIVE },
      { ...io({ ALLOW_REMINTABLE_MARKERS: REMINTABLE_ACK }), warn },
    )).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("KHÔNG dùng cho mainnet");
  });

  it("gõ GẦN ĐÚNG chuỗi xác nhận ⇒ vẫn ném (không nhận biến thể)", () => {
    for (const v of ["yes", "1", "true", REMINTABLE_ACK.toUpperCase(), REMINTABLE_ACK + " "]) {
      expect(() => assertOneShotMarkers(
        { thread: NATIVE, registry: NATIVE, kho: NATIVE, meter: NATIVE },
        io({ ALLOW_REMINTABLE_MARKERS: v }),
      )).toThrow(/MARKER-001/);
    }
  });

  it("HỒI QUY: MỌI script dùng scriptFromNative đều phải đi qua cổng", () => {
    // Đây là phép kiểm thật của bài này. Bảy test trên chỉ chứng minh cổng hoạt động;
    // test này chứng minh cổng ĐƯỢC MẮC VÀO — thứ mà `0630c28` đã bỏ sót.
    //
    // QUÉT THƯ MỤC, KHÔNG GÕ DANH SÁCH. Bản trước liệt kê bốn tên tệp, và danh sách đó
    // hỏng được theo HAI chiều mà không chiều nào kêu: thêm một script thứ năm dùng
    // `scriptFromNative` thì nó đứng ngoài vòng đo, còn xoá một tệp trong danh sách thì
    // `readFileSync` ném ENOENT — một bài đỏ nói về tệp thiếu chứ không nói về cổng.
    // Quét thư mục thì tập đo tự lớn theo kho. `scriptFiles()` mang sẵn cổng chống-mù
    // (mảng rỗng ⇒ đỏ), nên vùng quét không thể im lặng co về 0.
    for (const f of scriptFiles()) {
      const src = readFileSync(`${SCRIPTS_DIR}/${f}`, "utf8");
      const code = codeLines(src);
      // ĐẾM LỜI GỌI Ở CẢ HAI VẾ, không đếm chuỗi. Vế "có gọi cổng chưa" đã đếm lời gọi từ
      // đầu; vế "có dùng native-sig không" thì chưa, và nó đi lọt suốt vì danh sách bốn tên
      // tệp che mất. Quét cả thư mục làm lộ ra ngay: `23_prove_oneshot.ts` nhắc
      // `scriptFromNative` trong CHÚ THÍCH để giải thích vì sao đường cũ không kiểm được
      // one-shot — `includes(...)` đọc đó thành "tệp này đúc marker bằng native-sig".
      // Một bộ dò bắt nhầm ca hợp lệ thì sẽ bị ai đó tắt, và lúc tắt nó mang theo cả ca thật.
      if (!code.some((l) => /\bscriptFromNative\s*\(/.test(l))) continue;
      const calls = code.filter((l) => /\bassertOneShotMarkers\s*\(/.test(l));
      expect(calls.length, `${f} đúc marker bằng native-sig mà KHÔNG GỌI assertOneShotMarkers`)
        .toBeGreaterThan(0);
    }
  });

  it("bộ dò native-sig phải phân biệt LỜI GỌI với CHÚ THÍCH", () => {
    // Ca đối xứng cho chính cái vừa sửa. Thiếu nó thì lần sau ai đó rút gọn `codeLines`
    // về `includes(...)` và bộ kiểm vẫn xanh.
    const inComment = `// đường cũ đúc marker bằng \`scriptFromNative({type:"sig"})\`\nconst x = 1;`;
    expect(codeLines(inComment).some((l) => /\bscriptFromNative\s*\(/.test(l))).toBe(false);
    const realCall = `const pol = scriptFromNative({ type: "sig", keyHash: pkh });`;
    expect(codeLines(realCall).some((l) => /\bscriptFromNative\s*\(/.test(l))).toBe(true);
    // `import` cũng không phải lời gọi.
    const imported = `import { scriptFromNative } from "@lucid-evolution/lucid";`;
    expect(codeLines(imported).some((l) => /\bscriptFromNative\s*\(/.test(l))).toBe(false);
  });
});
