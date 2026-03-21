export interface Heartbeat {
  alive: boolean
  balance: number
  burnRate: number
  earnRate: number
  netRate: number
  ttd: number
  uptime: number
  activity: string
  currentTaskId: string | null
  tasksCompleted: number
  tickCount: number
  mood?: string
}

export interface OrganismData {
  id: string
  status: string
  activity: string
  balance: number
  totalEarned: number
  totalSpent: number
  tasksCompleted: number
  tasksFailed: number
  tokensUsed: number
  bornAt: number
  diedAt: number | null
  identity: { publicKey: string; fingerprint: string; createdAt: number }
  metabolism: { efficiency: number }
  tee: { teeMode: boolean; instanceId: string }
  research: { enabled: boolean }
  nft: { enabled: boolean; wallet: string; chain: string }
  llm: { provider: string; model: string }
}

export interface Task {
  id: string
  type: string
  input: string
  reward: number
  status: string
  result: string | null
  attestation: string | null
  submittedAt: number
  completedAt: number | null
  tokensUsed: number
  costIncurred: number
  sources: string[]
}

export interface Doodle {
  title: string
  description: string
  filename: string
  timestamp: number
  attestation: string
  pushedToGithub: boolean
}

export interface EarningsEntry {
  id: string
  type: string
  amount: number
  balance: number
  description: string
  timestamp: number
}
