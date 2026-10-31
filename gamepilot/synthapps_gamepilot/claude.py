"""One place that talks to the Claude API, shared by the planner and game recognition."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

FALLBACK_BETA = "server-side-fallback-2026-07-01"


def make_client() -> Any:
    try:
        import anthropic  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("talking to Claude needs the SDK: pip install anthropic") from exc
    return anthropic.Anthropic()


def create_message(
    client: Any,
    *,
    model: str,
    effort: str,
    system: str,
    tools: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    use_fallbacks: bool = True,
    max_tokens: int = 16000,
    log: Callable[[str], None] = print,
    sleep: Callable[[float], None] = time.sleep,
) -> Any:
    """Send one Messages API request, retrying when the API is busy or unreachable."""
    # Newer request fields go in extra_body: older SDK releases reject them as keyword
    # arguments, but every release merges extra_body into the request as is.
    body: dict[str, Any] = {
        "output_config": {"effort": effort},
        "cache_control": {"type": "ephemeral"},
    }
    kwargs: dict[str, Any] = {}
    if use_fallbacks:
        # On a safety decline, the API re-runs the turn on Anthropic's recommended model.
        kwargs["betas"] = [FALLBACK_BETA]
        body["fallbacks"] = "default"

    def call() -> Any:
        return client.beta.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=[{"type": "text", "text": system}],
            tools=tools,
            tool_choice={"type": "auto"},
            messages=messages,
            extra_body=body,
            **kwargs,
        )

    try:
        import anthropic  # type: ignore[import-not-found]

        names = ("RateLimitError", "APIConnectionError", "InternalServerError", "OverloadedError")
        retryable: tuple[type[BaseException], ...] = tuple(
            getattr(anthropic, n) for n in names if hasattr(anthropic, n))
    except ImportError:
        retryable = ()
    for attempt in range(4):
        try:
            return call()
        except retryable as exc:  # the SDK already retried twice
            if attempt == 3:
                raise
            wait = 5.0 * (attempt + 1)
            log(f"API busy or unreachable ({type(exc).__name__}); retrying in {wait:.0f}s")
            sleep(wait)
    raise AssertionError("unreachable")


def get(obj: Any, name: str, default: Any = None) -> Any:
    """Read a field from an SDK object or a plain dict."""
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def usage_numbers(response: Any) -> tuple[int, int, int, int]:
    u = get(response, "usage")
    return (get(u, "input_tokens", 0) or 0, get(u, "output_tokens", 0) or 0,
            get(u, "cache_read_input_tokens", 0) or 0, get(u, "cache_creation_input_tokens", 0) or 0)
