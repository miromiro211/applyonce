import json, sys, io, os
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts", "NanumGothic.ttf")
pdfmetrics.registerFont(TTFont("NanumKR", FONT_PATH))


def wrap_text(text, max_width_pt, font_name, font_size, c):
    """entry box 너비를 넘어가면 줄바꿈 (글자 단위, 한글 안전)"""
    lines, cur = [], ""
    for ch in text:
        trial = cur + ch
        if c.stringWidth(trial, font_name, font_size) > max_width_pt and cur:
            lines.append(cur)
            cur = ch
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def fill_pdf(input_pdf_path, fields_json_path, output_pdf_path):
    fields_data = json.load(open(fields_json_path, encoding="utf-8"))
    reader = PdfReader(input_pdf_path)

    page_info_by_num = {p["page_number"]: p for p in fields_data["pages"]}
    fields_by_page = {}
    for f in fields_data["form_fields"]:
        if not f.get("entry_text", {}).get("text"):
            continue
        fields_by_page.setdefault(f["page_number"], []).append(f)

    writer = PdfWriter()

    for i, page in enumerate(reader.pages):
        page_num = i + 1
        mediabox = page.mediabox
        pdf_width, pdf_height = float(mediabox.width), float(mediabox.height)

        page_fields = fields_by_page.get(page_num, [])
        if page_fields:
            buf = io.BytesIO()
            c = canvas.Canvas(buf, pagesize=(pdf_width, pdf_height))
            c.setFont("NanumKR", 9.5)
            c.setFillColorRGB(0.15, 0.25, 0.75)  # 은은한 파란색으로 "자동 채움" 티 내기

            for f in page_fields:
                entry = f["entry_text"]
                text = entry["text"]
                font_size = entry.get("font_size", 9.5)
                x0, top, x1, bottom = f["entry_bounding_box"]  # PDF coords: y=0 top of page (structure extractor convention)
                box_w = x1 - x0
                c.setFont("NanumKR", font_size)

                lines = wrap_text(text, box_w - 4, "NanumKR", font_size, c)
                max_lines = max(1, int((bottom - top) // (font_size + 3)))
                if len(lines) > max_lines:
                    lines = lines[:max_lines]
                    if lines:
                        lines[-1] = lines[-1][:-1] + "…" if len(lines[-1]) > 1 else lines[-1]

                # 행의 세로 중앙에 텍스트 블록을 배치 (여러 줄이면 블록 전체를 중앙 정렬)
                row_center_top_down = (top + bottom) / 2
                block_height = len(lines) * (font_size + 3)
                first_line_top_down = row_center_top_down - block_height / 2 + font_size
                for li, line in enumerate(lines):
                    line_top_down = first_line_top_down + li * (font_size + 3)
                    y_pdf = pdf_height - line_top_down
                    c.drawString(x0 + 2, y_pdf, line)

            c.save()
            buf.seek(0)
            overlay_reader = PdfReader(buf)
            page.merge_page(overlay_reader.pages[0])

        writer.add_page(page)

    with open(output_pdf_path, "wb") as f:
        writer.write(f)

    total = sum(len(v) for v in fields_by_page.values())
    print(f"Successfully filled PDF and saved to {output_pdf_path}")
    print(f"Added {total} text overlays")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: fill_pdf_korean.py <input.pdf> <fields.json> <output.pdf>")
        sys.exit(1)
    fill_pdf(sys.argv[1], sys.argv[2], sys.argv[3])
