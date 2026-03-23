let currentSentenceId = null;
let selectedDifficulty = "basic";
let recognition = null;
let isRecording = false;

// ─── 초기 로드 ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    loadTodaySentences();
    loadHistory();
    initSpeechRecognition();
    initTTSVoices();
    initModalDrag();
    refreshTopicSuggestions();
});

// ─── 추천 주제 ───────────────────────────────────────────────────

const TOPIC_SUGGESTIONS = [
    // 일상생활
    "카페에서 주문하기", "식당에서 주문하기", "패스트푸드 주문하기",
    "마트에서 장보기", "편의점에서 쇼핑", "옷 가게에서 쇼핑",
    // 교통
    "택시 타기", "버스 이용하기", "지하철 노선 물어보기",
    "길 묻기/안내하기", "주유소에서", "렌터카 빌리기",
    // 숙박/여행
    "호텔 체크인/체크아웃", "에어비앤비 호스트와 대화", "관광지에서",
    "공항에서 탑승 수속", "면세점에서 쇼핑", "환전하기",
    // 사교
    "처음 만난 사람과 인사", "파티에서 스몰톡", "이웃과 인사",
    "친구와 약속 잡기", "SNS 대화", "감사/사과 표현",
    // 직장
    "직장 동료와 대화", "회의에서 의견 말하기", "이메일 작성",
    "전화 통화", "면접 준비", "프레젠테이션",
    // 건강/서비스
    "병원 예약하기", "약국에서", "증상 설명하기",
    "은행 업무 보기", "우체국에서", "미용실에서",
    // 긴급/실용
    "분실물 신고", "불만 사항 말하기", "도움 요청하기",
    "날씨 대화", "취미 이야기", "음식 추천 받기",
    // 가정/생활
    "집 구하기", "수리 요청하기", "배달 음식 주문",
    "반려동물 이야기", "운동/헬스장에서", "도서관에서"
];

function refreshTopicSuggestions() {
    const container = document.getElementById("topicChips");
    // 랜덤으로 5개 선택
    const shuffled = [...TOPIC_SUGGESTIONS].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 5);

    container.innerHTML = selected.map(topic =>
        `<span class="topic-chip" onclick="selectTopic(this)">${topic}</span>`
    ).join("");
}

function selectTopic(chip) {
    document.getElementById("topicInput").value = chip.textContent;
    // 선택된 칩 강조
    document.querySelectorAll(".topic-chip").forEach(c => c.style.background = "");
    chip.style.background = "#667eea";
    chip.style.color = "white";
    chip.style.borderColor = "#667eea";
}

// ─── TTS 음성 초기화 ─────────────────────────────────────────────

let ttsVoice = null;

function initTTSVoices() {
    if (!window.speechSynthesis) return;

    function setVoice() {
        const voices = speechSynthesis.getVoices();
        // 영어 음성 우선 선택
        ttsVoice = voices.find(v => v.lang === "en-US" && v.name.includes("Google"))
            || voices.find(v => v.lang === "en-US")
            || voices.find(v => v.lang.startsWith("en"))
            || null;
    }

    setVoice();
    // Chrome에서는 비동기로 로드됨
    speechSynthesis.onvoiceschanged = setVoice;
}

// ─── 난이도 선택 ─────────────────────────────────────────────────

function selectDifficulty(btn) {
    document.querySelectorAll(".difficulty-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedDifficulty = btn.dataset.level;
    // 난이도 변경 시 해당 난이도의 기존 문장 로드
    loadTodaySentences();
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
        showResetButton(data.sentences.length > 0);
    } catch (err) {
        alert("문장 생성에 실패했습니다. 다시 시도해주세요.");
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.textContent = "오늘의 문장 받기";
    }
}

// ─── 문장 리셋 ───────────────────────────────────────────────────

async function resetSentences() {
    if (!confirm(`${selectedDifficulty.toUpperCase()} 난이도의 오늘 문장을 초기화하시겠습니까?\n대화 기록도 함께 삭제됩니다.`)) {
        return;
    }

    try {
        const res = await fetch("/api/sentences/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ difficulty: selectedDifficulty }),
        });
        const data = await res.json();

        // 초기화 후 빈 화면 표시
        renderSentences([]);
        updateProgress([]);
        showResetButton(false);
        loadHistory();
    } catch (err) {
        alert("초기화에 실패했습니다.");
        console.error(err);
    }
}

function showResetButton(show) {
    document.getElementById("resetSection").style.display = show ? "block" : "none";
}

// ─── 오늘의 문장 로드 ────────────────────────────────────────────

