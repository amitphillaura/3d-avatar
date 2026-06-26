PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  duration_ms REAL,
  fps REAL,
  width INTEGER,
  height INTEGER,
  frame_count INTEGER DEFAULT 0,
  source_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  rig_variant TEXT NOT NULL DEFAULT 'mushy',
  tracking_mode TEXT NOT NULL DEFAULT 'both',
  pipeline_version TEXT NOT NULL DEFAULT 'poseSkeleton@v1',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS video_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  tag_type TEXT NOT NULL,
  tag_value TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  source TEXT NOT NULL DEFAULT 'human',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  start_frame INTEGER NOT NULL,
  end_frame INTEGER NOT NULL,
  start_ms REAL NOT NULL,
  end_ms REAL NOT NULL,
  label TEXT,
  description TEXT,
  motion_type TEXT,
  word_prompt TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  matrix_status TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS frames (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  frame_index INTEGER NOT NULL,
  timestamp_ms REAL NOT NULL,
  detection_state TEXT NOT NULL DEFAULT 'none',
  has_body INTEGER NOT NULL DEFAULT 0,
  has_face INTEGER NOT NULL DEFAULT 0,
  has_left_hand INTEGER NOT NULL DEFAULT 0,
  has_right_hand INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (video_id, frame_index)
);

CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_segments_video ON segments(video_id);
CREATE INDEX IF NOT EXISTS idx_segments_word ON segments(word_prompt);
CREATE INDEX IF NOT EXISTS idx_video_tags_video ON video_tags(video_id);
CREATE INDEX IF NOT EXISTS idx_frames_video ON frames(video_id);
