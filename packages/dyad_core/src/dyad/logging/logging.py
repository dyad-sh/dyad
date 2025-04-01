import logging
import os
from datetime import datetime

import colorlog
from sqlalchemy import delete
from sqlmodel import Field, Session, SQLModel

from dyad.logging.logs_sql_engine import engine


class LogEntry(SQLModel, table=True):
    id: int = Field(default=None, primary_key=True)

    timestamp: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    level: str
    message: str
    module: str


class SQLiteHandler(logging.Handler):
    """
    Custom logging handler that writes log messages to an SQLite database using SQLModel.
    """

    def __init__(self):
        SQLModel.metadata.create_all(engine)
        logging.Handler.__init__(self)

    def emit(self, record):
        """
        Insert a log record into the SQLite database using SQLModel.
        """
        # Interpolate the args into the message
        message = record.msg % record.args if record.args else record.msg

        log_entry = LogEntry(
            level=record.levelname,
            message=message,
            module=record.module,
        )
        with Session(engine) as session:
            session.add(log_entry)
            session.commit()


def setup_logging():
    console_level = logging.INFO
    if os.environ.get("DYAD_LOG_LEVELS"):
        if os.environ["DYAD_LOG_LEVELS"] not in [
            "DEBUG",
            "INFO",
            "WARNING",
            "ERROR",
            "CRITICAL",
        ]:
            raise ValueError(
                "Invalid log level. Must be one of DEBUG, INFO, WARNING, ERROR, CRITICAL."
            )
        if os.environ["DYAD_LOG_LEVELS"] == "DEBUG":
            console_level = logging.DEBUG
        elif os.environ["DYAD_LOG_LEVELS"] == "INFO":
            console_level = logging.INFO
        elif os.environ["DYAD_LOG_LEVELS"] == "WARNING":
            console_level = logging.WARNING
        elif os.environ["DYAD_LOG_LEVELS"] == "ERROR":
            console_level = logging.ERROR
        elif os.environ["DYAD_LOG_LEVELS"] == "CRITICAL":
            console_level = logging.CRITICAL

    logger = logging.getLogger("dyad")
    logger.setLevel(logging.DEBUG)

    # Create console handler for displaying logs on the console
    console_handler = logging.StreamHandler()
    console_handler.setLevel(console_level)

    # Create the SQLite handler
    sqlite_handler = SQLiteHandler()
    sqlite_handler.setLevel(logging.DEBUG)

    # Colorful formatter for console output
    color_formatter = colorlog.ColoredFormatter(
        "%(log_color)s%(levelname).1s|%(asctime)s.%(msecs)03d|%(message)s",
        datefmt="%H:%M",
        log_colors={
            "DEBUG": "white",
            "INFO": "cyan",
            "WARNING": "yellow",
            "ERROR": "red",
            "CRITICAL": "red,bg_white",
        },
    )
    console_handler.setFormatter(color_formatter)
    sqlite_formatter = logging.Formatter("%(message)s")
    sqlite_handler.setFormatter(sqlite_formatter)

    # Add handlers to the logger
    logger.addHandler(console_handler)
    logger.addHandler(sqlite_handler)
    logger.propagate = False

    global _logger
    _logger = logger
    return logger


def get_recent_logs(limit=100) -> list[LogEntry]:
    """
    Retrieve the most recent log entries from the SQLite database.

    Args:
        limit (int): The maximum number of log entries to retrieve. Defaults to 100.

    Returns:
        list: A list of LogEntry objects representing the most recent log entries.
    """
    with Session(engine) as session:
        recent_logs = (
            session.query(LogEntry)
            .order_by(LogEntry.timestamp.desc())  # type: ignore
            .limit(limit)
            .all()
        )
        return recent_logs


def clear_logs():
    """
    Clear all log entries from the database.
    """
    with Session(engine) as session:
        session.execute(delete(LogEntry))
        session.commit()


_logger = None


def logger():
    global _logger
    if _logger is None:
        _logger = setup_logging()
    return _logger
