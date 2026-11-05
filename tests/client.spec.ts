/**
 * Unit tests for the dsh-sidechat browser half: the jump-target resolver and
 * the slot registration wiring (auto-open of created side conversations).
 */

import { describe, expect, it, vi } from 'vitest'
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply } from '../src/client/index'
import { observeCreatedChildren, resolveChildSessionId, shouldOpenCreatedChild } from '../src/client/SideCommandCard'
import { SIDECHAT_STYLE_CSS } from '../src/client/style'

const CHILD_ID = '54c34e5e-1c29-4a6c-a2f7-4b19a3d92914'

function node(partial: Partial<CommandNode> = {}): CommandNode {
  return {
    kind: 'command',
    seq: 1,
    time: 0,
    commandId: 'cmd-1' as CommandNode['commandId'],
    name: 'side',
    args: null,
    outcome: null,
    ...partial,
  }
}

describe('resolveChildSessionId', () => {
  it('resolves /side success text', () => {
    expect(resolveChildSessionId(node({
      name: 'side',
      outcome: { kind: 'success', text: `Side conversation started: ${CHILD_ID}.` },
    }), 'side')).toBe(CHILD_ID)
  })

  it('resolves /btw success text with the started marker', () => {
    expect(resolveChildSessionId(node({
      name: 'btw',
      outcome: { kind: 'success', text: `BTW question started: ${CHILD_ID}.` },
    }), 'btw')).toBe(CHILD_ID)
  })

  it('returns undefined on malformed text', () => {
    expect(resolveChildSessionId(node({ outcome: { kind: 'success', text: 'no id here' } }), 'side')).toBeUndefined()
    expect(resolveChildSessionId(node({ outcome: { kind: 'success', text: 'plain answer' } }), 'btw')).toBeUndefined()
  })
})

describe('observeCreatedChildren', () => {
  it('ignores commands already settled when the observer mounts', () => {
    const initial = observeCreatedChildren(undefined, [node({
      time: 20,
      outcome: { kind: 'success', text: `Side conversation started: ${CHILD_ID}.` },
    })], 10)
    expect(initial.children).toEqual([])
  })

  it('reveals a fast command that appears already settled after mount', () => {
    const initial = observeCreatedChildren(undefined, [], 10)
    const settled = observeCreatedChildren(initial.known, [node({
      time: 20,
      name: 'btw',
      outcome: { kind: 'success', text: `BTW question started: ${CHILD_ID}.` },
    })], 10)
    expect(settled.children).toEqual([CHILD_ID])
  })

  it('ignores old replay rows that arrive after an initially empty history snapshot', () => {
    const initial = observeCreatedChildren(undefined, [], 20)
    const replay = observeCreatedChildren(initial.known, [node({
      time: 10,
      outcome: { kind: 'success', text: `Side conversation started: ${CHILD_ID}.` },
    })], 20)
    expect(replay.children).toEqual([])
  })

  it('reveals a command when it transitions from pending to success exactly once', () => {
    const initial = observeCreatedChildren(undefined, [], 10)
    const pending = observeCreatedChildren(initial.known, [node({ time: 20 })], 10)
    expect(pending.children).toEqual([])
    const settled = observeCreatedChildren(pending.known, [node({
      time: 20,
      outcome: { kind: 'success', text: `Side conversation started: ${CHILD_ID}.` },
    })], 10)
    expect(settled.children).toEqual([CHILD_ID])
    expect(observeCreatedChildren(settled.known, [node({
      time: 20,
      outcome: { kind: 'success', text: `Side conversation started: ${CHILD_ID}.` },
    })], 10).children).toEqual([])
  })

  it('does not reveal running, failed, or unrelated commands', () => {
    const initial = observeCreatedChildren(undefined, [], 10)
    const observed = observeCreatedChildren(initial.known, [
      node({ time: 20 }),
      node({ time: 20, commandId: 'cmd-2' as CommandNode['commandId'], outcome: { kind: 'error', text: 'boom' } }),
      node({ time: 20, commandId: 'cmd-3' as CommandNode['commandId'], name: 'compact', outcome: { kind: 'success' } }),
    ], 10)
    expect(observed.children).toEqual([])
  })
})

describe('shouldOpenCreatedChild', () => {
  it('opens a command the card watched run', () => {
    expect(shouldOpenCreatedChild({
      child: CHILD_ID as SessionId, pendingSeen: true, alreadyOpened: false,
    })).toBe(true)
  })

  it('does not open a command that was already settled at first render', () => {
    expect(shouldOpenCreatedChild({
      child: CHILD_ID as SessionId, pendingSeen: false, alreadyOpened: false,
    })).toBe(false)
  })

  it('opens at most once per command', () => {
    expect(shouldOpenCreatedChild({
      child: CHILD_ID as SessionId, pendingSeen: true, alreadyOpened: true,
    })).toBe(false)
  })

  it('does not open without a created child', () => {
    expect(shouldOpenCreatedChild({
      child: undefined, pendingSeen: true, alreadyOpened: false,
    })).toBe(false)
  })
})

