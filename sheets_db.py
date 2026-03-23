"""
Google Sheets를 데이터베이스로 사용하는 모듈
SQLite 대신 Google Sheets API로 데이터를 읽고 쓴다.

시트 구조:
- sentences: id, date, english, korean, situation, difficulty, completed, created_at
- conversations: id, sentence_id, role, content, created_at
- evaluations: id, sentence_id, score, feedback, created_at
"""

import os
import gspread
from google.oauth2.service_account import Credentials
from datetime import datetime

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# 전역 클라이언트 (지연 초기화)
_client = None
_spreadsheet = None


def _get_spreadsheet():
    """Google Sheets 스프레드시트 연결 (싱글턴)"""
    global _client, _spreadsheet
    if _spreadsheet is not None:
        return _spreadsheet

    creds_file = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")
    spreadsheet_key = os.getenv("GOOGLE_SHEET_ID", "")

    if not os.path.exists(creds_file):
        raise FileNotFoundError(
            f"Google 서비스 계정 키 파일을 찾을 수 없습니다: {creds_file}\n"
            "설정 방법: README의 'Google Sheets 설정' 섹션을 참고하세요."
        )

    if not spreadsheet_key:
        raise ValueError(
            "GOOGLE_SHEET_ID 환경변수가 설정되지 않았습니다.\n"
            ".env 파일에 GOOGLE_SHEET_ID=<스프레드시트ID>를 추가하세요."
        )

    creds = Credentials.from_service_account_file(creds_file, scopes=SCOPES)
    _client = gspread.authorize(creds)
    _spreadsheet = _client.open_by_key(spreadsheet_key)
    return _spreadsheet


def _get_sheet(name):
    """워크시트 가져오기 (없으면 생성)"""
    ss = _get_spreadsheet()
    try:
        return ss.worksheet(name)
    except gspread.exceptions.WorksheetNotFound:
        return _init_sheet(ss, name)


def _init_sheet(ss, name):
    """시트 초기화 (헤더 포함)"""
    headers = {
        "sentences": ["id", "date", "english", "korean", "situation", "difficulty", "completed", "created_at"],
        "conversations": ["id", "sentence_id", "role", "content", "created_at"],
        "evaluations": ["id", "sentence_id", "score", "feedback", "created_at"],
    }
    ws = ss.add_worksheet(title=name, rows=1000, cols=len(headers.get(name, [])))
    ws.append_row(headers[name])
    return ws


def _next_id(ws):
    """다음 ID 생성 (마지막 행의 id + 1)"""
    all_values = ws.get_all_values()
    if len(all_values) <= 1:  # 헤더만 있음
        return 1
    last_row = all_values[-1]
    try:
        return int(last_row[0]) + 1
    except (ValueError, IndexError):
        return len(all_values)


def _now():
    return datetime.now().isoformat()


# ─── Sentences ─────────────────────────────────────────────────────

def get_sentences_by_date(target_date, difficulty=""):
    """오늘의 문장 조회 (난이도 필터 지원)"""
    ws = _get_sheet("sentences")
    all_rows = ws.get_all_records()

    results = []
    for row in all_rows:
        if row["date"] == target_date:
            if difficulty and row.get("difficulty", "") != difficulty:
                continue
            results.append(row)
    return results


def count_sentences_by_date(target_date, difficulty=""):
    """특정 날짜+난이도 문장 수"""
    sentences = get_sentences_by_date(target_date, difficulty)
    return len(sentences)


def insert_sentence(target_date, english, korean, situation, difficulty="basic"):
    """문장 추가"""
    ws = _get_sheet("sentences")
    new_id = _next_id(ws)
    ws.append_row([new_id, target_date, english, korean, situation, difficulty, 0, _now()])
    return new_id


def get_sentence_by_id(sentence_id):
    """ID로 문장 조회"""
    ws = _get_sheet("sentences")
    all_rows = ws.get_all_records()
    for row in all_rows:
        if str(row["id"]) == str(sentence_id):
            return row
    return None


