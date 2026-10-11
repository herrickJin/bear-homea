import { Button, Image, Text, View } from "@tarojs/components";
import type { Category, InspirationLink } from "../data/mockInspiration";
import { Bookmark } from "./Icons";
import {
  displayDate,
  displayTitle,
  sourceLabel,
  statusLabel,
} from "../data/mockInspiration";

interface LinkCardProps {
  link: InspirationLink;
  categories: Category[];
  onOpen: (link: InspirationLink) => void;
  onCopy: (link: InspirationLink) => void;
}

export default function LinkCard({
  link,
  categories,
  onOpen,
  onCopy,
}: LinkCardProps) {
  const tags = categories.filter((c) => link.categoryIds.includes(c.id));
  const status = statusLabel(link.status);
  const title = displayTitle(link);
  const isIdea = !link.url;

  return (
    <View
      className={`ui-div ${`link-card${isIdea ? " card-idea" : ""}`}`}
      onClick={() => onOpen(link)}
    >
      {isIdea ? (
        <View className="ui-div idea-quote">
          <Text className="idea-mark">“</Text>
          <Text className="idea-text">{title}</Text>
          <View className="ui-i idea-dash" />
        </View>
      ) : (link.shotPath || link.coverUrl) ? (
        <Image
          className="link-shot"
          src={link.shotPath ?? link.coverUrl ?? ""}
          mode="widthFix"
        />
      ) : link.shotTint ? (
        <View className={`ui-div ${`link-shot shot-mock shot-${link.shotTint}`}`}>
          <Bookmark size={22} tone="muted" />
        </View>
      ) : null}
      {!isIdea && <View className="ui-h3 link-note">{title}</View>}
      {tags.length > 0 && (
        <View className="ui-div link-tags">
          {tags.map((t) => (
            <View className="ui-div tag-chip" key={t.id}>
              <Text className="ui-span">{t.name}</Text>
            </View>
          ))}
        </View>
      )}
      <View className="ui-div link-meta">
        <Text className="ui-time">
          {sourceLabel(link.source)} · {displayDate(link.date)}
          {status ? ` · ${status}` : ""}
        </Text>
        {link.url && (
          <Button
            ariaRole="button"
            className="ui-button link-open"
            onClick={(e) => {
              e.stopPropagation();
              onCopy(link);
            }}
          >
            打开 ↗
          </Button>
        )}
      </View>
    </View>
  );
}
