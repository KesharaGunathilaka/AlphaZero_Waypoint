"""Entrypoint for hosts that look for `main:app` (Vercel's FastAPI runtime, `uvicorn main:app`)."""
from app.main import app

__all__ = ["app"]
