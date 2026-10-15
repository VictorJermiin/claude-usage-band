# usage-band

A Claude Code mod that adds two rows under the prompt, just below the mode line (`⏵⏵ auto mode on …`):

```
  ⏵⏵ auto mode on (shift+tab to cycle)
  claude-opus-5-5 high  │  myproject ⎇ main  │  5h 23% (resets 2h14m)  7d 41% (resets 3d4h)  │  $1.23
  ctx ██▒░░░░░░░░░░░░░░░░░░░░░ 12% 119k/1000k  │  ■ chat 91k  ■ tools 19k  ■ skills 6k  ■ sys 3k  · compacts in ~848k
```

**Row 1:** model and effort level, current folder and git branch, rate-limit windows (5-hour / 7-day, with reset times, on subscription accounts) and session cost. Percentages are green, turning yellow at 70% and red at 90%.

**Row 2:** the context window: one bar coloured by what fills it, each category in its own colour that matches its label, how full it is (`12% 119k/1000k`), each category's size (`chat` is the conversation itself: your messages, replies and tool results), and how far you are from auto-compact.

Both rows update after every turn.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-band --marketplace VictorJermiin/claude-usage-band
```

Answer `y` to add the marketplace, then pick a scope (user scope shows it in every session).

## Notes

- Context-breakdown figures are local estimates (like `/context`), while the percentage and total are the exact count from the last reply, so the parts may not add up exactly to the total.
- Effort shows your saved `effortLevel` setting until the first reply, then what was actually used.
- Rate limits appear only on subscription accounts, after the first reply.

## Development

```
claude plugin validate .
claude plugin test .
```
