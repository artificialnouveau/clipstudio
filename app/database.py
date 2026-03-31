import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "notebook.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


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

    # Ensure at least one notebook exists
    row = conn.execute("SELECT COUNT(*) as cnt FROM notebooks").fetchone()
    if row["cnt"] == 0:
        conn.execute("INSERT INTO notebooks (name) VALUES ('My Notebook')")

    conn.commit()
    conn.close()
