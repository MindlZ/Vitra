/**
 * Parser for Valve's *binary* KeyValues, used by shortcuts.vdf.
 *
 * Layout is a tag byte, a NUL-terminated key, then a value whose shape depends
 * on the tag:
 *   0x00  nested map, terminated by 0x08
 *   0x01  NUL-terminated string
 *   0x02  int32, little endian
 *   0x08  end of the current map
 * Types we don't need (float, pointer, wide string, int64) are skipped safely
 * rather than guessed at.
 */
export type BinaryVdfValue = string | number | BinaryVdfNode
export interface BinaryVdfNode {
  [key: string]: BinaryVdfValue
}

const TYPE_MAP = 0x00
const TYPE_STRING = 0x01
const TYPE_INT32 = 0x02
const TYPE_FLOAT = 0x03
const TYPE_POINTER = 0x04
const TYPE_WIDE_STRING = 0x05
const TYPE_COLOR = 0x06
const TYPE_UINT64 = 0x07
const TYPE_END = 0x08
const TYPE_INT64 = 0x0a

export function parseBinaryVdf(buffer: Buffer): BinaryVdfNode {
  let offset = 0

  const readCString = (): string => {
    const end = buffer.indexOf(0, offset)
    if (end === -1) {
      const rest = buffer.toString('utf8', offset)
      offset = buffer.length
      return rest
    }
    const value = buffer.toString('utf8', offset, end)
    offset = end + 1
    return value
  }

  const readMap = (): BinaryVdfNode => {
    const node: BinaryVdfNode = {}

    while (offset < buffer.length) {
      const type = buffer[offset++]
      if (type === TYPE_END) break

      const key = readCString()

      switch (type) {
        case TYPE_MAP:
          node[key] = readMap()
          break
        case TYPE_STRING:
        case TYPE_WIDE_STRING:
          node[key] = readCString()
          break
        case TYPE_INT32:
        case TYPE_COLOR:
        case TYPE_POINTER:
          node[key] = buffer.readInt32LE(offset)
          offset += 4
          break
        case TYPE_FLOAT:
          node[key] = buffer.readFloatLE(offset)
          offset += 4
          break
        case TYPE_UINT64:
        case TYPE_INT64:
          // Playtime stamps we don't use; skip without losing alignment.
          offset += 8
          break
        default:
          // Unknown tag — we can no longer trust the offsets, so stop here.
          return node
      }
    }

    return node
  }

  return readMap()
}

/** Case-insensitive lookup; Steam has changed the casing of these keys over time. */
export function pickBinary(node: BinaryVdfNode, key: string): BinaryVdfValue | undefined {
  if (key in node) return node[key]
  const lower = key.toLowerCase()
  for (const candidate of Object.keys(node)) {
    if (candidate.toLowerCase() === lower) return node[candidate]
  }
  return undefined
}

export function binaryString(node: BinaryVdfNode, key: string): string | undefined {
  const value = pickBinary(node, key)
  return typeof value === 'string' ? value : undefined
}

export function binaryNumber(node: BinaryVdfNode, key: string): number | undefined {
  const value = pickBinary(node, key)
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value)
  return undefined
}
