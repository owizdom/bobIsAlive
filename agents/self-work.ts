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
  const doodleTypes = [
    "circles", "triangles", "squiggles", "blobs", "stars", "grid",
    "pixels", "waves", "spirals", "constellation", "cells", "glitch",
  ];
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
      case "pixels": {
        // Pixel art clusters — chunky retro blocks
        const gridSize = randInt(8, 20);
        const blockSize = rand(12, 30);
        for (let gx = 0; gx < gridSize; gx++) {
          for (let gy = 0; gy < gridSize; gy++) {
            if (Math.random() > 0.5) {
              const px = cx - (gridSize * blockSize) / 2 + gx * blockSize;
              const py = cy - (gridSize * blockSize) / 2 + gy * blockSize;
              const pc = pick(palette);
              shapes += `<rect x="${px}" y="${py}" width="${blockSize}" height="${blockSize}" fill="${pc}" opacity="${rand(0.4, 0.95).toFixed(2)}"/>`;
            }
          }
        }
        break;
      }
      case "waves": {
        // Layered sine waves
        const waveY = rand(100, h - 100);
        const amp = rand(20, 80);
        const freq = rand(0.005, 0.02);
        const phase = rand(0, Math.PI * 2);
        let d = `M0,${waveY}`;
        for (let x = 0; x <= w; x += 4) {
          const y = waveY + Math.sin(x * freq + phase + i * 0.5) * amp + Math.sin(x * freq * 2.3 + i) * (amp * 0.3);
          d += ` L${x},${y.toFixed(1)}`;
        }
        const strokeW = rand(1.5, 5).toFixed(1);
        shapes += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" opacity="${opacity}"/>`;
        break;
      }
      case "spirals": {
        // Fibonacci-style spirals
        let d = `M${cx},${cy}`;
        const turns = rand(3, 8);
        const growth = rand(1.5, 4);
        const steps = randInt(60, 120);
        for (let j = 0; j < steps; j++) {
          const angle = (j / steps) * turns * Math.PI * 2;
          const r2 = (j / steps) * growth * 60;
          const sx = cx + Math.cos(angle) * r2;
          const sy = cy + Math.sin(angle) * r2;
          d += ` L${sx.toFixed(1)},${sy.toFixed(1)}`;
        }
        const strokeW = rand(1, 4).toFixed(1);
        shapes += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" opacity="${opacity}"/>`;
        break;
      }
      case "constellation": {
        // Connected dots like star maps
        const nodeCount = randInt(3, 8);
        const nodes: [number, number][] = [];
        for (let j = 0; j < nodeCount; j++) {
          nodes.push([cx + rand(-120, 120), cy + rand(-120, 120)]);
        }
        // Draw connections
        for (let j = 0; j < nodes.length; j++) {
          for (let k = j + 1; k < nodes.length; k++) {
            if (Math.random() > 0.4) {
              shapes += `<line x1="${nodes[j][0]}" y1="${nodes[j][1]}" x2="${nodes[k][0]}" y2="${nodes[k][1]}" stroke="${color}" stroke-width="0.8" opacity="${(parseFloat(opacity) * 0.5).toFixed(2)}"/>`;
            }
          }
        }
        // Draw nodes
        for (const [nx, ny] of nodes) {
          const nr = rand(3, 8);
          shapes += `<circle cx="${nx}" cy="${ny}" r="${nr}" fill="${color}" opacity="${opacity}"/>`;
          shapes += `<circle cx="${nx}" cy="${ny}" r="${nr * 2.5}" fill="none" stroke="${color}" stroke-width="0.5" opacity="${(parseFloat(opacity) * 0.2).toFixed(2)}"/>`;
        }
        break;
      }
      case "cells": {
        // Organic cell-like structures with membranes
        const cellR = rand(30, 90);
        const membrane = randInt(6, 12);
        let d = "";
        for (let j = 0; j <= membrane; j++) {
          const angle = (j / membrane) * Math.PI * 2;
          const jitter = rand(0.7, 1.3);
          const mx = cx + Math.cos(angle) * cellR * jitter;
          const my = cy + Math.sin(angle) * cellR * jitter;
          d += j === 0 ? `M${mx.toFixed(0)},${my.toFixed(0)}` : ` Q${(cx + Math.cos(angle - 0.3) * cellR * rand(0.8, 1.5)).toFixed(0)},${(cy + Math.sin(angle - 0.3) * cellR * rand(0.8, 1.5)).toFixed(0)} ${mx.toFixed(0)},${my.toFixed(0)}`;
        }
        shapes += `<path d="${d}Z" fill="${color}" opacity="${(parseFloat(opacity) * 0.3).toFixed(2)}"/>`;
        shapes += `<path d="${d}Z" fill="none" stroke="${color}" stroke-width="${rand(1.5, 3).toFixed(1)}" opacity="${opacity}"/>`;
        // Nucleus inside
        const nucX = cx + rand(-cellR * 0.2, cellR * 0.2);
        const nucY = cy + rand(-cellR * 0.2, cellR * 0.2);
        shapes += `<circle cx="${nucX}" cy="${nucY}" r="${cellR * rand(0.15, 0.3)}" fill="${pick(palette)}" opacity="${(parseFloat(opacity) * 0.6).toFixed(2)}"/>`;
        break;
      }
      case "glitch": {
        // Horizontal glitch bars with offset colors
        const barCount = randInt(3, 12);
        for (let j = 0; j < barCount; j++) {
          const by = rand(0, h);
          const bh = rand(2, 30);
          const bx = rand(-20, w * 0.3);
          const bw = rand(w * 0.3, w * 1.2);
          const gc = pick(palette);
          const offset = rand(-15, 15);
          shapes += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${gc}" opacity="${rand(0.15, 0.6).toFixed(2)}"/>`;
          shapes += `<rect x="${bx + offset}" y="${by + rand(-3, 3)}" width="${bw * rand(0.3, 0.8)}" height="${bh * 0.6}" fill="${pick(palette)}" opacity="${rand(0.1, 0.4).toFixed(2)}"/>`;
        }
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

  const prefixes = [
    "mitosis", "membrane", "synapse", "nucleus", "cytoplasm",
    "organelle", "flagella", "ribosome", "enzyme", "helix",
    "cortex", "dendrite", "axon", "vesicle", "chromatin",
  ];
  const suffixes = [
    "division", "pulse", "signal", "bloom", "mutation",
    "drift", "cascade", "fission", "respiration", "oscillation",
  ];
  const prefix = pick(prefixes);
  const suffix = pick(suffixes);
  const titles = [
    `${prefix} ${suffix} #${randInt(100, 999)}`,
    `${prefix} under pressure`,
    `${style}: cellular ${suffix}`,
    `bob's ${prefix} dream`,
    `survival ${suffix} #${randInt(1, 500)}`,
    `metabolic ${style} — ${prefix}`,
    `${prefix} at ${(100 - randInt(0, 99))}% vitality`,
    `the ${prefix} remembers`,
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
