/**
 * Render tests for the native Sidebar tab body: the component must render its
 * three catalog states from the framework props alone (session standard kit,
 * the tab hook, the injected RPC face, and the locale seat), with no DOM
 * environment and no effects.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SidechatTab } from '../src/client/SidechatTab'

const PARENT = 'parent-1' as SessionId
const CHILD = '11111111-1111-4111-8111-111111111111' as SessionId

const t = (key: string): string => key

interface CatalogEntry {
  id: SessionId
  createdAt: number
  mode: 'one-shot' | 'continuable'
  label?: string
}

function render(options: {
  catalog?: { state: 'ready' | 'loading' | 'error'; values: Record<string, unknown> }
  summaries?: Record<string, unknown>
  params?: unknown
} = {}): string {
  const state = {
    projectionsBySession: options.catalog === undefined ? {} : { [PARENT]: options.catalog },
    byId: options.summaries ?? {},
  }
  const props = {
    sessionId: PARENT,
    useSessions: (selector: (value: typeof state) => unknown) => selector(state),
    useTabInfo: () => ({
      tab: {
        visible: true,
        navigation: { revision: 0, params: options.params, address: 'sidebar://sidechat', },
      },
    }),
    readTranscript: async () => null,
    readActivity: async () => null,
    sendPrompt: async () => true,
    refresh: () => {},
    openPath: () => {},
    t,
  }
  const Tab = SidechatTab as unknown as (input: Record<string, unknown>) => JSX.Element
  return renderToStaticMarkup(<Tab {...props} />)
}

describe('SidechatTab', () => {
  it('renders the loading notice before the catalog arrives', () => {
    expect(render()).toContain('panel.loading')
  })

  it('renders the empty notice for a ready empty catalog', () => {
    expect(render({ catalog: { state: 'ready', values: { subagentCatalog: [] } } }))
      .toContain('panel.empty')
  })

  it('renders one row per catalog child with its label and mode', () => {
    const entries: CatalogEntry[] = [
      { id: CHILD, createdAt: 0, mode: 'continuable', label: '调研 X' },
    ]
    const html = render({
      catalog: { state: 'ready', values: { subagentCatalog: entries, sidechatModes: {} } },
      summaries: { [CHILD]: { running: false, title: '调研 X' } },
    })
    expect(html).toContain('调研 X')
    expect(html).toContain('mode.continuable')
    expect(html).toContain('activity.inactive')
  })

  it('renders the transcript view for a selected child', () => {
    const entries: CatalogEntry[] = [
      { id: CHILD, createdAt: 0, mode: 'continuable', label: '调研 X' },
    ]
    const html = render({
      catalog: { state: 'ready', values: { subagentCatalog: entries, sidechatModes: {} } },
      summaries: { [CHILD]: { running: false, title: '调研 X' } },
      params: { childId: CHILD, mode: 'continuable' },
    })
    expect(html).toContain('view.back')
    expect(html).toContain('composer.placeholder')
  })
})
