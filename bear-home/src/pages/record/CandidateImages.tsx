import { useState } from "react";
import Taro from "@tarojs/taro";
import { Button, Image, Text, View } from "@tarojs/components";
import { Plus, X } from "../../components/Icons";
export const MAX_CANDIDATE_IMAGES = 9;
export default function CandidateImages({ images, name, busy, onAdd, onRemove, onCover, expanded = false }: {
  images: string[];
  name: string;
  busy: boolean;
  onAdd: () => void;
  onRemove?: (index: number) => void;
  onCover?: (index: number) => void;
  expanded?: boolean;
}) {
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(0, images.length - 1));
  const preview = (current: string) => {
    Taro.previewImage({ current, urls: images }).catch(() => Taro.showToast({ title: "暂时无法预览图片", icon: "none" }));
  };
  const sources = images.length < MAX_CANDIDATE_IMAGES && (expanded || images.length > 0) && <View className={`candidate-photo-sources${expanded ? " expanded" : ""}`}>
    <Button ariaRole="button" ariaLabel={`为${name}添加图片`} className="ui-button candidate-photo-source" disabled={busy} onClick={onAdd}>{busy ? "上传中…" : "添加图片"}</Button>
  </View>;
  if (expanded) return <View className={`candidate-image-editor${managing ? " is-managing" : " is-view"}`}>
    {images.length > 0 && <View className="candidate-image-heading"><Text className="prep-caption">{images.length} 张照片</Text><Button ariaRole="button" className="ui-button candidate-image-manage" onClick={() => setManaging(!managing)}>{managing ? "完成" : "管理图片"}</Button></View>}
    <View className="candidate-image-grid">
      {images.map((src, i) => <View className="candidate-image-cell" key={`${src}-${i}`}>
        <Button ariaRole="button" ariaLabel={`查看${name}第${i + 1}张图片`} className="ui-button candidate-image-button" onClick={() => preview(src)}><Image src={src} mode="aspectFill" /></Button>
        {managing && <Button ariaRole="button" ariaLabel={`删除第${i + 1}张图片`} className="ui-button candidate-image-remove" disabled={busy} onClick={() => { onRemove?.(i); setSelected(0); }}><X size={12} tone="white" /></Button>}
        {managing && (i === 0 ? <Text className="candidate-image-cover">封面</Text> : <Button ariaRole="button" className="ui-button candidate-image-set-cover" disabled={busy} onClick={() => { onCover?.(i); setSelected(0); }}>设为封面</Button>)}
      </View>)}
    </View>
    {(managing || !images.length) && sources}
    {busy && <Text className="prep-caption">正在上传图片…</Text>}
    {managing && <Text className="prep-caption">第一张用作封面，最多 {MAX_CANDIDATE_IMAGES} 张。</Text>}
  </View>;
  return <View className="candidate-gallery">
    {images.length ? <>
      <Button ariaRole="button" ariaLabel={`查看${name}图片，共${images.length}张`} className="ui-button candidate-gallery-main" onClick={() => preview(images[index])}><Image src={images[index]} mode="aspectFill" /><Text className="candidate-gallery-count">{index + 1} / {images.length}</Text></Button>
      {images.length > 1 && <View className="candidate-gallery-thumbs">{images.slice(0, 3).map((src, i) => <Button ariaRole="button" ariaLabel={`切换到第${i + 1}张图片`} className={`ui-button candidate-gallery-thumb${index === i ? " active" : ""}`} key={`${src}-${i}`} onClick={() => setSelected(i)}><Image src={src} mode="aspectFill" />{i === 2 && images.length > 3 && <Text>＋{images.length - 3}</Text>}</Button>)}</View>}
    </> : <Button ariaRole="button" ariaLabel={`为${name}添加图片`} className="ui-button candidate-gallery-empty" disabled={busy} onClick={onAdd}><Plus size={22} tone="muted" /><Text>{busy ? "上传中…" : "添加图片"}</Text></Button>}
    {sources}
  </View>;
}
