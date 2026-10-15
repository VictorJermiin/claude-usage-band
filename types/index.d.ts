export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Part = { name: string; tokens: number; color: string; kind: string }

export type Breakdown = { parts: Part[]; total: number; max: number; compactAt?: number }

export type Snapshot = {
  model: string
  folder: string
  branch: string | null
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: Limit[]
  costUsd?: number
  breakdown: Breakdown | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snapshot: Snapshot | null; effort: string | null }
  }
}
