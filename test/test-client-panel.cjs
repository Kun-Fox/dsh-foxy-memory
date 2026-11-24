'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 用最小 React/hooks 替身渲染记忆面板，验证挂载后会定时刷新桥数据。
async function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  const requests = []
  const intervals = []
  const listeners = new Map()
  let factory

  const document = {
    hidden: false,
    head: { appendChild() {} },
    createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
    addEventListener(name, handler) { listeners.set(name, handler) },
    removeEventListener(name) { listeners.delete(name) },
  }

  const window = {
    __ModuleLoader__: { load(entry) { factory = entry.factory } },
    __FOXY_CONSOLE__: { pages: [], listeners: new Set() },
    setInterval(handler, ms) {
      intervals.push(ms)
      window.__intervalHandler = handler
      return intervals.length
    },
    clearInterval() {},
  }

  async function fetch(url) {
    requests.push(String(url))
    if (String(url).includes('/presets')) {
      return { ok: true, json: async () => ({ ok: true, presets: ['foxy3（Character）'], currentPreset: 'foxy3（Character）' }) }
    }
    return {
      ok: true,
      json: async () => ({
        ok: true,
        items: [{ id: 'remote-1', content: '远程记忆', platform: 'qq', createdAt: 1 }],
        total: 143,
        stats: { total: 143, syncedAt: 1790000000000, provider: 'livingmemory' },
      }),
    }
  }

  const hookStates = []
  const hookRefs = []
  const effects = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const index = hookStates.length
      hookStates.push(typeof initial === 'function' ? initial() : initial)
      const set = (value) => {
        hookStates[index] = typeof value === 'function' ? value(hookStates[index]) : value
      }
      return [hookStates[index], set]
    },
    useRef(initial) {
      const index = hookRefs.length
      hookRefs.push({ current: initial })
      return hookRefs[index]
    },
    useCallback: (fn) => fn,
    useEffect(fn) { effects.push(fn) },
  }

  const sandbox = { window, document, fetch, console, URLSearchParams, setTimeout, clearTimeout }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  const module = factory((id) => {
    if (id === 'react') return React
    throw new Error(`unexpected require: ${id}`)
  })

  const ctx = {
    effect(fn) { fn() },
    slots: { inject() {}, register() {} },
  }
  module.apply(ctx)
  const panel = window.__FOXY_CONSOLE__.pages.find((page) => page.id === 'dsh-foxy-memory')
  assert.ok(panel, 'panel registered')
  assert.equal(panel.label, '记忆')

  hookStates.length = 0
  hookRefs.length = 0
  effects.length = 0
  panel.Component()
  assert.equal(effects.length, 2, 'expect two effects')
  for (const effect of effects) effect()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(requests.some((url) => url.startsWith('/api/dsh-foxy-memory/list?status=active&pageSize=100')), 'initial list')
  assert.ok(requests.some((url) => url.startsWith('/api/dsh-foxy-memory/presets')), 'initial presets')
  assert.deepEqual(intervals, [15000], '15s auto refresh interval')
  assert.ok(listeners.has('visibilitychange'), 'refresh on visibility change')

  const listCalls = requests.filter((url) => url.startsWith('/api/dsh-foxy-memory/list')).length
  assert.ok(listCalls >= 1)
  assert.ok(window.__intervalHandler, 'interval handler captured')

  document.hidden = false
  window.__intervalHandler()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(requests.filter((url) => url.startsWith('/api/dsh-foxy-memory/list')).length, listCalls + 1, 'auto refresh list')

  document.hidden = true
  window.__intervalHandler()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(requests.filter((url) => url.startsWith('/api/dsh-foxy-memory/list')).length, listCalls + 1, 'hidden page skips refresh')

  assert.ok(document.removeEventListener)
  console.log('dsh-foxy-memory client panel tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
