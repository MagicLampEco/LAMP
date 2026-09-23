#!/usr/bin/env python3
"""Chạy một lệnh DƯỚI MỘT PSEUDO-TERMINAL và in mã thoát ra dòng cuối.

Vì sao tệp này tồn tại — đo được 2026-09-22 trên `aiken` v1.1.21 và v1.1.23, macOS:

    aiken check                  → in đầy đủ chẩn đoán  (stdout LÀ tty)
    aiken check > tep 2>&1       → 0 byte stdout, 111 byte stderr, mã thoát 1
    aiken check | cat            → y hệt: KHÔNG một dòng chẩn đoán nào

Tức `aiken` chỉ in chẩn đoán khi stdout là một terminal THẬT. Mọi đường ống, mọi chuyển
hướng ra tệp đều làm nó câm. Đây đúng là hình dạng hỏng mà `Forall §Cổng gác` xếp nặng
nhất: một bước ĐỎ mà KHÔNG có nhật ký, và người đọc kết luận "không rõ nguyên nhân" trong
khi hệ vẫn đang nói thật — chỉ nói ở một kênh khác kênh người ta nhìn.

`script -q` của macOS không cấp được pty trong môi trường này (`script -q f echo hello`
trả về rỗng), nên bộ bọc bằng `pty.spawn` là đường duy nhất còn lại.

Dùng:  python3 run_with_tty.py <lệnh> [tham số...]
"""

import os
import pty
import sys

if len(sys.argv) < 2:
    sys.stderr.write("dùng: run_with_tty.py <lệnh> [tham số...]\n")
    raise SystemExit(2)

status = pty.spawn(sys.argv[1:])
# `pty.spawn` trả về trạng thái kiểu `wait()`; đổi về mã thoát thường.
code = os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else (
    status >> 8
)
sys.stdout.write("\nMA_THOAT=%d\n" % code)
sys.stdout.flush()
raise SystemExit(code)
