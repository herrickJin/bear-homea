import { useState } from "react";
import Taro from "@tarojs/taro";
import { Button, Input, Text, View } from "@tarojs/components";
import type { Category } from "../data/mockInspiration";
import SheetHeader from "./SheetHeader";
import useSheetMotion from "../hooks/useSheetMotion";

interface CategoryManagerProps {
  open: boolean;
  categories: Category[];
  onClose: () => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}

export default function CategoryManager({
  open,
  categories,
  onClose,
  onCreate,
  onRename,
  onDelete,
  onMove,
}: CategoryManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newName, setNewName] = useState("");

  const { visible, entered, requestClose } = useSheetMotion(open, onClose);
  if (!visible) return null;

  function confirmDelete(id: string, name: string) {
    Taro.showModal({
      title: `删除「${name}」`,
      content: "笔记本身保留，只是不再带这个分类。",
      confirmColor: "#356d5b",
    }).then((res) => {
      if (res.confirm) onDelete(id);
    });
  }

  function saveRename(id: string) {
    const name = editingName.trim();
    if (name) onRename(id, name);
    setEditingId(null);
    setEditingName("");
  }

  function create() {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName("");
  }

  return (
    <View className={`ui-div sheet-backdrop manage-backdrop${entered ? " is-entered" : ""}`} onClick={requestClose}>
      <View className="ui-div sheet sheet-with-header" onClick={(e) => e.stopPropagation()}>
        <SheetHeader title="管理分类" onClose={requestClose} />

        {categories.map((c, index) => (
          <View className="ui-div cat-row" key={c.id}>
            {editingId === c.id ? (
              <View className="ui-div field cat-edit">
                <Input
                  className="field-input"
                  value={editingName}
                  focus
                  onInput={(e) => setEditingName(e.detail.value)}
                  onConfirm={() => saveRename(c.id)}
                />
                <Button
                  ariaRole="button"
                  className="ui-button field-action"
                  onClick={() => saveRename(c.id)}
                >
                  确定
                </Button>
              </View>
            ) : (
              <>
                <Text
                  className="ui-strong cat-name"
                  onClick={() => {
                    setEditingId(c.id);
                    setEditingName(c.name);
                  }}
                >
                  {c.name}
                </Text>
                <View className="ui-div cat-actions">
                  <Button
                    ariaRole="button"
                    className={`ui-button ${`cat-move${index === 0 ? " disabled" : ""}`}`}
                    onClick={() => onMove(c.id, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    ariaRole="button"
                    className={`ui-button ${`cat-move${index === categories.length - 1 ? " disabled" : ""}`}`}
                    onClick={() => onMove(c.id, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    ariaRole="button"
                    className="ui-button cat-del"
                    onClick={() => confirmDelete(c.id, c.name)}
                  >
                    删除
                  </Button>
                </View>
              </>
            )}
          </View>
        ))}

        <View className="ui-div field cat-edit">
          <Input
            className="field-input"
            value={newName}
            placeholder="新建分类，如「玄关」"
            placeholderClass="search-placeholder"
            onInput={(e) => setNewName(e.detail.value)}
            onConfirm={create}
          />
          <Button ariaRole="button" className="ui-button field-action" onClick={create}>
            添加
          </Button>
        </View>
      </View>
    </View>
  );
}
