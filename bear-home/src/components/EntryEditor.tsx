import { useEffect, useState } from "react";
import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import { stages } from "../data/demo";
import { Check, X } from "./Icons";
type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (title: string, body: string, stage: string) => void;
};
export default function EntryEditor({ open, onClose, onSave }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [stage, setStage] = useState("水电");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
      setStage("水电");
      setError("");
    }
  }, [open]);
  if (!open) return null;
  function save() {
    if (!title.trim()) {
      setError("先写一个记录标题吧");
      return;
    }
    onSave(title, body, stage);
  }
  return (
    <View className="editor-backdrop" onClick={onClose}>
      <View className="editor" onClick={(e) => e.stopPropagation()}>
        <View className="section-heading">
          <View className="ui-h2">记下小家的今天</View>
          <Button
            ariaRole="button"
            className="ui-button icon-button"
            ariaLabel="关闭"
            onClick={onClose}
          >
            <X size={21} />
          </Button>
        </View>
        <Text className="subtle">一个小进展，也值得记录。</Text>
        <Text className="editor-label">记录标题</Text>
        <View className="editor-field">
          <Input
            className="ui-input"
            value={title}
            placeholder="今天小家有什么新变化？"
            maxlength={60}
            onInput={(e) => {
              setTitle(e.detail.value);
              setError("");
            }}
          />
        </View>
        <Text className="editor-label">装修阶段</Text>
        <View className="stage-picker">
          {stages.map((item) => (
            <Button
              ariaRole="button"
              className={`ui-button ${stage === item ? "selected" : ""}`}
              key={item}
              onClick={() => setStage(item)}
            >
              {item}
            </Button>
          ))}
        </View>
        <Text className="editor-label">今天的故事</Text>
        <View className="editor-field textarea-field">
          <Textarea
            className="ui-textarea"
            value={body}
            placeholder="施工进展、一个决定，或者一点小心情…"
            maxlength={2000}
            onInput={(e) => setBody(e.detail.value)}
          />
        </View>
        {error && (
          <Text className="form-note" style={{ color: "#b56950" }}>
            {error}
          </Text>
        )}
        <Button
          ariaRole="button"
          className="ui-button primary save"
          onClick={save}
        >
          保存记录 <Check size={17} tone="white" />
        </Button>
        <Text className="form-note">保存到小家的服务器</Text>
      </View>
    </View>
  );
}
