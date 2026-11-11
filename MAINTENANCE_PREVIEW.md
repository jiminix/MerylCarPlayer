# Maintenance preview (non-production)

Repository: MerylCarPlayer
Technology: Android

## Objective
Prepare a reversible, opt-in maintenance mode on this isolated branch.

## Implementation plan
Plan a maintenance activity/screen activated through an explicit build configuration. Do not disable existing installations remotely.

## Safety constraints
- Do not corrupt or delete application source files, data, credentials, or history.
- Do not merge to main or deploy to production automatically.
- Keep the default behavior unchanged until a separate reviewed release.
- Verify builds and provide rollback instructions before any rollout.

## Status
Planning document only. No executable application behavior has changed.
