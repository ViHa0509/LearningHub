"""Structured LLM log records: a message name plus a fixed set of fields, never secrets.

Records carry ids, types, model names, durations and error categories only: never a key,
a prompt, an answer or a provider error message (which may quote the request).
"""

import logging
from typing import Any

LOG = logging.getLogger("learninghub.llm")

FIELDS = ("agent_id", "provider_id", "provider_type", "model", "duration_ms", "category")


def event(name: str, level: int = logging.INFO, **fields: Any) -> None:
    extra: dict[str, Any] = dict.fromkeys(FIELDS)
    extra.update(
        {k: (str(v) if k.endswith("_id") and v is not None else v) for k, v in fields.items()}
    )
    LOG.log(level, name, extra=extra)
