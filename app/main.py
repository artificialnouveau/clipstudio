import os
import tempfile
import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from database import get_db, init_db
from downloader import download_video, download_video_to_folder, trim_video, save_notes_file, MEDIA_DIR, _find_ffmpeg
from transcriber import transcribe_video

CLOUD_API_URL = "https://mediascope-cloud.fly.dev"

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

class ReorderBody(BaseModel):
    chapter_ids: list[int]

class BulkDownloadItem(BaseModel):
    url: str
    start: str = ""
    end: str = ""

class BulkDownloadRequest(BaseModel):
    folder: str
    urls: list[BulkDownloadItem]
    transcribe: bool = False

class TrimRequest(BaseModel):
    video_path: str
    start: str = ""
    end: str = ""
    entry_id: int | None = None

class SceneRange(BaseModel):
    start: str
    end: str

class SceneSplitRequest(BaseModel):
    entry_id: int
    scenes: list[SceneRange]


def _parse_ts(ts_str: str) -> float:
    """Parse a timestamp string like '1:23' or '1:02:03' into seconds."""
    parts = ts_str.split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    elif len(parts) == 2:
        return int(parts[0]) * 60 + int(parts[1])
    return 0


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
        "SELECT * FROM chapters WHERE notebook_id = ? ORDER BY sort_order, created_at",
        (notebook_id,),
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


@app.post("/api/chapters")
def create_chapter(data: ChapterCreate):
    db = get_db()
    # Set sort_order to max + 1 so new chapters appear at the end
    max_order = db.execute(
        "SELECT COALESCE(MAX(sort_order), -1) FROM chapters WHERE notebook_id = ?",
        (data.notebook_id,),
    ).fetchone()[0]
    cur = db.execute(
        "INSERT INTO chapters (notebook_id, name, sort_order) VALUES (?, ?, ?)",
        (data.notebook_id, data.name, max_order + 1),
    )
    db.commit()
    row = db.execute("SELECT * FROM chapters WHERE id = ?", (cur.lastrowid,)).fetchone()
    db.close()
    return dict(row)


@app.put("/api/chapters/reorder")
def reorder_chapters(data: ReorderBody):
    db = get_db()
    for i, chapter_id in enumerate(data.chapter_ids):
        db.execute("UPDATE chapters SET sort_order = ? WHERE id = ?", (i, chapter_id))
    db.commit()
    db.close()
    return {"ok": True}


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
    if not row:
        db.close()
        raise HTTPException(404, "Chapter not found")
    notebook = db.execute("SELECT * FROM notebooks WHERE id = ?", (row["notebook_id"],)).fetchone()
    db.close()
    result = dict(row)
    if notebook:
        from downloader import sanitize_name
        folder_path = os.path.join(MEDIA_DIR, sanitize_name(notebook["name"]), sanitize_name(row["name"]))
        result["folder_path"] = folder_path
    return result


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
        "SELECT * FROM entries WHERE chapter_id = ? ORDER BY created_at DESC",
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


@app.post("/api/entries/{entry_id}/transcribe")
def transcribe_entry(entry_id: int, diarize: bool = False):
    db = get_db()
    row = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "Entry not found")
    if not row["video_path"]:
        raise HTTPException(400, "No video to transcribe")

    # Skip if already transcribed (unless re-transcribing with diarization)
    if row["transcript"] and not diarize:
        return dict(row)

    try:
        transcript = transcribe_video(row["video_path"], diarize=diarize)
    except Exception as e:
        raise HTTPException(500, f"Transcription failed: {e}")

    db = get_db()
    db.execute("UPDATE entries SET transcript = ? WHERE id = ?", (transcript, entry_id))
    db.commit()
    entry = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    db.close()
    save_notes_file(entry["video_path"], transcript)
    return dict(entry)


@app.delete("/api/entries/{entry_id}")
def delete_entry(entry_id: int):
    db = get_db()
    db.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
    db.commit()
    db.close()
    return {"ok": True}


# --- Cloud proxy endpoints ---

