import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
  if (entry.speaker) return entry.speaker
  if (entry.role === 'assistant') return config.assistantLabel || 'Foxy'
  return config.userLabel || 'user'
}

function normalizePlatform(value) {
  const platform = String(value || 'dsh').trim().toLowerCase()
  return platform || 'dsh'
}

function formatEntry(entry, config) {
  const date = new Date(entry.createdAt).toISOString().slice(0, 16).replace('T', ' ')
  const platform = entry.sourceLabel || (entry.platform === 'dsh' ? 'DSH' : entry.platform) || 'DSH'
  return `- [${date}] [${platform}] ${roleSpeaker(entry, config)}: ${entry.content}`
}

export function apply(ctx, config = {}) {
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
    if (!entry.speaker) entry.speaker = entry.role === 'assistant' ? config.assistantLabel || 'Foxy' : config.userLabel || 'user'
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
      input.speaker || (role === 'assistant' ? config.assistantLabel || 'Foxy' : config.userLabel || 'user'),
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

  const dispose = ctx.foxy.registerMemoryProvider('local', async () => provider)
  if (typeof ctx.provide === 'function') ctx.provide('foxyMemory', provider)
  ctx.logger?.info?.(`[dsh-foxy-memory] ready; file=${entriesFile}`)

  return { provider, dispose, reload: async () => { entries.clear(); await init() } }
}
