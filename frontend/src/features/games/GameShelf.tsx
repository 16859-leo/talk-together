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
 */
export function GameShelf({ active, disabled, onStart, onNext, onStop }: GameShelfProps) {
  const current = active === null ? null : findGame(active.gameId)

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[16px] font-bold">游戏</h2>
        <span className="rounded-full border border-rule px-2.5 py-0.5 text-[11.5px] text-muted">
          房主可开
        </span>
      </div>

      {current === null ? (
        <div className="space-y-1.5">
          {GAMES.map((game) => (
            <button
              key={game.id}
              type="button"
              disabled={disabled}
              onClick={() => onStart(game)}
              className="flex w-full items-start gap-2.5 rounded-2xl border border-rule bg-card px-3 py-2 text-left transition-colors hover:border-[rgba(96,166,150,.6)] hover:bg-[rgba(124,185,168,.12)] disabled:opacity-50"
            >
              <span className="text-[17px] leading-6">{game.emoji}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink-2">{game.name}</span>
                <span className="block text-[11.5px] leading-relaxed text-muted">{game.tagline}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
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
              {current.id === 'story-relay' ? '下一句' : '下一题'}
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
    </div>
  )
}
