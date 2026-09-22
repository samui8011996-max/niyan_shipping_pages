# -*- coding: utf-8 -*-
"""
把 Noto Sans TC Bold 切成「只含撿貨代號用字」的小字型 → shopee-code-font.ttf

為什麼要有這支:pdf-lib 在前端對中文字型做 subset 會隨機掉字(實測「貓」「大」「右」
印不出來,「黃」「金」卻正常),所以改成離線切好、執行時整包嵌入(subset:false)。
完整 Noto Sans TC Bold 約 9MB,切完約幾十 KB,才有辦法當網頁資源載。

用法:
    python build-shopee-font.py [來源字型路徑]

字集的唯一來源是 shopee-shortcode.js 的 SHOPEE_CODE_CHARS,這支自己去讀,
所以改規則時只要改那一個地方,再重跑這支即可。
"""
import base64
import io
import json
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SRC = r"C:\Users\Administrator\Downloads\Noto_Sans_TC\static\NotoSansTC-Bold.ttf"
OUT = os.path.join(HERE, "shopee-code-font.ttf")
# 同一份字型的 base64 內嵌版。網頁真正載的是這支 —— 直接用檔案總管
# 點開 index.html(file:// )時,fetch 抓不到同目錄的 .ttf(瀏覽器擋跨來源),
# 會變成「產生失敗:Failed to fetch」。內嵌就沒有這個問題,也少一次請求。
OUT_JS = os.path.join(HERE, "shopee-code-font.js")


def read_charset():
    src = open(os.path.join(HERE, "shopee-shortcode.js"), encoding="utf-8").read()
    m = re.search(r'const SHOPEE_CODE_CHARS\s*=\s*("[^"]*")', src)
    if not m:
        raise SystemExit("shopee-shortcode.js 裡找不到 SHOPEE_CODE_CHARS")
    return json.loads(m.group(1))


def main():
    src_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.exists(src_path):
        raise SystemExit("找不到來源字型:%s" % src_path)

    chars = read_charset()
    font = TTFont(src_path)

    # 字型本身就沒有的字先抓出來講,不然切完才發現是「□」
    cmap = font.getBestCmap()
    absent = [c for c in chars if ord(c) not in cmap]
    if absent:
        print("!! 來源字型缺這些字,代號印出來會變空白:", "".join(absent))

    opts = subset.Options()
    opts.desubroutinize = True
    opts.layout_features = []      # 代號不需要連字/替代字形
    opts.name_IDs = ["*"]
    opts.notdef_outline = True     # 缺字要看得見一個框,不要變空白
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(text=chars)
    subsetter.subset(font)
    font.save(OUT)

    raw = open(OUT, "rb").read()
    b64 = base64.b64encode(raw).decode("ascii")
    with io.open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("// 自動產生,不要手改 —— 改字集請改 shopee-shortcode.js 的 SHOPEE_CODE_CHARS,\n")
        f.write("// 再重跑 build-shopee-font.py。這是 %s 的 base64 內嵌版。\n" % os.path.basename(OUT))
        f.write("const SHOPEE_CODE_FONT_B64 = \"%s\";\n" % b64)

    print("字集 %d 字 → %s (%.1f KB) / %s (%.1f KB)" % (
        len(chars), os.path.basename(OUT), len(raw) / 1024,
        os.path.basename(OUT_JS), os.path.getsize(OUT_JS) / 1024))


if __name__ == "__main__":
    main()
