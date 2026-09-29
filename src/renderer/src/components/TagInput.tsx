import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'

interface Props {
  tags: string[]
  suggestions: string[]
  onChange: (tags: string[]) => void
}

export default function TagInput({ tags, suggestions, onChange }: Props) {
  const [draft, setDraft] = useState('')

  const available = useMemo(
    () =>
      suggestions
        .filter((tag) => !tags.includes(tag))
        .filter((tag) => tag.toLowerCase().includes(draft.toLowerCase().trim()))
        .slice(0, 6),
    [suggestions, tags, draft]
  )

  const add = (value: string): void => {
    const tag = value.trim()
    if (!tag || tags.includes(tag)) {
      setDraft('')
      return
    }
    onChange([...tags, tag])
    setDraft('')
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="glass-soft flex h-7 items-center gap-1 rounded-full pr-1.5 pl-3 text-[12px] text-dim"
          >
            {tag}
            <button
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              aria-label={`Remove tag ${tag}`}
              className="rounded-full p-0.5 text-muted transition-colors hover:bg-white/10 hover:text-danger"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              add(draft)
            } else if (event.key === 'Backspace' && !draft && tags.length) {
              onChange(tags.slice(0, -1))
            }
          }}
          placeholder="Add tag"
          spellCheck={false}
          className="h-7 w-[112px] rounded-full border border-dashed border-white/12 bg-transparent px-3 text-[12px] text-ink transition-colors placeholder:text-muted focus:border-accent/50 focus:border-solid focus:outline-none"
        />
      </div>

      {available.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {available.map((tag) => (
            <button
              key={tag}
              onClick={() => add(tag)}
              className="flex h-7 items-center gap-1.5 rounded-full border border-white/8 px-2.5 text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-ink"
            >
              <Plus className="h-2.5 w-2.5" />
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