def _extract_audio_to_tempfile(video_path: str) -> str:
    """Extract audio from a video file to a temporary WAV file. Returns the temp file path."""
    import subprocess
    abs_path = os.path.join(MEDIA_DIR, video_path)
    if not os.path.isfile(abs_path):
        raise HTTPException(404, "Video file not found")
    ffmpeg = _find_ffmpeg()
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    result = subprocess.run(
        [ffmpeg, "-y", "-i", abs_path, "-ac", "1", "-ar", "16000", "-f", "wav", tmp.name],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        os.unlink(tmp.name)
        raise HTTPException(500, f"Audio extraction failed: {result.stderr[:500]}")
    return tmp.name


@app.post("/api/entries/{entry_id}/extract-audio")
def extract_audio(entry_id: int):
    db = get_db()
    row = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "Entry not found")
    if not row["video_path"]:
        raise HTTPException(400, "No video file")
    wav_path = _extract_audio_to_tempfile(row["video_path"])
    return FileResponse(wav_path, media_type="audio/wav", filename=f"entry_{entry_id}.wav")


@app.post("/api/entries/{entry_id}/cloud-transcribe")
def cloud_transcribe(entry_id: int, request: Request):
    cloud_key = request.headers.get("X-Cloud-Key", "")
    if not cloud_key:
        raise HTTPException(401, "Missing cloud API key")

    db = get_db()
    row = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "Entry not found")
    if not row["video_path"]:
        raise HTTPException(400, "No video file")

    wav_path = _extract_audio_to_tempfile(row["video_path"])
    try:
        with open(wav_path, "rb") as f:
            resp = httpx.post(
                f"{CLOUD_API_URL}/api/v1/transcribe",
                headers={"X-API-Key": cloud_key},
                files={"file": ("audio.wav", f, "audio/wav")},
                timeout=300.0,
            )
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"Cloud transcription failed: {resp.text[:500]}")
        transcript = resp.json().get("transcript", resp.text)
    finally:
        os.unlink(wav_path)

    db = get_db()
    db.execute("UPDATE entries SET transcript = ? WHERE id = ?", (transcript, entry_id))
    db.commit()
    entry = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    db.close()
    return dict(entry)


@app.post("/api/entries/{entry_id}/cloud-tag")
def cloud_tag(entry_id: int, request: Request):
    cloud_key = request.headers.get("X-Cloud-Key", "")
    if not cloud_key:
        raise HTTPException(401, "Missing cloud API key")

    db = get_db()
    row = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "Entry not found")

    resp = httpx.post(
        f"{CLOUD_API_URL}/api/v1/tag",
        headers={"X-API-Key": cloud_key, "Content-Type": "application/json"},
        json={"transcript": row["transcript"] or "", "title": row["video_title"] or ""},
        timeout=120.0,
    )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Cloud tagging failed: {resp.text[:500]}")

    data = resp.json()
    summary = data.get("summary", "")
    tags = ",".join(data.get("tags", [])) if isinstance(data.get("tags"), list) else data.get("tags", "")
    language = data.get("language", "")
    sentiment = data.get("sentiment", "")

    db = get_db()
    db.execute(
        "UPDATE entries SET summary = ?, tags = ?, language = ?, sentiment = ? WHERE id = ?",
        (summary, tags, language, sentiment, entry_id),
    )
    db.commit()
    entry = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    db.close()
    return dict(entry)


@app.post("/api/entries/{entry_id}/cloud-translate")
def cloud_translate(entry_id: int, request: Request):
    cloud_key = request.headers.get("X-Cloud-Key", "")
    if not cloud_key:
        raise HTTPException(401, "Missing cloud API key")

    db = get_db()
    row = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "Entry not found")
    if not row["video_path"]:
        raise HTTPException(400, "No video file")

    wav_path = _extract_audio_to_tempfile(row["video_path"])
    try:
        with open(wav_path, "rb") as f:
            resp = httpx.post(
                f"{CLOUD_API_URL}/api/v1/translate",
                headers={"X-API-Key": cloud_key},
                files={"file": ("audio.wav", f, "audio/wav")},
                timeout=300.0,
            )
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"Cloud translation failed: {resp.text[:500]}")
        translation = resp.json().get("translation", resp.text)
    finally:
        os.unlink(wav_path)

    existing_transcript = row["transcript"] or ""
    updated_transcript = existing_transcript + "\n\n--- Translation (English) ---\n" + translation

    db = get_db()
    db.execute("UPDATE entries SET transcript = ? WHERE id = ?", (updated_transcript, entry_id))
    db.commit()
    entry = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    db.close()
    return dict(entry)


