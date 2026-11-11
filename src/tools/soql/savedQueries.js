// 常用查询。已登录以 public.saved_soql_queries 为真相源；未登录只放 chrome.storage.session。
// 不写入扩展的 local 或 sync。记录里只有名称和 SOQL，不含 Salesforce 会话。

import { STORAGE_KEY_SESSION } from '../../utils/constants.js'

export const SAVED_SOQL_SESSION_KEY = 'sfql_saved_soql_session'
export const SAVED_SOQL_NAME_MAX = 80
export const SAVED_SOQL_TEXT_MAX = 20000
export const SAVED_SOQL_MAX_COUNT = 100

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

function toError(error) {
  if (error instanceof Error) return error
  const err = new Error(error?.message || 'saved query request failed')
  if (error?.code) err.code = error.code
  if (error?.status) err.status = error.status
  return err
}

export function validateSavedQueryDraft({ name, soql }) {
  const nextName = typeof name === 'string' ? name.trim() : ''
  const nextSoql = typeof soql === 'string' ? soql.trim() : ''
  if (!nextName) return { ok: false, error: 'need-name' }
  if (!nextSoql) return { ok: false, error: 'need-soql' }
  if (nextName.length > SAVED_SOQL_NAME_MAX) return { ok: false, error: 'name-too-long' }
  if (nextSoql.length > SAVED_SOQL_TEXT_MAX) return { ok: false, error: 'soql-too-long' }
  return { ok: true, name: nextName, soql: nextSoql }
}

/** 只保留能再次打开的字段。主机名、会话、Org 一律丢掉。 */
export function sanitizeSavedQuery(row) {
  if (!row || typeof row !== 'object') return null
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  const soql = typeof row.soql === 'string' ? row.soql.trim() : ''
  const createdRaw = row.createdAt ?? row.created_at
  const createdAt = typeof createdRaw === 'string' ? createdRaw : ''
  if (!isUuid(id) || !name || !soql) return null
  if (name.length > SAVED_SOQL_NAME_MAX || soql.length > SAVED_SOQL_TEXT_MAX) return null
  return { id, name, soql, createdAt }
}

export function savedQueryEditorText(item) {
  const query = sanitizeSavedQuery(item)
  return query ? query.soql : ''
}

function sortNewest(queries) {
  return [...queries].sort((a, b) => {
    if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : -1
    return a.createdAt < b.createdAt ? 1 : -1
  })
}

export async function readSessionQueries(sessionArea) {
  const data = await sessionArea.get(SAVED_SOQL_SESSION_KEY)
  const raw = data?.[SAVED_SOQL_SESSION_KEY]
  if (!Array.isArray(raw)) return []
  const queries = []
  for (const row of raw) {
    const query = sanitizeSavedQuery(row)
    if (query) queries.push(query)
  }
  return sortNewest(queries)
}

export function applySaveResult(previous, result) {
  const prior = Array.isArray(previous) ? previous : []
  if (!result?.ok || !result.saved?.id) return prior
  const queries = Array.isArray(result.queries) ? result.queries : prior
  return queries.some((query) => query.id === result.saved.id) ? queries : prior
}

export function applyDeleteResult(previous, id, result) {
  const prior = Array.isArray(previous) ? previous : []
  if (!result?.ok || !id) return prior
  const queries = Array.isArray(result.queries) ? result.queries : prior
  return queries.some((query) => query.id === id) ? prior : queries
}

async function parseRest(res) {
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    throw toError({
      message: body?.message || body?.error || `HTTP ${res.status}`,
      code: body?.code,
      status: res.status
    })
  }
  return body
}

function cloudRow(row) {
  return sanitizeSavedQuery(row)
}

