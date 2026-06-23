import type { MagicMarkAsyncResolver, MagicMarkMatch, MagicMarkResolver } from '../src'
import { describe, expect, it } from 'vitest'
import { createMagicMark } from '../src'

const githubResolver: MagicMarkResolver = {
  type: 'github',
  resolve(match: MagicMarkMatch) {
    const repo = match.params[0]?.trim() ?? ''
    if (!repo)
      return undefined
    const alias = match.params[1]?.trim() || repo
    return `[${alias}](https://github.com/${repo})`
  },
}

const echoResolver: MagicMarkResolver = {
  type: 'echo',
  resolve(match: MagicMarkMatch) {
    return match.params.join(' / ')
  },
}

describe('createMagicMark', () => {
  it('uses default brackets when called with no input', () => {
    const mark = createMagicMark()
    expect(mark.id).toBe('mark')
    expect(mark.open).toBe('{')
    expect(mark.close).toBe('}')
  })

  it('accepts a string shorthand for the id', () => {
    const mark = createMagicMark('link')
    expect(mark.id).toBe('link')
  })

  it('accepts a 2-char string shorthand for brackets', () => {
    const mark = createMagicMark({ brackets: '[]' })
    expect(mark.open).toBe('[')
    expect(mark.close).toBe(']')
  })

  it('accepts explicit { open, close } brackets', () => {
    const mark = createMagicMark({ brackets: { open: '「', close: '」' } })
    expect(mark.open).toBe('「')
    expect(mark.close).toBe('」')
  })

  it('throws when a brackets string is not 2 characters', () => {
    expect(() => createMagicMark({ brackets: '[' })).toThrow(/exactly 2 characters/)
    expect(() => createMagicMark({ brackets: '[[]' })).toThrow(/exactly 2 characters/)
  })

  it('throws when an explicit open/close is not a single character', () => {
    expect(() => createMagicMark({ brackets: { open: '[[', close: ']' } })).toThrow(/single character/)
    expect(() => createMagicMark({ brackets: { open: '[', close: ']]' } })).toThrow(/single character/)
  })

  it('accepts a single emoji as a bracket (code-point length, not UTF-16 units)', () => {
    const mark = createMagicMark({ brackets: { open: '🪐', close: '✨' } })
    expect(mark.open).toBe('🪐')
    expect(mark.close).toBe('✨')
    const matches = mark.parse('prefix 🪐mark:echo:a,b✨ suffix')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.raw).toBe('🪐mark:echo:a,b✨')
    expect(matches[0]?.params).toEqual(['a', 'b'])
  })
})

