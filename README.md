# dsh-foxy-memory

`dsh-foxy-memory` 是 [`dsh-foxy`](../dsh-foxy) 的可选记忆子插件。它把 Foxy 会话写成本地 JSONL，并在下一轮把最近记忆注入 Foxy 的 persona。

它不依赖 ChatLuna/LivingMemory；这样任何人都可以只装 `dsh-foxy` + `dsh-foxy-memory` 就得到能记住对话的 Foxy。

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

同时通过 `ctx.foxy.registerMemoryProvider('local', ...)` 注册到 Foxy 的 provider 注册表。

## 与 LivingMemory 的关系

这是本地实现，不是 `chatluna-livingmemory` 的替代品，也不直接写它的 `koishi.db`/PGlite 索引。

未来如果要把 DSH 记忆写回 QQ 侧的 `foxy3（Character）` 池，建议单独做一个 Koishi 侧 HTTP/WS 桥，在桥内调用：

```js
ctx.chatluna_living_memory.createMemory(scope, input, speakerKeys)
```

DSH 侧只向桥发送 `record`/`context` 请求。不要直接 INSERT SQLite，否则会绕过 speaker key、profile 和向量索引。

## 安装

```powershell
dsh plugin --profile desktop add "file:D:\path\to\dsh-foxy-memory"
```

需要同时安装 `dsh-foxy`；重启 DSH 后，Foxy 会话会自动使用 `local` provider。

## License

MIT
