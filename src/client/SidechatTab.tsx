/**
 * Side-chat tab (browser half): the body of the plugin's native right-Sidebar
 * tab type. It lists the current session's `/side` and `/btw` subagent
 * children and renders the selected child's transcript — plus a composer for
 * continuable threads — inside the Sidebar pane while the main session stays
 * untouched.
 *
 * The Sidebar owns the chrome: tab strip, split, float, fullscreen, width and
 * persistence all come from `@deepseek-ai/dsh-client-ui-sidebar-right`, so this
 * body only fills its pane. Running rows show a live activity line — the
 * child's latest text or last tool call — polled from a light tail page every
 * 3s while the tab is visible, with a shimmer sweep on the running label
 * (installed once via `style.ts`, reduced-motion safe).
 *
 * Data rides the Session Controller's live subagent catalog —
 * `sessions.list` rows under `projectionsBySession` — for membership, and
 * Session Remote history for conversation content (no activation, no
 * navigation). While the selected child is running, a poll reads its
 * transcript tail (the host serves the live child's in-memory snapshot) and
 * the transcript layer accumulates it with prior rounds, so a `/side` or
 * `/btw` run streams into the tab near-live; the final state lands when the
 * catalog reports the child inactive.
 *
 * The body deliberately never attaches the child session client-side (no
 * `sessions.binding` / session-face subscription): instantiating a session
 * that is never opened leaves it in the runtime's cold state, whose live
 * event frames are dropped — the transcript would only ever refresh on
 * unrelated state flips — and the extra scope minting interferes with the
 * runtime's session staging. Polling keeps the tab a pure RPC consumer.
 *
 * Selection arrives through the tab's navigation parameters: opening the tab
 * with `{ childId, mode }` (the command card does this when a `/side` or
 * `/btw` settles) selects that child; the list stays one click away.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties,
} from 'react'
import type {
  SessionSummary, SessionProjectionSnapshot,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '../sidechat-projection.ts'
import type { SideMode } from '../prompts.ts'
import {
  DisclosureRow, IconBranchOutlineRegular, IconBrowseOutlineRegular, IconChevronLeftOutlineRegular,
  IconRefreshOutlineRegular, IconRightUpOutlineRegular, MarkdownText, StateDot,
  IconThinkOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownCodeLabels, MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { resolveChildActivity, type ChildActivity } from './child-activity.ts'
import { fileMentionsFor } from './sidechat-file-mentions.ts'
import { readActivityRound } from './sidechat-activity.ts'
import { blockText, mergeProduced, resultViewSummary } from './sidechat-view.ts'
import type { TranscriptImage, TranscriptRead, TranscriptRow, ToolDetail } from './sidechat-view.ts'

/** Business actions injected by the tab-body registration (per session scope). */
export interface SidechatTabInjected {
  /** Fetch one child's accumulated, seed-cut transcript. */
  readTranscript(address: SubagentAddress): Promise<TranscriptRead | null>
  /** Fetch one running child's live activity line (light tail page). */
  readActivity(address: SubagentAddress): Promise<string | null>
  /** Deliver one human message to a continuable child. */
  sendPrompt(address: Extract<SubagentAddress, { mode: 'continuable' }>, text: string): Promise<boolean>
  /** Trigger a fresh catalog fetch for the parent session. */
  refresh(parentSessionId: SessionId): void
  /** Open an absolute path through the Session Controller. */
  openPath(path: string): void
}

/** Full props: session standard kit + the tab hook + the inject share + the locale seat. */
export type SidechatTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & SidechatTabInjected
  & PropsLocale<typeof NS>

