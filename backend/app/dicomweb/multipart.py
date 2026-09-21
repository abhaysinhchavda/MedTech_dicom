from __future__ import annotations

import uuid


def multipart_related(parts: list[tuple[str, bytes]]) -> tuple[bytes, str]:
    """Build a multipart/related body.

    parts = [(media_type, payload), ...]. Returns (body, content_type).
    """
    boundary = uuid.uuid4().hex
    chunks: list[bytes] = []
    for media_type, payload in parts:
        head = f"--{boundary}\r\nContent-Type: {media_type}\r\n\r\n".encode()
        chunks.append(head + payload + b"\r\n")
    chunks.append(f"--{boundary}--".encode())
    body = b"".join(chunks)
    content_type = f'multipart/related; type="{parts[0][0]}"; boundary={boundary}'
    return body, content_type
