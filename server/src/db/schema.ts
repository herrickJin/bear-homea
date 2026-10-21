// 迁移语句逐条执行，全部幂等（IF NOT EXISTS）。

// 链接型方案有 url；纯想法 url 为 NULL（note 即正文）。
// 注意：SQLite 的 UNIQUE 索引允许多个 NULL，想法型方案不会互相冲突。
export const LINKS_DDL = `CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    url TEXT,
    title TEXT,
    summary TEXT,
    content TEXT,
    cover_url TEXT,
    note TEXT,
    category_ids TEXT NOT NULL DEFAULT '[]',
    shot_url TEXT,
    shot_urls TEXT NOT NULL DEFAULT '[]',
    source TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;

export const statements = [
  `CREATE TABLE IF NOT EXISTS preparation_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    revision INTEGER NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
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

  // 方案库（小红书链接 / 纯想法）。status 即处理队列状态，由 Agent 消费。
  LINKS_DDL,
  `CREATE UNIQUE INDEX IF NOT EXISTS links_url_idx ON links(url)`,
  `CREATE INDEX IF NOT EXISTS links_status_idx ON links(status)`,

  // 方案分类（用户自建 + 预置起步分类）
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO categories (id, name, sort, created_at) VALUES
    ('cat-all',      '全屋',   0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('cat-living',   '客厅',   1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('cat-kitchen',  '厨房',   2, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('cat-bedroom',  '卧室',   3, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('cat-bath',     '卫生间', 4, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('cat-balcony',  '阳台',   5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('cat-ceiling',  '吊顶',   6, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('cat-storage',  '收纳',   7, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,

  // 方案备注（多条时间线）：与设计师讨论的要点可以一直追加
  `CREATE TABLE IF NOT EXISTS link_notes (
    id TEXT PRIMARY KEY,
    link_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS link_notes_link_idx ON link_notes(link_id, created_at)`,

  // 上传文件的元数据；内容落盘在 DATA_DIR/files/<id><ext>
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    ext TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,

  // AI 助手会话（/api/chat）。context 存发起页注入的客户端上下文 JSON（当前页/选中条目）
  `CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    context TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // 会话消息。role=tool 的消息由 assistant 的 tool_calls 触发，
  // tool_call_id / name 对应 OpenAI 工具调用协议；content 统一存文本。
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content TEXT NOT NULL DEFAULT '',
    tool_calls TEXT,
    tool_call_id TEXT,
    name TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages(session_id, created_at)`,
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
  url: string | null;
  title: string | null;
  summary: string | null;
  content: string | null;
  note: string | null;
  category_ids: string;
  shot_url: string | null;
  shot_urls?: string;
  cover_url: string | null;
  source: string | null;
  status: "pending" | "processing" | "done" | "failed";
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type CategoryRow = {
  id: string;
  name: string;
  sort: number;
  created_at: string;
};

export type LinkNoteRow = {
  id: string;
  link_id: string;
  body: string;
  created_at: string;
};

export type FileRow = {
  id: string;
  filename: string;
  ext: string;
  mime_type: string;
  size: number;
  created_at: string;
};

export type ChatSessionRow = {
  id: string;
  title: string;
  context: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatMessageRow = {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  name: string | null;
  created_at: string;
};