/** One rendered catalog row, label resolved, diagnostics kept apart. */
export type SidechatRow =
  | {
    kind: 'child'
    id: SessionId
    mode: 'one-shot' | 'continuable' | 'unknown'
    command?: SideMode
    activity: 'running' | 'inactive' | 'unknown'
    label: string
  }
  | {
    kind: 'diagnostic'
    id: SessionId
    reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/**
 * Resolve the catalog into display rows: child entries carry their durable
 * label when present, falling back to the session title and then id.
 * @param catalog - the parent's catalog snapshot (absent while never fetched).
 * @param summaries - session list rows, used as the label fallback source.
 * @returns flat display rows in catalog order.
 */
export function sidechatRows(
  catalog: SessionProjectionSnapshot | undefined,
  summaries: Readonly<Record<SessionId, SessionSummary>>,
): SidechatRow[] {
  if (catalog === undefined) return []
  return (catalog.values.subagentCatalog ?? []).map((entry): SidechatRow => {
    if (entry.mode === 'external') return { kind: 'diagnostic', id: entry.id, reason: 'unsupported' }
    const command = catalog.values.sidechatModes?.[entry.id]
    const summary = summaries[entry.id]
    return {
      kind: 'child',
      id: entry.id,
      mode: entry.mode,
      ...(command === undefined ? {} : { command }),
      // A catalog entry without a session summary has no activity signal yet;
      // reporting it as finished would hide a running child.
      activity: summary === undefined ? 'unknown' : summary.running ? 'running' : 'inactive',
      label: entry.label ?? summary?.title ?? entry.id,
    }
  })
}

/** Number of child rows currently running (the header badge value). */
export function runningCount(rows: readonly SidechatRow[]): number {
  return rows.filter(row => row.kind === 'child' && row.activity === 'running').length
}

/** Localized diagnostic copy, explicit key cases keep the dictionary typed. */
export function diagnosticText(
  reason: 'corrupt' | 'unsupported' | 'unavailable',
  t: SidechatTabProps['t'],
): string {
  switch (reason) {
    case 'corrupt': return t('diagnostic.corrupt')
    case 'unsupported': return t('diagnostic.unsupported')
    case 'unavailable': return t('diagnostic.unavailable')
  }
}

/**
 * Shared token-level palette. DSH web themes the shell through its design
 * tokens (`--dsw-alias-*` / `--dsw-specific-*`, declared on `body` and
 * overridden under `body[data-ds-dark-theme]` by the host's theme plugin),
 * so consuming those tokens makes the panel follow the active theme with no
 * theme JS of our own. Every token carries a light-mode literal fallback so
 * older hosts that do not inject the token stylesheet still render the
 * panel's light appearance.
 */
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const C = {
  /** Primary text (light #0f1115 / dark #f9fafb). */
  text1: 'var(--dsw-alias-label-primary, #0f1115)',
  /** Secondary text (light #61666b / dark #cfd3d6). */
  text2: 'var(--dsw-alias-label-secondary, #61666b)',
  /** Tertiary text (light #81858c / dark #adb2b8). */
  text3: 'var(--dsw-alias-label-tertiary, #81858c)',
  /** Solid neutral surface for active chips (light #f1f3f5 / dark #353638). */
  surface2: 'var(--dsw-alias-interactive-bg-hover-solid, #f1f3f5)',
  /** Hover wash (light rgba(38,49,81,0.06) / dark rgba(255,255,255,0.08)). */
  hover: 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 81, 0.06))',
  /** Hairline borders (light rgba(0,0,0,0.10) / dark rgba(255,255,255,0.12)). */
  border: 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))',
  /** Primary fill for badges and send button — the in-chat primary action
   *  fill, DeepSeek blue in both themes (matching the host composer). */
  primary: 'var(--dsw-alias-button-info-fill, #4176e6)',
  /** Foreground on the primary fill; the host keeps white on info-fill. */
  onPrimary: '#fff',
  /** Error / destructive. */
  danger: 'var(--dsw-alias-state-error-primary, #ec1313)',
  /** User-bubble tint, matching the main chat's bubble surface. */
  bubble: 'var(--dsw-specific-bubble, #edf3fe)',
  /** Neutral platform surface (light #f5f6f7 / dark #353638). */
  platform: 'var(--dsw-alias-bg-module-platform, #f5f6f7)',
} as const

const styles: Record<string, CSSProperties> = {
  toggle: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 6px', border: 'none', borderRadius: 6,
    background: 'transparent', color: C.text2, cursor: 'pointer',
    fontSize: 13, lineHeight: 1,
  },
  toggleActive: {
    background: C.surface2, color: C.text1,
  },
  badge: {
    minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
    background: C.primary, color: C.onPrimary, fontSize: 11, lineHeight: '16px', textAlign: 'center',
  },
  root: {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
    fontSize: 13, color: C.text1, background: 'transparent',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', borderBottom: `1px solid ${C.border}`,
  },
  title: { flex: 1, fontWeight: 600, fontSize: 14 },
  back: {
    display: 'inline-flex', alignItems: 'center', gap: 2,
    padding: '2px 4px', border: 'none', borderRadius: 6,
    background: 'transparent', color: C.text2, cursor: 'pointer', fontSize: 12,
    flex: 1, textAlign: 'left',
  },
  runningCount: { color: C.text2, fontSize: 12 },
  iconButton: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 24, height: 24, padding: 0, border: 'none', borderRadius: 6,
    background: 'transparent', color: C.text2, cursor: 'pointer',
  },
  body: { flex: 1, overflowY: 'auto', padding: 6 },
  notice: { padding: '16px 12px', color: C.text2, textAlign: 'center' },
  error: { display: 'flex', alignItems: 'center', gap: 8, padding: 12, color: C.danger },
  retry: {
    padding: '2px 8px', border: `1px solid ${C.border}`, borderRadius: 6,
    background: 'transparent', color: C.text2, cursor: 'pointer', fontSize: 12,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 8px', borderRadius: 6, cursor: 'pointer',
    width: '100%', border: 'none', background: 'transparent', color: 'inherit',
    fontSize: 13, textAlign: 'left',
  },
  rowDisabled: { cursor: 'default', opacity: 0.6 },
  content: { flex: 1, minWidth: 0 },
  label: {
    display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  summary: {
    display: 'block', color: C.text2, fontSize: 12,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  activityLine: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
    color: C.text2, fontSize: 12, lineHeight: 1.4,
    wordBreak: 'break-word', textAlign: 'left',
  },
  transcript: { flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 },
  userRow: { alignSelf: 'flex-start', maxWidth: '100%' },
  imageRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  image: {
    display: 'block', width: 'min(100%, 280px)', maxHeight: 240, objectFit: 'contain',
    borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface2,
  },
  userText: {
    padding: '6px 10px', borderRadius: 10,
    background: C.platform, color: C.text1,
    width: 'fit-content', maxWidth: '100%', fontSize: 13, lineHeight: 1.5,
  },
  assistantRow: { alignSelf: 'flex-start', maxWidth: '100%' },
  assistantText: {
    padding: '6px 10px', borderRadius: 10,
    background: C.bubble, color: C.text1,
    width: 'fit-content', maxWidth: '100%', fontSize: 13, lineHeight: 1.5,
  },
  disclosureSummary: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: C.text2,
  },
  disclosureSeparator: {
    flex: 'none', width: 2, height: 2, margin: '0 8px', borderRadius: 1,
    background: C.text3,
  },
  disclosureBody: {
    margin: '4px 0 4px 22px', padding: '8px 10px', maxHeight: 240, overflow: 'auto',
    borderRadius: 6, background: 'var(--dsw-alias-markdown-code-block, #f9fafb)', color: C.text2,
    fontFamily: MONO, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
  },
  toolRow: { color: C.text2, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  toolFailed: { color: C.danger },
  toolDetail: { padding: '4px 0 6px' },
  toolArgs: {
    margin: '4px 0', padding: '6px 8px', borderRadius: 6,
    background: 'var(--dsw-alias-markdown-code-block, #f9fafb)', fontFamily: MONO,
    fontSize: 11, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    maxHeight: 180, overflowY: 'auto',
  },
  composer: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', borderTop: `1px solid ${C.border}`,
  },
  input: {
    flex: 1, minWidth: 0, padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 8,
    background: 'var(--dsw-specific-input-major, #ffffff)', color: C.text1, fontSize: 13, outline: 'none',
  },
  sendButton: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, padding: 0, border: 'none', borderRadius: 8,
    background: C.primary, color: C.onPrimary, cursor: 'pointer',
  },
  readonly: {
    padding: '8px 12px', borderTop: `1px solid ${C.border}`,
    color: C.text2, fontSize: 12, textAlign: 'center',
  },
}