async function loadTodaySentences() {
    try {
        const res = await fetch(`/api/sentences?difficulty=${selectedDifficulty}`);
        const sentences = await res.json();
        if (sentences.length > 0) {
            renderSentences(sentences);
            updateProgress(sentences);
            showResetButton(true);
        } else {
            renderSentences([]);
            updateProgress([]);
            showResetButton(false);
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
                    ${s.completed ? '✅ 학습 완료' : '📖 학습 중'}
                </span>
            </div>
            <div class="sentence-english">
                ${escapeHtml(s.english)}
                <button class="tts-btn-inline" data-tts="${escapeHtml(s.english)}" onclick="event.stopPropagation(); speakText(this, this.dataset.tts)">🔊</button>
            </div>
            <div class="sentence-korean">${escapeHtml(s.korean)}</div>
            <div class="sentence-situation">${escapeHtml(s.situation)}</div>
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
    resetModalPosition();
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
                    <div>안녕하세요! 이 문장에 대해 함께 연습해볼까요?<br>영어로 이 문장을 사용해서 대화해보세요!</div>
                    <button class="tts-btn" onclick="speakText(this, 'Hello! Shall we practice this sentence together? Try using this sentence in English!')">🔊 듣기</button>
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
    // TTS 재생 중이면 중지
    if (window.speechSynthesis && speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
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

    // TTS용 텍스트: 영어 부분만 추출 (마크다운 제거)
    const ttsText = conversation.replace(/\*\*.*?\*\*/g, '').replace(/[#*_`]/g, '').trim();

    let html = `<div class="chat-msg assistant">`;
    html += `<div>${formatMarkdown(conversation)}</div>`;

    if (comment) {
        html += `<div class="comment-section">${formatMarkdown(comment)}</div>`;
    }

    html += `<button class="tts-btn" data-tts="${escapeAttr(ttsText)}" onclick="speakText(this, this.dataset.tts)">🔊 듣기</button>`;
    html += `</div>`;

    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// ─── 음성 인식 (STT - Google Cloud Speech) ───────────────────────

let mediaRecorder = null;
let audioChunks = [];

function initSpeechRecognition() {
    // MediaRecorder 지원 확인
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.log("MediaDevices not supported");
    }
}

function toggleVoice() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 48000,
                echoCancellation: true,
                noiseSuppression: true,
            }
        });

        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm;codecs=opus'
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            // 마이크 스트림 종료
            stream.getTracks().forEach(track => track.stop());

            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            if (audioBlob.size === 0) {
                console.warn("빈 오디오");
                return;
            }

            // 서버로 전송하여 Google Cloud STT 처리
            const input = document.getElementById("chatInput");
            input.placeholder = "음성 인식 중...";

            const formData = new FormData();
            formData.append("audio", audioBlob, "recording.webm");

            try {
                const res = await fetch("/api/stt", {
                    method: "POST",
                    body: formData,
                });
                const data = await res.json();

                if (data.text) {
                    input.value = data.text;
                    console.log(`STT 결과: "${data.text}" (신뢰도: ${data.confidence})`);
                } else if (data.error) {
                    console.error("STT 오류:", data.error);
                    input.placeholder = "인식 실패. 다시 시도하세요.";
                    setTimeout(() => {
                        input.placeholder = "영어로 대화해보세요...";
                    }, 2000);
                } else {
                    input.placeholder = "음성을 인식하지 못했습니다.";
                    setTimeout(() => {
                        input.placeholder = "영어로 대화해보세요...";
                    }, 2000);
                }
            } catch (err) {
                console.error("STT 요청 실패:", err);
                input.placeholder = "음성 인식 서버 오류";
                setTimeout(() => {
                    input.placeholder = "영어로 대화해보세요...";
                }, 2000);
            }

            input.placeholder = "영어로 대화해보세요...";
        };

        mediaRecorder.start();
        isRecording = true;
        document.getElementById("micBtn").classList.add("recording");
        document.getElementById("chatInput").placeholder = "말씀하세요... (다시 누르면 인식)";
        console.log("녹음 시작");

    } catch (err) {
        console.error("마이크 접근 실패:", err);
        alert("마이크 접근이 거부되었습니다. 브라우저 설정에서 마이크를 허용해주세요.");
    }
}

function stopRecording() {
    if (!mediaRecorder || !isRecording) return;
    isRecording = false;
    document.getElementById("micBtn").classList.remove("recording");
    mediaRecorder.stop();
    console.log("녹음 중지 → 서버 전송");
}

// ─── 음성 합성 (TTS - AudioContext 기반) ─────────────────────────

let audioCtx = null;
let currentSource = null;
let ttsLoading = false;
let currentTtsBtn = null;

function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // 사용자 제스처로 AudioContext 잠금 해제
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function stopCurrentAudio() {
    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource = null;
    }
    if (currentTtsBtn) {
        currentTtsBtn.classList.remove("playing");
        currentTtsBtn = null;
    }
    document.querySelectorAll(".tts-btn.playing, .tts-btn-inline.playing").forEach(b => {
        b.classList.remove("playing");
    });
}

