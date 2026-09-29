/**
 * Minimal parser for Valve KeyValues (.vdf / .acf) text files.
 * Handles nested blocks, quoted keys/values, // comments and escape sequences.
 * Good enough for libraryfolders.vdf and appmanifest_*.acf; it is not a full
 * implementation (no #include / conditionals).
 */
export type VdfNode = { [key: string]: string | VdfNode }

export function parseVdf(input: string): VdfNode {
  const root: VdfNode = {}
  const stack: VdfNode[] = [root]
  let i = 0
  const len = input.length

  const skipWhitespaceAndComments = (): void => {
    while (i < len) {
      const c = input[i]
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        i++
      } else if (c === '/' && input[i + 1] === '/') {
        while (i < len && input[i] !== '\n') i++
      } else {
        break
      }
    }
  }

  const readToken = (): string | null => {
    skipWhitespaceAndComments()
    if (i >= len) return null

    if (input[i] === '"') {
      i++
      let out = ''
      while (i < len && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < len) {
          const next = input[i + 1]
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next
          i += 2
        } else {
          out += input[i++]
        }
      }
      i++ // closing quote
      return out
    }

    if (input[i] === '{' || input[i] === '}') return input[i++]

    let out = ''
    while (i < len && !' \t\r\n{}"'.includes(input[i])) out += input[i++]
    return out.length ? out : null
  }

  let pendingKey: string | null = null
  for (;;) {
    const token = readToken()
    if (token === null) break

    if (token === '{') {
      const parent = stack[stack.length - 1]
      const child: VdfNode = {}
      if (pendingKey !== null) parent[pendingKey] = child
      stack.push(child)
      pendingKey = null
      continue
    }

    if (token === '}') {
      if (stack.length > 1) stack.pop()
      pendingKey = null
      continue
    }

    if (pendingKey === null) {
      pendingKey = token
    } else {
      stack[stack.length - 1][pendingKey] = token
      pendingKey = null
    }
  }

  return root
}

/** Case-insensitive child lookup — Valve is inconsistent about casing. */
export function pick(node: VdfNode | undefined, key: string): string | VdfNode | undefined {
  if (!node) return undefined
  if (key in node) return node[key]
  const lower = key.toLowerCase()
  for (const k of Object.keys(node)) {
    if (k.toLowerCase() === lower) return node[k]
  }
  return undefined
}

export function pickString(node: VdfNode | undefined, key: string): string | undefined {
  const value = pick(node, key)
  return typeof value === 'string' ? value : undefined
}

export function pickNode(node: VdfNode | undefined, key: string): VdfNode | undefined {
  const value = pick(node, key)
  return value && typeof value === 'object' ? value : undefined
}
