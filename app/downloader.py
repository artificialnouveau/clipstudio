import os
import uuid
import yt_dlp

MEDIA_DIR = os.path.join(os.path.dirname(__file__), "media")


def download_video(url: str) -> dict:
    """Download a video using yt-dlp and return metadata."""
    os.makedirs(MEDIA_DIR, exist_ok=True)
    file_id = uuid.uuid4().hex[:12]
    output_template = os.path.join(MEDIA_DIR, f"{file_id}.%(ext)s")

    base_opts = {
        "outtmpl": output_template,
        "format": "best[ext=mp4]/best",
        "merge_output_format": "mp4",
        "writethumbnail": True,
        "quiet": True,
        "no_warnings": True,
    }

    # Try downloading with browser cookies first (handles age-restricted /
    # login-gated content), then fall back to plain download.
    attempts = [
        {**base_opts, "cookiesfrombrowser": ("chrome",)},
        {**base_opts, "cookiesfrombrowser": ("firefox",)},
        {**base_opts, "cookiesfrombrowser": ("safari",)},
        base_opts,
    ]

    last_error = None
    for opts in attempts:
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
            break
        except Exception as e:
            last_error = e
            # Clean up any partial files before retrying
            for f in os.listdir(MEDIA_DIR):
                if f.startswith(file_id):
                    os.remove(os.path.join(MEDIA_DIR, f))
            continue
    else:
        raise last_error

    title = info.get("title", "Untitled")

    # Find the downloaded video file
    video_path = None
    for f in os.listdir(MEDIA_DIR):
        if f.startswith(file_id) and f.endswith(".mp4"):
            video_path = f
            break
    if not video_path:
        for f in os.listdir(MEDIA_DIR):
            if f.startswith(file_id) and not f.endswith((".jpg", ".png", ".webp")):
                video_path = f
                break

    # Find thumbnail
    thumbnail_path = None
    for f in os.listdir(MEDIA_DIR):
        if f.startswith(file_id) and f.endswith((".jpg", ".png", ".webp")):
            thumbnail_path = f
            break

    if not video_path:
        raise RuntimeError("Download completed but video file not found")

    return {
        "title": title,
        "video_path": video_path,
        "thumbnail_path": thumbnail_path,
    }
