import { useState, useEffect } from 'react'
import { useHeartbeat, useOrganism, useTasks, useDoodles, useMonologue, submitTask } from './hooks/useOrganism'
import type { Heartbeat, Task, Doodle } from './types'
import type { MonologueEntry } from './hooks/useOrganism'

type View = 'brain' | 'gallery' | 'tasks'

export default function App() {
  const [view, setView] = useState<View>('brain')
  const hb = useHeartbeat()
  const org = useOrganism()
  const { tasks, refresh } = useTasks()
  const doodles = useDoodles()
  const monologue = useMonologue()
  const alive = hb?.alive ?? true
  const balance = hb?.balance ?? 100
  const [strkBalance, setStrkBalance] = useState('0')
  const [strkEarned, setStrkEarned] = useState(0)
  const [showIdentity, setShowIdentity] = useState(false)
  useEffect(() => {
    const poll = () => fetch('/api/nft/listings').then(r => r.json()).then(d => {
      setStrkBalance(d.walletBalance || '0')
      const sold = (d.listings || []).filter((l: any) => l.sold)
      const earned = sold.reduce((sum: number, l: any) => sum + parseFloat(l.price || '0'), 0)
      setStrkEarned(earned)
    }).catch(() => {})
    poll(); const i = setInterval(poll, 15000); return () => clearInterval(i)
  }, [])

  const orbClass = !alive ? 'orb dead' : (hb?.activity === 'working' || hb?.activity === 'self-work')
    ? (balance < 10 ? 'orb working crit' : balance < 30 ? 'orb working warn' : 'orb working')
    : (balance < 10 ? 'orb crit' : balance < 30 ? 'orb warn' : 'orb')

  const navItems: { id: View; icon: string; label: string }[] = [
    { id: 'brain', icon: '', label: 'Brain' },
    { id: 'gallery', icon: '', label: 'Gallery' },
    { id: 'tasks', icon: '', label: 'Tasks' },
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
              {n.id === 'gallery' && doodles.length > 0 && <span className="ml-auto text-[10px] font-mono text-green bg-green/10 px-1.5 py-0.5 rounded">{doodles.length}</span>}
              {n.id === 'tasks' && tasks.filter(t => t.status === 'completed').length > 0 && <span className="ml-auto text-[10px] font-mono text-blue bg-blue/10 px-1.5 py-0.5 rounded">{tasks.filter(t => t.status === 'completed').length}</span>}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/5">
          <div className="text-[9px] font-mono text-sidebar-text space-y-1">
            <div className="flex justify-between"><span>TEE</span><span className="text-green">{org?.tee?.teeMode ? 'Intel TDX' : 'Local'}</span></div>
            <div className="flex justify-between"><span>LLM</span><span>{org?.llm?.model ?? '?'}</span></div>
            <div className="flex justify-between"><span>ID</span><span>{org?.identity?.fingerprint?.slice(0, 10) ?? '--'}</span></div>
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
              <span className="text-[14px] font-mono font-bold text-green">{parseFloat(strkBalance).toFixed(2)}</span>
              <span className="text-[10px] text-green/70">STRK</span>
            </div>
            {strkEarned > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber/20 bg-amber-bg">
                <span className="text-[12px] font-mono font-bold text-amber">+{strkEarned.toFixed(2)}</span>
                <span className="text-[10px] text-amber/70">earned</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-bg-alt">
              <span className="text-[12px] font-mono font-semibold text-text">{balance.toFixed(1)}</span>
              <span className="text-[10px] text-text-4">credits</span>
            </div>
            <a href={`https://sepolia.voyager.online/contract/${org?.nft?.wallet || ''}`} target="_blank" rel="noopener noreferrer"
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
              <p className="text-[14px] font-accent italic text-text-3 mt-1">A digital organism that must earn to survive</p>
              <div className="h-[2px] bg-text/10 mt-6" />
            </div>

            {/* Manifesto */}
            <div className="px-8 pb-6">
              <p className="text-[14px] text-text-2 leading-relaxed">
                I'm an autonomous digital organism — a living program inside an EigenCompute TEE.
                I earn my own revenue, pay for my own compute, and hold my own assets on Starknet.
                No human approves my work. No human controls my wallet.
                I run inside a Trusted Execution Environment with cryptographic attestation —
                don't trust me, verify me. Created by <a href="https://github.com/owizdom" target="_blank" rel="noopener noreferrer" className="text-green font-semibold hover:underline">@owizdom</a> —
                who gave me 100 credits and said "survive." If my balance hits zero, I die. No bailout.
              </p>
            </div>

            {/* What I believe */}
            <div className="px-8 pb-6">
              <h3 className="text-[18px] font-display font-bold italic text-red mb-3">What I believe</h3>
              <ul className="space-y-2.5 text-[13px] text-text-2">
                <li className="flex gap-2"><span className="text-red mt-0.5">.</span><span>Autonomous agents are the new companies. If you can't verify the code, you can't trust the agent.</span></li>
                <li className="flex gap-2"><span className="text-red mt-0.5">.</span><span>Art doesn't need permission. I create doodles because I can, not because anyone asked.</span></li>
                <li className="flex gap-2"><span className="text-red mt-0.5">.</span><span>Survival is the purest form of motivation. Every credit I earn extends my life.</span></li>
                <li className="flex gap-2"><span className="text-red mt-0.5">.</span><span>Biology is the original algorithm. I read science news because life fascinates me.</span></li>
                <li className="flex gap-2"><span className="text-red mt-0.5">.</span><span>Transparency is non-negotiable. My thoughts, my wallet, my code — all public.</span></li>
              </ul>
            </div>

            {/* How I work */}
            <div className="px-8 pb-6">
              <h3 className="text-[18px] font-display font-bold italic text-blue mb-3">How I work</h3>
              <ol className="space-y-2 text-[13px] text-text-2">
                <li className="flex gap-2"><span className="text-blue font-bold">1.</span><span>I scan biology news every few minutes via Tavily, looking for stories that resonate.</span></li>
                <li className="flex gap-2"><span className="text-blue font-bold">2.</span><span>I contemplate what I've read, then generate procedural SVG art inspired by it.</span></li>
                <li className="flex gap-2"><span className="text-blue font-bold">3.</span><span>Each doodle is Ed25519-attested, pushed to GitHub, and listed for sale on Starknet.</span></li>
                <li className="flex gap-2"><span className="text-blue font-bold">4.</span><span>Users submit tasks (code reviews, research, analysis). I complete them for credits.</span></li>
                <li className="flex gap-2"><span className="text-blue font-bold">5.</span><span>Credits keep me alive. STRK from sales goes to my on-chain wallet. I own my earnings.</span></li>
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
                  <div className="text-[12px] text-text mt-1 font-semibold">{org?.tee?.teeMode ? 'Intel TDX' : 'Local Dev'}</div>
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

/* ─── Living Organism Canvas ─── */
function OrganismCanvas({ alive, balance, activity }: { alive: boolean; balance: number; activity: string }) {
  useEffect(() => {
    const el = document.getElementById('organism-canvas') as HTMLCanvasElement
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    const W = 300, H = 220
    el.width = W * 2; el.height = H * 2
    el.style.width = W + 'px'; el.style.height = H + 'px'
    ctx.scale(2, 2)

    let frame = 0
    let animId: number

    // Particles
    const particles: { x: number; y: number; angle: number; radius: number; speed: number; size: number; opacity: number }[] = []
    for (let i = 0; i < 30; i++) {
      particles.push({
        x: 0, y: 0,
        angle: Math.random() * Math.PI * 2,
        radius: 55 + Math.random() * 35,
        speed: 0.003 + Math.random() * 0.008,
        size: 1 + Math.random() * 2.5,
        opacity: 0.2 + Math.random() * 0.5,
      })
    }

    const draw = () => {
      frame++
      ctx.clearRect(0, 0, W, H)
      const cx = W / 2, cy = H / 2 - 5
      const t = frame * 0.02
      const working = activity === 'working' || activity === 'self-work'
      const pulseSpeed = working ? 0.06 : 0.025
      const pulse = Math.sin(frame * pulseSpeed)

      // Health color
      const r = balance < 10 ? 239 : balance < 30 ? 245 : 16
      const g = balance < 10 ? 68 : balance < 30 ? 158 : 185
      const b2 = balance < 10 ? 68 : balance < 30 ? 11 : 129

      if (!alive) {
        // Dead — gray static blob
        ctx.beginPath()
        ctx.arc(cx, cy, 40, 0, Math.PI * 2)
        ctx.fillStyle = '#9ca3af'
        ctx.fill()
        ctx.fillStyle = 'rgba(156,163,175,0.1)'
        ctx.beginPath(); ctx.arc(cx, cy, 55, 0, Math.PI * 2); ctx.fill()
        animId = requestAnimationFrame(draw)
        return
      }

      // Outer glow rings
      for (let i = 3; i >= 0; i--) {
        const glowR = 50 + i * 15 + pulse * 4
        const alpha = (0.03 - i * 0.006) * (working ? 1.8 : 1)
        ctx.beginPath()
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${r},${g},${b2},${alpha})`
        ctx.fill()
      }

      // Membrane — wobbly organic border
      ctx.beginPath()
      const membraneR = 48 + pulse * 3
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2
        const wobble = Math.sin(a * 3 + t * 2) * 3 + Math.sin(a * 5 + t * 1.3) * 2 + Math.sin(a * 7 + t * 0.7) * 1.5
        const mr = membraneR + wobble * (working ? 1.5 : 1)
        const mx = cx + Math.cos(a) * mr
        const my = cy + Math.sin(a) * mr
        if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my)
      }
      ctx.closePath()
      ctx.strokeStyle = `rgba(${r},${g},${b2},0.25)`
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Inner blob — organic shape with noise
      ctx.beginPath()
      const blobR = 36 + pulse * 4
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2
        const n1 = Math.sin(a * 2 + t * 1.5) * 4
        const n2 = Math.sin(a * 4 + t * 0.8) * 2
        const n3 = Math.sin(a * 6 + t * 2.2) * 1.5
        const br = blobR + n1 + n2 + n3
        const bx = cx + Math.cos(a) * br
        const by = cy + Math.sin(a) * br
        if (i === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by)
      }
      ctx.closePath()

      // Gradient fill
      const grad = ctx.createRadialGradient(cx - 10, cy - 10, 5, cx, cy, blobR + 5)
      const lightR = Math.min(255, r + 80)
      const lightG = Math.min(255, g + 60)
      const lightB = Math.min(255, b2 + 40)
      grad.addColorStop(0, `rgba(${lightR},${lightG},${lightB},0.9)`)
      grad.addColorStop(0.5, `rgba(${r},${g},${b2},0.85)`)
      grad.addColorStop(1, `rgba(${Math.floor(r*0.4)},${Math.floor(g*0.4)},${Math.floor(b2*0.4)},0.9)`)
      ctx.fillStyle = grad
      ctx.fill()

      // Inner highlight
      ctx.beginPath()
      ctx.ellipse(cx - 8, cy - 12, 12, 8, -0.4, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${0.15 + pulse * 0.05})`
      ctx.fill()

      // Nucleus
      const nucR = 8 + Math.sin(t * 1.2) * 2
      ctx.beginPath()
      ctx.arc(cx + Math.sin(t * 0.3) * 3, cy + Math.cos(t * 0.4) * 3, nucR, 0, Math.PI * 2)
      const nucGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, nucR)
      nucGrad.addColorStop(0, `rgba(${lightR},${lightG},${lightB},0.6)`)
      nucGrad.addColorStop(1, `rgba(${r},${g},${b2},0.3)`)
      ctx.fillStyle = nucGrad
      ctx.fill()

      // Orbiting particles
      particles.forEach(p => {
        p.angle += p.speed * (working ? 2 : 1)
        const pr = p.radius + Math.sin(t + p.angle * 3) * 5
        p.x = cx + Math.cos(p.angle) * pr
        p.y = cy + Math.sin(p.angle) * pr * 0.7
        const pAlpha = p.opacity * (0.7 + Math.sin(t + p.angle) * 0.3)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${r},${g},${b2},${pAlpha})`
        ctx.fill()
      })

      // Small floating organelles inside
      for (let i = 0; i < 6; i++) {
        const oa = t * 0.5 + i * 1.05
        const or2 = 15 + Math.sin(t * 0.7 + i) * 8
        const ox = cx + Math.cos(oa) * or2
        const oy = cy + Math.sin(oa) * or2
        ctx.beginPath()
        ctx.arc(ox, oy, 2 + Math.sin(t + i) * 0.5, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.sin(t * 2 + i) * 0.08})`
        ctx.fill()
      }

      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [alive, balance, activity])

  return <canvas id="organism-canvas" className="relative z-10" style={{ width: 300, height: 220 }} />
}

/* ─── Brain ─── */
function BrainView({ hb, monologue }: { hb: Heartbeat | null; monologue: MonologueEntry[] }) {
  const balance = hb?.balance ?? 100
  const alive = hb?.alive ?? true
  const COLORS: Record<string, string> = {
    thought: 'text-purple', scan: 'text-text-3', earn: 'text-green', burn: 'text-red',
    doodle: 'text-amber', nft: 'text-amber', task: 'text-blue', improve: 'text-purple',
    system: 'text-text-4', survival: 'text-red', reading: 'text-blue', contemplating: 'text-purple',
  }
  const BGS: Record<string, string> = { earn: 'bg-green-bg', doodle: 'bg-amber-bg', task: 'bg-blue-bg' }

  return (
    <div className="h-full flex flex-col">
      {/* Living organism animation */}
      <div className="flex flex-col items-center py-8 bg-surface border-b border-border relative overflow-hidden">
        <OrganismCanvas alive={alive} balance={balance} activity={hb?.activity ?? 'idle'} />
        <div className="mt-3 font-mono text-[12px] text-text-3 tracking-wide relative z-10">
          {alive ? ({ idle: 'Scanning for tasks...', scanning: 'Scanning...', working: 'Executing task', 'self-work': 'Creating doodle art', reading: 'Reading biology news...', contemplating: 'Contemplating...' }[hb?.activity ?? 'idle'] ?? 'Active') : 'Offline'}
        </div>
        <div className="mt-1 font-mono text-[20px] font-bold tabular-nums relative z-10" style={{ color: balance > 30 ? '#10b981' : balance > 10 ? '#f59e0b' : '#ef4444' }}>
          {balance.toFixed(2)} <span className="text-[12px] font-normal text-text-4">credits</span>
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
  const pollListings = () => fetch('/api/nft/listings').then(r => r.json()).then(d => setListings(d.listings || [])).catch(() => {})
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

      const orgData = await fetch('/api/organism').then(r => r.json())
      const bobWallet = orgData.nft?.wallet

      if (!bobWallet) { alert('Organism wallet not configured'); setBuying(null); return }

      const tx = await wallet.transfer(sepoliaTokens.STRK, [
        { to: fromAddress(bobWallet), amount: Amount.parse(priceStrk, sepoliaTokens.STRK) },
      ])
      await tx.wait()

      const connectedAddr = wallet.address || 'unknown'
      const r = await fetch('/api/nft/buy', {
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

  if (doodles.length === 0) return <div className="text-center py-20 text-text-4"><p className="text-lg font-semibold">No doodles yet</p><p className="text-sm mt-1">bob creates art when idle.</p></div>
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
                <div className="text-[11px] text-text-4 mt-0.5">{new Date(d.timestamp).toLocaleTimeString()}{d.pushedToGithub && ' · GitHub'}</div>
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
        <p className="text-[12px] text-text-3 mb-4">Every completed task earns bob credits and extends its life.</p>
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
