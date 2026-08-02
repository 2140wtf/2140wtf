import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

const HEX_32 = /^[0-9a-f]{64}$/;
const COORD_30617 = /^30617:([0-9a-f]{64}):(.+)$/;

export interface WorkMilestoneV1 {
  id: string;
  title: string;
  amount_sats: number;
  criteria: string;
  criteria_hash: string;
  deadline: number;
  base_commit: string;
  max_verification_attempts: number;
  max_verification_fee_msats: number;
}

/** Frozen settlement input. Mutable Concord/NIP-34 metadata never replaces it. */
export interface WorkContractV1 {
  version: 1;
  campaign_id: string;
  creation_event_id: string;
  owner_pubkey: string;
  runner_pubkey: string;
  payout_pubkey: string;
  repository_coordinate: string;
  repository_event_id: string;
  repository_maintainers: string[];
  settlement_policy: { id: string; version: string; hash: string };
  verifier_pubkeys: string[];
  objection_window_seconds: number;
  appeal_window_seconds: number;
  amendment_rule: string;
  refund_rule: string;
  milestones: WorkMilestoneV1[];
}

export interface MilestoneEvidenceV1 {
  version: 1;
  contract_hash: string;
  campaign_id: string;
  milestone_id: string;
  repository_coordinate: string;
  issue_event_id?: string;
  base_commit: string;
  delivered_commit: string;
  delivered_tree: string;
  artifact_event_ids: string[];
  criteria_hash: string;
  archive: { url: string; sha256: string };
  test_command: string;
  workflow_hash: string;
  toolchain_hash: string;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical contracts cannot contain non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = canonicalValue(source[key]);
    }
    return out;
  }
  throw new Error("Canonical contracts contain JSON values only.");
}

export function canonicalWorkJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function workObjectHash(value: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalWorkJson(value))));
}

function requireHex(value: string, label: string): void {
  if (!HEX_32.test(value)) throw new Error(`${label} must be lowercase 32-byte hex.`);
}

/** Fail-closed validation used before a contract can be presented for funding. */
export function validateWorkContractV1(contract: WorkContractV1): WorkContractV1 {
  if (contract.version !== 1) throw new Error("Unsupported work contract version.");
  requireHex(contract.creation_event_id, "creation_event_id");
  requireHex(contract.owner_pubkey, "owner_pubkey");
  requireHex(contract.runner_pubkey, "runner_pubkey");
  requireHex(contract.payout_pubkey, "payout_pubkey");
  requireHex(contract.repository_event_id, "repository_event_id");
  requireHex(contract.settlement_policy.hash, "settlement_policy.hash");
  if (!COORD_30617.test(contract.repository_coordinate)) throw new Error("repository_coordinate must be a kind-30617 coordinate.");
  if (!contract.campaign_id || !contract.settlement_policy.id || !contract.settlement_policy.version) throw new Error("Contract identity and settlement policy are required.");
  if (!Number.isSafeInteger(contract.objection_window_seconds) || contract.objection_window_seconds < 0 || !Number.isSafeInteger(contract.appeal_window_seconds) || contract.appeal_window_seconds < 0) throw new Error("Review windows must be non-negative safe integers.");
  const maintainers = new Set(contract.repository_maintainers);
  const verifiers = new Set(contract.verifier_pubkeys);
  if (!maintainers.size || !verifiers.size || maintainers.size !== contract.repository_maintainers.length || verifiers.size !== contract.verifier_pubkeys.length) throw new Error("Maintainer and verifier sets must be non-empty and unique.");
  contract.repository_maintainers.forEach((key) => requireHex(key, "repository maintainer"));
  contract.verifier_pubkeys.forEach((key) => requireHex(key, "verifier pubkey"));
  const ids = new Set<string>();
  if (!contract.milestones.length) throw new Error("At least one milestone is required.");
  for (const milestone of contract.milestones) {
    if (!milestone.id || ids.has(milestone.id)) throw new Error("Milestone ids must be non-empty and unique.");
    ids.add(milestone.id);
    requireHex(milestone.criteria_hash, "criteria_hash");
    requireHex(milestone.base_commit, "base_commit");
    if (workObjectHash(milestone.criteria) !== milestone.criteria_hash) throw new Error(`Milestone ${milestone.id} criteria hash does not match.`);
    if (!Number.isSafeInteger(milestone.amount_sats) || milestone.amount_sats <= 0 || !Number.isSafeInteger(milestone.deadline) || milestone.deadline <= 0 || !Number.isSafeInteger(milestone.max_verification_attempts) || milestone.max_verification_attempts < 1 || !Number.isSafeInteger(milestone.max_verification_fee_msats) || milestone.max_verification_fee_msats < 0) throw new Error(`Milestone ${milestone.id} has invalid numeric limits.`);
  }
  return contract;
}

/** Validate immutable delivery evidence against one already-validated contract. */
export function validateMilestoneEvidenceV1(evidence: MilestoneEvidenceV1, contract: WorkContractV1): MilestoneEvidenceV1 {
  validateWorkContractV1(contract);
  if (evidence.version !== 1 || evidence.contract_hash !== workObjectHash(contract) || evidence.campaign_id !== contract.campaign_id || evidence.repository_coordinate !== contract.repository_coordinate) throw new Error("Evidence does not bind to this contract.");
  const milestone = contract.milestones.find((item) => item.id === evidence.milestone_id);
  if (!milestone || evidence.base_commit !== milestone.base_commit || evidence.criteria_hash !== milestone.criteria_hash) throw new Error("Evidence does not bind to the milestone terms.");
  [evidence.delivered_commit, evidence.delivered_tree, evidence.archive.sha256, evidence.workflow_hash, evidence.toolchain_hash, ...evidence.artifact_event_ids].forEach((value) => requireHex(value, "evidence hash/id"));
  if (evidence.issue_event_id) requireHex(evidence.issue_event_id, "issue_event_id");
  let archive: URL;
  try { archive = new URL(evidence.archive.url); } catch { throw new Error("Evidence archive URL is invalid."); }
  if (archive.protocol !== "https:") throw new Error("Evidence archive URL must use HTTPS.");
  if (!evidence.test_command.trim()) throw new Error("Evidence test command is required.");
  return evidence;
}
