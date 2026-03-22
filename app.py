import os
import json
import sqlite3
from datetime import date, datetime
from flask import Flask, render_template, request, jsonify, g
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-secret-key")

DATABASE = "learning.db"
client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

DIFFICULTY_LABELS = {
    "basic": "Basic (초급)",
    "intermediate": "Intermediate (중급)",
    "advanced": "Advanced (고급)",
}

DIFFICULTY_PROMPTS = {
    "basic": """- 아주 짧고 간단한 문장 (3~6단어)
- 기초 어휘만 사용
- 단순 현재/과거 시제
- 예: "Can I get a coffee?", "Where is the restroom?" """,
    "intermediate": """- 자연스러운 일상 문장 (5~10단어)
- 다양한 시제와 구문 사용
- 관용적 표현 포함 가능
- 예: "I was wondering if you could help me with this.", "Do you mind if I sit here?" """,
    "advanced": """- 원어민이 자주 쓰는 자연스러운 표현 (7~15단어)
- 숙어, 구동사, 복합 구문 포함
- 뉘앙스와 톤이 중요한 표현
- 예: "I hate to be a bother, but would you mind keeping it down?", "I'll take a rain check on that." """,
}


# ─── Database ───────────────────────────────────────────────────────

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("""
        CREATE TABLE IF NOT EXISTS sentences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            english TEXT NOT NULL,
            korean TEXT NOT NULL,
            situation TEXT NOT NULL,
            difficulty TEXT DEFAULT 'basic',
            completed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sentence_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sentence_id) REFERENCES sentences(id)
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS evaluations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sentence_id INTEGER NOT NULL,
            score INTEGER NOT NULL,
            feedback TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sentence_id) REFERENCES sentences(id)
        )
    """)
    # 기존 테이블에 difficulty 컬럼이 없으면 추가
    try:
        db.execute("ALTER TABLE sentences ADD COLUMN difficulty TEXT DEFAULT 'basic'")
    except sqlite3.OperationalError:
        pass
    db.commit()
    db.close()


# ─── AI Helpers ─────────────────────────────────────────────────────

def get_learned_sentences():
    """기존에 학습 완료한 문장 목록 반환"""
    db = get_db()
    rows = db.execute(
        "SELECT english FROM sentences WHERE completed = 1"
    ).fetchall()
    return [r["english"] for r in rows]


def generate_daily_sentences(topic=None, difficulty="basic"):
    """오늘의 영어 문장 5개 생성"""
    learned = get_learned_sentences()
    learned_text = "\n".join(f"- {s}" for s in learned) if learned else "없음"

    topic_instruction = ""
    if topic:
        topic_instruction = f"\n주제/상황: {topic}"

    difficulty_instruction = DIFFICULTY_PROMPTS.get(difficulty, DIFFICULTY_PROMPTS["basic"])
    difficulty_label = DIFFICULTY_LABELS.get(difficulty, "Basic (초급)")

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        messages=[{
            "role": "user",
            "content": f"""당신은 영어 회화 튜터입니다. 영어권에서 생활하는 사람들이 매일 사용하는 실용적인 영어 문장 5개를 제안해주세요.
{topic_instruction}

난이도: {difficulty_label}
난이도 기준:
{difficulty_instruction}

규칙:
1. 위 난이도 기준에 맞는 문장만 제안
2. 학문적이거나 어려운 문장 제외
3. 비속어 제외
4. 각 문장에 한국어 번역과 사용 상황 포함

이미 학습한 문장 (중복 제외):
{learned_text}

반드시 아래 JSON 형식으로만 응답하세요:
[
  {{"english": "문장", "korean": "번역", "situation": "사용 상황 설명"}}
]"""
        }]
    )

    text = response.content[0].text.strip()
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    return json.loads(text)


def chat_about_sentence(sentence_id, user_message):
    """특정 문장에 대해 AI와 대화 + 코멘트"""
    db = get_db()
    sentence = db.execute(
        "SELECT * FROM sentences WHERE id = ?", (sentence_id,)
    ).fetchone()

    if not sentence:
        return "문장을 찾을 수 없습니다."

    difficulty = sentence["difficulty"] or "basic"
    difficulty_label = DIFFICULTY_LABELS.get(difficulty, "Basic (초급)")

    history = db.execute(
        "SELECT role, content FROM conversations WHERE sentence_id = ? ORDER BY created_at",
        (sentence_id,)
    ).fetchall()

    messages = []
    for h in history:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": user_message})

    system_prompt = f"""당신은 친절한 영어 회화 튜터입니다.
학습 중인 문장: "{sentence['english']}" ({sentence['korean']})
상황: {sentence['situation']}
난이도: {difficulty_label}

응답 형식 (반드시 이 구조를 따르세요):

1. 먼저 학생의 영어에 자연스럽게 영어로 대화를 이어가세요. 학생이 한 질문에 답하거나, 대화 상황을 이어가세요.

2. 그 다음 "---" 구분선 후에 코멘트를 작성하세요:
---
📝 **코멘트**
- 문법: (문법 관련 피드백. 문제없으면 칭찬)
- 표현: (더 자연스러운 표현 제안)
- 팁: (관련 유용한 표현이나 문화적 팁)

규칙:
1. 대화 부분은 영어로 자연스럽게 진행
2. 코멘트 부분은 한국어로 작성
3. {difficulty_label} 수준에 맞게 대화 난이도 조절
4. 대화는 친근하고 격려하는 톤으로 진행
5. 학생이 한국어로 질문하면 한국어로 설명 후 영어 예문 제공"""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        system=system_prompt,
        messages=messages,
    )

    assistant_reply = response.content[0].text

    db.execute(
        "INSERT INTO conversations (sentence_id, role, content) VALUES (?, ?, ?)",
        (sentence_id, "user", user_message),
    )
    db.execute(
        "INSERT INTO conversations (sentence_id, role, content) VALUES (?, ?, ?)",
        (sentence_id, "assistant", assistant_reply),
    )
    db.commit()

    return assistant_reply