export function createSavedSoqlRestIo({ supabaseUrl, anonKey, accessToken, fetchImpl }) {
  const fetchFn = fetchImpl || fetch
  const base = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/saved_soql_queries`
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  function listUrl(userId) {
    const params = new URLSearchParams()
    params.set('user_id', `eq.${userId}`)
    params.set('select', 'id,name,soql,created_at')
    params.set('order', 'created_at.desc')
    return `${base}?${params.toString()}`
  }

  return {
    async listOwn(userId) {
      try {
        const res = await fetchFn(listUrl(userId), { headers })
        const body = await parseRest(res)
        const rows = Array.isArray(body) ? body : []
        return { data: sortNewest(rows.map(cloudRow).filter(Boolean)), error: null }
      } catch (error) {
        return { data: [], error: toError(error) }
      }
    },
    async insertOwn(userId, draft) {
      try {
        const res = await fetchFn(base, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({
            user_id: userId,
            name: draft.name,
            soql: draft.soql
          })
        })
        const body = await parseRest(res)
        const row = cloudRow(Array.isArray(body) ? body[0] : body)
        return { data: row, error: row ? null : toError({ message: 'saved query missing' }) }
      } catch (error) {
        return { data: null, error: toError(error) }
      }
    },
    async deleteOwn(userId, id) {
      try {
        const params = new URLSearchParams()
        params.set('id', `eq.${id}`)
        params.set('user_id', `eq.${userId}`)
        const res = await fetchFn(`${base}?${params.toString()}`, {
          method: 'DELETE',
          headers: { ...headers, Prefer: 'return=representation' }
        })
        const body = await parseRest(res)
        const row = cloudRow(Array.isArray(body) ? body[0] : body)
        if (!row || row.id !== id) {
          return { data: null, error: toError({ message: 'saved query not deleted' }) }
        }
        return { data: row, error: null }
      } catch (error) {
        return { data: null, error: toError(error) }
      }
    }
  }
}

function failed(error, queries, loggedIn) {
  return { ok: false, error, queries: queries || [], loggedIn: !!loggedIn, saved: null }
}

export function createSavedQueryStore(options = {}) {
  const storage = options.storage
  const now = options.now || (() => new Date().toISOString())
  const createId = options.createId || (() => globalThis.crypto.randomUUID())
  const ioForSession = options.ioForSession || ((session) => createSavedSoqlRestIo({
    supabaseUrl: options.supabaseUrl,
    anonKey: options.anonKey,
    accessToken: session.accessToken,
    fetchImpl: options.fetchImpl
  }))

  async function resolveAuth() {
    if (!storage?.local?.get) return null
    const data = await storage.local.get(STORAGE_KEY_SESSION)
    const session = data?.[STORAGE_KEY_SESSION]
    if (!session?.access_token || !isUuid(session?.user?.id)) return null
    return { accessToken: session.access_token, userId: session.user.id }
  }

  async function list() {
    let auth = null
    try {
      auth = await resolveAuth()
    } catch {
      return failed('load-failed', [], false)
    }
    if (!auth) {
      if (!storage?.session?.get) return failed('load-failed', [], false)
      try {
        const queries = await readSessionQueries(storage.session)
        return { ok: true, queries, loggedIn: false, saved: null }
      } catch {
        return failed('load-failed', [], false)
      }
    }
    const listed = await ioForSession(auth).listOwn(auth.userId)
    if (listed.error) return failed('load-failed', [], true)
    return { ok: true, queries: listed.data, loggedIn: true, saved: null }
  }

  async function save(input) {
    const draft = validateSavedQueryDraft(input || {})
    let auth = null
    try {
      auth = await resolveAuth()
    } catch {
      return failed('save-failed', [], false)
    }
    if (!draft.ok) {
      if (!auth) {
        const current = storage?.session?.get ? await readSessionQueries(storage.session).catch(() => []) : []
        return failed(draft.error, current, false)
      }
      const listed = await ioForSession(auth).listOwn(auth.userId)
      return failed(draft.error, listed.error ? [] : listed.data, true)
    }

    if (!auth) {
      if (!storage?.session?.get || !storage?.session?.set) return failed('save-failed', [], false)
      let current = []
      try {
        current = await readSessionQueries(storage.session)
      } catch {
        return failed('save-failed', [], false)
      }
      if (current.length >= SAVED_SOQL_MAX_COUNT) return failed('limit', current, false)
      const saved = sanitizeSavedQuery({
        id: createId(),
        name: draft.name,
        soql: draft.soql,
        createdAt: now()
      })
      if (!saved) return failed('save-failed', current, false)
      try {
        await storage.session.set({ [SAVED_SOQL_SESSION_KEY]: [saved, ...current] })
        const verified = await readSessionQueries(storage.session)
        if (!verified.some((query) => query.id === saved.id && query.soql === saved.soql && query.name === saved.name)) {
          return failed('save-failed', current, false)
        }
        return { ok: true, queries: verified, loggedIn: false, saved }
      } catch {
        return failed('save-failed', current, false)
      }
    }

    const io = ioForSession(auth)
    const listed = await io.listOwn(auth.userId)
    if (listed.error) return failed('save-failed', [], true)
    if (listed.data.length >= SAVED_SOQL_MAX_COUNT) return failed('limit', listed.data, true)
    const inserted = await io.insertOwn(auth.userId, draft)
    if (inserted.error || !inserted.data) return failed('save-failed', listed.data, true)
    const again = await io.listOwn(auth.userId)
    const queries = !again.error && again.data.some((query) => query.id === inserted.data.id)
      ? again.data
      : [inserted.data, ...listed.data.filter((query) => query.id !== inserted.data.id)]
    if (!queries.some((query) => query.id === inserted.data.id)) {
      return failed('save-failed', listed.data, true)
    }
    return { ok: true, queries, loggedIn: true, saved: inserted.data }
  }

  async function remove(id) {
    if (!isUuid(id)) return failed('delete-failed', [], false)
    let auth = null
    try {
      auth = await resolveAuth()
    } catch {
      return failed('delete-failed', [], false)
    }
    if (!auth) {
      if (!storage?.session?.get || !storage?.session?.set) return failed('delete-failed', [], false)
      let current = []
      try {
        current = await readSessionQueries(storage.session)
      } catch {
        return failed('delete-failed', [], false)
      }
      if (!current.some((query) => query.id === id)) return failed('delete-failed', current, false)
      const next = current.filter((query) => query.id !== id)
      try {
        await storage.session.set({ [SAVED_SOQL_SESSION_KEY]: next })
        const verified = await readSessionQueries(storage.session)
        if (verified.some((query) => query.id === id)) return failed('delete-failed', current, false)
        return { ok: true, queries: verified, loggedIn: false, saved: null }
      } catch {
        return failed('delete-failed', current, false)
      }
    }
    const io = ioForSession(auth)
    const listed = await io.listOwn(auth.userId)
    const current = listed.error ? [] : listed.data
    const removed = await io.deleteOwn(auth.userId, id)
    if (removed.error || !removed.data) return failed('delete-failed', current, true)
    const again = await io.listOwn(auth.userId)
    const queries = !again.error
      ? again.data
      : current.filter((query) => query.id !== id)
    if (queries.some((query) => query.id === id)) return failed('delete-failed', current, true)
    return { ok: true, queries, loggedIn: true, saved: null }
  }

  return { list, save, remove }
}
