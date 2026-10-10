// 迁移语句逐条执行，全部幂等（IF NOT EXISTS）。
export const statements = [
  `CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT '准备',
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS entries_date_idx ON entries(date)`,

  // 第三方链接（小红书文章等）。status 即处理队列状态，由 Agent 消费。
  `CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    content TEXT,
    cover_url TEXT,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS links_url_idx ON links(url)`,
  `CREATE INDEX IF NOT EXISTS links_status_idx ON links(status)`,

  // 上传文件的元数据；内容落盘在 DATA_DIR/files/<id><ext>
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    ext TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

export type EntryRow = {
  id: string;
  title: string;
  body: string;
  stage: string;
  date: string;
  created_at: string;
  updated_at: string;
};

export type LinkRow = {
  id: string;
  url: string;
  title: string | null;
  summary: string | null;
  content: string | null;
  cover_url: string | null;
  source: string | null;
  status: "pending" | "processing" | "done" | "failed";
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type FileRow = {
  id: string;
  filename: string;
  ext: string;
  mime_type: string;
  size: number;
  created_at: string;
};
