'use strict'

const assert = require('node:assert/strict')
const { createServer } = require('node:http')

async function main() {
  const calls = []
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const payload = body ? JSON.parse(body) : {}
      calls.push([req.url, payload])
      res.setHeader('content-type', 'application/json')
      if (req.url === '/record') {
        res.end(JSON.stringify({ ok: true, id: 'bridge-1', presetId: payload.presetId, createdAt: new Date().toISOString() }))
      } else if (req.url === '/context') {
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
    dataDir: 'D:\\Documents\\deepseek-harness\\default-workspace\\research\\foxy-memory-test',
  })
  assert.equal(active.name, 'livingmemory')
  assert.equal(providers.has('local'), true)
  assert.equal(providers.has('livingmemory'), true)

  const entry = await active.record({ role: 'user', text: '你好', sessionId: 's1', presetId: 'foxy3' })
  assert.equal(entry.id, 'bridge-1')
  assert.equal(calls[0][0], '/record')
  assert.equal(calls[0][1].text, '你好')
  assert.equal(calls[0][1].presetId, 'foxy3（Character）')

  const text = await active.context({ query: 'DSH', limit: 5, presetId: 'foxy3（Character）' })
  assert.match(text, /桥接成功/)
  assert.equal(calls[1][0], '/context')

  server.close()
  await new Promise((resolve) => server.once('close', resolve))

  const fallback = await active.record({ role: 'assistant', text: '桥挂了也要记住', sessionId: 's1', presetId: 'foxy3（Character）' })
  assert.ok(fallback.id)
  assert.equal(fallback.content, '桥挂了也要记住')

  await instance.reload?.()
  console.log('dsh-foxy-memory bridge provider tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
