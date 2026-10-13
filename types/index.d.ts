export type IssueStatus = 'open' | 'in_progress' | 'in_review' | 'done' | 'wont_fix' | 'closed'

export type TuixProject = { id: string; name: string; workspace: string }

export type TuixIssue = {
  id: string
  number: number
  reference: string
  title: string
  body: string
  status: IssueStatus
  type: string | null
  severity: string | null
  route: string | null
  environment: string | null
  author: string | null
  updatedAt: string
  appUrl: string | null
}

// A box in CSS pixels, a size, and a point: the element on the page, the browser window, the scroll offset.
export type TuixBox = { x: number; y: number; width: number; height: number }
export type TuixSize = { width: number; height: number }
export type TuixPoint = { x: number; y: number }

// One comment of a report. The author may be unknown.
export type TuixComment = { id: string; author: string | null; body: string; at: string }

export type TuixPage = {
  url: string | null
  title: string | null
  route: string | null
  environment: string | null
  release: string | null
  widgetVersion: string | null
}

export type TuixElement = {
  testid: string | null
  css: string | null
  section: string | null
  tag: string | null
  role: string | null
  name: string | null
  text: string | null
  box: TuixBox | null
  viewport: TuixSize | null
  scroll: TuixPoint | null
}

export type TuixBrowser = {
  userAgent: string | null
  language: string | null
  timezone: string | null
  viewport: TuixSize | null
  pixelRatio: number | null
}

export type TuixConsoleEntry = { level: string; message: string }

export type TuixNetworkEntry = { method: string; status: number | null; ms: number | null; url: string }

// A screenshot without its URL: the signed URL lives five minutes, so the pane asks for a new one on a press.
export type TuixScreenshot = {
  id: string
  kind: 'original' | 'review' | 'other'
  width: number | null
  height: number | null
  bytes: number | null
  at: string
}

// One entry of the history of an issue, as one sentence.
export type TuixActivity = { at: string; text: string }

export type TuixWorkflow = {
  assignee: string | null
  history: TuixActivity[]
  hasMoreHistory: boolean
}

// The context of a report. A section the server did not send is null.
export type TuixContext = {
  page: TuixPage | null
  element: TuixElement | null
  browser: TuixBrowser | null
  console: TuixConsoleEntry[] | null
  network: TuixNetworkEntry[] | null
  // Whether the connection may read the console and network logs; null when the server does not say.
  diagnosticsIncluded: boolean | null
  screenshots: TuixScreenshot[] | null
  workflow: TuixWorkflow | null
}

// What get_issue answers. The context is null for a connection that has report text only.
export type TuixDetail = {
  issue: TuixIssue
  comments: TuixComment[]
  commentsCursor: string | null
  context: TuixContext | null
  // True when the full answer was too large and console, network and browser were left out.
  isNarrowed: boolean
}

export type TuixReport = {
  phase: 'loading' | 'ready' | 'error' | 'too-large'
  // The last report that was read. It stays on screen while the pane reads again.
  detail?: TuixDetail
  message?: string
  // Set when the failure is one of the states of the Setup view.
  problem?: Problem
  server?: string
  isLoadingComments?: boolean
  commentsMessage?: string
}

// The fresh link of one screenshot. `at` is the time (ms) the mod received it.
export type TuixShotLink =
  | { phase: 'loading' }
  | { phase: 'ready'; href: string | null; text: string; at: number }
  | { phase: 'error'; message: string }

// The Setup state that a failed call asks for.
export type Problem = 'no-server' | 'sign-in' | 'not-allowed' | 'no-verdict'

export type TuixLoad = {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  message?: string
  // Set when the failure is one of the states of the Setup view.
  problem?: Problem
  // The server that failed, when one did.
  server?: string
}

// What $.tool.check answered for one tool.
export type TuixVerdict = { decision: 'allow' | 'ask' | 'deny'; rule?: string }

// The verdicts of the read tools of one server, by tool name without the prefix.
export type TuixAccess = { server: string; tools: Record<string, TuixVerdict> }

// Where the definition of a server came from (mcp_server.source), for one server.
export type TuixSource = { server: string; source: string }

declare module 'claude-code' {
  interface PluginState {
    tuix: {
      projects: TuixProject[]
      project: TuixProject | null
      isPicking: boolean
      filter: IssueStatus
      issues: TuixIssue[]
      cursor: string | null
      pages: number
      selected: string | null
      // The full reports read in this session, by issue ID, and the fresh screenshot links, by screenshot ID.
      reports: Record<string, TuixReport>
      shots: Record<string, TuixShotLink>
      load: TuixLoad
      described: string[]
      engine: string | null
      access: TuixAccess | null
      provenance: TuixSource | null
      isDiagnosing: boolean
      note: string | null
      lastError: string | null
    }
  }
}