describe('parse', () => {
  const mark = createMagicMark({ resolvers: [githubResolver, echoResolver] })

  it('finds a single placeholder', () => {
    const matches = mark.parse('hi {mark:github:imba97/magic-mark,this repo} bye')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      id: 'mark',
      type: 'github',
      params: ['imba97/magic-mark', 'this repo'],
      raw: '{mark:github:imba97/magic-mark,this repo}',
      escaped: false,
    })
  })

  it('returns empty array for empty input', () => {
    expect(mark.parse('')).toEqual([])
  })

  it('returns empty array when nothing matches', () => {
    expect(mark.parse('hello world')).toEqual([])
  })

  it('skips an unclosed placeholder', () => {
    expect(mark.parse('prefix {mark:foo:bar')).toEqual([])
  })

  it('respects custom brackets', () => {
    const bracket = createMagicMark({ id: 'mark', brackets: '[]', resolvers: [echoResolver] })
    const matches = bracket.parse('prefix [mark:echo:a,b,c] suffix')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.raw).toBe('[mark:echo:a,b,c]')
    expect(matches[0]?.params).toEqual(['a', 'b', 'c'])
  })

  it('respects unicode brackets via explicit object', () => {
    const bracket = createMagicMark({ brackets: { open: '「', close: '」' }, resolvers: [echoResolver] })
    const matches = bracket.parse('prefix 「mark:echo:a,b,c」 suffix')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.raw).toBe('「mark:echo:a,b,c」')
  })

  it('splits escaped commas and backslashes', () => {
    const matches = mark.parse('{mark:echo:a\\,b,c\\\\d,e}')
    expect(matches[0]?.params).toEqual(['a,b', 'c\\d', 'e'])
  })

  it('decodes \\{ and \\} inside the payload to { and }', () => {
    const matches = mark.parse('{mark:echo:\\{xxx\\},\\{abc\\}}')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.escaped).toBe(false)
    expect(matches[0]?.params).toEqual(['{xxx}', '{abc}'])
  })

  it('decodes mixed escapes in a single payload', () => {
    // `\{` decodes to `{`, then an unescaped `,` is a param separator,
    // then `x`, then `\}` decodes to `}` — two params, not one.
    const matches = mark.parse('{mark:echo:\\{,x\\}}')
    expect(matches[0]?.params).toEqual(['{', 'x}'])
  })

  it('returns [] params for an empty payload', () => {
    const matches = mark.parse('{mark:echo:}')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.params).toEqual([])
  })

  it('trims whitespace around each parameter', () => {
    const matches = mark.parse('{mark:echo:  spaced  ,  out  }')
    expect(matches[0]?.params).toEqual(['spaced', 'out'])
  })

  it('accepts hyphens in the type segment', () => {
    const hyphenResolver: MagicMarkResolver = {
      type: 'my-resolver',
      resolve(match) {
        return match.params.join('-')
      },
    }
    const m = createMagicMark({ resolvers: [hyphenResolver] })
    const matches = m.parse('{mark:my-resolver:a,b}')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.type).toBe('my-resolver')
    expect(m.resolve(matches[0]!)).toBe('a-b')
  })

  it('marks leading-backslash matches as escaped and includes raw with leading \\', () => {
    const mark = createMagicMark({ resolvers: [echoResolver] })
    const escaped = mark.parse('\\{mark:echo:x\\}')
    expect(escaped).toHaveLength(1)
    expect(escaped[0]?.escaped).toBe(true)
    expect(escaped[0]?.raw).toBe('\\{mark:echo:x\\}')
  })

  it('mixes escaped and live placeholders in one source', () => {
    const mark = createMagicMark({ resolvers: [githubResolver] })
    const matches = mark.parse('keep \\{mark:nope:x\\} but resolve {mark:github:u/r}')
    expect(matches).toHaveLength(2)
    expect(matches[0]?.escaped).toBe(true)
    expect(matches[0]?.type).toBe('')
    expect(matches[1]?.escaped).toBe(false)
    expect(matches[1]?.type).toBe('github')
  })

  it('does not let a payload consume a nested live placeholder', () => {
    const matches = mark.parse('a {mark:foo:bar} b {mark:baz:qux}')
    expect(matches).toHaveLength(2)
    expect(matches[0]?.params).toEqual(['bar'])
    expect(matches[1]?.params).toEqual(['qux'])
  })

  it('does not let lastIndex pollution skip matches across repeated calls', () => {
    const text = 'a {mark:foo:x} b {mark:foo:y} c'
    expect(mark.parse(text)).toHaveLength(2)
    expect(mark.parse(text)).toHaveLength(2)
    expect(mark.parse('nothing')).toEqual([])
    expect(mark.parse(text)).toHaveLength(2)
  })
})

