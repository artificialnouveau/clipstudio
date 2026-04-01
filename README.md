# Digital Culture Notebook

A personal media notebook web app for saving videos with rich-text notes — like Evernote, but for videos. Supports downloading from YouTube, TikTok, Instagram, Facebook, and other platforms via yt-dlp.

![Screenshot](screenshot.png)

## Features

- **Notebooks** — Create multiple notebooks, each with its own set of chapters
- **Chapters** — Organize content into named chapters within a notebook, each with its own rich-text notes. Reorder chapters with drag-and-drop or arrow buttons
- **Video Entries** — Paste a URL, download the video locally, and write notes alongside it
- **Transcription** — Transcribe any video using Whisper (faster-whisper). Transcribe individual entries or all entries in a chapter at once. Already-transcribed entries are automatically skipped
- **Rich Text Editor** — Bold, italic, lists, and headings via Quill.js
- **Search** — Keyword search across all notes and video titles
- **Organized File Storage** — Videos and notes saved in `media/Notebook_Name/Chapter_Name/` with clean filenames
- **Fully Local** — No cloud, no accounts. Videos and notes stay on your machine

## Getting Started

### Step 1: Install Python

If you don't have Python installed yet:

1. Go to [python.org/downloads](https://www.python.org/downloads/)
2. Download and install **Python 3.10 or newer**
3. **Windows users:** During installation, check the box that says **"Add Python to PATH"** — this is important!

*(Mac users: Python 3 may already be installed. The launcher will tell you if it's missing.)*

### Step 2: Download the App

1. Click this link: [**Download ZIP**](https://github.com/artificialnouveau/digital_culture_notebook/archive/refs/heads/main.zip)
2. Unzip the downloaded file (double-click it)

### Step 3: Run the App

**Mac:**
- Open the unzipped folder and double-click **`install_and_run.command`**
- If macOS says the file can't be opened: right-click it, choose **Open**, then click **Open** again

**Windows:**
- Open the unzipped folder and double-click **`install_and_run.bat`**

That's it! The script automatically installs everything (yt-dlp, Whisper, etc.) and opens the app in your browser. The first launch takes a few minutes while dependencies install.

> **Note:** If the script warns about **ffmpeg** missing, video downloading still works but transcription won't. To install ffmpeg:
> - **Mac:** Open Terminal and run `brew install ffmpeg` (requires [Homebrew](https://brew.sh))
> - **Windows:** Download from [ffmpeg.org](https://ffmpeg.org/download.html) and [add it to PATH](https://www.wikihow.com/Install-FFmpeg-on-Windows)

To stop the app, close the terminal window or press `Ctrl+C`.

### Running it again later

After the first install, use the quick launcher instead:

- **Mac:** Double-click **`Digital Culture Notebook.command`**
- **Windows:** Double-click **`Digital Culture Notebook.bat`**

**Tip:** Drag this file to your Dock (Mac) or right-click and choose "Pin to Taskbar" / "Create shortcut on Desktop" (Windows) for easy access.

---

## Advanced: Manual Setup

If you prefer to set things up yourself:

```bash
pip install -r requirements.txt
cd app
uvicorn main:app --port 8080
```

### What gets installed (requirements.txt)

| Package | Purpose |
|---------|---------|
| **fastapi** + **uvicorn** | Web server |
| **yt-dlp** | Video downloading (YouTube, TikTok, Instagram, Facebook, etc.) |
| **faster-whisper** | Local speech-to-text transcription |
| **jinja2** | HTML templating |
| **python-multipart** | Form data handling |

## Usage

1. **Create a notebook** — Use the notebook dropdown at the top of the sidebar; click **+** to create, **✏** to rename, **✕** to delete
2. **Create a chapter** — Type a name in the sidebar and click **+**
3. **Reorder chapters** — Hover to see ▲/▼ arrows, or drag and drop
4. **Add chapter notes** — Use the rich-text editor at the top of each chapter for general notes
5. **Add a video entry** — Paste a video URL (YouTube, TikTok, Instagram, Facebook, etc.) and click **Download & Save**
6. **Edit notes** — Each entry has its own rich-text editor; click **Save Notes** to persist (also saved as a .txt file alongside the video)
7. **Transcribe** — Click **Transcribe** on an entry to generate a transcript, or **Transcribe All** in the toolbar to transcribe every entry in the chapter (skips already-transcribed ones)
8. **Search** — Use the search bar in the sidebar to find entries by title or note content
9. **Delete** — Remove entries with the **Delete** button, or delete entire chapters from the sidebar

## Supported Platforms

yt-dlp supports [1000+ sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), including:
- YouTube
- TikTok
- Instagram (Reels, posts)
- Facebook (Reels, videos)
- Twitter/X
- Reddit
- Vimeo
- And many more

## Project Structure

```
digital_culture_notebook/
  install_and_run.sh   # One-click setup & launch (macOS/Linux)
  install_and_run.bat  # One-click setup & launch (Windows)
  requirements.txt     # Python dependencies
  app/
    main.py            # FastAPI backend (API + page serving)
    database.py        # SQLite setup and migrations
    downloader.py      # yt-dlp wrapper with browser cookie support
    transcriber.py     # Whisper transcription wrapper
    templates/         # Jinja2 HTML templates
    static/            # CSS, JS, icon
    media/             # Downloaded videos and notes (git-ignored)
      My_Notebook/
        Chapter_1/
          video_title.mp4
          video_title.txt   # Notes saved alongside video
    notebook.db        # SQLite database (git-ignored)
```

## Notes

- Videos are stored locally in `app/media/` and served by the backend
- The database (`notebook.db`) is auto-created on first run
- For age-restricted or login-gated videos, the downloader attempts to use cookies from your browser (Chrome, Firefox, Safari)
- Transcription uses the `base` Whisper model by default. The model is downloaded automatically on first use (~150MB). Edit `transcriber.py` to change the model size (e.g. `small`, `medium`, `large-v3` for higher accuracy)
