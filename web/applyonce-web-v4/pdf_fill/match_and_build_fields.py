import json, re, sys
import pdfplumber

def normalize(s):
    return re.sub(r"[\s\*\u00b7\.]+", "", s)

def detect_column_boundary(pdf_path):
    """표의 세로선(컬럼 경계)을 찾아서 입력 컬럼의 x0, x1을 반환.
    세로선이 없으면 None을 반환 (자유 양식으로 간주, 다른 배치 전략 사용)."""
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[0]
        vert = [l for l in page.lines if abs(l["x0"] - l["x1"]) < 1]
        if len(vert) < 2:
            return None
        xs = sorted(set(round(l["x0"], 1) for l in vert))
        return xs[0], xs[-1]


def cluster_words_into_lines(labels, y_tolerance=3.0):
    """단어들을 '시각적 한 줄' 단위로 묶는다. 표의 가로선 유무와 무관하게
    동작해서, 표 형태든 '라벨: ___' 자유 양식이든 라벨을 안정적으로 잡아낸다."""
    sorted_labels = sorted(labels, key=lambda l: (l["top"], l["x0"]))
    lines = []
    for w in sorted_labels:
        placed = False
        for line in lines:
            if abs(line["top"] - w["top"]) <= y_tolerance:
                line["words"].append(w)
                line["top"] = min(line["top"], w["top"])
                line["bottom"] = max(line["bottom"], w["bottom"])
                placed = True
                break
        if not placed:
            lines.append({"top": w["top"], "bottom": w["bottom"], "words": [w]})

    result = []
    for line in lines:
        words = sorted(line["words"], key=lambda w: w["x0"])
        text = "".join(w["text"] for w in words)
        result.append({
            "top": line["top"], "bottom": line["bottom"],
            "text": text, "text_norm": normalize(text),
            "label_end_x": max(w["x1"] for w in words),
        })
    return sorted(result, key=lambda l: l["top"])


def find_underline_near(pdf_path, y_top_down, x_start, x_search_limit, tolerance=6.0):
    """라벨과 같은 줄(또는 바로 아래) 근처에 있는 밑줄을 찾아 입력칸 오른쪽 끝으로 사용.
    못 찾으면 None."""
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[0]
        candidates = [
            l for l in page.lines
            if abs(l["x1"] - l["x0"]) > 5  # 가로선만
            and l["x0"] >= x_start - 2
            and abs(l["top"] - y_top_down) <= tolerance
        ]
        if not candidates:
            return None
        return max(c["x1"] for c in candidates)


def build_fields_json(pdf_path, structure_path, filled_fields, entry_gap=6):
    structure = json.load(open(structure_path, encoding="utf-8"))
    page = structure["pages"][0]
    labels = structure["labels"]
    page_width = page["width"]

    col_bounds = detect_column_boundary(pdf_path)
    row_boundaries = structure["row_boundaries"]

    # 표(세로선 있음): 기존에 검증된 "행 전체가 입력칸" 방식 그대로 사용.
    # 자유 양식(세로선 없음): 줄 단위 클러스터링 + 라벨과 같은 줄에 배치.
    is_table = col_bounds is not None

    if is_table:
        rows = []
        for rb in row_boundaries:
            row_top, row_bottom = rb["row_top"], rb["row_bottom"]
            row_labels = [l for l in labels if row_top - 1 <= l["top"] < row_bottom - 1]
            row_labels.sort(key=lambda l: l["x0"])
            text = "".join(l["text"] for l in row_labels)
            max_x1 = max((l["x1"] for l in row_labels), default=row_top)
            rows.append({
                "top": row_top, "bottom": row_bottom,
                "text": text, "text_norm": normalize(text),
                "label_end_x": max_x1,
            })
    else:
        rows = cluster_words_into_lines(labels)

    form_fields = []
    used_rows = set()
    unmatched = []

    for f in filled_fields:
        target = normalize(f["label"])
        best_idx, best_score = None, 0
        for i, r in enumerate(rows):
            if i in used_rows:
                continue
            a, b = set(target), set(r["text_norm"])
            if not a or not b:
                continue
            score = len(a & b) / len(a | b)
            if target[:6] and target[:6] in r["text_norm"]:
                score += 0.3
            if score > best_score:
                best_score, best_idx = score, i

        if best_idx is None or best_score < 0.25:
            unmatched.append(f["label"])
            continue

        used_rows.add(best_idx)
        row = rows[best_idx]
        value = f.get("value")

        if is_table:
            entry_x0, table_right_x = col_bounds
            entry_x0 += entry_gap
            entry_top, entry_bottom = row["top"], row["bottom"]
        else:
            # 자유 양식: 라벨과 같은 줄, 라벨 바로 뒤부터 입력칸 시작.
            entry_x0 = row["label_end_x"] + entry_gap
            underline_x1 = find_underline_near(pdf_path, row["bottom"], entry_x0, page_width)
            table_right_x = (underline_x1 if underline_x1 else page_width - 20) + 4
            # 줄 높이가 너무 좁으면(한 줄 텍스트) 여유를 좀 줘서 살짝 아래로 여러 줄 쓸 공간 확보
            entry_top, entry_bottom = row["top"], row["bottom"]

        form_fields.append({
            "page_number": 1,
            "description": f["label"],
            "field_label": f["label"],
            "label_bounding_box": [row["label_end_x"] - 60, entry_top, row["label_end_x"], entry_bottom],
            "entry_bounding_box": [entry_x0, entry_top, table_right_x - 4, entry_bottom],
            "entry_text": {"text": value if value else "", "font_size": 9.5},
            "_source": f.get("source"),
            "_layout": "table" if is_table else "freeform",
        })

    return {
        "pages": [{"page_number": 1, "pdf_width": page["width"], "pdf_height": page["height"]}],
        "form_fields": [ff for ff in form_fields if ff["entry_text"]["text"]],
    }, unmatched


if __name__ == "__main__":
    pdf_path = sys.argv[1]
    structure_path = sys.argv[2]
    filled_fields_path = sys.argv[3]
    out_path = sys.argv[4]

    filled_fields = json.load(open(filled_fields_path, encoding="utf-8"))["filled_fields"]
    result, unmatched = build_fields_json(pdf_path, structure_path, filled_fields)

    json.dump(result, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"매칭된 필드: {len(result['form_fields'])} / {len(filled_fields)}")
    if unmatched:
        print("매칭 실패:", unmatched)
