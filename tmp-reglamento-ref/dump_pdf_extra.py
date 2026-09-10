import fitz
import os
import json

src = r"c:\Users\rogel\Downloads\sm-reglamento funeral.pdf"
out = r"c:\desarrollo\sanmartin\proyectos comercial\venta-digital-front\tmp-reglamento-ref"
doc = fitz.open(src)

def rgb(c):
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)

print("gold", rgb(13541750), hex(13541750))
print("ink", rgb(3368063), hex(3368063))

# drawings
for i, page in enumerate(doc):
    drawings = page.get_drawings()
    print("PAGE", i + 1, "drawings", len(drawings))
    for d in drawings[:40]:
        print(" ", d.get("type"), "rect", d.get("rect"), "color", d.get("color"), "fill", d.get("fill"), "width", d.get("width"))

# full text per page
for i, page in enumerate(doc):
    text = page.get_text("text")
    path = os.path.join(out, f"page-{i+1}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote", path, "chars", len(text))

# extract vector logo area from page 1 right header
page = doc[0]
clip = fitz.Rect(420, 40, 580, 110)
pix = page.get_pixmap(matrix=fitz.Matrix(4, 4), clip=clip, alpha=True)
pix.save(os.path.join(out, "logo-clip.png"))
clip2 = fitz.Rect(80, 430, 350, 520)
pix2 = page.get_pixmap(matrix=fitz.Matrix(4, 4), clip=clip2, alpha=True)
pix2.save(os.path.join(out, "firma-clip.png"))
print("saved clips")
