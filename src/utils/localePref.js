// 界面语言。已登录以 public.user_metadata.ui_locale 为准；未登录只放 session。
// 不把语言写入扩展的 local 或 sync 存储。旧的 ui_locale local 键只删除。

export const LOCALE_PREF_SYSTEM = 'system'
export const SUPPORTED_LOCALES = ['zh-CN', 'en', 'ja']
export const DEFAULT_LOCALE = 'zh-CN'
export const SESSION_LOCALE_KEY = 'ui_locale_session'
export const LEGACY_LOCALE_LOCAL_KEY = 'ui_locale'

const PREFERENCES = new Set([LOCALE_PREF_SYSTEM, ...SUPPORTED_LOCALES])

export function normalizeLocalePreference(value) {
  return PREFERENCES.has(value) ? value : null
}

export function effectiveLocale(preference, browserLocale) {
  const pref = normalizeLocalePreference(preference) || LOCALE_PREF_SYSTEM
  if (pref !== LOCALE_PREF_SYSTEM) return pref
  return normalizeLocalePreference(browserLocale) || DEFAULT_LOCALE
}

export function toError(error) {
  if (error instanceof Error) return error
  const err = new Error(error?.message || 'user_metadata request failed')
  if (error?.code) err.code = error.code
  if (error?.status) err.status = error.status
  return err
}

export function supabaseLocaleIo(client) {
  return {
    async selectOwn(userId) {
      const { data, error } = await client
        .from('user_metadata')
        .select('ui_locale')
        .eq('user_id', userId)
        .maybeSingle()
      return { data, error }
    },
    async insertOwn(userId, uiLocale) {
      const row = { user_id: userId, ui_locale: uiLocale }
      const { data, error } = await client
        .from('user_metadata')
        .insert(row)
        .select('ui_locale')
        .single()
      return { data, error }
    },
    async updateOwn(userId, uiLocale) {
      const { data, error } = await client
        .from('user_metadata')
        .update({ ui_locale: uiLocale })
        .eq('user_id', userId)
        .select('ui_locale')
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
    throw toError({
      message: body?.message || body?.error || `HTTP ${res.status}`,
      code: body?.code,
      status: res.status
    })
  }
  return body
}

export function createLocaleRestIo({ supabaseUrl, anonKey, accessToken, fetchImpl }) {
  const fetchFn = fetchImpl || fetch
  const base = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/user_metadata`
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  function urlFor(userId) {
    return `${base}?user_id=eq.${encodeURIComponent(userId)}&select=ui_locale`
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
    async insertOwn(userId, uiLocale) {
      const row = { user_id: userId, ui_locale: uiLocale }
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
    async updateOwn(userId, uiLocale) {
      try {
        const res = await fetchFn(urlFor(userId), {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({ ui_locale: uiLocale })
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

export async function removeLegacyLocalePreference(localArea) {
  if (!localArea?.remove) return
  await localArea.remove(LEGACY_LOCALE_LOCAL_KEY)
}

/** 没有行时视为跟随系统，不插入。 */
export async function readUiLocale(io, userId) {
  const selected = await io.selectOwn(userId)
  if (selected.error) throw toError(selected.error)
  if (!selected.data) return LOCALE_PREF_SYSTEM
  const pref = normalizeLocalePreference(selected.data.ui_locale)
  if (!pref) throw toError({ message: 'ui_locale invalid' })
  return pref
}

export async function writeUiLocale(io, userId, preference) {
  const pref = normalizeLocalePreference(preference)
  if (!pref) throw toError({ message: 'ui_locale invalid' })
  const updated = await io.updateOwn(userId, pref)
  if (updated.error) throw toError(updated.error)
  if (updated.data && normalizeLocalePreference(updated.data.ui_locale) === pref) return pref
  const inserted = await io.insertOwn(userId, pref)
  if (inserted.error?.code === '23505') {
    const again = await io.updateOwn(userId, pref)
    if (again.error) throw toError(again.error)
    if (!again.data || normalizeLocalePreference(again.data.ui_locale) !== pref) {
      throw toError({ message: 'ui_locale update failed' })
    }
    return pref
  }
  if (inserted.error) throw toError(inserted.error)
  if (!inserted.data || normalizeLocalePreference(inserted.data.ui_locale) !== pref) {
    throw toError({ message: 'ui_locale missing' })
  }
  return pref
}

export async function getLoggedOutPreference(sessionArea) {
  const data = await sessionArea.get(SESSION_LOCALE_KEY)
  return normalizeLocalePreference(data?.[SESSION_LOCALE_KEY]) || LOCALE_PREF_SYSTEM
}

export async function setLoggedOutPreference(sessionArea, preference) {
  const pref = normalizeLocalePreference(preference) || LOCALE_PREF_SYSTEM
  if (pref === LOCALE_PREF_SYSTEM) await sessionArea.remove(SESSION_LOCALE_KEY)
  else await sessionArea.set({ [SESSION_LOCALE_KEY]: pref })
  return pref
}

export async function clearSessionOverride(sessionArea) {
  await sessionArea.remove(SESSION_LOCALE_KEY)
}

/** 退出后回到跟随系统。不把账号上的语言写进 session。 */
export async function signOutLocale(sessionArea) {
  await clearSessionOverride(sessionArea)
  return { preference: LOCALE_PREF_SYSTEM }
}

export async function loadLocaleState({ loggedIn, read, getSession, applyCloud }) {
  if (!loggedIn) {
    const res = await getSession()
    if (!res?.success || !normalizeLocalePreference(res.preference)) return { ok: false }
    return { ok: true, preference: normalizeLocalePreference(res.preference) }
  }
  let preference
  try {
    preference = await read()
  } catch {
    return { ok: false }
  }
  const pref = normalizeLocalePreference(preference)
  if (!pref) return { ok: false }
  try {
    await applyCloud(pref)
  } catch {
    /* 账号语言已经读到；通知其它页面失败时，下次打开仍会再拉 */
  }
  return { ok: true, preference: pref }
}

export async function commitLocaleChange({ loggedIn, previous, next, write, setSession, applyCloud }) {
  const pref = normalizeLocalePreference(next)
  const prev = normalizeLocalePreference(previous) || LOCALE_PREF_SYSTEM
  if (!pref) return { ok: false, preference: prev }
  if (!loggedIn) {
    const res = await setSession(pref)
    if (!res?.success || normalizeLocalePreference(res.preference) !== pref) {
      return { ok: false, preference: prev }
    }
    return { ok: true, preference: pref }
  }
  let saved
  try {
    saved = await write(pref)
  } catch {
    return { ok: false, preference: prev }
  }
  if (normalizeLocalePreference(saved) !== pref) return { ok: false, preference: prev }
  try {
    await applyCloud(pref)
  } catch {
    /* 行已经写上，界面跟账号上最后成功的语言 */
  }
  return { ok: true, preference: pref }
}
