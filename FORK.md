# Fork provenance

- Upstream: `subsy/skill-cabinet`
- Approved base: `e6c5303245cc3ad33a5c027bbea49fd84d008da6` (`v0.3.0`)
- License: MIT, preserved in `LICENSE`
- Local owner: `filip-ad/skill-cabinet`
- Governing tracker: `filip-ad/agent-skills#47`

## Local delta

This fork is a read-only presentation layer for the governed `agent-skills`
registry. It replaces upstream file-system discovery with generated inventory
and currency JSON. It removes all skill mutation code and controls. It adds a
local SQLite usage index, privacy-limited provider adapters, an exact recorder,
GET-only local APIs, and the governed overview interface.

## Upstream update method

Review a proposed upstream commit against the exact base above. Preserve the
read-only route tests and the registry data boundary. Do not merge an upstream
mutation route, control, scanner, or remote data source. Record each accepted
upstream base change in this file and in the governing issue.
