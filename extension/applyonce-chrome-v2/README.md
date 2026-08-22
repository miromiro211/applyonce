# ApplyOnce 확장 프로그램 (구글폼 자동 채움) - 데모 가이드

## 1. 서버 쪽 준비 (프로필 동기화 API)

기존 `applyonce-mockup-v2` 프로젝트의 `server.js`에 프로필 저장/조회 API를 추가해야 합니다.
`app.listen(PORT, ...)` **바로 위**에 아래 코드를 붙여넣으세요:

```js
const PROFILE_PATH = path.join(__dirname, "profile-store.json");

app.post("/api/profile", (req, res) => {
  try {
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(req.body, null, 2), "utf8");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/profile", (req, res) => {
  try {
    if (!fs.existsSync(PROFILE_PATH)) return res.json({});
    const data = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

그리고 `public/index.html`의 "프로필 저장" 버튼 클릭 핸들러 안, `localStorage.setItem(...)` 다음 줄에 이걸 추가하세요:

```js
fetch("/api/profile", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(profile),
}).catch(() => {});
```

`npm start`로 서버를 다시 켜세요.

## 2. 확장 프로그램 설치

1. 크롬 주소창에 `chrome://extensions` 입력
2. 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** 클릭
4. 이 `applyonce-extension` 폴더 선택

## 3. 데모용 구글폼 만들기

[forms.google.com](https://forms.google.com) 에서 새 양식을 만들고, 아래 문항을 그대로 추가하세요 (질문 유형은 **단답형** 또는 **장문형**):

- 이름
- 이메일
- 연락처
- 소속 대학교
- 학과
- 학년 (재학 / 휴학 여부 포함)
- Python 활용 경험을 작성해주세요 (장문형)
- 팀 프로젝트 협업 경험을 작성해주세요 (장문형)
- 지원 동기를 작성해주세요 (장문형)
- 관련 대외활동 / 수상 경력
- 포트폴리오 링크
- TOEIC 등 어학 점수

## 4. 데모 시연 순서

1. `localhost:3000` 웹 앱에서 프로필 입력 → **프로필 저장** (서버에도 같이 저장됨)
2. 만든 구글폼 페이지 열기
3. 확장 프로그램 아이콘 클릭 → **프로필 동기화** → **이 페이지 자동 채우기**
4. 필드가 자동으로 채워지는 것을 확인

## 알려진 한계 (시간 관계상 이번 범위에서 제외)

- **텍스트형 필드만 지원**: 단답형/장문형만 채웁니다. 객관식(라디오), 체크박스, 드롭다운은 아직 미지원입니다.
- **키워드 매칭 방식**: `content-scripts/google-forms.js`의 `FIELD_KEYWORDS` 목록에 있는 단어가 질문 텍스트에 포함되어야 매칭됩니다. 질문 문구가 크게 다르면 못 찾을 수 있습니다.
- **네이버폼 등 다른 사이트는 아직 미지원**: `content-scripts/` 폴더에 사이트별 파일을 추가하고 `manifest.json`의 `content_scripts`/`host_permissions`에 등록하는 구조로 확장 가능하도록 만들어뒀습니다.
- **로그인 없이 로컬 서버 기준으로 동작**: 지금은 `localhost:3000`의 프로필 API를 그대로 사용합니다. 실제 배포 시엔 인증(로그인) 붙이는 작업이 별도로 필요합니다.
