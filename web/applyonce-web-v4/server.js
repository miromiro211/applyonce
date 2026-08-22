// ApplyOnce 목업 서버
// 흐름: 프론트에서 공고문 PDF + 지원서 양식 PDF + 유저 프로필(JSON)을 받음
//      -> Upstage Studio 에이전트 API 호출 (파일 업로드 -> 실행 -> 폴링)
//      -> 채워진 필드 JSON을 프론트로 반환
//
// 주의: 이 서버는 Node 18 이상에서 실행해야 합니다 (내장 fetch/FormData/Blob 사용).
// 실행 전: npm install 후 .env에 UPSTAGE_API_KEY / UPSTAGE_AGENT_ID 채워넣기.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const UPSTAGE_BASE_URL = "https://api.upstage.ai/v2";
const API_KEY = process.env.UPSTAGE_API_KEY;
const AGENT_ID = process.env.UPSTAGE_AGENT_ID;
const CONFIG_ID = process.env.UPSTAGE_CONFIG_ID;
const PORT = Number(process.env.PORT || 3000);

if (!API_KEY || !AGENT_ID || !CONFIG_ID) {
  console.warn(
    "[경고] .env에 UPSTAGE_API_KEY / UPSTAGE_AGENT_ID / UPSTAGE_CONFIG_ID 가 설정되지 않았습니다."
  );
}

// Instruct 노드에 넣었던 프롬프트와 동일한 지시문.
// {{user_profile}} 자리에 실제 프로필 JSON을 매 요청마다 동적으로 끼워넣는다.
function buildInstructionText(profileObj) {
  return `당신은 지원서 필드를 자동으로 채우는 에이전트입니다.

아래는 유저 프로필입니다:
${JSON.stringify(profileObj, null, 2)}

@field_labels, @field_types, @required_flags 를 같은 인덱스끼리 짝지어 지원서 필드 목록으로 재구성하세요.
각 필드마다 @eligibility, @required_qualifications, @preferred_qualifications, @required_documents 를 참고해서 다음 셋 중 하나로 분류하세요.

1. "profile": 유저 프로필에서 그대로 가져올 수 있는 값
2. "ai_generated": 프로필 정보 + 공고 요구사항을 조합해 새로 작성 가능한 값 (자기소개서, 경험 서술, 지원 동기 등). 지어내지 말고 프로필에 있는 사실만 근거로 작성
3. "manual_required": 프로필에도 없고 생성도 불가능한 값 (value는 null)

특히 "지원 동기", "지원하게 된 계기" 같은 필드는 프로필의 경험/역량과 공고의 required_qualifications, preferred_qualifications를 조합하면 항상 작성 가능합니다.
이런 필드는 반드시 "ai_generated"로 분류하고 값을 생성하세요. "manual_required"로 분류하지 마세요.

유저 프로필에 해당 필드 정보가 전혀 없고 공고 정보로도 유추할 수 없는 경우에만 "manual_required"로 분류하세요.

절대 마크다운 코드블록을 사용하지 마세요. 백틱 없이 { 로 시작해서 } 로 끝나는 JSON 객체만 출력하세요.

출력은 순수 JSON만:
{
  "filled_fields": [
    {
      "field_id": "field_labels 기반으로 생성한 snake_case id",
      "label": "string",
      "source": "profile | ai_generated | manual_required",
      "value": "string | null",
      "confidence": "high | medium | low"
    }
  ]
}`;
}

// 파일 하나를 Upstage에 업로드하고 file_id를 반환
async function uploadFileToUpstage(buffer, filename, mimetype) {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([buffer], { type: mimetype }), filename);

  const res = await fetch(`${UPSTAGE_BASE_URL}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`파일 업로드 실패 (${filename}): ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.id;
}

