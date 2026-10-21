import { Image, Text, View } from "@tarojs/components";
import type { Category, InspirationLink } from "../data/mockInspiration";
import { Bookmark, Xiaohongshu } from "./Icons";
import {
  displayDate,
  displayTitle,
  isXiaohongshu,
  sourceLabel,
  statusLabel,
} from "../data/mockInspiration";

interface LinkCardProps {
  link: InspirationLink;
  categories: Category[];
  onOpen: (link: InspirationLink) => void;
}

export default function LinkCard({
  link,
  categories,
  onOpen,
}: LinkCardProps) {
  const tags = categories.filter((c) => link.categoryIds.includes(c.id));
  const status = statusLabel(link.status);
  const title = displayTitle(link);
  const isIdea = !link.url;
  const image = link.shotPath || link.coverUrl;
  const isXhs = !isIdea && isXiaohongshu(link.source);

  return (
    <View
      className={`ui-div ${`link-card${isIdea ? " card-idea" : ""}`}`}
      onClick={() => onOpen(link)}
    >
      {image ? (
        <Image className="link-shot" src={image} mode="widthFix" />
      ) : isIdea ? (
        <View className="ui-div idea-quote">
          <Text className="idea-mark">“</Text>
          <Text className="idea-text">{title}</Text>
          <View className="ui-i idea-dash" />
        </View>
      ) : link.shotTint ? (
        <View className={`ui-div ${`link-shot shot-mock shot-${link.shotTint}`}`}>
          <Bookmark size={22} tone="muted" />
        </View>
      ) : null}
      {(image || !isIdea) && <View className="ui-h3 link-note">{title}</View>}
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
          {displayDate(link.date, true)}
          {status ? ` · ${status}` : ""}
        </Text>
        <View className="ui-div link-src">
          {isXhs && <Xiaohongshu size={13} />}
          <Text className="ui-src">
            {isIdea ? "笔记" : sourceLabel(link.source)}
          </Text>
        </View>
      </View>
    </View>
  );
}
