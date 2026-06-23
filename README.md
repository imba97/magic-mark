# magic-mark

Tiny placeholder engine. Parse `{id:type:arg1,arg2}` from any text, resolve it through **your own** resolvers, output any string.

Renderer-agnostic — no markdown-it, no docx, no DOM. Bring your own renderer.

## Install

```bash
pnpm add magic-mark
```

## Quick Start

```ts
import { createMagicMark } from 'magic-mark'

// 1. Define a resolver — a plain object with a `type` and a `resolve` function
const githubResolver = {
  type: 'github',
  resolve(match) {
    const repo = match.params[0]?.trim() ?? ''
    if (!repo)
      return undefined // keep the original token
    const alias = match.params[1]?.trim() || repo
    return `[${alias}](https://github.com/${repo})` // markdown link, plain text, HTML… anything you want
  },
}

// 2. Build the engine (default: {mark:type:arg1,arg2})
const mark = createMagicMark({
  resolvers: [githubResolver],
})

// 3. Parse
mark.parse('See {mark:github:imba97/magic-mark,this repo} for details')
// → [{
//     id: 'mark',
//     type: 'github',
//     params: ['imba97/magic-mark', 'this repo'],
//     raw: '{mark:github:imba97/magic-mark,this repo}',
//     start: 4, end: 43, escaped: false
//   }]

// 4. Replace — registered resolvers run in one pass
mark.replace('See {mark:github:imba97/magic-mark,this repo} for details')
// → 'See [this repo](https://github.com/imba97/magic-mark) for details'
```

A resolver's `resolve()` returns the literal string that replaces the token. Return `undefined` to keep the original raw text. There is no built-in concept of "link", "icon", or "class names" — whatever shape you want to substitute (`<a>`, `<div>`, markdown link, plain text) is up to you.

## Configurable Syntax

```ts
// Shorthand: rename the first segment
const link = createMagicMark('link') // matches {link:type:...}

// Shorthand: 2-char string for brackets
const square = createMagicMark({ brackets: '[]' }) // matches [mark:type:...]

// Explicit: object form for brackets
const bracket = createMagicMark({
  id: 'mark',
  brackets: { open: '[', close: ']' }
}) // matches [mark:type:...]

// Unicode brackets work too
const corner = createMagicMark({
  brackets: { open: '「', close: '」' }
}) // matches 「mark:type:...」

// Emoji brackets work too — measured by code-point length
const star = createMagicMark({
  brackets: { open: '🪐', close: '✨' }
}) // matches 🪐mark:type:...✨

// Combined
const angle = createMagicMark({
  id: 'ref',
  brackets: '<>'
}) // matches <ref:type:...>
```

The `type` segment allows word characters and hyphens (`[A-Za-z0-9_-]+`), so `my-resolver` is a valid type id.

## Escaping

Prefix a placeholder with `\` to make it pass through verbatim — the parser sees `\{mark:foo:x\}` as a literal token with `escaped: true`, and `replace()` emits it unchanged (leading backslash included).

```ts
mark.replace('keep \\{mark:foo:x\\} literal')
// → 'keep \\{mark:foo:x\\} literal'
```

Call `mark.escape(text)` to escape brackets and backslashes in arbitrary text so they don't trigger live matching.

### Escape Reference

Inside a payload, the backslash decodes these two-character sequences into a single output character:

| Source | Output | Notes |
|---|---|---|
| `\,` | `,` | lets you embed a literal comma without splitting the param |
| `\\` | `\` | a single literal backslash |
| `\{` | `{` | lets you embed the open bracket — `{mark:foo:\{x\}}` → params `['{x}']` |
| `\}` | `}` | same, for the close bracket |

Backslash followed by anything else (e.g. `\n`, `\X`) is preserved as-is — the backslash is not silently dropped.

## Unknown Types

By default, a placeholder whose `type` has no registered resolver is left as the raw token. Override with `unknownType`:

```ts
const strict = createMagicMark({ resolvers: [githubResolver], unknownType: 'throw' }) // throws on unknown
const trimmer = createMagicMark({ resolvers: [githubResolver], unknownType: 'remove' }) // drops the token
```

A resolver can also return `undefined` to opt out per-match — same effect as `unknownType: 'leave'` for that token. Override per-call via `replace(text, { unknownType })`.

## Async Resolvers

For resolvers that need to await IO (remote fetches, async lookups), implement `resolveAsync` instead of (or alongside) `resolve`. Use `replaceAsync` to run a pass:

```ts
import type { MagicMarkAsyncResolver } from 'magic-mark'

