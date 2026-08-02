import { describe, expect, it } from "vitest";

import { canonicalWorkJson, validateMilestoneEvidenceV1, validateWorkContractV1, workObjectHash, type MilestoneEvidenceV1, type WorkContractV1 } from "./baoWorkContract";

const h = (digit: string) => digit.repeat(64);
const criteria = "All tests pass for the exact committed source tree.";
const contract = (): WorkContractV1 => ({
  version: 1, campaign_id: "fr_1", creation_event_id: h("1"), owner_pubkey: h("2"), runner_pubkey: h("3"), payout_pubkey: h("4"),
  repository_coordinate: `30617:${h("2")}:bao`, repository_event_id: h("5"), repository_maintainers: [h("2")],
  settlement_policy: { id: "demo-attestation", version: "1", hash: h("6") }, verifier_pubkeys: [h("7")], objection_window_seconds: 3600,
  appeal_window_seconds: 7200, amendment_rule: "owner+runner+donor-majority", refund_rule: "refund on timeout",
  milestones: [{ id: "m1", title: "Ship", amount_sats: 21000, criteria, criteria_hash: workObjectHash(criteria), deadline: 2_000_000_000, base_commit: h("8"), max_verification_attempts: 2, max_verification_fee_msats: 21000 }],
});

describe("funded work contracts", () => {
  it("hashes object keys canonically and changes when terms change", () => {
    expect(canonicalWorkJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    const original = contract();
    const changed = { ...original, milestones: [{ ...original.milestones[0], amount_sats: 21001 }] };
    expect(workObjectHash(original)).not.toBe(workObjectHash(changed));
  });

  it("rejects criteria mutation and duplicate authorities", () => {
    expect(validateWorkContractV1(contract())).toBeTruthy();
    const changed = contract(); changed.milestones[0].criteria = "something else";
    expect(() => validateWorkContractV1(changed)).toThrow(/criteria hash/);
    const duplicate = contract(); duplicate.verifier_pubkeys.push(duplicate.verifier_pubkeys[0]);
    expect(() => validateWorkContractV1(duplicate)).toThrow(/unique/);
  });

  it("binds evidence to the exact contract and milestone", () => {
    const c = contract();
    const evidence: MilestoneEvidenceV1 = { version: 1, contract_hash: workObjectHash(c), campaign_id: c.campaign_id, milestone_id: "m1", repository_coordinate: c.repository_coordinate, base_commit: h("8"), delivered_commit: h("9"), delivered_tree: h("a"), artifact_event_ids: [h("b")], criteria_hash: c.milestones[0].criteria_hash, archive: { url: "https://example.com/source.tar.gz", sha256: h("c") }, test_command: "npm test", workflow_hash: h("d"), toolchain_hash: h("e") };
    expect(validateMilestoneEvidenceV1(evidence, c)).toBe(evidence);
    expect(() => validateMilestoneEvidenceV1({ ...evidence, delivered_commit: h("f"), contract_hash: h("0") }, c)).toThrow(/contract/);
  });
});
