import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, SessionContextBreakdown } from 'claude-code'

import type { Breakdown, Limit, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const effort = atom({ plugin: 'usage-band', key: 'effort' } as const, null)

const SHORT_NAMES: Record<string, string> = {
  'System prompt': 'sys',
  'System tools': 'tools',
  'MCP server instructions': 'mcp',
  'MCP tools': 'mcp tools',
  'Custom agents': 'agents',
  'Memory files': 'memory',
  Skills: 'skills',
  Messages: 'msgs',
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

function bar(percent: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
}

function color(percent: number): string {
  return percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : 'green'
}

function resetsIn(limit: Limit, now: number): string {
  if (!limit.resetsAt) return ''
  const minutes = Math.max(0, Math.round((Date.parse(limit.resetsAt) - now) / 60000))
  const hours = Math.floor(minutes / 60)

  if (hours >= 24) return ` (resets ${Math.floor(hours / 24)}d${hours % 24}h)`

  return ` (resets ${hours}h${minutes % 60}m)`
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)

  return parts[parts.length - 1] ?? '/'
}

async function branchOf($: EngineInterface): Promise<string | null> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 3000 })
    const name = stdout.trim()

    return exitCode === 0 && name !== '' ? name : null
  } catch {
    return null
  }
}

async function effortFromSettings($: EngineInterface): Promise<string | null> {
  try {
    const value = (await $.settings.read())['effortLevel']

    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

function toBreakdown(b: SessionContextBreakdown | undefined): Breakdown | null {
  if (!b) return null

  return {
    parts: b.categories
      .filter(c => !c.isDeferred)
      .map(c => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })),
    total: b.totalTokens,
    max: b.rawMaxTokens,
    compactAt: b.autoCompactThreshold,
  }
}

// One bar for the whole window: a coloured run per used category, then free space.
function segments(b: Breakdown, width: number): { color: string; text: string }[] {
  const out: { color: string; text: string }[] = []
  let left = width
  for (const part of b.parts) {
    if (part.kind !== 'used' || part.tokens <= 0 || left <= 0) continue
    const cells = Math.min(left, Math.max(1, Math.round((part.tokens / b.max) * width)))
    out.push({ color: part.color, text: '█'.repeat(cells) })
    left -= cells
  }
  if (left > 0) out.push({ color: 'inactive', text: '░'.repeat(left) })

  return out
}

async function refresh($: EngineInterface) {
  const [model, usage, cwd, branch] = await Promise.all([
    $.session.model(),
    $.session.usage({ breakdown: 'summary' }),
    $.session.cwd(),
    branchOf($),
  ])
  const snap: Snapshot = {
    model,
    folder: basename(cwd),
    branch,
    context: { tokens: usage.context.tokens, window: usage.context.window, percent: usage.context.percent },
    rateLimits: usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    costUsd: usage.cost?.usd,
    breakdown: toBreakdown(usage.context.breakdown),
  }
  await update($, snapshot, () => snap)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const level = await effortFromSettings($)
    await update($, effort, current => current ?? level)
    await refresh($)

    return result
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) {
      const level = String(e.effort)
      await update($, effort, () => level)
    }

    return yield* next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const own = await next(e)
    const snap = await read($, snapshot)

    if (snap === null) {
      return own
    }

    const level = await read($, effort)
    const { Box, Text } = $.ui.resolve(e)
    const ctx = snap.context
    const now = await $.clock.now()

    return (
      <Box flexDirection="column">
        {own}
        <Box>
          <Text bold>{snap.model}</Text>
          {level === null ? null : <Text dimColor>{` · ${level}`}</Text>}
          <Text dimColor>{'  '}</Text>
          <Text color="cyan">{snap.folder}</Text>
          {snap.branch === null ? null : <Text color="magenta">{` ⎇ ${snap.branch}`}</Text>}
          <Text dimColor>{'  ctx '}</Text>
          {ctx.percent === undefined ? (
            <Text dimColor>{`— / ${tokens(ctx.window)}`}</Text>
          ) : (
            <Text color={color(ctx.percent)}>
              {`${bar(ctx.percent)} ${ctx.percent}% ${tokens(ctx.tokens ?? 0)}/${tokens(ctx.window)}`}
            </Text>
          )}
          {snap.rateLimits.map(limit => (
            <Text key={limit.kind}>
              <Text dimColor>{`  ${LIMIT_NAMES[limit.kind] ?? limit.kind} `}</Text>
              <Text color={color(limit.percentUsed)}>{`${limit.percentUsed}%`}</Text>
              <Text dimColor>{resetsIn(limit, now)}</Text>
            </Text>
          ))}
          {snap.costUsd === undefined ? null : <Text dimColor>{`  $${snap.costUsd.toFixed(2)}`}</Text>}
        </Box>
        {snap.breakdown === null ? null : (
          <Box>
            {segments(snap.breakdown, 24).map((seg, i) => (
              <Text key={`seg${i}`} color={seg.color as Color}>{seg.text}</Text>
            ))}
            {snap.breakdown.parts
              .filter(part => part.kind === 'used' && part.tokens > 0)
              .sort((x, y) => y.tokens - x.tokens)
              .map(part => (
                <Text key={part.name}>
                  <Text color={part.color as Color}>{'  ■ '}</Text>
                  <Text dimColor>{`${SHORT_NAMES[part.name] ?? part.name.toLowerCase()} ${tokens(part.tokens)}`}</Text>
                </Text>
              ))}
            {snap.breakdown.compactAt === undefined ? null : (
              <Text dimColor>{`  · compacts in ~${tokens(Math.max(0, snap.breakdown.compactAt - snap.breakdown.total))}`}</Text>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
