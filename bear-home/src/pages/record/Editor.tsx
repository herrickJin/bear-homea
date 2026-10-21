import { useEffect, useRef, useState } from "react";
import Taro from "@tarojs/taro";
import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import { organizeRecord, type RecordDraft } from "../../services/recordDraft";
import SheetHeader from "../../components/SheetHeader";
import useSheetMotion from "../../hooks/useSheetMotion";
import {
  recordRooms,
  materialKinds,
} from "../../data/mockRecords";
import type {
  PurchaseRecord,
  RecordSection,
} from "../../data/mockRecords";
export function Action({
  children,
  onClick,
  primary = false,
  disabled = false,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      ariaRole="button"
      disabled={disabled}
      className={`ui-button rec-action ${primary ? "primary-action" : ""} ${disabled ? "is-disabled" : ""} ${className}`}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
export function Sheet({
  title,
  children,
  onClose,
  wide = false,
  editor = false,
  footer,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  editor?: boolean;
  footer?: React.ReactNode;
  className?: string;
}) {
  const { entered, requestClose } = useSheetMotion(true, onClose);
  useEffect(() => {
    if (process.env.TARO_ENV !== "h5") return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
    };
  }, []);
  return (
    <View className={`rec-overlay${entered ? " is-entered" : ""}`}>
      <View className="rec-dim" onClick={requestClose} />
      <View
        className={`rec-sheet${wide ? " wide" : ""}${editor ? " rec-editor" : ""} ${className}`}
        ariaRole="dialog"
        ariaLabel={title}
      >
        <SheetHeader title={title} onClose={requestClose} />
        <View className="rec-sheet-body">{children}</View>
        {footer}
      </View>
    </View>
  );
}
function FieldEditor({
  initial,
  lockedRoom,
  section,
  group,
  onClose,
  onSave,
}: {
  initial?: PurchaseRecord;
  lockedRoom?: string;
  section: RecordSection;
  group: string;
  onClose: () => void;
  onSave: (r: PurchaseRecord) => void;
}) {
  const [kind, setKind] = useState<RecordSection>(initial?.section ?? section);
  const [name, setName] = useState(initial?.name ?? "");
  const [price, setPrice] = useState(initial?.price?.toString() ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "件");
  const [room, setRoom] = useState(
    initial?.room ?? (recordRooms.includes(group) ? group : "客厅"),
  );
  const [category, setCategory] = useState(
    initial?.category ??
      (section === "hard"
        ? materialKinds.includes(group)
          ? group
          : "主材"
        : ""),
  );
  const [url, setUrl] = useState(initial?.url ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [pros, setPros] = useState(initial?.pros ?? "");
  const [cons, setCons] = useState(initial?.cons ?? "");
  const [more, setMore] = useState(Boolean(initial?.pros || initial?.cons || initial?.url));
  function save() {
    if (url.trim() && !/^https?:\/\//i.test(url.trim())) {
      Taro.showToast({ title: "链接以 http 或 https 开头", icon: "none" });
      return;
    }
    if (!name.trim()) {
      Taro.showToast({ title: "写一下名称", icon: "none" });
      return;
    }
    if (
      price.trim() &&
      (!Number.isFinite(Number(price)) || Number(price) < 0)
    ) {
      Taro.showToast({ title: "价格填有效数字", icon: "none" });
      return;
    }
    onSave({
      ...initial,
      url: url.trim(),
      id: initial?.id ?? `record-${Date.now()}`,
      section: kind,
      name: name.trim(),
      price: price.trim() ? Number(price) : null,
      unit: unit.trim() || "件",
      room,
      category: category.trim() || (kind === "soft" ? "其他" : "主材"),
      note: note.trim(),
      pros: pros.trim(),
      cons: cons.trim(),
      status: initial?.status ?? "saved",
    });
    onClose();
  }
  return (
    <Sheet
      title={initial ? "编辑记录" : "添加记录"}
      onClose={onClose}
      editor
      footer={
        <View className="rec-form-footer">
          <Action onClick={onClose}>取消</Action>
          <Action primary onClick={save}>保存记录</Action>
        </View>
      }
    >
      <Text className="rec-form-hint">先记下名字，其他信息可以慢慢补充。</Text>
      <Text className="rec-field-label">名称 <Text className="rec-required">必填</Text></Text>
      <Input
        ariaLabel="名称"
        className="rec-input"
        value={name}
        placeholder="产品、型号，或者想记的东西"
        onInput={(e) => setName(e.detail.value)}
      />
      <View className="rec-form-inline">
        <View>
          <Text className="rec-field-label">价格 <Text className="rec-optional">选填</Text></Text>
          <Input
            ariaLabel="价格"
            className="rec-input"
            value={price}
            placeholder="0.00"
            type="digit"
            onInput={(e) => setPrice(e.detail.value)}
          />
        </View>
        <View className="unit-field">
          <Text className="rec-field-label">单位</Text>
          <Input
            ariaLabel="单位"
            className="rec-input"
            value={unit}
            onInput={(e) => setUnit(e.detail.value)}
          />
        </View>
      </View>
      <Text className="rec-field-label">类型</Text>
      <View className="rec-choice-row rec-type-choice">
        {(["soft", "hard"] as const).map((k) => (
          <Action
            key={k}
            className={kind === k ? "active" : ""}
            onClick={() => {
              setKind(k);
              setCategory(k === "hard" ? "主材" : "");
            }}
          >
            {k === "soft" ? "软装" : "硬装"}
          </Action>
        ))}
      </View>
      <Text className="rec-field-label">房间</Text>
      {lockedRoom ? <Text className="rec-form-hint">{lockedRoom}</Text> : <View className="rec-choice-row rec-room-choice">
        {recordRooms.map((r) => (
          <Action
            key={r}
            className={room === r ? "active" : ""}
            onClick={() => setRoom(r)}
          >
            {r}
          </Action>
        ))}
      </View>}
      {kind === "hard" && (
        <>
          <Text className="rec-field-label">分类</Text>
          <View className="rec-choice-row">
            {materialKinds.map((k) => (
              <Action
                key={k}
                className={category === k ? "active" : ""}
                onClick={() => setCategory(k)}
              >
                {k}
              </Action>
            ))}
          </View>
        </>
      )}
      <Text className="rec-field-label">备注 <Text className="rec-optional">选填</Text></Text>
      <Textarea
        ariaLabel="备注"
        className="rec-input rec-textarea"
        value={note}
        placeholder="尺寸、渠道、报价，随手记…"
        maxlength={1500}
        onInput={(e) => setNote(e.detail.value)}
      />
      <Action className="rec-text-action" onClick={() => setMore(!more)}>
        {more ? "－ 收起更多信息" : "＋ 补充品类、优缺点"}
      </Action>
      {more && (
        <>
          <Text className="rec-field-label">商品链接 · 选填</Text>
          <Input ariaLabel="商品链接" className="rec-input" value={url} placeholder="粘贴商品链接" onInput={e => setUrl(e.detail.value)} />
          {kind === "soft" && (
            <>
              <Text className="rec-field-label">品类 · 可不填</Text>
              <Input
                className="rec-input"
                value={category}
                placeholder="例如：沙发、空调"
                onInput={(e) => setCategory(e.detail.value)}
              />
            </>
          )}
          <Text className="rec-field-label">优点</Text>
          <Textarea
            ariaLabel="优点"
            className="rec-input rec-textarea"
            value={pros}
            placeholder="喜欢它的地方"
            onInput={(e) => setPros(e.detail.value)}
            maxlength={1000}
          />
          <Text className="rec-field-label">缺点</Text>
          <Textarea
            ariaLabel="缺点"
            className="rec-input rec-textarea"
            value={cons}
            placeholder="顾虑、需要再确认的地方"
            onInput={(e) => setCons(e.detail.value)}
            maxlength={1000}
          />
        </>
      )}
    </Sheet>
  );
}
export function Editor(props: {
  startEditing?: boolean;
  itemName?: string;
  initial?: PurchaseRecord;
  section: RecordSection;
  group: string;
  onClose: () => void;
  onSave: (r: PurchaseRecord) => void;
}) {
  const [text, setText] = useState(props.initial ? [
    props.initial.room, props.initial.name,
    props.initial.price === null ? "" : `${props.initial.price} 元 / ${props.initial.unit}`,
    props.initial.note, props.initial.pros ? `优点：${props.initial.pros}` : "",
    props.initial.cons ? `顾虑：${props.initial.cons}` : "",
  ].filter(Boolean).join("，") : "");
  const [draft, setDraft] = useState<RecordDraft | null>(props.initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(Boolean(props.startEditing));
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const defaultRoom = recordRooms.includes(props.group) ? props.group : "全屋";
  const record = (value: RecordDraft): PurchaseRecord => ({
    ...props.initial, ...value,
    url: text.match(/https?:\/\/[^\s，。<>]+/)?.[0] ?? props.initial?.url,
    id: props.initial?.id ?? `record-${Date.now()}`,
    status: props.initial?.status ?? "saved",
  });
  const saveDraft = () => {
    if (!draft) return;
    props.onSave(record(draft));
    props.onClose();
  };
  const saveText = () => {
    if (!text.trim()) return;
    const raw = text.trim();
    props.onSave(record({
      name: raw.split(/[，。\n]/)[0].slice(0, 60) || raw.slice(0, 60),
      note: raw, room: defaultRoom, section: props.section,
      category: props.section === "hard" ? "主材" : "其他",
      price: null, unit: "件", pros: "", cons: "",
    }));
    props.onClose();
  };
  const organize = async () => {
    if (!text.trim() || busy) return;
    const current = ++generation.current;
    setBusy(true); setError("");
    try {
      const result = await organizeRecord(text.trim(), defaultRoom);
      if (generation.current === current) setDraft(props.itemName ? { ...result, room: defaultRoom } : result);
    } catch (err) {
      if (generation.current === current) setError(err instanceof Error ? err.message : "AI 整理失败，请重试");
    } finally {
      if (generation.current === current) setBusy(false);
    }
  };
  if (editing) return <FieldEditor {...props} lockedRoom={props.itemName ? props.group : undefined} initial={props.initial ?? (draft ? record(draft) : undefined)} />;
  return (
    <Sheet title={draft ? (props.initial ? "编辑记录" : "确认记录") : props.itemName ? `给${props.itemName}加个候选` : "随手记一项"} onClose={props.onClose} editor footer={
      <View className="rec-form-footer">
        <Action primary disabled={!draft && (!text.trim() || busy)} onClick={draft ? saveDraft : organize}>
          {draft ? (props.initial ? "保存修改" : "确认保存") : busy ? "正在整理…" : "AI 整理"}
        </Action>
      </View>
    }>
      {draft ? (
        <View className="rec-ai-preview">
          <Text className="rec-ai-context">{draft.room} · {draft.section === "soft" ? "软装" : "硬装"} · {draft.category}</Text>
          <Text className="rec-ai-name">{draft.name}</Text>
          <Text className="rec-ai-price">{draft.price === null ? "未提及价格" : `¥${draft.price.toLocaleString("zh-CN")} / ${draft.unit}`}</Text>
          {draft.note && <Text className="rec-ai-note">{draft.note}</Text>}
          {draft.pros && <Text className="rec-ai-note">优点：{draft.pros}</Text>}
          {draft.cons && <Text className="rec-ai-note">顾虑：{draft.cons}</Text>}
          <View className="rec-ai-options">
            <Action className="rec-text-action" onClick={() => setEditing(true)}>修改信息</Action>
            <Action className="rec-text-action" onClick={() => setDraft(null)}>返回重写</Action>
          </View>
        </View>
      ) : (
        <>
          <Text className="rec-form-hint">名字、价格、想法，想到什么就写什么。</Text>
          <Textarea
            ariaLabel="随手记" className="rec-input rec-textarea rec-ai-input"
            placeholder="比如：客厅沙发，7299 元，宽 2.6 米，坐着舒服，布套可以拆洗。"
            value={text} maxlength={2000} disabled={busy}
            onInput={(e) => { setText(e.detail.value); setError(""); }}
          />
          {text.includes("http") && <Text className="rec-ai-context">商品链接会保留，具体参数仍需提供或核实。</Text>}
          <Text className="rec-ai-context">记到{defaultRoom} · AI 整理后，由你确认保存</Text>
          {error && <Text className="rec-ai-error" ariaRole="alert">{error}</Text>}
          <View className="rec-ai-options">
            <Action className="rec-text-action" disabled={!text.trim() || busy} onClick={saveText}>直接保存原文</Action>
          </View>
        </>
      )}
    </Sheet>
  );
}
