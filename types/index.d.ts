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
  /** The subagent or teammate it came from; absent for the main conversation. */
  agentId?: string
  /** That agent's name as shown when it was pinned, kept since the agent is gone in later sessions. */
  agentLabel?: string
}

/** A table or artifact link seen in a reply this session, one press away from being a pin. */
export type PinboardCandidate = {
  id: string
  kind: PinboardKind
  title: string
  body: string
  sourceUuid: string
  seenAt: number
  /** The subagent or teammate whose reply it was in; absent for the main conversation. */
  agentId?: string
  agentLabel?: string
}

export type PinboardFilter = 'all' | 'session' | 'project' | 'table' | 'artifact' | 'link'

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