// 에이전트 실행 요청 (job 생성)
async function createAgentRun(postingFileId, formFileId, profileObj) {
  const body = {
    model: AGENT_ID,
    config_id: CONFIG_ID,
    input: [
      {
        role: "user",
        content: [
          { type: "input_file", file_id: postingFileId },
          { type: "input_file", file_id: formFileId },
          { type: "input_text", text: buildInstructionText(profileObj) },
        ],
      },
    ],
  };

  const res = await fetch(`${UPSTAGE_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`에이전트 실행 요청 실패: ${res.status} ${text}`);
  }
  const data = await res.json();
  console.log("[디버그] Job 생성 응답:", JSON.stringify(data));
  return data;
}

// job 상태 폴링. job_id 또는 id 필드 둘 다 대응.
async function pollAgentRun(jobId, { intervalMs = 2000, maxAttempts = 30 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${UPSTAGE_BASE_URL}/responses/${jobId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`상태 조회 실패: ${res.status} ${text}`);
    }
    const data = await res.json();
    console.log(`[디버그] 폴링 ${i + 1}회차 status:`, data.status);

    if (data.status === "completed") return data;
    if (data.status === "failed" || data.status === "cancelled") {
      throw new Error(`에이전트 실행 실패: ${JSON.stringify(data)}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("에이전트 실행이 시간 내에 끝나지 않았습니다 (타임아웃)");
}

// 모델 응답 텍스트에서 마크다운 코드블록 제거 후 JSON 파싱
// Upstage 응답이 JSON을 문자열로 한 번 더 감싸서 주는 경우(이중 인코딩)를 대비해
// 파싱 결과가 여전히 문자열이면 한 번 더 파싱한다.
function extractJson(rawText) {
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  let result = JSON.parse(cleaned);
  if (typeof result === "string") {
    result = JSON.parse(result);
  }
  return result;
}

app.post(
  "/api/generate",
  upload.fields([
    { name: "postingFile", maxCount: 1 },
    { name: "formFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const postingFile = req.files?.postingFile?.[0];
      const formFile = req.files?.formFile?.[0];
      const profileRaw = req.body.profile;

      if (!postingFile || !formFile) {
        return res
          .status(400)
          .json({ error: "공고문(postingFile)과 지원서 양식(formFile)을 모두 업로드해주세요." });
      }
      if (!profileRaw) {
        return res.status(400).json({ error: "유저 프로필(profile)이 필요합니다." });
      }

      const profileObj = JSON.parse(profileRaw);

      console.log("[1/4] 공고문 업로드 중...");
      const postingFileId = await uploadFileToUpstage(
        postingFile.buffer,
        postingFile.originalname,
        postingFile.mimetype
      );

      console.log("[2/4] 지원서 양식 업로드 중...");
      const formFileId = await uploadFileToUpstage(
        formFile.buffer,
        formFile.originalname,
        formFile.mimetype
      );

      console.log("[3/4] 에이전트 실행 요청 중...");
      const created = await createAgentRun(postingFileId, formFileId, profileObj);
      const jobId = created.job_id || created.id;

      let result = created;
      if (created.status !== "completed") {
        console.log("[4/4] 결과 대기 중 (폴링)...");
        result = await pollAgentRun(jobId);
      }

      // Studio 응답 구조: output 배열의 마지막 스텝 content에 최종 텍스트가 들어있음
      const rawText =
        result.output_text ||
        result.output?.[result.output.length - 1]?.content?.[0]?.text ||
        "";

      console.log("[디버그] 원문 응답:", rawText);

      const parsed = extractJson(rawText);
      return res.json(parsed);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
  }
);

const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
const PDF_FILL_DIR = path.join(__dirname, "pdf_fill");

function runPython(scriptName, args) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PDF_FILL_DIR, scriptName);
    const proc = spawn(PYTHON_BIN, [scriptPath, ...args]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      console.log(`[${scriptName}]`, stdout.trim());
      if (code !== 0) {
        return reject(new Error(`${scriptName} 실패 (exit ${code}): ${stderr || stdout}`));
      }
      resolve(stdout);
    });
    proc.on("error", (err) => {
      reject(new Error(`${scriptName} 실행 불가: ${err.message} (${PYTHON_BIN} 설치/PATH 확인 필요)`));
    });
  });
}

// 원본 지원서 양식 PDF에 filled_fields 값을 실제 위치에 그대로 채워서 내려줌.
app.post(
  "/api/export-pdf",
  upload.fields([{ name: "formFile", maxCount: 1 }]),
  async (req, res) => {
    const formFile = req.files?.formFile?.[0];
    const filledFieldsRaw = req.body.filledFields;

    if (!formFile || !filledFieldsRaw) {
      return res.status(400).json({ error: "formFile과 filledFields가 모두 필요합니다." });
    }

    const workDir = path.join(os.tmpdir(), "applyonce-" + crypto.randomUUID());
    fs.mkdirSync(workDir, { recursive: true });

    const formPath = path.join(workDir, "form.pdf");
    const structurePath = path.join(workDir, "structure.json");
    const filledFieldsPath = path.join(workDir, "filled_fields.json");
    const fieldsPath = path.join(workDir, "fields.json");
    const outputPath = path.join(workDir, "output.pdf");

    try {
      fs.writeFileSync(formPath, formFile.buffer);
      fs.writeFileSync(filledFieldsPath, filledFieldsRaw);

      console.log("[1/3] 지원서 양식 구조 분석 중...");
      await runPython("extract_form_structure.py", [formPath, structurePath]);

      console.log("[2/3] 라벨-값 매칭 중...");
      await runPython("match_and_build_fields.py", [formPath, structurePath, filledFieldsPath, fieldsPath]);

      console.log("[3/3] PDF에 채워 넣는 중...");
      await runPython("fill_pdf_korean.py", [formPath, fieldsPath, outputPath]);

      res.download(outputPath, "지원서_작성본.pdf", (err) => {
        fs.rm(workDir, { recursive: true, force: true }, () => {});
        if (err) console.error("다운로드 전송 오류:", err);
      });
    } catch (err) {
      console.error(err);
      fs.rm(workDir, { recursive: true, force: true }, () => {});
      res.status(500).json({ error: err.message });
    }
  }
);


