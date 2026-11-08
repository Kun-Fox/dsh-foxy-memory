# dsh-foxy-memory

`dsh-foxy-memory` 是 [`dsh-foxy`](../dsh-foxy) 的可选记忆子插件。它把 Foxy 会话写成本地 JSONL，并在下一轮把最近记忆注入 Foxy 的 persona。

它本身不依赖 ChatLuna/LivingMemory；只装 `dsh-foxy` + `dsh-foxy-memory` 就能得到能记住对话的 Foxy。

## 依赖关系

- 必需：`dsh-foxy`（提供 `foxyMemory` 扩展契约）。
- 可选：`koishi-plugin-chatluna-foxy-memory`（QQ 侧/跨平台记忆中枢）。把 provider 设为 `livingmemory`，`bridgeUrl` 指向新插件的 `/foxy-memory`；它直接读写 Koishi 数据库与向量索引，不再需要旧 `koishi-plugin-foxy-memory-bridge` 进程。
- 平台子插件 `dsh-foxy-bili` / `dsh-foxy-weibo` 会把事件写入本插件暴露的 `foxyMemory` provider。

## 记录格式

默认文件：

```text
%USERPROFILE%\.dsh\foxy\memory\entries.jsonl
```

每条记录：

```json
{
  "id": "uuid",
  "presetId": "foxy3",
  "sessionId": "session-id",
  "platform": "dsh",
  "sourceLabel": "DSH",
  "speaker": "kunfox",
  "role": "user",
  "type": "conversation",
  "status": "active",
  "content": "今天在 DSH 做了……",
  "keywords": [],
  "summary": "",
  "importance": 0.5,
  "createdAt": 1790000000000,
  "updatedAt": 1790000000000
}
```

注入时会格式化成：

```text
- [2026-11-06 20:00] [DSH] kunfox: 今天在 DSH 做了……
- [2026-11-06 20:00] [DSH] Foxy: 记住啦。
```

`platform` 统一小写（`dsh`），显示时用 `sourceLabel`（如 `DSH`）；`presetId` 允许 Foxy 主预设和 Character 预设分开存档。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `dataDir` | `$DSH_HOME/foxy/memory` | 数据目录 |
| `entriesFile` | `entries.jsonl` | 文件名 |
| `maxEntries` | `5000` | 超过后丢弃最旧记录 |
| `maxContentChars` | `4000` | 单条内容截断 |
| `maxContextEntries` | `20` | 最多注入条数 |
| `maxContextChars` | `6000` | 注入内容总字符上限 |
| `userLabel` | `kunfox` | 用户显示名 |
| `assistantLabel` | `Foxy` | 助手显示名 |
| `provider` | `livingmemory`（配置 bridgeUrl 时）/ `local` | 记忆写到哪个 provider |
| `bridgeUrl` | 空 | 新插件地址，如 `http://127.0.0.1:5140/foxy-memory` |
| `bridgeToken` | 空 | 与新插件 `foxyApiToken` 一致；公网部署必须设置 |
| `bridgePresetId` | `foxy3（Character）` | 写入 LivingMemory 的 preset |
| `bridgeTimeoutMs` | `15000` | 桥请求超时 |
| `batchSize` | `8` | 累积多少条消息后调用 `/ingest` |
| `flushIntervalMs` | `30000` | 未满一批时的定时冲刷间隔 |
| `extractModel` | `deepseek/deepseek-flash` | 桥提取记忆使用的模型 |

DSH 侧不再逐条写记忆：`record` 只把消息放进 pending，满 `batchSize` 或到 `flushIntervalMs` 时调用桥的 `/ingest`，由模型提炼成中文第一人称记忆。`stats()` 会显示 `pending`。

Foxy 面板的「记忆桥设置」可以修改这些值，保存到 `$DSH_HOME/foxy/settings.json`；插件启动时读取，保存后尝试热重载。`/api/dsh-foxy/settings` 在 DSH host 内提供。

## 服务

加载后提供：

```js
ctx.foxyMemory.record({ role, text, presetId, sessionId, platform, speaker })
ctx.foxyMemory.context({ presetId, limit })
ctx.foxyMemory.list({ presetId, status, limit })
ctx.foxyMemory.search(query, { presetId })
ctx.foxyMemory.archive(id)
ctx.foxyMemory.stats()
```

同时通过 `ctx.foxy.registerMemoryProvider('local', ...)` 和（配置了桥时）`registerMemoryProvider('livingmemory', ...)` 注册到 Foxy 的 provider 注册表。

## 与 Foxy Memory 的关系

本地 JSONL 是默认实现，适合只装 DSH、不接 QQ 的场景。它不会自动写入 Koishi 的 `koishi.db` 或 PGlite 向量索引。

如果需要 DSH 与 QQ 共用同一套跨平台记忆，安装并配置 [`koishi-plugin-chatluna-foxy-memory`](../koishi-plugin-chatluna-foxy-memory)：

```yaml
# DSH 侧 dsh-foxy-memory 配置
provider: livingmemory
bridgeUrl: http://127.0.0.1:5140/foxy-memory
bridgeToken: 与新插件 foxyApiToken 一致的随机串
bridgePresetId: foxy3（Character）
```

新插件的 `/foxy-memory/record|ingest|context|list|search|health` 直接操作 Koishi 数据库、用户画像与向量索引。DSH 侧只发 HTTP 请求，不再启动旧 `koishi-plugin-foxy-memory-bridge`。

迁移时保留原 `living_memory_*` 表与 PGlite 目录；新插件就是同一套表结构的兼容 fork，不需要导出/导入 JSONL。切换前先备份 `koishi.db` 与向量目录，再开启 `foxyApiEnabled`。桥不可用时会自动回退本地 JSONL，不会丢消息。

## 安装

```powershell
dsh plugin --profile desktop add "file:D:\path\to\dsh-foxy-memory"
```

需要同时安装 `dsh-foxy`；重启 DSH 后，Foxy 会话会使用当前 provider。默认是本地 JSONL；配置 `bridgeUrl` 后默认切到 LivingMemory 桥（也可显式 `provider: local` 保持本地）。

## License

MIT
