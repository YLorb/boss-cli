# 多岗位批量收集实战问题与解决方案（2026-11-09 补充）

> 面向对象：后续接手本仓库收集任务的 Agent / 开发者。
> 定位：本文只记录**本轮实测踩到的坑 + 已验证的修法**，不重复 SOP 本身。SOP 见 `skills/*/references/collect-sop.md`、`multi-job-collection.md`、`non-contact-continuation.md`、`chat-candidate-location.md`。
> 环境：boss-cli `0.6.18-dev.0` + Skill `1.0.27`，`version-check` = `compatible=true`；无凭据 CDP（`BOSS_BROWSER_REMOTE_DEBUGGING_PORT=53470`，Chrome 由计划任务 `BossChromeKeepalive` 保活）。

---

## 0. 一句话结论

本轮 7 类阻塞性故障，**根因集中在"简历弹层生命周期管理"与"页面几何判定"两处**，都与业务逻辑无关。修法已进代码（`src/common/`），不改 CLI 对外协议。凡遇到"简历抓不到 / 截图报错 / 遮挡报错 / 关不掉弹层"，先看第 1、2 节。

---

## 1. 【高】简历弹层关不掉，导致弹层累积、后续全部抓取失败

### 现象

- `action resume` 报 `简历空白点击点未命中当前简历背景`（`src/common/resume_chat_close.ts:30`）。
- 反复重试后弹层越叠越多：实测 `cResumeAll` 从 1 → 4 → 8。
- 残留弹层被撑到 `height=25556`、`y=-12365`，后续任何"取可见 iframe"都命中残留层，报 `截图区域超出当前视口`。

### 根因

1. 关闭依赖"在简历背景空白处点一下"，该点命中判定极不稳定（弹层位置/尺寸随内容变化）。
2. **真正放大故障的是**：截图失败路径**没有执行关闭**。一次失败留下一个弹层，重试再叠一个，误差累积到不可恢复。

### 修法（已进代码）

| 位置 | 改动 |
|---|---|
| `src/common/c_resume_capture.ts:76` | 新增并统一使用 `closeCResumePanel(page)` 作为主关闭路径，空白点击仅作兜底 |
| `src/common/c_resume_capture.ts:186` | **失败路径也关闭**：`try { await closeCResumePanel(page) } catch { /* 保留原始错误，交上层暂停 */ }` |
| `src/common/c_resume_capture.ts:202` | 正常路径收尾同样走 `closeCResumePanel` |

### 给后续 Agent 的操作要求

- **不要**为了"省一次关闭"跳过失败路径的清理；失败的关闭异常**不能覆盖原始错误**（否则会丢失真实失败原因，把业务问题伪装成关闭问题）。
- 若已出现 `cResumeAll >= 3` 或残留层高度异常：**停止自动化，请人工在浏览器里把简历弹层全部关掉**（本轮就是用户手动清理一次才恢复）。不要试图靠脚本连续点击"关掉历史残留"——残留层的关闭按钮可能不在视口内。

---

## 2. 【高】"可见在线简历 iframe"判定错误（active/deactive 类名不可靠）

### 现象

- 报 `可见在线简历 iframe 数量异常`。
- 报 `截图区域超出当前视口`。
- 即使弹层只有 1 个，取到的仍是 `deactive` 残留层里的 iframe（该 iframe 依然 `visible`）。

### 根因

Boss 的简历弹层用 `active` / `deactive` 类名表达"当前活跃"，但**实测该类名与真实可见性不一致**：残留层保持 `deactive` 的同时内部 iframe 仍可 `visible=true`；且 `querySelector` 取"第一个"时经常取到残留层。

### 修法（已进代码）

新增 `src/common/resume_dom_predicates.ts`：

- `LIVE_RESUME_FRAME_FN`：**几何判据**替代类名判据——弹层是否落在视口内、弹层高度是否 > 1.2 倍视口高度。
- `LIVE_RESUME_FRAME_PICK`：取 DOM 中**最后一个**合格 iframe（弹层是后插入的，最后插入的才是当前活跃的）。

调用点：`src/common/c_resume_capture.ts:56-57`（`filter(live)`）、`:108-111`（`frame.evaluateHandle(LIVE_RESUME_FRAME_PICK)`）。

### 给后续 Agent 的操作要求

- 判断"当前活跃简历"一律用几何谓词，**不要**再写 `classList.contains('active')`。
- 需要新增同类判据时，同步放进 `resume_dom_predicates.ts`，避免多处各自实现导致口径漂移。

---

## 3. 【中】固定/吸顶元素被误判为"遮挡"

### 现象

报 `固定/吸顶元素遮挡简历区域…DIV.dialog-wrap active`。实际该元素是弹层自身的容器，不是遮挡物。

### 根因

遮挡扫描遍历所有元素，把**滚动根自身的祖先/容器**、以及 `deactive` 残留层也算成了遮挡来源。

