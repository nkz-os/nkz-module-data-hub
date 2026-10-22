"""
Structured JSON logging for the DataHub BFF.

Why this module: tracking down the multi-hour debugging session for the
DataHub panel required correlating UI events with backend traffic. With the
current `print(...)` calls and unstructured `logging.info(...)` lines, that
correlation was practically impossible. Structured JSON + a request_id
contextvar fixes both.

Usage:

    from app.common.logging_setup import get_logger, request_id_var, tenant_id_var

    log = get_logger(__name__)
    log.info("timeseries_request", extra={"entity_id": ..., "ts_len": ...})

The logger emits one JSON line per record. Standard fields:

    timestamp, level, logger, message, request_id, tenant_id, ...extra

Contextvars are set by RequestIdMiddleware (request_id, tenant_id) and read
by the JSON formatter on every record automatically.
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

# Contextvars set by RequestIdMiddleware; read by the formatter on every emit.
request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "datahub_request_id", default=None
)
tenant_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "datahub_tenant_id", default=None
)


class JsonFormatter(logging.Formatter):
    """Render LogRecord as a single-line JSON document."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        rid = request_id_var.get()
        tid = tenant_id_var.get()
        if rid:
            payload["request_id"] = rid
        if tid:
            payload["tenant_id"] = tid

        # Surface extra={} fields. LogRecord stores them as direct attributes,
        # so we filter against the well-known LogRecord attribute set.
        reserved = {
            "name", "msg", "args", "levelname", "levelno", "pathname",
            "filename", "module", "exc_info", "exc_text", "stack_info",
            "lineno", "funcName", "created", "msecs", "relativeCreated",
            "thread", "threadName", "processName", "process", "message",
            "taskName",
        }
        for key, value in record.__dict__.items():
            if key in reserved:
                continue
            if key.startswith("_"):
                continue
            try:
                json.dumps(value)
                payload[key] = value
            except (TypeError, ValueError):
                payload[key] = repr(value)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


_initialized = False


def setup_logging(level: str = "INFO") -> None:
    """Idempotent: configures root logger once with the JSON formatter on stdout."""
    global _initialized
    if _initialized:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    # Replace any pre-existing handlers (e.g. uvicorn defaults).
    root.handlers = [handler]
    root.setLevel(level.upper())
    # Quiet down very verbose third-party loggers.
    for noisy in ("uvicorn.access", "asyncio", "httpcore"):
        logging.getLogger(noisy).setLevel("WARNING")
    _initialized = True


def get_logger(name: str) -> logging.Logger:
    """Return a logger; set up structured logging on first call."""
    setup_logging()
    return logging.getLogger(name)
