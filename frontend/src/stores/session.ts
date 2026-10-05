import { defineStore } from 'pinia'

import { crewById, MANHOLE_CREW, segmentNameOf, type CrewInfo } from '@/data/manhole-domain'

// 检查井责任域以「当前养护工」判定归属；默认以迎宾大道管段养护工身份进入，可在页面切换。
const DEFAULT_CREW = MANHOLE_CREW.find((crew) => crew.id === 'u01') ?? MANHOLE_CREW[0]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: DEFAULT_CREW.name,
    operatorId: DEFAULT_CREW.id,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市排水防涝泵站运行与内涝处置管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    currentCrew(): CrewInfo {
      return crewById(this.operatorId) ?? MANHOLE_CREW[0]
    },
    // 当前身份所属管段名（值班管理员返回空串，表示无管段、全局只读）。
    currentSegment(): string {
      const crew = this.currentCrew
      return crew.segmentCode ? segmentNameOf(crew.segmentCode) : ''
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(crewId: string) {
      const crew = crewById(crewId)
      if (!crew) {
        return
      }
      this.operatorId = crew.id
      this.operator = crew.name
    },
  },
})
