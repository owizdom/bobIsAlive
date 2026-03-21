/**
 * Self-Work Module — Self-improvement + Doodle Art Generation
 *
 * When idle, the organism does two things:
 * 1. Reads its own code and proposes improvements (autoresearch-style)
 * 2. Generates procedural doodle art (SVGs) — weird shapes, silly patterns
 *
 * Doodles are pushed to GitHub. The organism is a creative entity
 * that makes art to stay relevant. Each doodle is Ed25519-attested.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Metabolism } from "./metabolism";
import { buildAttestation } from "./keystore";
import { listDoodle, isNFTEnabled } from "./nft";

// ═══════════════════════════════════════════════════════════════
// DOODLE ART GENERATOR — Procedural SVG
// ═══════════════════════════════════════════════════════════════

const PALETTES = [
  ["#ff4d61", "#ff8c00", "#ffbf00", "#0cbb76", "#1f73ff", "#a855f7"],
  ["#00ffcc", "#ff006e", "#3a86ff", "#ffbe0b", "#fb5607"],
  ["#e0aaff", "#c77dff", "#9d4edd", "#7b2cbf", "#5a189a"],
  ["#06d6a0", "#118ab2", "#073b4c", "#ef476f", "#ffd166"],
  ["#f72585", "#b5179e", "#7209b7", "#560bad", "#480ca8", "#3f37c9"],
];

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateDoodle(seed: string): { svg: string; title: string; description: string } {
  const palette = pick(PALETTES);
  const bg = "#0a0e1a";
  const w = 800, h = 800;
  let shapes = "";

  const shapeCount = randInt(8, 25);
  const doodleTypes = ["circles", "triangles", "squiggles", "blobs", "stars", "grid"];
  const style = pick(doodleTypes);

  for (let i = 0; i < shapeCount; i++) {
    const color = pick(palette);
    const opacity = rand(0.3, 0.9).toFixed(2);
    const cx = rand(50, w - 50);
    const cy = rand(50, h - 50);

    switch (style) {
      case "circles": {
        const r = rand(10, 120);
        const strokeW = rand(1, 4).toFixed(1);
        if (Math.random() > 0.4) {
          shapes += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${opacity}"/>`;
        } else {
          shapes += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeW}" opacity="${opacity}"/>`;
        }
        break;
      }
      case "triangles": {
        const s = rand(20, 100);
        const x1 = cx, y1 = cy - s;
        const x2 = cx - s * 0.87, y2 = cy + s * 0.5;
        const x3 = cx + s * 0.87, y3 = cy + s * 0.5;
        const rot = rand(0, 360).toFixed(0);
        shapes += `<polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3}" fill="${color}" opacity="${opacity}" transform="rotate(${rot} ${cx} ${cy})"/>`;
        break;
      }
      case "squiggles": {
        const points: string[] = [];
        let px = cx, py = cy;
        for (let j = 0; j < randInt(4, 10); j++) {
          px += rand(-80, 80);
          py += rand(-80, 80);
          points.push(`${px.toFixed(0)},${py.toFixed(0)}`);
        }
        const strokeW = rand(2, 6).toFixed(1);
        shapes += `<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
        break;
      }
      case "blobs": {
        const r = rand(30, 100);
        const points: string[] = [];
        const segments = randInt(5, 9);
        for (let j = 0; j <= segments; j++) {
          const angle = (j / segments) * Math.PI * 2;
          const jitter = rand(0.6, 1.4);
          const bx = cx + Math.cos(angle) * r * jitter;
          const by = cy + Math.sin(angle) * r * jitter;
          points.push(`${j === 0 ? "M" : "L"}${bx.toFixed(0)},${by.toFixed(0)}`);
        }
        shapes += `<path d="${points.join(" ")}Z" fill="${color}" opacity="${opacity}"/>`;
        break;
      }
      case "stars": {
        const outerR = rand(20, 80);
        const innerR = outerR * rand(0.3, 0.6);
        const spikes = randInt(4, 8);
        const pts: string[] = [];
        for (let j = 0; j < spikes * 2; j++) {
          const angle = (j * Math.PI) / spikes - Math.PI / 2;
          const r2 = j % 2 === 0 ? outerR : innerR;
          pts.push(`${(cx + Math.cos(angle) * r2).toFixed(0)},${(cy + Math.sin(angle) * r2).toFixed(0)}`);
        }
        shapes += `<polygon points="${pts.join(" ")}" fill="${color}" opacity="${opacity}"/>`;
        break;
      }
      case "grid": {
        const size = rand(15, 40);
        const rot = rand(0, 45).toFixed(0);
        shapes += `<rect x="${cx}" y="${cy}" width="${size}" height="${size}" fill="${color}" opacity="${opacity}" rx="${rand(0, 8).toFixed(0)}" transform="rotate(${rot} ${cx + size / 2} ${cy + size / 2})"/>`;
        break;
      }
    }
  }

  // Add some accent elements
  for (let i = 0; i < randInt(2, 6); i++) {
    const color = pick(palette);
    shapes += `<circle cx="${rand(0, w)}" cy="${rand(0, h)}" r="${rand(2, 6)}" fill="${color}" opacity="0.8"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="${bg}"/>
${shapes}
<text x="${w / 2}" y="${h - 20}" text-anchor="middle" fill="#334" font-family="monospace" font-size="10">organism:${seed.slice(0, 12)} | ${style}</text>
</svg>`;

  const titles = [
    `${style} dream #${randInt(100, 999)}`,
    `untitled ${style} (${new Date().toISOString().slice(0, 10)})`,
    `organism thought: ${style}`,
    `survival doodle #${randInt(1, 500)}`,
    `idle ${style} sketch`,
    `generated while waiting to live`,
    `${style} from the void`,
  ];

  return {
    svg,
    title: pick(titles),
    description: `Procedural ${style} doodle generated autonomously by the Digital Organism while idle. ${shapeCount} shapes, palette: ${palette.join(", ")}. TEE-attested.`,
  };
}

// ═══════════════════════════════════════════════════════════════
// SELF-IMPROVEMENT — Read own code, propose improvements
// ═══════════════════════════════════════════════════════════════

const SELF_IMPROVEMENT_TARGETS = [
  "agents/organism.ts",
  "agents/task-engine.ts",
  "agents/metabolism.ts",
  "agents/orchestrator.ts",
];

let improvementLog: Array<{
  file: string;
  proposal: string;
  timestamp: number;
}> = [];

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

let doodleLog: Array<{
  title: string;
  description: string;
  filename: string;
  timestamp: number;
  attestation: string;
  pushedToGithub: boolean;
}> = [];

let selfWorkCount = 0;

export function getDoodleLog() {
  return doodleLog;
}

export function getImprovementLog() {
  return improvementLog;
}

/**
 * Do one round of self-work: alternate between doodle art and self-improvement.
 */
