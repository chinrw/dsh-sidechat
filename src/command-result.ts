import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideMode } from './prompts.ts'

export function sideCommandResult(result: Pick<CommandResult, 'kind' | 'text'> | null): { childId: SessionId; mode: SideMode } | undefined {
  if (result?.kind !== 'success' || result.text === undefined) return undefined
  const match = /^(Side conversation|BTW question) started: ([0-9a-f-]{36})\.$/.exec(result.text)
  if (match === null) return undefined
  return { childId: match[2] as SessionId, mode: match[1] === 'BTW question' ? 'btw' : 'side' }
}