@app.post("/api/entries/{entry_id}/scrape-meta")
def scrape_meta(entry_id: int, request: Request):
    cloud_key = request.headers.get("X-Cloud-Key", "")
    if not cloud_key:
        raise HTTPException(401, "Missing cloud API key")

    db = get_db()
    row = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "Entry not found")
    if not row["source_url"]:
        raise HTTPException(400, "No source URL for this entry")

    resp = httpx.post(
        f"{CLOUD_API_URL}/api/v1/scrape-meta",
        headers={"X-API-Key": cloud_key, "Content-Type": "application/json"},
        json={"url": row["source_url"]},
        timeout=120.0,
    )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Scraping failed: {resp.text[:500]}")

    return resp.json()


# --- Bulk Download ---

@app.post("/api/bulk/download")
def bulk_download_one(item: BulkDownloadItem, folder: str = ""):
    """Download a single video to a bulk folder."""
    if not folder:
        raise HTTPException(400, "Folder name required")
    try:
        result = download_video_to_folder(item.url, folder)
    except Exception as e:
        raise HTTPException(400, f"Download failed: {e}")

    # Trim if timestamps provided
    if item.start or item.end:
        try:
            trimmed_path = trim_video(result["video_path"], item.start, item.end)
            result["trimmed_video_path"] = trimmed_path
        except Exception as e:
            # Download succeeded but trim failed - return with warning
            result["trim_error"] = str(e)

    return result


@app.post("/api/bulk/transcribe")
def bulk_transcribe(video_path: str = ""):
    """Transcribe a bulk-downloaded video and save as .txt."""
    if not video_path:
        raise HTTPException(400, "video_path required")
    try:
        transcript = transcribe_video(video_path)
    except Exception as e:
        raise HTTPException(500, f"Transcription failed: {e}")

    save_notes_file(video_path, transcript)
    return {"transcript": transcript, "video_path": video_path}


@app.post("/api/trim")
def trim_entry_video(data: TrimRequest):
    """Trim a video, keeping the original. If entry_id is provided, create a new entry for the clip."""
    try:
        trimmed_path = trim_video(data.video_path, data.start, data.end)
    except Exception as e:
        raise HTTPException(500, f"Trim failed: {e}")

    # Build a title for the trimmed clip
    time_label = f"{data.start or '0:00'}-{data.end or 'end'}"
    new_entry = None

    if data.entry_id:
        db = get_db()
        original = db.execute("SELECT * FROM entries WHERE id = ?", (data.entry_id,)).fetchone()
        if original:
            title = f"{original['video_title'] or 'Untitled'} (trim {time_label})"
            cur = db.execute(
                """INSERT INTO entries (chapter_id, source_url, video_path, video_title, thumbnail_path, notes)
                   VALUES (?, ?, ?, ?, ?, '')""",
                (original["chapter_id"], original["source_url"], trimmed_path, title, original["thumbnail_path"]),
            )
            db.commit()
            new_entry = dict(db.execute("SELECT * FROM entries WHERE id = ?", (cur.lastrowid,)).fetchone())
        db.close()

    return {"ok": True, "video_path": trimmed_path, "entry": new_entry}


