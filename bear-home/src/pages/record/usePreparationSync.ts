import { useEffect, useRef, useState } from "react";
import Taro from "@tarojs/taro";
import { ApiError, API_BASE_URL } from "../../services/api";
import { fetchPreparation, savePreparation, type PreparationState } from "../../services/preparation";

const STORE = "bear-home-preparation-v1";
export default function usePreparationSync(initial: () => PreparationState, empty: () => PreparationState) {
  const [data, update] = useState(API_BASE_URL ? empty : initial);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">(API_BASE_URL ? "loading" : "ready");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const revision = useRef(0);
  const pending = useRef<PreparationState | null>(null);
  const saving = useRef(false);
  const halted = useRef(false);
  const alive = useRef(true);
  const load = async () => {
    if (saving.current) return;
    setPhase("loading"); setMessage("");
    try {
      const res = await fetchPreparation();
      if (!alive.current) return;
      const draft = Taro.getStorageSync(`${STORE}-pending`);
      revision.current = res.revision; halted.current = false; pending.current = null; setConflict(false);
      if (draft?.data && typeof draft.revision === "number") {
        update(draft.data); pending.current = draft.data; setPhase("ready");
        if (draft.revision !== res.revision) { halted.current = true; setConflict(true); setMessage("其他设备已修改，当前草稿已保留。请重新加载后编辑。"); }
        else void flush();
        return;
      }
      if (res.data) { update(res.data); setPhase("ready"); setMessage("已同步"); }
      else { update(empty()); setPhase("ready"); setMessage("已同步"); }
    } catch { if (alive.current) { setPhase("error"); setMessage("选购数据加载失败，请重试。设备原有数据已保留。"); } }
  };
  useEffect(() => { alive.current = true; if (API_BASE_URL) void load(); return () => { alive.current = false; }; }, []);
  async function flush() {
    if (saving.current || halted.current || !pending.current || !API_BASE_URL) return;
    saving.current = true;
    setMessage("正在同步…");
    try {
      while (pending.current && !halted.current) {
        const snapshot: PreparationState = pending.current;
        const result = await savePreparation(revision.current, snapshot);
        revision.current = result.revision;
        if (pending.current === snapshot) { pending.current = null; Taro.removeStorageSync(`${STORE}-pending`); }
        else Taro.setStorageSync(`${STORE}-pending`, { revision: revision.current, data: pending.current });
      }
      if (alive.current) setMessage("已同步");
    } catch (e) {
      halted.current = true;
      const conflicting = e instanceof ApiError && e.status === 409;
      if (alive.current) { setConflict(conflicting); setMessage(conflicting ? "其他设备已修改，当前草稿已保留。请重新加载后编辑。" : "尚未同步，修改已保留在设备，请重试。"); }
    } finally { saving.current = false; }
  }
  useEffect(() => {
    if (phase !== "ready") return;
    try { Taro.setStorageSync(STORE, { version: 1, ...data }); }
    catch { setMessage("设备缓存写入失败，请保持页面打开。"); }
  }, [data, phase]);
  const setData: typeof update = next => {
    update(old => {
      const value = typeof next === "function" ? next(old) : next;
      if (API_BASE_URL) { pending.current = value;
        try { Taro.setStorageSync(`${STORE}-pending`, { revision: revision.current, data: value }); } catch { setMessage("草稿备份失败，请保持页面打开。"); }
        if (!halted.current) setMessage("正在同步…");
        setTimeout(() => void flush(), 0);
      }
      return value;
    });
  };
  async function reload() {
    if (saving.current) return;
    try { Taro.setStorageSync(`${STORE}-unsynced-backup`, { version: 1, ...data }); }
    catch { setMessage("草稿备份失败，请勿刷新。"); return; }
    Taro.removeStorageSync(`${STORE}-pending`);
    await load();
  }
  return { data, setData, phase, message, conflict, reload, retry: () => { halted.current = false; void flush(); } };
}
