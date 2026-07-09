import logging

import structlog


def configure_logging(log_level: str = "INFO") -> None:
    """Configure structlog for JSON structured stdout logging.

    Uses structlog-NATIVE processors only. The previous version referenced
    ``structlog.stdlib.add_logger_name`` with a ``PrintLoggerFactory`` (not a
    stdlib logger), which raised ``AttributeError`` the moment it was called —
    so structured logging was never actually wired. This version is safe to call
    at startup and is idempotent.
    """
    level = getattr(logging, str(log_level).upper(), logging.INFO)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "agent") -> structlog.BoundLogger:
    return structlog.get_logger(name)
