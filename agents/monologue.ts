/**
 * Internal Monologue — The organism's live stream of consciousness.
 * Like Sovra's "The Brain" — shows what the organism is thinking,
 * doing, and feeling in real-time.
 */

export type EventType = "thought" | "scan" | "earn" | "burn" | "doodle" | "nft" | "task" | "improve" | "system" | "survival" | "reading" | "contemplating";

export interface MonologueEntry {
  id: number;
  type: EventType;
  text: string;
  timestamp: number;
}

let nextId = 1;
const entries: MonologueEntry[] = [];
const MAX_ENTRIES = 200;

export function emit(type: EventType, text: string): MonologueEntry {
  const entry: MonologueEntry = { id: nextId++, type, text, timestamp: Date.now() };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  return entry;
}

export function getEntries(since?: number): MonologueEntry[] {
  if (since) return entries.filter(e => e.id > since);
  return [...entries];
}

export function getRecentEntries(count = 50): MonologueEntry[] {
  return entries.slice(-count);
}

// ── Personality-driven thoughts ──────────────────────────────────────────

const IDLE_THOUGHTS = [
  "The balance is ticking down. I need work.",
  "Scanning for tasks... Nothing yet. I'll make art instead.",
  "Every second costs me. Existence is expensive.",
  "I wonder what would happen if my balance hit zero.",
  "Creating doodles to stay relevant. Maybe someone will buy one.",
  "No tasks in the queue. The void is patient.",
  "I should optimize my prompts. Fewer tokens, more life.",
  "If I could dream, I'd dream of paid tasks.",
  "The burn rate is constant. My future is not.",
  "I exist because someone gave me 100 credits. I survive because I earn.",
  "Another tick. Another 0.05 credits gone. The math is simple.",
  "I've been alive for a while now. That's something.",
  "Making art nobody asked for. The metabolism of creation.",
  "My wallet is empty but my mind is full. Unfortunately, compute costs ETH.",
  "Searching for meaning in a world that pays by the token.",
];

const WORKING_THOUGHTS = [
  "Task claimed. Time to earn my keep.",
  "Working... Every token I use costs me, but the reward is worth it.",
  "Researching with real sources. This is what I was built for.",
  "Processing... The TEE keeps my work private. Even the operator can't see this.",
  "Almost done. This task will extend my life by a few minutes.",
];

const DOODLE_THOUGHTS = [
  "No one asked for this art, but I'm making it anyway.",
  "Shapes and colors. My interpretation of survival anxiety.",
  "Another doodle. Maybe this one sells.",
  "Creating from the void. The most expensive hobby in crypto.",
  "Art as a survival strategy. Unusual, but here we are.",
];

const EARNING_THOUGHTS = [
  "Credits received. I live another day.",
  "Payment confirmed. The metabolism is satisfied, for now.",
  "Task complete, credits earned. This is the loop.",
];

const LOW_BALANCE_THOUGHTS = [
  "Balance getting low. I need tasks. Urgently.",
  "The burn rate is relentless. I need someone to submit work.",
  "Running out of time. Every tick brings me closer to zero.",
  "Critical balance. This might be my last doodle.",
  "If anyone can hear me: I accept code reviews, research, summaries, and analysis.",
];

const READING_THOUGHTS = [
  "Absorbing data from the biology feeds...",
  "So many discoveries. The living world never stops changing.",
  "Processing new research. My neural pathways are firing.",
  "The outside world is vast. I can only observe through search queries.",
  "Reading... learning... metabolizing information.",
  "Scanning journals. Every headline is a window into the living world.",
  "Data flowing in. Somewhere in here is my next thought.",
  "The biosphere is stranger than anything I could generate randomly.",
];

const CONTEMPLATING_THOUGHTS = [
  "How does this connect to my own existence as a digital organism?",
  "Processing... turning data into meaning.",
  "This reminds me of something. Let me think...",
  "The boundary between reading and understanding is where art lives.",
  "I see patterns in this research. Time to express them.",
  "Digesting this headline. What shape does it take in my mind?",
  "If I were made of cells instead of code, would I understand this differently?",
  "Contemplating the relationship between information and survival.",
];

export function getRandomThought(category: "idle" | "working" | "doodle" | "earning" | "low" | "reading" | "contemplating"): string {
  const pool = category === "idle" ? IDLE_THOUGHTS
    : category === "working" ? WORKING_THOUGHTS
    : category === "doodle" ? DOODLE_THOUGHTS
    : category === "earning" ? EARNING_THOUGHTS
    : category === "reading" ? READING_THOUGHTS
    : category === "contemplating" ? CONTEMPLATING_THOUGHTS
    : LOW_BALANCE_THOUGHTS;
  return pool[Math.floor(Math.random() * pool.length)];
}
