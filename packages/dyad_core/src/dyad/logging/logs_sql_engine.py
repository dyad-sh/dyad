import os

from sqlalchemy import create_engine
from sqlmodel import text

from dyad.workspace_util import get_workspace_storage_dir

storage_dir = get_workspace_storage_dir()
os.makedirs(storage_dir, exist_ok=True)
db_path = os.path.join(storage_dir, "logs.db")
engine = create_engine(f"sqlite:///{db_path}")

with engine.connect() as conn:
    # see: https://briandouglas.ie/sqlite-defaults/
    conn.execute(
        text("PRAGMA journal_mode=WAL")
    )  # allow concurrent reads & writes
    conn.execute(text("PRAGMA synchronous=NORMAL"))  # editorer writes
    conn.execute(text("PRAGMA cache_size=-64000"))  # 64 MB cache
    conn.execute(text("PRAGMA foreign_keys=ON"))
    conn.execute(text("PRAGMA auto_vacuum = INCREMENTAL"))
