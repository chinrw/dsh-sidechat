/**
 * Unit tests for the side-chat tab's row derivation helpers.
 */

import { describe, expect, it } from 'vitest'
import type { SessionProjectionSnapshot, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentCatalogEntry } from '@deepseek-ai/dsh-subagent/client'
import { runningCount, sidechatRows } from '../src/client/SidechatTab'

const PARENT = 'parent-1' as SessionId
const CHILD_A = '11111111-1111-4111-8111-111111111111' as SessionId
const CHILD_B = '22222222-2222-4222-8222-222222222222' as SessionId

function snapshot(entries: SubagentCatalogEntry[]): SessionProjectionSnapshot {
  return { values: { subagentCatalog: entries }, state: 'ready', error: null }
}

function summary(id: SessionId, running: boolean, title?: string): SessionSummary {
  return { id, running, displayTitle: title ?? id, blank: false, updatedAt: 0, retainedBy: {}, ...(title === undefined ? {} : { title }) }
}

describe('sidechatRows', () => {
  it('returns [] for an absent catalog', () => {
    expect(sidechatRows(undefined, {})).toEqual([])
  })

  it('resolves child labels: entry label, then summary title, then id', () => {
    const rows = sidechatRows(snapshot([
      { id: CHILD_A, createdAt: 0, mode: 'continuable', label: '调研 X' },
      { id: CHILD_B, createdAt: 0, mode: 'one-shot' },
    ]), {
      [CHILD_A]: summary(CHILD_A, true),
      [CHILD_B]: summary(CHILD_B, false, '问答标题'),
    })
    expect(rows).toEqual([
      { kind: 'child', id: CHILD_A, mode: 'continuable', activity: 'running', label: '调研 X' },
      { kind: 'child', id: CHILD_B, mode: 'one-shot', activity: 'inactive', label: '问答标题' },
    ])
  })

  it('falls back to the session id without any title source', () => {
    const rows = sidechatRows(snapshot([
      { id: CHILD_A, createdAt: 0, mode: 'one-shot' },
    ]), {})
    expect(rows[0]).toEqual({ kind: 'child', id: CHILD_A, mode: 'one-shot', activity: 'unknown', label: CHILD_A })
  })

  it('uses command identity rather than an editable title for BTW presentation', () => {
    const catalog = snapshot([
      { id: CHILD_A, createdAt: 0, mode: 'continuable', label: 'renamed question' },
      { id: CHILD_B, createdAt: 0, mode: 'continuable', label: 'BTW: a normal side thread' },
    ])
    const rows = sidechatRows({
      ...catalog, values: { ...catalog.values, sidechatModes: { [CHILD_A]: 'btw', [CHILD_B]: 'side' } },
    }, {})
    expect(rows[0]).toMatchObject({ mode: 'continuable', command: 'btw' })
    expect(rows[1]).toMatchObject({ mode: 'continuable', command: 'side' })
  })

  it('does not offer local history for external executions', () => {
    const rows = sidechatRows(snapshot([
      { id: CHILD_A, createdAt: 0, mode: 'external' },
    ]), {})
    expect(rows).toEqual([{ kind: 'diagnostic', id: CHILD_A, reason: 'unsupported' }])
  })
})

describe('runningCount', () => {
  it('counts only running child rows', () => {
    const rows = sidechatRows(snapshot([
      { id: CHILD_A, createdAt: 0, mode: 'continuable', label: 'a' },
      { id: CHILD_B, createdAt: 0, mode: 'one-shot' },
      { id: PARENT, createdAt: 0, mode: 'external' },
    ]), { [CHILD_A]: summary(CHILD_A, true) })
    expect(runningCount(rows)).toBe(1)
  })
})
