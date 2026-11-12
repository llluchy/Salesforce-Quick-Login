import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RENEW_LEAD_MS,
  RENEW_RETRY_MS,
  TRACE_DURATION_MS,
  TRACE_LEASE_KEY,
  apexLogWindowIsOpen,
  applyTraceAlarm,
  applyTraceUnwatch,
  applyTraceWatch,
  earliestExpiration,
  isApexLogWindowUrl,
  planTraceRenewal,
  rearmTraceRenewFromLease,
  sanitizeTraceLease,
  writeTraceLease
} from './traceRenew.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const NOW = Date.parse('2026-11-11T00:00:00.000Z')
const HOUR = TRACE_DURATION_MS

function memoryLease() {
  let lease = null
  return {
    load: async () => lease,
    save: async (next) => {
      lease = next
    },
    read: () => lease
  }
}

function alarms() {
  const calls = []
  let pending = false
  let when = null
  return {
    calls,
    schedule: async (at) => {
      calls.push(['schedule', at])
      pending = true
      when = at
    },
    clear: async () => {
      calls.push(['clear'])
      pending = false
      when = null
    },
    pending: async () => pending,
    when: () => when
  }
}

describe('到期前才续', () => {
  it('没有跟踪或已经进到提前期时立刻续', () => {
    assert.equal(planTraceRenewal({ expiresAt: null, now: NOW }).due, true)
    const soon = planTraceRenewal({ expiresAt: NOW + 2 * 60 * 1000, now: NOW })
    assert.equal(soon.due, true)
    assert.equal(soon.delayMs, 0)
  })

  it('离到期还早时排在到期前', () => {
    const plan = planTraceRenewal({ expiresAt: NOW + HOUR, now: NOW })
    assert.equal(plan.due, false)
    assert.equal(plan.delayMs, HOUR - RENEW_LEAD_MS)
    assert.equal(plan.renewAt, NOW + HOUR - RENEW_LEAD_MS)
  })

  it('多个跟踪取最早到期的那个', () => {
    const soon = NOW + 10 * 60 * 1000
    assert.equal(
      earliestExpiration([null, 'nope', new Date(NOW + HOUR).toISOString(), soon]),
      soon
    )
  })
})

describe('窗口开着才自动续', () => {
  it('离到期还早时不调用续期', async () => {
    const box = memoryLease()
    const alarm = alarms()
    let renews = 0
    const res = await applyTraceWatch({
      envId: 'env-1',
      viewerId: 'win-a',
      now: NOW,
      loadLease: box.load,
      saveLease: box.save,
      readExpiration: async () => NOW + HOUR,
      renew: async () => {
        renews += 1
        return { expiresAt: NOW + HOUR }
      },
      scheduleAlarm: alarm.schedule,
      clearAlarm: alarm.clear
    })
    assert.equal(renews, 0)
    assert.equal(res.phase, 'scheduled')
    assert.equal(Date.parse(res.renewAt), NOW + HOUR - RENEW_LEAD_MS)
    assert.equal(box.read().viewers['win-a'], NOW)
    assert.equal(alarm.calls[0][0], 'schedule')
  })

  it('已经快到期时立刻续一次，并排下一次', async () => {
    const box = memoryLease()
    const alarm = alarms()
    const renewed = []
    const res = await applyTraceWatch({
      envId: 'env-1',
      viewerId: 'win-a',
      now: NOW,
      loadLease: box.load,
      saveLease: box.save,
      readExpiration: async () => NOW + 60 * 1000,
      renew: async (envId) => {
        renewed.push(envId)
        return { expiresAt: NOW + HOUR }
      },
      scheduleAlarm: alarm.schedule,
      clearAlarm: alarm.clear
    })
    assert.deepEqual(renewed, ['env-1'])
    assert.equal(res.phase, 'renewed')
    assert.equal(Date.parse(res.renewAt), NOW + HOUR - RENEW_LEAD_MS)
    assert.equal(alarm.when(), NOW + HOUR - RENEW_LEAD_MS)
  })

  it('续期失败时过一会儿再试，而不是空转', async () => {
    const box = memoryLease()
    const alarm = alarms()
    let renews = 0
    const res = await applyTraceWatch({
      envId: 'env-1',
      viewerId: 'win-a',
      now: NOW,
      loadLease: box.load,
      saveLease: box.save,
      readExpiration: async () => null,
      renew: async () => {
        renews += 1
        throw new Error('暂时失败')
      },
      scheduleAlarm: alarm.schedule,
      clearAlarm: alarm.clear
    })
    assert.equal(renews, 1)
    assert.equal(res.phase, 'error')
    assert.equal(alarm.when(), NOW + RENEW_RETRY_MS)
  })

  it('手动续完之后，只要还没到提前期就不会再自动续', async () => {
    const box = memoryLease()
    const alarm = alarms()
    let renews = 0
    await applyTraceWatch({
      envId: 'env-1',
      viewerId: 'win-a',
      now: NOW,
      loadLease: box.load,
      saveLease: box.save,
      readExpiration: async () => NOW + HOUR,
      renew: async () => {
        renews += 1
        return { expiresAt: NOW + HOUR }
      },
      scheduleAlarm: alarm.schedule,
      clearAlarm: alarm.clear
    })
    assert.equal(renews, 0)
  })
})