@app.post("/api/split-scenes")
def split_scenes(data: SceneSplitRequest):
    """Split a video into scene clips using ffmpeg, creating a new entry for each."""
    import subprocess

    db = get_db()
    original = db.execute("SELECT * FROM entries WHERE id = ?", (data.entry_id,)).fetchone()
    db.close()
    if not original:
        raise HTTPException(404, "Entry not found")

    video_path = original["video_path"]
    abs_path = os.path.join(MEDIA_DIR, video_path)
    if not os.path.isfile(abs_path):
        raise HTTPException(404, "Video file not found")

    ffmpeg = _find_ffmpeg()
    base, ext = os.path.splitext(abs_path)
    original_title = original["video_title"] or "Untitled"

    new_entries = []
    for i, scene in enumerate(data.scenes):
        out_path = f"{base}_scene{i + 1}.mp4"
        cmd = [ffmpeg, "-y", "-i", abs_path]
        if scene.start:
            cmd += ["-ss", scene.start]
        if scene.end:
            cmd += ["-to", scene.end]
        cmd += ["-c", "copy", "-avoid_negative_ts", "make_zero", out_path]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise HTTPException(500, f"ffmpeg failed on scene {i + 1}: {result.stderr[:500]}")

        # Build relative path for DB (same structure as original)
        rel_out = os.path.relpath(out_path, MEDIA_DIR)
        time_label = f"{scene.start}-{scene.end}"
        title = f"{original_title} (scene {i + 1}: {time_label})"

        db = get_db()
        cur = db.execute(
            """INSERT INTO entries (chapter_id, source_url, video_path, video_title, thumbnail_path, notes)
               VALUES (?, ?, ?, ?, ?, '')""",
            (original["chapter_id"], original["source_url"], rel_out, title, original["thumbnail_path"]),
        )
        db.commit()
        entry = dict(db.execute("SELECT * FROM entries WHERE id = ?", (cur.lastrowid,)).fetchone())
        db.close()
        new_entries.append(entry)

    return {"ok": True, "entries": new_entries}


@app.get("/api/bulk/folders")
def list_bulk_folders():
    """List all bulk download folders."""
    downloads_dir = os.path.join(MEDIA_DIR, "Downloads")
    if not os.path.isdir(downloads_dir):
        return []
    folders = []
    for name in sorted(os.listdir(downloads_dir)):
        folder_path = os.path.join(downloads_dir, name)
        if os.path.isdir(folder_path):
            files = [f for f in os.listdir(folder_path) if f.endswith(".mp4")]
            folders.append({"name": name, "video_count": len(files)})
    return folders


@app.get("/api/bulk/folders/{folder_name}")
def list_bulk_folder_contents(folder_name: str):
    """List videos in a bulk download folder."""
    folder_path = os.path.join(MEDIA_DIR, "Downloads", folder_name)
    if not os.path.isdir(folder_path):
        raise HTTPException(404, "Folder not found")
    videos = []
    for f in sorted(os.listdir(folder_path)):
        if f.endswith(".mp4"):
            video_path = os.path.join("Downloads", folder_name, f)
            txt_path = os.path.join(folder_path, os.path.splitext(f)[0] + ".txt")
            transcript = ""
            if os.path.isfile(txt_path):
                with open(txt_path, "r", encoding="utf-8") as tf:
                    transcript = tf.read()
            videos.append({
                "filename": f,
                "video_path": video_path,
                "title": os.path.splitext(f)[0].replace("_", " "),
                "has_transcript": bool(transcript),
                "transcript": transcript,
            })
    return videos


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


# --- RAG Index ---

