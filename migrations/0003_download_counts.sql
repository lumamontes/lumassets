CREATE TABLE IF NOT EXISTS download_counts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
