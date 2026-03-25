import os
from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
)
# --- Config ---
API_KEY = os.environ.get("API_KEY", "")
COOKIE_PATH = "/app/cookies.txt"
MAX_CONTENT_LENGTH = 5000

# --- YouTube client ---
ytt_api = YouTubeTranscriptApi()

# --- FastAPI app ---
app = FastAPI(title="NewsDigest Content Fetcher")


# --- Auth dependency ---
async def verify_api_key(x_api_key: str = Header(default="")):
    if not API_KEY:
        return  # No key configured = skip auth (dev mode)
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


# --- Models ---
class YouTubeRequest(BaseModel):
    video_id: str


class YouTubeResponse(BaseModel):
    transcript: str
    language: str
    error: str | None = None


def _has_cookies() -> bool:
    """Check if a valid cookie file exists."""
    return os.path.exists(COOKIE_PATH) and os.path.getsize(COOKIE_PATH) > 10


def _fetch_transcript_with_api(video_id: str, use_cookies: bool = False):
    """
    Fetch transcript using list_transcripts() → find → fetch() pattern.
    Returns (text, language_code) or raises on failure.
    """
    kwargs = {}
    if use_cookies and _has_cookies():
        kwargs["cookies"] = COOKIE_PATH

    # Step 1: List available transcripts (this parses the page HTML, usually works)
    transcript_list = ytt_api.list_transcripts(video_id, **kwargs)

    # Step 2: Pick best transcript
    # Priority: manual English → auto-generated English → any available
    transcript = None
    try:
        transcript = transcript_list.find_transcript(["en"])
    except NoTranscriptFound:
        try:
            transcript = transcript_list.find_generated_transcript(["en"])
        except NoTranscriptFound:
            available = list(transcript_list)
            if available:
                transcript = available[0]

    if transcript is None:
        return "", "", "no_transcript"

    # Step 3: Fetch the actual transcript content (this fetches XML, may be blocked)
    fetched = transcript.fetch()
    snippets = fetched.snippets if hasattr(fetched, 'snippets') else fetched
    full_text = " ".join(
        s.text if hasattr(s, 'text') else str(s)
        for s in snippets
    )[:MAX_CONTENT_LENGTH]

    return full_text, transcript.language_code, None


# --- Endpoints ---
@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/youtube/transcript", response_model=YouTubeResponse)
async def youtube_transcript(
    req: YouTubeRequest, _=Depends(verify_api_key)
):
    """
    Fetch YouTube transcript with cookie fallback.
    Strategy: try without cookie → retry with cookie if blocked → error
    """
    video_id = req.video_id.strip()
    if not video_id:
        return YouTubeResponse(transcript="", language="", error="empty_video_id")

    # Attempt 1: without cookies
    try:
        text, lang, err = _fetch_transcript_with_api(video_id, use_cookies=False)
        if err:
            return YouTubeResponse(transcript="", language="", error=err)
        return YouTubeResponse(transcript=text, language=lang)
    except (TranscriptsDisabled, VideoUnavailable) as e:
        return YouTubeResponse(transcript="", language="", error=type(e).__name__)
    except Exception as e:
        error_msg = str(e).lower()
        is_blocked = any(kw in error_msg for kw in ["blocked", "too many", "ip", "element found"])
        if not is_blocked or not _has_cookies():
            return YouTubeResponse(
                transcript="", language="", error=f"fetch_error: {str(e)[:200]}"
            )
        print(f"⚠️ YouTube blocked without cookies, retrying with cookies...")

    # Attempt 2: with cookies
    try:
        text, lang, err = _fetch_transcript_with_api(video_id, use_cookies=True)
        if err:
            return YouTubeResponse(transcript="", language="", error=err)
        return YouTubeResponse(transcript=text, language=lang)
    except Exception as e:
        return YouTubeResponse(
            transcript="", language="", error=f"blocked_with_cookies: {str(e)[:200]}"
        )



