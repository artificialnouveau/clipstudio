import os
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from database import get_db, init_db
from downloader import download_video, MEDIA_DIR

app = FastAPI()

BASE_DIR = os.path.dirname(__file__)
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

init_db()


# --- Pydantic models ---

class ChapterCreate(BaseModel):
    name: str

class ChapterRename(BaseModel):
    name: str

class EntryCreate(BaseModel):
    chapter_id: int
    url: str
    notes: str = ""

class NoteUpdate(BaseModel):
    notes: str


# --- Media serving ---

@app.get("/media/{filename}")
def serve_media(filename: str):
    path = os.path.join(MEDIA_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path)


# --- Chapter endpoints ---

@app.get("/api/chapters")
def list_chapters():
    db = get_db()
    rows = db.execute("SELECT * FROM chapters ORDER BY created_at").fetchall()
    db.close()
    return [dict(r) for r in rows]


@app.post("/api/chapters")
def create_chapter(data: ChapterCreate):
    db = get_db()
    cur = db.execute("INSERT INTO chapters (name) VALUES (?)", (data.name,))
    db.commit()
    chapter_id = cur.lastrowid
    row = db.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    db.close()
    return dict(row)


@app.put("/api/chapters/{chapter_id}")
def rename_chapter(chapter_id: int, data: ChapterRename):
    db = get_db()
    db.execute("UPDATE chapters SET name = ? WHERE id = ?", (data.name, chapter_id))
    db.commit()
    row = db.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "Chapter not found")
    return dict(row)


@app.get("/api/chapters/{chapter_id}")
def get_chapter(chapter_id: int):
    db = get_db()
    row = db.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "Chapter not found")
    return dict(row)


@app.put("/api/chapters/{chapter_id}/notes")
def update_chapter_notes(chapter_id: int, data: NoteUpdate):
    db = get_db()
    db.execute("UPDATE chapters SET notes = ? WHERE id = ?", (data.notes, chapter_id))
    db.commit()
    row = db.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "Chapter not found")
    return dict(row)


@app.delete("/api/chapters/{chapter_id}")
def delete_chapter(chapter_id: int):
    db = get_db()
    db.execute("DELETE FROM chapters WHERE id = ?", (chapter_id,))
    db.commit()
    db.close()
    return {"ok": True}


# --- Entry endpoints ---

@app.get("/api/chapters/{chapter_id}/entries")
def list_entries(chapter_id: int):
    db = get_db()
    rows = db.execute(
        "SELECT * FROM entries WHERE chapter_id = ? ORDER BY created_at",
        (chapter_id,),
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


@app.post("/api/entries")
def create_entry(data: EntryCreate):
    try:
        result = download_video(data.url)
    except Exception as e:
        raise HTTPException(400, f"Download failed: {e}")

    db = get_db()
    cur = db.execute(
        """INSERT INTO entries (chapter_id, source_url, video_path, video_title, thumbnail_path, notes)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (data.chapter_id, data.url, result["video_path"], result["title"],
         result["thumbnail_path"], data.notes),
    )
    db.commit()
    row = db.execute("SELECT * FROM entries WHERE id = ?", (cur.lastrowid,)).fetchone()
    db.close()
    return dict(row)


@app.put("/api/entries/{entry_id}/notes")
def update_notes(entry_id: int, data: NoteUpdate):
    db = get_db()
    db.execute("UPDATE entries SET notes = ? WHERE id = ?", (data.notes, entry_id))
    db.commit()
    row = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "Entry not found")
    return dict(row)


@app.delete("/api/entries/{entry_id}")
def delete_entry(entry_id: int):
    db = get_db()
    db.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
    db.commit()
    db.close()
    return {"ok": True}


# --- Search ---

@app.get("/api/search")
def search(q: str = ""):
    if not q.strip():
        return []
    db = get_db()
    rows = db.execute(
        """SELECT entries.*, chapters.name as chapter_name
           FROM entries
           JOIN chapters ON entries.chapter_id = chapters.id
           WHERE entries.video_title LIKE ? OR entries.notes LIKE ?
           ORDER BY entries.created_at DESC""",
        (f"%{q}%", f"%{q}%"),
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


# --- HTML Export ---

@app.get("/api/chapters/{chapter_id}/export")
def export_chapter(chapter_id: int):
    db = get_db()
    chapter = db.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    if not chapter:
        db.close()
        raise HTTPException(404, "Chapter not found")
    entries = db.execute(
        "SELECT * FROM entries WHERE chapter_id = ? ORDER BY created_at",
        (chapter_id,),
    ).fetchall()
    db.close()
    return templates.TemplateResponse("export.html", {
        "request": None,
        "chapter": dict(chapter),
        "entries": [dict(e) for e in entries],
    }, media_type="text/html")


# --- Main page ---

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})