def evaluate_sentence(sentence_id):
    """학습 완성도 평가"""
    db = get_db()
    sentence = db.execute(
        "SELECT * FROM sentences WHERE id = ?", (sentence_id,)
    ).fetchone()
    history = db.execute(
        "SELECT role, content FROM conversations WHERE sentence_id = ? ORDER BY created_at",
        (sentence_id,)
    ).fetchall()

    if not history:
        return {"score": 0, "feedback": "아직 대화를 시작하지 않았습니다."}

    difficulty = sentence["difficulty"] or "basic"
    difficulty_label = DIFFICULTY_LABELS.get(difficulty, "Basic (초급)")

    conversation_text = "\n".join(
        f"{'학생' if h['role'] == 'user' else '튜터'}: {h['content']}" for h in history
    )

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": f"""학생이 "{sentence['english']}" 문장을 학습한 대화를 평가해주세요.
난이도: {difficulty_label}

대화 내용:
{conversation_text}

평가 기준:
- 문장을 올바르게 사용했는가
- 대화에 적극적으로 참여했는가
- 난이도에 맞는 표현을 사용했는가

아래 JSON 형식으로만 응답하세요:
{{"score": 1~100 사이 점수, "feedback": "평가 피드백 (한국어)"}}"""
        }]
    )

    text = response.content[0].text.strip()
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    return json.loads(text)


# ─── Routes ─────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/sentences", methods=["GET"])
def get_sentences():
    """오늘의 문장 조회"""
    db = get_db()
    today = date.today().isoformat()
    rows = db.execute(
        "SELECT * FROM sentences WHERE date = ? ORDER BY id", (today,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/sentences/generate", methods=["POST"])
def generate_sentences():
    """오늘의 문장 생성"""
    db = get_db()
    today = date.today().isoformat()

    existing = db.execute(
        "SELECT COUNT(*) as cnt FROM sentences WHERE date = ?", (today,)
    ).fetchone()["cnt"]

    if existing > 0:
        rows = db.execute(
            "SELECT * FROM sentences WHERE date = ? ORDER BY id", (today,)
        ).fetchall()
        return jsonify({"sentences": [dict(r) for r in rows], "message": "오늘의 문장이 이미 있습니다."})

    data = request.get_json() or {}
    topic = data.get("topic", "")
    difficulty = data.get("difficulty", "basic")

    if difficulty not in DIFFICULTY_LABELS:
        difficulty = "basic"

    sentences = generate_daily_sentences(topic, difficulty)

    for s in sentences:
        db.execute(
            "INSERT INTO sentences (date, english, korean, situation, difficulty) VALUES (?, ?, ?, ?, ?)",
            (today, s["english"], s["korean"], s["situation"], difficulty),
        )
    db.commit()

    rows = db.execute(
        "SELECT * FROM sentences WHERE date = ? ORDER BY id", (today,)
    ).fetchall()
    return jsonify({"sentences": [dict(r) for r in rows], "message": "새로운 문장이 생성되었습니다!"})


@app.route("/api/chat", methods=["POST"])
def chat():
    """AI와 대화"""
    data = request.get_json()
    sentence_id = data.get("sentence_id")
    message = data.get("message", "").strip()

    if not sentence_id or not message:
        return jsonify({"error": "sentence_id와 message가 필요합니다."}), 400

    reply = chat_about_sentence(sentence_id, message)
    return jsonify({"reply": reply})


@app.route("/api/chat/history/<int:sentence_id>")
def chat_history(sentence_id):
    """대화 기록 조회"""
    db = get_db()
    rows = db.execute(
        "SELECT role, content, created_at FROM conversations WHERE sentence_id = ? ORDER BY created_at",
        (sentence_id,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/evaluate/<int:sentence_id>", methods=["POST"])
def evaluate(sentence_id):
    """학습 평가 및 완료 처리"""
    result = evaluate_sentence(sentence_id)
    db = get_db()

    db.execute(
        "INSERT INTO evaluations (sentence_id, score, feedback) VALUES (?, ?, ?)",
        (sentence_id, result["score"], result["feedback"]),
    )

    if result["score"] >= 60:
        db.execute(
            "UPDATE sentences SET completed = 1 WHERE id = ?", (sentence_id,)
        )

    db.commit()
    return jsonify(result)


@app.route("/api/history")
def learning_history():
    """학습 이력 조회"""
    db = get_db()
    rows = db.execute("""
        SELECT s.date,
               COUNT(*) as total,
               SUM(s.completed) as completed
        FROM sentences s
        GROUP BY s.date
        ORDER BY s.date DESC
        LIMIT 30
    """).fetchall()
    return jsonify([dict(r) for r in rows])


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
