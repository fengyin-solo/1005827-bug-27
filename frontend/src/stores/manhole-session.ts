import { defineStore } from 'pinia'

import { ACTORS, actorByName, ownsSegment } from '@/data/manhole/segments'
import type { Actor } from '@/data/manhole/types'

// 检查井页面的当前身份：切换养护工即可复现「别的管段的人想顺手改」被退回；
// 值班管理员只能调整归属，不替养护工改井盖状况与井深。
export const useManholeSession = defineStore('manhole-session', {
  state: () => ({
    actorName: ACTORS[0].name,
  }),
  getters: {
    actor(state): Actor {
      return actorByName(state.actorName)
    },
    actorOptions: () => ACTORS.map((item) => item.name),
  },
  actions: {
    setActor(name: string) {
      this.actorName = name
    },
    canOwnSegment(segment: string): boolean {
      return ownsSegment(this.actor, segment)
    },
  },
})
