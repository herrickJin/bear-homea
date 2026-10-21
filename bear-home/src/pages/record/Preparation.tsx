import usePreparationSync from "./usePreparationSync";
import { useEffect, useRef, useState } from "react";
import Taro from "@tarojs/taro";
import { Button, Image, Input, Text, View } from "@tarojs/components";
import { API_BASE_URL, uploadFile } from "../../services/api";
import { analyzeCandidate } from "../../services/analyze";
import CandidateImages, { MAX_CANDIDATE_IMAGES } from "./CandidateImages";
import Screen from "../../components/Screen";
import LinkDetailSheet from "../../components/LinkDetailSheet";
import { Plus, ChevronRight, Check, RefreshCw } from "../../components/Icons";
import * as inspiration from "../../services/inspiration";
import { recordRooms, recordStatusLabels, type PurchaseRecord, type RecordStatus } from "../../data/mockRecords";
import { removePreparationItem, preparationSeed, matchItem, type PreparationItem } from "../../data/preparation";
import { Action, Editor, Sheet } from "./Editor";
import dining from "../../assets/rooms/dining.png";
import living from "../../assets/rooms/living.png";
import bedroom from "../../assets/rooms/bedroom.png";
import guest from "../../assets/rooms/guest.png";
import kitchen from "../../assets/rooms/kitchen.png";
import bath from "../../assets/rooms/bathroom.png";
import balcony from "../../assets/rooms/balcony.png";
import whole from "../../assets/rooms/whole.png";
const icons: Record<string, string> = { 客厅: living, 餐厅: dining, 主卧: bedroom, 次卧: guest, 厨房: kitchen, 卫生间: bath, 阳台: balcony, 全屋: whole };
const STORE = "bear-home-preparation-v1";
type Saved = { records: PurchaseRecord[]; items: PreparationItem[]; skipped: string[]; associations: Record<string, string[]>; appliedImports?: string[] };
function empty(): Saved {
  return { records: [], items: preparationSeed, skipped: [], associations: {} };
}
function load(): Saved {
  try {
    const data = Taro.getStorageSync(STORE);
    if (data?.version === 1 && Array.isArray(data.records) && Array.isArray(data.items)) return {
      records: data.records, items: data.items,
      skipped: Array.isArray(data.skipped) ? data.skipped : [], associations: data.associations ?? {},
    };
  } catch { /* Start with an empty candidate list. */ }
  return empty();
}
const money = (r: PurchaseRecord) => r.price === null ? "待询价" : `¥${r.price.toLocaleString("zh-CN")} / ${r.unit}`;
export default function Preparation() {
  const { data, setData, phase, message, conflict, reload, retry } = usePreparationSync(load, empty);
  const [uploading, setUploading] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [filter, setFilter] = useState("全部");
  const [editor, setEditor] = useState<PurchaseRecord | "new" | null>(null);
  const [detailMore, setDetailMore] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [managingItems, setManagingItems] = useState(false);
  const [customName, setCustomName] = useState("");
  const [linking, setLinking] = useState(false);
  const [links, setLinks] = useState<inspiration.InspirationLink[]>([]);
  const [categories, setCategories] = useState<inspiration.Category[]>([]);
  const [noteLoading, setNoteLoading] = useState(true);
  const [noteError, setNoteError] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [specRecord, setSpecRecord] = useState<string | null>(null);
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisPreview, setAnalysisPreview] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const analysisRun = useRef(0);
  const item = data.items.find(i => i.id === itemId);
  useEffect(() => {
    setDetailMore(false);
    // 关掉或切换候选时，丢弃未确认的预览与在途请求的结果
    analysisRun.current++;
    setAnalyzing(false); setAnalysisPreview(null); setAnalysisError("");
  }, [detail]);
  const active = data.records.find(r => r.id === detail);
  const candidates = data.records.filter(r => matchItem(r, data.items)?.id === itemId);
  const roomItems = data.items.filter(i => i.room === room);
  const scope = item ? `item:${item.id}` : `room:${room}`;
  const getCandidates = (i: PreparationItem) => data.records.filter(r => matchItem(r, data.items)?.id === i.id);
  function progress(i: PreparationItem) {
    const list = getCandidates(i);
    return data.skipped.includes(i.id) ? "暂不需要" : list.some(r => r.status === "bought") ? "已买" : list.some(r => r.status === "shortlist") ? "已选定" : list.length ? "比较中" : "待准备";
  }
  function openRoom(next: string | null) { setManagingItems(false); setRoom(next); setItemId(null); setFilter("全部"); setCompareMode(false); setSelected([]); }
  function openItem(i: PreparationItem) { setItemId(i.id); setCompareMode(false); setSelected([]); }
  useEffect(() => {
    Taro.pageScrollTo({ scrollTop: 0, duration: 0 }).catch(() => {});
  }, [room, itemId]);
  useEffect(() => {
    let alive = true;
    Promise.all([inspiration.fetchLinks(), inspiration.listCategories()]).then(([notes, cats]) => {
      if (alive) { setLinks(notes); setCategories(cats); setNoteLoading(false); }
    }).catch(() => { if (alive) { setNoteError(true); setNoteLoading(false); } });
    return () => { alive = false; };
  }, []);
  const taggedIds = categories.filter(c => c.name === room || ((room === "主卧" || room === "次卧") && c.name === "卧室")).map(c => c.id);
  const related = links.filter(l => (data.associations[scope] ?? []).includes(l.id) || (!item && l.categoryIds.some(id => taggedIds.includes(id))));
  const note = links.find(l => l.id === noteId);
  function status(record: PurchaseRecord, next: RecordStatus) {
    const target = matchItem(record, data.items)?.id;
    setData(d => ({ ...d, records: d.records.map(r => r.id === record.id ? { ...r, status: next } :
      next === "shortlist" && target && matchItem(r, d.items)?.id === target && r.status === "shortlist" ? { ...r, status: "saved" } : r) }));
  }
  function save(record: PurchaseRecord) {
    const old = data.records.find(r => r.id === record.id);
    const next = { ...old, ...record, ...(item ? { room: item.room, itemId: item.id } : {}) };
    setData(d => ({ ...d, skipped: item ? d.skipped.filter(id => id !== item.id) : d.skipped, records: d.records.some(r => r.id === next.id) ? d.records.map(r => r.id === next.id ? next : r) : [next, ...d.records] }));
  }
  async function removeItem(target: PreparationItem) {
    const result = await Taro.showModal({
      title: `删除「${target.name}」？`,
      content: "只删除准备项。已有候选保留在本房间的「待归类的随手记」，关联笔记保留在房间下。",
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!result.confirm) return;
    setData(d => removePreparationItem(d, target.id));
    Taro.showToast({ title: "已删除准备项", icon: "none" });
  }
  function toggleCompare(id: string) {
    setSelected(ids => ids.includes(id) ? ids.filter(s => s !== id) : ids.length < 3 ? [...ids, id] : ids);
  }
  /** 让 AI 分析当前候选。只出预览，用户确认后才写进这条候选。 */
  async function runAnalysis() {
    if (!active || analyzing) return;
    const run = ++analysisRun.current;
    setAnalyzing(true); setAnalysisError(""); setAnalysisPreview(null);
    try {
      const text = await analyzeCandidate(active, matchItem(active, data.items)?.name);
      if (analysisRun.current === run) setAnalysisPreview(text);
    } catch (error) {
      if (analysisRun.current === run) setAnalysisError(error instanceof Error ? error.message : "AI 分析失败，请重试");
    } finally {
      if (analysisRun.current === run) setAnalyzing(false);
    }
  }
  function saveAnalysis() {
    if (!active || !analysisPreview) return;
    const text = analysisPreview;
    const id = active.id;
    setData(d => ({ ...d, records: d.records.map(r => r.id === id ? { ...r, analysis: text } : r) }));
    setAnalysisPreview(null);
    Taro.showToast({ title: "已保存分析", icon: "none" });
  }
  function openLink(url: string) {
    if (process.env.TARO_ENV === "h5") window.open(url, "_blank", "noopener,noreferrer");
    else Taro.setClipboardData({ data: url });
  }
  async function addImages(record: PurchaseRecord) {
    if (uploading) return;
    if (!API_BASE_URL) { Taro.showToast({ title: "请先连接图片上传服务", icon: "none" }); return; }
    const remaining = MAX_CANDIDATE_IMAGES - (record.images?.length ?? 0);
    if (remaining <= 0) return;
    let paths: string[];
    try { paths = (await Taro.chooseImage({ count: remaining, sizeType: ["compressed"], sourceType: process.env.TARO_ENV === "h5" ? ["album"] : ["album", "camera"] })).tempFilePaths.slice(0, remaining); }
    catch (error) {
      const message = error && typeof error === "object" && "errMsg" in error ? String(error.errMsg) : "";
      if (!/cancel/i.test(message)) Taro.showToast({ title: "无法打开图片选择，请重试", icon: "none" });
      return;
    }
    if (!paths.length) return;
    setUploading(record.id);
    try {
      const results = await Promise.allSettled(paths.map(path => uploadFile(path)));
      const urls = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      if (urls.length) {
        setData(d => ({ ...d, records: d.records.map(r => r.id === record.id ? { ...r, images: [...(r.images ?? []), ...urls].slice(0, MAX_CANDIDATE_IMAGES) } : r) }));
      }
      if (results.some(result => result.status === "rejected")) Taro.showToast({ title: urls.length ? "部分图片上传失败，可重试" : "图片上传失败，请重试", icon: "none" });
    } finally { setUploading(null); }
  }
  function imageView(record: PurchaseRecord, expanded = false) {
    return <CandidateImages images={record.images ?? []} name={record.name} expanded={expanded} busy={Boolean(uploading)} onAdd={() => addImages(record)}
      onRemove={index => setData(d => ({ ...d, records: d.records.map(r => r.id === record.id ? { ...r, images: (r.images ?? []).filter((_, i) => i !== index) } : r) }))}
      onCover={index => setData(d => ({ ...d, records: d.records.map(r => r.id === record.id ? { ...r, images: [r.images![index], ...r.images!.filter((_, i) => i !== index)] } : r) }))} />;
  }
  function notesPanel() {
    return <View className="prep-panel prep-notes">
      <View className="prep-section-head"><Text className="prep-section-title">相关笔记</Text><Action className="rec-text-action" onClick={() => setLinking(true)}>＋ 关联笔记</Action></View>
      <Text className="prep-caption">{item ? `把与${item.name}有关的选购、安装笔记放在这里。` : `把${room}的施工、布局和选配笔记放在一起。`}</Text>
      {related.map(l => <Button ariaRole="button" className="ui-button prep-note-row" key={l.id} onClick={() => setNoteId(l.id)}><View><Text className="prep-note-title">{(l.title || inspiration.displayTitle(l))}</Text><Text className="prep-caption">{l.date} · 笔记库</Text></View><ChevronRight size={16} tone="muted" /></Button>)}
      {!related.length && <Text className="prep-note-empty">{noteLoading ? "正在读取笔记…" : noteError ? "笔记暂时未加载，点关联笔记重试。" : "还没有关联笔记，已有笔记可以直接关联。"}</Text>}
    </View>;
  }
  const compared = candidates.filter(r => selected.includes(r.id));
  const unassigned = data.records.filter(r => r.room === room && !matchItem(r, data.items));
  const syncBusy = phase === "loading" || message === "正在同步…";
  const syncWarning = conflict || phase === "error" || message.includes("失败") || message.includes("尚未同步");
  const syncLabel = phase === "loading" ? "加载中" : syncBusy ? "同步中" : conflict ? "同步冲突" : syncWarning ? "未同步" : "已同步";
  const syncActionLabel = conflict ? "保留草稿并重新加载" : message.includes("尚未同步") ? "重试同步" : "刷新数据";
  const syncControls = API_BASE_URL ? <View className="prep-sync-tools">
    <View className={`prep-sync-status${syncWarning ? " is-warning" : ""}`}><View className="prep-sync-dot" /><Text>{syncLabel}</Text></View>
    <Button ariaRole="button" ariaLabel={syncActionLabel} className="ui-button prep-refresh-button" disabled={syncBusy} onClick={conflict ? reload : message.includes("尚未同步") ? retry : reload}><RefreshCw size={18} tone="muted" /></Button>
  </View> : null;
  if (phase !== "ready") return <Screen page="record" title="装修准备">
    <View className="prep-navline prep-sync-navline">{syncControls}</View>
    <View className="prep-panel"><Text>{phase === "loading" ? "正在加载选购数据…" : message}</Text>
    </View>
  </Screen>;
  return <Screen page="record" title={item?.name ?? room ?? "装修准备"} eyebrow={item ? `${room} · 选配这一项` : room ? "先备齐，再慢慢选好" : "每个房间，一点点准备好"}>
    {syncWarning && <Text className="prep-sync-warning">{message}</Text>}
    <View className="prep-navline prep-sync-navline">
      {room ? <View className="prep-breadcrumb"><Action className="rec-text-action" onClick={() => openRoom(null)}>所有房间</Action>{item && <><Text>/</Text><Action className="rec-text-action" onClick={() => setItemId(null)}>{room}</Action></>}</View> : <Text className="prep-intro">要准备什么、怎么选、注意什么，都按房间放好。</Text>}
      {syncControls}
    </View>
    {!room ? <>
      <View className="prep-home-grid">{["全屋", ...recordRooms.filter(r => r !== "全屋")].map(name => {
        const list = data.items.filter(i => i.room === name && !data.skipped.includes(i.id));
        const decided = list.filter(i => ["已选定", "已买"].includes(progress(i))).length;
        const collecting = list.filter(i => progress(i) === "比较中").length;
        return <Button ariaRole="button" className={`ui-button prep-room-card${name === "全屋" ? " prep-room-whole" : ""}`} key={name} onClick={() => openRoom(name)}>
          <View className="prep-room-top"><Image src={icons[name]} mode="aspectFit" className="prep-room-icon" /><Text className="prep-room-progress">{decided}<Text> / {list.length} 项已定</Text></Text></View>
          <View className="prep-room-bottom"><View><Text className="prep-room-name">{name === "全屋" ? "全屋配置" : name}</Text><Text className="prep-caption">{list.slice(0, 3).map(i => i.name).join(" · ")}</Text></View><ChevronRight size={18} tone="muted" /></View>
          <View className="prep-progress-track"><View style={{ width: `${list.length ? decided / list.length * 100 : 0}%` }} /></View>
          <Text className="prep-room-next">{collecting ? `${collecting} 项正在选配` : "从准备清单开始"}</Text>
        </Button>;
      })}</View>
      <Text className="prep-footnote">准备项是一份可调整的参考清单，按你家的实际需要增减。</Text>
    </> : !item ? <View className="prep-room-layout">
      <View className="prep-panel prep-checklist">
        <View className="prep-section-head"><Text className="prep-section-title">准备清单 <Text className="prep-caption">{roomItems.length} 项</Text></Text><View className="prep-list-actions"><Action className="rec-text-action" onClick={() => setManagingItems(!managingItems)}>{managingItems ? "完成" : "管理"}</Action><Action className="rec-text-action" onClick={() => { setCustomName(""); setCustom(true); }}>＋ 增加一项</Action></View></View>
        <View className="prep-filters">{["全部", "待准备", "比较中", "已选定", "已买"].map(f => <Action key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f}</Action>)}</View>
        {roomItems.filter(i => filter === "全部" || progress(i) === filter).map(i => {
          const state = progress(i); const list = getCandidates(i); const chosen = list.find(r => r.status === "bought" || r.status === "shortlist");
          return <View className="prep-item-entry" key={i.id}><Button ariaRole="button" className={`ui-button prep-item-row${state === "暂不需要" ? " is-skipped" : ""}`} onClick={() => openItem(i)}>
            <View className={`prep-item-marker${["已选定", "已买"].includes(state) ? " is-done" : ""}`}>{["已选定", "已买"].includes(state) ? <Check size={13} tone="white" /> : <View />}</View>
            <View className="prep-item-main"><Text className="prep-item-name">{i.name}</Text><Text className="prep-caption">{chosen ? chosen.name : list.length ? `${list.length} 个候选 · ${list.some(r => r.price !== null) ? "可查看报价与参数" : "报价待补充"}` : `先确认${i.fields.slice(0, 2).join("、")}`}</Text></View>
            {!managingItems && <><Text className={`prep-state${["已选定", "已买"].includes(state) ? " is-done" : ""}`}>{state}</Text><ChevronRight size={15} tone="muted" /></>}
          </Button>{managingItems && <Button ariaRole="button" ariaLabel={`删除${i.name}`} className="ui-button prep-delete-item" onClick={() => removeItem(i)}>删除</Button>}</View>;
        })}
        {!roomItems.length && <View className="prep-empty"><Text>还没有准备项</Text><Text className="prep-caption">点「增加一项」，按这个房间的需要添加。</Text></View>}
        {filter !== "全部" && roomItems.length > 0 && !roomItems.some(i => progress(i) === filter) && <View className="prep-empty"><Text>暂无{filter}的项目</Text><Action className="rec-text-action" onClick={() => setFilter("全部")}>查看全部</Action></View>}
        {unassigned.length > 0 && <View className="prep-unassigned"><Text className="prep-section-title">待归类的随手记</Text>{unassigned.map(r => <Button ariaRole="button" className="ui-button prep-note-row" key={r.id} onClick={() => setDetail(r.id)}><Text>{r.name}</Text><ChevronRight size={16} tone="muted" /></Button>)}</View>}
      </View>
      <View className="prep-aside">{notesPanel()}</View>
    </View> : <View className="prep-room-layout">
      <View className="prep-panel prep-candidates">
        <View className="prep-section-head"><Text className="prep-section-title">候选 <Text className="prep-caption">{candidates.length} 个</Text></Text>{candidates.length >= 2 && <Action className="rec-text-action" onClick={() => { setCompareMode(!compareMode); setSelected([]); }}>{compareMode ? "退出对比" : "对比候选"}</Action>}</View>
        <Text className="prep-caption">先收下候选，参数和报价可以逐步补齐。</Text>
        {candidates.map(r => <View className="prep-candidate" key={r.id}>
          <View className="prep-candidate-content">{imageView(r)}<View className="prep-candidate-info">
          <View className="prep-candidate-head"><Text className="prep-candidate-name">{r.name}</Text><Text className={`prep-state${r.status !== "saved" ? " is-done" : ""}`}>{recordStatusLabels[r.status]}</Text></View>
          <Text className="prep-candidate-price">{money(r)}</Text><Text className="prep-candidate-note">{r.note || "还没有补充商品信息"}</Text>
          </View></View>
          <View className="prep-candidate-actions"><Action className="rec-text-action" onClick={() => setDetail(r.id)}>查看 / 补充信息</Action>{compareMode ? <Action className={selected.includes(r.id) ? "active" : ""} disabled={selected.length >= 3 && !selected.includes(r.id)} onClick={() => toggleCompare(r.id)}>{selected.includes(r.id) ? "已加入对比" : "加入对比"}</Action> : <Action className={r.status === "saved" ? "" : "active"} onClick={() => status(r, r.status === "saved" ? "shortlist" : r.status === "shortlist" ? "bought" : "saved")}>{r.status === "saved" ? "选定这款" : r.status === "shortlist" ? "标记已买" : "恢复为候选"}</Action>}</View>
        </View>)}
        {!candidates.length && <View className="prep-empty"><View className="prep-empty-mark"><Plus size={24} tone="green" /></View><Text className="prep-section-title">还没有{item.name}候选</Text><Text className="prep-caption">发一个商品链接，或记下门店里的报价。</Text><Text className="prep-caption">点右下角 ＋ 添加第一个候选。</Text></View>}
        {compareMode && <View className="prep-compare-bar"><Text>已选 {selected.length} / 3</Text><Action primary disabled={selected.length < 2} onClick={() => setComparing(true)}>查看对比</Action></View>}
      </View>
      <View className="prep-aside">{notesPanel()}</View>
    </View>}
    {!editor && !active && !custom && !linking && !note && !comparing && !specRecord && <Button ariaRole="button" ariaLabel={item ? "添加候选" : "添加选购记录"} className="ui-button fab rec-fab" onClick={() => setEditor("new")}><Plus size={20} tone="white" /></Button>}
    {editor && <Editor startEditing={editor !== "new"} itemName={item?.name} initial={editor === "new" ? undefined : editor} section={editor !== "new" ? editor.section : "soft"} group={room ?? "全屋"} onClose={() => setEditor(null)} onSave={save} />}
    {active && !editor && !specRecord && <Sheet title="候选详情" className="prep-detail-sheet" onClose={() => setDetail(null)} footer={<View className="rec-form-footer prep-candidate-footer prep-single-footer"><Action primary onClick={() => setEditor(active)}>编辑</Action></View>}>
      <View className="prep-detail-summary"><Text className="rec-detail-title">{active.name}</Text><Text className="prep-caption prep-detail-context">{active.room} · {active.category} · {recordStatusLabels[active.status]}</Text><Text className="rec-detail-money">{money(active)}</Text></View>
      {imageView(active, true)}
      {active.note && <Text className="prep-detail-note">{active.note}</Text>}
      {Object.entries(active.specs ?? {}).some(([, value]) => value.trim()) && <View className="prep-detail-specs prep-detail-known-specs">{Object.entries(active.specs ?? {}).filter(([, value]) => value.trim()).map(([field, value]) => <View key={field}><Text>{field}</Text><Text>{value}</Text></View>)}</View>}
      {active.analysis && <View className="prep-analysis-preview"><Text className="prep-section-title">选购分析</Text><Text className="prep-detail-note">{active.analysis.split("\n\n")[0]}</Text></View>}
      {analysisPreview && <View className="prep-analysis-preview prep-analysis-draft"><Text className="prep-section-title">分析预览（还没保存）</Text><Text className="prep-detail-note">{analysisPreview}</Text><Text className="prep-caption">确认后写入这条候选，并同步到其他设备。</Text><View className="rec-ai-options"><Action className="rec-text-action" onClick={saveAnalysis}>保存到这条候选</Action><Action className="rec-text-action" onClick={() => setAnalysisPreview(null)}>放弃</Action></View></View>}
      {analysisError && <Text className="rec-ai-error" ariaRole="alert">{analysisError}</Text>}
      {active.pros && <Text className="prep-detail-observation">优点：{active.pros}</Text>}{active.cons && <Text className="prep-detail-observation">顾虑：{active.cons}</Text>}
      <View className="prep-detail-actions">
        {active.url && <Action className="rec-text-action" onClick={() => openLink(active.url!)}>打开商品链接 ↗</Action>}
        <Action className="rec-text-action" disabled={analyzing} onClick={() => void runAnalysis()}>{analyzing ? "正在分析…" : active.analysis ? "重新分析" : "让小熊分析这款"}</Action>
        <Action className="rec-text-action prep-detail-more" onClick={() => setDetailMore(!detailMore)}>{detailMore ? "收起" : active.analysis ? "完整分析与更多信息" : "更多信息"}</Action>
      </View>
      {detailMore && <View className="prep-detail-extra">
      {active.analysis && <View className="prep-product-analysis"><Text className="prep-section-title">选购分析</Text><Text className="prep-detail-note">{active.analysis.split("\n\n").slice(1).join("\n\n")}</Text>{active.analysisSources?.map(source => <Action key={source.url} className="rec-text-action" onClick={() => openLink(source.url)}>{source.label} ↗</Action>)}</View>}
      <Action className="rec-text-action" onClick={() => { setSpecs(active.specs ?? {}); setSpecRecord(active.id); }}>补充参数</Action>
      {!matchItem(active, data.items) && <><Text className="rec-field-label">归到哪一项？</Text><View className="rec-choice-row">{roomItems.map(i => <Action key={i.id} onClick={() => setData(d => ({ ...d, records: d.records.map(r => r.id === active.id ? { ...r, itemId: i.id } : r) }))}>{i.name}</Action>)}</View></>}
      <Action className="rec-text-action" onClick={() => {
        const removed = active;
        setData(d => ({ ...d, records: d.records.filter(r => r.id !== removed.id) }));
        setSelected(ids => ids.filter(id => id !== removed.id)); setDetail(null);
        Taro.showToast({ title: "已移除候选", icon: "none" });
      }}>移除候选</Action>
      </View>}
    </Sheet>}
    {specRecord && <Sheet title="补充关键参数" editor onClose={() => setSpecRecord(null)} footer={<View className="rec-form-footer prep-single-footer"><Action primary onClick={() => { setData(d => ({ ...d, records: d.records.map(r => r.id === specRecord ? { ...r, specs } : r) })); setSpecRecord(null); }}>保存参数</Action></View>}>{(matchItem(data.records.find(r => r.id === specRecord)!, data.items)?.fields ?? ["规格", "安装要求"]).map(f => <View key={f}><Text className="rec-field-label">{f}</Text><Input ariaLabel={f} className="rec-input" value={specs[f] ?? ""} placeholder="不确定可以先留空" onInput={e => setSpecs(s => ({ ...s, [f]: e.detail.value }))} /></View>)}</Sheet>}
    {custom && <Sheet title={`给${room}增加一项`} onClose={() => setCustom(false)}><Input ariaLabel="准备项名称" className="rec-input" placeholder="比如：浴缸、毛巾架" value={customName} onInput={e => setCustomName(e.detail.value)} /><Action primary disabled={!customName.trim()} onClick={() => {
      if (roomItems.some(i => i.name === customName.trim())) { Taro.showToast({ title: "这项已经在清单里", icon: "none" }); return; }
      const name = customName.trim(); setData(d => ({ ...d, items: [...d.items, { id: `custom-${Date.now()}`, room: room!, name, aliases: [name], fields: ["型号与尺寸", "报价范围", "安装要求"], questions: ["与现场条件是否匹配？"] }] })); setCustom(false);
    }}>加入清单</Action></Sheet>}
    {linking && <Sheet title={`关联到${item?.name ?? room}`} onClose={() => setLinking(false)}><Text className="prep-caption">关联后，原笔记仍保留在笔记库。</Text>{links.map(l => {
      const auto = !item && l.categoryIds.some(id => taggedIds.includes(id));
      const linked = auto || (data.associations[scope] ?? []).includes(l.id);
      return <Button ariaRole="button" className="ui-button prep-note-row" key={l.id} disabled={auto} onClick={() => setData(d => ({ ...d, associations: { ...d.associations, [scope]: linked ? (d.associations[scope] ?? []).filter(id => id !== l.id) : [...(d.associations[scope] ?? []), l.id] } }))}><Text>{(l.title || inspiration.displayTitle(l))}</Text><Text className={`prep-state${linked ? " is-done" : ""}`}>{auto ? "按房间关联" : linked ? "已关联" : "关联"}</Text></Button>;
    })}{!links.length && <View className="prep-empty"><Text>{noteLoading ? "正在读取笔记…" : "还没有可关联的笔记"}</Text><Action onClick={async () => { setNoteLoading(true); try { const [l, c] = await Promise.all([inspiration.fetchLinks(), inspiration.listCategories()]); setLinks(l); setCategories(c); setNoteError(false); } catch { setNoteError(true); } finally { setNoteLoading(false); } }}>重新加载</Action><Action onClick={() => Taro.navigateTo({ url: "/pages/inspiration/index" })}>前往笔记库</Action></View>}</Sheet>}
    {note && <LinkDetailSheet link={note} categories={categories} onClose={() => setNoteId(null)} onChange={next => setLinks(l => l.map(n => n.id === next.id ? next : n))} onDeleted={() => { setLinks(l => l.filter(n => n.id !== note.id)); setNoteId(null); }} />}
    {comparing && item && <Sheet title={`${item.name}候选对比`} wide onClose={() => setComparing(false)}><Text className="prep-caption">价格保留原单位与报价范围，空白信息标为待确认。</Text><View className="prep-table-scroll"><View className="prep-table" style={{ minWidth: `${120 + compared.length * 210}px` }}><View className="prep-table-row"><Text>候选</Text>{compared.map(r => <View key={r.id} className="prep-compare-product">{r.images?.[0] && <Image className="prep-compare-cover" src={r.images[0]} mode="aspectFill" onClick={() => Taro.previewImage({ current: r.images![0], urls: r.images! })} />}<Text>{r.name}</Text></View>)}</View>{[{ label: "报价", value: money }, ...item.fields.map(f => ({ label: f, value: (r: PurchaseRecord) => r.specs?.[f] || "待确认" })), { label: "备注 / 报价范围", value: (r: PurchaseRecord) => r.note || "待确认" }, { label: "优点", value: (r: PurchaseRecord) => r.pros || "待补充" }, { label: "顾虑", value: (r: PurchaseRecord) => r.cons || "待补充" }].map(row => <View className="prep-table-row" key={row.label}><Text>{row.label}</Text>{compared.map(r => <Text key={r.id}>{row.value(r)}</Text>)}</View>)}</View></View></Sheet>}
  </Screen>;
}
