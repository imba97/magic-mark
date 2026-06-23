/**
 * Build a RegExp matching the NORMAL form `{id:type:payload}` where id/open/close
 * come from config.
 *
 * Payload grammar (per char):
 *   - `\X` where X ∈ { `\`, open, close, ',' }  → matched as one literal X (escape sequence)
 *   - any char except the open and close        → matched as a literal
 *
 * Excluding the open bracket from the literal alternative is what stops the
 * payload from greedily consuming a nested LIVE placeholder — otherwise
 * `\{mark:a:x\} {mark:b:y}` would have the first token eat the second.
 * The escaped form `\{...\}` is matched separately by `buildEscapedPattern` —
 * regex engines can't cleanly express both shapes in one pattern because the
 * escaped form's `\}` looks like the close bracket to the payload pattern.
 *
 * The `u` flag lets the pattern treat non-BMP characters (emoji, etc.) as
 * single code points when used as delimiters.
 *
 * Examples:
 *   buildPattern({ id: 'mark', open: '{', close: '}' })
 *     → /\{(mark):([\w-]+):((?:\\\{|\\[\\},]|[^{}])*)\}/gu
 */
export function buildPattern(config: { id: string, open: string, close: string }): RegExp {
  const id = escapeRegex(config.id)
  const open = escapeRegex(config.open)
  const close = escapeRegex(config.close)
  return new RegExp(`${open}(${id}):([\\w-]+):((?:\\\\${open}|\\\\[\\\\${close},]|[^${open}${close}])*)${close}`, 'gu')
}

/**
 * Build a RegExp matching the ESCAPED form `\{anything\}` as a literal token.
 *
 * Non-greedy: stops at the first `\}` after the opening `\{`. The parse layer
 * tags these matches with `escaped: true` so they pass through verbatim.
 *
 * Example:
 *   buildEscapedPattern({ open: '{', close: '}' })
 *     → /\\{(?:\\.|[^\\}])*?\\}/gu
 */
export function buildEscapedPattern(config: { open: string, close: string }): RegExp {
  const open = escapeRegex(config.open)
  const close = escapeRegex(config.close)
  return new RegExp(`\\\\${open}(?:\\\\.|[^\\\\${close}])*?\\\\${close}`, 'gu')
}

/**
 * Split a payload into params, decoding the recognized escape sequences.
 *
 * Escape grammar (each two-character source sequence produces ONE output char):
 *   - `\,` → `,`
 *   - `\\` → `\`
 *   - `\<open>`  → literal `<open>`  (so `{mark:foo:\{x\}}` → `params: ['{x}']`)
 *   - `\<close>` → literal `<close>`
 *
 * Anything else after a backslash is left untouched (the backslash is kept),
 * which keeps raw bytes intact for the consumer to interpret if needed.
 *
 * Whitespace around each param is trimmed. An empty payload yields `[]`
 * (rather than `['']`) so callers can branch on `params.length`.
 */
export function splitParams(payload: string, open: string, close: string): string[] {
  if (payload.length === 0)
    return []
  const out: string[] = []
  let buf = ''
  for (let i = 0; i < payload.length; i++) {
    const ch = payload[i]
    if (ch === '\\' && i + 1 < payload.length) {
      const next = payload[i + 1]!
      if (next === ',' || next === '\\' || next === open || next === close) {
        buf += next
        i++
        continue
      }
    }
    if (ch === ',') {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  out.push(buf)
  return out.map(item => item.trim())
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
