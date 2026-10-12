/**
 * 方案库服务层：API 为主，未配置后端时回退 mock（UI 不因断网而废）。
 * 服务端行（snake_case）在这里统一映射为前端类型（camelCase）。
 */
import { API_BASE_URL, apiRequest, uploadFile } from "./api";
import * as mock from "../data/mockInspiration";
import type {
  Category,
  InspirationLink,
  LinkStatus,
  SaveDraft,
} from "../data/mockInspiration";

export type {
  Category,
  InspirationLink,
  LinkStatus,
  SaveDraft,
} from "../data/mockInspiration";
export { displayDate, displayDateTime, displayTitle, parseShareText, sourceLabel, statusLabel } from "../data/mockInspiration";

const hasApi = Boolean(API_BASE_URL);

interface LinkRow {
  id: string;
  url: string | null;
  title: string | null;
  summary: string | null;
  content: string | null;
  note: string | null;
  category_ids: string;
  shot_url: string | null;
  cover_url: string | null;
  source: string | null;
  status: LinkStatus;
  created_at: string;
  notes?: { id: string; body: string; created_at: string }[];
}

export interface InspirationNote {
  id: string;
  body: string;
  date: string;
}

const absUrl = (u: string): string =>
  u.startsWith("http") || !API_BASE_URL ? u : `${API_BASE_URL}${u}`;

const parseIds = (raw: string | null): string[] => {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

function mapLink(row: LinkRow): InspirationLink {
  return {
    id: row.id,
    url: row.url,
    note: row.note,
    title: row.title,
    summary: row.summary,
    categoryIds: parseIds(row.category_ids),
    shotPath: row.shot_url ? absUrl(row.shot_url) : null,
    coverUrl: row.cover_url ? absUrl(row.cover_url) : null,
    notes: (row.notes ?? []).map((n) => ({
      id: n.id,
      body: n.body,
      date: n.created_at.slice(0, 10),
    })),
    shotTint: null,
    source: row.source ?? "",
    status: row.status,
    date: row.created_at.slice(0, 10),
    createdAt: row.created_at,
  };
}

/* ===== 分类 ===== */

export async function listCategories(): Promise<Category[]> {
  if (!hasApi) return mock.listCategories();
  const data = await apiRequest<{ categories: Category[] }>("/api/categories");
  return data.categories;
}

export async function createCategory(name: string): Promise<Category> {
  if (!hasApi) return mock.addCategory(name);
  return apiRequest<Category>("/api/categories", {
    method: "POST",
    body: { name },
  });
}

export async function renameCategory(id: string, name: string): Promise<void> {
  if (!hasApi) return mock.renameCategory(id, name);
  await apiRequest(`/api/categories/${id}/update`, {
    method: "POST",
    body: { name },
  });
}

export async function deleteCategory(id: string): Promise<void> {
  if (!hasApi) return mock.deleteCategory(id);
  await apiRequest(`/api/categories/${id}`, { method: "DELETE" });
}

export async function moveCategory(id: string, dir: -1 | 1): Promise<void> {
  if (!hasApi) return mock.moveCategory(id, dir);
  await apiRequest(`/api/categories/${id}/move`, {
    method: "POST",
    body: { dir },
  });
}

/* ===== 方案 ===== */

export async function fetchLinks(): Promise<InspirationLink[]> {
  if (!hasApi) return mock.listLinks();
  const data = await apiRequest<{ links: LinkRow[] }>("/api/links");
  return data.links.map(mapLink);
}

export async function fetchLink(id: string): Promise<InspirationLink | null> {
  if (!hasApi) return mock.findLinkById(id);
  try {
    const row = await apiRequest<LinkRow>(`/api/links/${id}`);
    return mapLink(row);
  } catch {
    return null;
  }
}

export interface SaveResult {
  item: InspirationLink;
  duplicated: boolean;
}

/** 保存方案：有截图先上传换 URL；服务端按规范地址判重 */
export async function saveLink(
  draft: SaveDraft & { title: string | null },
): Promise<SaveResult> {
  if (!hasApi) {
    if (draft.url && mock.findLinkByUrl(draft.url)) {
      const existing = mock.findLinkByUrl(draft.url)!;
      return { item: existing, duplicated: true };
    }
    const item = mock.addLink(draft);
    return { item, duplicated: false };
  }
  let shotUrl: string | null = null;
  if (draft.shotPath) shotUrl = await uploadFile(draft.shotPath);
  const row = await apiRequest<LinkRow & { deduplicated?: boolean }>(
    "/api/links",
    {
      method: "POST",
      body: {
        url: draft.url,
        title: draft.title,
        note: draft.note,
        category_ids: draft.categoryIds,
        shot_url: shotUrl,
      },
    },
  );
  return { item: mapLink(row), duplicated: Boolean(row.deduplicated) };
}

/** 追加一条方案备注（时间线） */
export async function addNote(
  id: string,
  body: string,
): Promise<InspirationNote | null> {
  if (!hasApi) {
    return { id: `note-${Date.now()}`, body, date: new Date().toISOString().slice(0, 10) };
  }
  const note = await apiRequest<{
    id: string;
    body: string;
    created_at: string;
  }>(`/api/links/${id}/notes`, { method: "POST", body: { body } });
  return {
    id: note.id,
    body: note.body,
    date: note.created_at.slice(0, 10),
  };
}

/** 删除单条方案（服务端连带清备注） */
export async function deleteLink(id: string): Promise<void> {
  if (!hasApi) return mock.deleteLink(id);
  await apiRequest(`/api/links/${id}`, { method: "DELETE" });
}

/** 删除单条备注 */
export async function deleteNote(
  linkId: string,
  noteId: string,
): Promise<void> {
  if (!hasApi) return mock.deleteNote(linkId, noteId);
  await apiRequest(`/api/links/${linkId}/notes/${noteId}`, {
    method: "DELETE",
  });
}

export async function updateLink(
  id: string,
  patch: { note?: string | null; categoryIds?: string[] },
): Promise<InspirationLink | null> {
  if (!hasApi) {
    mock.updateLink(id, patch);
    return mock.findLinkById(id);
  }
  const row = await apiRequest<LinkRow>(`/api/links/${id}/update`, {
    method: "POST",
    body: { note: patch.note, category_ids: patch.categoryIds },
  });
  return mapLink(row);
}
