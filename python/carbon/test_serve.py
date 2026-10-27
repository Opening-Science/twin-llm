"""Request/response shape of the Carbon-X sidecar with a fake engine: no torch, no GPU.
The DNA here is a synthetic 36-base string, not anyone's sequence."""

import json
import logging
import threading
import urllib.error
import urllib.request

import pytest

from protocol import ChatRequest, Generation, Limits, LogLikelihood
from serve import HOST, handle, make_server

REVISION = "539ad36790e78a38718c547bcb12c55b8a447c56"
LIMITS = Limits(max_context=4096, default_max_tokens=1024)
DNA = "ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTT"


class FakeEngine:
    def __init__(self, prompt_tokens: int = 21) -> None:
        self.prompt_tokens = prompt_tokens
        self.seen: list[ChatRequest] = []

    def count_prompt_tokens(self, request: ChatRequest) -> int:
        return self.prompt_tokens

    def generate(self, request: ChatRequest) -> Generation:
        self.seen.append(request)
        return Generation(
            text="Pathogenic.",
            prompt_tokens=self.prompt_tokens,
            completion_tokens=4,
            finish_reason="stop",
            latency_ms=1234,
            peak_vram_bytes=6_000_000_000,
        )

    def log_likelihood(self, dna: str) -> LogLikelihood:
        return LogLikelihood(log_likelihood=-42.5, dna_tokens=6, prompt_tokens=8,
                             latency_ms=50, peak_vram_bytes=5_000_000_000)

    def health(self) -> dict:
        return {"model": "carbon-x", "revision": REVISION}


def call(engine: FakeEngine, method: str, path: str, body: object = None) -> tuple[int, dict]:
    raw = b"" if body is None else json.dumps(body).encode()
    return handle(method, path, raw, engine, LIMITS, REVISION, threading.Lock(), clock=lambda: 1_800_000_000)


def chat_body(**extra: object) -> dict:
    return {
        "model": "carbon-x",
        "messages": [{"role": "user", "content": f"What does this sequence encode?\n\n{DNA}"}],
        **extra,
    }


def test_chat_completion_shape() -> None:
    engine = FakeEngine()
    status, body = call(engine, "POST", "/v1/chat/completions", chat_body(temperature=0, max_tokens=64))
    assert status == 200
    assert body["id"].startswith("chatcmpl-")
    del body["id"]
    assert body == {
        "object": "chat.completion",
        "created": 1_800_000_000,
        "model": "carbon-x",
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": "Pathogenic."}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 21, "completion_tokens": 4, "total_tokens": 25},
        "carbon": {"revision": REVISION, "latency_ms": 1234, "peak_vram_bytes": 6_000_000_000},
    }


def test_request_defaults_and_greedy() -> None:
    engine = FakeEngine()
    call(engine, "POST", "/v1/chat/completions", chat_body())
    call(engine, "POST", "/v1/chat/completions", chat_body(temperature=0, seed=7, max_tokens=8))
    default, greedy = engine.seen
    assert (default.max_tokens, default.temperature, default.top_p, default.top_k) == (1024, 0.6, 0.95, 20)
    assert default.enable_thinking is False
    assert (greedy.max_tokens, greedy.temperature, greedy.seed) == (8, 0.0, 7)


def test_content_parts_are_joined() -> None:
    engine = FakeEngine()
    parts = [{"type": "text", "text": "Is this benign? "}, {"type": "text", "text": DNA}]
    status, _ = call(engine, "POST", "/v1/chat/completions",
                     {"messages": [{"role": "user", "content": parts}]})
    assert status == 200
    assert engine.seen[0].messages[0].content == f"Is this benign? {DNA}"


