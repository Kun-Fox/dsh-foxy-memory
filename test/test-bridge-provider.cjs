'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createServer } = require('node:http')

function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - startedAt > timeoutMs) return reject(new Error('waitFor timeout'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

async function main() {
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-foxy-memory-test-'))
  const calls = []
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const payload = body ? JSON.parse(body) : {}
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname
      calls.push([pathname, payload])
      res.setHeader('content-type', 'application/json')
      if (pathname === '/ingest') {
        res.end(JSON.stringify({ ok: true, created: (payload.messages || []).length }))
      } else if (pathname === '/context') {
        res.end(JSON.stringify({ ok: true, text: '- [2026-11-06 20:00] [DSH] kunfox 在 DSH 说：桥接成功' }))
      } else if (pathname === '/list') {
        res.end(JSON.stringify({
          ok: true,
          items: [{ id: 'remote-1', content: '远程记忆', platform: 'qq', updatedAt: '2026-11-24T12:00:00.000Z' }],
          total: 143,
          facets: { platforms: { qq: 100, weibo: 20, bilibili: 10, dsh: 13 } },
        }))
      } else if (pathname === '/search') {
        res.end(JSON.stringify({ ok: true, memories: [{ id: 'remote-2', content: '搜索结果' }] }))
      } else if (pathname === '/presets') {
        res.end(JSON.stringify({ ok: true, presets: ['foxy3（Character）', 'foxy3'], defaultPreset: 'foxy3' }))
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ ok: false, error: 'not found' }))
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  const providers = new Map()
  const routes = new Map()
  let active
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    inject(ids, callback) {
      callback({ connection: { fetch: { register(route) { routes.set(route.path, route.fetch) } } } })
    },
    foxy: {
      registerMemoryProvider(name, factory) {
        providers.set(name, factory)
        return () => providers.delete(name)
      },
    },
    provide(name, value) { active = value },
  }

  const mod = await import('../lib/index.js')
  const instance = mod.apply(ctx, {
    provider: 'livingmemory',
    bridgeUrl: `http://127.0.0.1:${port}`,
    bridgeToken: 'test-token',
    bridgePresetId: 'foxy3（Character）',
    batchSize: 2,
    flushIntervalMs: 60000,
    dataDir: 'D:\\Documents\\deepseek-harness\\default-workspace\\research\\foxy-memory-test',
  })
  assert.equal(active.name, 'livingmemory')
  assert.equal(providers.has('local'), true)
  assert.equal(providers.has('livingmemory'), true)

  // 启动时自动同步一次 Koishi 记忆池，页面总数与来源平台来自桥。
  await waitFor(() => active.stats().syncedAt > 0)
  assert.equal(active.stats().total, 143)
  assert.equal(active.stats().platforms.qq, 100)
  assert.equal(active.stats().provider, 'livingmemory')

  calls.length = 0
  await active.record({
    role: 'user',
    text: '你好',
    sessionId: 's1',
    presetId: 'foxy3',
    speakerKey: 'weibo:6200420068',
    speakerLabel: 'kunfox',
  })
  assert.equal(calls.length, 0)
  await active.record({ role: 'assistant', text: '我在', sessionId: 's1', presetId: 'foxy3' })
  const ingest = calls.find(([pathname]) => pathname === '/ingest')
  assert.ok(ingest, 'expect ingest call')
  assert.equal(ingest[1].presetId, 'foxy3（Character）')
  assert.equal(ingest[1].messages.length, 2)
  assert.equal(ingest[1].messages[0].text, '你好')
  assert.equal(ingest[1].messages[0].speakerKey, 'weibo:6200420068')
  assert.equal(ingest[1].messages[0].speakerLabel, 'kunfox')

  // 回忆必须落在已链接的 Koishi 预设池，而不是 DSH 的人格 presetId。
  const text = await active.context({ query: 'DSH', limit: 5, presetId: 'foxy3' })
  assert.match(text, /桥接成功/)
  const contextCall = calls.findLast(([pathname]) => pathname === '/context')
  assert.equal(contextCall[1].presetId, 'foxy3（Character）')
  assert.equal(contextCall[1].query, 'DSH')

  // 不带 query 的回忆取 Koishi 最新记忆，不再伪造 "DSH" 检索词。
  const recent = await active.context({ limit: 5, presetId: 'foxy3' })
  assert.match(recent, /远程记忆/)
  assert.match(recent, /2026-11-24 12:00 QQ/)
  const listCall = calls.findLast(([pathname]) => pathname === '/list')
  assert.equal(listCall[1].presetId, 'foxy3（Character）')
  assert.equal(listCall[1].status, 'active')

  const listed = await active.list({ presetId: 'foxy3', platform: 'weibo' })
  assert.equal(listed[0].id, 'remote-1')
  const filteredList = calls.findLast(([pathname]) => pathname === '/list')
  assert.equal(filteredList[1].platform, 'weibo')
  assert.equal(filteredList[1].presetId, 'foxy3（Character）')

  const searched = await active.search('微博', { presetId: 'foxy3' })
  assert.equal(searched[0].id, 'remote-2')
  const searchCall = calls.findLast(([pathname]) => pathname === '/search')
  assert.equal(searchCall[1].presetId, 'foxy3（Character）')

  const presets = await active.listPresets()
  assert.deepEqual(presets.presets, ['foxy3（Character）', 'foxy3'])
  assert.equal(presets.currentPreset, 'foxy3（Character）')
  const linked = await active.linkPreset('foxy3')
  assert.deepEqual(linked, { ok: true, presetId: 'foxy3' })
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.DSH_HOME, 'foxy', 'settings.json'), 'utf8'))
  assert.equal(saved.bridgePresetId, 'foxy3')
  await waitFor(() => calls.some(([pathname, payload]) => pathname === '/list' && payload.presetId === 'foxy3'))

  // 记忆页路由返回 Koishi 的真实总数，而不是本地 JSONL 条数。
  const listRoute = await routes.get('/api/dsh-foxy-memory/list')(new Request('http://x/api/dsh-foxy-memory/list?pageSize=100'))
  const listBody = await listRoute.json()
  assert.equal(listBody.ok, true)
  assert.equal(listBody.items.length, 1)
  assert.equal(listBody.total, 143)
  assert.equal(listBody.stats.total, 143)
  assert.ok(listBody.stats.syncedAt > 0)

  const statsRoute = await routes.get('/api/dsh-foxy-memory/stats')(new Request('http://x/api/dsh-foxy-memory/stats'))
  const statsBody = await statsRoute.json()
  assert.equal(statsBody.stats.provider, 'livingmemory')
  assert.equal(statsBody.stats.total, 143)

  const presetRoute = await routes.get('/api/dsh-foxy-memory/presets')(new Request('http://x/api/dsh-foxy-memory/presets'))
  const presetBody = await presetRoute.json()
  assert.equal(presetBody.ok, true)
  assert.equal(presetBody.currentPreset, 'foxy3')
  const linkRoute = await routes.get('/api/dsh-foxy-memory/presets/link')(new Request('http://x/api/dsh-foxy-memory/presets/link', {
    method: 'POST',
    body: JSON.stringify({ presetId: 'foxy3（Character）' }),
  }))
  const linkBody = await linkRoute.json()
  assert.equal(linkBody.ok, true)
  assert.equal(linkBody.presetId, 'foxy3（Character）')

  await new Promise((resolve) => server.close(resolve))
  await active.record({ role: 'user', text: '桥挂了也要记住', sessionId: 's2' })
  await active.record({ role: 'assistant', text: '记着', sessionId: 's2' })
  assert.ok(active.stats().pending >= 2)

  await instance.reload?.()
  instance.dispose?.()
  console.log('dsh-foxy-memory bridge provider tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
