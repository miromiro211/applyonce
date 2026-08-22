# ApplyOnce 목업

프로필 입력(로컬 저장) → 공고문/지원서 양식 PDF 업로드 → Upstage Studio 에이전트 호출 → 채워진 필드 결과 표시까지 이어지는 실동작 목업입니다.

## 사전 준비
- Node.js 18 이상 (내장 `fetch`, `FormData`, `Blob` 사용)
- Python 3.8 이상 + pip 패키지 (원본 양식 PDF 채우기 기능에 필요)
  ```bash
  cd pdf_fill
  pip install -r requirements.txt
  ```
  Windows에서 `python` 명령을 못 찾으면 `.env`에 `PYTHON_BIN=python3` 또는 실제 실행 파일 경로를 추가하세요.

## 실행 방법

```bash
cd applyonce-mockup-v2
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속.

`.env` 파일에 API 키와 Agent ID가 이미 채워져 있습니다:
```
UPSTAGE_API_KEY=up_xxxxxxxx...
UPSTAGE_AGENT_ID=agt_xxxxxxxx...
```
다른 사람과 공유하거나 git에 올릴 때는 이 값을 반드시 지우거나 `.env.example` 기준으로 새로 받으세요. (`.gitignore`에 이미 `.env` 포함됨)

## 동작 흐름

1. 프론트(`public/index.html`)에서 프로필 입력 후 "프로필 저장" → 브라우저 `localStorage`에 저장 (실제 서비스에서는 웹 백엔드 DB에 저장되는 부분)
2. 공고문 PDF + 지원서 양식 PDF 업로드 후 "문서 자동 생성하기" 클릭
3. 서버(`server.js`)가:
   - 두 PDF를 Upstage `/v2/files`에 업로드 (`purpose: user_data`)
   - `/v2/responses`에 Agent ID + 업로드된 file_id 2개 + 프로필 JSON을 포함한 프롬프트로 실행 요청
   - 응답 상태가 `completed`가 아니면 `/v2/responses/{id}`를 폴링
   - 완료되면 응답 텍스트에서 마크다운 코드블록 제거 후 JSON 파싱
4. 결과 JSON(`filled_fields`)을 프론트로 반환, 필드별로 `profile`/`ai_generated`/`manual_required` 배지와 함께 표시

## 반영된 공식 스펙 (Studio "API 사용법" 문서 기준)

- Step 1. `POST /v2/files` — `file`, `purpose=user_data` (multipart) → `file_id` 반환
- Step 2. `POST /v2/responses` — body에 `model`(Agent ID), **`config_id`**, `input` 필요. `config_id`는 Studio 워크플로우 상세 화면의 "Config ID" 값 (`.env`의 `UPSTAGE_CONFIG_ID`)
- Step 3. `GET /v2/responses/{job_id}` — `status`가 `queued` → `in_progress` → `completed`/`failed`가 될 때까지 폴링

`include` 파라미터는 공식 예시에 없어서 제거했습니다.

## 원본 양식 그대로 채우기 (신규)

"결과" 패널에서 **원본 양식에 그대로 채우기 (PDF)** 버튼을 누르면, `pdf_fill/` 폴더의 Python 스크립트 체인이 실행됩니다:

1. `extract_form_structure.py` — 업로드한 지원서 양식 PDF에서 라벨 텍스트 좌표, 행 경계, 표 세로선(컬럼 경계)을 추출
2. `match_and_build_fields.py` — Instruct 결과의 `filled_fields` 라벨을 추출된 라벨과 문자 유사도로 자동 매칭해 입력칸(entry) 좌표 계산
3. `fill_pdf_korean.py` — 나눔고딕 폰트(`pdf_fill/fonts/NanumGothic.ttf`, 프로젝트에 동봉되어 있어 별도 설치 불필요)를 임베드해서 원본 PDF 위에 값을 직접 그려 넣음

표가 아니라 "라벨: ___밑줄___" 같은 자유 양식 PDF에도 같은 파이프라인이 동작하지만(라벨 바로 뒤 여백을 입력칸으로 추정), 표 형태처럼 세로선이 뚜렷한 양식일수록 매칭 정확도가 높습니다. 라벨 문구가 원본과 많이 다르면 매칭에 실패할 수 있는데, 이 경우 서버 콘솔에 `매칭 실패:` 로 어떤 라벨이 안 잡혔는지 로그가 남습니다.

**다음 단계로 고려할 것**: 자동 매칭/배치가 틀렸을 때 사용자가 직접 텍스트 박스를 드래그해서 위치를 보정할 수 있는 미리보기 UI. 지금은 자동 배치만 있고 수동 보정 기능은 없습니다.

## 남은 불확실 지점 (에이전트 API 응답 구조)

Job 생성/조회 응답에서 **최종 결과 텍스트가 정확히 어느 필드에 들어있는지**는 공식 예시에 명시돼 있지 않습니다. 현재 코드는 `output_text` → `output[].content[].text` 순으로 찾도록 되어 있는데, 실제 응답 구조가 다르면 여기서 `rawText`가 빈 문자열이 되어 JSON 파싱 에러가 납니다.

첫 실행 시 서버 콘솔에 다음 로그가 그대로 찍힙니다:
- `[디버그] Job 생성 응답:` — Step 2 응답 전체
- `[디버그] 폴링 N회차 status:` — 폴링할 때마다 상태
- `[디버그] 원문 응답:` — 최종 추출 시도한 텍스트

에러가 나면 `[디버그] Job 생성 응답:` 또는 폴링 완료 시점 응답 전체를 콘솔에서 확인해서, 결과 텍스트가 실제로 어느 키에 들어있는지 보고 `server.js` 맨 아래 `rawText` 추출 부분만 그 경로에 맞게 고치면 됩니다.

## 이번 수정에서 추가된 기능

- 생성 직후 결과 문서는 **편집 모드**로 열립니다.
- **저장** 버튼을 누르면 현재 내용을 브라우저 `localStorage`에 저장하고 문서를 읽기 전용으로 전환합니다.
- **편집** 버튼을 누르면 다시 수정할 수 있습니다.
- 저장 후 **PDF로 내보내기** 버튼으로 미리보기 문서 자체를 A4 PDF로 생성할 수 있습니다.
- **인쇄용으로 내보내기**는 브라우저 인쇄 화면을 열며, 인쇄 CSS에서 사이드바/입력 패널이 차지하던 그리드 폭을 제거해 문서가 왼쪽으로 밀리지 않도록 수정했습니다.
- 기존 **원본 양식 PDF** 기능도 유지됩니다. 단, 페이지를 새로고침해 저장 문서만 복원한 경우 브라우저 보안상 원본 업로드 파일은 복원되지 않으므로 원본 양식 PDF 버튼은 다시 파일을 생성하기 전까지 비활성화됩니다.
- 전체 UI를 화이트 베이스 + 블루/오렌지/그린/옐로 포인트 컬러로 변경했습니다.

## 이번 수정 사항

- 생성된 문서는 기본적으로 **편집 상태**로 열립니다.
- **저장**을 누르면 읽기 전용으로 바뀌고, **편집**을 누르면 다시 수정할 수 있습니다.
- PDF/인쇄는 **`PDF / 인쇄로 내보내기` 버튼 하나로 통합**했습니다. 브라우저 인쇄 창에서 `PDF로 저장`을 선택하거나 실제 프린터를 선택하면 됩니다.
- 이 통합 내보내기는 브라우저 기능을 사용하므로 **Python 설치가 필요하지 않습니다.**
- 인쇄 시 사이드바/입력 패널을 숨기고 문서 영역을 A4 전체 폭 기준으로 다시 배치해 왼쪽으로 쏠리는 현상을 수정했습니다.
- 화면 색상은 화이트 + 블루 중심으로 정리하고, 상태 구분에만 보조색을 최소한으로 사용했습니다.
