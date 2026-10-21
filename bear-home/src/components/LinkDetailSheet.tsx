import { useEffect, useState } from "react";
import Taro from "@tarojs/taro";
import { Button, Image, Swiper, SwiperItem, Text, Textarea, View } from "@tarojs/components";
import { ArrowUp, Plus, X } from "./Icons";
import SheetHeader from "./SheetHeader";
import useSheetMotion from "../hooks/useSheetMotion";
import useSwipeBack from "../hooks/useSwipeBack";
import * as inspiration from "../services/inspiration";
import type { Category, InspirationLink } from "../services/inspiration";
import {
  displayDate,
  displayDateTime,
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
  /** 方案被删除后通知外层（移出列表并关闭弹层） */
  onDeleted: (id: string) => void;
}

/** 方案详情：桌面在列表上显示居中覆盖层；手机路由使用同一组件显示全屏页。
 *  手机支持横滑返回，桌面支持背景/X/ESC 关闭。 */
export default function LinkDetailSheet({
  link: initial,
  categories,
  onClose,
  onChange,
  onDeleted,
}: LinkDetailSheetProps) {
  const [link, setLink] = useState(initial);
  const [imageIndex, setImageIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  // 宽屏图区 cover 填满不露黑边；窄屏/小程序自然高度（widthFix，
  // H5 的 aspectFit 内层 img 是绝对定位，容器 height:auto 会塌成 0）
  const [isWide, setIsWide] = useState(() => process.env.TARO_ENV === "h5" && window.innerWidth > 1099);
  const requestBack = useSwipeBack(onClose, editing || Boolean(noteDraft.trim()));
  const { entered, requestClose } = useSheetMotion(true, requestBack, process.env.TARO_ENV !== "h5" || isWide);

  useEffect(() => {
    setLink(initial);
    setImageIndex(0);
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

  useEffect(() => {
    if (process.env.TARO_ENV !== "h5") return;
    // 断点与 CSS 详情全屏断点（1099）一致：全屏页用自然高度图
    const update = () => setIsWide(window.innerWidth > 1099);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const current = link;
  const shots = current.shotPaths?.length ? current.shotPaths
    : current.shotPath ? [current.shotPath] : current.coverUrl ? [current.coverUrl] : [];
  const shot = shots[imageIndex] ?? shots[0];
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

  function confirmDelete() {
    Taro.showModal({
      title: "删除这条笔记？",
      content: "删除后不可恢复",
      confirmText: "删除",
      confirmColor: "#cf7f63",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await inspiration.deleteLink(current.id);
          Taro.showToast({ title: "已删除", icon: "none" });
          onDeleted(current.id);
        } catch {
          Taro.showToast({ title: "没删成，请稍后再试", icon: "none" });
        }
      },
    });
  }

  async function removeNote(noteId: string) {
    try {
      await inspiration.deleteNote(current.id, noteId);
      apply({
        ...current,
        notes: (current.notes ?? []).filter((n) => n.id !== noteId),
      });
    } catch {
      Taro.showToast({ title: "没删成，请稍后再试", icon: "none" });
    }
  }

  return (
    <View className={`ui-div detail-overlay${entered ? " is-entered" : ""}`}>
      <View className="detail-backdrop" onClick={requestClose} />
      {process.env.TARO_ENV === "h5" && <View id="note-back-edge" className="detail-back-edge" ariaHidden />}
      <View id="note-detail-sheet" className={`ui-div detail-sheet${shot ? "" : " no-media"}`}>
        <SheetHeader
          title={`${sourceLabel(current.source)}${status ? ` · ${status}` : ""}`}
          onClose={requestClose}
          action={current.url ? (process.env.TARO_ENV === "h5" ? (
                <a
                  className="ui-button detail-open-btn"
                  href={current.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开原文 ↗
                </a>
              ) : (
                <Button
                  ariaRole="button"
                  className="ui-button detail-open-btn"
                  onClick={copyLink}
                >
                  打开原文 ↗
                </Button>
              )) : undefined}
        />
        <View className="ui-div detail-layout">
          {shot && (
          <View className="ui-div detail-media">
              {!isWide && shots.length > 1 ? (
                <Swiper
                  className="detail-image-swiper"
                  current={imageIndex}
                  duration={300}
                  onChange={event => setImageIndex(event.detail.current)}
                >
                  {shots.map((src, index) => (
                    <SwiperItem key={`${index}-${src}`}>
                      <Image
                        className="detail-shot"
                        src={src}
                        mode="aspectFit"
                        onClick={() => Taro.previewImage({ current: src, urls: shots })}
                      />
                    </SwiperItem>
                  ))}
                </Swiper>
              ) : (
                <Image
                  className="detail-shot"
                  src={shot}
                  mode={isWide ? "aspectFill" : "widthFix"}
                  onClick={() => Taro.previewImage({ current: shot, urls: shots })}
                />
              )}
              {shots.length > 1 && <View className="ui-div detail-image-nav">
                {isWide && <Button ariaRole="button" ariaLabel="上一张图片" className="ui-button detail-image-prev" disabled={imageIndex === 0} onClick={() => setImageIndex(index => index - 1)}>‹</Button>}
                <Text className="detail-image-count">{imageIndex + 1} / {shots.length}</Text>
                {isWide && <Button ariaRole="button" ariaLabel="下一张图片" className="ui-button detail-image-next" disabled={imageIndex >= shots.length - 1} onClick={() => setImageIndex(index => index + 1)}>›</Button>}
              </View>}
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
                    className="ui-button detail-open-btn"
                    href={current.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开原文 ↗
                  </a>
                ) : (
                  <Button
                    ariaRole="button"
                    className="ui-button detail-open-btn"
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
              <View className="ui-h3 detail-note">{title}</View>
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

            <View className="ui-div detail-date-row">
              <Text className="detail-date">
                {current.createdAt
                  ? displayDateTime(current.createdAt)
                  : displayDate(current.date, true)}
              </Text>
              {!editing && (
                <View className="ui-div detail-actions">
                  <Text
                    className="ui-span detail-edit-hint"
                    onClick={startEdit}
                  >
                    编辑
                  </Text>
                  <Text
                    className="ui-span detail-delete-hint"
                    onClick={confirmDelete}
                  >
                    删除
                  </Text>
                </View>
              )}
            </View>

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
                  <Button
                    ariaRole="button"
                    ariaLabel="删除备注"
                    className="ui-button note-del"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeNote(n.id);
                    }}
                  >
                    <X size={11} tone="muted" />
                  </Button>
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
                ariaLabel="发送备注"
                className={`ui-button ${`note-send${noteDraft.trim() ? "" : " disabled"}`}`}
                disabled={!noteDraft.trim()}
                onClick={addNote}
              >
                <ArrowUp size={15} tone="white" />
              </Button>
            </View>
          </View>
        </View>
        </View>
      </View>
    </View>
  );
}
