import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-foxy-memory'
export const inject = ['foxy']

function resolveDataDir(config) {
  if (typeof config.dataDir === 'string' && config.dataDir.trim()) return config.dataDir.trim()
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'foxy', 'memory')
}

function clip(text, max) {
  const value = String(text || '').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function roleSpeaker(entry, config) {
  const speaker = String(entry.speaker || '').trim()
  if (speaker && speaker !== 'user' && speaker !== 'assistant') return speaker
  if (entry.role === 'assistant') return config.assistantLabel || 'Foxy'
  return config.userLabel || 'kunfox'
}

function normalizePlatform(value) {
  const platform = String(value || 'dsh').trim().toLowerCase()
  return platform || 'dsh'
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function readJsonBody(request) {
  if (typeof request?.json === 'function') {
    try {
      return await request.json()
    } catch {}
  }
  const raw = request?.body
  if (raw && typeof raw.getReader === 'function') {
    const text = await new Response(raw).text()
    return text ? JSON.parse(text) : {}
  }
  if (typeof raw === 'string') return raw ? JSON.parse(raw) : {}
  if (raw && (Buffer.isBuffer(raw) || raw instanceof Uint8Array)) {
    const text = Buffer.from(raw).toString('utf8')
    return text ? JSON.parse(text) : {}
  }
  return {}
}

function formatEntry(entry, config) {
  const date = new Date(entry.createdAt).toISOString().slice(0, 16).replace('T', ' ')
  const platform = entry.sourceLabel || (entry.platform === 'dsh' ? 'DSH' : entry.platform) || 'DSH'
  return `- [${date}] [${platform} 平台] ${roleSpeaker(entry, config)}: ${entry.content}`
}

export function apply(ctx, config = {}) {
  try {
    const settingsFile = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'foxy', 'settings.json')
    const saved = JSON.parse(readFileSync(settingsFile, 'utf8'))
    for (const key of ['provider', 'bridgeUrl', 'bridgeToken', 'bridgePresetId', 'batchSize', 'flushIntervalMs', 'extractModel']) {
      if (saved[key] !== undefined) config[key] = saved[key]
    }
  } catch {}
  config = {
    ...config,
    userLabel: config.userLabel || 'kunfox',
    assistantLabel: config.assistantLabel || 'Foxy',
  }
  const dataDir = resolveDataDir(config)
  const entriesFile = join(dataDir, config.entriesFile || 'entries.jsonl')
  const maxEntries = Math.max(1, Number(config.maxEntries) || 5000)
  const maxContentChars = Math.max(200, Number(config.maxContentChars) || 4000)
  const maxContextEntries = Math.max(1, Number(config.maxContextEntries) || 20)
  const maxContextChars = Math.max(500, Number(config.maxContextChars) || 6000)

  const entries = new Map()
  let ready = null

  async function rewrite() {
    const temp = `${entriesFile}.tmp`
    const body = [...entries.values()].map((entry) => JSON.stringify(entry)).join('\n')
    await writeFile(temp, body ? `${body}\n` : '', 'utf8')
    await rename(temp, entriesFile)
  }

  function normalize(entry) {
    if (!entry || !entry.id || !entry.content) return null
    entry.type ||= 'conversation'
    entry.status ||= 'active'
    entry.platform = normalizePlatform(entry.platform)
    entry.sourceLabel ||= entry.platform === 'dsh' ? 'DSH' : entry.platform
    entry.keywords = Array.isArray(entry.keywords) ? entry.keywords : []
    entry.summary ||= ''
    entry.importance = Number(entry.importance) || 0.5
    entry.createdAt = Number(entry.createdAt) || Date.now()
    entry.updatedAt = Number(entry.updatedAt) || entry.createdAt
    if (!entry.speaker) entry.speaker = entry.role === 'assistant' ? config.assistantLabel || 'Foxy' : config.userLabel || 'kunfox'
    return entry
  }

  async function init() {
    await mkdir(dataDir, { recursive: true })
    try {
      const text = await readFile(entriesFile, 'utf8')
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const entry = normalize(JSON.parse(line))
          if (entry) entries.set(entry.id, entry)
        } catch {
          // Skip a damaged line rather than losing the whole archive.
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  ready = init().catch((error) => {
    ctx.logger?.warn?.(`[dsh-foxy-memory] failed to load ${entriesFile}: ${error instanceof Error ? error.message : String(error)}`)
  })

  async function reload() {
    entries.clear()
    await init()
  }

  async function record(input = {}) {
    await ready
    const role = input.role === 'assistant' ? 'assistant' : input.role === 'user' ? 'user' : ''
    if (!role) throw new TypeError('memory role must be user or assistant')
    const content = clip(input.text, maxContentChars)
    if (!content) return null

    const presetId = String(input.presetId || 'foxy3')
    const sessionId = String(input.sessionId || '')
    const platform = normalizePlatform(input.platform || input.sourceLabel)
    const sourceLabel = input.sourceLabel || (platform === 'dsh' ? 'DSH' : platform)
    const speaker = String(
      input.speaker || (role === 'assistant' ? config.assistantLabel || 'Foxy' : config.userLabel || 'kunfox'),
    )
    const last = [...entries.values()].at(-1)
    if (
      last &&
      last.role === role &&
      last.presetId === presetId &&
      last.sessionId === sessionId &&
      last.platform === platform &&
      last.content === content &&
      Math.abs(Number(input.at || Date.now()) - last.createdAt) < 1000
    ) {
      return last
    }

    const now = Number(input.at) || Date.now()
    const entry = normalize({
      id: randomUUID(),
      presetId,
      sessionId,
      platform,
      sourceLabel,
      speaker,
      role,
      type: 'conversation',
      status: 'active',
      content,
      keywords: Array.isArray(input.keywords) ? input.keywords : [],
      summary: '',
      importance: role === 'assistant' ? 0.4 : 0.5,
      createdAt: now,
      updatedAt: now,
    })
    entries.set(entry.id, entry)
    await appendFile(entriesFile, `${JSON.stringify(entry)}\n`, 'utf8')

    let trimmed = false
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
      trimmed = true
    }
    if (trimmed) await rewrite()
    return entry
  }

  async function context(input = {}) {
    await ready
    const presetId = String(input.presetId || 'foxy3')
    const limit = Math.min(maxContextEntries, Math.max(1, Number(input.limit) || maxContextEntries))
    const picked = [...entries.values()]
      .filter((entry) => entry.presetId === presetId && entry.status === 'active')
      .slice(-limit)
    if (!picked.length) return ''

    const lines = []
    let size = 0
    for (const entry of picked.reverse()) {
      const line = formatEntry(entry, config)
      if (size + line.length > maxContextChars) break
      lines.push(line)
      size += line.length + 1
    }
    return lines.reverse().join('\n')
  }

  async function list(input = {}) {
    await ready
    const presetId = input.presetId === undefined ? undefined : String(input.presetId)
    const status = input.status === undefined ? 'active' : String(input.status)
    const limit = Math.min(500, Math.max(1, Number(input.limit) || 50))
    return [...entries.values()]
      .filter((entry) => (presetId === undefined || entry.presetId === presetId) && (status === '*' || entry.status === status))
      .slice(-limit)
  }

  async function search(query, input = {}) {
    await ready
    const needle = String(query || '').trim().toLowerCase()
    if (!needle) return []
    const presetId = input.presetId === undefined ? undefined : String(input.presetId)
    const limit = Math.min(200, Math.max(1, Number(input.limit) || 20))
    return [...entries.values()]
      .filter((entry) => entry.status === 'active')
      .filter((entry) => presetId === undefined || entry.presetId === presetId)
      .filter((entry) =>
        `${entry.content}\n${entry.keywords.join(' ')}\n${entry.platform}\n${entry.speaker}`.toLowerCase().includes(needle),
      )
      .slice(-limit)
      .reverse()
  }

  async function archive(id) {
    await ready
    const entry = entries.get(String(id))
    if (!entry) return null
    entry.status = 'archived'
    entry.updatedAt = Date.now()
    await rewrite()
    return entry
  }

  function stats() {
    const byPreset = {}
    const byPlatform = {}
    for (const entry of entries.values()) {
      byPreset[entry.presetId] ??= { active: 0, archived: 0 }
      byPreset[entry.presetId][entry.status === 'archived' ? 'archived' : 'active'] += 1
      byPlatform[entry.platform] ??= { active: 0, archived: 0 }
      byPlatform[entry.platform][entry.status === 'archived' ? 'archived' : 'active'] += 1
    }
    return { dataDir, entriesFile, total: entries.size, byPreset, byPlatform }
  }

  const provider = Object.freeze({
    name: 'local',
    version: 1,
    record,
    context,
    list,
    search,
    archive,
    stats,
  })

  const bridgeUrl = String(config.bridgeUrl || '').trim().replace(/\/+$/, '')
  const bridgeToken = String(config.bridgeToken || '').trim()
  const bridgePresetId = String(config.bridgePresetId || config.presetId || 'foxy3（Character）')
  const bridgeTimeoutMs = Math.max(1000, Number(config.bridgeTimeoutMs) || 15000)

  const batchSize = Math.max(1, Number(config.batchSize) || 8)
  const flushIntervalMs = Math.max(1000, Number(config.flushIntervalMs) || 30000)
  const pendingBySession = new Map()
  let flushTimer

  function pendingFor(sessionId) {
    const key = String(sessionId || 'default')
    if (!pendingBySession.has(key)) pendingBySession.set(key, [])
    return pendingBySession.get(key)
  }

  async function flushSession(sessionId) {
    const key = String(sessionId || 'default')
    const messages = pendingBySession.get(key)
    if (!messages?.length) return { created: 0 }
    try {
      const first = messages[0] || {}
      const result = await bridgePost('/ingest', {
        presetId: bridgePresetId,
        sessionId: key,
        scene: first.scene || 'dsh',
        platform: first.platform || 'dsh',
        channelType: first.channelType || 'private',
        channelId: first.channelId || key,
        eventType: first.eventType || 'conversation',
        sourceLabel: first.sourceLabel || 'DSH',
        messages,
      })
      pendingBySession.delete(key)
      ctx.logger?.info?.(`[dsh-foxy-memory] flushed ${messages.length} messages -> ${result.created || 0} memories`)
      return result
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-foxy-memory] ingest failed; keeping ${messages.length} pending: ${error instanceof Error ? error.message : String(error)}`)
      if (messages.length > 200) messages.splice(0, messages.length - 200)
      return { created: 0, pending: messages.length }
    }
  }

  async function flushAll() {
    for (const key of [...pendingBySession.keys()]) await flushSession(key)
  }

  async function bridgePost(path, body = {}) {
    if (!bridgeUrl) throw new Error('foxy-memory bridgeUrl is not configured')
    const url = new URL(`${bridgeUrl}${path}`)
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue
      if (typeof value === 'object') continue
      if (String(value).trim()) url.searchParams.set(key, String(value))
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(bridgeToken ? { authorization: `Bearer ${bridgeToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(bridgeTimeoutMs),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `bridge HTTP ${response.status}`)
    }
    return data
  }

  const bridgeProvider = bridgeUrl
    ? Object.freeze({
        name: 'livingmemory',
        version: 1,
        async record(input = {}) {
          const sessionId = String(input.sessionId || 'default')
          const messages = pendingFor(sessionId)
          messages.push({
            role: input.role,
            text: input.text,
            at: input.at || Date.now(),
            scene: input.scene || 'dsh',
            platform: input.platform || 'dsh',
            sourceLabel: input.sourceLabel || 'DSH',
            eventType: input.eventType || 'conversation',
            channelType: input.channelType || 'private',
            channelId: input.channelId || sessionId,
            title: input.title || '',
            url: input.url || '',
          })
          if (messages.length >= batchSize) await flushSession(sessionId)
          return {
            id: `pending:${sessionId}`,
            presetId: bridgePresetId,
            platform: input.platform || 'dsh',
            sourceLabel: input.sourceLabel || 'DSH',
            role: input.role,
            content: input.text,
            createdAt: Number(new Date(input.at)) || Date.now(),
            pending: messages.length,
          }
        },
        async context(input = {}) {
          try {
            const result = await bridgePost('/context', {
              presetId: bridgePresetId,
              sessionId: input.sessionId,
              query: input.query || 'DSH',
              limit: input.limit,
            })
            if (result.text) return result.text
          } catch (error) {
            ctx.logger?.warn?.(`[dsh-foxy-memory] bridge context failed, falling back to local: ${error instanceof Error ? error.message : String(error)}`)
          }
          return context(input)
        },
        async list(input = {}) {
          try {
            const result = await bridgePost('/list', {
              presetId: input.presetId || bridgePresetId,
              platform: input.platform,
              status: input.status || 'active',
              keyword: input.keyword,
              page: input.page || 1,
              pageSize: input.limit || input.pageSize || 50,
            })
            return Array.isArray(result.items) ? result.items : []
          } catch (error) {
            ctx.logger?.warn?.(`[dsh-foxy-memory] bridge list failed, falling back to local: ${error instanceof Error ? error.message : String(error)}`)
            return list(input)
          }
        },
        async search(query, input = {}) {
          try {
            const result = await bridgePost('/search', {
              presetId: input.presetId || bridgePresetId,
              query,
              platform: input.platform,
              limit: input.limit || 20,
            })
            return Array.isArray(result.memories) ? result.memories : []
          } catch (error) {
            ctx.logger?.warn?.(`[dsh-foxy-memory] bridge search failed, falling back to local: ${error instanceof Error ? error.message : String(error)}`)
            return search(query, input)
          }
        },
        archive,
        stats() {
          const pending = [...pendingBySession.values()].reduce((sum, list) => sum + list.length, 0)
          return { ...stats(), provider: 'livingmemory', bridgeUrl, bridgePresetId, pending }
        },
      })
    : null

  const requested = String(config.provider || (bridgeProvider ? 'livingmemory' : 'local'))
  const active = requested === 'livingmemory' && bridgeProvider ? bridgeProvider : provider

  const disposeLocal = ctx.foxy.registerMemoryProvider('local', async () => provider)
  const disposeBridge = bridgeProvider
    ? ctx.foxy.registerMemoryProvider('livingmemory', async () => bridgeProvider)
    : null
  flushTimer = setInterval(() => { void flushAll() }, flushIntervalMs)
  flushTimer.unref?.()

  if (typeof ctx.provide === 'function') ctx.provide('foxyMemory', active)
  ctx.logger?.info?.(`[dsh-foxy-memory] ready; provider=${active.name}; file=${entriesFile}${bridgeUrl ? `; bridge=${bridgeUrl}` : ''}`)

  ctx.inject?.(['connection'], (host) => {
    const register = host?.connection?.fetch?.register
    if (typeof register !== 'function') return
    const route = (path, methods, handler) =>
      register({
        path,
        methods,
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            return await handler(request)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            ctx.logger?.warn?.(`[dsh-foxy-memory] ${path} failed: ${message}`)
            return json({ ok: false, error: message }, 500)
          }
        },
      })

    route('/api/dsh-foxy-memory/stats', ['GET'], async () =>
      json({ ok: true, stats: typeof active.stats === 'function' ? active.stats() : {} }),
    )

    route('/api/dsh-foxy-memory/list', ['GET'], async (request) => {
      const url = new URL(request.url, 'http://dsh.local')
      const input = {
        presetId: url.searchParams.get('presetId') || undefined,
        platform: url.searchParams.get('platform') || undefined,
        status: url.searchParams.get('status') || 'active',
        keyword: url.searchParams.get('keyword') || undefined,
        page: Number(url.searchParams.get('page')) || 1,
        limit: Number(url.searchParams.get('pageSize')) || 50,
      }
      const items = await active.list(input)
      return json({ ok: true, items, total: items.length, stats: typeof active.stats === 'function' ? active.stats() : {} })
    })

    route('/api/dsh-foxy-memory/search', ['GET'], async (request) => {
      const url = new URL(request.url, 'http://dsh.local')
      const query = url.searchParams.get('q') || ''
      const input = {
        presetId: url.searchParams.get('presetId') || undefined,
        platform: url.searchParams.get('platform') || undefined,
        limit: Number(url.searchParams.get('limit')) || 20,
      }
      const items = query ? await active.search(query, input) : []
      return json({ ok: true, items, total: items.length })
    })

    route('/api/dsh-foxy-memory/archive', ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const id = String(body.id || '').trim()
      if (!id) return json({ ok: false, error: '缺少记忆 ID' }, 400)
      const item = await active.archive(id)
      if (!item) return json({ ok: false, error: '记忆不存在' }, 404)
      return json({ ok: true, item })
    })

    route('/api/dsh-foxy-memory/reload', ['POST'], async () => {
      if (active.name === 'local') await reload()
      return json({ ok: true })
    })
  })

  return {
    provider: active,
    dispose: () => {
      clearInterval(flushTimer)
      void flushAll()
      disposeLocal()
      disposeBridge?.()
    },
    reload,
  }
}

