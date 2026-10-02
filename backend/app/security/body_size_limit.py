from fastapi import HTTPException
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_BAD_REQUEST = 400
_TOO_LARGE = 413


class BodySizeLimitMiddleware:
    """Pure ASGI middleware rejecting request bodies over `max_body_size` bytes.

    Rejects early via Content-Length, and counts streamed bytes for chunked
    requests, which carry no Content-Length.
    """

    def __init__(self, app: ASGIApp, max_body_size: int) -> None:
        self.app = app
        self.max_body_size = max_body_size

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        raw_length = Headers(scope=scope).get("content-length")
        if raw_length is not None:
            try:
                declared = int(raw_length)
            except ValueError:
                declared = -1
            if declared < 0:
                await self._reject(_BAD_REQUEST, "Invalid Content-Length header", scope, receive, send)
                return
            if declared > self.max_body_size:
                await self._reject(_TOO_LARGE, "Request body too large", scope, receive, send)
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_size:
                    # Must be HTTPException: FastAPI converts any other exception
                    # raised during body parsing into a generic 400.
                    raise HTTPException(status_code=_TOO_LARGE, detail="Request body too large")
            return message

        await self.app(scope, limited_receive, send)

    @staticmethod
    async def _reject(
        status_code: int, detail: str, scope: Scope, receive: Receive, send: Send
    ) -> None:
        response = JSONResponse(
            {"detail": detail},
            status_code=status_code,
            headers={"Connection": "close"},  # body is left unread
        )
        await response(scope, receive, send)