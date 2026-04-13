import sqlite3
import os
from contextlib import contextmanager

DB_PATH = os.path.join(os.path.dirname(__file__), "notebook.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db_conn():
    """Context manager that guarantees the SQLite connection is closed, even
    on exceptions. Use this in every request handler so failed downloads,
    transcriptions, and HTTP calls don't leak connections."""
    conn = get_db()
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS notebooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            notebook_id INTEGER NOT NULL DEFAULT 1,
            name TEXT NOT NULL,
            notes TEXT DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_id INTEGER NOT NULL,
            source_url TEXT,
            video_path TEXT,
            video_title TEXT,
            thumbnail_path TEXT,
            notes TEXT DEFAULT '',
            transcript TEXT DEFAULT '',
            summary TEXT DEFAULT '',
            tags TEXT DEFAULT '',
            language TEXT DEFAULT '',
            sentiment TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
        );
    """)

    # Migrations for existing databases
    cursor = conn.execute("PRAGMA table_info(chapters)")
    columns = [row[1] for row in cursor.fetchall()]
    if "notes" not in columns:
        conn.execute("ALTER TABLE chapters ADD COLUMN notes TEXT DEFAULT ''")
    if "notebook_id" not in columns:
        conn.execute("ALTER TABLE chapters ADD COLUMN notebook_id INTEGER NOT NULL DEFAULT 1")
    if "sort_order" not in columns:
        conn.execute("ALTER TABLE chapters ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        # Set initial sort_order based on existing created_at order
        rows = conn.execute("SELECT id FROM chapters ORDER BY created_at").fetchall()
        for i, row in enumerate(rows):
            conn.execute("UPDATE chapters SET sort_order = ? WHERE id = ?", (i, row[0]))

    # Migration: add transcript column to entries
    cursor = conn.execute("PRAGMA table_info(entries)")
    entry_columns = [row[1] for row in cursor.fetchall()]
    if "transcript" not in entry_columns:
        conn.execute("ALTER TABLE entries ADD COLUMN transcript TEXT DEFAULT ''")
    if "summary" not in entry_columns:
        conn.execute("ALTER TABLE entries ADD COLUMN summary TEXT DEFAULT ''")
    if "tags" not in entry_columns:
        conn.execute("ALTER TABLE entries ADD COLUMN tags TEXT DEFAULT ''")
    if "language" not in entry_columns:
        conn.execute("ALTER TABLE entries ADD COLUMN language TEXT DEFAULT ''")
    if "sentiment" not in entry_columns:
        conn.execute("ALTER TABLE entries ADD COLUMN sentiment TEXT DEFAULT ''")

    # Ensure at least one notebook exists
    row = conn.execute("SELECT COUNT(*) as cnt FROM notebooks").fetchone()
    if row["cnt"] == 0:
        conn.execute("INSERT INTO notebooks (name) VALUES ('My Notebook')")

    conn.commit()
    conn.close()
