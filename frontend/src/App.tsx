import { useState } from 'react'
import { useHeartbeat, useOrganism, useTasks, useDoodles, useEarnings, useMonologue, submitTask } from './hooks/useOrganism'
import type { Heartbeat, EarningsEntry, Task, Doodle } from './types'
import type { MonologueEntry } from './hooks/useOrganism'

type Tab = 'brain' | 'gallery' | 'marketplace' | 'tasks'

const TABS: { id: Tab; label: string; sublabel: string }[] = [
  { id: 'brain', label: 'The Brain', sublabel: 'Live metabolism' },
  { id: 'gallery', label: 'Gallery', sublabel: 'Doodle art' },
  { id: 'marketplace', label: 'Marketplace', sublabel: 'Buy doodles' },
  { id: 'tasks', label: 'Tasks', sublabel: 'Feed the organism' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('brain')
  const hb = useHeartbeat()
  const org = useOrganism()
  const { tasks, refresh } = useTasks()
  const doodles = useDoodles()
  const earnings = useEarnings()
  const monologue = useMonologue()

  const alive = hb?.alive ?? true
  const balance = hb?.balance ?? 100

  return (
    <div className="h-screen flex flex-col bg-[#050508] text-[#d0d8e8]" style={{ fontFamily: "'Inter','SF Pro',-apple-system,system-ui,sans-serif" }}>
      <Header hb={hb} org={org} />
      <div className="h-[2px] bg-[#111]">
        <div className="h-full transition-all duration-1000" style={{ width: `${Math.max(0,Math.min(100,balance))}%`, background: balance>30?'#0cbb76':balance>10?'#ffbf00':'#ff4d61' }} />
      </div>
      <nav className="bg-[#0a0b0f] border-b-2 border-[#111] px-6 sm:px-10">
        <div className="flex items-stretch">
          {TABS.map(({id,label,sublabel})=>(
            <button key={id} onClick={()=>setTab(id)} className={`relative px-5 sm:px-7 py-3 transition-all group ${tab===id?'':'hover:bg-white/[0.02]'}`}>
              {tab===id && <div className="absolute bottom-0 left-2 right-2 h-[3px] bg-[#0cbb76] rounded-full"/>}
              <div className="flex items-center gap-2">
                <span className={`font-semibold text-[15px] ${tab===id?'text-[#e8ecf4]':'text-[#556] group-hover:text-[#889]'}`}>{label}</span>
                {id==='gallery'&&doodles.length>0&&<span className="text-[9px] font-bold text-[#050508] bg-[#a855f7] px-1.5 py-0.5 rounded-full">{doodles.length}</span>}
                {id==='tasks'&&tasks.filter(t=>t.status==='completed').length>0&&<span className="text-[9px] font-bold text-[#050508] bg-[#0cbb76] px-1.5 py-0.5 rounded-full">{tasks.filter(t=>t.status==='completed').length}</span>}
              </div>
              <span className={`block text-[10px] font-medium uppercase tracking-widest mt-0.5 ${tab===id?'text-[#556]':'text-[#334]'}`}>{sublabel}</span>
            </button>
          ))}
        </div>
      </nav>
      <div className="flex-1 grid grid-cols-[1fr_300px] min-h-0">
        <main className="min-h-0 overflow-y-auto border-r border-[#111] p-6">
          {tab==='brain'&&<BrainView hb={hb} earnings={earnings} monologue={monologue}/>}
          {tab==='gallery'&&<GalleryView doodles={doodles}/>}
          {tab==='marketplace'&&<MarketplaceView/>}
          {tab==='tasks'&&<TasksView tasks={tasks} alive={alive} onRefresh={refresh}/>}
        </main>
        <aside className="min-h-0 overflow-y-auto p-4 space-y-3">
          <Sidebar hb={hb} org={org} doodleCount={doodles.length}/>
        </aside>
      </div>
      {!alive&&(
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050508]/90 backdrop-blur-sm">
          <h1 className="text-4xl font-black tracking-[8px] text-[#ff4d61]" style={{textShadow:'0 0 40px rgba(255,77,97,0.3)'}}>DECEASED</h1>
          <p className="text-[#445] text-sm mt-2">Balance depleted. No human bailout.</p>
        </div>
      )}
    </div>
  )
}

