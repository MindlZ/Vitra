import { useState, type ReactNode } from 'react'
import { KeyRound, Loader2, LogIn, RefreshCw, Users, X } from 'lucide-react'
import type { Friend } from '@shared/types'
import { joinFriend, STATE_DOT, STATE_LABEL, STORE_LABEL, useFriends } from '../lib/friends'

interface Props {
  onClose: () => void
  onOpenSettings: () => void
}

function Avatar({ friend }: { friend: Friend }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className="relative shrink-0">
      {friend.avatar && !failed ? (
        <img
          src={friend.avatar}
          alt=""
          onError={() => setFailed(true)}
          className="h-8 w-8 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-[11px] font-medium text-dim">
          {friend.name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <span
        className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel ${STATE_DOT[friend.state]}`}
      />
    </div>
  )
}

function Row({ friend, mixed }: { friend: Friend; mixed: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-white/5">
      <Avatar friend={friend} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[12.5px] text-ink">{friend.name}</span>
          {mixed && <span className="shrink-0 text-[10.5px] text-muted">{STORE_LABEL[friend.store]}</span>}
        </div>
        <div
          className={`truncate text-[11px] ${friend.state === 'playing' ? 'text-accent' : 'text-muted'}`}
          title={friend.playing ?? STATE_LABEL[friend.state]}
        >
          {friend.playing ?? STATE_LABEL[friend.state]}
        </div>
      </div>
      {friend.joinable && <JoinButton friend={friend} />}
    </div>
  )
}

function JoinButton({ friend }: { friend: Friend }) {
  const [joining, setJoining] = useState(false)

  return (
    <button
      onClick={() => {
        setJoining(true)
        // Steam takes a few seconds to hand over
        void joinFriend(friend).finally(() => setTimeout(() => setJoining(false), 3000))
      }}
      disabled={joining}
      aria-label={`Join ${friend.name}`}
      title={friend.playing ? `Join in ${friend.playing}` : 'Join'}
      className="glass-btn flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] text-dim hover:text-ink"
    >
      {joining ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
      Join
    </button>
  )
}

function Empty({
  icon,
  title,
  body,
  action
}: {
  icon: ReactNode
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-5 py-10 text-center">
      <div className="text-muted">{icon}</div>
      <div className="text-[12.5px] text-dim">{title}</div>
      <p className="text-[11px] leading-relaxed text-muted">{body}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="glass-btn mt-1 h-8 rounded-[10px] px-3 text-[11.5px] text-dim hover:text-ink"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

export default function FriendsPanel({ onClose, onOpenSettings }: Props) {
  const { snapshot, refreshing, refresh } = useFriends()

  const inGame = snapshot?.friends.filter((friend) => friend.state === 'playing') ?? []
  const around = snapshot?.friends.filter((friend) => friend.state !== 'playing') ?? []
  const mixed = new Set(snapshot?.friends.map((friend) => friend.store)).size > 1

  return (
    <aside className="glass-chrome flex w-[262px] shrink-0 flex-col border-l border-white/6">
      <div className="hairline-b flex items-center gap-2 px-4 py-3.5">
        <Users className="h-4 w-4 text-muted" />
        <h2 className="font-display text-[16px] font-semibold text-ink [font-stretch:88%]">Friends</h2>
        {snapshot?.status === 'ok' && (
          <span className="text-[11px] tabular-nums text-muted">{snapshot.friends.length}</span>
        )}
        <button
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh friends"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/8 hover:text-ink disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={onClose}
          aria-label="Hide friends"
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/8 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!snapshot ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading
          </div>
        ) : snapshot.status === 'no-key' ? (
          <Empty
            icon={<KeyRound className="h-6 w-6" />}
            title="Not connected"
            body="Add a Steam or Xbox key"
            action={{ label: 'Open settings', onClick: onOpenSettings }}
          />
        ) : snapshot.status !== 'ok' ? (
          <Empty
            icon={<Users className="h-6 w-6" />}
            title="Couldn't load friends"
            body={snapshot.message ?? 'Something went wrong talking to Steam.'}
            action={{ label: 'Open settings', onClick: onOpenSettings }}
          />
        ) : !snapshot.friends.length ? (
          <Empty
            icon={<Users className="h-6 w-6" />}
            title="Nobody's around"
            body={
              snapshot.message ??
              (snapshot.offlineCount
                ? `All ${snapshot.offlineCount} of your friends are offline right now.`
                : 'No friends found on this account.')
            }
          />
        ) : (
          <>
            {/* one source failed, the other worked */}
            {snapshot.message && (
              <p className="px-2 pb-3 text-[11px] leading-relaxed text-muted">{snapshot.message}</p>
            )}
            {inGame.length > 0 && (
              <div className="mb-3">
                <div className="px-2 pb-1 text-[12px] font-medium text-muted">
                  In game
                </div>
                {inGame.map((friend) => (
                  <Row key={friend.id} friend={friend} mixed={mixed} />
                ))}
              </div>
            )}

            {around.length > 0 && (
              <div>
                <div className="px-2 pb-1 text-[12px] font-medium text-muted">
                  Online
                </div>
                {around.map((friend) => (
                  <Row key={friend.id} friend={friend} mixed={mixed} />
                ))}
              </div>
            )}

            {snapshot.offlineCount > 0 && (
              <div className="px-2 pt-3 pb-1 text-[11px] text-muted">
                {snapshot.offlineCount} offline
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
