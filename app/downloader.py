import os
import re
import yt_dlp

MEDIA_DIR = os.path.join(os.path.dirname(__file__), "media")


MAX_FILENAME_LENGTH = 80


def sanitize_name(name: str) -> str:
    """Remove special characters, replace spaces with underscores, and cap length."""
    name = re.sub(r'[^\w\s-]', '', name)
    name = re.sub(r'\s+', '_', name.strip())
    name = re.sub(r'_+', '_', name)
    name = (name or "untitled")[:MAX_FILENAME_LENGTH].rstrip('_')
    return name


def build_filename(info: dict) -> str:
    """Construct a human-readable filename from yt-dlp info.

    Prefers a real title, but on platforms where the title is just the video id
    (common with Instagram, some TikTok posts, etc.) falls back to the first
    line of the description, then the uploader+id, then the id. Always prepends
    the uploader when it isn't already part of the title, so filenames stay
    distinguishable across creators.
    """
    title = (info.get("title") or "").strip()
    video_id = (info.get("id") or "").strip()
    uploader = (
        info.get("uploader")
        or info.get("channel")
        or info.get("uploader_id")
        or ""
    ).strip()
    description = (info.get("description") or "").strip()

    if not title or title == video_id:
        if description:
            title = description.split("\n", 1)[0][:MAX_FILENAME_LENGTH]
        else:
            title = ""

    if not title:
        title = video_id or "untitled"

    if uploader and uploader.lower() not in title.lower():
        name = f"{uploader}_{title}"
    else:
        name = title

    return sanitize_name(name)


_COOKIE_ATTEMPTS = [
    {"cookiesfrombrowser": ("chrome",)},
    {"cookiesfrombrowser": ("firefox",)},
    {"cookiesfrombrowser": ("safari",)},
    {},
]


def _probe_info(url: str, base_opts: dict):
    """Call yt-dlp's extract_info, trying each cookie source in turn.

    Returns ``(info, working_cookie_opt)``. Raises the last exception if
    every attempt failed.
    """
    info = None
    last_error = None
    working_cookie_opt = {}
    for cookie_opt in _COOKIE_ATTEMPTS:
        try:
            with yt_dlp.YoutubeDL({**base_opts, **cookie_opt}) as ydl:
                info = ydl.extract_info(url, download=False)
            working_cookie_opt = cookie_opt
            break
        except Exception as e:
            last_error = e
            continue
    if info is None:
        raise last_error
    return info, working_cookie_opt


def _unique_filename(dest_dir: str, safe_title: str) -> str:
    """Pick a filename under ``dest_dir`` that doesn't collide with an
    existing ``.mp4``."""
    final_name = safe_title
    counter = 1
    while os.path.exists(os.path.join(dest_dir, f"{final_name}.mp4")):
        final_name = f"{safe_title}_{counter}"
        counter += 1
    return final_name


def _locate_downloaded(dest_dir: str, final_name: str):
    """Find the downloaded video and (optional) thumbnail matching ``final_name``."""
    video_filename = None
    for f in os.listdir(dest_dir):
        if f.startswith(final_name) and f.endswith(".mp4"):
            video_filename = f
            break
    if not video_filename:
        for f in os.listdir(dest_dir):
            if f.startswith(final_name) and not f.endswith((".jpg", ".png", ".webp", ".txt")):
                video_filename = f
                break

    thumbnail_filename = None
    for f in os.listdir(dest_dir):
        if f.startswith(final_name) and f.endswith((".jpg", ".png", ".webp")):
            thumbnail_filename = f
            break

    return video_filename, thumbnail_filename


