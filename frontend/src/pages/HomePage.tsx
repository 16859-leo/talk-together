import { Link } from 'react-router-dom'
import { DEMO_INVITE_PATH } from '../state/demo'

export default function HomePage() {
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

              <Link
                to={DEMO_INVITE_PATH}
                className="group inline-flex h-[54px] w-full items-center justify-center gap-2.5 rounded-[16px] border-[1.5px] border-[rgba(63,111,98,.34)] bg-[rgba(255,253,247,.52)] px-6 text-[15px] font-medium text-[#4a4135] transition-[transform,background-color,border-color] duration-300 ease-out hover:-translate-y-0.5 hover:border-[rgba(63,111,98,.5)] hover:bg-card active:translate-y-0 sm:w-auto sm:min-w-[232px]"
              >
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  className="h-[17px] w-[17px] text-[#557268]"
                >
                  <path
                    d="M1.8 10S4.7 4.8 10 4.8 18.2 10 18.2 10 15.3 15.2 10 15.2 1.8 10 1.8 10Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                用演示房间进去看看
              </Link>
            </div>

            <p className="hero-enter hero-enter--foot mt-4 text-[12px] text-muted">
              <Link to="/rooms/room_demo" className="underline decoration-[rgba(63,111,98,.35)] underline-offset-4">
                或者直接看房间页
              </Link>
            </p>
          </div>
        </main>

        <footer className="hero-enter hero-enter--foot pb-1 text-center text-[11.5px] leading-relaxed text-ink-2">
          V0.1 演示 · 后端未接时使用本地快照
        </footer>
      </div>
    </div>
  )
}
