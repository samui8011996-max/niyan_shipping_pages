# -*- coding: utf-8 -*-
"""
把 Noto Sans TC Bold 切成出貨單用得到的字,輸出 shopee-code-font.ttf 和 .js(base64 內嵌版)

字集 = Big5 常用字(5401) + ASCII + 常見標點 + shopee-shortcode.js 的 SHOPEE_CODE_CHARS
(規則自己會產生的字,大多本來就在 Big5 裡,列出來是為了「改了規則要重跑這支」有個依據)。
放到 Big5 常用字這麼大,是因為預覽可以按「編輯」手動改文字 —— 只切代號用字的話,
臨時打個「贈品」「急件」就會印成「□」。

為什麼要自己切:
  1. PDF 一定要把字型嵌進去才能保證在別台電腦/印表機印得出來,不能只寫字型名稱。
  2. 完整的 Noto Sans TC 有兩萬多字、9MB,整包嵌進每張出貨單不切實際。
  3. **pdf-lib(@pdf-lib/fontkit)的 `subset: true` 對中文是壞的** —— 會靜靜掉字,
     不報錯。實測連這支切好的 1.8MB 子集再交給它 subset,整行字也只剩零星幾個。
     所以產 PDF 時一律 `subset: false`,大小要在這裡先控制好。

切完約 1.8MB(base64 2.4MB)。網頁是「按下產生時才載入」,載一次就被瀏覽器快取;
每份產出的 PDF 會多約 1.2MB 的字型,對列印來說沒差。

用法:
    python build-shopee-font.py [來源字型路徑]
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
# 網頁真正載的是這支。用內嵌而不是 fetch("*.ttf") 的原因是 —— 同事常直接用檔案總管
# 點開 index.html(file://),瀏覽器會擋掉抓同目錄檔案的請求,只回一句「Failed to fetch」。
OUT_JS = os.path.join(HERE, "shopee-code-font.js")
# 字集清單另外存一個小檔,理由見下面寫檔的地方
OUT_CHARS = os.path.join(HERE, "shopee-code-chars.js")

ASCII = "".join(chr(c) for c in range(0x20, 0x7F))
PUNCT = "【】（）　、，。：；！？…—・×＋－／％＊「」『』〈〉～"


def big5_common():
    """Big5 常用字(Level 1)= cp950 0xA440–0xC67E。台灣繁體日常用字都在裡面。"""
    out = []
    for b in range(0xA440, 0xC67E + 1):
        try:
            ch = bytes([b >> 8, b & 0xFF]).decode("cp950")
        except Exception:
            continue
        if len(ch) == 1 and "\u4e00" <= ch <= "\u9fff":
            out.append(ch)
    return out


def rule_chars():
    src = open(os.path.join(HERE, "shopee-shortcode.js"), encoding="utf-8").read()
    m = re.search(r'const SHOPEE_CODE_CHARS\s*=\s*("[^"]*")', src)
    if not m:
        raise SystemExit("shopee-shortcode.js 裡找不到 SHOPEE_CODE_CHARS")
    return json.loads(m.group(1))


def main():
    src_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.exists(src_path):
        raise SystemExit("找不到來源字型:%s" % src_path)

    chars = "".join(sorted(set(big5_common() + list(ASCII + PUNCT + rule_chars()))))
    font = TTFont(src_path)

    # 字型本身就沒有的字先講,不然切完才發現是「□」
    cmap = font.getBestCmap()
    absent = [c for c in chars if ord(c) not in cmap]
    if absent:
        print("!! 來源字型缺這些字,已排除:", "".join(absent))
        chars = "".join(c for c in chars if ord(c) in cmap)

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
    with io.open(OUT_CHARS, "w", encoding="utf-8") as f:
        f.write("// 自動產生,不要手改 —— 執行 build-shopee-font.py 重建。\n")
        f.write("// 這份字型真正含有的字。sanitizeCode() 拿它判斷缺不缺字,所以要隨頁面載入\n")
        f.write("// (字型本體 2.4MB 是按下產生時才載的,不能為了判斷缺字先把它拖下來)。\n")
        f.write("const SHOPEE_FONT_CHARS = %s;\n" % json.dumps(chars, ensure_ascii=False))

    with io.open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("// 自動產生,不要手改 —— 執行 build-shopee-font.py 重建。\n")
        f.write("const SHOPEE_CODE_FONT_B64 = \"%s\";\n" % b64)

    print("字集 %d 字 → %s (%.0f KB) / %s (%.0f KB) / %s (%.0f KB)" % (
        len(chars), os.path.basename(OUT), len(raw) / 1024,
        os.path.basename(OUT_JS), os.path.getsize(OUT_JS) / 1024,
        os.path.basename(OUT_CHARS), os.path.getsize(OUT_CHARS) / 1024))


if __name__ == "__main__":
    main()
