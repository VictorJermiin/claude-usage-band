import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, SessionContextBreakdown } from 'claude-code'

import type { Breakdown, Limit, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const effort = atom({ plugin: 'usage-band', key: 'effort' } as const, null)

// Mid-tone colours that read on both dark and light terminals.
const PALETTE = {
  model: '#d97757',
  folder: '#0ea5e9',
  branch: '#84cc16',
  ok: '#22c55e',
  warn: '#eab308',
  high: '#ef4444',
}

const EFFORT_COLORS: Record<string, string> = {
  low: '#94a3b8',
  medium: '#3b82f6',
  high: '#a855f7',
  xhigh: '#d946ef',
  max: '#ec4899',
}

// Each context category gets a colour of its own, so neighbours in the bar never blur.
const CATEGORIES: Record<string, { label: string; color: string }> = {
  Messages: { label: 'chat', color: '#3b82f6' },
  'System tools': { label: 'tools', color: '#f59e0b' },
  'System prompt': { label: 'sys', color: '#8b5cf6' },
  Skills: { label: 'skills', color: '#10b981' },
  'MCP server instructions': { label: 'mcp', color: '#ec4899' },
  'MCP tools': { label: 'mcp tools', color: '#d946ef' },
  'Memory files': { label: 'memory', color: '#14b8a6' },
  'Custom agents': { label: 'agents', color: '#f97316' },
}

function category(name: string, fallback: string): { label: string; color: string } {
  return CATEGORIES[name] ?? { label: name.toLowerCase(), color: fallback }
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: 'session',
  seven_day: 'weekly',
  spend_limit: 'spend',
}

const BAR_WIDTH = 24

// Terminal cells a plain string takes; every character the rows draw is one cell wide.
function width(text: string): number {
  return [...text].length
}

// Always in thousands: whole k from 1000 up, one decimal below it (631 → 0.6k).
function tokens(n: number): string {
  if (n <= 0) return '0k'
  if (n >= 950) return `${Math.round(n / 1000)}k`

  return `${Math.max(0.1, Math.round(n / 100) / 10).toFixed(1)}k`
}

function color(percent: number): string {
  return percent >= 90 ? PALETTE.high : percent >= 70 ? PALETTE.warn : PALETTE.ok
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
  }
}

// One bar for the whole window: a coloured run per used category, then free space.
function segments(b: Breakdown, width: number): { color: string; text: string }[] {
  const out: { color: string; text: string }[] = []
  let left = width
  for (const part of b.parts) {
    if (part.kind !== 'used' || part.tokens <= 0 || left <= 0) continue
    const cells = Math.min(left, Math.max(1, Math.round((part.tokens / b.max) * width)))
    out.push({ color: category(part.name, part.color).color, text: '█'.repeat(cells) })
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
    const b = snap.breakdown
    // The exact count from the last reply when there is one, the estimate before it.
    const used = ctx.tokens ?? b?.total
    const window = ctx.tokens === undefined ? (b?.max ?? ctx.window) : ctx.window
    const percent = ctx.percent ?? (used === undefined ? undefined : Math.round((used / window) * 100))
    const now = await $.clock.now()

    const sep = <Text dimColor>{'  │  '}</Text>
    const ctxText =
      percent === undefined
        ? ` — / ${tokens(window)}`
        : ` ${percent}% ${tokens(used ?? 0)}/${tokens(window)}`

    // Pad the first part of each row to one width, so the next │ lines up across both rows.
    const topLeft = width(
      `${snap.model}${level === null ? '' : ` ${level}`}  │  ${snap.folder}${snap.branch === null ? '' : ` ⎇ ${snap.branch}`}`,
    )
    const bottomLeft = width(`ctx ${b === null ? '' : ' '.repeat(BAR_WIDTH)}${ctxText}`)
    const column = Math.max(topLeft, bottomLeft)

    return (
      <Box flexDirection="column">
        {own}
        <Box>
          <Text bold color={PALETTE.model}>{snap.model}</Text>
          {level === null ? null : (
            <Text color={EFFORT_COLORS[level] ?? EFFORT_COLORS.medium}>{` ${level}`}</Text>
          )}
          {sep}
          <Text color={PALETTE.folder}>{snap.folder}</Text>
          {snap.branch === null ? null : <Text color={PALETTE.branch}>{` ⎇ ${snap.branch}`}</Text>}
          <Text>{' '.repeat(column - topLeft)}</Text>
          {snap.rateLimits.length === 0 ? null : sep}
          {snap.rateLimits.map((limit, i) => (
            <Text key={limit.kind}>
              <Text dimColor>{`${i === 0 ? '' : '  '}${LIMIT_NAMES[limit.kind] ?? limit.kind} `}</Text>
              <Text bold color={color(limit.percentUsed)}>{`${limit.percentUsed}%`}</Text>
              <Text dimColor>{resetsIn(limit, now)}</Text>
            </Text>
          ))}
          {snap.costUsd === undefined ? null : sep}
          {snap.costUsd === undefined ? null : <Text>{`$${snap.costUsd.toFixed(2)}`}</Text>}
        </Box>
        <Box>
          <Text dimColor>{'ctx '}</Text>
          {b === null
            ? null
            : segments(b, BAR_WIDTH).map((seg, i) => (
                <Text key={`seg${i}`} color={seg.color as Color} dimColor={seg.color === 'inactive'}>{seg.text}</Text>
              ))}
          {percent === undefined ? (
            <Text dimColor>{ctxText}</Text>
          ) : (
            <Text>
              <Text bold color={color(percent)}>{` ${percent}%`}</Text>
              <Text>{` ${tokens(used ?? 0)}`}</Text>
              <Text dimColor>{`/${tokens(window)}`}</Text>
            </Text>
          )}
          <Text>{' '.repeat(column - bottomLeft)}</Text>
          {b === null ? null : sep}
          {b === null
            ? null
            : b.parts
                .filter(part => part.kind === 'used' && part.tokens > 0)
                .sort((x, y) => y.tokens - x.tokens)
                .map((part, i) => {
                  const { label, color: hue } = category(part.name, part.color)

                  return (
                    <Text key={part.name}>
                      <Text color={hue as Color}>{`${i === 0 ? '' : '  '}■ ${label}`}</Text>
                      <Text dimColor>{` ${tokens(part.tokens)}`}</Text>
                    </Text>
                  )
                })}
        </Box>
      </Box>
    )
  })
}
