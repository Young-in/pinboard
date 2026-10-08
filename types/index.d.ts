export type PinboardKind = 'table' | 'artifact' | 'link' | 'text'

/** One saved item. Kept in `$.store` across sessions. */
export type PinboardPin = {
  id: string
  createdAt: number
  sessionId: string
  cwd: string
  kind: PinboardKind
  title: string
  body: string
  sourceUuid?: string
}

/** A table or artifact link seen in a reply this session, one press away from being a pin. */
export type PinboardCandidate = {
  id: string
  kind: PinboardKind
  title: string
  body: string
  sourceUuid: string
  seenAt: number
}

export type PinboardFilter = 'all' | 'table' | 'artifact' | 'link' | 'project'

declare module 'claude-code' {
  interface PluginState {
    pinboard: {
      pins: PinboardPin[]
      selectedId: string | null
      filter: PinboardFilter
      candidates: PinboardCandidate[]
      lastRemoved: PinboardPin | null
      confirmDeleteId: string | null
      /** True once the person closed the pane this session: no unasked reopen until they open it again. */
      autoOpenSuppressed: boolean
    }
  }
}