def mark_sentence_completed(sentence_id):
    """문장 학습 완료 표시"""
    ws = _get_sheet("sentences")
    all_values = ws.get_all_values()
    for i, row in enumerate(all_values):
        if i == 0:  # 헤더 스킵
            continue
        if str(row[0]) == str(sentence_id):
            # completed 컬럼 (인덱스 6) 업데이트
            ws.update_cell(i + 1, 7, 1)
            return True
    return False


def get_learned_sentences_list():
    """학습 완료된 문장 목록"""
    ws = _get_sheet("sentences")
    all_rows = ws.get_all_records()
    return [row["english"] for row in all_rows if str(row.get("completed", 0)) == "1" or row.get("completed") == 1]


def delete_sentences_by_date_difficulty(target_date, difficulty=""):
    """특정 날짜+난이도 문장 삭제 (관련 대화/평가도 삭제)"""
    ws = _get_sheet("sentences")
    all_values = ws.get_all_values()

    # 삭제할 문장 ID와 행 번호 수집 (역순으로)
    rows_to_delete = []
    sentence_ids = []

    for i in range(len(all_values) - 1, 0, -1):  # 역순, 헤더 제외
        row = all_values[i]
        if row[1] == target_date:
            if difficulty and row[5] != difficulty:
                continue
            rows_to_delete.append(i + 1)  # 1-indexed
            sentence_ids.append(row[0])

    # 역순으로 행 삭제 (인덱스 변경 방지)
    for row_num in rows_to_delete:
        ws.delete_rows(row_num)

    # 관련 대화/평가 삭제
    if sentence_ids:
        _delete_by_sentence_ids("conversations", sentence_ids)
        _delete_by_sentence_ids("evaluations", sentence_ids)

    return len(sentence_ids)


def _delete_by_sentence_ids(sheet_name, sentence_ids):
    """sentence_id로 관련 행 삭제"""
    ws = _get_sheet(sheet_name)
    all_values = ws.get_all_values()
    str_ids = [str(sid) for sid in sentence_ids]

    rows_to_delete = []
    for i in range(len(all_values) - 1, 0, -1):
        if all_values[i][1] in str_ids:  # sentence_id는 인덱스 1
            rows_to_delete.append(i + 1)

    for row_num in rows_to_delete:
        ws.delete_rows(row_num)


# ─── Conversations ─────────────────────────────────────────────────

def get_conversations(sentence_id):
    """대화 기록 조회"""
    ws = _get_sheet("conversations")
    all_rows = ws.get_all_records()
    return [row for row in all_rows if str(row["sentence_id"]) == str(sentence_id)]


def insert_conversation(sentence_id, role, content):
    """대화 기록 추가"""
    ws = _get_sheet("conversations")
    new_id = _next_id(ws)
    ws.append_row([new_id, int(sentence_id), role, content, _now()])
    return new_id


# ─── Evaluations ───────────────────────────────────────────────────

def insert_evaluation(sentence_id, score, feedback):
    """평가 기록 추가"""
    ws = _get_sheet("evaluations")
    new_id = _next_id(ws)
    ws.append_row([new_id, int(sentence_id), score, feedback, _now()])
    return new_id


# ─── History ───────────────────────────────────────────────────────

def get_learning_history(limit=30):
    """학습 이력 (날짜별 집계)"""
    ws = _get_sheet("sentences")
    all_rows = ws.get_all_records()

    # 날짜별 집계
    date_stats = {}
    for row in all_rows:
        d = row["date"]
        if d not in date_stats:
            date_stats[d] = {"date": d, "total": 0, "completed": 0}
        date_stats[d]["total"] += 1
        if str(row.get("completed", 0)) == "1" or row.get("completed") == 1:
            date_stats[d]["completed"] += 1

    # 날짜 역순 정렬, 최근 limit개
    result = sorted(date_stats.values(), key=lambda x: x["date"], reverse=True)
    return result[:limit]


# ─── 초기화 확인 ───────────────────────────────────────────────────

def init_sheets():
    """시트 초기화 (앱 시작 시 호출)"""
    try:
        _get_sheet("sentences")
        _get_sheet("conversations")
        _get_sheet("evaluations")
        print("✅ Google Sheets 연결 성공")
        return True
    except Exception as e:
        print(f"⚠️ Google Sheets 연결 실패: {e}")
        print("SQLite 모드로 실행됩니다.")
        return False
