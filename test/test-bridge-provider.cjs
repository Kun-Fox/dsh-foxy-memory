'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createServer } = require('node:http')

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
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ ok: false, error: 'not found' }))
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  const providers = new Map()
  let active
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
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

  await active.record({ role: 'user', text: '你好', sessionId: 's1', presetId: 'foxy3' })
  assert.equal(calls.length, 0)
  await active.record({ role: 'assistant', text: '我在', sessionId: 's1', presetId: 'foxy3' })
  assert.equal(calls[0][0], '/ingest')
  assert.equal(calls[0][1].presetId, 'foxy3（Character）')
  assert.equal(calls[0][1].messages.length, 2)
  assert.equal(calls[0][1].messages[0].text, '你好')

  const text = await active.context({ query: 'DSH', limit: 5, presetId: 'foxy3（Character）' })
  assert.match(text, /桥接成功/)
  assert.equal(calls[1][0], '/context')
  assert.equal(calls[1][1].presetId, 'foxy3（Character）')

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
