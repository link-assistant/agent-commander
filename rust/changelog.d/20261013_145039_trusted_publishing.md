---
bump: patch
---

### Changed
- Publish to crates.io through GitHub Actions trusted publishing (OIDC), falling back to the `CARGO_REGISTRY_TOKEN`/`CARGO_TOKEN` secrets when a trusted publishing token is unavailable.
