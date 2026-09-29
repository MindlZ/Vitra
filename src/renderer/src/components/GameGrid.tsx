import type { Game, RunningState } from '@shared/types'
import GameCard from './GameCard'

interface Props {
  games: Game[]
  running: RunningState[]
  onOpen: (game: Game) => void
  onPlay: (game: Game) => void
  onToggleFavorite: (game: Game) => void
}

export default function GameGrid({ games, running, onOpen, onPlay, onToggleFavorite }: Props) {
  const runningIds = new Set(running.map((r) => r.gameId))

  return (
    // Each card carries its own reflection in layout, so the row gap is small.
    <div className="vitra-grid grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-5 gap-y-4 px-8 pt-10 pb-12">
      {games.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          running={runningIds.has(game.id)}
          onOpen={() => onOpen(game)}
          onPlay={() => onPlay(game)}
          onToggleFavorite={() => onToggleFavorite(game)}
        />
      ))}
    </div>
  )
}
