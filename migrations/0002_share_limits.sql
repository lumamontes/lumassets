-- Per-window keyed digests, with no raw visitor addresses.
CREATE TABLE IF NOT EXISTS share_limits (
  window_start INTEGER NOT NULL,
  client TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (window_start, client)
) WITHOUT ROWID;
