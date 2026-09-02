# Serve the GIS product and proxy LLM calls so the browser never holds a CORS fight.
#   python serve.py
# Keys: set OPENAI_API_KEY and/or ANTHROPIC_API_KEY, or pass headers from client.
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from openai import OpenAI, OpenAIError

HERE = Path(__file__).resolve().parent
APP = HERE.parent                       # product/
DIST = APP / "frontend" / "dist"        # vite build output
PUBLISHED = APP / "db" / "published"    # ingest artifacts

# geo-api (PostGIS) lives behind this proxy so the browser talks to one origin and
# never holds the tenant identity itself. Unset GEO_API_URL to run file-only.
GEO_API_URL = os.environ.get("GEO_API_URL", "http://127.0.0.1:8013").rstrip("/")
GEO_ORG_ID = os.environ.get("GEO_ORG_ID", "demo")
GEO_WORKSPACE_ID = os.environ.get("GEO_WORKSPACE_ID", "tokyo")
GEO_TIMEOUT_S = float(os.environ.get("GEO_TIMEOUT_S", "20"))


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        key = k.strip()
        val = v.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


_load_dotenv(HERE / ".env")
PORT = int(os.environ.get("PORT", "8765"))
ANTHROPIC = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-3-5-sonnet-latest")
CLAUDE_MAX_TOKENS = int(os.environ.get("CLAUDE_MAX_TOKENS", "700"))
CHAT_MEMORY_MAX_MESSAGES = int(os.environ.get("CHAT_MEMORY_MAX_MESSAGES", "12"))
OPENAI_TIMEOUT_S = int(os.environ.get("OPENAI_TIMEOUT_S", "60"))
OPENAI_STREAM_TIMEOUT_S = int(os.environ.get("OPENAI_STREAM_TIMEOUT_S", "90"))
ANTHROPIC_TIMEOUT_S = int(os.environ.get("ANTHROPIC_TIMEOUT_S", "60"))
CHAT_MEMORY: dict[str, list[dict]] = {}


def _json_bytes(obj) -> bytes:
    return json.dumps(obj).encode("utf-8")


