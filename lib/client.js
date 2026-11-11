window.__ModuleLoader__.load({
  id: 'dsh-foxy-memory',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const API = '/api/dsh-foxy-memory'
    const PANEL_ID = 'dsh-foxy-memory'
    const LABEL = 'Foxy Memory'

    async function request(path, options = {}) {
      const response = await fetch(API + path, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      })
      let body = {}
      try {
        body = await response.json()
      } catch {}
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    function formatTime(value) {
      if (!value) return '未知时间'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      return date.toLocaleString('zh-CN', { hour12: false })
    }

    function platformLabel(value) {
      const platform = String(value || 'dsh').toLowerCase()
      if (platform === 'qq') return 'QQ'
      if (platform === 'weibo') return '微博'
      if (platform === 'bilibili') return 'B站'
      if (platform === 'dsh') return 'DSH'
      return platform || '未知'
    }

    function MemoryIcon({ size = 18 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M9 4.5a3 3 0 0 0-3 3v1a3 3 0 0 0-1 5.7A3 3 0 0 0 8 19a3 3 0 0 0 4 1V4.5A3 3 0 0 0 9 4.5Z' }),
        h('path', { d: 'M15 4.5a3 3 0 0 1 3 3v1a3 3 0 0 1 1 5.7A3 3 0 0 1 16 19a3 3 0 0 1-4 1' }),
      )
    }

    function Badge({ children }) {
      return h('span', { className: 'fm-badge' }, children)
    }

    function Panel() {
      const [items, setItems] = useState([])
      const [stats, setStats] = useState({})
      const [query, setQuery] = useState('')
      const [platform, setPlatform] = useState('')
      const [status, setStatus] = useState('active')
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [presets, setPresets] = useState([])
      const [presetId, setPresetId] = useState('')
      const [presetBusy, setPresetBusy] = useState(false)

      const load = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const params = new URLSearchParams({
            status,
            pageSize: '100',
          })
          if (platform) params.set('platform', platform)
          if (query.trim()) {
            params.set('q', query.trim())
            const result = await request(`/search?${params.toString()}`)
            setItems(result.items || [])
            setStats(result.stats || stats)
          } else {
            const result = await request(`/list?${params.toString()}`)
            setItems(result.items || [])
            setStats(result.stats || {})
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setLoading(false)
        }
      }, [platform, query, status])

      const loadPresets = useCallback(async () => {
        try {
          const data = await request('/presets')
          setPresets(Array.isArray(data.presets) ? data.presets : [])
          setPresetId(data.currentPreset || data.presets?.[0] || '')
        } catch {
          setPresets([])
          setPresetId('')
        }
      }, [])

      useEffect(() => {
        void load()
        void loadPresets()
      }, [])

      const linkPreset = async () => {
        if (!presetId) return
        setPresetBusy(true)
        setError('')
        setNotice('')
        try {
          const data = await request('/presets/link', {
            method: 'POST',
            body: JSON.stringify({ presetId }),
          })
          setNotice(`已链接 Koishi 记忆预设：${data.presetId}`)
          await load()
          await loadPresets()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setPresetBusy(false)
        }
      }

      const archive = async (item) => {
        if (!item?.id) return
        if (!window.confirm('归档这条记忆？归档后默认列表不再显示。')) return
        try {
          await request('/archive', {
            method: 'POST',
            body: JSON.stringify({ id: item.id }),
          })
          setNotice('已归档')
          await load()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }

      const platforms = stats.platforms || {}
      const total = stats.total ?? stats.count ?? items.length

      return h(
        'div',
        { className: 'fm-page' },
        h(
          'header',
          { className: 'fm-header' },
          h(
            'div',
            null,
            h('p', { className: 'fm-eyebrow' }, 'FOXY EXTENSION'),
            h('h1', null, 'Foxy Memory'),
            h('p', { className: 'fm-subtitle' }, '跨平台记忆浏览、检索与归档。QQ、微博、B站与 DSH 共用同一套 Foxy 记忆。'),
          ),
          h(
            'div',
            { className: 'fm-header-actions' },
            h('button', { type: 'button', className: 'fm-button', onClick: load, disabled: loading }, loading ? '刷新中…' : '刷新'),
          ),
        ),
        error ? h('div', { className: 'fm-alert fm-alert-error' }, error) : null,
        notice ? h('div', { className: 'fm-alert' }, notice) : null,
        h(
          'section',
          { className: 'fm-stats' },
          h('div', { className: 'fm-stat' }, h('span', null, '记忆总数'), h('strong', null, total)),
          h('div', { className: 'fm-stat' }, h('span', null, '待写入'), h('strong', null, stats.pending || 0)),
          h('div', { className: 'fm-stat' }, h('span', null, '来源平台'), h('strong', null, Object.keys(platforms).length || '—')),
          h('div', { className: 'fm-stat' }, h('span', null, 'Provider'), h('strong', null, stats.provider || 'local')),
        ),
        h(
          'section',
          { className: 'fm-toolbar' },
          h('strong', { style: { fontSize: '12px' } }, 'Koishi 记忆预设'),
          h(
            'select',
            {
              className: 'fm-input',
              value: presetId,
              onChange: (event) => setPresetId(event.target.value),
            },
            presets.length === 0 ? h('option', { value: '' }, '没有读取到预设') : null,
            presets.map((preset) => h('option', { key: preset, value: preset }, preset)),
          ),
          h('button', { type: 'button', className: 'fm-button', onClick: linkPreset, disabled: presetBusy || !presetId }, presetBusy ? '链接中…' : '链接此预设'),
          h('span', { style: { color: 'var(--dsw-alias-label-tertiary, #6b7280)', fontSize: '11px' } }, `当前：${stats.bridgePresetId || '未链接'}`),
        ),
        h(
          'section',
          { className: 'fm-toolbar' },
          h('input', {
            className: 'fm-input fm-search',
            value: query,
            placeholder: '搜索内容、说话人或关键词…',
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') void load()
            },
          }),
          h(
            'select',
            {
              className: 'fm-input',
              value: platform,
              onChange: (event) => setPlatform(event.target.value),
            },
            h('option', { value: '' }, '全部平台'),
            ...['qq', 'weibo', 'bilibili', 'dsh'].map((key) =>
              h('option', { key, value: key }, platformLabel(key)),
            ),
          ),
          h(
            'select',
            {
              className: 'fm-input',
              value: status,
              onChange: (event) => setStatus(event.target.value),
            },
            h('option', { value: 'active' }, '活跃'),
            h('option', { value: '*' }, '全部状态'),
            h('option', { value: 'archived' }, '已归档'),
          ),
          h('button', { type: 'button', className: 'fm-button', onClick: load, disabled: loading }, '查询'),
        ),
        h(
          'section',
          { className: 'fm-list' },
          items.length === 0
            ? h('div', { className: 'fm-empty' }, loading ? '读取中…' : '没有匹配的记忆。')
            : items.slice().reverse().map((item) =>
                h(
                  'article',
                  { className: 'fm-card', key: String(item.id || `${item.createdAt}-${item.content}`) },
                  h(
                    'div',
                    { className: 'fm-card-head' },
                    h('div', null, h('strong', null, item.speaker || item.role || 'Foxy'), h('span', { className: 'fm-time' }, formatTime(item.createdAt))),
                    h('div', { className: 'fm-card-badges' }, h(Badge, null, platformLabel(item.platform || item.sourceLabel)), item.status ? h(Badge, null, item.status) : null),
                  ),
                  h('p', { className: 'fm-content' }, item.content || item.summary || '（无内容）'),
                  item.keywords?.length ? h('div', { className: 'fm-keywords' }, item.keywords.map((word) => h('span', { key: word }, word))) : null,
                  h(
                    'div',
                    { className: 'fm-card-foot' },
                    h('span', null, item.presetId || 'foxy3'),
                    item.id ? h('button', { type: 'button', className: 'fm-link', onClick: () => archive(item) }, '归档') : null,
                  ),
                ),
              ),
        ),
      )
    }

    const CSS = `
.fm-page { height: 100%; overflow: auto; box-sizing: border-box; padding: 28px clamp(20px, 4vw, 56px) 48px; color: var(--dsw-alias-label-primary, #111827); background: var(--dsw-alias-bg-base, #fff); }
.fm-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 20px; }
.fm-eyebrow { margin: 0 0 8px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 10px; font-weight: 700; letter-spacing: .16em; }
.fm-header h1 { margin: 0; font-size: 24px; line-height: 1.25; letter-spacing: -.02em; }
.fm-subtitle { max-width: 660px; margin: 7px 0 0; color: var(--dsw-alias-label-secondary, #6b7280); font-size: 12px; line-height: 1.65; }
.fm-header-actions { display: flex; gap: 8px; }
.fm-button { border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); background: var(--dsw-alias-bg-layer-2, #f8fafc); color: inherit; border-radius: 7px; padding: 8px 13px; font-size: 12px; cursor: pointer; }
.fm-button:hover { background: var(--dsw-alias-interactive-bg-hover, #f1f5f9); }
.fm-button:disabled { opacity: .55; cursor: default; }
.fm-alert { margin: 0 0 14px; padding: 9px 12px; border-radius: 7px; border: 1px solid #b7d7c0; background: rgba(47,125,74,.08); color: #2f6b42; font-size: 12px; }
.fm-alert-error { border-color: #e6b8b5; background: rgba(180,50,40,.06); color: #a33; }
.fm-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
.fm-stat { border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 10px; padding: 12px 14px; background: var(--dsw-alias-bg-layer-2, #f8fafc); }
.fm-stat span { display: block; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 10px; }
.fm-stat strong { display: block; margin-top: 5px; font-size: 18px; }
.fm-toolbar { display: flex; gap: 9px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.fm-input { min-height: 34px; border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 7px; background: var(--dsw-alias-bg-layer-2, #f8fafc); color: inherit; padding: 7px 10px; font-size: 12px; box-sizing: border-box; }
.fm-search { flex: 1 1 280px; }
.fm-list { display: flex; flex-direction: column; gap: 9px; }
.fm-card { border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 10px; padding: 13px 15px; background: var(--dsw-alias-bg-layer-2, #f8fafc); }
.fm-card-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.fm-card-head strong { font-size: 12px; }
.fm-time { margin-left: 8px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 10px; }
.fm-card-badges { display: flex; gap: 5px; flex-wrap: wrap; }
.fm-badge { border-radius: 999px; padding: 2px 8px; background: var(--dsw-alias-bg-layer-4, rgba(128,128,128,.12)); color: var(--dsw-alias-label-secondary, #6b7280); font-size: 10px; white-space: nowrap; }
.fm-content { margin: 9px 0 0; color: var(--dsw-alias-label-primary, #111827); font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.fm-keywords { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.fm-keywords span { color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 10px; }
.fm-card-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 9px; border-top: 1px dashed var(--dsw-alias-bg-layer-3, #e5e7eb); color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 10px; }
.fm-link { border: 0; background: transparent; color: #a33; cursor: pointer; font-size: 10px; padding: 0; }
.fm-empty { padding: 42px 16px; text-align: center; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 12px; border: 1px dashed var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 10px; }
@media (max-width: 720px) { .fm-page { padding: 20px 16px 32px; } .fm-header { flex-direction: column; } .fm-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`

    const name = 'dsh-foxy-memory'
    const inject = ['slots']

    function apply(ctx) {
      const style = document.createElement('style')
      style.setAttribute('data-plugin-css', 'dsh-foxy-memory')
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => style.remove(), 'dsh-foxy-memory: style')

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          { name: 'main', key: PANEL_ID, inject: () => ({ workbench: true }) },
          () => h(Panel),
        ),
      )
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 15, label: () => LABEL },
          MemoryIcon,
        ),
      )
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'foxy-memory', order: 33, label: LABEL },
          () => h(Panel),
        ),
      )
    }

    const module = { exports: {} }
    module.exports.name = name
    module.exports.inject = inject
    module.exports.apply = apply
    return module.exports
  },
})