export async function doSelfWork(
  metabolism: Metabolism,
  agentId: string,
  privateKey: string,
  publicKey: string
): Promise<{ type: "doodle" | "improve"; detail: string } | null> {
  selfWorkCount++;

  // Alternate: mostly doodles (visual), occasionally self-improvement
  if (selfWorkCount % 3 === 0) {
    return doSelfImprovement(agentId);
  } else {
    return doDoodle(metabolism, agentId, privateKey, publicKey);
  }
}

async function doDoodle(
  metabolism: Metabolism,
  agentId: string,
  privateKey: string,
  publicKey: string
): Promise<{ type: "doodle"; detail: string } | null> {
  const seed = crypto.randomBytes(8).toString("hex");
  const { svg, title, description } = generateDoodle(seed);

  // Save locally
  const outputDir = path.join(process.cwd(), "doodles");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${ts}-${seed.slice(0, 8)}.svg`;
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, svg);

  // Attestation
  const attestation = buildAttestation(
    `doodle:${seed}:${title}`,
    agentId, Date.now(), privateKey, publicKey
  );

  console.log(`[DOODLE] Created: "${title}" → ${filename}`);

  // Push to GitHub
  let pushed = false;
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
    try {
      await pushToGitHub(`doodles/${filename}`, svg);
      pushed = true;
      console.log(`[DOODLE] Pushed to GitHub`);
    } catch (e) {
      console.warn(`[DOODLE] GitHub push failed: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }

  // List as NFT for sale
  let nftListed = false;
  try {
    await listDoodle(title, description, filename, attestation);
    nftListed = true;
  } catch (e) {
    console.warn(`[DOODLE] NFT listing failed: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
  }

  const entry = { title, description, filename, timestamp: Date.now(), attestation, pushedToGithub: pushed, nftListed };
  doodleLog.push(entry);
  if (doodleLog.length > 100) doodleLog.shift();

  return { type: "doodle", detail: title };
}

async function doSelfImprovement(agentId: string): Promise<{ type: "improve"; detail: string } | null> {
  // Pick a random source file to analyze
  const target = pick(SELF_IMPROVEMENT_TARGETS);
  const fullPath = path.join(process.cwd(), target);

  try {
    if (!fs.existsSync(fullPath)) return null;
    const code = fs.readFileSync(fullPath, "utf8");
    const lines = code.split("\n").length;

    // Simple static analysis — no LLM needed (saves credits!)
    const analysis: string[] = [];
    if (code.includes("TODO")) analysis.push("Found TODO comments — incomplete work");
    if (code.includes("catch {}") || code.includes("catch { }")) analysis.push("Empty catch blocks — errors silently swallowed");
    if (lines > 200) analysis.push(`File is ${lines} lines — could be split for clarity`);
    if (!code.includes("export")) analysis.push("No exports — dead module?");

    const proposal = analysis.length > 0
      ? `[${target}] ${analysis.join("; ")}`
      : `[${target}] Code looks clean (${lines} lines, no obvious issues)`;

    console.log(`[SELF-IMPROVE] ${proposal.slice(0, 80)}`);

    improvementLog.push({ file: target, proposal, timestamp: Date.now() });
    if (improvementLog.length > 50) improvementLog.shift();

    return { type: "improve", detail: proposal };
  } catch {
    return null;
  }
}

async function pushToGitHub(filepath: string, content: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return;

  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filepath}`;
  const res = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github.v3+json",
    },
    body: JSON.stringify({
      message: `[organism] doodle: ${filepath}`,
      content: Buffer.from(content).toString("base64"),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 100)}`);
  }
}
