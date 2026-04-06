# Digital Culture Notebook

A personal media notebook web app for saving videos with rich-text notes — like Evernote, but for videos. Supports downloading from YouTube, TikTok, Instagram, Facebook, and other platforms via yt-dlp.

## Features

- **Notebooks & Chapters** — Organize content into notebooks with named chapters
- **Video Entries** — Download videos locally and write notes alongside them
- **Timestamped Transcription** — Transcribe videos with per-segment timestamps using Whisper
- **Video Trimming** — Trim by start/end timestamps; original preserved, new entry created
- **Scene Splitting** — Detect scene changes using in-browser perceptual hashing
- **Semantic Search (RAG)** — Build a search index from transcripts, search by meaning
- **Bulk Download** — Download multiple videos at once into named folders
- **Rich Text Editor** — Bold, italic, lists, and headings via Quill.js
- **Fully Local** — No cloud, no accounts. Everything stays on your machine

## Getting Started

### Step 1: Install Python

1. Go to [python.org/downloads](https://www.python.org/downloads/)
2. Download **Python 3.10 or newer**
3. **Windows:** Check "Add Python to PATH" during install

### Step 2: Download & Run

1. [**Download ZIP**](https://github.com/artificialnouveau/digital_culture_notebook/archive/refs/heads/main.zip) and unzip it
2. **Mac:** Double-click **`install_and_run.command`** (right-click > Open if blocked)
3. **Windows:** Double-click **`install_and_run.bat`**

The script installs everything (including Homebrew + ffmpeg on Mac) and opens the app. First launch takes a few minutes.

After first install, use **`Digital Culture Notebook.command`** (Mac) or **`.bat`** (Windows) for quick launch.

---

## Usage Guide

### Sidebar — Notebooks & Chapters

Use the sidebar to switch notebooks, create chapters, and search.

![Sidebar](screenshots/08_sidebar.png)

- **Notebook dropdown** — switch, create (+), rename, delete notebooks
- **Chapters** — click to open, drag to reorder, hover for rename/delete
- **Search** — keyword search across all notes and titles
- **Bulk Download** — open the bulk download view

### Chapter View

Select a chapter to see its entries, notes, and tools.

![Chapter View](screenshots/02_chapter_view.png)

- **Toolbar** — "Transcribe All" transcribes every entry; "Build Index for RAG" creates semantic search index
- **Chapter Notes** — rich-text editor for general chapter notes
- **Folder path** — shown at the top so you know where files are saved on disk

### Adding Videos

Paste a video URL and click Download & Save. A progress bar shows while downloading.

![Add Entry](screenshots/04_add_entry.png)

Supports YouTube, TikTok, Instagram, Facebook, Twitter/X, Reddit, Vimeo, and [1000+ sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).

### Entry Cards

Each entry shows the video, notes editor, and action buttons.

![Entry Card](screenshots/03_entry_card.png)

- **Trim** — enter start/end timestamps to extract a clip (original is preserved)
- **Split Scenes** — detect and save scene changes
- **Transcribe** — generate a timestamped transcript
- **Save Notes** — persist your rich-text notes

### Transcription

Click **Transcribe** on any entry. The transcript appears in a dedicated section with timestamps like `[0:00 - 0:15] Hello world...`. Click **Transcribe All** to process every entry in the chapter.

### Scene Splitting

Click **Split Scenes** on an entry to open the scene detection modal.

![Scene Splitter](screenshots/06_scene_splitter.png)

1. Adjust **sensitivity** (lower = more scenes) and **sample interval**
2. Click **Detect Scenes** — frames are analyzed in-browser
3. Preview scenes with thumbnails and transcript excerpts
4. **Save** individual scenes, selected scenes, or all at once — each becomes a new entry

### Semantic Search (RAG)

1. **Transcribe** your videos first (the index is built from timestamped transcripts)
2. Click **Build Index for RAG** in the toolbar
3. A search box appears — type a query like "protest movements" or "economic impact"
4. Results show the video title, time range, transcript excerpt, and relevance score (0-1, closer to 1 = more related)
5. Click **Trim & Save** on any result to extract that clip as a new entry

Rebuild the index after adding or transcribing new videos.

### Bulk Download

Click **Bulk Download** in the sidebar.

![Bulk Download](screenshots/07_bulk_download.png)

1. Enter a folder name and paste URLs (one per line)
2. Optionally check "Transcribe after download"
3. Click **Download All** — progress bar tracks each download
4. Use **Build Index for RAG** and **Transcribe All** on downloaded folders

---

## Advanced: Manual Setup

```bash
pip install -r requirements.txt
cd app
uvicorn main:app --port 8080
```

### Dependencies

| Package | Purpose |
|---------|---------|
| **fastapi** + **uvicorn** | Web server |
| **yt-dlp** | Video downloading |
| **faster-whisper** | Timestamped speech-to-text transcription |
| **sentence-transformers** | Semantic search embeddings (all-MiniLM-L6-v2) |
| **jinja2** | HTML templating |
| **python-multipart** | Form data handling |

Client-side (CDN, no install):
- **Quill.js** — Rich text editor
- **Transformers.js** — In-browser semantic search (Xenova/all-MiniLM-L6-v2)

## Project Structure

```
digital_culture_notebook/
  install_and_run.command  # One-click setup (Mac)
  install_and_run.bat      # One-click setup (Windows)
  requirements.txt
  app/
    main.py            # FastAPI backend
    database.py        # SQLite setup
    downloader.py      # yt-dlp wrapper
    transcriber.py     # Whisper transcription
    templates/         # HTML templates
    static/            # CSS, JS
    media/             # Downloaded videos (git-ignored)
      Notebook_Name/
        Chapter_Name/
          video.mp4
          video.txt
          index.json   # Semantic search index
    notebook.db        # SQLite database (git-ignored)
```

## Notes

- Videos stored locally in `app/media/`, served by the backend
- Database auto-created on first run
- Browser cookies used for age-restricted content (Chrome, Firefox, Safari)
- Whisper `base` model (~150MB) downloaded on first transcription
- Embedding model `all-MiniLM-L6-v2` (~90MB) downloaded on first index build
- Scene detection runs entirely in the browser
