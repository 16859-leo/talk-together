import type { TopicSuggestion } from './topicSuggestion'

interface TopicSuggestionBarProps {
  suggestion: TopicSuggestion
  onDismiss: () => void
}

/**
 * 输入框上方的话题建议条。
 *
 * 自动话题不进聊天记录，只在这里实时刷新：生成中跟着增量变长，
 * 完成后提示「冷场可以接这个」。用户收起后由父组件按 replyId 记住。
 */
export function TopicSuggestionBar({ suggestion, onDismiss }: TopicSuggestionBarProps) {
  return (
    <div
      aria-live="polite"
      className="mb-1 mt-2 flex items-start gap-2.5 rounded-[18px_14px_18px_14px] border border-dashed border-[rgba(95,165,147,.55)] bg-[rgba(124,185,168,.10)] px-3.5 py-2.5"
    >
      <span
        className={`mt-[7px] block h-2 w-2 shrink-0 rounded-full bg-sage-deep ${
          suggestion.streaming ? 'animate-pulse' : ''
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-semibold tracking-[.08em] text-[#3f6156]">
          {suggestion.streaming ? 'AI 在帮你想话题…' : 'AI 想到一个话题，冷场可以接这个'}
        </p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-[#314a43]">
          {suggestion.text}
          {suggestion.streaming && (
            <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-sage-deep align-[-2px]" />
          )}
        </p>
      </div>
      <button
        type="button"
        aria-label="收起话题建议"
        onClick={onDismiss}
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[14px] leading-none text-faint transition-colors hover:bg-[rgba(124,185,168,.18)] hover:text-ink-2"
      >
        ×
      </button>
    </div>
  )
}