async function speakText(btn, text) {
    // AudioContext 잠금 해제 (사용자 클릭 컨텍스트에서 즉시 실행)
    const ctx = getAudioContext();

    // 로딩 중이면 무시
    if (ttsLoading) return;

    // 이미 재생 중이면 중지하고 끝
    if (currentSource) {
        stopCurrentAudio();
        return;
    }

    // 텍스트 정리: HTML 태그, 마크다운, 이모지 제거
    const cleanText = text
        .replace(/<[^>]*>/g, '')
        .replace(/[\u{1F600}-\u{1F9FF}]/gu, '')
        .replace(/[#*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleanText) {
        console.warn("TTS: 읽을 텍스트가 없습니다.");
        return;
    }

    console.log("TTS 요청:", cleanText.substring(0, 60));
    btn.classList.add("playing");
    currentTtsBtn = btn;
    ttsLoading = true;

    // 음성/속도 설정 가져오기
    const voiceSelect = document.getElementById("ttsVoiceSelect");
    const speedSelect = document.getElementById("ttsSpeedSelect");
    const voice = voiceSelect ? voiceSelect.value : "female";
    const rate = speedSelect ? speedSelect.value : "-5%";

    try {
        const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: cleanText, rate, voice }),
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `서버 오류 (${res.status})`);
        }

        const arrayBuffer = await res.arrayBuffer();
        if (arrayBuffer.byteLength === 0) {
            throw new Error("빈 오디오 응답");
        }

        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        source.onended = () => {
            btn.classList.remove("playing");
            currentSource = null;
            currentTtsBtn = null;
        };

        currentSource = source;
        ttsLoading = false;
        source.start(0);
        console.log("TTS 재생 시작");
    } catch (err) {
        console.error("TTS 오류:", err);
        btn.classList.remove("playing");
        ttsLoading = false;
        currentSource = null;
        currentTtsBtn = null;
        // 서버 TTS 실패 시 브라우저 TTS 폴백
        speakTextFallback(btn, cleanText);
    }
}

// 브라우저 내장 TTS 폴백
function speakTextFallback(btn, text) {
    if (!window.speechSynthesis) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.85;

    if (ttsVoice) utterance.voice = ttsVoice;

    btn.classList.add("playing");
    utterance.onend = () => btn.classList.remove("playing");
    utterance.onerror = () => btn.classList.remove("playing");
    speechSynthesis.speak(utterance);
}

// ─── 모달 드래그 이동 ────────────────────────────────────────────

function initModalDrag() {
    const handle = document.getElementById("modalDragHandle");
    const modal = document.getElementById("chatModalBox");
    if (!handle || !modal) return;

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    handle.addEventListener("mousedown", (e) => {
        // 닫기 버튼이나 다른 버튼 클릭 시 드래그 안 함
        if (e.target.closest("button")) return;

        isDragging = true;
        modal.classList.add("dragging");

        // 현재 모달 위치 계산
        const rect = modal.getBoundingClientRect();
        // position을 absolute로 전환
        modal.style.position = "absolute";
        modal.style.left = rect.left + "px";
        modal.style.top = rect.top + "px";
        modal.style.margin = "0";

        startX = e.clientX;
        startY = e.clientY;
        initialLeft = rect.left;
        initialTop = rect.top;

        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        // 화면 밖으로 나가지 않게 제한
        const maxLeft = window.innerWidth - modal.offsetWidth;
        const maxTop = window.innerHeight - modal.offsetHeight;
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));

        modal.style.left = newLeft + "px";
        modal.style.top = newTop + "px";
    });

    document.addEventListener("mouseup", () => {
        if (!isDragging) return;
        isDragging = false;
        modal.classList.remove("dragging");
    });

    // 터치 지원 (모바일)
    handle.addEventListener("touchstart", (e) => {
        if (e.target.closest("button")) return;

        isDragging = true;
        modal.classList.add("dragging");

        const rect = modal.getBoundingClientRect();
        modal.style.position = "absolute";
        modal.style.left = rect.left + "px";
        modal.style.top = rect.top + "px";
        modal.style.margin = "0";

        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        initialLeft = rect.left;
        initialTop = rect.top;
    }, { passive: true });

    document.addEventListener("touchmove", (e) => {
        if (!isDragging) return;

        const touch = e.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        const maxLeft = window.innerWidth - modal.offsetWidth;
        const maxTop = window.innerHeight - modal.offsetHeight;
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));

        modal.style.left = newLeft + "px";
        modal.style.top = newTop + "px";
    }, { passive: true });

    document.addEventListener("touchend", () => {
        if (!isDragging) return;
        isDragging = false;
        modal.classList.remove("dragging");
    });
}

// 모달 위치 초기화 (열 때마다 중앙으로)
function resetModalPosition() {
    const modal = document.getElementById("chatModalBox");
    if (!modal) return;
    modal.style.position = "";
    modal.style.left = "";
    modal.style.top = "";
    modal.style.margin = "";
}

// ─── 키보드 이벤트 ───────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && document.getElementById("chatModal").classList.contains("active")) {
        e.preventDefault();
        sendMessage();
    }
});

document.getElementById("chatModal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
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
