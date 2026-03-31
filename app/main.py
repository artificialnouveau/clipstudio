import os
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from database import get_db, init_db
from downloader import download_video, save_notes_file, MEDIA_DIR

app = FastAPI()

BASE_DIR = os.path.dirname(__file__)
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

init_db()


# --- Pydantic models ---

class NameBody(BaseModel):
    name: str

class ChapterCreate(BaseModel):
    notebook_id: int
    name: str

class EntryCreate(BaseModel):
    chapter_id: int
    url: str
    notes: str = ""

class NoteUpdate(BaseModel):
    notes: str


# --- Media serving ---

@app.get("/media/{filepath:path}")
def serve_media(filepath: str):
    path = os.path.join(MEDIA_DIR, filepath)
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path)


# --- Notebook endpoints ---

@app.get("/api/notebooks")
def list_notebooks():
    db = get_db()
    rows = db.execute("SELECT * FROM notebooks ORDER BY created_at").fetchall()
    db.close()
    return [dict(r) for r in rows]


@app.post("/api/notebooks")
def create_notebook(data: NameBody):
    db = get_db()
    cur = db.execute("INSERT INTO notebooks (name) VALUES (?)", (data.name,))
    db.commit()
    row = db.execute("SELECT * FROM notebooks WHERE id = ?", (cur.lastrowid,)).fetchone()
    db.close()
    return dict(row)


@app.put("/api/notebooks/{notebook_id}")
def rename_notebook(notebook_id: int, data: NameBody):
    db = get_db()
    db.execute("UPDATE notebooks SET name = ? WHERE id = ?", (data.name, notebook_id))
    db.commit()
    row = db.execute("SELECT * FROM notebooks WHERE id = ?", (notebook_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "Notebook not found")
    return dict(row)


@app.delete("/api/notebooks/{notebook_id}")
def delete_notebook(notebook_id: int):
    db = get_db()
    count = db.execute("SELECT COUNT(*) as cnt FROM notebooks").fetchone()["cnt"]
    if count <= 1:
        db.close()
        raise HTTPException(400, "Cannot delete the last notebook")
    db.execute("DELETE FROM notebooks WHERE id = ?", (notebook_id,))
    db.commit()
    db.close()
    return {"ok": True}


# --- Chapter endpoints ---

@app.get("/api/notebooks/{notebook_id}/chapters")
def list_chapters(notebook_id: int):
    db = get_db()
    rows = db.execute(
        "SELECT * FROM chapters WHERE notebook_id = ? ORDER BY created_at",
        (notebook_id,),
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


@app.post("/api/chapters")
def create_chapter(data: ChapterCreate):
    db = get_db()
    cur = db.execute(
        "INSERT INTO chapters (notebook_id, name) VALUES (?, ?)",
        (data.notebook_id, data.name),
    )
    db.commit()
    row = db.execute("SELECT * FROM chapters WHERE id = ?", (cur.lastrowid,)).fetchone()
    db.close()
    return dict(row)


@app.put("/api/chapters/{chapter_id}")
def rename_chapter(chapter_id: int, data: NameBody):
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
    # Look up notebook and chapter names for folder structure
    db = get_db()
    chapter = db.execute("SELECT * FROM chapters WHERE id = ?", (data.chapter_id,)).fetchone()
    if not chapter:
        db.close()
        raise HTTPException(404, "Chapter not found")
    notebook = db.execute("SELECT * FROM notebooks WHERE id = ?", (chapter["notebook_id"],)).fetchone()
    db.close()

    try:
        result = download_video(data.url, notebook["name"], chapter["name"])
    except Exception as e:
        raise HTTPException(400, f"Download failed: {e}")

    # Save initial notes as .txt alongside the video
    if data.notes:
        save_notes_file(result["video_path"], data.notes)

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
    # Also save notes as .txt file alongside the video
    save_notes_file(row["video_path"], data.notes)
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
