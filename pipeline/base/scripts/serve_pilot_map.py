#!/usr/bin/env python3
"""Static file server with HTTP Range support.

Python's stdlib SimpleHTTPRequestHandler does not honour the Range request
header, so loading PMTiles in the browser would download the full file
(60+ MB) just to read the header. This wrapper adds proper Range handling
so the browser can stream tiles efficiently.

Run from the repo root:
    python scripts/serve_pilot_map.py
then open http://localhost:8765/web/pilot_map/
"""

from __future__ import annotations

import argparse
import http.server
import os
import socketserver
from pathlib import Path
from typing import Any


class RangeHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with single-range support (no multipart)."""

    # Force HTTP/1.1 — Python's BaseHTTPRequestHandler defaults to HTTP/1.0,
    # which some browsers + the PMTiles client don't handle reliably for
    # 206 Partial Content responses.
    protocol_version = "HTTP/1.1"

    def do_OPTIONS(self) -> None:
        # CORS preflight.
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.send_header("Allow", "GET, HEAD, OPTIONS")
        self.end_headers()

    def send_head(self) -> Any:  # type: ignore[override]
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(http.server.HTTPStatus.NOT_FOUND, "File not found")
            return None
        try:
            fs = os.fstat(f.fileno())
            size = fs.st_size
            ctype = self.guess_type(path)
            range_header = self.headers.get("Range")
            if range_header and range_header.lower().startswith("bytes="):
                try:
                    spec = range_header.split("=", 1)[1].split(",", 1)[0].strip()
                    start_s, _, end_s = spec.partition("-")
                    if start_s == "" and end_s != "":
                        # Suffix range: last N bytes.
                        length = int(end_s)
                        start = max(0, size - length)
                        end = size - 1
                    else:
                        start = int(start_s)
                        end = int(end_s) if end_s else size - 1
                    if start >= size or end >= size or start > end:
                        self.send_error(416, "Requested Range Not Satisfiable")
                        f.close()
                        return None
                    length = end - start + 1
                    self.send_response(206)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                    self.send_header("Content-Length", str(length))
                    self.send_header("Last-Modified", self.date_time_string(fs.st_mtime))
                    self.end_headers()
                    f.seek(start)
                    return _BoundedFile(f, length)
                except (ValueError, IndexError):
                    pass  # fall through to full response
            self.send_response(http.server.HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(size))
            self.send_header("Last-Modified", self.date_time_string(fs.st_mtime))
            self.end_headers()
            return f
        except Exception:
            f.close()
            raise

    def end_headers(self) -> None:
        # Allow cross-origin so PMTiles served from this server can be loaded
        # by pages opened from file:// during quick local testing too.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
        super().end_headers()


class _BoundedFile:
    """Wrap a file object so SimpleHTTPRequestHandler.copyfile() stops at
    a given byte count, since we've already seeked to the start of the range.
    """

    def __init__(self, f, length: int) -> None:
        self._f = f
        self._remaining = length

    def read(self, n: int = -1) -> bytes:
        if self._remaining <= 0:
            return b""
        if n == -1 or n > self._remaining:
            n = self._remaining
        data = self._f.read(n)
        self._remaining -= len(data)
        return data

    def close(self) -> None:
        self._f.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--directory", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args()

    os.chdir(args.directory)
    handler = RangeHTTPRequestHandler

    class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        allow_reuse_address = True

    with ThreadingServer((args.bind, args.port), handler) as httpd:
        url = f"http://{args.bind}:{args.port}/web/pilot_map/"
        print(f"Serving from {args.directory}")
        print(f"Open: {url}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping...")


if __name__ == "__main__":
    main()
