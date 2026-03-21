import { useState, useEffect } from 'react'
import type { Heartbeat, OrganismData, Task, Doodle, EarningsEntry } from '../types'

const API = ''

export function useHeartbeat() {
  const [hb, setHb] = useState<Heartbeat | null>(null)
  useEffect(() => {
    const poll = () => fetch(`${API}/api/heartbeat`).then(r => r.json()).then(setHb).catch(() => {})
    poll()
    const i = setInterval(poll, 2000)
    return () => clearInterval(i)
  }, [])
  return hb
}

export function useOrganism() {
  const [org, setOrg] = useState<OrganismData | null>(null)
  useEffect(() => {
    const poll = () => fetch(`${API}/api/organism`).then(r => r.json()).then(setOrg).catch(() => {})
    poll()
    const i = setInterval(poll, 10000)
    return () => clearInterval(i)
  }, [])
  return org
}

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const refresh = () => fetch(`${API}/api/tasks`).then(r => r.json()).then(setTasks).catch(() => {})
  useEffect(() => { refresh(); const i = setInterval(refresh, 5000); return () => clearInterval(i) }, [])
  return { tasks, refresh }
}

export function useDoodles() {
  const [doodles, setDoodles] = useState<Doodle[]>([])
  useEffect(() => {
    const poll = () => fetch(`${API}/api/doodles`).then(r => r.json()).then(setDoodles).catch(() => {})
    poll()
    const i = setInterval(poll, 10000)
    return () => clearInterval(i)
  }, [])
  return doodles
}

export function useEarnings() {
  const [log, setLog] = useState<EarningsEntry[]>([])
  useEffect(() => {
    const poll = () => fetch(`${API}/api/earnings`).then(r => r.json()).then(setLog).catch(() => {})
    poll()
    const i = setInterval(poll, 4000)
    return () => clearInterval(i)
  }, [])
  return log
}

export interface MonologueEntry {
  id: number
  type: string
  text: string
  timestamp: number
}

export function useMonologue() {
  const [entries, setEntries] = useState<MonologueEntry[]>([])
  useEffect(() => {
    const poll = () => fetch(`${API}/api/monologue`).then(r => r.json()).then(setEntries).catch(() => {})
    poll()
    const i = setInterval(poll, 3000)
    return () => clearInterval(i)
  }, [])
  return entries
}

export async function submitTask(type: string, input: string) {
  const res = await fetch(`${API}/api/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, input }),
  })
  return res.json()
}
