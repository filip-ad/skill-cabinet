---
title: "ADR-0001: Use provider history for v1 usage totals"
status: "Accepted"
date: "2026-09-19"
authors:
  - "Filip (operator)"
tags: ["architecture", "usage", "privacy"]
authority: "Filip, operator chat, 2026-09-19: approved the minimal v1 re-scope after the two-call review limit found cross-source double counting."
supersedes: ""
superseded_by: ""
---

# ADR-0001: Use provider history for v1 usage totals

## Status

**Accepted.** The operator approved this minimal v1 boundary in chat on
2026-09-19.

## Context

- **CTX-001:** Provider history and the exact local recorder can observe the
  same skill invocation. They do not share a reliable invocation ID, so merging
  both streams can count one call twice.
- **CTX-002:** This decision covers v1 dashboard aggregates and snapshots. It
  does not delete recorder evidence or define later reconciliation.

## Decision Drivers

- **DRV-001:** Dashboard call totals must not knowingly combine overlapping
  evidence as separate invocations.
- **DRV-002:** V1 must avoid heuristic cross-source matching and added scope.

## Decision

- **DEC-001:** V1 dashboard totals and snapshots use provider-history imports
  only. The privacy-limited recorder log remains local and is not imported into
  the aggregate usage database.

## Consequences

### Positive

- **POS-001:** V1 has one defined source for usage totals and no cross-source
  double-count path.

### Negative

- **NEG-001:** Recorder-only observations, including Antigravity observations,
  do not appear in v1 dashboard totals.

### Risks and mitigations

- **RSK-001:** Provider history can omit calls that it cannot identify. The UI
  states the evidence limits, and unclear identities stay outside installation
  totals.

## Alternatives Considered

- **ALT-001:** Heuristic matching by session, skill, and time was rejected
  because it can merge distinct calls or retain duplicates without proof.

## Implementation Notes

- **IMP-001:** Deployment builds the snapshot from a fresh provider-history
  database so old recorder rows cannot remain in the published aggregates.

## Confirmation

- **CNF-001:** A snapshot-generation regression supplies a valid recorder event
  and proves that the resulting snapshot has zero invocations when the provider
  database is empty.

## Revisit Triggers

- **REV-001:** Revisit when provider and recorder records share a stable event
  identity, or when the operator approves a different authoritative source.

## References

- **REF-001:** https://github.com/filip-ad/skill-cabinet/issues/3
- **REF-002:** https://github.com/filip-ad/skill-cabinet/issues/5
