import type {
  MagicMarkBrackets,
  MagicMarkConfig,
  MagicMarkInput,
  MagicMarkMatch,
  MagicMarkReplaceOptions,
  UnknownTypePolicy,
} from './types'
import { buildEscapedPattern, buildPattern, splitParams } from './pattern'

const DEFAULT_ID = 'mark'
const DEFAULT_BRACKETS: { open: string, close: string } = { open: '{', close: '}' }

export type { MagicMarkInput, MagicMarkReplaceOptions } from './types'

interface AnyResolver {
  readonly type: string
  readonly resolve?: (match: MagicMarkMatch) => string | undefined
  readonly resolveAsync?: (match: MagicMarkMatch) => Promise<string | undefined>
}

/** Normalize a `brackets` value (string or object) into `{ open, close }`. */
function normalizeBrackets(value: MagicMarkBrackets | undefined): { open: string, close: string } {
  if (value === undefined)
    return { ...DEFAULT_BRACKETS }
  if (typeof value === 'string') {
    const cps = Array.from(value)
    if (cps.length !== 2) {
      throw new Error(`[magic-mark] \`brackets\` string must be exactly 2 characters (got ${cps.length}).`)
    }
    return { open: cps[0]!, close: cps[1]! }
  }
  const openCP = Array.from(value.open)
  if (openCP.length !== 1) {
    throw new Error(`[magic-mark] \`brackets.open\` must be a single character.`)
  }
  const closeCP = Array.from(value.close)
  if (closeCP.length !== 1) {
    throw new Error(`[magic-mark] \`brackets.close\` must be a single character.`)
  }
  return { open: openCP[0]!, close: closeCP[0]! }
}

/**
 * Core placeholder engine. Created via `createMagicMark(...)`.
 *
 * Pure text parsing — no I/O, no renderer, no business semantics.
 * Resolvers are user-supplied functions of `match → string`; the engine
 * stays out of the way and just wires matches up with their replacements.
 */
export class MagicMarkCore {
  readonly id: string
  readonly open: string
  readonly close: string
  readonly unknownType: UnknownTypePolicy

  private readonly pattern: RegExp
  private readonly escapedPattern: RegExp
  private readonly resolvers = new Map<string, AnyResolver>()

  constructor(config: MagicMarkConfig = {}) {
    this.id = config.id ?? DEFAULT_ID
    const { open, close } = normalizeBrackets(config.brackets)
    this.open = open
    this.close = close
    this.unknownType = config.unknownType ?? 'leave'

    this.pattern = buildPattern({
      id: this.id,
      open: this.open,
      close: this.close,
    })
    this.escapedPattern = buildEscapedPattern({
      open: this.open,
      close: this.close,
    })

    for (const resolver of config.resolvers ?? []) {
      this.register(resolver)
    }
  }

  /**
   * Register (or replace) a resolver by type id. Accepts both sync (`resolve`)
   * and async (`resolveAsync`) resolvers; a single handler must implement at
   * least one of the two or this method throws.
   */
  register(resolver: AnyResolver): void {
    if (typeof resolver.resolve !== 'function' && typeof resolver.resolveAsync !== 'function') {
      throw new TypeError(`[magic-mark] resolver "${resolver.type}" must implement \`resolve\` or \`resolveAsync\`.`)
    }
    this.resolvers.set(resolver.type, resolver)
  }

  /** Remove a registered resolver. */
  unregister(type: string): void {
    this.resolvers.delete(type)
  }

  /** Look up a registered resolver. */
  get(type: string): AnyResolver | undefined {
    return this.resolvers.get(type)
  }

  /** List registered type ids. */
  listTypes(): string[] {
    return Array.from(this.resolvers.keys())
  }

  /**
   * Escape `text` so that any placeholder syntax inside is neutralized.
   *
   * Both delimiters are escaped, so e.g. `escape('{mark:foo:x}')` produces
   * `\{mark:foo:x\}` which `parse()` recognises as a single escaped match
   * (raw passthrough) instead of a live placeholder.
   *
   * @example
   * mark.escape('See {mark:foo:bar} for details')
   * // → 'See \\{mark:foo:bar\\} for details'
   */
  escape(text: string): string {
    return text
      .replaceAll('\\', '\\\\')
      .replaceAll(this.open, `\\${this.open}`)
      .replaceAll(this.close, `\\${this.close}`)
  }

