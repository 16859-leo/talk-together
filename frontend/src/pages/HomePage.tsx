import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    <div className="page-bg paper grid min-h-screen place-items-center px-6">
      <div className="relative z-10 w-full max-w-[520px] rounded-[36px] border-[1.5px] border-rule bg-paper px-9 py-10 text-center shadow-[0_30px_60px_-34px_rgba(92,64,51,.45)]">
        <div className="mb-3 flex items-center justify-center gap-2.5 text-[22px] font-bold tracking-wide">
          <span className="h-4 w-4 rounded-full bg-sage" />
          搭个话
        </div>
        <p className="text-[13.5px] leading-relaxed text-ink-2">
          真人房主主持、AI 帮忙接话的破冰聊天室。
          <br />
          最多五个人，坐下就能聊。
        </p>
        <div className="mt-7 flex flex-col gap-2.5">
          <Link
            to="/join/room_demo"
            className="rounded-2xl bg-sage-deep px-6 py-3 text-[14px] font-semibold text-white shadow-soft transition-colors hover:bg-[#549c8b]"
          >
            用演示房间进去看看
          </Link>
          <Link
            to="/rooms/room_demo"
            className="rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] px-6 py-3 text-[13.5px] text-ink-2 transition-colors hover:bg-card"
          >
            直接看房间页（房主视角）
          </Link>
        </div>
        <p className="mt-6 text-[11.5px] text-muted">V0.1 演示 · 后端未接时使用本地快照</p>
      </div>
    </div>
  )
}
