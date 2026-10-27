"""Carbon-X sidecar: an OpenAI-compatible HTTP server on 127.0.0.1 only.

    uv run --group carbon carbon/serve.py --model-dir ~/Projects/carbon-x/model \
        --revision 539ad36790e78a38718c547bcb12c55b8a447c56

Routes: GET /health, GET /v1/models, POST /v1/chat/completions,
POST /v1/dna/log-likelihood. See docs/carbon-x.md for the contract.

The host is fixed to 127.0.0.1; there is no flag to change it. Request and response
bodies are never logged: DNA can be personal. Logs carry ids, token counts, latency
and VRAM only. Errors shown to callers are short sentences; exceptions go to the log.
"""

from __future__ import annotations

import argparse
import json
import logging
import threading
import time
import uuid
from collections.abc import Callable
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from protocol import (
    MAX_BODY_BYTES,
    Engine,
    Limits,
    RequestError,
    chat_response,
    check_context,
    error_body,
    log_likelihood_response,
    models_response,
    parse_chat_request,
    parse_dna,
)

HOST = "127.0.0.1"
DEFAULT_PORT = 8090
log = logging.getLogger("carbon")

Response = tuple[int, dict[str, Any]]


def handle(
    method: str,
    path: str,
    body: bytes,
    engine: Engine,
    limits: Limits,
    revision: str,
    gpu_lock: threading.Lock,
    clock: Callable[[], float] = time.time,
) -> Response:
    """Route one request to a status and JSON body. Raises nothing."""
    request_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
    try:
        if method == "GET" and path == "/health":
            return 200, {"status": "ok", **engine.health()}
        if method == "GET" and path == "/v1/models":
            return 200, models_response()
        if method != "POST" or path not in ("/v1/chat/completions", "/v1/dna/log-likelihood"):
            raise RequestError(404, "Not found.", "not_found_error")
        try:
            payload = json.loads(body.decode("utf-8")) if body else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise RequestError(400, "The request body is not valid JSON.") from None

        if path == "/v1/dna/log-likelihood":
            dna = parse_dna(payload, limits)
            with gpu_lock:
                result = engine.log_likelihood(dna)
            log.info("%s loglik tokens=%d ms=%d vram=%d", request_id, result.prompt_tokens,
                     result.latency_ms, result.peak_vram_bytes)
            return 200, log_likelihood_response(result, revision)

        request = parse_chat_request(payload, limits)
        with gpu_lock:
            prompt_tokens = engine.count_prompt_tokens(request)
            check_context(prompt_tokens, request, limits)
            generation = engine.generate(request)
        log.info("%s chat prompt=%d completion=%d finish=%s ms=%d vram=%d", request_id,
                 generation.prompt_tokens, generation.completion_tokens, generation.finish_reason,
                 generation.latency_ms, generation.peak_vram_bytes)
        return 200, chat_response(request_id, int(clock()), generation, revision)
    except RequestError as refused:
        log.info("%s refused status=%d type=%s", request_id, refused.status, refused.kind)
        return refused.status, error_body(refused.message, refused.kind)
    except Exception:  # noqa: BLE001 - the caller gets a plain sentence, the log gets the trace
        log.exception("%s failed", request_id)
        return 500, error_body("Carbon-X could not answer this request. Try again or shorten it.",
                               "server_error")


def make_server(engine: Engine, limits: Limits, revision: str, port: int) -> ThreadingHTTPServer:
    gpu_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "carbon-x-sidecar"
        sys_version = ""

        def _send(self, status: int, body: dict[str, Any]) -> None:
            data = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _route(self, method: str) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY_BYTES:
                self._send(413, error_body("The request is too large.", "invalid_request_error"))
                return
            body = self.rfile.read(length) if length else b""
            path = self.path.split("?", 1)[0]
            self._send(*handle(method, path, body, engine, limits, revision, gpu_lock))

        def do_GET(self) -> None:  # noqa: N802 - http.server naming
            self._route("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._route("POST")

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            # Method, path and status only; never bodies or headers.
            log.debug("%s %s", self.command, self.path.split("?", 1)[0])

    return ThreadingHTTPServer((HOST, port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser(description="Carbon-X sidecar (127.0.0.1 only)")
    parser.add_argument("--model-dir", required=True, help="local snapshot of HuggingFaceBio/Carbon-X")
    parser.add_argument("--revision", required=True, help="expected commit sha of the snapshot")
    parser.add_argument("--hf-home", help="HF_HOME holding the pinned Qwen3 base tokenizer")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--max-context", type=int, default=4096)
    parser.add_argument("--default-max-tokens", type=int, default=1024)
    parser.add_argument("--gpu-layers", type=int, default=None,
                        help="decoder layers kept on the GPU; the rest stream from host RAM (default: fit)")
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # Imported here so that protocol and handle stay importable without torch.
    from engine import load_engine

    limits = Limits(max_context=args.max_context, default_max_tokens=args.default_max_tokens)
    engine = load_engine(
        model_dir=args.model_dir,
        revision=args.revision,
        hf_home=args.hf_home,
        max_context=args.max_context,
        gpu_layers=args.gpu_layers,
        threads=args.threads,
    )
    server = make_server(engine, limits, args.revision, args.port)
    log.info("serving %s on http://%s:%d", "carbon-x", HOST, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