  /**
   * Find all placeholders in `text`.
   *
   * Each match's `escaped` flag distinguishes live tokens (`false`) from
   * `\{...\}` literals (`true`). For live matches, `params` is the comma-split
   * decoded parameter list. For escaped matches, `params` is `[]` and `type`
   * is `''`.
   *
   * Overlapping matches are resolved by preferring the longest at each
   * start position (escaped wins over a contained live match).
   *
   * @example
   * mark.parse('see {mark:foo:a,b}')
   * // → [{ id: 'mark', type: 'foo', params: ['a','b'], raw: '{mark:foo:a,b}', ... }]
   */
  parse(text: string): MagicMarkMatch[] {
    const found: MagicMarkMatch[] = []

    const normal = new RegExp(this.pattern.source, this.pattern.flags)
    for (let m = normal.exec(text); m !== null; m = normal.exec(text)) {
      const [raw, id, type, payload] = m
      if (raw.length === 0 || !id || !type)
        continue
      found.push({
        id,
        type,
        params: splitParams(payload ?? '', this.open, this.close),
        raw,
        start: m.index,
        end: m.index + raw.length,
        escaped: false,
      })
      if (m.index === normal.lastIndex)
        normal.lastIndex++
    }

    const escaped = new RegExp(this.escapedPattern.source, this.escapedPattern.flags)
    for (let m = escaped.exec(text); m !== null; m = escaped.exec(text)) {
      const [raw] = m
      if (raw.length === 0)
        continue
      found.push({
        id: this.id,
        type: '',
        params: [],
        raw,
        start: m.index,
        end: m.index + raw.length,
        escaped: true,
      })
      if (m.index === escaped.lastIndex)
        escaped.lastIndex++
    }

    // Sort by start asc, then by length desc (longer wins on tie so escaped wins over nested).
    found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))

    // Drop any match contained in an earlier (already-accepted) match.
    const result: MagicMarkMatch[] = []
    for (const m of found) {
      const container = result.find(r => r.start <= m.start && m.end <= r.end)
      if (container)
        continue
      result.push(m)
    }
    return result
  }

  /**
   * Resolve a single match through the resolver registry.
   *
   * Returns the replacement string, or `undefined` if the type is unknown
   * (or the resolver returned `undefined`). Throws when
   * `unknownType === 'throw'` and the type is unknown, or when the match
   * belongs to an async-only resolver — call `resolveAsync` for those.
   */
  resolve(match: MagicMarkMatch, options: MagicMarkReplaceOptions = {}): string | undefined {
    return this.resolveInternal(match, options.unknownType ?? this.unknownType)
  }

  /**
   * Async counterpart to {@link resolve}. Falls back to a registered sync
   * resolver when no `resolveAsync` is provided for the type.
   */
  async resolveAsync(match: MagicMarkMatch, options: MagicMarkReplaceOptions = {}): Promise<string | undefined> {
    const policy = options.unknownType ?? this.unknownType
    const resolver = this.resolvers.get(match.type)
    if (!resolver) {
      if (policy === 'throw')
        throw new Error(`[magic-mark] Unknown type "${match.type}" in ${match.raw}`)
      return undefined
    }
    if (typeof resolver.resolveAsync === 'function')
      return resolver.resolveAsync(match)
    if (typeof resolver.resolve === 'function')
      return resolver.resolve(match)
    if (policy === 'throw')
      throw new Error(`[magic-mark] Unknown type "${match.type}" in ${match.raw}`)
    return undefined
  }

  private resolveInternal(match: MagicMarkMatch, policy: UnknownTypePolicy): string | undefined {
    const resolver = this.resolvers.get(match.type)
    if (!resolver) {
      if (policy === 'throw')
        throw new Error(`[magic-mark] Unknown type "${match.type}" in ${match.raw}`)
      return undefined
    }
    if (typeof resolver.resolve !== 'function') {
      throw new TypeError(`[magic-mark] resolver "${match.type}" is async-only; use \`resolveAsync\` / \`replaceAsync\`.`)
    }
    return resolver.resolve(match)
  }

  /**
   * Parse `text` and apply every resolver in one pass.
   *
   * - Escaped matches are emitted verbatim (their leading backslash is preserved).
   * - For non-escaped matches, the registered resolver's return value is used.
   * - If the resolver returns `undefined` (or the type is unknown and
   *   `unknownType === 'leave'`), the original raw token is kept.
   * - If `unknownType === 'remove'` and no resolver matches, the token is dropped.
   * - If `unknownType === 'throw'`, unknown types throw.
   *
   * @example
   * mark.replace('see {mark:foo:x}!')  // → 'see <x>!' (with fooResolver registered)
   */
  replace(text: string, options: MagicMarkReplaceOptions = {}): string {
    const policy = options.unknownType ?? this.unknownType
    const matches = this.parse(text)
    if (matches.length === 0)
      return text
    let out = ''
    let cursor = 0
    for (const match of matches) {
      out += text.slice(cursor, match.start)
      if (match.escaped) {
        out += match.raw
        cursor = match.end
        continue
      }
      const replacement = this.resolveInternal(match, policy)
      if (replacement === undefined) {
        if (policy !== 'remove')
          out += match.raw
      }
      else {
        out += replacement
      }
      cursor = match.end
    }
    out += text.slice(cursor)
    return out
  }

  /**
   * Async counterpart to {@link replace}. Runs every match through
   * `resolveAsync`; sync resolvers are awaited transparently.
   */
  async replaceAsync(text: string, options: MagicMarkReplaceOptions = {}): Promise<string> {
    const policy = options.unknownType ?? this.unknownType
    const matches = this.parse(text)
    if (matches.length === 0)
      return text
    const parts: string[] = []
    let cursor = 0
    for (const match of matches) {
      parts.push(text.slice(cursor, match.start))
      cursor = match.end
      if (match.escaped) {
        parts.push(match.raw)
        continue
      }
      const replacement = await this.resolveAsync(match, { unknownType: policy })
      if (replacement === undefined) {
        if (policy !== 'remove')
          parts.push(match.raw)
      }
      else {
        parts.push(replacement)
      }
    }
    parts.push(text.slice(cursor))
    return parts.join('')
  }
}

/** Factory. Accepts a string shorthand (changes `id`) or full config. */
export function createMagicMark(input?: MagicMarkInput): MagicMarkCore {
  if (typeof input === 'string') {
    return new MagicMarkCore({ id: input })
  }
  return new MagicMarkCore(input)
}
