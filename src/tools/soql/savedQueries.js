// 执行成功的查询。已登录以 public.saved_soql_queries 为真相源；未登录只放 chrome.storage.session。
// 不写入扩展的 local 或 sync。记录里只有语句，不含名称、Salesforce 主机名或会话。

import { STORAGE_KEY_SESSION } from '../../utils/constants.js'

export const SAVED_SOQL_SESSION_KEY = 'sfql_saved_soql_session'
export const SAVED_SOQL_TEXT_MAX = 20000
export const SAVED_SOQL_MAX_COUNT = 50

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

export function validateSavedQueryDraft(soql) {
  const nextSoql = typeof soql === 'string' ? soql.trim() : ''
  if (!nextSoql) return { ok: false, error: 'need-soql' }
  if (nextSoql.length > SAVED_SOQL_TEXT_MAX) return { ok: false, error: 'soql-too-long' }
  return { ok: true, soql: nextSoql }
}

/** 只保留能再次填回编辑区的字段。名称、主机名、会话、Org 一律丢掉。 */
export function sanitizeSavedQuery(row) {
  if (!row || typeof row !== 'object') return null
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const soql = typeof row.soql === 'string' ? row.soql.trim() : ''
  const createdRaw = row.createdAt ?? row.created_at
  const createdAt = typeof createdRaw === 'string' ? createdRaw : ''
  if (!isUuid(id) || !soql || soql.length > SAVED_SOQL_TEXT_MAX) return null
  return { id, soql, createdAt }
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

export function nextSavedQueries(current, saved) {
  const rest = (Array.isArray(current) ? current : []).filter((query) => query.soql !== saved.soql && query.id !== saved.id)
  return [saved, ...rest].slice(0, SAVED_SOQL_MAX_COUNT)
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
  const visible = queries.some((query) => query.id === result.saved.id && query.soql === result.saved.soql)
  if (!visible || queries.length > SAVED_SOQL_MAX_COUNT) return prior
  if (queries.filter((query) => query.soql === result.saved.soql).length !== 1) return prior
  return queries
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
      message: body?.message || body?.error || body?.code || `HTTP ${res.status}`,
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
    params.set('select', 'id,soql,created_at')
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
    async deleteOwn(userId, ids) {
      const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(isUuid))]
      if (!list.length) return { data: [], error: null }
      try {
        const params = new URLSearchParams()
        params.set('id', `in.(${list.join(',')})`)
        params.set('user_id', `eq.${userId}`)
        const res = await fetchFn(`${base}?${params.toString()}`, {
          method: 'DELETE',
          headers: { ...headers, Prefer: 'return=representation' }
        })
        const body = await parseRest(res)
        const rows = (Array.isArray(body) ? body : []).map(cloudRow).filter(Boolean)
        if (rows.length !== list.length || list.some((id) => !rows.some((row) => row.id === id))) {
          return { data: null, error: toError({ message: 'saved query not deleted' }) }
        }
        return { data: rows, error: null }
      } catch (error) {
        return { data: null, error: toError(error) }
      }
    }
  }
}

function failed(error, queries, loggedIn) {
  return { ok: false, error, queries: queries || [], loggedIn: !!loggedIn, saved: null }
}

function keptIds(current, saved) {
  return new Set(nextSavedQueries(current, saved).map((query) => query.id))
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
    return { ok: true, queries: listed.data.slice(0, SAVED_SOQL_MAX_COUNT), loggedIn: true, saved: null }
  }

  async function remember(soql) {
    const draft = validateSavedQueryDraft(soql)
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
      const saved = sanitizeSavedQuery({
        id: createId(),
        soql: draft.soql,
        createdAt: now()
      })
      if (!saved) return failed('save-failed', current, false)
      const next = nextSavedQueries(current, saved)
      const keep = keptIds(current, saved)
      try {
        await storage.session.set({ [SAVED_SOQL_SESSION_KEY]: next })
        const verified = await readSessionQueries(storage.session)
        const same = verified.filter((query) => query.soql === saved.soql)
        const dropped = current.some((query) => !keep.has(query.id) && verified.some((item) => item.id === query.id))
        if (same.length !== 1 || same[0].id !== saved.id || verified.length > SAVED_SOQL_MAX_COUNT || dropped) {
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
    const inserted = await io.insertOwn(auth.userId, draft)
    if (inserted.error || !inserted.data) return failed('save-failed', listed.data, true)
    const next = nextSavedQueries(listed.data, inserted.data)
    const dropIds = listed.data
      .filter((query) => !next.some((item) => item.id === query.id))
      .map((query) => query.id)
    if (dropIds.length) {
      const removed = await io.deleteOwn(auth.userId, dropIds)
      if (removed.error) return failed('save-failed', listed.data, true)
    }
    const again = await io.listOwn(auth.userId)
    if (again.error) return failed('save-failed', listed.data, true)
    const queries = again.data.filter((query) => next.some((item) => item.id === query.id))
    const same = queries.filter((query) => query.soql === inserted.data.soql)
    const dropped = dropIds.some((id) => again.data.some((query) => query.id === id))
    if (same.length !== 1 || same[0].id !== inserted.data.id || queries.length > SAVED_SOQL_MAX_COUNT || dropped) {
      return failed('save-failed', listed.data, true)
    }
    return { ok: true, queries, loggedIn: true, saved: inserted.data }
  }

  return { list, remember }
}