/** Render one catalog row; clicking selects it for the embedded view.
 *  Running rows carry a live activity line (latest text / tool call) under
 *  the mode summary — polled separately and only while the panel is open. */
function Row({ row, activityText, t, onSelect }: {
  row: SidechatRow
  activityText: string | undefined
  t: SidechatTabProps['t']
  onSelect: (childSessionId: SessionId) => void
}): JSX.Element {
  if (row.kind === 'diagnostic') {
    const reason = diagnosticText(row.reason, t)
    return (
      <div style={{ ...styles.row, ...styles.rowDisabled }} title={reason} aria-disabled="true">
        <StateDot state="error" />
        <span style={styles.content}>
          <span style={styles.label}>{row.id}</span>
          <span style={styles.summary}>{reason}</span>
        </span>
      </div>
    )
  }
  const mode = row.mode === 'unknown' ? t('mode.unknown')
    : row.mode === 'one-shot' || row.command === 'btw' ? t('mode.oneShot') : t('mode.continuable')
  const running = row.activity === 'running'
  const activity = running
    ? t('activity.running')
    : row.activity === 'inactive' ? t('activity.inactive') : undefined
  return (
    <button
      type="button"
      style={styles.row}
      title={t('row.open', { label: row.label })}
      aria-label={t('row.open', { label: row.label })}
      onClick={() => onSelect(row.id)}
    >
      <StateDot state={running ? 'ongoing' : row.activity === 'inactive' ? 'done' : 'idle'} />
      <span style={styles.content}>
        <span style={styles.label}>{row.label}</span>
        <span style={styles.summary}>
          {activity === undefined ? mode : `${mode} · `}
          {running
            ? <span className="dsh-sidechat-shimmer">{activity}</span>
            : activity}
        </span>
        {activityText !== undefined && (
          <span style={styles.activityLine} title={activityText}>{activityText}</span>
        )}
      </span>
    </button>
  )
}

/** Cap for raw arguments shown in the detail view (platform contract: never
 *  dump full raw arguments — write/edit payloads can be hundreds of KB). */
const TOOL_ARGS_MAX = 2000

/** Pretty-print a tool's curated rawInput (the platform contract's salient
 *  input), falling back to the raw arguments JSON truncated to a hard cap. */
function prettyToolInput(rawInput: unknown, argumentsRaw: string | undefined): string | undefined {
  if (rawInput !== undefined) {
    try {
      return JSON.stringify(rawInput, null, 2)
    } catch {
      // non-serializable rawInput: fall through to the arguments fallback
    }
  }
  if (argumentsRaw === undefined) return undefined
  const trimmed = argumentsRaw.length > TOOL_ARGS_MAX
    ? `${argumentsRaw.slice(0, TOOL_ARGS_MAX)}…（已截断）`
    : argumentsRaw
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return trimmed
  }
}

/** Platform convention: decorative animations yield to prefers-reduced-motion
 *  (the plugin bundle has no CSS pipeline, so the guard is a JS matchMedia). */
