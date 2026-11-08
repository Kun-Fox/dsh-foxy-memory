import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'foxy-memory-ui-'))
process.env.DSH_HOME = dir
const { apply } = await import('../lib/index.js')
const routes = new Map()
const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  effect() {},
  provide() {},
  get() { return undefined },
  foxy: { registerMemoryProvider() { return () => {} } },
  inject(ids, callback) {
    callback({ connection: { fetch: { register(route) { routes.set(route.path, route.fetch) } } } })
  },
}
const plugin = apply(ctx, { dataDir: dir })
await plugin.reload()
await plugin.provider.record({ role: 'user', text: '微博测试记忆', platform: 'weibo', presetId: 'foxy3' })
const list = await routes.get('/api/dsh-foxy-memory/list')(new Request('http://x/api/dsh-foxy-memory/list?pageSize=10'))
const body = await list.json()
if (!body.ok || body.items.length !== 1 || body.items[0].platform !== 'weibo') throw new Error(JSON.stringify(body))
const search = await routes.get('/api/dsh-foxy-memory/search')(new Request('http://x/api/dsh-foxy-memory/search?q=微博'))
const found = await search.json()
if (!found.ok || found.items.length !== 1) throw new Error(JSON.stringify(found))
console.log('memory ui routes ok')
plugin.dispose()
