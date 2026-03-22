let currentSentenceId = null;
let selectedDifficulty = "basic";
let recognition = null;
let isRecording = false;

// ─── 초기 로드 ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    loadTodaySentences();
    loadHistory();
    initSpeechRecognition();
});

// ─── 난이도 선택 ─────────────────────────────────────────────────

function selectDifficulty(btn) {
    document.querySelectorAll(".difficulty-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedDifficulty = btn.dataset.level;
}

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
            body: JSON.stringify({ topic, difficulty: selectedDifficulty }),
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
            <div class="sentence-card-header">
                <span class="number">${i + 1}</span>
                <span class="difficulty-badge ${s.difficulty || 'basic'}">${s.difficulty || 'basic'}</span>
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

    const chatArea = document.getElementById("chatArea");
    chatArea.innerHTML = '<div class="loading">대화 기록 불러오는 중<span class="loading-dots"></span></div>';

    try {
        const res = await fetch(`/api/chat/history/${sentenceId}`);
        const history = await res.json();

        if (history.length === 0) {
            chatArea.innerHTML = `
                <div class="chat-msg assistant">
                    안녕하세요! 이 문장에 대해 함께 연습해볼까요?
                    영어로 이 문장을 사용해서 대화해보세요!
                    <button class="tts-btn" onclick="speakText(this, this.closest('.chat-msg').childNodes[0].textContent)">
                        🔊 듣기
                    </button>
                </div>`;
        } else {
            chatArea.innerHTML = history.map(h =>
                formatChatMessage(h.role, h.content)
            ).join("");
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
    stopRecording();
    loadTodaySentences();
}

// ─── 메시지 포맷팅 (코멘트 분리) ─────────────────────────────────

function formatChatMessage(role, content) {
    if (role === "user") {
        return `<div class="chat-msg user">${escapeHtml(content)}</div>`;
    }

    // assistant 메시지: --- 구분선으로 대화/코멘트 분리
    const parts = content.split(/\n---\n/);
    const conversation = parts[0].trim();
    const comment = parts.length > 1 ? parts.slice(1).join("\n").trim() : null;

    let html = `<div class="chat-msg assistant">`;
    html += `<div>${formatMarkdown(conversation)}</div>`;

    if (comment) {
        html += `<div class="comment-section">${formatMarkdown(comment)}</div>`;
    }

    // TTS 버튼 (대화 부분만 읽기)
    const ttsText = conversation.replace(/\*\*.*?\*\*/g, '').replace(/[#*_`]/g, '');
    html += `<button class="tts-btn" onclick="speakText(this, ${JSON.stringify(ttsText)})">🔊 듣기</button>`;
    html += `</div>`;

    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMarkdown(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

// ─── 메시지 전송 ─────────────────────────────────────────────────

async function sendMessage() {
    const input = document.getElementById("chatInput");
    const message = input.value.trim();
    if (!message || !currentSentenceId) return;

    const chatArea = document.getElementById("chatArea");

    chatArea.innerHTML += `<div class="chat-msg user">${escapeHtml(message)}</div>`;
    input.value = "";
    chatArea.scrollTop = chatArea.scrollHeight;

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

        const loadingMsg = chatArea.querySelector(".loading-msg");
        if (loadingMsg) loadingMsg.remove();

        chatArea.innerHTML += formatChatMessage("assistant", data.reply);
        chatArea.scrollTop = chatArea.scrollHeight;
    } catch (err) {
        const loadingMsg = chatArea.querySelector(".loading-msg");
        if (loadingMsg) loadingMsg.remove();
        chatArea.innerHTML += '<div class="chat-msg assistant">죄송합니다. 오류가 발생했습니다.</div>';
    }
}

// ─── 학습 평가 ───────────────────────────────────────────────────

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

// ─── 음성 인식 (STT) ─────────────────────────────────────────────

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.log("Speech Recognition not supported");
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
        const input = document.getElementById("chatInput");
        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        input.value = finalTranscript || interimTranscript;
    };

    recognition.onend = () => {
        isRecording = false;
        document.getElementById("micBtn").classList.remove("recording");
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        isRecording = false;
        document.getElementById("micBtn").classList.remove("recording");
    };
}

function toggleVoice() {
    if (!recognition) {
        alert("이 브라우저는 음성 인식을 지원하지 않습니다. Chrome을 사용해주세요.");
        return;
    }

    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    if (!recognition) return;
    isRecording = true;
    document.getElementById("micBtn").classList.add("recording");
    document.getElementById("chatInput").placeholder = "말씀하세요...";
    recognition.start();
}

function stopRecording() {
    if (!recognition || !isRecording) return;
    isRecording = false;
    document.getElementById("micBtn").classList.remove("recording");
    document.getElementById("chatInput").placeholder = "영어로 대화해보세요...";
    recognition.stop();
}

// ─── 음성 합성 (TTS) ─────────────────────────────────────────────

function speakText(btn, text) {
    if (!window.speechSynthesis) {
        alert("이 브라우저는 음성 합성을 지원하지 않습니다.");
        return;
    }

    // 이미 재생 중이면 중지
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
        document.querySelectorAll(".tts-btn.playing").forEach(b => b.classList.remove("playing"));
        return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.9;

    btn.classList.add("playing");
    utterance.onend = () => btn.classList.remove("playing");
    utterance.onerror = () => btn.classList.remove("playing");

    speechSynthesis.speak(utterance);
}

// ─── 키보드 이벤트 ───────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && document.getElementById("chatModal").classList.contains("active")) {
        e.preventDefault();
        sendMessage();
    }
});

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