describe('client apply wiring', () => {
  interface RegisteredSlot {
    options: {
      name: string
      key?: string
      id?: string
      order?: number
      locale?: string
      inject?: (parentSessionId: string) => {
        readTranscript?: (address: unknown) => Promise<unknown>
        readActivity?: (address: unknown) => Promise<unknown>
        sendPrompt?: (address: unknown, text: string) => Promise<boolean>
        refresh?: (parentSessionId: string) => void
        openPath?: (path: string) => void
      }
    }
  }

  function fakeCtx() {
    const registered: RegisteredSlot[] = []
    const tabTypes: unknown[] = []
    const shortcuts: unknown[] = []
    const refreshProjections = vi.fn(() => Promise.resolve())
    const registerLocale = vi.fn()
    const openTab = vi.fn()
    const follow = vi.fn(async function* () {
      yield { type: 'snapshot' as const, cursor: 0, records: [], hasMore: false, header: {}, projections: {} }
    })
    const page = vi.fn(() => Promise.resolve({ ok: true as const, value: { records: [], hasMore: false } }))
    const prompt = vi.fn(() => Promise.resolve({ ok: true as const, value: { messageId: 'm' } }))
    const remote = {
      session: { follow, page, attachment: vi.fn(), openWorkspacePath: vi.fn() },
      subagents: { prompt },
    }
    const ctx = {
      sessions: { refreshProjections },
      locale: { register: registerLocale, bind: () => (key: string) => key },
      effect: (fn: () => void) => { fn() },
      remote,
      sidebarRight: { openTab },
      sidebarRightTabs: {
        register: (definition: unknown) => {
          tabTypes.push(definition)
          return () => {}
        },
      },
      shortcuts: {
        register: (command: unknown) => {
          shortcuts.push(command)
          return () => {}
        },
      },
      inject: (_deps: string[], callback: (scoped: unknown) => void) => { callback(ctx) },
      slots: {
        register: (options: RegisteredSlot['options'], _component: unknown) => {
          registered.push({ options })
          return () => {}
        },
        // The real runtime waits for the slot declaration before running the
        // register callback; the declaration exists in this test context.
        inject: (_name: string, register: () => () => void) => {
          register()
        },
      },
    }
    return { ctx, registered, tabTypes, shortcuts, follow, page, prompt, refreshProjections, openTab }
  }

  it('registers the command cards, the native Sidebar tab type, its body, and the header button', () => {
    const { ctx, registered, tabTypes, shortcuts } = fakeCtx()
    apply(ctx as never)
    expect(registered.map(entry => [entry.options.name, entry.options.key ?? entry.options.id]))
      .toEqual([
        ['conversation.chat.commandview', 'side'],
        ['conversation.chat.commandview', 'btw'],
        ['sidebar.right.pane.tab', '@local/dsh-sidechat'],
        ['conversation.session.header.actions', 'sidechat-open'],
      ])
    expect(tabTypes).toEqual([expect.objectContaining({
      id: '@local/dsh-sidechat',
      kind: 'sidechat',
      keepMounted: true,
      guide: [expect.objectContaining({
        id: 'sidechat',
        commandId: 'sidechat.open',
        order: 30,
      })],
    })])
    // The guide card advertises a real keyboard command.
    expect(shortcuts).toEqual([expect.objectContaining({
      id: 'sidechat.open',
      regions: ['page', 'editable', 'terminal'],
    })])
  })

  it('tab body inject wires the transcript RPC and catalog methods', async () => {
    const { ctx, registered, follow, prompt, refreshProjections } = fakeCtx()
    apply(ctx as never)
    const entry = registered.find(item => item.options.name === 'sidebar.right.pane.tab')!
    const injected = entry.options.inject!('parent-1')
    const address = { parentSessionId: 'parent-1', childSessionId: CHILD_ID, mode: 'continuable' }
    const transcript = await injected.readTranscript!(address)
    expect(follow).toHaveBeenCalledWith({
      address: { kind: 'subagent', parentSessionId: 'parent-1', childSessionId: CHILD_ID, mode: 'continuable' },
      maxMessages: 8,
      assistantStream: true,
    })
    expect(transcript).toEqual({ rows: [], produced: [], complete: true, error: false })
    // The activity line reads a lighter tail page; an empty log yields null.
    const activityLine = await injected.readActivity!(address)
    expect(follow).toHaveBeenCalledWith({
      address: { kind: 'subagent', parentSessionId: 'parent-1', childSessionId: CHILD_ID, mode: 'continuable' },
      maxMessages: 6,
      assistantStream: true,
    })
    expect(activityLine).toBeNull()
    const accepted = await injected.sendPrompt!(address, '继续')
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      ...address, content: [{ type: 'text', text: '继续' }], requestId: expect.any(String),
    }))
    expect(accepted).toBe(true)
    injected.refresh!('parent-1')
    expect(refreshProjections).toHaveBeenCalledWith('parent-1')
  })
})

describe('stylesheet', () => {
  it('ships the running-row shimmer keyframes with a reduced-motion guard', () => {
    expect(SIDECHAT_STYLE_CSS).toContain('@keyframes dsh-sidechat-shimmer')
    expect(SIDECHAT_STYLE_CSS).toContain('prefers-reduced-motion')
  })
})
