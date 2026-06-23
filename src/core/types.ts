/**
 * Pair of delimiter characters wrapping a placeholder. Either:
 * - a 2-character string `'[]'` / `'{}'` / `'「」'` (shorthand, split as `[0]`/`[1]`), or
 * - an explicit `{ open, close }` object.
 *
 * Each individual character must be exactly one Unicode code point (so emoji
 * and other non-BMP characters are accepted — measured by code-point length,
 * not UTF-16 code units).
 */
export type MagicMarkBrackets = string | { open: string, close: string }

/** What to do with a placeholder whose `type` has no registered resolver. */
export type UnknownTypePolicy = 'leave' | 'remove' | 'throw'

/** Per-call options accepted by `resolve` / `resolveAsync` / `replace` / `replaceAsync`. */
export interface MagicMarkReplaceOptions {
  /** Overrides the constructor-level `unknownType` for this call. */
  unknownType?: UnknownTypePolicy
}

/** Input accepted by `createMagicMark`. */
export type MagicMarkInput = string | MagicMarkConfig

export interface MagicMarkConfig {
  /** Identifier of the placeholder family. Default: `'mark'`. */
  id?: string
  /**
   * Wrapping delimiters. Default `{ open: '{', close: '}' }`.
   * Pass a 2-char string `'[]'` for shorthand, or an object for explicit pairs.
   */
  brackets?: MagicMarkBrackets
  /** What to do with placeholders whose type has no resolver. Default `'leave'`. */
  unknownType?: UnknownTypePolicy
  /**
   * Registered resolvers. Each resolver maps a `{type}` to a replacement string.
   * A resolver may be either sync (`resolve`) or async (`resolveAsync`) — see
   * `MagicMarkResolver` and `MagicMarkAsyncResolver`. Sync and async resolvers
   * can be mixed freely; `replace()` will only invoke sync ones, `replaceAsync()`
   * will fall back to sync ones when an async handler is absent.
   */
  resolvers?: Array<MagicMarkResolver | MagicMarkAsyncResolver>
}

/** A raw placeholder match found in source text. */
export interface MagicMarkMatch {
  /** Placeholder identifier (first segment), e.g. `'mark'`. */
  id: string
  /** Type identifier (second segment), e.g. `'github'`. */
  type: string
  /** Split parameter list (third segment, comma-separated, decoded). */
  params: string[]
  /** Raw source text including brackets. If `escaped`, also includes leading backslash. */
  raw: string
  /** Start index in source (inclusive). For escaped matches, points at the leading `\`. */
  start: number
  /** End index in source (exclusive). Points just past the closing bracket. */
  end: number
  /** True if the match was written with a leading backslash (`\{...}`) — output raw verbatim. */
  escaped: boolean
}

/**
 * A user-defined **synchronous** resolver. Maps a match to a replacement string.
 *
 * Return `undefined` to keep the original raw token. Resolvers are deliberately
 * plain — there is no built-in concept of "link", "icon", "class names" or any
 * other business shape. Whatever the consumer wants to substitute (`<div>`,
 * `<a>`, markdown link, plain text, …) is up to them.
 */
export interface MagicMarkResolver {
  /** Identifier used in `{id:type:...}`. */
  readonly type: string
  /** Compute the replacement string for a match, or `undefined` to keep raw. */
  resolve: (match: MagicMarkMatch) => string | undefined
}

/**
 * A user-defined **asynchronous** resolver. Maps a match to a replacement string
 * that may need to be awaited (network fetch, IO, etc.).
 *
 * Use with `MagicMarkCore#resolveAsync` or `MagicMarkCore#replaceAsync`.
 * A registered sync resolver is silently used as a fallback by the async
 * methods, so you can mix handlers freely.
 */
export interface MagicMarkAsyncResolver {
  /** Identifier used in `{id:type:...}`. */
  readonly type: string
  /** Compute the replacement string, asynchronously. */
  resolveAsync: (match: MagicMarkMatch) => Promise<string | undefined>
}
