import { create } from 'zustand'

interface State {
  cursor: number
  scheduled: boolean
  setCursor: (cursor: number) => void
  setScheduled: (scheduled: boolean) => void
}

export const useMonitorState = create<State>((set) => ({
  cursor: 0,
  scheduled: false,
  setCursor: (cursor) => set({ cursor }),
  setScheduled: (scheduled) => set({ scheduled }),
}))
