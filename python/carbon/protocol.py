"""The sidecar's HTTP contract, without torch: request parsing, response shapes, errors.

Kept apart from `engine.py` so the shape can be tested with a fake engine and no GPU.
Nothing here logs or echoes request content; DNA in a prompt can be personal data.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

MODEL_ID = "carbon-x"
MAX_BODY_BYTES = 2_000_000
ROLES = frozenset({"system", "user", "assistant"})
DNA_BASES = frozenset("ACGT")


class RequestError(Exception):
    """A request the sidecar refuses. `message` is safe to show to a person."""

    def __init__(self, status: int, message: str, kind: str = "invalid_request_error"):
        super().__init__(message)
        self.status = status
        self.message = message
        self.kind = kind


@dataclass(frozen=True)
class Message:
    role: str
    content: str


@dataclass(frozen=True)
class ChatRequest:
    messages: tuple[Message, ...]
    max_tokens: int
    temperature: float
    top_p: float
    top_k: int
    seed: int | None
    enable_thinking: bool


@dataclass(frozen=True)
class Generation:
    text: str
    prompt_tokens: int
    completion_tokens: int
    finish_reason: str  # "stop" or "length"
    latency_ms: int
    peak_vram_bytes: int


@dataclass(frozen=True)
class LogLikelihood:
    log_likelihood: float
    dna_tokens: int
    prompt_tokens: int
    latency_ms: int
    peak_vram_bytes: int


@dataclass(frozen=True)
class Limits:
    max_context: int
    default_max_tokens: int


class Engine(Protocol):
    def count_prompt_tokens(self, request: ChatRequest) -> int: ...

    def generate(self, request: ChatRequest) -> Generation: ...

    def log_likelihood(self, dna: str) -> LogLikelihood: ...

    def health(self) -> dict[str, Any]: ...


def _number(body: dict[str, Any], key: str, default: float, low: float, high: float) -> float:
    value = body.get(key, default)
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RequestError(400, f"{key} must be a number.")
    if not low <= value <= high:
        raise RequestError(400, f"{key} must be between {low:g} and {high:g}.")
    return float(value)


def _message(raw: object) -> Message:
    if not isinstance(raw, dict):
        raise RequestError(400, "Each message must be an object with role and content.")
    role, content = raw.get("role"), raw.get("content")
    if role not in ROLES:
        raise RequestError(400, "Message role must be system, user or assistant.")
    if isinstance(content, list):
        # OpenAI content parts: keep text parts only.
        texts = [p.get("text") for p in content if isinstance(p, dict) and p.get("type") == "text"]
        if not all(isinstance(t, str) for t in texts) or not texts:
            raise RequestError(400, "Message content must be text.")
        content = "".join(texts)
    if not isinstance(content, str):
        raise RequestError(400, "Message content must be text.")
    return Message(role=role, content=content)


def parse_chat_request(body: object, limits: Limits) -> ChatRequest:
    """Validate an OpenAI chat-completions body. Streaming, tools and n>1 are refused."""
    if not isinstance(body, dict):
        raise RequestError(400, "The request body must be a JSON object.")
    model = body.get("model", MODEL_ID)
    if model != MODEL_ID:
        raise RequestError(404, f"Unknown model. This server serves {MODEL_ID!r}.", "not_found_error")
    if body.get("stream"):
        raise RequestError(400, "Streaming is not supported.")
    if body.get("tools"):
        raise RequestError(400, "Tool calling is not supported.")
    if body.get("n", 1) != 1:
        raise RequestError(400, "Only n=1 is supported.")
    raw_messages = body.get("messages")
    if not isinstance(raw_messages, list) or not raw_messages:
        raise RequestError(400, "messages must be a non-empty list.")
    messages = tuple(_message(m) for m in raw_messages)
    if messages[-1].role != "user":
        raise RequestError(400, "The last message must come from the user.")

    max_tokens = body.get("max_tokens", body.get("max_completion_tokens", limits.default_max_tokens))
    if isinstance(max_tokens, bool) or not isinstance(max_tokens, int) or max_tokens < 1:
        raise RequestError(400, "max_tokens must be a positive integer.")
    if max_tokens >= limits.max_context:
        raise RequestError(400, f"max_tokens must be below the context limit of {limits.max_context}.")

    seed = body.get("seed")
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int)):
        raise RequestError(400, "seed must be an integer.")

    template_kwargs = body.get("chat_template_kwargs") or {}
    if not isinstance(template_kwargs, dict):
        raise RequestError(400, "chat_template_kwargs must be an object.")
    enable_thinking = template_kwargs.get("enable_thinking", False)
    if not isinstance(enable_thinking, bool):
        raise RequestError(400, "enable_thinking must be true or false.")

    # Model-card defaults (generation_config.json): temperature 0.6, top-p 0.95, top-k 20.
    # temperature 0 means greedy decoding, which is deterministic.
    return ChatRequest(
        messages=messages,
        max_tokens=max_tokens,
        temperature=_number(body, "temperature", 0.6, 0.0, 2.0),
        top_p=_number(body, "top_p", 0.95, 0.0, 1.0),
        top_k=int(_number(body, "top_k", 20, 0, 1000)),
        seed=seed,
        enable_thinking=enable_thinking,
    )


def check_context(prompt_tokens: int, request: ChatRequest, limits: Limits) -> None:
    total = prompt_tokens + request.max_tokens
    if total > limits.max_context:
        raise RequestError(
            400,
            f"The prompt is {prompt_tokens} tokens; with max_tokens {request.max_tokens} that is "
            f"{total}, above this server's limit of {limits.max_context}. Shorten the sequence.",
            "context_length_exceeded",
        )


def parse_dna(body: object, limits: Limits) -> str:
    if not isinstance(body, dict) or not isinstance(body.get("dna"), str):
        raise RequestError(400, "Send {\"dna\": \"ACGT...\"}.")
    dna = body["dna"].strip().upper()
    if not dna or not set(dna) <= DNA_BASES:
        raise RequestError(400, "dna must contain only A, C, G and T.")
    if (len(dna) + 5) // 6 + 2 > limits.max_context:
        raise RequestError(400, "The sequence is longer than this server's context.", "context_length_exceeded")
    return dna


def chat_response(request_id: str, created: int, generation: Generation, revision: str) -> dict[str, Any]:
    return {
        "id": request_id,
        "object": "chat.completion",
        "created": created,
        "model": MODEL_ID,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": generation.text},
                "finish_reason": generation.finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": generation.prompt_tokens,
            "completion_tokens": generation.completion_tokens,
            "total_tokens": generation.prompt_tokens + generation.completion_tokens,
        },
        "carbon": {
            "revision": revision,
            "latency_ms": generation.latency_ms,
            "peak_vram_bytes": generation.peak_vram_bytes,
        },
    }


def log_likelihood_response(result: LogLikelihood, revision: str) -> dict[str, Any]:
    return {
        "object": "dna.log_likelihood",
        "model": MODEL_ID,
        "log_likelihood": result.log_likelihood,
        "dna_tokens": result.dna_tokens,
        "usage": {"prompt_tokens": result.prompt_tokens},
        "carbon": {
            "revision": revision,
            "latency_ms": result.latency_ms,
            "peak_vram_bytes": result.peak_vram_bytes,
        },
    }


def models_response() -> dict[str, Any]:
    return {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "local"}]}


def error_body(message: str, kind: str) -> dict[str, Any]:
    return {"error": {"message": message, "type": kind}}
