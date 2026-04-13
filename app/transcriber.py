import os
import logging
import tempfile
import subprocess
import numpy as np
from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)

MEDIA_DIR = os.path.join(os.path.dirname(__file__), "media")

_model = None
_voice_encoder = None


def get_model():
    global _model
    if _model is None:
        _model = WhisperModel("base", device="cpu", compute_type="int8")
    return _model


def _get_voice_encoder():
    global _voice_encoder
    if _voice_encoder is None:
        from resemblyzer import VoiceEncoder
        _voice_encoder = VoiceEncoder()
    return _voice_encoder


def _format_timestamp(seconds):
    """Format seconds as HH:MM:SS or MM:SS."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def _find_ffmpeg():
    """Find ffmpeg binary."""
    import shutil
    path = shutil.which("ffmpeg")
    if path:
        return path
    for candidate in ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/anaconda3/bin/ffmpeg"]:
        if os.path.isfile(candidate):
            return candidate
    return "ffmpeg"


def transcribe_video(video_path: str, diarize: bool = False) -> str:
    """Transcribe a video file and return timestamped text.
    If diarize=True, includes speaker labels."""
    full_path = os.path.join(MEDIA_DIR, video_path)
    if not os.path.isfile(full_path):
        raise FileNotFoundError(f"Video not found: {full_path}")

    model = get_model()
    segments, _ = model.transcribe(full_path, beam_size=5)

    whisper_segments = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            whisper_segments.append({
                "start": segment.start,
                "end": segment.end,
                "text": text,
            })

    if not whisper_segments:
        return ""

    if not diarize:
        return "\n".join(
            f"[{_format_timestamp(s['start'])} - {_format_timestamp(s['end'])}] {s['text']}"
            for s in whisper_segments
        )

    # Speaker diarization using resemblyzer. If it fails (missing model,
    # clustering error, too-short audio, etc.) log the reason so the fallback
    # isn't silent, then return plain timestamped transcription.
    try:
        return _diarize(full_path, whisper_segments)
    except Exception as e:
        logger.warning("Diarization failed, falling back to plain transcript: %s", e, exc_info=True)
        return "\n".join(
            f"[{_format_timestamp(s['start'])} - {_format_timestamp(s['end'])}] {s['text']}"
            for s in whisper_segments
        )


def _diarize(video_path: str, whisper_segments: list) -> str:
    """Add speaker labels to whisper segments using resemblyzer."""
    from resemblyzer import preprocess_wav
    from sklearn.cluster import AgglomerativeClustering

    # Extract audio as WAV
    wav_path = tempfile.mktemp(suffix=".wav")
    try:
        ffmpeg = _find_ffmpeg()
        subprocess.run(
            [ffmpeg, "-y", "-i", video_path, "-ac", "1", "-ar", "16000", "-f", "wav", wav_path],
            capture_output=True, check=True,
        )

        encoder = _get_voice_encoder()
        wav = preprocess_wav(wav_path)
        sample_rate = 16000

        # Get embedding for each segment
        embeddings = []
        valid_indices = []
        for i, seg in enumerate(whisper_segments):
            start_sample = int(seg["start"] * sample_rate)
            end_sample = int(seg["end"] * sample_rate)
            segment_wav = wav[start_sample:end_sample]
            if len(segment_wav) < sample_rate * 0.5:
                continue
            emb = encoder.embed_utterance(segment_wav)
            embeddings.append(emb)
            valid_indices.append(i)

        if len(embeddings) < 2:
            # Not enough segments to cluster
            return "\n".join(
                f"[{_format_timestamp(s['start'])} - {_format_timestamp(s['end'])}] {s['text']}"
                for s in whisper_segments
            )

        emb_matrix = np.array(embeddings)

        # Find optimal number of speakers (2-5)
        best_n = 2
        if len(embeddings) >= 4:
            from sklearn.metrics import silhouette_score
            best_score = -1
            for n in range(2, min(6, len(embeddings))):
                try:
                    clustering = AgglomerativeClustering(n_clusters=n, metric="cosine", linkage="average")
                    labels = clustering.fit_predict(emb_matrix)
                    if len(set(labels)) > 1:
                        score = silhouette_score(emb_matrix, labels, metric="cosine")
                        if score > best_score:
                            best_score = score
                            best_n = n
                except Exception:
                    continue

        clustering = AgglomerativeClustering(n_clusters=best_n, metric="cosine", linkage="average")
        labels = clustering.fit_predict(emb_matrix)

        # Map labels back to all segments
        label_map = {}
        for idx, label in zip(valid_indices, labels):
            label_map[idx] = label

        lines = []
        for i, seg in enumerate(whisper_segments):
            label = label_map.get(i, -1)
            speaker = f"Speaker {label + 1}" if label >= 0 else "Speaker ?"
            lines.append(
                f"[{_format_timestamp(seg['start'])} - {_format_timestamp(seg['end'])}] {speaker}: {seg['text']}"
            )
        return "\n".join(lines)

    finally:
        if os.path.exists(wav_path):
            os.unlink(wav_path)
