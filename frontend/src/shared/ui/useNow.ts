import { useEffect, useState } from 'react'

/** 每秒滴答一次，用来跑掉线倒计时这类需要「会走」的时间。 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  return now
}

/** 秒数转「42 秒」/「1:05」。 */
export function formatLeft(iso: string | null, now: number): number | null {
  if (!iso) return null
  const left = new Date(iso).getTime() - now
  return left > 0 ? Math.ceil(left / 1000) : 0
}
