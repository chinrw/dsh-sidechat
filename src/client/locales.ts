/** `sidechat` namespace dictionaries. */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Side-chat tab copy. */
    'sidechat': SidechatKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'sidechat'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab.title': '侧会话',
  'guide.title': '侧会话',
  'guide.description': '在原生侧边栏中查看 /side 与 /btw 侧会话',
  'header.open': '侧会话：在侧边栏中打开',
  'shortcut.open': '打开侧会话',
  'shortcut.noSession': '先选择一个会话',
  'panel.refresh': '刷新侧会话',
  'panel.empty': '暂无侧会话，试试 /side 或 /btw',
  'panel.loading': '正在加载侧会话…',
  'panel.error': '无法加载侧会话',
  'panel.retry': '重试',
  'count.running': '{count} 个正在运行',
  'code.copy': '复制',
  'code.copied': '已复制',
  'mode.oneShot': '/btw 一次性',
  'mode.continuable': '/side 可续聊',
  'mode.unknown': '未知会话类型（只读）',
  'activity.running': '正在运行',
  'activity.inactive': '已结束',
  'diagnostic.corrupt': '会话记录损坏',
  'diagnostic.unsupported': '子代理记录版本不受支持',
  'diagnostic.unavailable': '会话记录暂不可用',
  'row.open': '打开子代理 {label}',
  'view.back': '返回列表',
  'view.readonly': '一次性侧问（不可续聊）',
  'view.empty': '暂无消息',
  'view.waiting': 'Deep diving...',
  'view.loading': '正在加载对话…',
  'view.error': '无法加载对话',
  'view.sendFailed': '发送失败',
  'view.reasoning': '思考',
  'view.context': '上下文',
  'view.contextRecall': '上下文回忆',
  'composer.placeholder': '继续侧聊…（Enter 发送）',
  'composer.send': '发送',
  'composer.sendAria': '发送消息到侧会话',
  'card.open': '在侧边栏打开',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<SidechatKey, string> = {
  'tab.title': 'Side chat',
  'guide.title': 'Side chat',
  'guide.description': 'View /side and /btw side conversations in the native Sidebar',
  'header.open': 'Side chat: open in the Sidebar',
  'shortcut.open': 'Open side chat',
  'shortcut.noSession': 'Select a session first',
  'panel.refresh': 'Refresh side conversations',
  'panel.empty': 'No side conversations yet — try /side or /btw',
  'panel.loading': 'Loading side conversations…',
  'panel.error': 'Failed to load side conversations',
  'panel.retry': 'Retry',
  'count.running': '{count} running',
  'code.copy': 'Copy',
  'code.copied': 'Copied',
  'mode.oneShot': '/btw one-shot',
  'mode.continuable': '/side continuable',
  'mode.unknown': 'Unknown session type (read-only)',
  'activity.running': 'Running',
  'activity.inactive': 'Finished',
  'diagnostic.corrupt': 'Corrupted session record',
  'diagnostic.unsupported': 'Unsupported subagent record version',
  'diagnostic.unavailable': 'Session record temporarily unavailable',
  'row.open': 'Open subagent {label}',
  'view.back': 'Back to list',
  'view.readonly': 'One-shot side question (no follow-up)',
  'view.empty': 'No messages yet',
  'view.waiting': 'Deep diving...',
  'view.loading': 'Loading conversation…',
  'view.error': 'Failed to load conversation',
  'view.sendFailed': 'Send failed',
  'view.reasoning': 'Think',
  'view.context': 'Context',
  'view.contextRecall': 'Context recall',
  'composer.placeholder': 'Continue side chat… (Enter to send)',
  'composer.send': 'Send',
  'composer.sendAria': 'Send message to side conversation',
  'card.open': 'Open in Sidebar',
}

/** Key union of the `sidechat` namespace (Chinese dictionary is the source of truth). */
export type SidechatKey = keyof typeof zh
