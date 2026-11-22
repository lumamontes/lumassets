-- The wall: shared compositions. Images live in the private R2 bucket at wall/<id>.png.
CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  author     TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
  created_at TEXT NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_status_created ON posts (status, created_at DESC);
