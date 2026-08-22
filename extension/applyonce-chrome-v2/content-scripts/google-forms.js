// ApplyOnce - 구글폼 자동 채움 어댑터
// 1단계: 질문을 프로필 필드와 키워드 매칭해서 즉시 채움 (규칙 기반, 무료/빠름)
// 2단계: 매칭 안 되거나 프로필에 값이 없는 서술형(장문형) 질문은
//        서버의 Upstage Solar Chat API 호출로 답변을 생성해서 채움 (AI 기반)

const GENERATE_ANSWERS_API = "http://localhost:3000/api/generate-answers";

const FIELD_KEYWORDS = [
  { key: "name", keywords: ["이름", "성명", "name"] },
  { key: "email", keywords: ["이메일", "email", "e-mail"] },
  { key: "phone", keywords: ["연락처", "전화", "휴대폰", "phone"] },
  { key: "university", keywords: ["대학교", "학교명", "소속 대학"] },
  { key: "major", keywords: ["학과", "전공", "major"] },
  { key: "grade", keywords: ["학년", "재학", "휴학"] },
  { key: "python_experience", keywords: ["python", "파이썬"] },
  { key: "team_project_experience", keywords: ["팀 프로젝트", "협업 경험", "협업"] },
  { key: "awards", keywords: ["수상", "대외활동", "활동 경력"] },
  { key: "portfolio_url", keywords: ["포트폴리오", "portfolio", "깃허브", "github"] },
  { key: "english_score", keywords: ["토익", "toeic", "어학 점수", "영어 점수"] },
];

function normalize(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function matchFieldKey(questionText) {
  const norm = normalize(questionText);
  for (const { key, keywords } of FIELD_KEYWORDS) {
    if (keywords.some((kw) => norm.includes(kw.toLowerCase()))) {
      return key;
    }
  }
  return null;
}

function fieldValueFromProfile(profile, key) {
  const value = profile[key];
  if (Array.isArray(value)) return value.join(", ");
  return value || "";
}

// 웹에서 사용자가 자유롭게 추가한 항목(profile.custom_fields)을
// 질문 텍스트와 라벨 유사도로 매칭한다.
function matchCustomField(profile, questionText, usedCustomIdx) {
  const customFields = Array.isArray(profile.custom_fields) ? profile.custom_fields : [];
  const norm = normalize(questionText);
  for (let i = 0; i < customFields.length; i++) {
    if (usedCustomIdx.has(i)) continue;
    const label = normalize(customFields[i].label);
    if (!label) continue;
    if (norm.includes(label) || label.includes(norm)) {
      return { idx: i, value: customFields[i].value };
    }
  }
  return null;
}

function setNativeValue(element, value) {
  const proto = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function getQuestionText(listItem) {
  const heading = listItem.querySelector('[role="heading"]');
  if (heading && heading.textContent.trim()) return heading.textContent.trim();
  return listItem.textContent.trim().slice(0, 80);
}

async function fillGoogleForm(profile) {
  const listItems = Array.from(document.querySelectorAll('div[role="listitem"]'));
  let filledCount = 0;
  const usedKeys = new Set();
  const usedCustomIdx = new Set();

  // 1단계: 프로필 값(기본 필드 + 커스텀 필드)으로 즉시 채울 수 있는 것부터 채운다.
  const pendingAi = []; // { input, questionText } - 값 없어서 못 채운 것들

  listItems.forEach((item) => {
    const input = item.querySelector('input[type="text"], textarea');
    if (!input) return;

    const questionText = getQuestionText(item);
    const fieldKey = matchFieldKey(questionText);
    const builtinValue = fieldKey ? fieldValueFromProfile(profile, fieldKey) : "";

    if (fieldKey && builtinValue && !usedKeys.has(fieldKey)) {
      setNativeValue(input, builtinValue);
      usedKeys.add(fieldKey);
      filledCount++;
      return;
    }

    // 기본 필드로 못 채웠으면 커스텀 필드(사용자가 웹에서 자유롭게 추가한 항목)에서 매칭 시도
    const customMatch = matchCustomField(profile, questionText, usedCustomIdx);
    if (customMatch && customMatch.value) {
      setNativeValue(input, customMatch.value);
      usedCustomIdx.add(customMatch.idx);
      filledCount++;
      return;
    }

    // 그래도 못 채웠으면 (단답형이든 장문형이든) AI 생성 후보로 등록
    pendingAi.push({ input, questionText });
  });

  // 2단계: 남은 질문들을 서버 AI 엔드포인트로 한 번에 생성 요청
  if (pendingAi.length > 0) {
    try {
      const res = await fetch(GENERATE_ANSWERS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          questions: pendingAi.map((p) => p.questionText),
        }),
      });
      if (res.ok) {
        const { answers } = await res.json();
        pendingAi.forEach((p, i) => {
          if (answers[i]) {
            setNativeValue(p.input, answers[i]);
            filledCount++;
          }
        });
      } else {
        console.warn("[ApplyOnce] AI 답변 생성 실패:", await res.text());
      }
    } catch (err) {
      console.warn("[ApplyOnce] AI 답변 생성 요청 실패:", err.message);
    }
  }

  return filledCount;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "APPLYONCE_FILL") return;
  fillGoogleForm(msg.profile)
    .then((filledCount) => sendResponse({ ok: true, filledCount }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // 비동기 응답을 위해 true 반환 필수
});
