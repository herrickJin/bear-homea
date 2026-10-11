import { Input, View } from "@tarojs/components";
import { Search } from "./Icons";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/* XHS 式搜索：占位文字在左，搜索镜在右端 */
export default function SearchBar({
  value,
  onChange,
  placeholder = "搜要点 / 标题…",
}: SearchBarProps) {
  return (
    <View className="ui-div search-bar">
      <Input
        className="search-input"
        value={value}
        placeholder={placeholder}
        placeholderClass="search-placeholder"
        confirmType="search"
        onInput={(e) => onChange(e.detail.value)}
      />
      <Search size={16} tone="muted" />
    </View>
  );
}
