/**
 * Unit tests for settlement-notice silencing: registered side-child reports and
 * settlements stop before they enter the parent inbox, everything else passes.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { createSettlementSilence } from '../src/settle-silence'

const SIDE = '11111111-1111-4111-8111-111111111111' as SessionId
const OTHER = '22222222-2222-4222-8222-222222222222' as SessionId

function notice(sender: string, kind: 'agent-message' | 'subagent-report' | 'subagent-settled' = 'subagent-settled'): UserMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: 'Background subagent finished.' }],
    source: { kind, form: 'notice', senderSessionId: sender },
  } as unknown as UserMessage
}

function userMessage(text: string): UserMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  } as unknown as UserMessage
}

function fakeAgent(): Agent & { delivered: { method: string; message: UserMessage }[] } {
  const delivered: { method: string; message: UserMessage }[] = []
  return {
    session: { id: OTHER },
    delivered,
    followup(message: UserMessage) { delivered.push({ method: 'followup', message }) },
    steer(message: UserMessage) { delivered.push({ method: 'steer', message }) },
    inject(message: UserMessage) { delivered.push({ method: 'inject', message }) },
  } as unknown as Agent & { delivered: { method: string; message: UserMessage }[] }
}

function setup(liveAgents: Agent[] = []) {
  const created = { handler: undefined as ((payload: { agent: Agent }) => void) | undefined }
  const disposed = { handler: undefined as ((payload: { agent: Agent }) => void) | undefined }
  const createdDispose = vi.fn()
  const disposedDispose = vi.fn()
  const ctx = {
    agents: { list: () => liveAgents },
    on: (name: string, handler: unknown) => {
      if (name === 'agent/created') {
        created.handler = handler as (payload: { agent: Agent }) => void
        return createdDispose
      }
      if (name === 'agent/disposed') {
        disposed.handler = handler as (payload: { agent: Agent }) => void
        return disposedDispose
      }
      return vi.fn()
    },
  }
  return {
    silence: createSettlementSilence(ctx as never),
    created, disposed, createdDispose, disposedDispose,
  }
}

beforeEach(() => {
  vi.stubEnv('DSH_HOME', mkdtempSync(join(tmpdir(), 'dsh-sidechat-silence-')))
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createSettlementSilence', () => {
  it.each(['followup', 'steer', 'inject'] as const)(
    'drops a recorded side child before parent.%s writes it to the inbox',
    (method) => {
      const { silence } = setup()
      const parent = fakeAgent()
      silence.noteChild(parent, SIDE)
      parent[method](notice(SIDE))
      expect(parent.delivered).toEqual([])
    },
  )

  it.each(['agent-message', 'subagent-report'] as const)('also drops %s from a recorded side child', (kind) => {
    const { silence } = setup()
    const parent = fakeAgent()
    silence.noteChild(parent, SIDE)
    parent.followup(notice(SIDE, kind))
    expect(parent.delivered).toEqual([])
  })

  it('passes ordinary messages and notices from unregistered children', () => {
    const { silence } = setup()
    const parent = fakeAgent()
    silence.noteChild(parent, SIDE)
    parent.followup(userMessage('继续干活'))
    parent.steer(notice(OTHER))
    expect(parent.delivered).toEqual([
      { method: 'followup', message: userMessage('继续干活') },
      { method: 'steer', message: notice(OTHER) },
    ])
  })

  it('patches future parent agents so persisted child ids stay silent after restart', () => {
    const first = setup()
    const original = fakeAgent()
    first.silence.noteChild(original, SIDE)
    first.silence.dispose()

    const restarted = setup()
    const resumedParent = fakeAgent()
    restarted.created.handler?.({ agent: resumedParent })
    resumedParent.followup(notice(SIDE))
    resumedParent.steer(notice(SIDE, 'agent-message'))
    expect(resumedParent.delivered).toEqual([])
  })

  it('patches parents that are already live when the plugin loads', () => {
    const first = setup()
    first.silence.noteChild(fakeAgent(), SIDE)
    first.silence.dispose()

    const liveParent = fakeAgent()
    setup([liveParent])
    liveParent.followup(notice(SIDE))
    expect(liveParent.delivered).toEqual([])
  })

  it('restores patched delivery methods and removes both listeners on dispose', () => {
    const { silence, createdDispose, disposedDispose } = setup()
    const parent = fakeAgent()
    silence.noteChild(parent, SIDE)
    silence.dispose()
    parent.followup(notice(SIDE))
    expect(parent.delivered).toEqual([{ method: 'followup', message: notice(SIDE) }])
    expect(createdDispose).toHaveBeenCalledTimes(1)
    expect(disposedDispose).toHaveBeenCalledTimes(1)
  })

  it('restores a disposed agent before the plugin unloads', () => {
    const { silence, disposed } = setup()
    const parent = fakeAgent()
    silence.noteChild(parent, SIDE)
    disposed.handler!({ agent: parent })
    parent.followup(notice(SIDE))
    expect(parent.delivered).toEqual([{ method: 'followup', message: notice(SIDE) }])
    silence.dispose()
  })

  it('leaves a later wrapper in place when restoring', () => {
    const { silence, disposed } = setup()
    const parent = fakeAgent()
    silence.noteChild(parent, SIDE)
    const later = vi.fn()
    ;(parent as unknown as Record<string, unknown>).followup = later
    disposed.handler!({ agent: parent })
    parent.followup(notice(SIDE))
    expect(later).toHaveBeenCalledTimes(1)
    silence.dispose()
  })
})

describe('durable child-id registry', () => {
  it('rejects corrupt identity data and refuses to reserve a child when its identity cannot be saved', () => {
    const path = join(process.env.DSH_HOME!, 'sidechat-children.json')
    writeFileSync(path, '{')
    expect(() => setup()).toThrow()
    writeFileSync(path, '[42]')
    expect(() => setup()).toThrow()
    writeFileSync(path, '[]')
    const { silence } = setup()
    const blockedHome = join(process.env.DSH_HOME!, 'blocked')
    mkdirSync(join(blockedHome, 'sidechat-children.json'), { recursive: true })
    vi.stubEnv('DSH_HOME', blockedHome)
    expect(() => silence.reserveChild(fakeAgent())).toThrow()
    silence.dispose()
  })

  it('does not rewrite the registry for an already recorded child', () => {
    const { silence } = setup()
    const parent = fakeAgent()
    silence.noteChild(parent, SIDE)
    // A second save would fail against this blocked home; the idempotent
    // noteChild must not attempt it.
    const blockedHome = join(process.env.DSH_HOME!, 'blocked')
    mkdirSync(join(blockedHome, 'sidechat-children.json'), { recursive: true })
    vi.stubEnv('DSH_HOME', blockedHome)
    expect(() => silence.noteChild(parent, SIDE)).not.toThrow()
    silence.dispose()
  })

  it('leaves no temporary file behind after a save', () => {
    const { silence } = setup()
    silence.noteChild(fakeAgent(), SIDE)
    const names = readdirSync(process.env.DSH_HOME!)
    expect(names.filter(name => name.includes('.tmp-'))).toEqual([])
    silence.dispose()
  })

  it('persists recorded ids under DSH_HOME and reloads them', () => {
    const home = process.env.DSH_HOME!
    const first = setup()
    first.silence.noteChild(fakeAgent(), SIDE)
    const path = join(home, 'sidechat-children.json')
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toContain(SIDE)
    const restarted = setup()
    const resumedParent = fakeAgent()
    restarted.created.handler?.({ agent: resumedParent })
    resumedParent.followup(notice(SIDE))
    expect(resumedParent.delivered).toEqual([])
  })
})