@pytest.mark.parametrize(
    ("body", "status", "kind", "message"),
    [
        (chat_body(model="gpt-4"), 404, "not_found_error", "Unknown model. This server serves 'carbon-x'."),
        (chat_body(stream=True), 400, "invalid_request_error", "Streaming is not supported."),
        ({"messages": []}, 400, "invalid_request_error", "messages must be a non-empty list."),
        (chat_body(max_tokens=0), 400, "invalid_request_error", "max_tokens must be a positive integer."),
        (chat_body(temperature=3), 400, "invalid_request_error", "temperature must be between 0 and 2."),
        ({"messages": [{"role": "tool", "content": "x"}]}, 400, "invalid_request_error",
         "Message role must be system, user or assistant."),
    ],
)
def test_refusals(body: dict, status: int, kind: str, message: str) -> None:
    assert call(FakeEngine(), "POST", "/v1/chat/completions", body) == (
        status, {"error": {"message": message, "type": kind}}
    )


def test_context_limit_counts_prompt_plus_max_tokens() -> None:
    status, body = call(FakeEngine(prompt_tokens=4000), "POST", "/v1/chat/completions", chat_body(max_tokens=200))
    assert status == 400
    assert body == {"error": {
        "message": "The prompt is 4000 tokens; with max_tokens 200 that is 4200, above this server's "
                   "limit of 4096. Shorten the sequence.",
        "type": "context_length_exceeded",
    }}


def test_engine_failure_is_a_plain_sentence(caplog: pytest.LogCaptureFixture) -> None:
    class Broken(FakeEngine):
        def generate(self, request: ChatRequest) -> Generation:
            raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")

    with caplog.at_level(logging.INFO, logger="carbon"):
        status, body = call(Broken(), "POST", "/v1/chat/completions", chat_body())
    assert status == 500
    assert body == {"error": {"message": "Carbon-X could not answer this request. Try again or shorten it.",
                              "type": "server_error"}}
    assert "CUDA out of memory" in caplog.text  # the log keeps the cause
    assert DNA not in caplog.text  # but never the prompt


def test_bad_json_and_unknown_route() -> None:
    engine = FakeEngine()
    status, body = handle("POST", "/v1/chat/completions", b"{", engine, LIMITS, REVISION, threading.Lock())
    assert (status, body) == (400, {"error": {"message": "The request body is not valid JSON.",
                                              "type": "invalid_request_error"}})
    assert call(engine, "GET", "/v1/completions") == (404, {"error": {"message": "Not found.",
                                                                       "type": "not_found_error"}})


def test_log_likelihood_shape_and_validation() -> None:
    engine = FakeEngine()
    assert call(engine, "POST", "/v1/dna/log-likelihood", {"dna": "acgtac"}) == (200, {
        "object": "dna.log_likelihood",
        "model": "carbon-x",
        "log_likelihood": -42.5,
        "dna_tokens": 6,
        "usage": {"prompt_tokens": 8},
        "carbon": {"revision": REVISION, "latency_ms": 50, "peak_vram_bytes": 5_000_000_000},
    })
    assert call(engine, "POST", "/v1/dna/log-likelihood", {"dna": "ACGTN"}) == (
        400, {"error": {"message": "dna must contain only A, C, G and T.", "type": "invalid_request_error"}}
    )


def test_health_and_models() -> None:
    engine = FakeEngine()
    assert call(engine, "GET", "/health") == (200, {"status": "ok", "model": "carbon-x", "revision": REVISION})
    assert call(engine, "GET", "/v1/models") == (200, {
        "object": "list", "data": [{"id": "carbon-x", "object": "model", "owned_by": "local"}]
    })


def test_http_round_trip_on_loopback_only(caplog: pytest.LogCaptureFixture) -> None:
    server = make_server(FakeEngine(), LIMITS, REVISION, port=0)
    host, port = server.server_address[:2]
    assert (HOST, host) == ("127.0.0.1", "127.0.0.1")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/v1/chat/completions",
            data=json.dumps(chat_body(temperature=0)).encode(),
            headers={"Content-Type": "application/json"},
        )
        with caplog.at_level(logging.DEBUG, logger="carbon"):
            with urllib.request.urlopen(request, timeout=5) as response:
                body = json.load(response)
            with pytest.raises(urllib.error.HTTPError) as refused:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/nope", timeout=5)
        assert body["choices"][0]["message"] == {"role": "assistant", "content": "Pathogenic."}
        assert refused.value.code == 404
        assert DNA not in caplog.text
    finally:
        server.shutdown()
        server.server_close()
