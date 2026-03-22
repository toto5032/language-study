let currentSentenceId = null;

// ─── 초기 로드 ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    loadTodaySentences();
    loadHistory();
});

// ─── 문장 생성 ───────────────────────────────────────────────────

async function generateSentences() {
    const topic = document.getElementById("topicInput").value.trim();
    const btn = document.getElementById("generateBtn");
    btn.disabled = true;
    btn.textContent = "생성 중...";

    try {
        const res = await fetch("/api/sentences/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic }),
        });
        const data = await res.json();
        renderSentences(data.sentences);
        updateProgress(data.sentences);
    } catch (err) {
        alert("문장 생성에 실패했습니다. 다시 시도해주세요.");
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.textContent = "오늘의 문장 받기";
    }
}

// ─── 오늘의 문장 로드 ────────────────────────────────────────────

async function loadTodaySentences() {
    try {
        const res = await fetch("/api/sentences");
        const sentences = await res.json();
        if (sentences.length > 0) {
            renderSentences(sentences);
            updateProgress(sentences);
        }
    } catch (err) {
        console.error(err);
    }
}

// ─── 문장 렌더링 ─────────────────────────────────────────────────

function renderSentences(sentences) {
    const list = document.getElementById("sentenceList");
    if (sentences.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <p>아직 오늘의 문장이 없습니다</p>
                <p>위에서 주제를 입력하고 문장을 받아보세요!</p>
            </div>`;
        return;
    }

    list.innerHTML = sentences.map((s, i) => `
        <div class="sentence-card ${s.completed ? 'completed' : ''}" onclick="openChat(${s.id})">
            <div>
                <span class="number">${i + 1}</span>
                <span class="sentence-status ${s.completed ? 'status-completed' : 'status-pending'}">
                    ${s.completed ? '학습 완료' : '학습 중'}
                </span>
            </div>
            <div class="sentence-english">${s.english}</div>
            <div class="sentence-korean">${s.korean}</div>
            <div class="sentence-situation">${s.situation}</div>
        </div>
    `).join("");
}

// ─── 진행률 업데이트 ─────────────────────────────────────────────

function updateProgress(sentences) {
    const section = document.getElementById("progressSection");
    const total = sentences.length;
    const completed = sentences.filter(s => s.completed).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    section.style.display = total > 0 ? "block" : "none";
    section.innerHTML = `
        <div class="progress-text">
            <span>오늘의 학습 진행률</span>
            <span>${completed}/${total} 완료</span>
        </div>
        <div class="progress-bar-container">
            <div class="progress-bar" style="width: ${pct}%"></div>
        </div>`;
}

// ─── 채팅 모달 ───────────────────────────────────────────────────

async function openChat(sentenceId) {
    currentSentenceId = sentenceId;
    const overlay = document.getElementById("chatModal");
    overlay.classList.add("active");

    // 대화 기록 로드
    const chatArea = document.getElementById("chatArea");
    chatArea.innerHTML = '<div class="loading">대화 기록 불러오는 중<span class="loading-dots"></span></div>';

    try {
        const res = await fetch(`/api/chat/history/${sentenceId}`);
        const history = await res.json();

        if (history.length === 0) {
            chatArea.innerHTML = `
                <div class="chat-msg assistant">
                    안녕하세요! 이 문장에 대해 함께 연습해볼까요? 😊<br>
                    영어로 이 문장을 사용해서 대화해보세요!
                </div>`;
        } else {
            chatArea.innerHTML = history.map(h => `
                <div class="chat-msg ${h.role}">${h.content}</div>
            `).join("");
        }
        chatArea.scrollTop = chatArea.scrollHeight;
    } catch (err) {
        chatArea.innerHTML = '<div class="loading">대화 기록을 불러올 수 없습니다.</div>';
    }

    document.getElementById("chatInput").focus();
}

function closeChat() {
    document.getElementById("chatModal").classList.remove("active");
    currentSentenceId = null;
    // 문장 목록 새로고침
    loadTodaySentences();
}

async function sendMessage() {
    const input = document.getElementById("chatInput");
    const message = input.value.trim();
    if (!message || !currentSentenceId) return;

    const chatArea = document.getElementById("chatArea");

    // 사용자 메시지 표시
    chatArea.innerHTML += `<div class="chat-msg user">${message}</div>`;
    input.value = "";
    chatArea.scrollTop = chatArea.scrollHeight;

    // 로딩 표시
    chatArea.innerHTML += '<div class="chat-msg assistant loading-msg">입력 중<span class="loading-dots"></span></div>';
    chatArea.scrollTop = chatArea.scrollHeight;

    try {
        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sentence_id: currentSentenceId,
                message: message,
            }),
        });
        const data = await res.json();

        // 로딩 메시지 제거 후 응답 표시
        const loadingMsg = chatArea.querySelector(".loading-msg");
        if (loadingMsg) loadingMsg.remove();

        chatArea.innerHTML += `<div class="chat-msg assistant">${data.reply}</div>`;
        chatArea.scrollTop = chatArea.scrollHeight;
    } catch (err) {
        const loadingMsg = chatArea.querySelector(".loading-msg");
        if (loadingMsg) loadingMsg.remove();
        chatArea.innerHTML += '<div class="chat-msg assistant">죄송합니다. 오류가 발생했습니다.</div>';
    }
}

async function evaluateAndComplete() {
    if (!currentSentenceId) return;

    const chatArea = document.getElementById("chatArea");
    chatArea.innerHTML += '<div class="loading">학습 평가 중<span class="loading-dots"></span></div>';
    chatArea.scrollTop = chatArea.scrollHeight;

    try {
        const res = await fetch(`/api/evaluate/${currentSentenceId}`, {
            method: "POST",
        });
        const data = await res.json();

        // 로딩 제거
        const loading = chatArea.querySelector(".loading:last-child");
        if (loading) loading.remove();

        chatArea.innerHTML += `
            <div class="eval-result">
                <div class="eval-score">${data.score}점</div>
                <div class="eval-feedback">${data.feedback}</div>
                ${data.score >= 60
                    ? '<div style="color:#48bb78;font-weight:600;margin-top:8px;">학습 완료!</div>'
                    : '<div style="color:#ed8936;font-weight:600;margin-top:8px;">조금 더 연습해보세요!</div>'}
            </div>`;
        chatArea.scrollTop = chatArea.scrollHeight;
    } catch (err) {
        alert("평가에 실패했습니다.");
    }
}

// Enter 키로 전송
document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && document.getElementById("chatModal").classList.contains("active")) {
        e.preventDefault();
        sendMessage();
    }
});

// 모달 외부 클릭으로 닫기
document.getElementById("chatModal")?.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-overlay")) {
        closeChat();
    }
});

// ─── 학습 히스토리 ───────────────────────────────────────────────

async function loadHistory() {
    try {
        const res = await fetch("/api/history");
        const history = await res.json();
        const section = document.getElementById("historySection");

        if (history.length === 0) {
            section.innerHTML = "";
            return;
        }

        section.innerHTML = `
            <h2>학습 기록</h2>
            ${history.map(h => `
                <div class="history-row">
                    <span class="history-date">${h.date}</span>
                    <span class="history-progress">${h.completed}/${h.total} 완료</span>
                </div>
            `).join("")}`;
    } catch (err) {
        console.error(err);
    }
}
