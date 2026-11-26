import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONTACT_EMAILS,
  PAYMENT_CHOICE_CONTINUE,
  PAYMENT_CHOICE_DEACTIVATE,
  normalizePaymentChoice,
  readPaymentChoice,
  shouldShowPaymentReminder,
  writePaymentChoiceOnce
} from './paymentChoice.js'
import {
  PAYMENT_MASTER_KEY,
  parsePaymentMasterEnabled,
  readPaymentMasterEnabled
} from './paymentMasterSwitch.js'

describe('paymentChoice normalize', () => {
  it('accepts continue and deactivate only', () => {
    assert.equal(normalizePaymentChoice('continue'), PAYMENT_CHOICE_CONTINUE)
    assert.equal(normalizePaymentChoice('deactivate'), PAYMENT_CHOICE_DEACTIVATE)
    assert.equal(normalizePaymentChoice(null), null)
    assert.equal(normalizePaymentChoice(''), null)
    assert.equal(normalizePaymentChoice('other'), null)
  })

  it('exposes both contact emails', () => {
    assert.deepEqual([...CONTACT_EMAILS], [
      'llluchy@outlook.com',
      'llluchy@qq.com'
    ])
  })
})

describe('shouldShowPaymentReminder', () => {
  it('requires authed + switch OFF + no choice', () => {
    assert.equal(shouldShowPaymentReminder({
      isAuthed: false,
      switchEnabled: false,
      paymentChoice: null
    }), false)
    assert.equal(shouldShowPaymentReminder({
      isAuthed: true,
      switchEnabled: true,
      paymentChoice: null
    }), false)
    assert.equal(shouldShowPaymentReminder({
      isAuthed: true,
      switchEnabled: false,
      paymentChoice: 'continue'
    }), false)
    assert.equal(shouldShowPaymentReminder({
      isAuthed: true,
      switchEnabled: false,
      paymentChoice: null
    }), true)
  })
})

describe('paymentMasterSwitch', () => {
  it('defaults missing value to OFF', () => {
    assert.equal(parsePaymentMasterEnabled(null), false)
    assert.equal(parsePaymentMasterEnabled({ value: { enabled: false } }), false)
    assert.equal(parsePaymentMasterEnabled({ value: { enabled: true } }), true)
    assert.equal(parsePaymentMasterEnabled({ value: '{"enabled":true}' }), true)
  })

  it('reads payment_master key via io', async () => {
    const io = {
      async selectMaster() {
        return { data: { key: PAYMENT_MASTER_KEY, value: { enabled: false } }, error: null }
      }
    }
    assert.equal(await readPaymentMasterEnabled(io), false)
  })
})

describe('writePaymentChoiceOnce', () => {
  it('inserts when no row', async () => {
    const store = { row: null }
    const io = {
      async selectOwn() {
        return { data: store.row, error: null }
      },
      async insertOwn(_userId, choice, at) {
        store.row = { payment_choice: choice, payment_choice_at: at }
        return { data: store.row, error: null }
      },
      async updateOwnIfNull() {
        throw new Error('should not update')
      }
    }
    const saved = await writePaymentChoiceOnce(io, 'u1', 'continue', '2026-11-26T00:00:00.000Z')
    assert.equal(saved, 'continue')
    assert.equal(store.row.payment_choice, 'continue')
  })

  it('does not overwrite existing choice', async () => {
    const io = {
      async selectOwn() {
        return { data: { payment_choice: 'deactivate', payment_choice_at: 't0' }, error: null }
      },
      async insertOwn() {
        throw new Error('should not insert')
      },
      async updateOwnIfNull() {
        throw new Error('should not update')
      }
    }
    const saved = await writePaymentChoiceOnce(io, 'u1', 'continue')
    assert.equal(saved, 'deactivate')
  })

  it('updates only when null', async () => {
    const store = { row: { payment_choice: null, payment_choice_at: null } }
    const io = {
      async selectOwn() {
        return { data: { ...store.row }, error: null }
      },
      async insertOwn() {
        throw new Error('should not insert')
      },
      async updateOwnIfNull(_userId, choice, at) {
        if (store.row.payment_choice != null) return { data: null, error: null }
        store.row = { payment_choice: choice, payment_choice_at: at }
        return { data: store.row, error: null }
      }
    }
    const saved = await writePaymentChoiceOnce(io, 'u1', 'deactivate', '2026-11-26T01:00:00.000Z')
    assert.equal(saved, 'deactivate')
    assert.equal(await readPaymentChoice(io, 'u1'), 'deactivate')
  })
})
