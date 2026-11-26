import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PAYMENT_GATE_REASONS,
  planPaymentToolGate,
  resolvePaymentAccess
} from './paymentAccess.js'

describe('resolvePaymentAccess', () => {
  it('switch OFF: always allow', () => {
    assert.deepEqual(
      resolvePaymentAccess({ switchEnabled: false, isAuthed: false, isPaid: false }),
      {
        allow: true,
        reason: PAYMENT_GATE_REASONS.ALLOWED,
        requireLogin: false,
        requirePayment: false
      }
    )
    assert.equal(
      resolvePaymentAccess({ switchEnabled: false, isAuthed: true, isPaid: false }).allow,
      true
    )
  })

  it('switch ON + not authed → login required', () => {
    const r = resolvePaymentAccess({ switchEnabled: true, isAuthed: false, isPaid: false })
    assert.equal(r.allow, false)
    assert.equal(r.reason, PAYMENT_GATE_REASONS.LOGIN_REQUIRED)
    assert.equal(planPaymentToolGate(r), 'need-login')
  })

  it('switch ON + authed + unpaid → payment required', () => {
    const r = resolvePaymentAccess({ switchEnabled: true, isAuthed: true, isPaid: false })
    assert.equal(r.allow, false)
    assert.equal(r.reason, PAYMENT_GATE_REASONS.PAYMENT_REQUIRED)
    assert.equal(planPaymentToolGate(r), 'need-payment')
  })

  it('switch ON + paid → allow', () => {
    const r = resolvePaymentAccess({ switchEnabled: true, isAuthed: true, isPaid: true })
    assert.equal(r.allow, true)
    assert.equal(planPaymentToolGate(r), 'proceed')
  })

  it('switch ON + fetchFailed → fail-closed', () => {
    const r = resolvePaymentAccess({
      switchEnabled: true,
      isAuthed: true,
      isPaid: true,
      fetchFailed: true
    })
    assert.equal(r.allow, false)
    assert.equal(r.reason, PAYMENT_GATE_REASONS.UNKNOWN_BLOCKED)
    assert.equal(planPaymentToolGate(r), 'blocked')
  })
})
