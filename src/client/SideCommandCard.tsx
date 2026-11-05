/**
 * Command cards for `/side` and `/btw` (browser half). The card renders the
 * command's outcome and is the live discovery point for the native Sidebar
 * tab: when a command settles with a created child, the card opens the
 * `sidechat` tab with that child selected. A manual jump stays available for
 * a command that settled while the page was elsewhere.
 */

import { useEffect, useRef } from 'react'
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { sideCommandResult } from '../command-result.ts'
import { NS } from './locales.ts'

/** Props supplied by the keyed command row plus the plugin's own jump. */
export interface SideCommandCardProps {
  node: CommandNode
  /** Open the native Sidebar tab for a created child. */
  onOpen?: (childId: SessionId, mode: SideCommandKind) => void
  /** Translate a `sidechat` dictionary key. */
  t?: PropsLocale<typeof NS>['t']
}

/** Command key → child mode carried by the host's success text marker. */
export type SideCommandKind = 'side' | 'btw'

const MARKDOWN_LABELS = {
  code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
  footnotes: 'Footnotes',
} as const

/**
 * Resolve the created child session id from a settled command node, or
 * undefined while the command is running, failed, or the id is absent.
 * The host pins the id in a stable marker: `/side` texts start with
 * `Side conversation started: <uuid>.`, `/btw` texts with
 * `BTW question started: <uuid>.`.
 */
export function resolveChildSessionId(node: CommandNode, kind: SideCommandKind): SessionId | undefined {
  const created = sideCommandResult(node.outcome)
  return created?.mode === kind ? created.childId : undefined
}

/** Last resolved child id for each observed sidechat command. */
export type ObservedSideCommands = ReadonlyMap<CommandNode['commandId'], SessionId | undefined>

/**
 * Fold one command-node snapshot into the observer state.
 *
 * The first snapshot is a replay baseline and emits nothing. Later snapshots
 * emit a child when a post-mount command appears already settled or an
 * observed pending command settles. The mount timestamp excludes late
 * history hydration; recording the resolved id makes repeats idempotent.
 */
export function observeCreatedChildren(
  previous: ObservedSideCommands | undefined,
  nodes: readonly CommandNode[],
  startedAt: number,
): { known: ObservedSideCommands; children: readonly SessionId[] } {
  const known = new Map(previous)
  const children: SessionId[] = []
  for (const node of nodes) {
    if (node.name !== 'side' && node.name !== 'btw') continue
    const child = resolveChildSessionId(node, node.name)
    if (
      previous !== undefined
      && node.time >= startedAt
      && child !== undefined
      && previous.get(node.commandId) !== child
    ) {
      children.push(child)
    }
    known.set(node.commandId, child)
  }
  return { known, children }
}

/**
 * The command card. It is presentation plus one live behavior: a command that
 * settles after this card mounted opens the native Sidebar tab once, with the
 * created child selected. History replay (a command older than the mount)
 * never opens anything.
 */
export function SideCommandCard({ node, onOpen, t }: SideCommandCardProps): JSX.Element {
  const kind: SideCommandKind = node.name === 'btw' ? 'btw' : 'side'
  const outcome = node.outcome
  const child = resolveChildSessionId(node, kind)
  const startedAt = useRef(Date.now())
  const opened = useRef(new Set<string>())

  useEffect(() => {
    if (child === undefined || onOpen === undefined) return
    if (node.time < startedAt.current) return
    if (opened.current.has(node.commandId)) return
    opened.current.add(node.commandId)
    onOpen(child, kind)
  }, [child, kind, node.commandId, node.time, onOpen])

  const label = outcome === null
    ? '…'
    : outcome.kind === 'error'
      ? (outcome.text ?? '')
      : (outcome.text ?? `/${kind}`)
  return (
    <div
      style={{
        padding: '6px 10px',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-module-platform, #f5f6f7)',
        fontSize: '13px',
        lineHeight: '1.5',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <strong style={{ whiteSpace: 'nowrap' }}>/{node.name ?? kind}</strong>
        {child !== undefined && onOpen !== undefined && (
          <button
            type="button"
            onClick={() => { onOpen(child, kind) }}
            style={{
              marginLeft: 'auto',
              padding: '1px 8px',
              border: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--dsw-alias-label-secondary, #61666b)',
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {t?.('card.open') ?? 'Open in Sidebar'}
          </button>
        )}
      </div>
      {/* The /btw answer and /side notice render as markdown (tables, code, lists). */}
      <div style={{ overflowX: 'auto' }}>
        <MarkdownText text={label} streaming={false} labels={MARKDOWN_LABELS} />
      </div>
    </div>
  )
}
