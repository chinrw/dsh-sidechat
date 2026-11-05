/**
 * Stop side-conversation reports and settlement notices before they enter the
 * parent inbox. Continuable children can deliver both `agent-message` and
 * `subagent-settled` messages through `followup`, `steer`, or `inject`; even
 * filtering later at pre-step leaves inbox and empty-turn events in the main
 * Session log.
 *
 * Child identity is persisted under DSH_HOME so resumed parents still reject
 * authored reports and settlement notices from side children created before a
 * restart. Notices from children this plugin did not register pass through, so
 * other orchestration workflows keep receiving their completion accounts.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type UserMessage } from '@deepseek-ai/dsh-session'

type DeliveryMethod = 'followup' | 'steer' | 'inject'
const DELIVERY_METHODS: readonly DeliveryMethod[] = ['followup', 'steer', 'inject']

/** Per-plugin-instance settlement suppression face. */
export interface SettlementSilence {
  hasChild(childId: SessionId): boolean
  /** Reserve a child id before asynchronous child startup can settle. */
  reserveChild(parent: Agent): SessionId
  /** Register and immediately protect the parent of one side child. */
  noteChild(parent: Agent, childId: SessionId): void
  /** Restore wrapped agents and remove the future-agent listener. */
  dispose(): void
}

/** The persisted child-id registry file (under the DSH home, like settings). */
function registryPath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'sidechat-children.json')
}

function loadChildren(): Set<SessionId> {
  const path = registryPath()
  if (!existsSync(path)) return new Set()
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(parsed) || !parsed.every((id: unknown): id is string => typeof id === 'string')) {
    throw new Error(`sidechat: invalid child registry at ${path}; expected an array of session ids`)
  }
  return new Set(parsed.map(id => SessionId(id)))
}

function saveChildren(children: ReadonlySet<SessionId>): void {
  const path = registryPath()
  mkdirSync(dirname(path), { recursive: true })
  // Write a sibling temporary file and rename it into place, so an interrupted
  // write leaves the previous registry intact.
  const temp = `${path}.tmp-${randomUUID()}`
  try {
    writeFileSync(temp, JSON.stringify([...children]), 'utf8')
    renameSync(temp, path)
  } catch (error) {
    try { rmSync(temp, { force: true }) } catch { /* best effort */ }
    throw error
  }
}

interface SettlementSource {
  kind?: string | undefined
  senderSessionId?: string | undefined
}

function isSideChildDelivery(message: UserMessage, children: ReadonlySet<SessionId>): boolean {
  const source = message.source as SettlementSource | undefined
  return (source?.kind === 'agent-message' || source?.kind === 'subagent-report' || source?.kind === 'subagent-settled')
    && source.senderSessionId !== undefined
    && children.has(source.senderSessionId as SessionId)
}

/**
 * Install the parent-inbox boundary for side settlement notices.
 * @param ctx - root plugin context, used to protect future/resumed agents.
 */
export function createSettlementSilence(ctx: Context): SettlementSilence {
  const children = loadChildren()
  /** One wrapped delivery method: the descriptor it replaced and the wrapper it installed. */
  interface Patch {
    readonly original: PropertyDescriptor | undefined
    readonly wrapper: (message: UserMessage) => void
  }
  const patched = new Map<Agent, Map<DeliveryMethod, Patch>>()

  const protect = (agent: Agent): void => {
    if (patched.has(agent)) return
    const patches = new Map<DeliveryMethod, Patch>()
    for (const method of DELIVERY_METHODS) {
      const original = Object.getOwnPropertyDescriptor(agent, method)
      const previous = agent[method]
      const wrapper = (message: UserMessage): void => {
        if (!isSideChildDelivery(message, children)) previous.call(agent, message)
      }
      Object.defineProperty(agent, method, {
        configurable: true,
        writable: true,
        value: wrapper,
      })
      patches.set(method, { original, wrapper })
    }
    patched.set(agent, patches)
  }

  /** Restore only the methods this instance still owns. */
  const restore = (agent: Agent): void => {
    const patches = patched.get(agent)
    if (patches === undefined) return
    for (const [method, patch] of patches) {
      // A wrapper installed after this one owns the method now; leave it.
      if (agent[method] !== patch.wrapper) continue
      if (patch.original === undefined) delete (agent as unknown as Record<string, unknown>)[method]
      else Object.defineProperty(agent, method, patch.original)
    }
    patched.delete(agent)
  }

  // Protect live parents on hot load and future parents after a cold restart.
  for (const agent of ctx.agents.list()) protect(agent)
  const removeCreatedListener = ctx.on('agent/created', ({ agent }) => { protect(agent); return undefined })
  const removeDisposedListener = ctx.on('agent/disposed', ({ agent }) => { restore(agent); return undefined })

  return {
    hasChild: childId => children.has(childId),
    reserveChild(parent): SessionId {
      protect(parent)
      const childId = SessionId(randomUUID())
      children.add(childId)
      saveChildren(children)
      return childId
    },
    noteChild(parent, childId): void {
      protect(parent)
      // The id was already persisted by reserveChild; a second write would
      // turn a successful start into a reported failure.
      if (children.has(childId)) return
      children.add(childId)
      saveChildren(children)
    },
    dispose(): void {
      removeCreatedListener()
      removeDisposedListener()
      for (const agent of [...patched.keys()]) restore(agent)
    },
  }
}
