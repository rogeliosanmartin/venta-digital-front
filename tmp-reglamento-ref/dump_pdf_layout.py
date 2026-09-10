import fitz
import os
import json

src = r"c:\Users\rogel\Downloads\sm-reglamento funeral.pdf"
out = r"c:\desarrollo\sanmartin\proyectos comercial\venta-digital-front\tmp-reglamento-ref"
os.makedirs(out, exist_ok=True)
doc = fitz.open(src)

report = []
for i, page in enumerate(doc):
    info = {
        "page": i + 1,
        "rect": [page.rect.width, page.rect.height],
        "fonts": page.get_fonts(full=True),
        "images": [],
        "blocks": [],
    }
    for j, img in enumerate(page.get_images(full=True)):
        xref = img[0]
        pix = fitz.Pixmap(doc, xref)
        if pix.n - pix.alpha > 3:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        path = os.path.join(out, f"img-p{i+1}-{j}.png")
        pix.save(path)
        info["images"].append({"path": path, "w": pix.width, "h": pix.height, "xref": xref})
    blocks = page.get_text("dict")["blocks"]
    for b in blocks:
        if b.get("type") != 0:
            info["blocks"].append({"type": b.get("type"), "bbox": [round(x, 1) for x in b["bbox"]]})
            continue
        first = {}
        if b["lines"] and b["lines"][0]["spans"]:
            first = b["lines"][0]["spans"][0]
        sample = "".join(s["text"] for l in b["lines"] for s in l["spans"])
        info["blocks"].append(
            {
                "bbox": [round(x, 1) for x in b["bbox"]],
                "size": first.get("size"),
                "font": first.get("font"),
                "color": first.get("color"),
                "flags": first.get("flags"),
                "text": sample,
            }
        )
    report.append(info)

with open(os.path.join(out, "layout.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print("pages", doc.page_count)
for info in report:
    print("PAGE", info["page"], info["rect"], "blocks", len(info["blocks"]), "images", len(info["images"]))
    for b in info["blocks"]:
        t = (b.get("text") or "")[:90].replace("\n", " ")
        print("  ", b.get("bbox"), "sz=", b.get("size"), "font=", b.get("font"), "col=", b.get("color"), t)