describe('关掉窗口后不再续', () => {
  it('最后一个窗口关掉就取消闹钟', async () => {
    const box = memoryLease()
    const alarm = alarms()
    await box.save({
      envId: 'env-1',
      expiresAt: NOW + HOUR,
      renewAt: NOW + HOUR - RENEW_LEAD_MS,
      phase: 'scheduled',
      error: '',
      viewers: { 'win-a': NOW, 'win-b': NOW }
    })
    const kept = await applyTraceUnwatch({
      viewerId: 'win-a',
      loadLease: box.load,
      saveLease: box.save,
      clearAlarm: alarm.clear
    })
    assert.equal(kept.phase, 'kept')
    assert.equal(alarm.calls.length, 0)
    assert.ok(box.read().viewers['win-b'])

    const stopped = await applyTraceUnwatch({
      viewerId: 'win-b',
      loadLease: box.load,
      saveLease: box.save,
      clearAlarm: alarm.clear
    })
    assert.equal(stopped.phase, 'stopped')
    assert.equal(box.read(), null)
    assert.equal(alarm.calls.at(-1)[0], 'clear')
  })

  it('窗口已经不在时，闹钟到了也不续', async () => {
    const box = memoryLease()
    const alarm = alarms()
    let renews = 0
    await box.save({
      envId: 'env-1',
      expiresAt: NOW + 60 * 1000,
      renewAt: NOW,
      phase: 'scheduled',
      error: '',
      viewers: { 'win-a': NOW }
    })
    const res = await applyTraceAlarm({
      now: NOW,
      windowOpen: false,
      loadLease: box.load,
      saveLease: box.save,
      readExpiration: async () => NOW + 60 * 1000,
      renew: async () => {
        renews += 1
        return { expiresAt: NOW + HOUR }
      },
      scheduleAlarm: alarm.schedule,
      clearAlarm: alarm.clear
    })
    assert.equal(res.action, 'stop')
    assert.equal(renews, 0)
    assert.equal(box.read(), null)
  })

  it('窗口还开着且快到期时才续，并且不改查看时间', async () => {
    const box = memoryLease()
    const alarm = alarms()
    const seenAt = NOW - 60 * 1000
    await box.save({
      envId: 'env-1',
      expiresAt: NOW + 60 * 1000,
      renewAt: NOW,
      phase: 'scheduled',
      error: '',
      viewers: { 'win-a': seenAt }
    })
    const res = await applyTraceAlarm({
      now: NOW,
      windowOpen: true,
      loadLease: box.load,
      saveLease: box.save,
      readExpiration: async () => NOW + 60 * 1000,
      renew: async () => ({ expiresAt: NOW + HOUR }),
      scheduleAlarm: alarm.schedule,
      clearAlarm: alarm.clear
    })
    assert.equal(res.action, 'renewed')
    assert.equal(box.read().viewers['win-a'], seenAt)
    assert.equal(alarm.when(), NOW + HOUR - RENEW_LEAD_MS)
  })

  it('窗口还开着但跟踪刚被手动续长时，不再续一次', async () => {
    const box = memoryLease()
    const alarm = alarms()
    let renews = 0
    await box.save({
      envId: 'env-1',
      expiresAt: NOW + 60 * 1000,
      renewAt: NOW,
      phase: 'scheduled',
      error: '',
      viewers: { 'win-a': NOW }
    })
    const res = await applyTraceAlarm({
      now: NOW,
      windowOpen: true,
      loadLease: box.load,
      saveLease: box.save,
      readExpiration: async () => NOW + HOUR,
      renew: async () => {
        renews += 1
        return { expiresAt: NOW + HOUR }
      },
      scheduleAlarm: alarm.schedule,
      clearAlarm: alarm.clear
    })
    assert.equal(renews, 0)
    assert.equal(res.action, 'wait')
    assert.equal(alarm.when(), NOW + HOUR - RENEW_LEAD_MS)
  })
})