// 저장된 미리보기 문서를 깔끔한 A4 PDF로 생성.
app.post("/api/export-preview-pdf", async (req, res) => {
  const payload = req.body || {};
  if (!Array.isArray(payload.filled_fields)) {
    return res.status(400).json({ error: "filled_fields 배열이 필요합니다." });
  }

  const workDir = path.join(os.tmpdir(), "applyonce-preview-" + crypto.randomUUID());
  fs.mkdirSync(workDir, { recursive: true });
  const dataPath = path.join(workDir, "preview.json");
  const outputPath = path.join(workDir, "preview.pdf");

  try {
    fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2), "utf8");
    await runPython("generate_preview_pdf.py", [dataPath, outputPath]);
    res.download(outputPath, "지원서_미리보기.pdf", (err) => {
      fs.rm(workDir, { recursive: true, force: true }, () => {});
      if (err) console.error("미리보기 PDF 전송 오류:", err);
    });
  } catch (err) {
    console.error(err);
    fs.rm(workDir, { recursive: true, force: true }, () => {});
    res.status(500).json({ error: err.message });
  }
});

// ---- 확장 프로그램용 프로필 동기화 API ----
// 웹에서 저장한 프로필을 확장 프로그램이 가져갈 수 있도록 파일로도 보관.
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

// ---- 확장 프로그램용: 프로필에 없는 서술형 질문을 AI로 생성 ----
// (구글폼에서 프로필로 매칭 안 되는 질문 - 지원 동기 등 - 을 Solar Chat으로 생성)
app.post("/api/generate-answers", async (req, res) => {
  try {
    const { profile, questions } = req.body || {};
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "questions 배열이 필요합니다." });
    }

    const prompt = `당신은 지원서 질문에 지원자 프로필을 바탕으로 답변을 작성하는 도우미입니다.

지원자 프로필:
${JSON.stringify(profile || {}, null, 2)}

아래 질문 목록에 대해, 프로필에 있는 사실만 근거로 자연스러운 한국어 답변을 작성하세요.

중요한 규칙:
- 프로필의 경험/스킬을 조합해 답할 수 있는 질문(지원 동기, 경험 서술 등)은 2~4문장으로 답변하세요.
- MBTI, 혈액형, 생년월일, 특정 시험 점수 등 프로필에 전혀 근거가 없는 고유 사실을 묻는 질문은
  답변을 지어내거나 "알 수 없습니다" 같은 설명을 쓰지 말고, 정확히 문자열 "SKIP" 하나만 그 자리에 넣으세요.
- 판단이 애매하면 지어내는 것보다 "SKIP"을 선택하세요.

질문 목록:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

절대 마크다운 코드블록을 사용하지 말고, 아래 형식의 순수 JSON 배열만 출력하세요.
질문 순서와 answers 배열의 순서가 반드시 일치해야 합니다.

["첫 번째 질문에 대한 답변 또는 SKIP", "두 번째 질문에 대한 답변 또는 SKIP", ...]`;

    const upstageRes = await fetch("https://api.upstage.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "solar-pro2",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!upstageRes.ok) {
      const text = await upstageRes.text();
      throw new Error(`Solar Chat 호출 실패: ${upstageRes.status} ${text}`);
    }

    const data = await upstageRes.json();
    const rawText = data.choices?.[0]?.message?.content || "";
    console.log("[디버그] generate-answers 원문 응답:", rawText);

    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const answers = JSON.parse(cleaned);

    if (!Array.isArray(answers)) throw new Error("모델 응답이 배열 형식이 아닙니다.");

    res.json({ answers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ApplyOnce 목업 서버 실행 중: http://localhost:${PORT}`);
});
