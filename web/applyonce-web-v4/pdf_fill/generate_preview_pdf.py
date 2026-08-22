import json
import os
import sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4

FONT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts", "NanumGothic.ttf")
pdfmetrics.registerFont(TTFont("NanumKR", FONT_PATH))

PAGE_W, PAGE_H = A4
MARGIN_X = 50
TOP = PAGE_H - 52
BOTTOM = 50
CONTENT_W = PAGE_W - MARGIN_X * 2


def wrap_text(text, max_width, font_size):
    text = str(text or "")
    lines = []
    for paragraph in text.splitlines() or [""]:
        if paragraph == "":
            lines.append("")
            continue
        current = ""
        for ch in paragraph:
            trial = current + ch
            if current and pdfmetrics.stringWidth(trial, "NanumKR", font_size) > max_width:
                lines.append(current)
                current = ch
            else:
                current = trial
        lines.append(current)
    return lines or [""]


def draw_header(c, title):
    c.setFillColorRGB(0.09, 0.13, 0.20)
    c.setFont("NanumKR", 18)
    c.drawString(MARGIN_X, TOP, title or "지원서")
    c.setFillColorRGB(0.45, 0.51, 0.60)
    c.setFont("NanumKR", 8.5)
    c.drawString(MARGIN_X, TOP - 20, "ApplyOnce에서 저장한 문서")
    return TOP - 46


def new_page(c, title):
    c.showPage()
    return draw_header(c, title)


def generate(data_path, output_path):
    with open(data_path, encoding="utf-8") as f:
        data = json.load(f)

    title = data.get("title") or "지원서"
    fields = data.get("filled_fields") or []
    c = canvas.Canvas(output_path, pagesize=A4)
    y = draw_header(c, title)

    for field in fields:
        label = str(field.get("label") or "")
        value = field.get("value")
        text = str(value).strip() if value is not None else ""
        if not text:
            text = "직접 입력이 필요합니다"

        label_size = 8.5
        value_size = 10.5
        line_height = 16
        lines = wrap_text(text, CONTENT_W - 12, value_size)
        block_h = 17 + max(1, len(lines)) * line_height + 13

        if y - block_h < BOTTOM:
            y = new_page(c, title)

        c.setFillColorRGB(0.42, 0.48, 0.57)
        c.setFont("NanumKR", label_size)
        c.drawString(MARGIN_X, y, label)
        y -= 15

        source = field.get("source")
        if source == "profile":
            accent = (0.48, 0.79, 0.26)
        elif source == "ai_generated":
            accent = (0.18, 0.62, 0.96)
        else:
            accent = (1.0, 0.62, 0.26)

        c.setFillColorRGB(0.99, 0.995, 1.0)
        box_h = max(27, len(lines) * line_height + 8)
        c.roundRect(MARGIN_X, y - box_h + 5, CONTENT_W, box_h, 5, stroke=0, fill=1)
        c.setStrokeColorRGB(*accent)
        c.setLineWidth(1.5)
        c.line(MARGIN_X, y - box_h + 5, MARGIN_X + CONTENT_W, y - box_h + 5)

        c.setFillColorRGB(0.10, 0.14, 0.20)
        c.setFont("NanumKR", value_size)
        line_y = y - 11
        for line in lines:
            c.drawString(MARGIN_X + 6, line_y, line)
            line_y -= line_height
        y -= box_h + 13

    c.save()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: generate_preview_pdf.py <data.json> <output.pdf>")
        sys.exit(1)
    generate(sys.argv[1], sys.argv[2])
