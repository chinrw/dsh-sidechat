/**
 * dsh-sidechat, browser half: registers `/side` and `/btw` command cards into
 * the keyed `conversation.chat.commandview` slot, a native right-Sidebar tab
 * type (`sidechat`) whose body lists the current session's side conversations
 * and renders the selected child's transcript with a composer, and a compact
 * conversation-header button that opens that tab.
 *
 * The tab is a page type: it is opened by kind through `ctx.sidebarRight.openTab`,
 * so the Sidebar's own chrome — tab strip, split, float, fullscreen, width and
 * persistence — hosts it exactly like the built-in Files/Browser/Terminal tabs.
 * A settled `/side` or `/btw` command opens the tab with `{ childId, mode }`
 * navigation parameters, which the body reads to select the new child.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SideCommandCard, type SideCommandKind } from './SideCommandCard.tsx'
import { SidechatHeaderButton, SidechatTab, type SidechatTabInjected } from './SidechatTab.tsx'
import { installSidechatStyle } from './style.ts'
import { fetchActivity, fetchTranscript, sendPrompt } from './sidechat-view.ts'
import { NS, en, zh } from './locales.ts'

export const name = 'dsh-sidechat'

export const inject = [
  'slots',
  'sessions',
  'locale',
  'remote',
  'remote.session',
  'remote.subagents',
  'sidebarRight',
  'sidebarRightTabs',
]

/** Stable implementation identity for the Sidebar tab type and its body. */
export const SIDECHAT_ID = '@local/dsh-sidechat'
/** Page kind the tab type registers under. */
export const SIDECHAT_KIND = 'sidechat'

export function apply(ctx: Context): void {
  const sessions = ctx.sessions
  const subagents = ctx.remote.subagents
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sidechat: dictionaries')
  // One shared keyframe stylesheet (shimmer sweep); the effect's disposer
  // removes it with the fiber — hot unload leaves no stray <style> tags.
  ctx.effect(installSidechatStyle, 'dsh-sidechat: stylesheet')

  // Command cards: presentation plus the native-tab jump. A settled command
  // opens the Sidebar tab with the new child selected; the card also offers
  // the same jump for a command that settled while the page was elsewhere.
  const openChild = (childId: SessionId, mode: SideCommandKind): void => {
    ctx.sidebarRight.openTab(SIDECHAT_KIND, {
      params: { childId, mode: mode === 'btw' ? 'one-shot' : 'continuable' },
    })
  }
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'side',
    locale: NS,
  }, (props) => <SideCommandCard node={props.node} t={props.t} onOpen={openChild} />))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'btw',
    locale: NS,
  }, (props) => <SideCommandCard node={props.node} t={props.t} onOpen={openChild} />))

  // The native right-Sidebar tab type: a page type opened by kind. The guide
  // entry makes it reachable from the Sidebar's own guide page.
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: SIDECHAT_ID,
    kind: SIDECHAT_KIND,
    keepMounted: true,
    title: () => t('tab.title'),
    guide: [{
      id: 'sidechat',
      order: 30,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconBranchOutlineRegular,
    }],
  }), 'dsh-sidechat: Sidebar tab type')

  const tabInject = (_parentSessionId: SessionId): SidechatTabInjected => ({
    readTranscript(address: SubagentAddress) {
      return fetchTranscript(ctx.remote.session, address)
    },
    readActivity(address: SubagentAddress) {
      return fetchActivity(ctx.remote.session, address)
    },
    sendPrompt(address: Extract<SubagentAddress, { mode: 'continuable' }>, text: string) {
      return sendPrompt(subagents, address, text)
    },
    refresh(parentSessionId: SessionId): void {
      void sessions.refreshProjections(parentSessionId)
    },
    openPath(path: string): void {
      // Mirror the main chat's openFile: host open failures stay silent.
      void ctx.remote.session.openWorkspacePath({ path }).catch(() => {})
    },
  })
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: SIDECHAT_ID,
    locale: NS,
    inject: tabInject,
  }, SidechatTab)), 'dsh-sidechat: Sidebar tab body')

  // Conversation-header entry point: opens (or reveals) the tab.
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'sidechat-open',
    order: 20,
    locale: NS,
  }, (props) => (
    <SidechatHeaderButton {...props} onOpen={() => { ctx.sidebarRight.openTab(SIDECHAT_KIND) }} />
  ))), 'dsh-sidechat: header button')
}
