#!/usr/bin/env python3
"""Regenera src/symbols-font.ts: un subconjunto de DejaVu Sans con los símbolos que Roboto (la fuente de pdfmake)
no incluye (flechas, operadores matemáticos, letras en superíndice/subíndice, ✓ ☐…).

Requisitos: pip install fonttools · DejaVuSans.ttf instalada (p. ej. /usr/share/fonts/truetype/dejavu/).
Licencia de DejaVu: Bitstream Vera (permite redistribuir derivados si se renombra la familia; aquí: «Synthesis Symbols»).
"""
import base64, subprocess, sys
from fontTools.ttLib import TTFont

DEJAVU = sys.argv[1] if len(sys.argv) > 1 else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
ROBOTO = "node_modules/pdfmake/build/fonts/Roboto/Roboto-Regular.ttf"

rob = TTFont(ROBOTO).getBestCmap()
dej = TTFont(DEJAVU).getBestCmap()
ranges = [(0x2190, 0x21FF), (0x2200, 0x22FF), (0x2100, 0x214F), (0x2150, 0x215F), (0x25A0, 0x25FF), (0x2610, 0x2612),
          (0x2713, 0x2718), (0x27E8, 0x27E9), (0x2300, 0x2308), (0x230A, 0x230B), (0x2070, 0x209F), (0x2B05, 0x2B07),
          (0x1D00, 0x1DBF), (0x02B0, 0x02FF), (0x2C60, 0x2C7F), (0x2010, 0x205E), (0x2460, 0x2473), (0x2605, 0x2606)]
cands = set()
for a, b in ranges:
    cands.update(range(a, b + 1))
need = sorted(c for c in cands if c not in rob and c in dej)  # lo que Roboto NO tiene y DejaVu SÍ

subprocess.run(["pyftsubset", DEJAVU, "--unicodes=" + ",".join(f"U+{c:04X}" for c in need),
                "--output-file=tools/SymbolsRaw.ttf", "--layout-features=", "--no-hinting", "--desubroutinize"], check=True)
f = TTFont("tools/SymbolsRaw.ttf")
for rec in f["name"].names:
    if rec.nameID in (1, 16, 4):
        rec.string = "Synthesis Symbols"
    elif rec.nameID == 6:
        rec.string = "SynthesisSymbols"
    elif rec.nameID == 3:
        rec.string = "SynthesisSymbols-1.0"
f.save("tools/Symbols.ttf")

def esc(c): return f"\\u{c:04X}" if c <= 0xFFFF else f"\\u{{{c:X}}}"
groups, start, prev = [], need[0], need[0]
for c in need[1:] + [None]:
    if c is not None and c == prev + 1:
        prev = c
        continue
    groups.append((start, prev))
    if c is not None:
        start = prev = c
cls = "".join(esc(a) if a == b else f"{esc(a)}-{esc(b)}" for a, b in groups)
b64 = base64.b64encode(open("tools/Symbols.ttf", "rb").read()).decode()
open("src/symbols-font.ts", "w").write(
    "// Subconjunto de DejaVu Sans (licencia Bitstream Vera / dominio público) con símbolos que Roboto no incluye:\n"
    "// flechas, operadores matemáticos, letras en superíndice/subíndice, marcas ✓ ☐, etc. Renombrado a \"Synthesis Symbols\".\n"
    f"export const SYMBOLS_REGEX = /[{cls}]+/g;\nexport const SYMBOLS_TTF_BASE64 =\n  \"{b64}\";\n")
print(f"{len(need)} glifos · {len(b64) // 1024} KB en base64")
