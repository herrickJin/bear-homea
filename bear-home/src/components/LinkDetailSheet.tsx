import { useEffect, useState } from "react";
import Taro from "@tarojs/taro";
import { Button, Image, Text, Textarea, View } from "@tarojs/components";
import { Plus, X } from "./Icons";
import * as inspiration from "../services/inspiration";
import type { Category, InspirationLink } from "../services/inspiration";
import {
  displayDate,
  displayTitle,
  sourceLabel,
  statusLabel,
} from "../data/mockInspiration";

interface LinkDetailSheetProps {
  link: InspirationLink;
  categories: Category[];
  onClose: () => void;
  /** 详情内编辑（要点/标签）后回传列表，保持两侧同步 */
  onChange: (link: InspirationLink) => void;
}

/** 方案详情：小红书笔记详情式覆盖层。原地渲染在列表页上，不走路由。
 *  桌面 = 暗背景 + 居中 sheet（点背景/X/ESC 关闭）；手机 = 全屏页。 */
export default function LinkDetailSheet({
  link: initial,
  categories,
  onClose,
  onChange,
}: LinkDetailSheetProps) {
  const [link, setLink] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  // 宽屏 sheet 定高 contain（aspectFit）；窄屏/小程序自然高度（widthFix，
  // H5 的 aspectFit 内层 img 是绝对定位，容器 height:auto 会塌成 0）
  const [isWide, setIsWide] = useState(process.env.TARO_ENV !== "h5");

  useEffect(() => {
    setLink(initial);
    setEditing(false);
    setAddingTag(false);
    setNoteDraft("");
  }, [initial.id]);

  // 打开时补拉一次，拿备注时间线（列表接口不带）
  useEffect(() => {
    let alive = true;
    inspiration.fetchLink(initial.id).then((full) => {
      if (alive && full) setLink(full);
    });
    return () => {
      alive = false;
    };
  }, [initial.id]);

  // ESC 关闭（编译期裁剪，小程序不受影响）
  useEffect(() => {
    if (process.env.TARO_ENV !== "h5") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (process.env.TARO_ENV !== "h5") return;
    const update = () => setIsWide(window.innerWidth > 700);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const current = link;
  const shot = current.shotPath ?? current.coverUrl;
  const tags = categories.filter((c) => current.categoryIds.includes(c.id));
  const available = categories.filter(
    (c) => !current.categoryIds.includes(c.id),
  );
  const status = statusLabel(current.status);
  const title = displayTitle(current);

  function apply(next: InspirationLink | null) {
    if (!next) return;
    setLink(next);
    onChange(next);
  }

  function startEdit() {
    setDraftNote(current.note ?? "");
    setEditing(true);
  }

  async function saveNote() {
    const next = await inspiration.updateLink(current.id, {
      note: draftNote.trim() || null,
    });
    apply(next);
    setEditing(false);
  }

  async function addNote() {
    const body = noteDraft.trim();
    if (!body) return;
    const note = await inspiration.addNote(current.id, body);
    if (note) {
      apply({ ...current, notes: [...(current.notes ?? []), note] });
    }
    setNoteDraft("");
  }

  async function toggleTag(id: string) {
    const categoryIds = current.categoryIds.includes(id)
      ? current.categoryIds.filter((v) => v !== id)
      : [...current.categoryIds, id];
    const next = await inspiration.updateLink(current.id, { categoryIds });
    apply(next);
    setAddingTag(false);
  }

  function copyLink() {
    if (!current.url) return;
    Taro.setClipboardData({ data: current.url }).then(() =>
      Taro.showToast({ title: "链接已复制，去小红书打开", icon: "none" }),
    );
  }

  return (
    <View className="ui-div detail-overlay">
      <View className="detail-backdrop" onClick={onClose} />
      <View className={`ui-div detail-sheet${shot ? "" : " no-media"}`}>
        <Button
          ariaRole="button"
          ariaLabel="关闭"
          className="ui-button detail-close"
          onClick={onClose}
        >
          <X size={15} tone="muted" />
        </Button>
        {shot && (
          <View className="ui-div detail-media">
            <Image
              className="detail-shot"
              src={shot}
              mode={isWide ? "aspectFit" : "widthFix"}
            />
          </View>
        )}
        <View className="ui-div detail-body">
          <View className="ui-div detail-scroll">
            <View className="ui-div detail-author-row">
              <Text className="detail-author">
                {sourceLabel(current.source)}
                {status ? ` · ${status}` : ""}
              </Text>
              {current.url &&
                (process.env.TARO_ENV === "h5" ? (
                  <a
                    className="ui-button primary detail-open-btn"
                    href={current.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开原文 ↗
                  </a>
                ) : (
                  <Button
                    ariaRole="button"
                    className="ui-button primary detail-open-btn"
                    onClick={copyLink}
                  >
                    打开原文 ↗
                  </Button>
                ))}
            </View>

            {editing ? (
              <View className="ui-div detail-edit">
                <Textarea
                  className="field-textarea"
                  value={draftNote}
                  placeholder="记一句要点，方便以后找"
                  placeholderClass="search-placeholder"
                  maxlength={200}
                  onInput={(e) => setDraftNote(e.detail.value)}
                />
                <View className="ui-div detail-edit-actions">
                  <Button
                    ariaRole="button"
                    className="ui-button field-action"
                    onClick={() => setEditing(false)}
                  >
                    取消
                  </Button>
                  <Button
                    ariaRole="button"
                    className="ui-button primary"
                    onClick={saveNote}
                  >
                    保存
                  </Button>
                </View>
              </View>
            ) : (
              <View className="ui-a detail-note-row" onClick={startEdit}>
                <View className="ui-h3 detail-note">{title}</View>
                <Text className="ui-span detail-edit-hint">编辑</Text>
              </View>
            )}

            {current.summary && (
              <View className="ui-p detail-summary">{current.summary}</View>
            )}

            <View className="ui-div detail-tags">
              {tags.map((t) => (
                <Button
                  ariaRole="button"
                  key={t.id}
                  className="ui-button tag-chip tag-removable"
                  onClick={() => toggleTag(t.id)}
                >
                  {t.name} <X size={11} tone="green" />
                </Button>
              ))}
              {addingTag ? (
                available.map((c) => (
                  <Button
                    ariaRole="button"
                    key={c.id}
                    className="ui-button chip"
                    onClick={() => toggleTag(c.id)}
                  >
                    <Plus size={11} tone="green" /> {c.name}
                  </Button>
                ))
              ) : (
                <Button
                  ariaRole="button"
                  className="ui-button chip chip-add"
                  onClick={() => setAddingTag(true)}
                >
                  <Plus size={11} tone="green" /> 添加
                </Button>
              )}
            </View>

            <Text className="detail-date">{displayDate(current.date)}</Text>

            <View className="detail-divider" />

            <View className="ui-div detail-notes">
              <View className="ui-div section-heading">
                <Text className="ui-h2">
                  共 {(link.notes ?? []).length} 条备注
                </Text>
              </View>
              {(link.notes ?? []).map((n) => (
                <View className="ui-div note-item" key={n.id}>
                  <View className="ui-p note-body">{n.body}</View>
                  <Text className="ui-time note-date">{n.date}</Text>
                </View>
              ))}
              {(link.notes ?? []).length === 0 && (
                <View className="ui-p note-empty">
                  和设计师聊完，把结论记在这里。
                </View>
              )}
            </View>
          </View>

          <View className="ui-div note-add">
            <View className="ui-div note-box">
              <Textarea
                className="note-input"
                value={noteDraft}
                placeholder="补充一条备注…"
                placeholderClass="search-placeholder"
                maxlength={500}
                autoHeight
                onInput={(e) => setNoteDraft(e.detail.value)}
              />
              <Button
                ariaRole="button"
                className={`ui-button ${`primary note-send${noteDraft.trim() ? "" : " disabled"}`}`}
                disabled={!noteDraft.trim()}
                onClick={addNote}
              >
                发送
              </Button>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