function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** One expandable tool row: collapsed shows the call line; expanded shows
 *  the terminal-style command/output (terminal calls) or the arguments,
 *  result text, and failure detail. */
function ToolRow({ row, running, codeLabels }: {
  row: Extract<TranscriptRow, { kind: 'tool' }>
  /** The child session is still running and this call has no result yet. */
  running: boolean
  codeLabels: MarkdownCodeLabels | undefined
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const detail: ToolDetail | undefined = row.detail
  const resultText = detail?.result === undefined ? undefined : resultViewSummary(detail.result)
  const inputText = prettyToolInput(undefined, detail?.arguments)
  const expandable = inputText !== undefined || resultText !== undefined || detail?.error !== undefined
  return (
    <DisclosureRow
      icon={<StateDot state={row.failed ? 'error' : running ? 'ongoing' : 'done'} />}
      title={row.name}
      open={open}
      expandable={expandable}
      onToggle={() => { setOpen(value => !value) }}
      collapsedContent={row.failed ? ' ✗' : undefined}
    >
      <div style={styles.toolDetail}>
        {inputText !== undefined && <pre style={styles.toolArgs}>{inputText}</pre>}
        {resultText !== undefined && (
          <div style={{ margin: '4px 0' }}>
            <MarkdownText
              text={resultText}
              streaming={false}
              labels={{ code: codeLabels ?? { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }}
            />
          </div>
        )}
        {detail?.error !== undefined && (
          <div style={{ ...styles.toolFailed, fontSize: 12, marginTop: 4 }}>
            {`✗ ${detail.error.name}: ${detail.error.code}`}
          </div>
        )}
      </div>
    </DisclosureRow>
  )
}

/** Compact disclosure matching the main conversation's Think/context rows. */
function TranscriptDisclosure({ row, streaming, t }: {
  row: Extract<TranscriptRow, { kind: 'reasoning' | 'context' }>
  streaming: boolean
  t: SidechatTabProps['t']
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = row.text.trim().split('\n').find(line => line !== '') ?? ''
  const contextSource = row.kind === 'context' ? row.source : null
  return (
    <DisclosureRow
      icon={row.kind === 'reasoning' ? <IconThinkOutlineRegular size={14} /> : <IconBrowseOutlineRegular size={14} />}
      title={row.kind === 'reasoning'
        ? t('view.reasoning')
        : t(row.recall ? 'view.contextRecall' : 'view.context')}
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
      collapsedContent={(
        <>
          <span style={styles.disclosureSeparator} aria-hidden />
          <span style={styles.disclosureSummary}>
            {contextSource ?? (streaming ? summary.slice(-120) : summary)}
          </span>
        </>
      )}
    >
      <pre style={styles.disclosureBody}>{row.text}</pre>
    </DisclosureRow>
  )
}

function TranscriptImages({ images }: {
  images: readonly TranscriptImage[]
}): JSX.Element | null {
  const visible = images.filter(image => image.url !== undefined)
  if (visible.length === 0) return null
  return (
    <div style={styles.imageRow}>
      {visible.map(image => (
        <img
          key={String(image.attachment.attachmentId)}
          src={image.url}
          alt={image.attachment.name ?? 'Attached image'}
          style={styles.image}
        />
      ))}
    </div>
  )
}

/** One transcript row from the child session's full visible timeline. */
function TranscriptRowView({ row, streaming, codeLabels, fileMentions, t }: {
  row: TranscriptRow
  streaming: boolean
  codeLabels: MarkdownCodeLabels | undefined
  fileMentions: MarkdownFileMentions | undefined
  t: SidechatTabProps['t']
}): JSX.Element {
  const labels = { code: codeLabels ?? { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
  if (row.kind === 'user') {
    return (
      <div style={styles.userRow}>
        {row.images !== undefined && <TranscriptImages images={row.images} />}
        {row.text !== '' && <div style={styles.userText}>
          <MarkdownText text={row.text} streaming={streaming} labels={labels} fileMentions={fileMentions} />
        </div>}
      </div>
    )
  }
  if (row.kind === 'assistant') {
    return (
      <div style={styles.assistantRow}>
        {row.images !== undefined && <TranscriptImages images={row.images} />}
        {row.text !== '' && <div style={styles.assistantText}>
          <MarkdownText text={row.text} streaming={streaming} labels={labels} fileMentions={fileMentions} />
        </div>}
      </div>
    )
  }
  if (row.kind === 'reasoning' || row.kind === 'context') {
    return <>
      {row.kind === 'context' && row.images !== undefined && <TranscriptImages images={row.images} />}
      {row.text !== '' && <TranscriptDisclosure row={row} streaming={streaming} t={t} />}
    </>
  }
  if (row.kind === 'error') {
    return (
      <div style={{ ...styles.assistantRow, color: C.danger }}>
        <div style={styles.assistantText}>
          <MarkdownText text={row.text} streaming={false} labels={labels} fileMentions={fileMentions} />
        </div>
      </div>
    )
  }
  return <ToolRow row={row} running={streaming && row.detail?.result === undefined} codeLabels={codeLabels} />
}

/** Stable identity of one selected child address. */
function addressKeyOf(address: SubagentAddress): string {
  return `${address.parentSessionId}:${address.childSessionId}:${address.mode}`
}

/** Poll interval for the selected child's transcript while it is running (ms). */
const LIVE_POLL_INTERVAL_MS = 1200
/** Poll interval for running rows' activity lines (ms). */
const ACTIVITY_POLL_INTERVAL_MS = 3000
/** Catalog refresh cadence while the tab is visible (ms). */
const CATALOG_REFRESH_INTERVAL_MS = 5000

/** Navigation parameters this page type accepts. */
export interface SidechatTabParams {
  /** Child to select when the tab opens. */
  childId?: SessionId
  /** The child's mode as the opening command knew it. */
  mode?: 'one-shot' | 'continuable'
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** One side conversation, named by the child it selects. */
    sidechat: SidechatTabParams
  }
}

/** Header action that opens the side-chat tab in the native right Sidebar. */
export type SidechatHeaderButtonProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & { onOpen: () => void }

/**
 * Conversation-header button: opens (or reveals) the side-chat tab and shows
 * how many side conversations are running. The native Sidebar owns the panel
 * itself; this is only the way in from the conversation.
 */
export function SidechatHeaderButton({ sessionId, useSessions, onOpen, t }: SidechatHeaderButtonProps): JSX.Element {
  const catalog = useSessions(state => state.projectionsBySession[sessionId])
  const summaries = useSessions(state => state.byId)
  const running = runningCount(sidechatRows(catalog, summaries))
  return (
    <button
      type="button"
      style={styles.toggle}
      title={t('header.open')}
      aria-label={t('header.open')}
      onClick={onOpen}
    >
      <IconBranchOutlineRegular size={16} />
      {running > 0 && <span style={styles.badge}>{running}</span>}
    </button>
  )
}

/**
 * The native right-Sidebar tab body. It shows the catalog list or, once a
 * child is selected, that child's embedded conversation (transcript plus a
 * composer for continuable threads); the main session never switches. The
 * catalog is armed when the tab becomes visible and follows the tab's own
 * session.
 */
export function SidechatTab({
  sessionId, useSessions, useTabInfo, readTranscript, readActivity, sendPrompt, refresh, openPath, t,
}: SidechatTabProps): JSX.Element {
  const { tab } = useTabInfo()
  const visible = tab.visible
  const navigation = tab.navigation
  const params = navigation.params as SidechatTabParams | undefined
  const [selected, setSelected] = useState<SessionId | undefined>(params?.childId)
  const [selectedMode, setSelectedMode] = useState<'one-shot' | 'continuable' | undefined>(params?.mode)

  // A new navigation (another /side or /btw opened this tab) selects its child.
  const revision = navigation.revision
  const paramsRef = useRef(params)
  paramsRef.current = params
  useEffect(() => {
    const next = paramsRef.current
    if (next?.childId === undefined) return
    setSelected(next.childId)
    setSelectedMode(next.mode)
  }, [revision])

  const catalogs = useSessions(state => state.projectionsBySession)
  const summaries = useSessions(state => state.byId)
  const catalog = catalogs[sessionId]
  const rows = useMemo(() => sidechatRows(catalog, summaries), [catalog, summaries])
  const running = runningCount(rows)
  // Stable reference: MarkdownText bakes codeLabels into its streaming cache
  // and discards the cache when the reference changes (see its module doc).
  const codeLabels = useMemo(() => ({ copyLabel: t('code.copy'), copiedLabel: t('code.copied') }), [t])

  // The injected actions can be recreated per render; keep effects pinned to
  // stable keys, reading the latest actions through a ref.
  const actionsRef = useRef({ readTranscript, readActivity, sendPrompt, refresh })
  actionsRef.current = { readTranscript, readActivity, sendPrompt, refresh }

  // Arm the catalog when the tab becomes visible and keep it live even if the
  // runtime's automatic subagent events do not arrive.
  useEffect(() => {
    if (!visible) return
    actionsRef.current.refresh(sessionId)
    const timer = setInterval(() => {
      actionsRef.current.refresh(sessionId)
    }, CATALOG_REFRESH_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [visible, sessionId])

  // The selected child's durable address (stable while selection/catalog stay).
  // Prefer the catalog's mode; fresh local activations are always continuable.
  const address = useMemo<SubagentAddress | undefined>(() => {
    if (selected === undefined) return undefined
    const row = rows.find(candidate => candidate.kind === 'child' && candidate.id === selected)
    const mode = row?.kind === 'child' ? row.mode : selectedMode === undefined ? undefined : 'continuable'
    return mode === undefined
      ? undefined
      : { parentSessionId: sessionId, childSessionId: selected, mode }
  }, [selected, rows, selectedMode, sessionId])

  // The selected child's catalog row (its activity drives the live poll).
  const selectedRow = selected === undefined
    ? undefined
    : rows.find(candidate => candidate.id === selected)
  const selectedChild = selectedRow !== undefined && selectedRow.kind === 'child' ? selectedRow : undefined
  // Resolve the selected child's activity through the tri-state resolver so
  // missing or loading data is never reported as `running`. The session
  // summary's running bit is preferred when present (host-updated), otherwise
  // the catalog entry is used; a missing child on a ready catalog is
  // `inactive`, and a not-yet-loaded / loading / errored catalog is `unknown`.
  const summaryRunning = selected === undefined ? undefined : summaries[selected]?.running
  const selectedActivity: ChildActivity = resolveChildActivity({
    catalogState: catalog?.state ?? 'absent',
    inCatalog: selectedChild !== undefined,
    catalogActivity: selectedChild?.activity === 'unknown' ? undefined : selectedChild?.activity,
    summaryRunning,
  })
  const selectedRunning = selectedActivity === 'running'

  // Stable key for the selected address (primitive — never churns with
  // unrelated list re-renders), plus refs the persistent poll reads.
  const addressKey = address === undefined ? undefined : addressKeyOf(address)
  const addressRef = useRef(address)
  addressRef.current = address
  const addressKeyRef = useRef(addressKey)
  addressKeyRef.current = addressKey
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const runningRef = useRef(selectedRunning)
  runningRef.current = selectedRunning

  // Transcript state is keyed by the selected address so a switch never shows
  // the previous child's rows, files, or error while the new read is pending.
  const [transcript, setTranscript] = useState<{ key: string; rows: readonly TranscriptRow[] } | null>(null)
  const [produced, setProduced] = useState<{ key: string; paths: readonly string[] }>({ key: '', paths: [] })
  const [transcriptState, setTranscriptState] = useState<{ key: string; state: 'loading' | 'ready' | 'error' }>({
    key: '', state: 'loading',
  })
  const activeTranscript = transcript !== null && transcript.key === addressKey ? transcript.rows : null
  const activeProduced = produced.key === addressKey ? produced.paths : []
  const activeTranscriptState = transcriptState.key === addressKey ? transcriptState.state : 'loading'
  // File-mention vocabulary: files the selected child's tool calls produced,
  // resolved against the child's cwd (the main chat's ui-deliverables policy).
  const childCwd = selected === undefined ? undefined : summaries[selected]?.cwd
  const fileMentions = useMemo(
    () => fileMentionsFor(activeProduced, childCwd, openPath),
    [activeProduced, childCwd, openPath],
  )
  const fetchEpoch = useRef(0)
  // Single-flight guard: the request that took the lock is the only one that
  // releases it, so a stale response cannot free the slot for a newer read.
  const fetchInFlight = useRef<{ key: string; epoch: number } | null>(null)
  const pendingFinalRead = useRef<SubagentAddress | undefined>(undefined)
  const request = useCallback((target: SubagentAddress, showLoading: boolean, final = false) => {
    const key = addressKeyOf(target)
    const inFlight = fetchInFlight.current
    if (inFlight !== null && final) {
      pendingFinalRead.current = target
      return
    }
    if (inFlight !== null && !showLoading) return
    const epoch = ++fetchEpoch.current
    if (showLoading) {
      pendingFinalRead.current = undefined
      setTranscriptState({ key, state: 'loading' })
    }
    fetchInFlight.current = { key, epoch }
    void actionsRef.current.readTranscript(target).then((result) => {
      if (fetchInFlight.current?.epoch === epoch) fetchInFlight.current = null
      if (epoch !== fetchEpoch.current) return
      // The user switched children while this read was in flight; its result
      // belongs to the old view and must not touch the new one.
      if (addressKeyRef.current !== key) return
      if (result === null) {
        setTranscriptState({ key, state: 'error' })
        return
      }
      setTranscript({ key, rows: result.rows })
      // An initial fetch replaces the vocabulary; later polls union it, so
      // produced paths whose rows slid out of the tail window keep working.
      setProduced(previous => ({
        key,
        paths: showLoading
          ? result.produced
          : mergeProduced(previous.key === key ? previous.paths : [], result.produced),
      }))
      setTranscriptState({ key, state: result.error ? 'error' : 'ready' })
      const pending = pendingFinalRead.current
      pendingFinalRead.current = undefined
      if (pending !== undefined) request(pending, false)
    })
  }, [])

  // A queued final read belongs to the child it was queued for.
  useEffect(() => { pendingFinalRead.current = undefined }, [addressKey])

  // Initial fetch whenever the selection or the session changes.
  useEffect(() => {
    if (!visible) return
    const target = addressRef.current
    if (target !== undefined) request(target, true)
  }, [visible, addressKey, request])

  // Persistent live poll: one interval for the component's lifetime, reading
  // the current address/running state through refs — unrelated list renders
  // must never reset it (a resetting interval could starve the polls while
  // frames churn the list store).
  useEffect(() => {
    const timer = setInterval(() => {
      if (!visibleRef.current || !runningRef.current) return
      const target = addressRef.current
      if (target !== undefined) request(target, false)
    }, LIVE_POLL_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [request])

  // ---- Running rows' activity lines: a light tail poll per running child
  // (6-message pages, 3s cadence), only while the tab is visible and the
  // document visible. Per-child epochs discard stale responses; entries are
  // pruned when their child stops running. ----
  const runningRows = useMemo(
    () => rows.filter((row): row is Extract<SidechatRow, { kind: 'child' }> =>
      row.kind === 'child' && row.activity === 'running'),
    [rows],
  )
  const runningIds = useMemo(() => runningRows.map(row => row.id), [runningRows])
  const runningIdsRef = useRef(runningIds)
  runningIdsRef.current = runningIds
  const runningRowsRef = useRef(runningRows)
  runningRowsRef.current = runningRows
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const [activity, setActivity] = useState<Readonly<Record<SessionId, string>>>({})
  const activityEpoch = useRef(new Map<string, number>())
  // Single-flight guard for the whole activity round (one round may fan out
  // to several running children; a slow round must not overlap itself).
  const activityInFlight = useRef(false)
  const pollActivity = useCallback(() => {
    if (!visibleRef.current || document.hidden) return
    const targets = runningRowsRef.current
    if (targets.length === 0) return
    if (activityInFlight.current) return
    const { readActivity } = actionsRef.current
    activityInFlight.current = true
    const round = targets.map(row => {
      const epoch = (activityEpoch.current.get(row.id) ?? 0) + 1
      activityEpoch.current.set(row.id, epoch)
      return { row, epoch }
    })
    void readActivityRound(round, ({ row }) => readActivity({
      parentSessionId: sessionIdRef.current,
      childSessionId: row.id,
      mode: row.mode,
    }), ({ row, epoch }, line) => {
      if (activityEpoch.current.get(row.id) === epoch) {
        setActivity(previous => previous[row.id] === line ? previous : { ...previous, [row.id]: line })
      }
    }).finally(() => { activityInFlight.current = false })
  }, [])
  useEffect(() => {
    const timer = setInterval(() => { pollActivity() }, ACTIVITY_POLL_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [pollActivity])
  // Immediate catch-up whenever the tab becomes visible or the running set
  // changes (catalog flip), then the interval owns the cadence.
  useEffect(() => {
    if (visible) pollActivity()
  }, [visible, runningIds, pollActivity])
  // A child that stopped running drops out of the preview map.
  useEffect(() => {
    setActivity((previous) => {
      const active = new Set(runningIds)
      const keys = Object.keys(previous) as SessionId[]
      if (keys.length === runningIds.length && keys.every(key => active.has(key))) return previous
      const next: Record<SessionId, string> = {}
      for (const key of keys) {
        if (active.has(key) && previous[key] !== undefined) next[key] = previous[key]
      }
      return next
    })
  }, [runningIds])

  // On a running/unknown → inactive transition (the catalog activity flip): pull
  // the settled transcript exactly, and mark the finalize swap — the rows
  // switch from streaming to settled rendering (syntax highlighting, KaTeX,
  // file mentions land) — with a brief fade via the Web Animations API.
  // The guard records the child identity: switching to another child must
  // reset it, so a long-finished child never replays the previous child's
  // settle transition. `unknown -> inactive` matters when a fast child ends
  // before the catalog's first successful read; without the final fetch the
  // tab can retain the partial transcript from its initial read.
  const settleGuard = useRef<{ id: SessionId | undefined; activity: ChildActivity } | undefined>(undefined)
  useEffect(() => {
    // Keep tracking the selected id even when a ready catalog no longer
    // contains the child. The address can still be reconstructed from the
    // selection/mode, and this is the exact transition where the final
    // transcript fetch is needed.
    if (selected === undefined) {
      settleGuard.current = undefined
      return
    }
    const previous = settleGuard.current
    settleGuard.current = { id: selected, activity: selectedActivity }
    if (previous === undefined || previous.id !== selected) return
    if (
      selectedActivity === 'inactive'
      && (previous.activity === 'running' || previous.activity === 'unknown')
    ) {
      const target = addressRef.current
      if (target !== undefined) request(target, false, true)
      const el = transcriptRef.current
      if (el !== null && !prefersReducedMotion()) {
        el.animate(
          [{ opacity: 0.7 }, { opacity: 1 }],
          { duration: 260, easing: 'ease-out' },
        )
      }
    }
  }, [selected, selectedActivity, request])

  // Keep the newest content in view while a run streams — but only when the
  // reader is already near the bottom, so scrolling up to re-read is stable.
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const nearBottomRef = useRef(true)
  const onTranscriptScroll = useCallback(() => {
    const el = transcriptRef.current
    if (el === null) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }, [])
  useEffect(() => {
    const el = transcriptRef.current
    if (el !== null && nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [transcript])

  // Composer state for continuable children.
  const [draft, setDraft] = useState('')
  const [sendFailed, setSendFailed] = useState(false)
  // Send epoch: a prompt already in flight must never update the composer
  // after a newer send (or unmount) — the same staleness guard the polls use.
  const sendEpoch = useRef(0)
  const sendInFlight = useRef(false)
  const send = useCallback(async () => {
    const target = addressRef.current
    if (target === undefined || target.mode !== 'continuable') return
    const text = draft.trim()
    if (text === '' || sendInFlight.current) return
    const key = addressKeyOf(target)
    sendInFlight.current = true
    setSendFailed(false)
    const epoch = ++sendEpoch.current
    try {
      const ok = await actionsRef.current.sendPrompt(
        { parentSessionId: target.parentSessionId, childSessionId: target.childSessionId, mode: 'continuable' },
        text,
      )
      if (epoch !== sendEpoch.current) return
      // The user switched children while the prompt was in flight; the result
      // belongs to the old view and must not clear or restore the new draft.
      if (addressKeyRef.current !== key) return
      if (!ok) {
        setSendFailed(true)
        // Restore the text only when the user has not typed something else.
        setDraft(current => current === '' ? text : current)
        return
      }
      setDraft(current => current === text ? '' : current)
      request(target, false)
    } finally {
      sendInFlight.current = false
    }
  }, [draft, request])

  // A failed send belongs to the child it was sent to.
  useEffect(() => { setSendFailed(false) }, [addressKey])

  const loading = catalog === undefined
    || (catalog.state === 'loading' && rows.length === 0)
  const empty = catalog !== undefined && catalog.state === 'ready' && rows.length === 0

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        {address === undefined ? (
          <span style={styles.title}>{t('tab.title')}</span>
        ) : (
          <button
            type="button"
            style={styles.back}
            title={t('view.back')}
            aria-label={t('view.back')}
            onClick={() => {
              setSelected(undefined)
              setSelectedMode(undefined)
              actionsRef.current.refresh(sessionId)
            }}
          >
            <IconChevronLeftOutlineRegular size={14} />
            {t('view.back')}
          </button>
        )}
        {address === undefined && running > 0 && (
          <span style={styles.runningCount}>{t('count.running', { count: running })}</span>
        )}
        <button
          type="button"
          style={styles.iconButton}
          title={t('panel.refresh')}
          aria-label={t('panel.refresh')}
          onClick={() => {
            if (address === undefined) actionsRef.current.refresh(sessionId)
            else {
              const target = addressRef.current
              if (target !== undefined) request(target, true)
            }
          }}
        >
          <IconRefreshOutlineRegular size={14} />
        </button>
      </div>
      {address === undefined ? (
        <div style={styles.body}>
          {catalog !== undefined && catalog.state === 'error' && (
            <div style={styles.error}>
              <span>{t('panel.error')}</span>
              <button
                type="button"
                style={styles.retry}
                onClick={() => { actionsRef.current.refresh(sessionId) }}
              >
                {t('panel.retry')}
              </button>
            </div>
          )}
          {loading && <div style={styles.notice}>{t('panel.loading')}</div>}
          {empty && <div style={styles.notice}>{t('panel.empty')}</div>}
          {rows.map(row => (
            <Row
              key={row.id}
              row={row}
              activityText={
                row.kind === 'child' && row.activity === 'running' ? activity[row.id] : undefined
              }
              t={t}
              onSelect={(childSessionId) => { setSelected(childSessionId); setSelectedMode(undefined) }}
            />
          ))}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div ref={transcriptRef} style={styles.transcript} onScroll={onTranscriptScroll}>
            {!selectedRunning && activeTranscriptState === 'loading' && <div style={styles.notice}>{t('view.loading')}</div>}
            {activeTranscriptState === 'error' && (
              <div style={styles.error}>
                <span>{t('view.error')}</span>
                <button
                  type="button"
                  style={styles.retry}
                  onClick={() => {
                    const target = addressRef.current
                    if (target !== undefined) request(target, true)
                  }}
                >
                  {t('panel.retry')}
                </button>
              </div>
            )}
            {activeTranscriptState === 'ready' && activeTranscript !== null && activeTranscript.length === 0 && !selectedRunning && (
              <div style={styles.notice}>{t('view.empty')}</div>
            )}
            {(activeTranscript ?? []).map((row, index, all) => (
              <TranscriptRowView
                key={`${row.kind}:${row.seq}:${index}`}
                row={row}
                streaming={selectedRunning && index === all.length - 1}
                codeLabels={codeLabels}
                fileMentions={fileMentions}
                t={t}
              />
            ))}
            {/* Bottom-left waiting hint, DeepSeek blue, present while the
                child is running (i18n-driven copy via view.waiting). */}
            {selectedRunning && (
              <div style={{
                marginTop: 8,
                color: 'var(--dsw-alias-state-business-primary, #4176e6)',
                textAlign: 'left',
                fontSize: 12,
                lineHeight: 1.5,
              }}>{t('view.waiting')}</div>
            )}
          </div>
          {address.mode !== 'continuable' || selectedChild?.command === 'btw' || selectedMode === 'one-shot' ? (
            <div style={styles.readonly}>{t(address.mode === 'unknown' ? 'mode.unknown' : 'view.readonly')}</div>
          ) : (
            <form
              style={styles.composer}
              onSubmit={(event) => {
                event.preventDefault()
                void send()
              }}
            >
              <input
                style={styles.input}
                value={draft}
                placeholder={t('composer.placeholder')}
                aria-label={t('composer.sendAria')}
                onChange={(event) => { setDraft(event.target.value) }}
              />
              <button type="submit" style={styles.sendButton} aria-label={t('composer.send')}>
                <IconRightUpOutlineRegular size={14} />
              </button>
            </form>
          )}
          {sendFailed && <div style={styles.error}>{t('view.sendFailed')}</div>}
        </div>
      )}
    </div>
  )
}
