# 09 · 笔记 × Web 联动（Hermes 技能层）

> 2026-10-12 立项。微信双通道打通后的下一步：让 App 笔记（方案库）与 Web 通过
> Hermes 双向联动。前置状态见 08-ai-assistant.md。

## 0. 地基结论

- Hermes 原生自带 `web_search` / `web_extract`（反爬页可 `browser_exec` 兜底），
  「web→笔记」管道材料齐，缺的只是编排
- **社区技能注册表（skills.sh）国内服务器不可达**（`hermes skills search` 挂起实测），
  技能一律自写 SKILL.md，经 bootstrap.sh 注入（与 SOUL.md 同模式）
- MCP `save_link` 只收 url（强制 http(s) 校验）→ **纯想法卡无法经 MCP 创建**，
  想法卡只能 App 手动加；这限制了进料联动先只做链接
- 笔记=方案库 links 表（title/summary/cover/category_ids/status），记录=entries 表（stage 七阶段）

## 1. 四个方向（本期做 A+B）

| 方向 | 内容 | 改动面 | 状态 |
|---|---|---|---|
| A 微信投喂→笔记 | 微信甩链接→save_link 入队→立即处理→回复摘要 | 仅 SOUL.md | 本期 |
| B 网上研究→笔记 | 「帮我研究XX」→ web_search+多页 extract 交叉→结论回复+来源链接入队 | 新技能 bear-research | 本期 |
| C 深加工→结构化 | 队列升级：风格/空间标签+材料清单+可借鉴要点写 link_notes；save_link 扩展 note/title（支持纯想法卡） | MCP 加工具+后端小改 | 待做 |
| D 笔记→web 定向 | 基于某条笔记找同款，结果回评笔记下 | 依赖 C | 待做 |

## 2. 本期实现

### A. SOUL.md 新增「微信进料」
微信收到 http(s) 链接 = 收藏指令：save_link 入队 → 立刻走队列处理流程（不等下次扫描）
→ 微信回复「已存好：标题 — 一句话摘要」。纯文字想法如实说明需在 App 手动加，不假装存。

### B. 技能 bear-research（装修研究员）
- 位置：`server/deploy/hermes/skills/bear-research/SKILL.md`
- 触发：屋主「帮我研究/对比/推荐/查查」类请求
- 流程：拆解对比维度 → 2~4 组中文搜索词 → web_extract 读 2~5 个来源 →
  双源印证才下结论（冲突摆双方）→ 微信回复「结论→依据」→ 关键来源链接 save_link 入队
- 边界：不编价格型号；金额/施工安全提醒找工长确认；单次 ≤10 分钟工具调用量

### 部署
bootstrap.sh 新增技能部署步骤（deploy/hermes/skills/ → 各 profile home 的 skills/），
幂等重跑即生效；SOUL.md 沿用原第 4 步分发。

## 3. 验证记录（2026-10-12 全部通过）

- **技能可见性**：xiongxiong `-z` 问 skills_list → bear-research 在列，用途描述正确 ✅
- **A 链接投喂端到端**：`-z` 投百度百科聚氨酯防水涂料 URL → save_link → web_extract →
  update_link 写回 → 按 SOUL 格式汇报「已存好：标题——摘要」✅（App 里 status=done）
- **B 研究端到端**：`-z`「淋浴房玻璃多厚」→ web_search（国内可用！）+ 多源 extract →
  结论带依据（住小帮/央视网交叉：8mm、防爆膜、自爆率 3‰~5‰）→ 安全提醒 →
  3 条来源 save_link 入队并全部处理成 done ✅
- 微信实发待熊熊/jinmo 实际发链接触发（工具链路同 -z）

### 3.1 链接管道修复：封面统一转存 + MCP 兜底抓取（2026-10-12 下午，已部署）

实投 7 条链接后暴露的解析缺口，已修复并逐条线上验证：

- **裂图根因**：`update_link` 写回的 xhscdn 封面外链按 Referer 防盗链——带线上站
  `http://119.27.191.90` Referer 必 403（localhost/无 Referer 反而 200）；另 bkimg.cdn.bcebos.com
  相反，带小红书 Referer 才 403。→ 修复：`storeRemoteCover()` 转存为 `/files/` 内链
  （空 Referer 优先、失败再试小红书 Referer；`//` 协议相对地址归一化），MCP `update_link`
  与 HTTP `POST /:id/update` 两条写回通道都接入。
- **无封面无兜底根因**：MCP `save_link` 原本只入库不触发抓取，web_extract 拿不到图就空着。
  → 修复：`save_link` 也触发 `queueScrape`（og 元信息垫底+封面转存）；抓取 worker 加
  `status=pending` 守卫，Hermes 认领/写回后服务端不再覆盖（摘要保护实测通过）。
- 边角：转存失败保留外链兜底；`content` 全文字段前端详情弹层暂不渲染（产品决策待定）；
  `POST /:id/reset` 会把 Hermes 摘要重置为 og 摘要，存量慎用。
- 存量修复结果：7 条中 5 条补齐内链封面（webp/jpeg 全部 200），2 条（两篇淋浴房文章）
  页面本身无 og 图、保持无封面；7 条 Hermes 摘要全部完好。

## 4. 实施踩坑（重要）

1. **自定义技能不能放 `skills/` 根下**——该目录被技能 curator 自管理（按活跃度归档/
   剪枝，内置有 manifest 豁免）。正路：放 `<HERMES_HOME>/custom-skills/` +
   config.yaml 设 `skills.external_dirs: ["custom-skills"]`（home 相对路径）
2. **容器内 `hermes config set` 不带 `-p` 会写进 current profile（实测落 jinmo）**——
   default 作用域必须显式 `-p default`（bootstrap.sh hrun 已改）；否则 default 运行会
   静默污染 jinmo 的模型配置
3. **bootstrap 里宿主机/容器路径别混**：SOUL 拷贝走宿主机 `$DIR/hermes-data/...`，
   首版技能部署误用容器内 `$HOME_DIR` 路径跑宿主机 cp，文件进宿主机 /opt/data 黑洞、
   回显还是成功——已改 SKILLS_TARGET 用 $DIR/hermes-data 下路径，宿主机误建 /opt/data 已清
4. `hermes skills search` 依赖 skills.sh，国内不可达会挂起；`skills list` 只是注册表视图，
   自定义技能不在其中（判断要靠 skills_list 工具或直接 -z 问）