const linkResolver: MagicMarkAsyncResolver = {
  type: 'short-link',
  async resolveAsync(match) {
    const short = await shorten(match.params[0]!)
    return `[${match.params[1] ?? short}](https://${short})`
  },
}

const mark = createMagicMark({ resolvers: [linkResolver] })
await mark.replaceAsync('see {mark:short-link:https://example.com/long,here}')
// → 'see [here](https://short.example/abc)'
```

Sync and async resolvers can be mixed freely; `replaceAsync` awaits a registered sync resolver as if it were a `Promise.resolve(...)`.

## API

### `createMagicMark(input?)`

- `createMagicMark()` → defaults to `{mark:type:arg1,arg2}`
- `createMagicMark('link')` → shorthand for `{ id: 'link' }`
- `createMagicMark({ id, brackets, resolvers, unknownType })` → full config
  - `brackets` accepts a 2-char string `'[]'` / `'「」'` / `'🪐✨'`, or an explicit `{ open, close }` object. Each side is one Unicode code point.
  - `resolvers` accepts sync (`{ type, resolve }`) and/or async (`{ type, resolveAsync }`) resolvers.
  - `unknownType`: `'leave'` (default) | `'remove'` | `'throw'`

### `mark.parse(text): MagicMarkMatch[]`

Find all placeholders. Pure regex, no I/O. Escaped matches (`\{...\}`) are returned with `escaped: true`.

### `mark.resolve(match, options?): string | undefined`

Call the registered sync resolver for `match.type`. Returns `undefined` if unknown (or the resolver returned `undefined`). Throws for async-only resolvers — use `resolveAsync`.

### `mark.resolveAsync(match, options?): Promise<string | undefined>`

Async counterpart; falls back to a sync resolver when present.

### `mark.replace(text, options?): string`

Parse `text` and apply every sync resolver in one pass. Unknown types keep the raw token unless `unknownType: 'remove'` or `options.unknownType` overrides it. Escaped matches are emitted verbatim.

### `mark.replaceAsync(text, options?): Promise<string>`

Async counterpart; awaits every resolver (sync ones resolve immediately).

### `mark.escape(text): string`

Escape both delimiters and backslashes so they don't trigger matching. `mark.replace(mark.escape(x))` is a no-op for the placeholder syntax inside `x`.

### `mark.register(resolver)` / `mark.unregister(type)` / `mark.get(type)` / `mark.listTypes()`

Runtime registry management. A resolver may implement `resolve` (sync) or `resolveAsync` (async) or both.

## Renderer Integration

### markdown-it

```ts
import MarkdownIt from 'markdown-it'
import { createMagicMark } from 'magic-mark'

const md = new MarkdownIt()
const mark = createMagicMark({
  resolvers: [{
    type: 'github',
    resolve(m) {
      return md.renderInline(`[${m.params[1] ?? m.params[0]}](https://github.com/${m.params[0]})`)
    },
  }],
})

// Pre-process any text containing {mark:github:...} before markdown sees it:
md.core.ruler.before('normalize', 'magic-mark', (state) => {
  state.src = mark.replace(state.src)
})
```

### React

```ts
import { Fragment } from 'react'
import { createMagicMark } from 'magic-mark'

const mark = createMagicMark({ resolvers: [/* … */] })

function render(text: string) {
  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const m of mark.parse(text)) {
    if (cursor < m.start) nodes.push(text.slice(cursor, m.start))
    if (m.escaped) {
      nodes.push(m.raw) // render the literal \{...\}
    }
    else {
      const replacement = mark.resolve(m)
      nodes.push(replacement ?? m.raw)
    }
    cursor = m.end
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}
```

## License

MIT