@app.post("/api/chapters/{chapter_id}/build-index")
def build_chapter_index(chapter_id: int):
    """Build a semantic search index (index.json) for all entries in a chapter."""
    from sentence_transformers import SentenceTransformer

    db = get_db()
    chapter = db.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    if not chapter:
        db.close()
        raise HTTPException(404, "Chapter not found")
    notebook = db.execute("SELECT * FROM notebooks WHERE id = ?", (chapter["notebook_id"],)).fetchone()
    entries = db.execute(
        "SELECT * FROM entries WHERE chapter_id = ? ORDER BY created_at DESC",
        (chapter_id,),
    ).fetchall()
    db.close()

    if not entries:
        raise HTTPException(400, "No entries to index")

    # Collect text chunks from transcripts and notes
    chunks = []
    videos = {}
    for entry in entries:
        e = dict(entry)
        vid = str(e["id"])
        videos[vid] = {
            "title": e["video_title"] or "Untitled",
            "video_path": e["video_path"],
            "source_url": e["source_url"] or "",
        }
        # Add transcript chunks with timestamps
        transcript = e.get("transcript") or ""
        if transcript:
            import re as _re
            # Parse timestamped lines: [0:00 - 0:30] text
            ts_pattern = _re.compile(r'\[(\d+:?\d*:\d+)\s*-\s*(\d+:?\d*:\d+)\]\s*(.*)')
            segments = []
            for line in transcript.split("\n"):
                m = ts_pattern.match(line.strip())
                if m:
                    segments.append({"start": _parse_ts(m.group(1)), "end": _parse_ts(m.group(2)), "text": m.group(3)})

            if segments:
                # Group segments into ~30-second chunks
                chunk_segs = []
                chunk_start = segments[0]["start"]
                chunk_texts = []
                for seg in segments:
                    chunk_texts.append(seg["text"])
                    if seg["end"] - chunk_start >= 30:
                        chunks.append({
                            "id": f"{vid}_t_{len(chunks)}",
                            "text": " ".join(chunk_texts),
                            "video_id": vid,
                            "type": "transcript",
                            "start": round(chunk_start, 1),
                            "end": round(seg["end"], 1),
                        })
                        chunk_texts = []
                        chunk_start = seg["end"]
                if chunk_texts:
                    chunks.append({
                        "id": f"{vid}_t_{len(chunks)}",
                        "text": " ".join(chunk_texts),
                        "video_id": vid,
                        "type": "transcript",
                        "start": round(chunk_start, 1),
                        "end": round(segments[-1]["end"], 1),
                    })
            else:
                # Fallback for plain text transcripts (no timestamps)
                words = transcript.split()
                chunk_size = 200
                overlap = 50
                for i in range(0, len(words), chunk_size - overlap):
                    chunk_text = " ".join(words[i:i + chunk_size])
                    if chunk_text.strip():
                        chunks.append({
                            "id": f"{vid}_t_{i}",
                            "text": chunk_text,
                            "video_id": vid,
                            "type": "transcript",
                            "start": 0,
                            "end": 0,
                        })
        # Add notes as a chunk
        notes = e.get("notes") or ""
        # Strip HTML tags from notes
        import re
        clean_notes = re.sub(r'<[^>]+>', ' ', notes).strip()
        if clean_notes and len(clean_notes) > 10:
            chunks.append({
                "id": f"{vid}_n",
                "text": clean_notes,
                "video_id": vid,
                "type": "notes",
            })

    if not chunks:
        raise HTTPException(400, "No text content to index. Transcribe some entries first.")

    # Generate embeddings
    model = SentenceTransformer("all-MiniLM-L6-v2")
    texts = [c["text"] for c in chunks]
    embeddings = model.encode(texts, show_progress_bar=False).tolist()

    # Build index.json
    import json
    index_data = {
        "videos": videos,
        "text_chunks": {
            "ids": [c["id"] for c in chunks],
            "documents": texts,
            "metadatas": [{"video_id": c["video_id"], "type": c["type"], "start": c.get("start", 0), "end": c.get("end", 0)} for c in chunks],
            "embeddings": embeddings,
        },
    }

    # Save to the chapter folder
    from downloader import sanitize_name
    folder = os.path.join(MEDIA_DIR, sanitize_name(notebook["name"]), sanitize_name(chapter["name"]))
    os.makedirs(folder, exist_ok=True)
    index_path = os.path.join(folder, "index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index_data, f)

    return {
        "ok": True,
        "path": index_path,
        "videos": len(videos),
        "chunks": len(chunks),
    }


@app.post("/api/bulk/folders/{folder_name}/build-index")
def build_bulk_index(folder_name: str):
    """Build a semantic search index for a bulk download folder."""
    from sentence_transformers import SentenceTransformer
    import json

    folder_path = os.path.join(MEDIA_DIR, "Downloads", folder_name)
    if not os.path.isdir(folder_path):
        raise HTTPException(404, "Folder not found")

    chunks = []
    videos = {}
    for f in sorted(os.listdir(folder_path)):
        if not f.endswith(".mp4"):
            continue
        vid = os.path.splitext(f)[0]
        video_path = os.path.join("Downloads", folder_name, f)
        videos[vid] = {
            "title": vid.replace("_", " "),
            "video_path": video_path,
        }
        txt_path = os.path.join(folder_path, vid + ".txt")
        if os.path.isfile(txt_path):
            with open(txt_path, "r", encoding="utf-8") as tf:
                transcript = tf.read()
            if transcript.strip():
                words = transcript.split()
                chunk_size = 200
                overlap = 50
                for i in range(0, len(words), chunk_size - overlap):
                    chunk_text = " ".join(words[i:i + chunk_size])
                    if chunk_text.strip():
                        chunks.append({
                            "id": f"{vid}_t_{i}",
                            "text": chunk_text,
                            "video_id": vid,
                            "type": "transcript",
                        })

    if not chunks:
        raise HTTPException(400, "No transcripts found. Transcribe some videos first.")

    model = SentenceTransformer("all-MiniLM-L6-v2")
    texts = [c["text"] for c in chunks]
    embeddings = model.encode(texts, show_progress_bar=False).tolist()

    index_data = {
        "videos": videos,
        "text_chunks": {
            "ids": [c["id"] for c in chunks],
            "documents": texts,
            "metadatas": [{"video_id": c["video_id"], "type": c["type"], "start": c.get("start", 0), "end": c.get("end", 0)} for c in chunks],
            "embeddings": embeddings,
        },
    }

    index_path = os.path.join(folder_path, "index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index_data, f)

    return {
        "ok": True,
        "path": index_path,
        "videos": len(videos),
        "chunks": len(chunks),
    }


@app.get("/api/chapters/{chapter_id}/index")
def get_chapter_index(chapter_id: int):
    """Serve the index.json for a chapter."""
    db = get_db()
    chapter = db.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    if not chapter:
        db.close()
        raise HTTPException(404, "Chapter not found")
    notebook = db.execute("SELECT * FROM notebooks WHERE id = ?", (chapter["notebook_id"],)).fetchone()
    db.close()

    from downloader import sanitize_name
    index_path = os.path.join(MEDIA_DIR, sanitize_name(notebook["name"]), sanitize_name(chapter["name"]), "index.json")
    if not os.path.isfile(index_path):
        raise HTTPException(404, "No index found. Build it first.")
    return FileResponse(index_path, media_type="application/json")


@app.get("/api/bulk/folders/{folder_name}/index")
def get_bulk_index(folder_name: str):
    """Serve the index.json for a bulk folder."""
    index_path = os.path.join(MEDIA_DIR, "Downloads", folder_name, "index.json")
    if not os.path.isfile(index_path):
        raise HTTPException(404, "No index found. Build it first.")
    return FileResponse(index_path, media_type="application/json")


@app.get("/api/indexes")
def list_all_indexes():
    """List all available search indexes (chapters and bulk folders)."""
    from downloader import sanitize_name
    indexes = []

    db = get_db()
    notebooks = db.execute("SELECT * FROM notebooks").fetchall()
    for nb in notebooks:
        chapters = db.execute("SELECT * FROM chapters WHERE notebook_id = ?", (nb["id"],)).fetchall()
        for ch in chapters:
            index_path = os.path.join(MEDIA_DIR, sanitize_name(nb["name"]), sanitize_name(ch["name"]), "index.json")
            if os.path.isfile(index_path):
                indexes.append({
                    "type": "chapter",
                    "name": f"{nb['name']} / {ch['name']}",
                    "chapter_id": ch["id"],
                    "url": f"/api/chapters/{ch['id']}/index",
                })
    db.close()

    downloads_dir = os.path.join(MEDIA_DIR, "Downloads")
    if os.path.isdir(downloads_dir):
        for name in sorted(os.listdir(downloads_dir)):
            index_path = os.path.join(downloads_dir, name, "index.json")
            if os.path.isfile(index_path):
                indexes.append({
                    "type": "bulk",
                    "name": f"Downloads / {name.replace('_', ' ')}",
                    "folder_name": name,
                    "url": f"/api/bulk/folders/{name}/index",
                })

    return indexes


# --- HTML Export ---

@app.get("/api/chapters/{chapter_id}/export")
def export_chapter(chapter_id: int, request: Request):
    db = get_db()
    chapter = db.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    if not chapter:
        db.close()
        raise HTTPException(404, "Chapter not found")
    entries = db.execute(
        "SELECT * FROM entries WHERE chapter_id = ? ORDER BY created_at DESC",
        (chapter_id,),
    ).fetchall()
    db.close()
    return templates.TemplateResponse(
        request,
        "export.html",
        context={"chapter": dict(chapter), "entries": [dict(e) for e in entries]},
        media_type="text/html",
    )


# --- Main page ---

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html")
