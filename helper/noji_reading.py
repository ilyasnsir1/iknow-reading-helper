from pathlib import Path
import re
import unicodedata


ROWS = [
    ("アイウエオ", "a i u e o"), ("カキクケコ", "ka ki ku ke ko"),
    ("サシスセソ", "sa shi su se so"), ("タチツテト", "ta chi tsu te to"),
    ("ナニヌネノ", "na ni nu ne no"), ("ハヒフヘホ", "ha hi fu he ho"),
    ("マミムメモ", "ma mi mu me mo"), ("ラリルレロ", "ra ri ru re ro"),
    ("ガギグゲゴ", "ga gi gu ge go"), ("ザジズゼゾ", "za ji zu ze zo"),
    ("ダヂヅデド", "da ji zu de do"), ("バビブベボ", "ba bi bu be bo"),
    ("パピプペポ", "pa pi pu pe po"), ("ヤユヨワヲ", "ya yu yo wa o"),
]
SYLLABLES = {kana: roman for row, words in ROWS for kana, roman in zip(row, words.split())}
for kana, stem in {"キ": "ky", "ギ": "gy", "シ": "sh", "ジ": "j", "チ": "ch", "ニ": "ny", "ヒ": "hy", "ビ": "by", "ピ": "py", "ミ": "my", "リ": "ry"}.items():
    for small, vowel in zip("ャュョ", "auo"):
        SYLLABLES[kana + small] = stem + vowel
SYLLABLES.update({"ファ": "fa", "フィ": "fi", "フェ": "fe", "フォ": "fo", "ティ": "ti", "ディ": "di", "トゥ": "tu", "ドゥ": "du", "シェ": "she", "ジェ": "je", "チェ": "che", "ヴ": "vu", "ヴァ": "va", "ヴィ": "vi", "ヴェ": "ve", "ヴォ": "vo", "ツァ": "tsa", "ツィ": "tsi", "ツェ": "tse", "ツォ": "tso", "ウィ": "wi", "ウェ": "we"})


def romanize(kana):
    kana = unicodedata.normalize("NFKC", kana).replace("’", "").replace("'", "")
    kana = "".join(chr(ord(char) + 0x60) if "ぁ" <= char <= "ゖ" else char for char in kana)
    result, index = "", 0
    while index < len(kana):
        char = kana[index]
        if char == "ン":
            following = next((SYLLABLES.get(kana[index + 1:index + 1 + size]) for size in (2, 1) if SYLLABLES.get(kana[index + 1:index + 1 + size])), "")
            result += "n'" if following.startswith(tuple("aeiouy")) else "n"
        elif char == "ッ":
            following = next((SYLLABLES.get(kana[index + 1:index + 1 + size]) for size in (2, 1) if SYLLABLES.get(kana[index + 1:index + 1 + size])), "")
            if not following or following[0] in "aeioun":
                return None
            result += "t" if following.startswith("ch") else following[0]
        elif char == "ー":
            vowels = re.findall("[aeiou]", result)
            if not vowels:
                return None
            result += vowels[-1]
        else:
            size = 2 if kana[index:index + 2] in SYLLABLES else 1
            part = SYLLABLES.get(kana[index:index + size])
            if not part:
                return None
            result += part
            index += size - 1
        index += 1
    return result or None


def read(text):
    try:
        import pyopenjtalk
        raw = pyopenjtalk.OPEN_JTALK_DICT_DIR
        directory = Path(raw.decode() if isinstance(raw, bytes) else raw)
        if not (directory / "sys.dic").is_file():
            return None
        words = pyopenjtalk.run_frontend(text)
    except (ImportError, OSError, RuntimeError, AttributeError):
        return None
    result = []
    punctuation = {"。": ".", "、": ",", "？": "?", "！": "!", "?": "?", "!": "!", ".": ".", ",": ","}
    index = 0
    while index < len(words):
        word = words[index]
        index += 1
        source = word.get("string", "")
        if source in punctuation:
            if result:
                result[-1] += punctuation[source]
            continue
        if word.get("pos") == "記号":
            continue
        reading = word.get("pron") or word.get("read") or ""
        while reading.endswith("ッ") and index < len(words) and words[index].get("pos") != "記号":
            reading += words[index].get("pron") or words[index].get("read") or ""
            index += 1
        part = romanize(reading)
        if not part:
            return None
        result.append(part)
    value = " ".join(result)
    return value if value and len(value) <= 2000 and re.fullmatch(r"[a-z0-9 ,.!?;:'()\"-]+", value) else None