### 修法（已进代码）

`src/common/resume_frame_locator.ts`、`src/common/resume_scroll_capture.ts`：

- 跳过 `deactive` 层内部元素；
- 跳过**滚动根内部**的元素（自己不可能遮挡自己）；
- **滚动根是简历自身文档时，完全不做遮挡判定**（此时任何"固定元素"都来自简历排版本身，如页眉）。

### 给后续 Agent 的操作要求

- 遇到遮挡类报错，先确认报错元素是不是"滚动根内部"或 `deactive` 层；若是，属于已知误判，**不要**通过调阈值绕过。

---

## 3.1 【中】`在线简历截图区域位置或尺寸发生变化`（单次可恢复）

### 现象

`action resume` 返回 `ok:false`，`error.message = 在线简历截图区域位置或尺寸发生变化`；随后 `status` 报 `全局暂停期间禁止继续读取真实页面`（`PhaseDeniedError`）。

### 性质

**这是可恢复的单人故障，不是环境损坏。** 触发原因是滚动截图期间弹层几何发生了位移或缩放（内容重排、图片加载改变高度、视口内滚动条出现等），导致前后帧无法对齐。

### 处置（已验证）

1. `phase.json` 的 `paused` 字段会写入该错误原文，`failures` +1，`current` 停留在该人；
2. `boss flow-resume --json` 解除暂停（等价于 `step.js --resume`）；
3. **对同一人重试 1 次**（重试前必须重新 `chat` 定位，不要复用上一次的页面态）；
4. 重试成功则正常评估；再失败则记 RECHECK，该人重试额度用尽，继续下一人。

本轮实测：李浩东首次失败 → `flow-resume` → 重试成功，耗时约 35s。

### 不要做的事

- 不要连续 `flow-resume` 反复重试同一人（会突破"每人最多重试 1 次"）；
- 不要在暂停态下直接跑 `status`/`chat` 探测页面——会被 `PhaseDeniedError` 拦住，属预期行为；
- 不要把该错误记成"环境问题"从而不计入重试次数（见第 9 节教训）。

---

## 4. 【中】截图重叠校验误拦（分数 DPR 抗锯齿噪声）

### 现象

`简历截图重叠校验失败：内容变化、遮挡或位置不一致`，但 `differentRatio` 仅 0.66%–0.89%（远低于 1.5% 主判据），`meanDifference` 2.01–2.15 却超了 2.0 阈值。实测 4 例。

### 根因

`scale=1.25` 这类**分数 DPR** 下，逐像素差值存在稳定的抗锯齿噪声底，`meanDifference` 对噪声过于敏感；而 `differentRatio`（>20 的强差异像素占比）才是"内容是否真变了"的主判据。

### 修法（已进代码，经用户口径确认）

`src/common/resume_scroll_capture.ts:130`：

```ts
if (samples && (different / samples > 0.015 || absoluteDifference / samples > 3)) throw ...
```

- `differentRatio` 阈值**保持 1.5%**（主判据，不放宽）；
- `meanDifference` 由 `2` **放宽到 `3`**（仅吸收 DPR 噪声）。

### 给后续 Agent 的操作要求

- 放宽的只有"均值噪声容差"，**不是**内容变化容差。若 `differentRatio` 超 1.5%，即使 `meanDifference` 很小也必须判失败——那意味着真的滚动错位或漏内容。
- 若在其它 DPR（如 1.5 / 2.0）出现同类误拦，先记录 `scale` 与两个指标实测值，再决定是否继续放宽；不要直接改成"只看一个指标"。

---

## 5. 【中】搜索框残留关键词，导致候选人列表被上一轮的筛选污染

### 现象

切换岗位后，列表仍被上一个岗位/上一次搜索的关键词过滤，候选人数量与预期不符。

### 修法（已用 CLI 能力，无需改码）

```bash
boss-cli chat-search --clear --expect-keyword "<本轮应有关键词>"
```

`--expect-keyword` 是**断言**而非提示：清除后必须校验到预期关键词，否则失败退出。`step.js` 已内置"自动清残留搜索词"步骤。

### 给后续 Agent 的操作要求

- 这是 `chat-search` 权限：需在 permit 文件（`~/.boss-cli/permits/<岗位名>.json`）中追加 `chat-search`。追加后 `task-init` 会重建 permit，**`targets` 快照仍然保留**，不必重新冻结。
- 不要用"手动清空输入框"方式绕过——那是 DOM 注入，属工具边界外。

---

## 6. 【中】发送门槛过严：collect 轮被要求"已下载简历"

### 现象

collect 轮想把"求简历"话术发出去，被拒：需 `download-confirmed`。但 collect 轮的语义是**先要简历**，此时候选人还没发简历，天然不可能已下载。

### 修法（已进代码，经用户确认）