describe('escape', () => {
  const mark = createMagicMark({ resolvers: [echoResolver] })

  it('produces text whose escaped matches pass through `replace` verbatim', () => {
    const sample = 'prefix {mark:foo:a,b} suffix'
    const escaped = mark.escape(sample)
    const matches = mark.parse(escaped)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.escaped).toBe(true)
    expect(mark.replace(escaped)).toBe(escaped)
  })

  it('escapes both delimiters', () => {
    expect(mark.escape('a {b} c')).toBe('a \\{b\\} c')
  })

  it('escapes a backslash first so it is not double-escaped', () => {
    expect(mark.escape('a \\{b\\} c')).toBe('a \\\\\\{b\\\\\\} c')
  })

  it('respects custom brackets', () => {
    const bracket = createMagicMark({ brackets: '[]', resolvers: [echoResolver] })
    expect(bracket.escape('a [b] c')).toBe('a \\[b\\] c')
  })
})

describe('resolve', () => {
  const mark = createMagicMark({ resolvers: [githubResolver] })

  it('returns the resolver replacement string', () => {
    const [match] = mark.parse('{mark:github:user/repo,alias}')
    expect(mark.resolve(match!)).toBe('[alias](https://github.com/user/repo)')
  })

  it('returns undefined for unknown type', () => {
    const [match] = mark.parse('{mark:nope:foo}')
    expect(mark.resolve(match!)).toBeUndefined()
  })

  it('throws for unknown type when unknownType is throw', () => {
    const strict = createMagicMark({ resolvers: [githubResolver], unknownType: 'throw' })
    const [match] = strict.parse('{mark:nope:foo}')
    expect(() => strict.resolve(match!)).toThrow(/Unknown type/)
  })

  it('propagates exceptions thrown by a resolver', () => {
    const exploding: MagicMarkResolver = {
      type: 'boom',
      resolve() {
        throw new Error('kaboom')
      },
    }
    const m = createMagicMark({ resolvers: [exploding] })
    expect(() => m.replace('{mark:boom:x}')).toThrow('kaboom')
  })

  it('throws when invoked on an async-only resolver', () => {
    const asyncOnly: MagicMarkAsyncResolver = {
      type: 'remote',
      async resolveAsync() {
        return 'value'
      },
    }
    const m = createMagicMark({ resolvers: [asyncOnly] })
    const [match] = m.parse('{mark:remote:arg}')
    expect(() => m.resolve(match!)).toThrow(/async-only/)
  })

  it('passes the match through to the resolver', () => {
    let received: MagicMarkMatch | undefined
    const spy: MagicMarkResolver = {
      type: 'spy',
      resolve(m: MagicMarkMatch) {
        received = m
        return 'ok'
      },
    }
    const m = createMagicMark({ resolvers: [spy] })
    const [match] = m.parse('{mark:spy:arg}')
    expect(m.resolve(match!)).toBe('ok')
    expect(received?.params).toEqual(['arg'])
    expect(received?.raw).toBe('{mark:spy:arg}')
  })
})

describe('replace', () => {
  const mark = createMagicMark({ resolvers: [githubResolver] })

  it('replaces a placeholder with the resolver return value', () => {
    const out = mark.replace('see {mark:github:user/repo,this repo}!')
    expect(out).toBe('see [this repo](https://github.com/user/repo)!')
  })

  it('keeps raw text for unknown type when unknownType=leave', () => {
    const out = mark.replace('see {mark:nope:foo}!')
    expect(out).toBe('see {mark:nope:foo}!')
  })

  it('drops unknown placeholders when unknownType=remove', () => {
    const trimmer = createMagicMark({ resolvers: [githubResolver], unknownType: 'remove' })
    const out = trimmer.replace('a {mark:nope:foo} b {mark:github:u/r} c')
    expect(out).toBe('a  b [u/r](https://github.com/u/r) c')
  })

  it('overrides unknownType via per-call options', () => {
    const out = mark.replace('a {mark:nope:foo} b', { unknownType: 'remove' })
    expect(out).toBe('a  b')
  })

  it('outputs escaped matches as raw verbatim, even when unknown', () => {
    const out = mark.replace('see \\{mark:nope:foo\\} here')
    expect(out).toBe('see \\{mark:nope:foo\\} here')
  })

  it('mixes escaped passthrough and live resolution in one pass', () => {
    const out = mark.replace('a \\{mark:nope:x\\} b {mark:github:u/r,here} c')
    expect(out).toBe('a \\{mark:nope:x\\} b [here](https://github.com/u/r) c')
  })

  it('falls back to raw when the resolver itself returns undefined', () => {
    const maybe: MagicMarkResolver = {
      type: 'maybe',
      resolve(m: MagicMarkMatch) {
        return m.params[0] === 'yes' ? 'YES' : undefined
      },
    }
    const m = createMagicMark({ resolvers: [maybe] })
    expect(m.replace('a {mark:maybe:yes} / {mark:maybe:no}')).toBe('a YES / {mark:maybe:no}')
  })

  it('returns the original text when there are no placeholders', () => {
    const input = 'plain text with no tokens'
    expect(mark.replace(input)).toBe(input)
  })

  it('throws for unknown type when unknownType=throw is set per-call', () => {
    expect(() => mark.replace('a {mark:nope:x} b', { unknownType: 'throw' })).toThrow(/Unknown type/)
  })
})

