import { useState } from 'react'
import { GAMES, findGame, type ActiveGame, type GameDefinition } from './catalog'

interface GameShelfProps {
  active: ActiveGame | null
  /** 发送中或房间已关闭时禁用 */
  disabled: boolean
  onStart: (game: GameDefinition) => void
  onNext: (game: GameDefinition) => void
  onStop: (game: GameDefinition) => void
}

/**
 * 房主的游戏架。
 *
 * 只对房主渲染（父组件用 canMention 控制）：按钮不是装饰，点下去就是一条
 * 房主 @AI 的发言，后端据此推进游戏轮次。成员看不到这组按钮。
 *
 * 默认收起：六个游戏铺开会把右侧栏占满，盖过房间和成员信息。
 * 点标题展开选游戏；选中后自动收起，只留一张紧凑的「进行中」卡片（下一轮/结束）。
 */
export function GameShelf({ active, disabled, onStart, onNext, onStop }: GameShelfProps) {
  const [expanded, setExpanded] = useState(false)
  const current = active === null ? null : findGame(active.gameId)
  const listId = 'game-shelf-list'

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((open) => !open)}
        className="mb-2 flex w-full items-baseline justify-between rounded-lg px-0.5 py-1 text-left transition-opacity hover:opacity-75"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-[16px] font-bold">游戏</span>
          <span className="text-[11.5px] text-muted">
            {GAMES.length} 个 · 房主可开
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`text-[12px] leading-none text-muted transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        >
          ⌄
        </span>
      </button>

      {current !== null && (
        <div className="rounded-2xl border border-[rgba(124,185,168,.4)] bg-[rgba(124,185,168,.10)] px-3 py-2.5">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-[#3f6156]">
            <span className="text-[15px]">{current.emoji}</span>
            {current.name}
            <span className="text-[11.5px] font-normal text-muted">进行中</span>
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onNext(current)}
              className="flex-1 rounded-xl bg-sage-deep px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#549c8b] disabled:opacity-50"
            >
              {current.nextLabel}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onStop(current)}
              className="rounded-xl border border-rule px-2.5 py-1.5 text-[12px] text-ink-2 transition-colors hover:bg-[rgba(124,185,168,.12)] disabled:opacity-50"
            >
              结束
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div id={listId} className="mt-2 space-y-1.5">
          {current !== null && (
            <p className="px-0.5 text-[11px] text-faint">换一个游戏会结束当前这局</p>
          )}
          {GAMES.map((game) => {
            const isActive = current?.id === game.id
            return (
              <button
                key={game.id}
                type="button"
                disabled={disabled}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => {
                  setExpanded(false)
                  onStart(game)
                }}
                className={`flex w-full items-start gap-2.5 rounded-2xl border px-3 py-1.5 text-left transition-colors disabled:opacity-50 ${
                  isActive
                    ? 'border-[rgba(96,166,150,.7)] bg-[rgba(124,185,168,.18)]'
                    : 'border-rule bg-card hover:border-[rgba(96,166,150,.6)] hover:bg-[rgba(124,185,168,.12)]'
                }`}
              >
                <span className="text-[16px] leading-6">{game.emoji}</span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold text-ink-2">{game.name}</span>
                  <span className="block text-[11px] leading-relaxed text-muted">{game.tagline}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
