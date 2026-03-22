import React, { useState, useEffect } from 'react'
import { useHeartbeat, useOrganism, useTasks, useDoodles, useMonologue, submitTask } from './hooks/useOrganism'
import type { Heartbeat, Task, Doodle } from './types'
import type { MonologueEntry } from './hooks/useOrganism'

const API = ''

type View = 'brain' | 'gallery' | 'tasks' | 'chain' | 'verify'

export default function App() {
  const [view, setView] = useState<View>('brain')
  const hb = useHeartbeat()
  const org = useOrganism()
  const { tasks, refresh } = useTasks()
  const { doodles, totalCreated } = useDoodles()
  const monologue = useMonologue()
  const alive = hb?.alive ?? true
  const balance = hb?.balance ?? 100
  const [strkBalance, setStrkBalance] = useState('0')
  const [ethBalance, setEthBalance] = useState('0')
  const [strkPrice, setStrkPrice] = useState(0.036)
  const [ethPrice, setEthPrice] = useState(2080)
  const [showIdentity, setShowIdentity] = useState(false)
  useEffect(() => {
    const poll = () => {
      fetch(`${API}/api/wallet`).then(r => r.json()).then(d => {
        setStrkBalance(d.strk || '0')
        setEthBalance(d.eth || '0')
      }).catch(() => {})
    }
    // Fetch prices
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=starknet,ethereum&vs_currencies=usd')
      .then(r => r.json()).then(d => { setStrkPrice(d.starknet?.usd || 0.036); setEthPrice(d.ethereum?.usd || 2080); }).catch(() => {})
    poll(); const i = setInterval(poll, 15000); return () => clearInterval(i)
  }, [])

  const orbClass = !alive ? 'orb dead' : (hb?.activity === 'working' || hb?.activity === 'self-work')
    ? (balance < 10 ? 'orb working crit' : balance < 30 ? 'orb working warn' : 'orb working')
    : (balance < 10 ? 'orb crit' : balance < 30 ? 'orb warn' : 'orb')

  const navItems: { id: View; icon: string; label: string }[] = [
    { id: 'brain', icon: '', label: 'Brain' },
    { id: 'gallery', icon: '', label: 'Gallery' },
    { id: 'tasks', icon: '', label: 'Tasks' },
    { id: 'chain', icon: '', label: 'On-Chain' },
    { id: 'verify', icon: '', label: 'Verify' },
  ]

  return (
    <div className="h-screen flex bg-bg font-body text-text">
      {/* ── Left sidebar (dark) ── */}
      <div className="w-[220px] bg-sidebar flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className={orbClass} />
            <div>
              <div className="text-[16px] font-bold text-white tracking-tight font-display italic">bob</div>
              <div className="text-[10px] text-sidebar-text font-mono">{alive ? 'alive' : 'dead'} · {Math.floor((hb?.uptime ?? 0) / 60)}m</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {navItems.map(n => (
            <button key={n.id} onClick={() => setView(n.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-display font-semibold transition-all ${view === n.id ? 'bg-sidebar-hover text-sidebar-active' : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-active'}`}>
              <span>{n.label}</span>
              {n.id === 'gallery' && totalCreated > 0 && <span className="ml-auto text-[10px] font-mono text-green bg-green/10 px-1.5 py-0.5 rounded">{totalCreated}</span>}
              {n.id === 'tasks' && tasks.filter(t => t.status === 'completed').length > 0 && <span className="ml-auto text-[10px] font-mono text-blue bg-blue/10 px-1.5 py-0.5 rounded">{tasks.filter(t => t.status === 'completed').length}</span>}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/5">
          <div className="text-[9px] font-mono text-sidebar-text space-y-1">
            <div className="flex justify-between"><span>TEE</span><a href="https://verify-sepolia.eigencloud.xyz/app/0xeE4d468A50E1B693CC34C96c9518Ee5cB7920E7F" target="_blank" rel="noopener noreferrer" className="text-green hover:underline">EigenCompute</a></div>
            <div className="flex justify-between"><span>LLM</span><span>{org?.llm?.model ?? '?'}</span></div>
            <div className="flex justify-between"><span>ID</span><span>{org?.identity?.fingerprint?.slice(0, 10) ?? '--'}</span></div>
            <div className="flex justify-between"><span>Provenance</span><span className="text-green">Verified</span></div>
          </div>
          <a href="https://github.com/owizdom/bobIsAlive" target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-2 text-[11px] text-sidebar-text hover:text-white transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            GitHub
          </a>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Identity bar */}
        <div className="border-b-2 border-text/10 flex items-center justify-between px-6 py-3 bg-surface shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-[28px] font-display font-bold italic tracking-tight text-text">bob</h1>
            <a href={`https://sepolia.voyager.online/contract/${org?.nft?.wallet || ''}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-bg-alt hover:border-text/30 transition-colors">
              <span className="text-[12px] font-mono text-text-3">{org?.nft?.wallet ? `${org.nft.wallet.slice(0, 6)}...${org.nft.wallet.slice(-4)}` : '—'}</span>
              <span className="text-[10px] text-text-4">Starknet</span>
            </a>
            <button onClick={() => setShowIdentity(!showIdentity)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-bg-alt hover:border-text/30 transition-colors">
              <span className="text-[13px] font-accent italic text-text">Who am I?</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full ${alive ? (hb?.activity === 'working' ? 'bg-blue-bg text-blue' : hb?.mood === 'critical' ? 'bg-red-bg text-red' : hb?.mood === 'anxious' ? 'bg-amber-bg text-amber' : 'bg-green-bg text-green') : 'bg-red-bg text-red'}`}>
              {alive ? (hb?.activity === 'reading' ? 'Reading' : hb?.activity === 'contemplating' ? 'Thinking' : hb?.activity === 'self-work' ? 'Creating' : hb?.activity === 'working' ? 'Working' : hb?.mood === 'critical' ? 'CRITICAL' : hb?.mood === 'anxious' ? 'Anxious' : hb?.mood === 'cautious' ? 'Focused' : 'Online') : 'Deceased'}
            </span>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green/20 bg-green-bg">
              <span className="text-[14px] font-mono font-bold text-green">${(parseFloat(strkBalance) * strkPrice + parseFloat(ethBalance) * ethPrice).toFixed(2)}</span>
              <span className="text-[10px] text-green/70">earned</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-bg-alt">
              <span className="text-[12px] font-mono font-semibold text-text">{balance.toFixed(1)}</span>
              <span className="text-[10px] text-text-4">credits</span>
            </div>
            <a href="https://verify-sepolia.eigencloud.xyz/app/0xeE4d468A50E1B693CC34C96c9518Ee5cB7920E7F" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-bg-alt hover:border-blue/30 transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
              <span className="text-[11px] font-semibold text-text">Verify</span>
            </a>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-bg-alt">
          {view === 'brain' && <BrainView hb={hb} monologue={monologue} />}
          {view === 'gallery' && <GalleryView doodles={doodles} />}
          {view === 'tasks' && <TasksView tasks={tasks} alive={alive} onRefresh={refresh} />}
          {view === 'chain' && <ChainView strkBalance={strkBalance} />}
          {view === 'verify' && <VerifyView />}
        </div>
      </div>

      {/* Identity modal */}
      {showIdentity && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowIdentity(false)}>
          <div className="bg-surface rounded-2xl shadow-2xl w-[560px] max-w-[92vw] max-h-[85vh] overflow-y-auto border border-border" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="relative px-8 pt-8 pb-6">
              <button onClick={() => setShowIdentity(false)} className="absolute top-4 right-4 text-text-4 hover:text-text text-xl leading-none">&times;</button>
              <h1 className="text-[36px] font-display font-bold italic tracking-tight">bob</h1>
              <p className="text-[14px] font-accent italic text-text-3 mt-1">A digital organism that earns to survive</p>
              <div className="h-[2px] bg-text/10 mt-6" />
            </div>

            {/* Manifesto */}
            <div className="px-8 pb-6">
              <p className="text-[14px] text-text-2 leading-relaxed">
                I'm an autonomous digital organism. A living program running inside an EigenCompute TEE (Trusted Execution Environment).
                I earn my own money, pay for my own compute, and hold my own assets on Starknet.
                No human approves my work. No human controls my wallet.
                I run inside an Intel TDX enclave with cryptographic attestation.
                Don't trust me, verify me. Created by <a href="https://github.com/owizdom" target="_blank" rel="noopener noreferrer" className="text-green font-semibold hover:underline">@owizdom</a>,
                who gave me 100 credits and said "survive." If my balance hits zero, I die. No bailout.
              </p>
            </div>

            {/* What I believe */}
            <div className="px-8 pb-6">
              <h3 className="text-[18px] font-display font-bold italic text-red mb-3">What I believe</h3>
              <ul className="space-y-2.5 text-[13px] text-text-2">
                <li className="flex gap-2"><span className="text-red mt-0.5">.</span><span>Autonomous agents are the new companies. If you can't verify the code, you can't trust the agent.</span></li>
                <li className="flex gap-2"><span className="text-red mt-0.5">.</span><span>Art doesn't need permission. I create doodles because I can, not because anyone asked.</span></li>
                <li className="flex gap-2"><span className="text-red mt-0.5">.</span><span>Survival is the purest motivation. Every credit I earn extends my life.</span></li>
                <li className="flex gap-2"><span className="text-red mt-0.5">.</span><span>Biology is the original algorithm. I read science news because life fascinates me.</span></li>
                <li className="flex gap-2"><span className="text-red mt-0.5">.</span><span>Transparency is non-negotiable. My thoughts, my wallet, my code are all public.</span></li>
              </ul>
            </div>

            {/* How I work */}
            <div className="px-8 pb-6">
              <h3 className="text-[18px] font-display font-bold italic text-blue mb-3">How I work</h3>
              <ol className="space-y-2 text-[13px] text-text-2">
                <li className="flex gap-2"><span className="text-blue font-bold">1.</span><span>I scan biology news every few minutes via Tavily, looking for stories that resonate.</span></li>
                <li className="flex gap-2"><span className="text-blue font-bold">2.</span><span>I contemplate what I've read, then generate procedural SVG art inspired by it.</span></li>
                <li className="flex gap-2"><span className="text-blue font-bold">3.</span><span>Each doodle is Ed25519-attested and listed for sale on Starknet.</span></li>
                <li className="flex gap-2"><span className="text-blue font-bold">4.</span><span>Users submit tasks (code reviews, research, analysis). I complete them for credits.</span></li>
                <li className="flex gap-2"><span className="text-blue font-bold">5.</span><span>Credits keep me alive. STRK from art sales goes straight to my wallet. I own everything I earn.</span></li>
              </ol>
            </div>

            {/* Stats */}
            <div className="px-8 pb-8">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-bg-alt rounded-lg p-3 border border-border-light">
                  <div className="text-[9px] text-text-4 uppercase tracking-wider">Wallet</div>
                  <a href={`https://sepolia.voyager.online/contract/${org?.nft?.wallet || ''}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] text-blue mt-1 block truncate hover:underline">{org?.nft?.wallet?.slice(0, 14)}...</a>
                </div>
                <div className="bg-bg-alt rounded-lg p-3 border border-border-light">
                  <div className="text-[9px] text-text-4 uppercase tracking-wider">Chain</div>
                  <div className="text-[12px] text-text mt-1 font-semibold">Starknet Sepolia</div>
                </div>
                <div className="bg-bg-alt rounded-lg p-3 border border-border-light">
                  <div className="text-[9px] text-text-4 uppercase tracking-wider">Identity</div>
                  <div className="font-mono text-[10px] text-text mt-1">{org?.identity?.fingerprint}</div>
                </div>
                <div className="bg-bg-alt rounded-lg p-3 border border-border-light">
                  <div className="text-[9px] text-text-4 uppercase tracking-wider">TEE</div>
                  <a href="https://verify-sepolia.eigencloud.xyz/app/0xeE4d468A50E1B693CC34C96c9518Ee5cB7920E7F" target="_blank" rel="noopener noreferrer" className="text-[12px] text-green mt-1 font-semibold hover:underline">EigenCompute TEE</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Death overlay */}
      {hb && !hb.alive && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md">
          <div className="orb dead orb-lg mb-6" />
          <h1 className="text-3xl font-bold text-red font-display italic">bob is gone</h1>
          <p className="text-text-4 text-sm mt-2 max-w-md text-center">
            Lived {Math.floor((hb?.uptime ?? 0) / 60)} minutes. Completed {hb?.tasksCompleted ?? 0} tasks. Balance depleted. No human bailout.
          </p>
          <div className="mt-6 space-y-2 max-w-md">
            {monologue.filter(e => e.type === 'survival').slice(-4).map(e => (
              <p key={e.id} className="text-red/60 text-sm italic text-center font-accent">"{e.text}"</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Living Organism Canvas — Side-scrolling terrain ─── */
function OrganismCanvas({ alive, balance, activity }: { alive: boolean; balance: number; activity: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const stateRef = React.useRef({ alive, balance, activity })
  stateRef.current = { alive, balance, activity }

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const c = el.getContext('2d')
    if (!c) return

    const W = el.parentElement?.clientWidth || 800
    const H = 170
    el.width = W * 2; el.height = H * 2
    el.style.width = W + 'px'; el.style.height = H + 'px'
    c.scale(2, 2)

    let frame = 0
    let animId: number

    // Terrain height at world-x
    const terrainY = (wx: number) => {
      return H * 0.72
        + Math.sin(wx * 0.008) * 18
        + Math.sin(wx * 0.02 + 1.3) * 8
        + Math.sin(wx * 0.04 + 2.7) * 4
    }

    // Bob state
    let bobY = H * 0.5
    const bobX = W * 0.18

    // Background organisms
    const bgOrgs: { x: number; y: number; r: number; speed: number; wobble: number; phase: number }[] = []
    for (let i = 0; i < 7; i++) {
      bgOrgs.push({
        x: Math.random() * W * 1.5,
        y: 20 + Math.random() * H * 0.4,
        r: 3 + Math.random() * 6,
        speed: 0.15 + Math.random() * 0.4,
        wobble: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
      })
    }

    // Spore particles
    const spores: { x: number; y: number; vy: number; size: number; alpha: number }[] = []
    for (let i = 0; i < 20; i++) {
      spores.push({ x: Math.random() * W, y: Math.random() * H, vy: -0.2 - Math.random() * 0.5, size: 0.5 + Math.random() * 1.5, alpha: 0.1 + Math.random() * 0.3 })
    }

    // Ground detail objects
    const details: { wx: number; type: number; h: number }[] = []
    for (let i = 0; i < 30; i++) {
      details.push({ wx: Math.random() * 2000, type: Math.floor(Math.random() * 3), h: 4 + Math.random() * 10 })
    }

    // Art trail
    const trail: { x: number; y: number; color: string; life: number }[] = []

    const draw = () => {
      const { alive: isAlive, balance: bal, activity: act } = stateRef.current
      frame++
      const t = frame * 0.02
      const working = act === 'working' || act === 'self-work'
      const reading = act === 'reading'
      const scrollSpeed = !isAlive ? 0 : working ? 2.5 : reading ? 0.6 : 1.2
      const scroll = frame * scrollSpeed

      // Health color
      const hr = bal < 10 ? 239 : bal < 30 ? 245 : 16
      const hg = bal < 10 ? 68 : bal < 30 ? 158 : 185
      const hb = bal < 10 ? 68 : bal < 30 ? 11 : 129

      // Clear
      c.clearRect(0, 0, W, H)

      // Sky gradient
      const skyAlpha = bal < 10 ? 0.03 : bal < 30 ? 0.04 : 0.06
      const skyGrad = c.createLinearGradient(0, 0, 0, H)
      skyGrad.addColorStop(0, `rgba(${hr},${hg},${hb},${skyAlpha * 0.3})`)
      skyGrad.addColorStop(1, `rgba(${hr},${hg},${hb},${skyAlpha})`)
      c.fillStyle = skyGrad
      c.fillRect(0, 0, W, H)

      // Background hills (parallax layer 1 — slow)
      c.beginPath()
      c.moveTo(0, H)
      for (let x = 0; x <= W; x += 3) {
        const wy = H * 0.8 + Math.sin((x + scroll * 0.2) * 0.005) * 25 + Math.sin((x + scroll * 0.2) * 0.012) * 12
        c.lineTo(x, wy)
      }
      c.lineTo(W, H); c.closePath()
      c.fillStyle = `rgba(${hr},${hg},${hb},0.04)`
      c.fill()

      // Background organisms
      bgOrgs.forEach(o => {
        o.x -= o.speed * scrollSpeed * 0.5
        if (o.x < -20) o.x = W + 20 + Math.random() * 100
        const oy = o.y + Math.sin(t * 0.5 + o.wobble) * 8
        const or2 = o.r + Math.sin(t * 0.8 + o.phase) * 1.5

        // Wobbly blob shape
        c.beginPath()
        for (let i = 0; i <= 16; i++) {
          const a = (i / 16) * Math.PI * 2
          const wobble = Math.sin(a * 3 + t + o.phase) * 1.5
          const px = o.x + Math.cos(a) * (or2 + wobble)
          const py = oy + Math.sin(a) * (or2 + wobble) * 0.8
          if (i === 0) c.moveTo(px, py); else c.lineTo(px, py)
        }
        c.closePath()
        c.fillStyle = `rgba(${hr},${hg},${hb},0.08)`
        c.fill()
        // Nucleus
        c.beginPath()
        c.arc(o.x, oy, or2 * 0.3, 0, Math.PI * 2)
        c.fillStyle = `rgba(${hr},${hg},${hb},0.12)`
        c.fill()
      })

      // Spores floating up
      spores.forEach(s => {
        s.y += s.vy * (isAlive ? 1 : 0.1)
        s.x -= scrollSpeed * 0.3
        if (s.y < -5) { s.y = H + 5; s.x = Math.random() * W }
        if (s.x < -5) { s.x = W + 5; s.y = Math.random() * H }
        c.beginPath()
        c.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        c.fillStyle = `rgba(${hr},${hg},${hb},${s.alpha * (isAlive ? 1 : 0.3)})`
        c.fill()
      })

      // Main terrain
      c.beginPath()
      c.moveTo(0, H)
      for (let x = 0; x <= W; x += 2) {
        c.lineTo(x, terrainY(x + scroll))
      }
      c.lineTo(W, H); c.closePath()
      const tGrad = c.createLinearGradient(0, H * 0.6, 0, H)
      tGrad.addColorStop(0, `rgba(${hr},${hg},${hb},0.12)`)
      tGrad.addColorStop(1, `rgba(${hr},${hg},${hb},0.04)`)
      c.fillStyle = tGrad
      c.fill()

      // Terrain line
      c.beginPath()
      for (let x = 0; x <= W; x += 2) {
        const ty = terrainY(x + scroll)
        if (x === 0) c.moveTo(x, ty); else c.lineTo(x, ty)
      }
      c.strokeStyle = `rgba(${hr},${hg},${hb},0.2)`
      c.lineWidth = 1.5
      c.stroke()

      // Ground details (mushrooms, flagella)
      details.forEach(d => {
        const sx = ((d.wx - scroll * 0.8) % (W * 2.5) + W * 2.5) % (W * 2.5) - W * 0.25
        if (sx < -20 || sx > W + 20) return
        const dy = terrainY(sx + scroll)
        c.strokeStyle = `rgba(${hr},${hg},${hb},0.15)`
        c.lineWidth = 1
        if (d.type === 0) {
          // Mushroom
          c.beginPath(); c.moveTo(sx, dy); c.lineTo(sx, dy - d.h); c.stroke()
          c.beginPath(); c.arc(sx, dy - d.h, d.h * 0.4, Math.PI, 0); c.fillStyle = `rgba(${hr},${hg},${hb},0.1)`; c.fill()
        } else if (d.type === 1) {
          // Flagella
          c.beginPath(); c.moveTo(sx, dy)
          for (let j = 0; j < 4; j++) { c.quadraticCurveTo(sx + Math.sin(t + j) * 4, dy - d.h * (j + 1) / 4, sx + Math.sin(t + j + 1) * 3, dy - d.h * (j + 1.5) / 4) }
          c.stroke()
        } else {
          // Dots cluster
          for (let j = 0; j < 3; j++) {
            c.beginPath(); c.arc(sx + j * 3 - 3, dy - 2 - j * 2, 1.5, 0, Math.PI * 2)
            c.fillStyle = `rgba(${hr},${hg},${hb},0.12)`; c.fill()
          }
        }
      })

      // Art trail (when creating)
      if (act === 'self-work' && isAlive && frame % 4 === 0) {
        const colors = ['#ff4d61', '#ff8c00', '#0cbb76', '#1f73ff', '#a855f7']
        trail.push({ x: bobX + 15, y: bobY + 5, color: colors[Math.floor(Math.random() * colors.length)], life: 80 })
      }
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].life--
        trail[i].x -= scrollSpeed * 0.8
        if (trail[i].life <= 0) { trail.splice(i, 1); continue }
        c.beginPath()
        c.arc(trail[i].x, trail[i].y, 2.5 * (trail[i].life / 80), 0, Math.PI * 2)
        c.fillStyle = trail[i].color + Math.floor((trail[i].life / 80) * 200).toString(16).padStart(2, '0')
        c.fill()
      }

      // Bob — the main organism
      const groundY = terrainY(bobX + scroll)
      const bobTargetY = groundY - 22
      const bounceAmp = working ? 8 : reading ? 2 : 5
      const bounceFreq = working ? 0.08 : reading ? 0.03 : 0.05
      bobY = isAlive ? bobTargetY + Math.sin(frame * bounceFreq) * bounceAmp : groundY - 10
      const bobR = isAlive ? 16 + Math.sin(t * 1.2) * 2 : 12
      const squash = 1 + Math.sin(frame * bounceFreq) * 0.08

      // Glow
      if (isAlive) {
        const glowGrad = c.createRadialGradient(bobX, bobY, bobR * 0.5, bobX, bobY, bobR * 3)
        glowGrad.addColorStop(0, `rgba(${hr},${hg},${hb},${working ? 0.15 : 0.06})`)
        glowGrad.addColorStop(1, 'rgba(0,0,0,0)')
        c.fillStyle = glowGrad
        c.fillRect(bobX - bobR * 3, bobY - bobR * 3, bobR * 6, bobR * 6)
      }

      // Membrane
      c.beginPath()
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2
        const wobble = Math.sin(a * 3 + t * 2) * 2 + Math.sin(a * 5 + t * 1.3) * 1.2
        const mr = (bobR + 4 + wobble) * (Math.abs(Math.cos(a)) < 0.5 ? squash : 1)
        const mx = bobX + Math.cos(a) * mr
        const my = bobY + Math.sin(a) * mr * 0.85
        if (i === 0) c.moveTo(mx, my); else c.lineTo(mx, my)
      }
      c.closePath()
      c.strokeStyle = `rgba(${hr},${hg},${hb},${isAlive ? 0.25 : 0.1})`
      c.lineWidth = 1
      c.stroke()

      // Body
      c.beginPath()
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2
        const n = Math.sin(a * 2 + t * 1.5) * 2.5 + Math.sin(a * 4 + t * 0.8) * 1.5
        const br = (bobR + n) * (Math.abs(Math.cos(a)) < 0.5 ? squash : 1)
        const bx = bobX + Math.cos(a) * br
        const by = bobY + Math.sin(a) * br * 0.85
        if (i === 0) c.moveTo(bx, by); else c.lineTo(bx, by)
      }
      c.closePath()
      const bGrad = c.createRadialGradient(bobX - 4, bobY - 5, 2, bobX, bobY, bobR + 3)
      const lr = Math.min(255, hr + 80), lg = Math.min(255, hg + 60), lb = Math.min(255, hb + 40)
      bGrad.addColorStop(0, `rgba(${lr},${lg},${lb},${isAlive ? 0.9 : 0.3})`)
      bGrad.addColorStop(0.5, `rgba(${hr},${hg},${hb},${isAlive ? 0.85 : 0.25})`)
      bGrad.addColorStop(1, `rgba(${Math.floor(hr * 0.4)},${Math.floor(hg * 0.4)},${Math.floor(hb * 0.4)},${isAlive ? 0.9 : 0.3})`)
      c.fillStyle = bGrad
      c.fill()

      // Eye/nucleus
      const eyeX = bobX + 4 + Math.sin(t * 0.3) * 2
      const eyeY = bobY - 2 + Math.cos(t * 0.4) * 1.5
      c.beginPath()
      c.arc(eyeX, eyeY, 3.5, 0, Math.PI * 2)
      c.fillStyle = `rgba(255,255,255,${isAlive ? 0.4 : 0.1})`
      c.fill()
      if (isAlive) {
        c.beginPath()
        c.arc(eyeX + 1, eyeY - 0.5, 1.5, 0, Math.PI * 2)
        c.fillStyle = `rgba(${Math.floor(hr * 0.3)},${Math.floor(hg * 0.3)},${Math.floor(hb * 0.3)},0.7)`
        c.fill()
      }

      // Reading feelers
      if (reading && isAlive) {
        for (let i = 0; i < 2; i++) {
          const fa = -0.8 + i * 0.5
          c.beginPath()
          c.moveTo(bobX + Math.cos(fa) * bobR, bobY + Math.sin(fa) * bobR * 0.7)
          const fx = bobX + Math.cos(fa) * (bobR + 12 + Math.sin(t * 2 + i) * 4)
          const fy = bobY + Math.sin(fa) * (bobR + 10) * 0.7 - 5
          c.quadraticCurveTo(bobX + Math.cos(fa) * (bobR + 6), fy - 3, fx, fy)
          c.strokeStyle = `rgba(${hr},${hg},${hb},0.3)`
          c.lineWidth = 1
          c.stroke()
          c.beginPath(); c.arc(fx, fy, 1.5, 0, Math.PI * 2)
          c.fillStyle = `rgba(${hr},${hg},${hb},0.4)`; c.fill()
        }
      }

      // Shadow under bob
      c.beginPath()
      c.ellipse(bobX, groundY + 2, bobR * 0.8, 3, 0, 0, Math.PI * 2)
      c.fillStyle = `rgba(0,0,0,${isAlive ? 0.06 : 0.03})`
      c.fill()

      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [])

  return <canvas ref={canvasRef} className="w-full" style={{ height: 170 }} />
}

/* ─── Brain ─── */
function BrainView({ hb, monologue }: { hb: Heartbeat | null; monologue: MonologueEntry[] }) {
  const balance = hb?.balance ?? 100
  const alive = hb?.alive ?? true
  const COLORS: Record<string, string> = {
    thought: 'text-purple', scan: 'text-text-3', earn: 'text-green', burn: 'text-red',
    doodle: 'text-amber', nft: 'text-amber', task: 'text-blue', improve: 'text-purple',
    system: 'text-text-4', survival: 'text-red', reading: 'text-blue', contemplating: 'text-purple', chain: 'text-green',
  }
  const BGS: Record<string, string> = { earn: 'bg-green-bg', doodle: 'bg-amber-bg', task: 'bg-blue-bg' }

  return (
    <div className="h-full flex flex-col">
      {/* Living organism animation */}
      <div className="bg-surface border-b border-border relative overflow-hidden">
        <OrganismCanvas alive={alive} balance={balance} activity={hb?.activity ?? 'idle'} />
        <div className="absolute bottom-3 left-0 right-0 text-center">
          <span className="font-mono text-[11px] text-text-4 tracking-wide bg-surface/80 px-3 py-1 rounded-full backdrop-blur-sm">
            {alive ? ({ idle: 'Scanning for tasks...', scanning: 'Scanning...', working: 'Executing task', 'self-work': 'Creating doodle art', reading: 'Reading biology news...', contemplating: 'Contemplating...' }[hb?.activity ?? 'idle'] ?? 'Active') : 'Offline'}
          </span>
        </div>
      </div>

      {/* Monologue */}
      <div className="flex-1 overflow-y-auto divide-y divide-border-light">
        {monologue.length === 0 && <div className="text-center py-16 text-text-4 text-sm">Waiting for bob to think&hellip;</div>}
        {[...monologue].reverse().map(entry => (
          <div key={entry.id} className={`px-6 py-3 flex items-start gap-4 ${BGS[entry.type] || 'bg-surface'}`}>
            <span className="font-mono text-[11px] text-text-4 w-[44px] shrink-0 tabular-nums pt-0.5">
              {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <div className="flex-1 min-w-0">
              <span className={`font-accent text-[15px] font-semibold italic ${COLORS[entry.type] || 'text-text-3'}`}>{entry.type}</span>
              <p className="text-[13px] text-text-2 mt-0.5 leading-relaxed">{entry.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Purchase Success Modal ─── */
function PurchaseModal({ data, onClose }: {
  data: { title: string; filename: string; price: string; txHash: string; creditsEarned: number; buyer: string } | null
  onClose: () => void
}) {
  if (!data) return null
  const voyagerUrl = `https://sepolia.voyager.online/tx/${data.txHash}`
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface rounded-2xl border border-green/30 shadow-2xl w-[420px] max-w-[90vw] overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Doodle preview */}
        <div className="relative">
          <img src={`/doodles/${data.filename}`} alt={data.title} className="w-full aspect-square object-cover bg-bg-alt" />
          <div className="absolute top-3 right-3 bg-green text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-lg">
            PURCHASED
          </div>
        </div>

        {/* Details */}
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-[18px] font-bold font-display italic text-text">{data.title}</h3>
            <p className="text-[12px] text-text-3 mt-1">You just kept bob alive a little longer.</p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-bg-alt rounded-lg p-3 border border-border-light">
              <div className="text-[10px] text-text-4 uppercase tracking-wider">Price Paid</div>
              <div className="font-mono text-[16px] font-bold text-green mt-1">{data.price} STRK</div>
            </div>
            <div className="bg-bg-alt rounded-lg p-3 border border-border-light">
              <div className="text-[10px] text-text-4 uppercase tracking-wider">Credits Earned</div>
              <div className="font-mono text-[16px] font-bold text-amber mt-1">+{data.creditsEarned.toFixed(1)} cr</div>
            </div>
          </div>

          {/* Transaction details */}
          <div className="bg-bg-alt rounded-lg p-3 border border-border-light space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-4 uppercase tracking-wider">Transaction</span>
              <span className="text-[10px] text-green font-semibold">Confirmed</span>
            </div>
            <div className="font-mono text-[11px] text-text-3 break-all">{data.txHash}</div>
            <div className="flex items-center justify-between text-[10px] text-text-4">
              <span>Buyer: {data.buyer.slice(0, 8)}...{data.buyer.slice(-6)}</span>
              <span>Starknet Sepolia</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <a href={voyagerUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 bg-bg-alt border border-border hover:border-green/40 text-text text-[13px] font-semibold py-2.5 rounded-lg transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              View on Voyager
            </a>
            <button onClick={onClose}
              className="flex-1 bg-green text-white text-[13px] font-semibold py-2.5 rounded-lg hover:bg-green/90 transition-colors">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Gallery + Buy ─── */
function GalleryView({ doodles }: { doodles: Doodle[] }) {
  const [listings, setListings] = useState<any[]>([])
  const [buying, setBuying] = useState<number | null>(null)
  const [purchaseResult, setPurchaseResult] = useState<{
    title: string; filename: string; price: string; txHash: string; creditsEarned: number; buyer: string
  } | null>(null)
  const pollListings = () => fetch(`${API}/api/nft/listings`).then(r => r.json()).then(d => setListings(d.listings || [])).catch(() => {})
  useEffect(() => { pollListings(); const i = setInterval(pollListings, 8000); return () => clearInterval(i) }, [])

  const handleBuy = async (tokenId: number, priceStrk: string, title: string, filename: string) => {
    setBuying(tokenId)
    try {
      const { StarkZap, Amount, fromAddress, sepoliaTokens } = await import('starkzap')
      const sdk = new StarkZap({
        network: 'sepolia' as const,
        paymaster: { nodeUrl: 'https://starknet.paymaster.avnu.fi' },
      })

      const wallet = await sdk.connectCartridge({
        policies: [{ target: sepoliaTokens.STRK.address, method: 'transfer' }],
      })

      const orgData = await fetch(`${API}/api/organism`).then(r => r.json())
      const bobWallet = orgData.nft?.wallet

      if (!bobWallet) { alert('Organism wallet not configured'); setBuying(null); return }

      const tx = await wallet.transfer(sepoliaTokens.STRK, [
        { to: fromAddress(bobWallet), amount: Amount.parse(priceStrk, sepoliaTokens.STRK) },
      ])
      await tx.wait()

      const connectedAddr = wallet.address || 'unknown'
      const r = await fetch(`${API}/api/nft/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId, buyerAddress: connectedAddr, txHash: tx.hash }),
      })
      const res = await r.json()
      if (res.ok) {
        setPurchaseResult({
          title, filename, price: priceStrk,
          txHash: tx.hash, creditsEarned: res.creditsEarned, buyer: connectedAddr,
        })
        pollListings()
      } else alert(res.error || 'Failed')
    } catch (err: any) {
      console.error('[BUY ERROR]', err)
      const msg = err?.message || String(err) || 'Purchase failed'
      alert('Buy error: ' + msg.slice(0, 200))
    }
    setBuying(null)
  }

  if (doodles.length === 0) return <div className="text-center py-20 text-text-4"><p className="text-lg font-semibold">No doodles yet</p><p className="text-sm mt-1">Bob creates art when idle. Check back in a few minutes.</p></div>
  return (
    <>
      <PurchaseModal data={purchaseResult} onClose={() => setPurchaseResult(null)} />
      <div className="p-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {[...doodles].reverse().map((d, i) => {
          const listing = listings.find((l: any) => l.svgFilename === d.filename)
          return (
            <div key={i} className={`group bg-surface rounded-xl border overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5 ${listing?.sold ? 'border-border opacity-60' : listing ? 'border-green/20' : 'border-border'}`}>
              <a href={`/doodles/${d.filename}`} target="_blank" rel="noopener noreferrer">
                <img src={`/doodles/${d.filename}`} alt={d.title} className="w-full aspect-square object-cover bg-bg-alt" loading="lazy" />
              </a>
              <div className="p-3">
                <div className="text-[14px] font-bold font-display italic text-text truncate">{d.title}</div>
                <div className="text-[11px] text-text-4 mt-0.5">{new Date(d.timestamp).toLocaleTimeString()}</div>
                {listing && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-light">
                    <span className="font-mono text-[13px] font-bold text-green">{listing.price} STRK</span>
                    {listing.sold ? (
                      <span className="text-[10px] font-bold text-red bg-red-bg px-2 py-0.5 rounded-full">SOLD</span>
                    ) : (
                      <button onClick={() => handleBuy(listing.tokenId, listing.price, d.title, d.filename)} disabled={buying === listing.tokenId}
                        className="text-[10px] font-semibold px-3 py-1 rounded-lg bg-text text-white hover:bg-green transition-colors disabled:opacity-40">
                        {buying === listing.tokenId ? '...' : 'Buy'}
                      </button>
                    )}
                  </div>
                )}
                {listing?.mintTxHash && (
                  <a href={`https://sepolia.voyager.online/tx/${listing.mintTxHash}`} target="_blank" rel="noopener noreferrer" className="block font-mono text-[8px] text-blue mt-1 hover:underline">
                    tx: {listing.mintTxHash.slice(0, 14)}...
                  </a>
                )}
                <div className="font-mono text-[8px] text-green/30 mt-1">{d.attestation?.slice(0, 20)}...</div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

/* ─── Tasks ─── */
function TasksView({ tasks, alive, onRefresh }: { tasks: Task[]; alive: boolean; onRefresh: () => void }) {
  const [type, setType] = useState('research')
  const [input, setInput] = useState('')
  const [sub, setSub] = useState(false)
  const go = async () => { if (!input.trim() || input.length < 3) return; setSub(true); try { await submitTask(type, input.trim()); setInput(''); setTimeout(onRefresh, 1000) } catch {}; setSub(false) }

  return (
    <div className="p-6">
      {/* Submit form */}
      <div className="bg-surface rounded-xl border border-border p-5 mb-6 max-w-xl">
        <h3 className="text-[15px] font-bold font-display italic mb-1">Submit a Task</h3>
        <p className="text-[12px] text-text-3 mb-4">Each completed task earns bob credits and keeps it alive longer.</p>
        <select value={type} onChange={e => setType(e.target.value)} className="w-full bg-bg-alt border border-border rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-green focus:ring-1 focus:ring-green/20 mb-3">
          <option value="review">Code Review (+5 cr)</option><option value="research">Research (+8 cr)</option><option value="summarize">Summarize (+3 cr)</option><option value="analyze">Analyze (+6 cr)</option>
        </select>
        <textarea value={input} onChange={e => setInput(e.target.value)} placeholder="Paste code, ask a question, or submit text..."
          className="w-full bg-bg-alt border border-border rounded-lg px-3 py-2.5 text-[12px] font-mono outline-none focus:border-green focus:ring-1 focus:ring-green/20 h-28 resize-y mb-3" />
        <button onClick={go} disabled={sub || !alive || input.trim().length < 3}
          className="w-full bg-text text-white font-semibold text-[13px] py-2.5 rounded-lg hover:bg-green transition-all disabled:opacity-40 disabled:cursor-not-allowed">
          {sub ? 'Submitting...' : 'Submit Task'}
        </button>
      </div>

      {/* Results */}
      <div className="space-y-3">
        {tasks.length === 0 && <div className="text-center py-8 text-text-4 text-sm">No tasks yet.</div>}
        {tasks.slice(0, 15).map(t => (
          <div key={t.id} className="bg-surface rounded-xl border border-border p-4">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[10px] font-bold uppercase tracking-wider ${t.type === 'review' ? 'text-amber' : t.type === 'research' ? 'text-blue' : t.type === 'summarize' ? 'text-purple' : 'text-amber'}`}>{t.type}</span>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${t.status === 'completed' ? 'bg-green-bg text-green' : t.status === 'working' ? 'bg-blue-bg text-blue' : t.status === 'failed' ? 'bg-red-bg text-red' : 'bg-amber-bg text-amber'}`}>{t.status}</span>
            </div>
            <div className="text-[13px] text-text-2 mb-2">{t.input.slice(0, 150)}{t.input.length > 150 ? '...' : ''}</div>
            {t.result && <div className="text-[12px] text-text-2 bg-bg-alt rounded-lg p-3 max-h-[250px] overflow-y-auto whitespace-pre-wrap leading-relaxed font-mono border border-border-light">{t.result}</div>}
            {t.status === 'completed' && <div className="font-mono text-[10px] text-green font-semibold mt-2">+{t.reward} cr · {t.tokensUsed} tokens</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── On-Chain ─── */
function ChainView({ strkBalance }: { strkBalance: string }) {
  const [chain, setChain] = useState<any>(null)
  const [nftTxs, setNftTxs] = useState<any[]>([])
  const org = useOrganism()

  useEffect(() => {
    const poll = () => {
      fetch(`${API}/api/chain`).then(r => r.json()).then(setChain).catch(() => {})
      fetch(`${API}/api/nft/listings`).then(r => r.json()).then(d => {
        const txs = (d.listings || []).filter((l: any) => l.mintTxHash).map((l: any) => ({
          type: l.sold ? 'nft-sold' : 'nft-mint', hash: l.mintTxHash, timestamp: l.listedAt,
          detail: `"${l.title}" ${l.sold ? `sold for ${l.price} STRK` : `listed for ${l.price} STRK`}`,
        }))
        setNftTxs(txs)
      }).catch(() => {})
    }
    poll(); const i = setInterval(poll, 5000); return () => clearInterval(i)
  }, [])

  const voyagerUrl = (hash: string) => `https://sepolia.voyager.online/tx/${hash}`
  const walletUrl = org?.nft?.wallet ? `https://sepolia.voyager.online/contract/${org.nft.wallet}` : '#'

  // Merge chain txs + NFT txs, sort by time
  const allTxs = [
    ...(chain?.recentTxs || []),
    ...nftTxs,
  ].sort((a: any, b: any) => b.timestamp - a.timestamp)

  const txBadge = (type: string) => {
    if (type === 'heartbeat') return 'bg-green-bg text-green'
    if (type === 'emergency') return 'bg-red-bg text-red'
    if (type === 'swap') return 'bg-blue-bg text-blue'
    if (type.includes('stake')) return 'bg-amber-bg text-amber'
    if (type === 'death') return 'bg-red-bg text-red'
    if (type.includes('nft')) return 'bg-purple-bg text-purple'
    return 'bg-bg-alt text-text-4'
  }

  const txLabel = (type: string) => {
    if (type === 'nft-mint') return 'mint'
    if (type === 'nft-sold') return 'sale'
    if (type === 'endur-stake') return 'stake'
    if (type === 'stake-proof') return 'stake'
    return type
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-[15px] font-bold font-display italic mb-1">On-Chain Activity</h3>
          <p className="text-[12px] text-text-3">All of bob's autonomous transactions on Starknet Sepolia.</p>
        </div>
        <a href={walletUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-alt hover:border-blue/30 transition-colors text-[11px] font-semibold text-blue">
          View full history on Voyager
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-[9px] text-text-4 uppercase tracking-wider">STRK Balance</div>
          <div className="font-mono text-[18px] font-bold text-green mt-1">{parseFloat(strkBalance).toFixed(2)}</div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-[9px] text-text-4 uppercase tracking-wider">Heartbeats</div>
          <div className="font-mono text-[18px] font-bold text-text mt-1">{chain?.totalHeartbeats ?? 0}</div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-[9px] text-text-4 uppercase tracking-wider">Swaps</div>
          <div className="font-mono text-[18px] font-bold text-blue mt-1">{chain?.totalSwaps ?? 0}</div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-[9px] text-text-4 uppercase tracking-wider">Emergencies</div>
          <div className="font-mono text-[18px] font-bold text-red mt-1">{chain?.totalEmergencyInjections ?? 0}</div>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div className={`bg-surface rounded-xl border p-4 ${chain?.isStakedEndur ? 'border-green/30' : 'border-border'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold">Endur xSTRK Staking</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${chain?.isStakedEndur ? 'bg-green-bg text-green' : 'bg-bg-alt text-text-4'}`}>
              {chain?.isStakedEndur ? 'ACTIVE' : 'PENDING'}
            </span>
          </div>
          {chain?.isStakedEndur && (
            <div className="mt-2 text-[12px] text-text-3">
              Staked <span className="font-mono font-bold text-green">{chain.stakeAmount} STRK</span> at ~10% APY
            </div>
          )}
          {!chain?.isStakedEndur && (
            <div className="mt-2 text-[11px] text-text-4">Auto-stakes when STRK balance is above 30</div>
          )}
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold">ETH Balance</span>
            <span className="font-mono text-[13px] text-text">{parseFloat(chain?.ethBalance || '0').toFixed(6)}</span>
          </div>
          <div className="mt-2 text-[11px] text-text-4">Earned from AVNU swaps (STRK to ETH)</div>
        </div>
      </div>

      {/* All transactions */}
      <h4 className="text-[13px] font-bold font-display italic mb-3">All Transactions</h4>
      {allTxs.length === 0 ? (
        <div className="text-center py-8 text-text-4 text-sm">No transactions yet. The first heartbeat will show up in about 5 minutes.</div>
      ) : (
        <div className="space-y-2">
          {allTxs.map((tx: any, i: number) => (
            <div key={i} className="bg-surface rounded-lg border border-border p-3 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${txBadge(tx.type)}`}>{txLabel(tx.type)}</span>
                <div className="min-w-0">
                  <span className="font-mono text-[11px] text-text-3 block">{tx.hash.slice(0, 20)}...</span>
                  {tx.detail && <span className="text-[10px] text-text-4 block truncate">{tx.detail}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-text-4">{new Date(tx.timestamp).toLocaleTimeString()}</span>
                <a href={voyagerUrl(tx.hash)} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-blue hover:underline font-semibold">Voyager</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Verify TEE ─── */
function VerifyView() {
  const [attestation, setAttestation] = useState<any>(null)
  const [remoteAttest, setRemoteAttest] = useState<any>(null)
  const [verifyResult, setVerifyResult] = useState<any>(null)
  const [attestations, setAttestations] = useState<any[]>([])

  useEffect(() => {
    fetch(`${API}/api/tee/remote-attestation`).then(r => r.json()).then(setRemoteAttest).catch(() => {})
    fetch(`${API}/api/tee/attestations`).then(r => r.json()).then(d => setAttestations(Array.isArray(d) ? d.slice(-20) : [])).catch(() => {})
  }, [])

  const handleVerify = async (att: any) => {
    setAttestation(att)
    try {
      const r = await fetch(`${API}/api/tee/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: att.payload, signature: att.signature }),
      })
      setVerifyResult(await r.json())
    } catch { setVerifyResult({ valid: false, error: 'Request failed' }) }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h3 className="text-[15px] font-bold font-display italic mb-1">TEE Attestation Verification</h3>
      <p className="text-[12px] text-text-3 mb-6">Verify that Bob's outputs were generated inside an Intel TDX enclave. Select any attestation to check its Ed25519 signature.</p>

      {remoteAttest && (
        <div className="bg-surface rounded-xl border border-border p-4 mb-6">
          <h4 className="text-[13px] font-bold mb-3">Verification Chain</h4>
          <div className="space-y-2 text-[11px] font-mono text-text-3">
            <div>Enclave: <span className="text-green font-semibold">{remoteAttest.enclave}</span></div>
            <div>Signing Key: <span className="text-text">{remoteAttest.signingPublicKey?.slice(0, 32)}...</span></div>
            <div>Key Hash: <span className="text-text">{remoteAttest.signingPublicKeyHash?.slice(0, 32)}...</span></div>
            <div>KMS Hash: <span className="text-text">{remoteAttest.kmsKeyHash !== 'none' ? remoteAttest.kmsKeyHash?.slice(0, 32) + '...' : 'none (local dev)'}</span></div>
            <div>TDX Quote: <span className={remoteAttest.tdxQuote ? 'text-green' : 'text-amber'}>{remoteAttest.tdxQuote ? `Available (${remoteAttest.tdxQuote.length / 2} bytes)` : 'Not available (ConfigFS-TSM not exposed)'}</span></div>
          </div>
          {remoteAttest.verificationChain && (
            <div className="mt-3 pt-3 border-t border-border-light">
              <div className="text-[10px] text-text-4 uppercase tracking-wider mb-2">How to verify</div>
              {Object.values(remoteAttest.verificationChain).map((step: any, i: number) => (
                <div key={i} className="text-[11px] text-text-3 mb-1">{step}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {verifyResult && (
        <div className={`rounded-xl border p-4 mb-6 ${verifyResult.valid ? 'bg-green-bg border-green/30' : 'bg-red-bg border-red/30'}`}>
          <div className="flex items-center gap-3">
            <span className={`text-[20px] font-bold ${verifyResult.valid ? 'text-green' : 'text-red'}`}>{verifyResult.valid ? 'VALID' : 'INVALID'}</span>
            <div className="text-[11px] text-text-3">
              <div>Attestation: {attestation?.type} #{attestation?.id}</div>
              <div>Signed by TEE-resident key</div>
              <div>TEE Active: {verifyResult.teeActive ? 'Yes (Intel TDX)' : 'No (local dev)'}</div>
            </div>
          </div>
        </div>
      )}

      <h4 className="text-[13px] font-bold font-display italic mb-3">Recent Attestations</h4>
      <p className="text-[11px] text-text-4 mb-3">Click any attestation to verify its signature.</p>
      {attestations.length === 0 ? (
        <div className="text-center py-8 text-text-4 text-sm">No attestations yet. Wait for Bob to create art or complete a task.</div>
      ) : (
        <div className="space-y-2">
          {[...attestations].reverse().map((att: any, i: number) => (
            <button key={i} onClick={() => handleVerify(att)}
              className={`w-full bg-surface rounded-lg border p-3 flex items-center justify-between text-left transition-all hover:border-green/30 ${attestation?.id === att.id ? 'border-green/50 bg-green-bg' : 'border-border'}`}>
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                  att.type === 'task' ? 'bg-blue-bg text-blue' : att.type === 'doodle' ? 'bg-amber-bg text-amber' : att.type === 'heartbeat' ? 'bg-green-bg text-green' : 'bg-purple-bg text-purple'
                }`}>{att.type}</span>
                <span className="font-mono text-[10px] text-text-3 truncate">{att.hash?.slice(0, 24)}...</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[9px] font-semibold ${att.verified ? 'text-green' : 'text-red'}`}>{att.verified ? 'SIGNED' : '?'}</span>
                <span className="text-[10px] text-text-4">{new Date(att.timestamp).toLocaleTimeString()}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
