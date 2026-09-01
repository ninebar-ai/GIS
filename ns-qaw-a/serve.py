# Serve ns-qaw-a and proxy LLM calls so the browser never holds a CORS fight.
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

HERE = Path(__file__).resolve().parent


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
OPENAI = "https://api.openai.com/v1/chat/completions"
ANTHROPIC = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-3-5-sonnet-latest")
CLAUDE_MAX_TOKENS = int(os.environ.get("CLAUDE_MAX_TOKENS", "700"))
CHAT_MEMORY_MAX_MESSAGES = int(os.environ.get("CHAT_MEMORY_MAX_MESSAGES", "12"))
CHAT_MEMORY: dict[str, list[dict]] = {}


def _json_bytes(obj) -> bytes:
    return json.dumps(obj).encode("utf-8")


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


def _openai_stream_lines(payload: dict, api_key: str, timeout: int = 90):
    req = urllib.request.Request(
        OPENAI,
        data=_json_bytes(payload),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as res:
        for raw in res:
            line = raw.decode("utf-8", "replace").strip()
            if line:
                yield line


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
    # Requests may send structured JSON in the user content; keep only the
    # human question in memory so follow-up context stays natural.
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
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

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

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.rstrip("/") != "/api/chat/memory":
            super().do_GET()
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
            oai_key = (self.headers.get("X-OpenAI-Key") or os.environ.get("OPENAI_API_KEY") or "").strip()
            claude_key = (self.headers.get("X-Anthropic-Key") or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
            if not oai_key and not claude_key:
                self._send_json(
                    401,
                    {"error": "No API key configured. Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY, or pass X-OpenAI-Key / X-Anthropic-Key."},
                )
                return
            self._send_sse_headers()
            full = ""
            if oai_key:
                try:
                    stream_req = dict(req_with_memory)
                    stream_req["stream"] = True
                    for line in _openai_stream_lines(stream_req, oai_key):
                        if not line.startswith("data: "):
                            continue
                        payload = line[6:].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            obj = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        delta = str((((obj.get("choices") or [{}])[0].get("delta") or {}).get("content")) or "")
                        if not delta:
                            continue
                        full += delta
                        self._sse_send({"delta": delta})
                except Exception as exc:
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
                )
                if code == 200:
                    shaped = _claude_to_openai_shape(payload)
                    full = str(((shaped.get("choices") or [{}])[0].get("message", {}).get("content")) or "").strip()
                    if full:
                        self._sse_send({"delta": full})
            self._sse_send({"done": True})
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

        oai_key = (self.headers.get("X-OpenAI-Key") or os.environ.get("OPENAI_API_KEY") or "").strip()
        claude_key = (self.headers.get("X-Anthropic-Key") or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        if not oai_key and not claude_key:
            self._send_json(
                401,
                {"error": "No API key configured. Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY, or pass X-OpenAI-Key / X-Anthropic-Key."},
            )
            return

        oai_err = None
        if oai_key:
            code, payload = _http_json_post(
                OPENAI,
                req_with_memory,
                headers={"Authorization": f"Bearer {oai_key}", "Content-Type": "application/json"},
            )
            if code == 200:
                _remember_turn(user_id, req_payload, payload)
                self._send_json(200, payload)
                return
            oai_err = {"code": code, "payload": payload}

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
            )
            if code == 200:
                shaped = _claude_to_openai_shape(payload)
                _remember_turn(user_id, req_payload, shaped)
                self._send_json(200, shaped)
                return
            claude_err = {"code": code, "payload": payload}
            self._send_json(502, {"error": "OpenAI and Claude both failed.", "openai": oai_err, "claude": claude_err})
            return

        self._send_json(502, {"error": "OpenAI failed and Claude fallback is unavailable.", "openai": oai_err})


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"NineOne Geo  http://127.0.0.1:{PORT}/")
    httpd.serve_forever()
