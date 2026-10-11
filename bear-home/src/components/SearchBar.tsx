import { Input, View } from "@tarojs/components";
import { Search } from "./Icons";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

/* XHS 式搜索：占位文字在左，搜索镜在右端 */
export default function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <View className="ui-div search-bar">
      <Input
        className="search-input"
        value={value}
        placeholder="搜要点 / 标题…"
        placeholderClass="search-placeholder"
        confirmType="search"
        onInput={(e) => onChange(e.detail.value)}
      />
      <Search size={16} tone="muted" />
    </View>
  );
}
