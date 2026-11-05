import { describe, expect, it } from 'vitest'
import type { CommandId } from '@deepseek-ai/dsh-commands'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { sidechatModesProjection } from '../src/sidechat-projection'

const CHILD_ID = '11111111-1111-4111-8111-111111111111'

function done(kind: 'success' | 'error', text: string): SessionEvent {
  return {
    type: 'command/done', seq: SessionSeq(1), time: 0,
    data: { commandId: 'command-1' as CommandId, kind, text },
  }
}

describe('sidechat command identity', () => {
  it('keeps BTW identity across resume markers but excludes fork-inherited commands', () => {
    const recorded = sidechatModesProjection.apply({}, done('success', `BTW question started: ${CHILD_ID}.`))
    expect(recorded).toEqual({ [CHILD_ID]: 'btw' })
    expect(sidechatModesProjection.apply(recorded, done('error', `Side conversation started: ${CHILD_ID}.`))).toBe(recorded)
    expect(sidechatModesProjection.apply(recorded, { type: 'session/end-seed', seq: SessionSeq(2), time: 0, data: {} })).toBe(recorded)
    expect(sidechatModesProjection.apply(recorded, { type: 'session/end-seed', seq: SessionSeq(3), time: 0, data: { inherited: true } })).toEqual({})
  })
})