describe('只留在这台电脑', () => {
  it('租约不带登录态，也不写同步存储', async () => {
    const session = { data: {}, async set(obj) { Object.assign(this.data, obj) }, async remove(key) { delete this.data[key] } }
    const forbidden = []
    const storage = {
      session,
      local: { async set(obj) { forbidden.push(['local', obj]) } },
      sync: { async set(obj) { forbidden.push(['sync', obj]) } }
    }
    await writeTraceLease(storage, {
      envId: 'env-1',
      expiresAt: NOW + HOUR,
      renewAt: NOW + HOUR - RENEW_LEAD_MS,
      viewers: { 'win-a': NOW },
      sessionId: '00Dxx!secret',
      hostname: 'example.my.salesforce.com',
      cookie: 'sid=secret'
    })
    const saved = session.data[TRACE_LEASE_KEY]
    assert.equal(saved.envId, 'env-1')
    assert.equal(saved.sessionId, undefined)
    assert.equal(saved.hostname, undefined)
    assert.equal(saved.cookie, undefined)
    assert.deepEqual(forbidden, [])
    assert.equal(sanitizeTraceLease(saved).sessionId, undefined)

    await writeTraceLease(storage, null)
    assert.equal(session.data[TRACE_LEASE_KEY], undefined)
  })

  it('日志窗口地址只认本扩展的日志页', () => {
    assert.equal(
      isApexLogWindowUrl('chrome-extension://abc/tool-window.html?tool=apex-log&hostname=x'),
      true
    )
    assert.equal(
      isApexLogWindowUrl('chrome-extension://abc/tool-window.html?tool=soql'),
      false
    )
    assert.equal(
      apexLogWindowIsOpen([
        { url: 'https://example.my.salesforce.com/lightning' },
        { url: 'chrome-extension://abc/tool-window.html?tool=apex-log' }
      ]),
      true
    )
    assert.equal(apexLogWindowIsOpen([{ url: 'https://example.my.salesforce.com' }]), false)
  })

  it('服务进程醒来时，窗口关了就清掉租约', async () => {
    const box = memoryLease()
    const alarm = alarms()
    let ran = 0
    await box.save({ envId: 'env-1', renewAt: NOW + HOUR, viewers: { a: NOW } })
    const stopped = await rearmTraceRenewFromLease({
      now: NOW,
      windowOpen: false,
      loadLease: box.load,
      saveLease: box.save,
      clearAlarm: alarm.clear,
      scheduleAlarm: alarm.schedule,
      alarmPending: alarm.pending,
      runDue: async () => {
        ran += 1
        return { action: 'renewed' }
      }
    })
    assert.equal(stopped.action, 'stop')
    assert.equal(ran, 0)
    assert.equal(box.read(), null)
  })

  it('服务进程醒来时，窗口还开着且还没到期就只把闹钟排回', async () => {
    const box = memoryLease()
    const alarm = alarms()
    let ran = 0
    await box.save({
      envId: 'env-1',
      renewAt: NOW + 30 * 60 * 1000,
      viewers: { a: NOW }
    })
    const res = await rearmTraceRenewFromLease({
      now: NOW,
      windowOpen: true,
      loadLease: box.load,
      saveLease: box.save,
      clearAlarm: alarm.clear,
      scheduleAlarm: alarm.schedule,
      alarmPending: async () => false,
      runDue: async () => {
        ran += 1
        return { action: 'renewed' }
      }
    })
    assert.equal(res.action, 'rescheduled')
    assert.equal(ran, 0)
    assert.equal(alarm.when(), NOW + 30 * 60 * 1000)
  })
})

describe('界面文案和接线', () => {
  const locales = ['zh-CN', 'en', 'ja']
  const keys = ['autoRenewPending', 'autoRenewAt', 'autoRenewFailed', 'autoRenewHint']

  it('简体中文、英文、日文都有新文案', () => {
    const packs = locales.map((name) =>
      JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${name}.json`), 'utf8')).apexLog
    )
    for (const key of keys) {
      const values = packs.map((pack) => pack[key])
      for (const value of values) {
        assert.equal(typeof value, 'string')
        assert.ok(value.trim().length > 0)
      }
      assert.equal(new Set(values).size, 3)
    }
    assert.match(packs[0].autoRenewHint, /关掉窗口/)
    assert.match(packs[0].autoRenewHint, /手动/)
    assert.match(packs[1].autoRenewAt, /\{time\}/)
    assert.match(packs[2].autoRenewAt, /\{time\}/)
  })

  it('日志窗口会自动续，关窗会停，手动续期还在', () => {
    const vue = readFileSync(resolve(root, 'src/tools/apex-log/ApexLogApp.vue'), 'utf8')
    assert.match(vue, /traceWatch/)
    assert.match(vue, /traceUnwatch/)
    assert.match(vue, /async function onRenewTrace[\s\S]*?renewTraceFlag/)
    assert.match(vue, /function stopRuntime[\s\S]*?traceUnwatch/)
    assert.match(vue, /apexLog\.autoRenewHint/)
    assert.doesNotMatch(vue, /25 \* 60 \* 1000/)
  })

  it('续期状态不进账号同步', () => {
    const files = [
      'src/tools/apex-log/apexLogBackground.js',
      'src/tools/apex-log/sfUserTrace.js',
      'src/tools/apex-log/traceRenew.js'
    ]
    for (const file of files) {
      const text = readFileSync(resolve(root, file), 'utf8')
      assert.doesNotMatch(text, /storage\.sync/)
    }
    const background = readFileSync(resolve(root, 'src/tools/apex-log/apexLogBackground.js'), 'utf8')
    assert.match(background, /applyTraceAlarm/)
    assert.match(background, /writeTraceLease/)
    assert.match(background, /apexLogWindowIsOpen/)
    const manifest = readFileSync(resolve(root, 'manifest.json'), 'utf8')
    assert.match(manifest, /"alarms"/)
  })
})