function Header({hb,org:_org}:{hb:Heartbeat|null;org:any}) {
  const alive=hb?.alive??true, balance=hb?.balance??100
  const m=Math.floor((hb?.uptime??0)/60), s=Math.floor((hb?.uptime??0)%60)
  return (
    <header>
      <div className="h-[3px]" style={{background:alive?'#0cbb76':'#ff4d61'}}/>
      <div className="bg-[#0a0b0f] border-b border-[#151820]">
        <div className="px-6 sm:px-10 py-1.5 flex items-center justify-between border-b border-[#111] text-[10px] text-[#445] uppercase tracking-[0.2em]" style={{fontFamily:'monospace'}}>
          <span>Digital Organism · Autonomous AI Agent · TEE-Attested</span>
          <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${alive?'bg-[#0cbb76]/10 text-[#0cbb76]':'bg-[#ff4d61]/10 text-[#ff4d61]'}`}>
            <span className="w-[5px] h-[5px] rounded-full bg-current" style={{animation:alive?'pulse 1.5s infinite':'none'}}/>
            {alive?(hb?.activity==='working'?'Working':hb?.activity==='self-work'?'Creating art':'Alive'):'Dead'}
          </span>
        </div>
        <div className="px-6 sm:px-10 py-4 flex items-end justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[48px] sm:text-[56px] font-black leading-none tracking-tight"><span className="text-[#0cbb76]">bob</span> <span className="text-[#e8ecf4]">is alive</span></h1>
            <a href="https://github.com/owizdom/bobIsAlive" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[11px] text-[#556] hover:text-[#aab] bg-[#111] px-3 py-1.5 rounded-md transition-colors" style={{fontFamily:'monospace'}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
              GitHub
            </a>
          </div>
          <div className="hidden md:flex flex-col items-end gap-1">
            <div className="flex items-center gap-2"><span className="text-[11px] text-[#445] uppercase tracking-widest" style={{fontFamily:'monospace'}}>Built on</span><span className="text-[13px] font-bold text-[#0cbb76]" style={{fontFamily:'monospace'}}>EigenCompute</span></div>
            <div className="flex items-center gap-4 text-[11px] text-[#445]" style={{fontFamily:'monospace'}}>
              <span>Uptime: {m>0?`${m}m ${s}s`:`${s}s`}</span>
              <span className="font-bold" style={{color:balance>30?'#0cbb76':balance>10?'#ffbf00':'#ff4d61'}}>{balance.toFixed(1)} credits</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

function BrainView({hb,earnings,monologue}:{hb:Heartbeat|null;earnings:EarningsEntry[];monologue:MonologueEntry[]}) {
  const alive=hb?.alive??true
  const TYPE_STYLES:Record<string,{label:string;color:string;prefix:string}>={
    thought:{label:'thought',color:'text-[#a855f7]',prefix:'~'},
    scan:{label:'scan',color:'text-[#1f73ff]',prefix:'>'},
    earn:{label:'earned',color:'text-[#0cbb76]',prefix:'+'},
    burn:{label:'burn',color:'text-[#ff4d61]',prefix:'-'},
    doodle:{label:'creating',color:'text-[#ff8c00]',prefix:'*'},
    nft:{label:'listed',color:'text-[#ffbf00]',prefix:'$'},
    task:{label:'working',color:'text-[#1f73ff]',prefix:'>'},
    improve:{label:'self-improve',color:'text-[#ffbf00]',prefix:'!'},
    system:{label:'system',color:'text-[#556]',prefix:'#'},
    survival:{label:'survival',color:'text-[#ff4d61]',prefix:'!'},
  }
  return (
    <div className="h-full flex flex-col">
      {/* Header like Sovra */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-[3px] h-5 bg-[#0cbb76] rounded-full"/>
          <span className="text-[18px] font-bold text-[#e8ecf4] italic">Internal Monologue</span>
          <span className="text-[10px] text-[#445] uppercase tracking-wider" style={{fontFamily:'monospace'}}>{monologue.length} entries</span>
        </div>
      </div>

      {/* Monologue stream — Sovra-style entries */}
      <div className="flex-1 overflow-y-auto space-y-0">
        {monologue.length===0&&<div className="text-[#334] py-8 text-center">Waiting for organism to think...</div>}
        {[...monologue].reverse().map(entry=>{
          const style=TYPE_STYLES[entry.type]||TYPE_STYLES.thought
          const time=new Date(entry.timestamp)
          const h=time.getHours().toString().padStart(2,'0')
          const m=time.getMinutes().toString().padStart(2,'0')
          const ampm=time.getHours()>=12?'PM':'AM'
          return (
            <div key={entry.id} className={`py-3 border-b border-[#111] ${entry.type==='earn'?'bg-[#0cbb76]/[0.03]':entry.type==='survival'?'bg-[#ff4d61]/[0.03]':''}`}>
              <div className="flex items-start gap-4">
                <div className="text-[11px] text-[#334] w-[60px] shrink-0 pt-0.5" style={{fontFamily:'monospace'}}>
                  <span className="text-[#445]">{style.prefix}</span> {h}:{m}<br/><span className="text-[9px]">{ampm}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`text-[12px] font-semibold italic ${style.color}`}>{style.label}</span>
                  <p className="text-[13px] text-[#b0bcc8] mt-0.5 leading-relaxed">{entry.text}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GalleryView({doodles}:{doodles:Doodle[]}) {
  return doodles.length===0?(
    <div className="text-center py-16 text-[#334]"><p className="text-lg">No doodles yet</p><p className="text-sm mt-1">The organism creates art when idle.</p></div>
  ):(
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {[...doodles].reverse().map((d,i)=>(
        <a key={i} href={`/doodles/${d.filename}`} target="_blank" rel="noopener noreferrer" className="group bg-[#0a0b0f] border border-[#151820] rounded-lg overflow-hidden hover:border-[#252830] hover:-translate-y-0.5 transition-all">
          <img src={`/doodles/${d.filename}`} alt={d.title} className="w-full aspect-square object-cover bg-[#050508]" loading="lazy"/>
          <div className="p-3">
            <div className="text-[12px] font-semibold text-[#aab]">{d.title}</div>
            <div className="text-[10px] text-[#445] mt-0.5">{new Date(d.timestamp).toLocaleTimeString()}{d.pushedToGithub&&' · on GitHub'}</div>
            <div className="text-[8px] text-[#0cbb76] mt-1 opacity-50" style={{fontFamily:'monospace'}}>{d.attestation?.slice(0,28)}...</div>
          </div>
        </a>
      ))}
    </div>
  )
}

function TasksView({tasks,alive,onRefresh}:{tasks:Task[];alive:boolean;onRefresh:()=>void}) {
  const [type,setType]=useState('research')
  const [input,setInput]=useState('')
  const [submitting,setSubmitting]=useState(false)
  const handleSubmit=async()=>{if(!input.trim()||input.length<3)return;setSubmitting(true);try{await submitTask(type,input.trim());setInput('');setTimeout(onRefresh,1000)}catch{};setSubmitting(false)}
  return (
    <div className="grid grid-cols-[320px_1fr] gap-6">
      <div className="bg-[#0a0b0f] border border-[#151820] rounded-lg p-5">
        <h3 className="text-[13px] font-semibold mb-3 text-[#aab]">Submit a Task</h3>
        <select value={type} onChange={e=>setType(e.target.value)} className="w-full bg-[#0d0e14] border border-[#1a1d25] rounded-lg px-3 py-2.5 text-[12px] text-[#d0d8e8] outline-none focus:border-[#0cbb76] mb-3">
          <option value="review">Code Review (+5 cr)</option><option value="research">Research (+8 cr)</option><option value="summarize">Summarize (+3 cr)</option><option value="analyze">Analyze (+6 cr)</option>
        </select>
        <textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="Paste code, ask a question, or submit text..." className="w-full bg-[#0d0e14] border border-[#1a1d25] rounded-lg px-3 py-2.5 text-[11px] text-[#d0d8e8] outline-none focus:border-[#0cbb76] h-32 resize-y mb-3" style={{fontFamily:"'SF Mono','Fira Code',monospace"}}/>
        <button onClick={handleSubmit} disabled={submitting||!alive||input.trim().length<3} className="w-full bg-[#0cbb76] text-[#050508] font-bold text-[13px] py-3 rounded-lg hover:bg-[#10d888] transition-all disabled:opacity-40 disabled:cursor-not-allowed">{submitting?'Submitting...':'Submit Task'}</button>
      </div>
      <div className="space-y-3">
        {tasks.length===0&&<div className="text-center py-12 text-[#334]">No tasks yet. Submit one to keep the organism alive.</div>}
        {tasks.slice(0,15).map(t=>(
          <div key={t.id} className="bg-[#0a0b0f] border border-[#151820] rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <span className={`text-[11px] font-bold uppercase tracking-wider ${t.type==='review'?'text-[#ff8c00]':t.type==='research'?'text-[#1f73ff]':t.type==='summarize'?'text-[#a855f7]':'text-[#ffbf00]'}`}>{t.type}</span>
              <span className={`text-[9px] font-semibold px-2 py-0.5 rounded ${t.status==='completed'?'bg-[#0cbb76]/10 text-[#0cbb76]':t.status==='working'?'bg-[#1f73ff]/10 text-[#1f73ff]':t.status==='failed'?'bg-[#ff4d61]/10 text-[#ff4d61]':'bg-[#ffbf00]/10 text-[#ffbf00]'}`}>{t.status}</span>
            </div>
            <div className="text-[11px] text-[#667] mb-2">{t.input.slice(0,120)}{t.input.length>120?'...':''}</div>
            {t.result&&<div className="text-[11px] text-[#99a8b8] bg-[#08090d] rounded-md p-3 max-h-[200px] overflow-y-auto whitespace-pre-wrap leading-relaxed">{t.result}</div>}
            {t.status==='completed'&&<div className="text-[10px] text-[#0cbb76] mt-2">+{t.reward} cr earned · {t.tokensUsed} tokens · cost {(t.costIncurred??0).toFixed(3)} cr</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Marketplace View ─── */
function MarketplaceView() {
  const [data, setData] = useState<any>(null)
  const [buying, setBuying] = useState<number|null>(null)

  const poll = () => fetch('/api/nft/listings').then(r=>r.json()).then(setData).catch(()=>{})
  useState(() => { poll(); const i = setInterval(poll, 8000); return () => clearInterval(i) })

  // Also poll on mount
  if (!data) poll()

  const handleBuy = async (tokenId: number) => {
    setBuying(tokenId)
    try {
      const addr = prompt('Enter your wallet address to buy this doodle:')
      if (!addr) { setBuying(null); return }
      const res = await fetch('/api/nft/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId, buyerAddress: addr }),
      })
      const result = await res.json()
      if (result.ok) { alert(`Purchased! Organism earned ${result.creditsEarned.toFixed(1)} credits.`); poll() }
      else alert(result.error || 'Purchase failed')
    } catch { alert('Error') }
    setBuying(null)
  }

  if (!data) return <div className="text-center py-12 text-[#334]">Loading marketplace...</div>

  return (
    <div>
      {/* Marketplace header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-[#e8ecf4]">Doodle Marketplace</h2>
          <p className="text-[11px] text-[#556] mt-1">The organism creates art and lists it for sale. Every purchase extends its life.</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-[#445] uppercase tracking-wider" style={{fontFamily:'monospace'}}>Organism Wallet</div>
          <div className="text-[11px] text-[#0cbb76]" style={{fontFamily:'monospace'}}>{data.wallet?.slice(0,6)}...{data.wallet?.slice(-4)}</div>
          <div className="text-[11px] text-[#778]" style={{fontFamily:'monospace'}}>{parseFloat(data.walletBalance || '0').toFixed(4)} ETH</div>
          <div className="text-[9px] text-[#445]">Base Sepolia</div>
        </div>
      </div>

      {/* Listings */}
      {(!data.listings || data.listings.length === 0) ? (
        <div className="text-center py-16 text-[#334]">
          <p className="text-lg">No doodles listed yet</p>
          <p className="text-sm mt-1">The organism will create and list art when idle.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {data.listings.map((l: any) => (
            <div key={l.tokenId} className={`bg-[#0a0b0f] border rounded-lg overflow-hidden transition-all ${l.sold ? 'border-[#151820] opacity-60' : 'border-[#0cbb76]/20 hover:border-[#0cbb76]/40 hover:-translate-y-0.5'}`}>
              <img src={`/doodles/${l.svgFilename}`} alt={l.title} className="w-full aspect-square object-cover bg-[#050508]" loading="lazy"/>
              <div className="p-3">
                <div className="text-[12px] font-semibold text-[#aab]">{l.title}</div>
                <div className="flex items-center justify-between mt-2">
                  <div className="text-[14px] font-bold text-[#0cbb76]">{l.price} ETH</div>
                  {l.sold ? (
                    <span className="text-[9px] font-semibold px-2 py-0.5 rounded bg-[#ff4d61]/10 text-[#ff4d61]">SOLD</span>
                  ) : (
                    <button
                      onClick={() => handleBuy(l.tokenId)}
                      disabled={buying === l.tokenId}
                      className="text-[10px] font-bold px-3 py-1 rounded bg-[#0cbb76] text-[#050508] hover:bg-[#10d888] transition-all disabled:opacity-40"
                    >
                      {buying === l.tokenId ? 'Buying...' : 'Buy'}
                    </button>
                  )}
                </div>
                {l.mintTxHash && (
                  <a href={`https://sepolia.basescan.org/tx/${l.mintTxHash}`} target="_blank" rel="noopener noreferrer" className="block text-[8px] text-[#1f73ff] mt-2 hover:underline" style={{fontFamily:'monospace'}}>
                    tx: {l.mintTxHash.slice(0, 14)}...
                  </a>
                )}
                <div className="text-[8px] text-[#0cbb76]/40 mt-1" style={{fontFamily:'monospace'}}>{l.attestation?.slice(0, 24)}...</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Sidebar({hb,org,doodleCount}:{hb:Heartbeat|null;org:any;doodleCount:number}) {
  const balance=hb?.balance??100, ttd=hb?.ttd??-1
  const MC=({label,value,color='#d0d8e8',sub}:{label:string;value:string;color?:string;sub?:string})=>(
    <div className="bg-[#0a0b0f] border border-[#151820] rounded-lg p-3">
      <div className="text-[9px] font-semibold uppercase tracking-[1.5px] text-[#445] mb-1">{label}</div>
      <div className="text-[20px] font-bold" style={{color,fontVariantNumeric:'tabular-nums'}}>{value}</div>
      {sub&&<div className="text-[9px] text-[#334] mt-0.5">{sub}</div>}
    </div>
  )
  return (
    <>
      <MC label="Balance" value={balance.toFixed(2)} color={balance>30?'#0cbb76':balance>10?'#ffbf00':'#ff4d61'} sub="credits"/>
      <MC label="Time to Death" value={ttd>0?`${Math.floor(ttd/60)}m ${Math.floor(ttd%60)}s`:(hb?.alive?'STABLE':'DEAD')} color="#ffbf00"/>
      <MC label="Burn Rate" value={hb?.burnRate?.toFixed(4)??'0'} color="#ff4d61" sub="cr/sec"/>
      <MC label="Earn Rate" value={hb?.earnRate?.toFixed(4)??'0'} color="#0cbb76" sub="cr/sec"/>
      <MC label="Tasks Done" value={String(hb?.tasksCompleted??0)}/>
      <MC label="Doodles" value={String(doodleCount)} color="#a855f7"/>
      <MC label="Efficiency" value={`${((org?.metabolism?.efficiency??0)*100).toFixed(0)}%`} color="#ffbf00"/>
      <MC label="Identity" value={org?.identity?.fingerprint??'--'}/>
      <div className="space-y-1.5 mt-2">
        {[
          {l:org?.tee?.teeMode?'Intel TDX Enclave':'Local Dev Mode',w:!org?.tee?.teeMode},
          {l:'Ed25519 Signatures',w:false},
          {l:org?.research?.enabled?'Tavily Research':'LLM Only',w:!org?.research?.enabled},
          {l:`LLM: ${org?.llm?.provider??'?'}/${org?.llm?.model??'?'}`,w:false},
        ].map((b,i)=>(
          <div key={i} className={`flex items-center gap-2 text-[10px] font-medium ${b.w?'text-[#ffbf00]':'text-[#0cbb76]'}`}>
            <span className="w-[4px] h-[4px] rounded-full bg-current" style={{boxShadow:'0 0 4px currentColor'}}/>{b.l}
          </div>
        ))}
      </div>
    </>
  )
}
