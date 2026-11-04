import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { parseInviteLink } from '../features/join/inviteLink'

export default function HomePage() {
  const navigate = useNavigate()
  const [invite, setInvite] = useState('')
  const [error, setError] = useState<string | null>(null)

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = parseInviteLink(invite, window.location.origin)
    if (!target) {
      setError('链接不完整，让房主重新发一次')
      return
    }
    setError(null)
    navigate(target)
  }

  return (
    <div className="page-bg paper relative min-h-screen min-h-[100svh] overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="hero-glow" />
        <span className="hero-blob hero-blob--sand" />
        <span className="hero-blob hero-blob--sky" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen min-h-[100svh] w-full max-w-[1440px] flex-col px-5 py-6 sm:px-8 lg:px-12">
        <main className="flex flex-1 flex-col items-center justify-center py-10 sm:py-14">
          <div className="hero-stage w-full text-center">
            <h1 className="hero-title">
              <span className="hero-line">
                <span>talk</span>
              </span>
              <span className="hero-line">
                <span>
                  <span className="hero-accent">
                    together
                    <svg
                      viewBox="0 0 220 12"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      className="absolute -bottom-[0.1em] left-0 h-[0.14em] w-full overflow-visible"
                    >
                      <path
                        d="M3 8 C 46 3, 90 10, 132 6 S 196 3, 217 7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        opacity="0.45"
                      />
                    </svg>
                  </span>
                </span>
              </span>
            </h1>

            <p className="hero-enter hero-enter--desc mx-auto mt-6 max-w-[35rem] text-[16px] leading-[1.85] text-ink-2 text-pretty sm:mt-7 sm:text-[18px]">
              真人房主主持、AI 帮忙接话的破冰聊天室。
              <br />
              最多五个人，围一桌，慢慢聊开。
            </p>

            <div className="hero-enter hero-enter--cta mt-8 flex flex-col items-center justify-center gap-3 sm:mt-10 sm:flex-row">
              <Link
                to="/create"
                className="group inline-flex h-[54px] w-full items-center justify-center gap-2.5 rounded-[16px] bg-[#3f7f70] px-6 text-[15px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(63,111,98,.8)] transition-[transform,background-color,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:bg-[#356f62] hover:shadow-[0_18px_32px_-16px_rgba(63,111,98,.75)] active:translate-y-0 sm:w-auto sm:min-w-[218px]"
              >
                开一个房间
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  className="h-[17px] w-[17px] transition-transform duration-300 ease-out group-hover:translate-x-1"
                >
                  <path
                    d="M3.5 10h12M11 5.5l4.5 4.5L11 14.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            </div>

            <form
              onSubmit={join}
              className="hero-enter hero-enter--foot mx-auto mt-7 w-full max-w-[430px] text-left"
            >
              <label
                htmlFor="invite-link"
                className="flex items-baseline gap-1.5 text-[12.5px] text-muted"
              >
                <b className="text-[13px] font-semibold text-ink">已经收到邀请？</b>
                <span>粘贴房主发你的链接</span>
              </label>
              <div className="mt-2 flex items-center gap-2 rounded-[16px] border-[1.5px] border-rule bg-card py-1.5 pl-3.5 pr-1.5 transition-shadow focus-within:border-[rgba(96,166,150,.7)] focus-within:shadow-[0_0_0_4px_rgba(124,185,168,.14)]">
                <input
                  id="invite-link"
                  value={invite}
                  onChange={(event) => {
                    setInvite(event.target.value)
                    if (error) setError(null)
                  }}
                  placeholder="http://…/join/room_xxx?inviteCode=…"
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-[13.5px] text-ink-2 outline-none placeholder:text-faint"
                />
                <button
                  type="submit"
                  disabled={invite.trim().length === 0}
                  className="rounded-[12px] bg-sage-deep px-5 py-2 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-[#549c8b] disabled:opacity-50"
                >
                  加入
                </button>
              </div>
              {error !== null && <p className="mt-1.5 text-[11.5px] text-brick">{error}</p>}
            </form>
          </div>
        </main>

        <footer className="hero-enter hero-enter--foot pb-1 text-center text-[11.5px] leading-relaxed text-ink-2">
          V0.1 · 邀请制，一桌最多五人
        </footer>
      </div>
    </div>
  )
}
