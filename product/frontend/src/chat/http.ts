import { CHAT_FETCH_TIMEOUT_MS } from './prompts'

export async function fetchWithDeadline(url, options: RequestInit = {}, timeoutMs = CHAT_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}
