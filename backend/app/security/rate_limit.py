from app.config import get_settings
from slowapi import Limiter
from slowapi.util import get_remote_address

_settings = get_settings()

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[_settings.RATE_LIMIT_DEFAULT],
)
