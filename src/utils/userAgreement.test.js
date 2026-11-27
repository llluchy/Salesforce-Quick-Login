import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeAgreementAcceptedAt,
  readUserAgreementAcceptedAt,
  shouldShowUserAgreement,
  writeUserAgreementOnce
} from './userAgreement.js'

describe('shouldShowUserAgreement', () => {
  it('only when authed + switch ON + not accepted', () => {
    assert.equal(shouldShowUserAgreement({
      isAuthed: true,
      switchEnabled: true,
      acceptedAt: null
    }), true)
    assert.equal(shouldShowUserAgreement({
      isAuthed: false,
      switchEnabled: true,
      acceptedAt: null
    }), false)
    assert.equal(shouldShowUserAgreement({
      isAuthed: true,
      switchEnabled: false,
      acceptedAt: null
    }), false)
    assert.equal(shouldShowUserAgreement({
      isAuthed: true,
      switchEnabled: true,
      acceptedAt: '2026-11-26T00:00:00.000Z'
    }), false)
  })
})

describe('writeUserAgreementOnce', () => {
  it('inserts when no row', async () => {
    const store = { row: null }
    const io = {
      async selectOwn() {
        return { data: store.row, error: null }
      },
      async insertOwn(_userId, at) {
        store.row = { user_agreement_accepted_at: at }
        return { data: store.row, error: null }
      },
      async updateOwnIfNull() {
        throw new Error('should not update')
      }
    }
    const saved = await writeUserAgreementOnce(io, 'u1', '2026-11-26T00:00:00.000Z')
    assert.equal(saved, '2026-11-26T00:00:00.000Z')
    assert.equal(await readUserAgreementAcceptedAt(io, 'u1'), saved)
  })

  it('does not overwrite existing acceptance', async () => {
    const io = {
      async selectOwn() {
        return { data: { user_agreement_accepted_at: 't0' }, error: null }
      },
      async insertOwn() {
        throw new Error('should not insert')
      },
      async updateOwnIfNull() {
        throw new Error('should not update')
      }
    }
    assert.equal(await writeUserAgreementOnce(io, 'u1', 't1'), 't0')
    assert.equal(normalizeAgreementAcceptedAt(''), null)
  })
})
