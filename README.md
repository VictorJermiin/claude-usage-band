# usage-band

A Claude Code mod that adds two rows under the prompt, just below the mode line (`⏵⏵ auto mode on …`):

```
  ⏵⏵ auto mode on (shift+tab to cycle)
  claude-opus-5-5 · high  myproject ⎇ main  ctx █░░░░░░░░░ 12% 119k/1m  5h 23% (resets 2h14m)  $1.23
  ██▒░░░░░░░░░░░░░░░░░░░░░  ■ msgs 91k  ■ tools 19k  ■ skills 6k  ■ sys 3k  · compacts in ~848k
```

**Row 1:** model and effort level, current folder and git branch, context window fill, rate-limit windows (5-hour / 7-day, with reset times, on subscription accounts) and session cost. Percentages turn yellow at 70% and red at 90%.

**Row 2:** what fills the context window, as one bar coloured by category (the same colours `/context` uses), each category's size, and how far you are from auto-compact.

Both rows update after every turn.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-band --marketplace VictorJermiin/claude-usage-band
```

Answer `y` to add the marketplace, then pick a scope (user scope shows it in every session).

## Notes

- Context-breakdown figures are local estimates (like `/context`), so they can differ slightly from the `ctx` percentage, which is the exact count from the last reply.
- Effort shows your saved `effortLevel` setting until the first reply, then what was actually used.
- Rate limits appear only on subscription accounts, after the first reply.

## Development

```
claude plugin validate .
claude plugin test .
```
