import { expect, mock, test } from 'claude-code/testing'
import type { SessionContextBreakdown } from 'claude-code'

const breakdown: SessionContextBreakdown = {
  categories: [
    { name: 'System prompt', tokens: 6000, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 70000, color: 'purple', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 124000, color: 'inactive', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 84000,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  autocompactSource: 'model-default',
  percentage: 42,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [{ path: '/home/victor/.claude/CLAUDE.md', type: 'User', tokens: 1200 }],
  mcpTools: [],
  agents: [],
  autoCompactThreshold: 167000,
  isAutoCompactEnabled: true,
  apiUsage: null,
}

const usage = {
  startedAt: 0,
  context: { tokens: 84000, window: 200000, percent: 42 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 91, resetsAt: '2030-01-01T00:00:00Z' }],
  cost: { usd: 1.234 },
}

test('footer rows show usage and context breakdown', async ($, on) => {
  on('session.usage', (_, e) => ({ value: e?.breakdown ? { ...usage, context: { ...usage.context, breakdown } } : usage }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/home/user/project' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', () => ({ cwd: '/home/user/project' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>⏵⏵ auto mode on</Text>
  })

  await $.session.start({ cwd: '/home/user/project', surface: 'terminal', isInteractive: true })
  await $.session.measure({ ...usage, changed: ['context', 'rateLimits', 'cost'] })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '⏵⏵ auto mode on' } })
    for (const text of [/msgs 70k/, /sys 6k/, /compacts in ~83k/, /auto mode on/, /claude-opus-5-5/, /high/, /project/, /main/, /42% 84k\/200k/, /91%/, /\$1\.23/]) {
      expect(await ui.find({ type: 'Text', text })).toBeDefined()
    }
    await ui.unmount()

  }
})
