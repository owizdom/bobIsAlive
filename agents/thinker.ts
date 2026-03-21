/**
 * Thinker — Minimal LLM provider tracking for the Digital Organism.
 * Tracks which provider is active, system prompt hash, model name.
 */

import crypto from "crypto";
import type { LLMConfig } from "./organism-types";

let activeProvider: LLMConfig["provider"] = "eigenai";
let activeModelName = "unknown";
let systemPromptHashValue: string | null = null;

export function initThinker(config: LLMConfig): void {
  activeProvider = config.provider;
  activeModelName = config.model;
  systemPromptHashValue = crypto
    .createHash("sha256")
    .update(`${config.provider}:${config.model}:organism-v1`)
    .digest("hex");
  console.log(`[THINKER] Initialized: ${config.provider} / ${config.model}`);
  console.log(`[THINKER] Prompt hash: sha256:${systemPromptHashValue.slice(0, 24)}...`);
}

export function getActiveLLMProvider(): LLMConfig["provider"] { return activeProvider; }
export function getModelName(): string { return activeModelName; }
export function getSystemPromptHash(): string | null {
  return systemPromptHashValue ? `sha256:${systemPromptHashValue}` : null;
}
