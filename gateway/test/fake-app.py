#!/usr/bin/env python3
"""A pretend Home app for testing the gateway.

Usage: fake-app.py <name> <ip> <port>

Answers every request with JSON saying who it is and EXACTLY what it received
(path, query, Host header, forwarded-for), so a test can check the gateway
passed things along correctly. A few special paths imitate real app behavior:
  /degraded  -> 503 {"status":"degraded"}  (what HomeCore's health check does)
  /missing   -> 404
  /echo-body -> POST: replies with how many bytes it received
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAME, IP, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3])


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_any(self):
        length = int(self.headers.get("Content-Length") or 0)
        received = len(self.rfile.read(length)) if length else 0
        path = self.path.split("?")[0]
        if path.endswith("/degraded"):
            return self.respond(503, {"status": "degraded", "app": NAME})
        if path.endswith("/missing"):
            return self.respond(404, {"error": "no such thing", "app": NAME})
        self.respond(
            200,
            {
                "app": NAME,
                "method": self.command,
                "path": self.path,
                "host": self.headers.get("Host"),
                "xff": self.headers.get("X-Forwarded-For"),
                "xrealip": self.headers.get("X-Real-IP"),
                "bodyBytes": received,
            },
        )

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = handle_any

    def log_message(self, *args):
        pass  # keep the test output quiet


ThreadingHTTPServer((IP, PORT), Handler).serve_forever()