def _download_to_dir(url: str, dest_dir: str, want_thumbnail: bool) -> dict:
    """Core download pipeline. Picks a filename, runs yt-dlp, and resolves the
    produced files. Returns a dict with ``title``, ``final_name``,
    ``video_filename``, and ``thumbnail_filename``.
    """
    os.makedirs(dest_dir, exist_ok=True)

    base_opts = {"quiet": True, "no_warnings": True}
    info, working_cookie_opt = _probe_info(url, base_opts)

    title = info.get("title", "Untitled")
    safe_title = build_filename(info)
    final_name = _unique_filename(dest_dir, safe_title)

    output_template = os.path.join(dest_dir, f"{final_name}.%(ext)s")
    ffmpeg_path = _find_ffmpeg()

    ydl_opts = {
        **base_opts,
        **working_cookie_opt,
        "outtmpl": output_template,
        "format": "best[ext=mp4]/best",
        "merge_output_format": "mp4",
        "ffmpeg_location": os.path.dirname(ffmpeg_path),
        "postprocessors": [{
            "key": "FFmpegVideoConvertor",
            "preferedformat": "mp4",
        }],
    }
    if want_thumbnail:
        ydl_opts["writethumbnail"] = True

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    video_filename, thumbnail_filename = _locate_downloaded(dest_dir, final_name)
    if not video_filename:
        raise RuntimeError("Download completed but video file not found")

    return {
        "title": title,
        "final_name": final_name,
        "video_filename": video_filename,
        "thumbnail_filename": thumbnail_filename,
    }


def download_video(url: str, notebook_name: str, chapter_name: str) -> dict:
    """Download a video into media/notebook/chapter/ with sanitized filenames."""
    nb_folder = sanitize_name(notebook_name)
    ch_folder = sanitize_name(chapter_name)
    dest_dir = os.path.join(MEDIA_DIR, nb_folder, ch_folder)

    result = _download_to_dir(url, dest_dir, want_thumbnail=True)

    video_path = os.path.join(nb_folder, ch_folder, result["video_filename"])
    thumbnail_path = (
        os.path.join(nb_folder, ch_folder, result["thumbnail_filename"])
        if result["thumbnail_filename"] else None
    )
    return {
        "title": result["title"],
        "video_path": video_path,
        "thumbnail_path": thumbnail_path,
    }


def download_video_to_folder(url: str, folder_name: str) -> dict:
    """Download a video into media/Downloads/folder_name/ with sanitized filenames."""
    safe_folder = sanitize_name(folder_name)
    dest_dir = os.path.join(MEDIA_DIR, "Downloads", safe_folder)

    result = _download_to_dir(url, dest_dir, want_thumbnail=False)

    video_path = os.path.join("Downloads", safe_folder, result["video_filename"])
    return {
        "title": result["title"],
        "video_path": video_path,
        "filename": result["video_filename"],
    }


def _find_ffmpeg() -> str:
    import shutil
    path = shutil.which("ffmpeg")
    if path:
        return path
    for candidate in ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/anaconda3/bin/ffmpeg"]:
        if os.path.isfile(candidate):
            return candidate
    raise FileNotFoundError("ffmpeg not found. Install it with: brew install ffmpeg")


def trim_video(video_path: str, start: str, end: str) -> str:
    """Trim a video using ffmpeg. start/end are timestamps like '00:01:30' or '90'.
    Keeps the original file and returns the relative path to the new trimmed file."""
    import subprocess

    ffmpeg = _find_ffmpeg()

    full_path = os.path.join(MEDIA_DIR, video_path)
    if not os.path.isfile(full_path):
        raise FileNotFoundError(f"Video not found: {full_path}")

    base, ext = os.path.splitext(full_path)

    counter = 1
    trimmed_path = f"{base}_trim{counter}{ext}"
    while os.path.exists(trimmed_path):
        counter += 1
        trimmed_path = f"{base}_trim{counter}{ext}"

    cmd = [ffmpeg, "-y"]
    if start:
        cmd += ["-ss", start]
    cmd += ["-i", full_path]
    if end:
        cmd += ["-to", end]
    cmd += ["-c", "copy", "-map", "0", trimmed_path]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        cmd2 = [ffmpeg, "-y"]
        if start:
            cmd2 += ["-ss", start]
        cmd2 += ["-i", full_path]
        if end:
            cmd2 += ["-to", end]
        cmd2 += ["-map", "0", trimmed_path]
        result2 = subprocess.run(cmd2, capture_output=True, text=True)
        if result2.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {result2.stderr}")

    rel_base, rel_ext = os.path.splitext(video_path)
    return f"{rel_base}_trim{counter}{rel_ext}"


def save_notes_file(video_path: str, notes: str):
    """Save notes as a .txt file alongside the video with the same name."""
    if not video_path:
        return
    full_path = os.path.join(MEDIA_DIR, video_path)
    base = os.path.splitext(full_path)[0]
    txt_path = base + ".txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(notes)