describe('replaceAsync', () => {
  const asyncResolver: MagicMarkAsyncResolver = {
    type: 'upper',
    async resolveAsync(match) {
      return match.params[0]?.toUpperCase()
    },
  }

  it('awaits async resolvers and substitutes the result', async () => {
    const m = createMagicMark({ resolvers: [asyncResolver] })
    await expect(m.replaceAsync('hi {mark:upper:world}!')).resolves.toBe('hi WORLD!')
  })

  it('falls back to a sync resolver when no resolveAsync is registered', async () => {
    const m = createMagicMark({ resolvers: [githubResolver] })
    await expect(m.replaceAsync('see {mark:github:u/r,here}!')).resolves.toBe(
      'see [here](https://github.com/u/r)!',
    )
  })

  it('mixes sync and async resolvers in one pass', async () => {
    const m = createMagicMark({ resolvers: [asyncResolver, githubResolver] })
    const out = await m.replaceAsync('A {mark:upper:hello} B {mark:github:u/r,here} C')
    expect(out).toBe('A HELLO B [here](https://github.com/u/r) C')
  })

  it('keeps raw text for unknown async types when unknownType=leave', async () => {
    const m = createMagicMark({ resolvers: [asyncResolver] })
    await expect(m.replaceAsync('see {mark:nope:x}')).resolves.toBe('see {mark:nope:x}')
  })

  it('drops unknown placeholders per-call when unknownType=remove', async () => {
    const m = createMagicMark({ resolvers: [asyncResolver] })
    await expect(m.replaceAsync('a {mark:nope:x} b', { unknownType: 'remove' })).resolves.toBe('a  b')
  })

  it('emits escaped matches verbatim', async () => {
    const m = createMagicMark({ resolvers: [asyncResolver] })
    await expect(m.replaceAsync('see \\{mark:upper:x\\}')).resolves.toBe('see \\{mark:upper:x\\}')
  })
})

describe('registry', () => {
  it('register / unregister / listTypes', () => {
    const mark = createMagicMark()
    expect(mark.listTypes()).toEqual([])

    const foo: MagicMarkResolver = {
      type: 'foo',
      resolve() {
        return 'foo'
      },
    }
    mark.register(foo)
    expect(mark.listTypes()).toEqual(['foo'])

    mark.unregister('foo')
    expect(mark.listTypes()).toEqual([])
  })

  it('throws if a registered resolver implements neither resolve nor resolveAsync', () => {
    const mark = createMagicMark()
    expect(() => mark.register({ type: 'broken' } as MagicMarkResolver)).toThrow(/must implement/)
  })

  it('can register an async resolver', () => {
    const mark = createMagicMark()
    mark.register({
      type: 'remote',
      async resolveAsync() {
        return 'value'
      },
    })
    expect(mark.listTypes()).toEqual(['remote'])
  })
})