def _estimate_tokens(payload: dict) -> int:
    """Rough token budget visibility — chars/4 heuristic."""
    total = 0
    for m in (payload or {}).get("messages") or []:
        if isinstance(m, dict):
            total += len(str(m.get("content") or ""))
    return max(1, total // 4)


def _log_turn(user_id: str, route: str, *, model: str | None = None, est_tokens: int = 0, ok: bool = True) -> None:
    print(json.dumps({
        "event": "copilot_turn",
        "user_id": user_id,
        "route": route,
        "model": model,
        "est_tokens": est_tokens,
        "ok": ok,
    }, ensure_ascii=True))


def _http_json_post(url: str, payload: dict, headers: dict, timeout: int = 60) -> tuple[int, dict]:
    req = urllib.request.Request(
        url,
        data=_json_bytes(payload),
        headers=headers,
        method="POST",
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as res:
            raw = res.read()
        return 200, json.loads(raw.decode("utf-8", "replace"))
    except urllib.error.HTTPError as err:
        msg = err.read().decode("utf-8", "replace")
        try:
            payload = json.loads(msg)
        except json.JSONDecodeError:
            payload = {"error": msg[:400]}
        return err.code, payload


def _openai_kwargs(payload: dict) -> dict:
    """Allowlist just the fields the SDK call needs — never forward whatever the
    client happened to send (that's how the old REST path ended up shipping our
    own `user_id` bookkeeping field straight to OpenAI and getting every request
    rejected with a 400)."""
    kwargs: dict = {
        "model": payload.get("model") or "gpt-4o-mini",
        "messages": payload.get("messages") or [],
        "temperature": payload.get("temperature", 0),
    }
    if payload.get("response_format"):
        kwargs["response_format"] = payload["response_format"]
    return kwargs


def _openai_to_claude_payload(body: dict) -> dict:
    src = body if isinstance(body, dict) else {}
    msgs = src.get("messages") or []
    system_lines = []
    claude_msgs = []
    for m in msgs:
        role = (m.get("role") or "").strip()
        content = m.get("content")
        if isinstance(content, list):
            chunks = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    chunks.append(str(part.get("text", "")))
            content = "\n".join(chunks).strip()
        else:
            content = str(content or "")
        if not content:
            continue
        if role == "system":
            system_lines.append(content)
            continue
        if role not in {"user", "assistant"}:
            role = "user"
        claude_msgs.append({"role": role, "content": content})
    if not claude_msgs:
        claude_msgs = [{"role": "user", "content": "Respond with valid JSON."}]
    out = {
        "model": CLAUDE_MODEL,
        "max_tokens": int(src.get("max_tokens") or CLAUDE_MAX_TOKENS),
        "temperature": float(src.get("temperature") or 0),
        "messages": claude_msgs,
    }
    if system_lines:
        out["system"] = "\n\n".join(system_lines)
    return out


def _claude_to_openai_shape(data: dict) -> dict:
    text_parts = []
    for p in data.get("content") or []:
        if isinstance(p, dict) and p.get("type") == "text":
            text_parts.append(str(p.get("text") or ""))
    content = "".join(text_parts).strip()
    return {
        "id": data.get("id", "claude-fallback"),
        "object": "chat.completion",
        "created": 0,
        "model": data.get("model", CLAUDE_MODEL),
        "provider": "anthropic",
        "choices": [
            {
                "index": 0,
                "finish_reason": data.get("stop_reason", "stop"),
                "message": {"role": "assistant", "content": content},
            }
        ],
    }


def _merge_with_memory(req_payload: dict, user_id: str) -> dict:
    payload = dict(req_payload or {})
    # user_id is our own bookkeeping field, not an OpenAI Chat Completions
    # parameter — forwarding it verbatim gets the whole request rejected with
    # a 400 ("Unrecognized request argument"). Never send it upstream.
    payload.pop("user_id", None)
    msgs = list(payload.get("messages") or [])
    if not user_id or not msgs:
        return payload
    system_msgs = [m for m in msgs if isinstance(m, dict) and (m.get("role") == "system")]
    live_msgs = [m for m in msgs if isinstance(m, dict) and (m.get("role") != "system")]
    history = CHAT_MEMORY.get(user_id) or []
    payload["messages"] = system_msgs + history + live_msgs
    return payload


def _remember_turn(user_id: str, req_payload: dict, res_payload: dict) -> None:
    if not user_id:
        return
    msgs = list((req_payload or {}).get("messages") or [])
    user_msg = None
    for m in reversed(msgs):
        if isinstance(m, dict) and m.get("role") == "user":
            user_msg = str(m.get("content") or "").strip()
            if user_msg:
                break
    # A body with no role:"user" message leaves user_msg None. Without this guard
    # the AttributeError lands after the model call has already been billed.
    if not user_msg:
        return
    if user_msg.startswith("{") and user_msg.endswith("}"):
        try:
            parsed = json.loads(user_msg)
            if isinstance(parsed, dict) and parsed.get("ask"):
                user_msg = str(parsed.get("ask")).strip()
        except json.JSONDecodeError:
            pass
    bot_msg = str(((res_payload or {}).get("choices") or [{}])[0].get("message", {}).get("content") or "").strip()
    if not user_msg or not bot_msg:
        return
    history = list(CHAT_MEMORY.get(user_id) or [])
    history.append({"role": "user", "content": user_msg})
    history.append({"role": "assistant", "content": bot_msg})
    if len(history) > CHAT_MEMORY_MAX_MESSAGES:
        history = history[-CHAT_MEMORY_MAX_MESSAGES:]
    CHAT_MEMORY[user_id] = history


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}")

    def _send_json(self, code, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _send_sse_headers(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def _sse_send(self, payload: dict):
        raw = f"data: {json.dumps(payload)}\n\n".encode("utf-8")
        self.wfile.write(raw)
        self.wfile.flush()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-OpenAI-Key, X-Anthropic-Key, X-User-Id")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()


    # ---- static: the built frontend and the published artifacts -----------

    _TYPES = {
        ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json",
        ".geojson": "application/json", ".bin": "application/octet-stream",
        ".svg": "image/svg+xml", ".png": "image/png", ".map": "application/json",
        ".woff2": "font/woff2", ".ico": "image/x-icon",
    }

    def _send_file(self, root: Path, rel: str) -> None:
        """Serve one file from `root`, refusing anything that escapes it."""
        rel = urllib.parse.unquote(rel).lstrip("/")
        try:
            target = (root / rel).resolve()
            target.relative_to(root.resolve())
        except (ValueError, OSError):
            self.send_error(403, "outside document root")
            return
        if not target.is_file():
            self.send_error(404, "not found")
            return
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", self._TYPES.get(target.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        # Vite content-hashes asset filenames, so they are safe to cache hard.
        # index.html must not be, or a deploy never reaches the browser.
        if "/assets/" in self.path:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.end_headers()
        if not getattr(self, "_head_only", False):
            self.wfile.write(body)

    def _serve_frontend(self, parsed) -> None:
        if not DIST.is_dir():
            self.send_error(
                503,
                "frontend not built - run: cd product/frontend && npm install && npm run build",
            )
            return
        rel = parsed.path.lstrip("/") or "index.html"
        if not (DIST / rel).is_file():
            if "." in rel.rsplit("/", 1)[-1]:
                self.send_error(404, "not found")
                return
            rel = "index.html"
        self._send_file(DIST, rel)

    def _proxy_geo(self, parsed) -> None:
        """Forward /geo/* to geo-api, attaching the tenant server-side.

        Binary-safe: MVT tiles come back as bytes, so the body is relayed
        unmodified and only the content type is carried over.
        """
        url = f"{GEO_API_URL}{parsed.path}"
        if parsed.query:
            url = f"{url}?{parsed.query}"
        req = urllib.request.Request(url, method="GET")
        req.add_header("X-Org-Id", GEO_ORG_ID)
        req.add_header("X-Workspace-Id", GEO_WORKSPACE_ID)
        try:
            with urllib.request.urlopen(req, timeout=GEO_TIMEOUT_S) as res:
                body = res.read()
                ctype = res.headers.get("Content-Type", "application/octet-stream")
                status = res.status
        except urllib.error.HTTPError as exc:
            body = exc.read() or json.dumps({"error": f"geo-api {exc.code}"}).encode()
            ctype = exc.headers.get("Content-Type", "application/json")
            status = exc.code
        except Exception as exc:
            # The client falls back to the published files when geo-api is absent,
            # so this must be a clean status rather than a dropped connection.
            body = json.dumps({"error": f"geo-api unreachable: {exc}"}).encode()
            ctype = "application/json"
            status = 503
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if ctype.startswith("application/vnd.mapbox-vector-tile"):
            self.send_header("Cache-Control", "public, max-age=300")
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        self._head_only = True
        try:
            self.do_GET()
        finally:
            self._head_only = False

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if parsed.path.startswith("/geo/"):
            self._proxy_geo(parsed)
            return
        if parsed.path.startswith("/published/"):
            self._send_file(PUBLISHED, parsed.path[len("/published/"):])
            return
        if parsed.path.rstrip("/") != "/api/chat/memory":
            self._serve_frontend(parsed)
            return
        q = urllib.parse.parse_qs(parsed.query or "")
        user_id = str(
            (q.get("user_id") or [None])[0]
            or self.headers.get("X-User-Id")
            or "anon"
        ).strip()[:128]
        history = list(CHAT_MEMORY.get(user_id) or [])
        self._send_json(
            200,
            {
                "ok": True,
                "user_id": user_id,
                "count": len(history),
                "max_messages": CHAT_MEMORY_MAX_MESSAGES,
                "messages": history,
            },
        )

    def do_POST(self):
        path = self.path.rstrip("/")
        if path == "/api/chat/reset":
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n)
            req_payload = {}
            if body:
                try:
                    req_payload = json.loads(body.decode("utf-8", "replace"))
                except json.JSONDecodeError:
                    req_payload = {}
            user_id = str(
                req_payload.get("user_id")
                or self.headers.get("X-User-Id")
                or "anon"
            ).strip()[:128]
            removed = len(CHAT_MEMORY.get(user_id) or [])
            CHAT_MEMORY.pop(user_id, None)
            _log_turn(user_id, "memory-reset", ok=True)
            self._send_json(200, {"ok": True, "user_id": user_id, "cleared": removed})
            return

        if path != "/api/chat":
            if path != "/api/chat/stream":
                self.send_error(404)
                return
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n)
            try:
                req_payload = json.loads(body.decode("utf-8", "replace")) if body else {}
            except json.JSONDecodeError:
                self._send_json(400, {"error": "Body must be valid JSON."})
                return
            user_id = str(
                req_payload.get("user_id")
                or self.headers.get("X-User-Id")
                or "anon"
            ).strip()[:128]
            req_with_memory = _merge_with_memory(req_payload, user_id)
            est = _estimate_tokens(req_with_memory)
            oai_key = (self.headers.get("X-OpenAI-Key") or os.environ.get("OPENAI_API_KEY") or "").strip()
            claude_key = (self.headers.get("X-Anthropic-Key") or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
            if not oai_key and not claude_key:
                _log_turn(user_id, "degraded-no-key", est_tokens=est, ok=False)
                self._send_json(
                    401,
                    {"error": "No API key configured. Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY, or pass X-OpenAI-Key / X-Anthropic-Key."},
                )
                return
            self._send_sse_headers()
            full = ""
            route = "degraded"
            model = req_payload.get("model") or "gpt-4o-mini"
            if oai_key:
                try:
                    client = OpenAI(api_key=oai_key)
                    stream = client.chat.completions.create(**_openai_kwargs(req_with_memory), stream=True)
                    for chunk in stream:
                        if not chunk.choices:
                            continue
                        delta = chunk.choices[0].delta.content or ""
                        if not delta:
                            continue
                        full += delta
                        self._sse_send({"delta": delta})
                    if full:
                        route = "openai-stream"
                except OpenAIError as exc:
                    print(f"OpenAI streaming failed: {type(exc).__name__}: {exc}")
                    full = ""
            if not full and claude_key:
                claude_req = _openai_to_claude_payload(req_with_memory)
                code, payload = _http_json_post(
                    ANTHROPIC,
                    claude_req,
                    headers={
                        "x-api-key": claude_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    timeout=ANTHROPIC_TIMEOUT_S,
                )
                if code == 200:
                    shaped = _claude_to_openai_shape(payload)
                    full = str(((shaped.get("choices") or [{}])[0].get("message", {}).get("content")) or "").strip()
                    if full:
                        route = "anthropic"
                        model = CLAUDE_MODEL
                        self._sse_send({"delta": full})
            self._sse_send({"done": True})
            _log_turn(user_id, route, model=model, est_tokens=est, ok=bool(full))
            if full:
                _remember_turn(
                    user_id,
                    req_payload,
                    {"choices": [{"message": {"content": full}}]},
                )
            return
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        try:
            req_payload = json.loads(body.decode("utf-8", "replace")) if body else {}
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Body must be valid JSON."})
            return
        user_id = str(
            req_payload.get("user_id")
            or self.headers.get("X-User-Id")
            or "anon"
        ).strip()[:128]
        req_with_memory = _merge_with_memory(req_payload, user_id)
        est = _estimate_tokens(req_with_memory)

        oai_key = (self.headers.get("X-OpenAI-Key") or os.environ.get("OPENAI_API_KEY") or "").strip()
        claude_key = (self.headers.get("X-Anthropic-Key") or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        if not oai_key and not claude_key:
            _log_turn(user_id, "degraded-no-key", est_tokens=est, ok=False)
            self._send_json(
                401,
                {"error": "No API key configured. Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY, or pass X-OpenAI-Key / X-Anthropic-Key."},
            )
            return

        oai_err = None
        model = req_payload.get("model") or "gpt-4o-mini"
        if oai_key:
            try:
                client = OpenAI(api_key=oai_key)
                completion = client.chat.completions.create(**_openai_kwargs(req_with_memory))
                payload = completion.model_dump(mode="json")
                _remember_turn(user_id, req_payload, payload)
                _log_turn(user_id, "openai", model=model, est_tokens=est, ok=True)
                self._send_json(200, payload)
                return
            except OpenAIError as exc:
                status = getattr(exc, "status_code", 502)
                detail = getattr(exc, "body", None) or str(exc)
                oai_err = {"code": status, "payload": {"error": detail}}

        if claude_key:
            claude_req = _openai_to_claude_payload(req_with_memory)
            code, payload = _http_json_post(
                ANTHROPIC,
                claude_req,
                headers={
                    "x-api-key": claude_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                timeout=ANTHROPIC_TIMEOUT_S,
            )
            if code == 200:
                shaped = _claude_to_openai_shape(payload)
                _remember_turn(user_id, req_payload, shaped)
                _log_turn(user_id, "anthropic", model=CLAUDE_MODEL, est_tokens=est, ok=True)
                self._send_json(200, shaped)
                return
            claude_err = {"code": code, "payload": payload}
            _log_turn(user_id, "degraded-both-failed", model=model, est_tokens=est, ok=False)
            self._send_json(502, {"error": "OpenAI and Claude both failed.", "openai": oai_err, "claude": claude_err})
            return

        _log_turn(user_id, "degraded-openai-failed", model=model, est_tokens=est, ok=False)
        self._send_json(502, {"error": "OpenAI failed and Claude fallback is unavailable.", "openai": oai_err})


if __name__ == "__main__":
    # 127.0.0.1 for local dev; 0.0.0.0 in a container, via HOST.
    host = os.environ.get("HOST", "127.0.0.1")
    httpd = ThreadingHTTPServer((host, PORT), Handler)
    print(f"NineOne Geo  http://{host}:{PORT}/   dist={DIST.is_dir()}  published={PUBLISHED.is_dir()}")
    httpd.serve_forever()
