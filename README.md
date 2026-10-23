# suggest

A Claude Code mod. When Claude ends a turn, up to three suggested replies show as
buttons under its last message. Tap or click one and it is sent as your next prompt.
It works in the terminal. The Claude mobile app (Remote Control) doesn't draw plugin buttons, so they don't show there.

## Install

In Claude Code, run:

```
/plugin install suggest --marketplace dophamine/suggest
```

Or add the marketplace first, then install from it:

```
/plugin marketplace add dophamine/suggest
/plugin install suggest@suggest
```

It needs a Claude Code version with plugin hook modules (2.1.308 or later).

Where the suggestions come from:
- Claude Code's own grey prompt suggestion (the one Tab accepts), shown first. It costs nothing extra.
- Up to 2 more from Claude Haiku, which reads only the last few messages (at most ~6,000 characters,
  long messages cut to their last 2,500). When Haiku isn't sure what you'd say next it adds none,
  and you get just the one suggestion.

The buttons clear as soon as you send any prompt.

Clicking a reply sends it. If it's a slash command (`/compact`), it runs instead. Click the dim ✎ next to a reply
to put it in the input, where you can edit it and press Enter.

## Settings

Change them in `/config` (rows starting with "Suggest ›"), and the mod reloads with the new values. No restart needed.

| Setting | Default | What it does |
| --- | --- | --- |
| `mode` | smart | Claude Code's own suggestion always shows (free). `auto`: extra replies after every reply. `smart`: only when Claude asks or offers something. `manual`: only when you run `/suggest`. |
| `click` | send | `send`: a click sends (✎ fills the input). `fill`: a click fills the input, nothing is sent until you press Enter. |
| `maxReplies` | 3 | Buttons shown. `1` keeps only Claude Code's own suggestion and makes no model call. |
| `model` | haiku | Model for the extra replies: haiku, sonnet or opus |
| `effort` | low | How hard that model thinks: low, medium, high, xhigh or max |
| `contextChars` | 6000 | How much recent conversation the model reads |
| `messageChars` | 2500 | Longer messages keep only their last part |

They're stored in `settings.json` under `pluginConfigs["suggest"].options`.

## /suggest

- `/suggest` shows the buttons under Claude's last reply now. Nothing is sent to the session.
- `/suggest <hint>` steers them, like `/suggest shorter` or `/suggest about testing`. All buttons then come from the model.
- `/suggest auto`, `/suggest smart` or `/suggest manual` switches the mode.

## Cost

Claude Code's own suggestion is free. Each extra reply set is one small model call (Haiku at low
effort by default) on your account. Set `mode` to `manual` or `maxReplies` to `1` to make none.

## Development

```
git clone https://github.com/dophamine/suggest
claude --plugin-dir ./suggest   # load it from the folder
claude plugin test ./suggest    # run the tests
claude plugin validate ./suggest
```

Claude Code writes the type declarations to `.claude-plugin/types/` when it loads the folder.

## License

MIT
