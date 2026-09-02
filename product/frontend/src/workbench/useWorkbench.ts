import { useSyncExternalStore } from 'react'
import { getRev, subscribe, state } from './state'

export function useWorkbench() {
  const rev = useSyncExternalStore(subscribe, getRev, getRev)
  return { rev, state }
}
