import { useEffect, useRef, useState } from "react";
import Taro from "@tarojs/taro";
import { Button, Image, Input, Text, Textarea, View } from "@tarojs/components";
import type { Category, SaveDraft } from "../data/mockInspiration";
import { parseShareText } from "../data/mockInspiration";
import { X } from "./Icons";
import SheetHeader from "./SheetHeader";
import useSheetMotion from "../hooks/useSheetMotion";

/**
 * 收藏弹层「对家的想法」（v5）
 * - 一个输入框：粘贴真实分享文本（【标题】+噪音+长URL）或随手记想法
 * - 实时解析：提取规范链接 + 【】标题（标题直接当卡片标题，无需等抓取）
 * - 系统剪贴板截图与文字共用输入区，支持重复追加多张图片
 * - 手机底部弹层 / 进出同路径 / reduced-motion 退化
 */
interface SaveSheetProps {
  open: boolean;
  categories: Category[];
  onClose: () => void;
  onSave: (draft: SaveDraft) => void | Promise<void>;
  onCreateCategory: (name: string) => Promise<Category>;
}

export default function SaveSheet({
  open,
  categories,
  onClose,
  onSave,
  onCreateCategory,
}: SaveSheetProps) {
  const [text, setText] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [addingTag, setAddingTag] = useState(false);
  const [tagName, setTagName] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);
  const tagRequest = useRef(false);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [clipboardHint, setClipboardHint] = useState("");
  const session = useRef(0);
  const [shotPaths, setShotPaths] = useState<string[]>([]);
  const objectUrls = useRef(new Set<string>());

  function clearImages() {
    objectUrls.current.forEach(path => URL.revokeObjectURL(path));
    objectUrls.current.clear();
    setShotPaths([]);
  }
  const { visible, entered, requestClose } = useSheetMotion(open, onClose);

  useEffect(() => {
    session.current += 1;
    if (!open) { clearImages(); return; }
    setAddingTag(false); setTagName("");
    setText("");
    setClipboardHint("");
    setCategoryIds([]);
    clearImages();
  }, [open]);

  useEffect(() => () => {
    objectUrls.current.forEach(path => URL.revokeObjectURL(path));
    objectUrls.current.clear();
  }, []);

  useEffect(() => {
    if (process.env.TARO_ENV !== "h5" || !open || !visible) return;
    function handlePaste(event: ClipboardEvent) {
      if (!(event.target instanceof Element) || !event.target.closest("#idea-composer")) return;
      const images = Array.from(event.clipboardData?.items ?? [])
        .filter(item => item.kind === "file" && item.type.startsWith("image/"))
        .map(item => item.getAsFile()).filter((file): file is File => file !== null);
      if (!images.length) return; // Let the native textarea paste plain text at its cursor.
      event.preventDefault();
      if (savingRef.current) return;
      attachImages(images);
      const value = event.clipboardData?.getData("text/plain");
      if (value) insertText(value);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [open, visible]);

  function attachImages(images: Blob[]) {
    const accepted = images.filter(image => image.size <= 50 * 1024 * 1024);
    const paths = accepted.map(image => {
      const path = URL.createObjectURL(image);
      objectUrls.current.add(path);
      return path;
    });
    setShotPaths(previous => [...previous, ...paths]);
    setClipboardHint(accepted.length < images.length
      ? "超过 50 MB 的图片未添加，请复制较小的图片"
      : "图片已添加，可以继续粘贴图片或写下想法");
  }

  function removeImage(path: string) {
    setShotPaths(previous => previous.filter(value => value !== path));
    URL.revokeObjectURL(path);
    objectUrls.current.delete(path);
    setClipboardHint("");
  }

  function insertText(value: string) {
    const input = process.env.TARO_ENV === "h5"
      ? document.querySelector<HTMLTextAreaElement>("#idea-composer textarea") : null;
    const start = input?.selectionStart;
    const end = input?.selectionEnd;
    setText(previous => {
      const position = start ?? previous.length;
      return (previous.slice(0, position) + value + previous.slice(end ?? position)).slice(0, 1000);
    });
    if (input) {
      input.focus();
      requestAnimationFrame(() => input.setSelectionRange((start ?? 0) + value.length, (start ?? 0) + value.length));
    }
  }

  function close() {
    if (!savingRef.current) requestClose();
  }

  if (!visible) return null;
  const parsed = parseShareText(text);

  function toggleCategory(id: string) {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }

  async function createTag() {
    const name = tagName.trim();
    if (!name || tagRequest.current) return;
    const existing = categories.find(c => c.name === name);
    if (existing) {
      setCategoryIds(ids => [...new Set([...ids, existing.id])]);
      setAddingTag(false); setTagName(""); return;
    }
    const currentSession = session.current;
    tagRequest.current = true; setCreatingTag(true);
    try {
      const category = await onCreateCategory(name);
      if (currentSession === session.current) {
        setCategoryIds(ids => [...new Set([...ids, category.id])]);
        setAddingTag(false); setTagName("");
      }
    } catch {
      if (currentSession === session.current) Taro.showToast({ title: "标签没能创建，请重试", icon: "none" });
    } finally { tagRequest.current = false; setCreatingTag(false); }
  }

  async function pasteFromClipboard(imageOnly = false) {
    const currentSession = session.current;
    if (process.env.TARO_ENV === "h5") {
      try {
        // Invoke directly from the button gesture for Safari/iPad clipboard access.
        if (!navigator.clipboard?.read) throw new Error("Clipboard read unavailable");
        const items = await navigator.clipboard.read();
        const images: Blob[] = [];
        let value = "";
        for (const item of items) {
          const type = item.types.find(type => type.startsWith("image/"));
          if (type) images.push(await item.getType(type));
          if (!imageOnly && item.types.includes("text/plain")) {
            value += await (await item.getType("text/plain")).text();
          }
        }
        if (currentSession !== session.current || savingRef.current) return;
        if (images.length) attachImages(images);
        if (value) insertText(value);
        if (!images.length && !value) setClipboardHint(imageOnly ? "剪贴板中没有图片，请先复制截图" : "剪贴板中没有图片或文字");
      } catch {
        if (currentSession !== session.current) return;
        document.querySelector<HTMLTextAreaElement>("#idea-composer textarea")?.focus();
        setClipboardHint("请长按输入区选择「粘贴」，或按 ⌘V / Ctrl+V 粘贴截图与文字");
      }
      return;
    }
    if (imageOnly) {
      setClipboardHint("当前小程序不支持读取剪贴板图片，请在网页版中粘贴截图");
      return;
    }
    try {
      const clip = await Taro.getClipboardData();
      if (currentSession !== session.current || savingRef.current) return;
      if (clip.data) insertText(clip.data);
      else setClipboardHint("剪贴板是空的");
    } catch {
      setClipboardHint("请长按输入框粘贴");
    }
  }

  async function submit() {
    if (creatingTag || savingRef.current) return;
    const value = text.trim();
    if (!value && !shotPaths.length) {
      Taro.showToast({ title: "写点想法，或粘贴一张截图", icon: "none" });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave({
        url: parsed.url,
        title: parsed.url ? parsed.title : null,
        note: parsed.url && !shotPaths.length ? "" : value,
        categoryIds,
        shotPath: shotPaths[0] ?? null,
        shotPaths,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <View
      className={`ui-div ${`sheet-backdrop note-backdrop${entered ? " is-entered" : ""}`}`}
      onClick={close}
    >
      <View
        className={`ui-div ${`sheet sheet-with-header note-save-sheet`}`}
        onClick={(e) => e.stopPropagation()}
      >
        <SheetHeader title="对家的想法" onClose={close} />

        <View className="ui-div label-row">
          <Text className="ui-span field-label">分享或想法</Text>
          <View className="ui-div label-actions">
            <Button
              ariaRole="button"
              className="ui-button field-action"
              disabled={saving}
              onClick={() => pasteFromClipboard(true)}
            >
              粘贴截图
            </Button>
            <Button
              ariaRole="button"
              className="ui-button field-action"
              disabled={saving}
              onClick={() => pasteFromClipboard()}
            >
              粘贴
            </Button>
          </View>
        </View>
        <View id="idea-composer" className="ui-div idea-composer">
          <Textarea
            className="field-textarea idea-textarea"
            disabled={saving}
            value={text}
            placeholder="粘贴截图、小红书分享，或写下想法…"
            placeholderClass="search-placeholder"
            maxlength={1000}
            onInput={(e) => setText(e.detail.value)}
          />
          {shotPaths.length > 0 && (
            <View className="ui-div idea-shot-list">
              {shotPaths.map((path, index) => (
                <View key={path} className="ui-div idea-shot-preview">
                  <Image className="idea-shot" src={path} mode="aspectFit" onClick={() => Taro.previewImage({ current: path, urls: shotPaths })} />
                  <Button
                    ariaRole="button"
                    ariaLabel={`移除第 ${index + 1} 张图片`}
                    className="ui-button idea-shot-remove"
                    disabled={saving}
                    onClick={() => removeImage(path)}
                  >
                    <X size={14} tone="white" />
                  </Button>
                </View>
              ))}
            </View>
          )}

        </View>
        <Text className="ui-span idea-input-hint">
          {clipboardHint || "支持多张图片 + 文字，可重复粘贴 · 复制截图后，长按输入区粘贴"}
        </Text>
        {parsed.url && (
          <View className="ui-div parse-hint">
            <Text className="ui-span">
              ✓ 已识别小红书链接
              {parsed.title ? ` · ${parsed.title}` : ""}
            </Text>
          </View>
        )}
        <Text className="ui-span field-label">标签 · 可跳过</Text>
        <View className="ui-div chip-line">
          {categories.map((c) => (
            <Button
              ariaRole="button"
              key={c.id}
              className={`ui-button ${`cat-tab${categoryIds.includes(c.id) ? " active" : ""}`}`}
              onClick={() => toggleCategory(c.id)}
            >
              {c.name}
            </Button>
          ))}
          <Button ariaRole="button" className="ui-button cat-tab note-add-tag" disabled={creatingTag} onClick={() => setAddingTag(true)}>＋ 新建标签</Button>
        </View>
        {addingTag && <View className="ui-div note-tag-create">
          <Input className="field-input" ariaLabel="标签名称" value={tagName} focus maxlength={20} placeholder="输入标签名称" onInput={e => setTagName(e.detail.value)} onConfirm={createTag} disabled={creatingTag} />
          <Button ariaRole="button" className="ui-button field-action" disabled={creatingTag || !tagName.trim()} onClick={createTag}>{creatingTag ? "创建中…" : "添加"}</Button>
          <Button ariaRole="button" className="ui-button field-action" disabled={creatingTag} onClick={() => { setAddingTag(false); setTagName(""); }}>取消</Button>
        </View>}

        <Button
          ariaRole="button"
          disabled={creatingTag || saving}
          className="ui-button btn-primary"
          onClick={submit}
        >
          {saving ? "保存中…" : "收藏"}
        </Button>
      </View>
    </View>
  );
}
