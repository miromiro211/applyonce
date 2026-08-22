const PROFILE_API = "http://localhost:3000/api/profile";

const profileBox = document.getElementById("profileBox");
const statusEl = document.getElementById("status");
const syncBtn = document.getElementById("syncBtn");
const fillBtn = document.getElementById("fillBtn");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function renderProfile(profile) {
  if (!profile || !profile.name) {
    profileBox.innerHTML = `<span class="empty">아직 동기화되지 않았습니다</span>`;
    return;
  }
  profileBox.innerHTML = `
    <div class="name">${profile.name}</div>
    <div>${profile.email || ""}</div>
  `;
}

async function loadCachedProfile() {
  const { applyonce_profile } = await chrome.storage.local.get("applyonce_profile");
  renderProfile(applyonce_profile);
}

async function syncProfile({ silent } = {}) {
  if (!silent) setStatus("동기화 중...");
  try {
    const res = await fetch(PROFILE_API);
    if (!res.ok) throw new Error("서버 응답 오류 (" + res.status + ")");
    const profile = await res.json();
    if (!profile || Object.keys(profile).length === 0) {
      if (!silent) setStatus("저장된 프로필이 없습니다. 웹에서 먼저 저장해주세요.", "error");
      return;
    }
    await chrome.storage.local.set({ applyonce_profile: profile });
    renderProfile(profile);
    if (!silent) setStatus("동기화 완료 ✓", "success");
  } catch (err) {
    if (!silent) {
      setStatus("동기화 실패: " + err.message + " (서버가 localhost:3000에서 실행 중인지 확인하세요)", "error");
    }
    // 자동 동기화(silent) 실패 시엔 캐시된 이전 프로필을 그대로 보여준다.
  }
}

syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  await syncProfile();
  syncBtn.disabled = false;
});

fillBtn.addEventListener("click", async () => {
  setStatus("채우는 중...");
  fillBtn.disabled = true;
  try {
    const { applyonce_profile } = await chrome.storage.local.get("applyonce_profile");
    if (!applyonce_profile || !applyonce_profile.name) {
      setStatus("먼저 프로필을 동기화해주세요.", "error");
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("활성 탭을 찾을 수 없습니다.");

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "APPLYONCE_FILL",
      profile: applyonce_profile,
    });

    if (response?.ok) {
      setStatus(`${response.filledCount}개 필드를 채웠습니다 ✓`, "success");
    } else {
      setStatus(response?.error || "이 페이지는 지원되지 않습니다 (구글폼만 지원)", "error");
    }
  } catch (err) {
    setStatus(
      "실행 실패: 구글폼 페이지를 열고 새로고침한 뒤 다시 시도해주세요.",
      "error"
    );
  } finally {
    fillBtn.disabled = false;
  }
});

loadCachedProfile();
syncProfile({ silent: true }); // 팝업 열릴 때마다 최신 프로필로 조용히 갱신
