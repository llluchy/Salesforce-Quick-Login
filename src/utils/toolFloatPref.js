// 浮动栏可见性。已登录以 public.user_metadata 为准；未登录只放 session。
// 不写入扩展的 local 或 sync 存储。

export const TOOL_FLOAT_SESSION_KEY = 'sfql_tool_float_session_visible'

export function toError(error) {
  if (error instanceof Error) return error
  const err = new Error(error?.message || 'user_metadata request failed')
  if (error?.code) err.code = error.code
  if (error?.status) err.status = error.status
  return err
}

export function supabaseUserMetadataIo(client) {
  return {
    async selectOwn(userId) {
      const { data, error } = await client
        .from('user_metadata')
        .select('show_tool_float')
        .eq('user_id', userId)
        .maybeSingle()
      return { data, error }
    },
    async insertOwn(userId, showToolFloat) {
      const row = { user_id: userId }
      if (typeof showToolFloat === 'boolean') row.show_tool_float = showToolFloat
      const { data, error } = await client
        .from('user_metadata')
        .insert(row)
        .select('show_tool_float')
        .single()
      return { data, error }
    },
    async updateOwn(userId, showToolFloat) {
      const { data, error } = await client
        .from('user_metadata')
        .update({ show_tool_float: showToolFloat })
        .eq('user_id', userId)
        .select('show_tool_float')
      const row = Array.isArray(data) ? data[0] : data
      return { data: row ?? null, error }
    }
  }
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
    const err = toError({
      message: body?.message || body?.error || `HTTP ${res.status}`,
      code: body?.code,
      status: res.status
    })
    throw err
  }
  return body
}

export function createUserMetadataRestIo({ supabaseUrl, anonKey, accessToken, fetchImpl }) {
  const fetchFn = fetchImpl || fetch
  const base = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/user_metadata`
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  function urlFor(userId) {
    return `${base}?user_id=eq.${encodeURIComponent(userId)}&select=show_tool_float`
  }

  return {
    async selectOwn(userId) {
      try {
        const res = await fetchFn(urlFor(userId), { headers })
        const body = await parseRest(res)
        const row = Array.isArray(body) ? body[0] : null
        return { data: row ?? null, error: null }
      } catch (error) {
        return { data: null, error: toError(error) }
      }
    },
    async insertOwn(userId, showToolFloat) {
      const row = { user_id: userId }
      if (typeof showToolFloat === 'boolean') row.show_tool_float = showToolFloat
      try {
        const res = await fetchFn(base, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify(row)
        })
        const body = await parseRest(res)
        const created = Array.isArray(body) ? body[0] : body
        return { data: created ?? null, error: null }
      } catch (error) {
        return { data: null, error: toError(error) }
      }
    },
    async updateOwn(userId, showToolFloat) {
      try {
        const res = await fetchFn(urlFor(userId), {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({ show_tool_float: showToolFloat })
        })
        const body = await parseRest(res)
        const row = Array.isArray(body) ? body[0] : body
        return { data: row ?? null, error: null }
      } catch (error) {
        return { data: null, error: toError(error) }
      }
    }
  }
}

export async function readOrInsertShowToolFloat(io, userId) {
  const selected = await io.selectOwn(userId)
  if (selected.error) throw toError(selected.error)
  if (selected.data && typeof selected.data.show_tool_float === 'boolean') {
    return selected.data.show_tool_float
  }
  const inserted = await io.insertOwn(userId)
  if (inserted.error?.code === '23505') {
    const again = await io.selectOwn(userId)
    if (again.error) throw toError(again.error)
    if (!again.data || typeof again.data.show_tool_float !== 'boolean') {
      throw toError({ message: 'user_metadata missing' })
    }
    return again.data.show_tool_float
  }
  if (inserted.error) throw toError(inserted.error)
  if (!inserted.data || typeof inserted.data.show_tool_float !== 'boolean') {
    throw toError({ message: 'show_tool_float missing' })
  }
  return inserted.data.show_tool_float
}

export async function writeShowToolFloat(io, userId, visible) {
  const next = visible === true
  const updated = await io.updateOwn(userId, next)
  if (updated.error) throw toError(updated.error)
  if (updated.data && typeof updated.data.show_tool_float === 'boolean') {
    return updated.data.show_tool_float
  }
  const inserted = await io.insertOwn(userId, next)
  if (inserted.error?.code === '23505') {
    const again = await io.updateOwn(userId, next)
    if (again.error) throw toError(again.error)
    if (!again.data || typeof again.data.show_tool_float !== 'boolean') {
      throw toError({ message: 'user_metadata update failed' })
    }
    return again.data.show_tool_float
  }
  if (inserted.error) throw toError(inserted.error)
  if (!inserted.data || typeof inserted.data.show_tool_float !== 'boolean') {
    throw toError({ message: 'show_tool_float missing' })
  }
  return inserted.data.show_tool_float
}

export async function getLoggedOutVisible(sessionArea) {
  const data = await sessionArea.get(TOOL_FLOAT_SESSION_KEY)
  return data?.[TOOL_FLOAT_SESSION_KEY] === false ? false : true
}

export async function setLoggedOutVisible(sessionArea, visible) {
  const shown = visible === true
  if (shown) await sessionArea.remove(TOOL_FLOAT_SESSION_KEY)
  else await sessionArea.set({ [TOOL_FLOAT_SESSION_KEY]: false })
  return shown
}

export async function clearSessionOverride(sessionArea) {
  await sessionArea.remove(TOOL_FLOAT_SESSION_KEY)
}

/** 退出后回到会话默认（显示）。不接收云端值，因此不会把它写进任何存储。 */
export async function signOutToolFloat(sessionArea) {
  await clearSessionOverride(sessionArea)
  return { visible: true }
}

export async function loadToolFloatState({ loggedIn, read, getSession, applyCloud }) {
  if (!loggedIn) {
    const res = await getSession()
    if (!res?.success || typeof res.visible !== 'boolean') return { ok: false }
    return { ok: true, visible: res.visible }
  }
  const shown = await read()
  try {
    await applyCloud(shown)
  } catch {
    /* 云端已经读到；通知后台失败时下次注入仍会再拉 */
  }
  return { ok: true, visible: shown }
}

export async function commitToolFloatChange({ loggedIn, previous, next, write, setSession, applyCloud }) {
  if (!loggedIn) {
    const res = await setSession(next)
    if (!res?.success || typeof res.visible !== 'boolean') {
      return { ok: false, visible: previous }
    }
    return { ok: true, visible: res.visible }
  }
  let shown
  try {
    shown = await write(next)
  } catch {
    return { ok: false, visible: previous }
  }
  try {
    await applyCloud(shown)
  } catch {
    /* 行已经写上，界面跟云端最后成功值 */
  }
  return { ok: true, visible: shown }
}
