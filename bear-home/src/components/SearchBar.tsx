import { Input, View } from "@tarojs/components";
import { Search } from "./Icons";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export default function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <View className="ui-div search-bar">
      <Search size={15} tone="muted" />
      <Input
        className="search-input"
        value={value}
        placeholder="搜要点 / 标题…"
        placeholderClass="search-placeholder"
        confirmType="search"
        onInput={(e) => onChange(e.detail.value)}
      />
    </View>
  );
}
