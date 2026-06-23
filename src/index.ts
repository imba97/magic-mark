import { createMagicMark, MagicMarkCore } from './core/magic-mark'

export { createMagicMark, MagicMarkCore }
export type {
  MagicMarkAsyncResolver,
  MagicMarkBrackets,
  MagicMarkConfig,
  MagicMarkInput,
  MagicMarkMatch,
  MagicMarkReplaceOptions,
  MagicMarkResolver,
  UnknownTypePolicy,
} from './core/types'

export default createMagicMark
