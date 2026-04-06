import os
from faster_whisper import WhisperModel

MEDIA_DIR = os.path.join(os.path.dirname(__file__), "media")

_model = None


def get_model():
    global _model
    if _model is None:
        _model = WhisperModel("base", device="cpu", compute_type="int8")
    return _model


def _format_timestamp(seconds):
    """Format seconds as HH:MM:SS or MM:SS."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def transcribe_video(video_path: str) -> str:
    """Transcribe a video file and return timestamped text."""
    full_path = os.path.join(MEDIA_DIR, video_path)
    if not os.path.isfile(full_path):
        raise FileNotFoundError(f"Video not found: {full_path}")

    model = get_model()
    segments, _ = model.transcribe(full_path, beam_size=5)

    lines = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            start = _format_timestamp(segment.start)
            end = _format_timestamp(segment.end)
            lines.append(f"[{start} - {end}] {text}")

    return "\n".join(lines)
