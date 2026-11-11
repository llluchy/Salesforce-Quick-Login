import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filterLogLines, filterParsedLines } from './logLineFilter.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function line(raw, kind, type) {
  return { raw, kind, type }
}

const lines = [
  line('59.0 APEX_CODE,FINEST;DB,INFO', 'header', 'HEADER'),
  line('11:47:46.038 (38296000)|USER_DEBUG|[12]|DEBUG|Customer name is Ada', 'debug', 'USER_DEBUG'),
  line('11:47:46.100 (40000000)|SOQL_EXECUTE_BEGIN|[20]|Aggregations:0|SELECT Id FROM Account WHERE Name = \'Ada\'', 'db', 'SOQL_EXECUTE_BEGIN'),
  line('11:47:46.200 (50000000)|EXCEPTION_THROWN|[30]|System.NullPointerException: Attempt to de-reference a null object', 'error', 'EXCEPTION_THROWN'),
  line('11:47:46.300 (60000000)|CODE_UNIT_STARTED|[EXTERNAL]|01pxx|AccountService.handle', 'code', 'CODE_UNIT_STARTED')
]

function raws(rows) {
  return rows.map((row) => row.raw)
}

describe('filterLogLines', () => {

  it('keeps the category view when the query is empty or blank', () => {
    const errors = filterParsedLines(lines, 'error')
    assert.deepEqual(raws(filterLogLines(lines, 'error', '')), raws(errors))
    assert.deepEqual(raws(filterLogLines(lines, 'error', '   ')), raws(errors))
    assert.deepEqual(raws(filterLogLines(lines, 'all', undefined)), raws(lines))
  })

  it('shows only lines that contain the typed text', () => {
    const matched = raws(filterLogLines(lines, 'all', 'ada'))
    assert.deepEqual(matched, [
      '11:47:46.038 (38296000)|USER_DEBUG|[12]|DEBUG|Customer name is Ada',
      '11:47:46.100 (40000000)|SOQL_EXECUTE_BEGIN|[20]|Aggregations:0|SELECT Id FROM Account WHERE Name = \'Ada\''
    ])
  })

  it('matches the event type as well as the line content', () => {
    const matched = raws(filterLogLines(lines, 'all', 'EXCEPTION_THROWN'))
    assert.equal(matched.length, 1)
    assert.match(matched[0], /NullPointerException/)
  })

  it('keeps the category filter together with the text', () => {
    const dbOnly = raws(filterLogLines(lines, 'db', 'Ada'))
    assert.deepEqual(dbOnly, [
      '11:47:46.100 (40000000)|SOQL_EXECUTE_BEGIN|[20]|Aggregations:0|SELECT Id FROM Account WHERE Name = \'Ada\''
    ])
    assert.deepEqual(raws(filterLogLines(lines, 'error', 'Ada')), [])
    assert.equal(raws(filterLogLines(lines, 'error', 'NullPointer')).length, 1)
  })

  it('returns to the same category lines after the text is cleared', () => {
    const category = 'code'
    const narrowed = filterLogLines(lines, category, 'AccountService')
    assert.equal(narrowed.length, 1)
    assert.deepEqual(
      raws(filterLogLines(lines, category, '')),
      raws(filterParsedLines(lines, category))
    )
  })

  it('does not change the parsed lines', () => {
    const before = raws(lines)
    filterLogLines(lines, 'debug', 'customer')
    assert.deepEqual(raws(lines), before)
    assert.equal(lines.length, 5)
  })
})

describe('log body search copy', () => {
  const keys = ['bodySearchLabel', 'bodySearchPlaceholder', 'bodySearchClear', 'noBodyMatch']

  it('has simplified Chinese, English, and Japanese text', () => {
    const locales = {
      'zh-CN': JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/zh-CN.json'), 'utf8')),
      en: JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/en.json'), 'utf8')),
      ja: JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/ja.json'), 'utf8'))
    }
    for (const key of keys) {
      const values = Object.values(locales).map((file) => file.apexLog[key])
      for (const value of values) {
        assert.equal(typeof value, 'string')
        assert.ok(value.trim().length > 0, key)
      }
      assert.equal(new Set(values).size, 3, key)
    }
    assert.match(locales['zh-CN'].apexLog.noBodyMatch, /没有包含这段文字的行/)
    assert.match(locales.en.apexLog.noBodyMatch, /No lines contain this text/)
    assert.match(locales.ja.apexLog.noBodyMatch, /この文字を含む行はありません/)
  })

  it('is wired in the log detail view and is not stored as a setting', () => {
    const source = readFileSync(resolve(root, 'src/tools/apex-log/ApexLogApp.vue'), 'utf8')
    assert.match(source, /v-model="bodyQuery"/)
    assert.match(source, /filterLogLines\(parsedLog\.value\.lines, detailFilter\.value, bodyQuery\.value\)/)
    assert.match(source, /apexLog\.noBodyMatch/)
    assert.match(source, /bodyQuery\.value = ''/)
    assert.doesNotMatch(source, /bodyQuery[\s\S]{0,80}(chrome\.storage|supabase)/)
  })
})