`src/cli/phase_state.ts:133-136`：collect 轮的 send 门槛由「必须已下载」改为「**本人已评估且 `decisions[id] === 'fit'`**」。

其余门槛不变（`src/cli/phase_state.ts:123-125`）：

- `accept-resume` / `download-resume` / `probe-resume --download`：仍要求 `decisions[id] === 'fit'`（收件/下载前必须完成本轮评估）；
- 非 collect 轮 send：仍要求已评估 + 已联系。

### 给后续 Agent 的操作要求

- 该放宽**只针对 collect 轮的"求简历"发送**，不要据此推断收件/下载门槛也松了。
- 发送前仍必须完成本人评估（`decide.py` 落 `decisions`），否则会被拦——这是设计意图，不是 bug。

---

## 7. 【低】重名候选人：`--info` 唯一匹配行在可视区外

### 现象

`王先生` 在列表里重名 21 条，`--info` 返回的唯一匹配行位于可视区外，无法据此定位。

### 处置（经用户授权）

按用户口径：**标记待核对，继续其余人**（不阻塞整轮）。本轮 2 人（`35457117-0`、`78705456-0`）进入待核对，未消耗整轮时间。

### 注意：与 SOP 的偏差

SOP `chat-candidate-location.md` 要求"重名立即停止"。本轮**未执行立即停止**，属已知偏差，已记入回执。后续 Agent 请二选一并在回执里写明：

1. 严格执行 SOP（立即停止，等人工裁决）；或
2. 经用户显式授权后按"标记待核对 + 继续"，并在回执 `deviations` 字段登记。

不要默认走 2。

---

## 8. 学历口径（本轮新增，务必沿用）

用户口径：**须全日制**。自考 / 成教 / 网教 / 在职在读**一律不计**。

已写入 `~/.boss-cli/jobs/*.json` 的 A1 硬性要求，追加文本：

```
；学历须为全日制（非全日制/自考/成教/网教/在职在读一律不计）
```

给后续 Agent：**不要**因为"学校是 985/211"就放过非全日制；学校档次与学习形式是两个独立维度，分开判。

---

## 9. 流程性偏差登记（本轮实际发生，作为反面示例）

| 偏差 | 实际 | 应然 |
|---|---|---|
| 单人重试次数 | 张烁跑了 **3 次** | 每人最多重试 **1 次**（即最多 2 次尝试） |
| 连续失败熔断 | 未触发 | 连续 **3 人**失败即暂停整轮（`non-contact-continuation.md`） |
| 重名处理 | 未立即停止 | 见第 7 节，需授权或严格执行 |

> 教训：单人重试超限往往发生在"报错看起来是环境问题"的时候。**环境问题也应计入该人的重试次数**——否则一个坏页面会无限消耗重试预算。修复环境后应重新走 `task-init`，而不是对同一人反复跑。

---

## 10. 新增只读跟踪（排查用，不产生副作用）

`BOSS_CLI_TRACE=true` 时以下信息输出到 **stderr**（不污染 stdout 的 JSON 协议）：

| 能力 | 用途 |
|---|---|
| `dom-probe` | 打印候选元素的选择器、几何、可见性、类名，用于定位"为什么取错了 iframe / 为什么报遮挡" |
| `root-choice` | 打印"滚动根"的选取过程与最终选择，用于排查滚动错位 |

排查顺序建议：`root-choice` → `dom-probe` → 再看截图重叠指标。**只读**，可安全在生产环境开着跑。

---

## 11. 快速自检清单（每轮开始前）

1. `version-check` 是否 `compatible=true`；
2. Chrome 是否在线（`BossChromeKeepalive`）；`cResumeAll` 是否 ≤ 1；
3. 当前岗位 permit 是否含 `chat-search`；
4. `jobs/*.json` 的 A1 是否含"全日制"口径；
5. 上一轮是否已 `stop`（`collect` 会话不残留）；
6. 账本 `~/.boss-cli/ledgers/<runId>.json` 与 `phase-state` 的 `targets` 数量是否一致。

---

## 12. 本轮结果快照（供对照）

- 岗位 1「全栈软件开发工程师 _ 西安」：冻结 40 人，处理 38 人 → **fit 1**（侯博 `784755677-0`，四川大学软件工程 985 全日制，Java 全栈 6 年 + Dify/RAG/SpringAI Agent），not-fit 37，待核对 2。
- 淘汰分布：A1 学历/院校不达标 37、A3 城市不符 14、A2 经验不足 1（同一人可命中多条，故合计大于人数）。
- runId：`4c08f23249f4-20261109-061425`；账本：`~/.boss-cli/ledgers/4c08f232….json`，已 `stop`。
- 尚待用户裁决：曹阳（爱立信 / 汇丰是否算大厂）、孙仙杰（天翼电子商务是否算大厂）。
