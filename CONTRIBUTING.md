# Contributing to agent-commander

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this project.

## Project Structure

This is a multi-language project with both JavaScript/TypeScript and Rust implementations:

```
.
├── .github/workflows/    # GitHub Actions CI/CD
├── js/                   # JavaScript/TypeScript implementation
│   ├── src/              # Source code
│   ├── test/             # Tests
│   ├── examples/         # Usage examples
│   └── .changeset/       # JS changelog fragments
├── rust/                 # Rust implementation
│   ├── src/              # Source code
│   └── changelog.d/      # Rust changelog fragments
├── scripts/              # Shared and language-specific scripts
│   ├── js/               # JS-specific scripts
│   ├── rust/             # Rust-specific scripts
│   └── shared/           # Shared scripts
├── docs/                 # Documentation
├── .pre-commit-config.yaml  # Pre-commit hooks
├── CONTRIBUTING.md       # This file
├── LICENSE               # Unlicense (public domain)
└── README.md             # Project README
```

## Development Setup

### JavaScript/TypeScript

1. **Install Node.js** (20.x or later recommended)

2. **Install dependencies**

   ```bash
   cd js
   npm install
   ```

3. **Run quality checks**

   ```bash
   npm run lint           # Run ESLint
   npm run format:check   # Check Prettier formatting
   npm run check:duplication  # Check for code duplication
   npm test               # Run tests
   ```

### Rust

1. **Install Rust**

   Install Rust using rustup (if not already installed):

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Install development tools**

   ```bash
   rustup component add rustfmt clippy
   ```

3. **Build the project**

   ```bash
   cd rust
   cargo build
   ```

4. **Run quality checks**

   ```bash
   # Format code
   cargo fmt

   # Run Clippy lints
   cargo clippy --all-targets --all-features

   # Check file sizes
   node ../scripts/rust/check-file-size.mjs

   # Run all checks together
   cargo fmt --check && cargo clippy --all-targets --all-features && node ../scripts/rust/check-file-size.mjs
   ```

5. **Run tests**

   ```bash
   cargo test --all-features --verbose
   cargo test --doc --verbose
   ```

### Pre-commit Hooks (Optional but Recommended)

Install pre-commit hooks to automatically run quality checks before each commit:

```bash
pip install pre-commit
pre-commit install
```

## Development Workflow

1. **Create a feature branch**

   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes**

   - Write code following the project's style guidelines
   - Add tests for any new functionality
   - Update documentation as needed

3. **Add a changelog fragment**

   For JavaScript changes:
   ```bash
   # Create a changeset file in js/.changeset/
   cd js && npx changeset
   ```

   For Rust changes:
   ```bash
   # Create a new file in rust/changelog.d/
   touch rust/changelog.d/$(date +%Y%m%d_%H%M%S)_description.md
   ```

   Edit the file with your changes (see rust/changelog.d/README.md for format).

4. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

5. **Push and create a Pull Request**

   ```bash
   git push origin feature/my-feature
   ```

## Code Style Guidelines

### JavaScript/TypeScript

- ESLint and Prettier for code quality and formatting
- jscpd for duplicate code detection
- Follow existing patterns in the codebase

### Rust

This project uses:

- **rustfmt** for code formatting
- **Clippy** for linting with pedantic and nursery lints enabled
- File size limit of 1000 lines per file

#### Code Standards

- Follow Rust idioms and best practices
- Use documentation comments (`///`) for all public APIs
- Write tests for all new functionality
- Keep functions focused and reasonably sized
- Keep files under 1000 lines
- Use meaningful variable and function names

## Testing Guidelines

### JavaScript

```bash
cd js
npm test              # Run all tests
bun test              # Run with Bun
deno test --allow-read --allow-run --allow-env --allow-net test/**/*.test.mjs  # Run with Deno
```

### Rust

```bash
cd rust
cargo test --all-features --verbose    # Run all tests
cargo test --doc --verbose             # Run doc tests
cargo test test_name                   # Run specific test
```

## Changelog Management

This project uses fragment-based changelog systems:

### JavaScript (Changesets)

The JS package uses [Changesets](https://github.com/changesets/changesets):

```bash
cd js
npx changeset  # Create a new changeset interactively
```

### Rust (Changelog Fragments)

The Rust package uses a custom fragment system similar to [Scriv](https://scriv.readthedocs.io/):

```bash
# Create a fragment
touch rust/changelog.d/$(date +%Y%m%d_%H%M%S)_description.md
```

Fragment format:
```markdown
---
bump: patch
---

### Fixed
- Description of bug fix
```

See `rust/changelog.d/README.md` for detailed instructions.

## Pull Request Process

1. Ensure all tests pass locally
2. Update documentation if needed
3. Add a changelog fragment for user-facing changes
4. Ensure the PR description clearly describes the changes
5. Link any related issues in the PR description
6. Wait for CI checks to pass
7. Address any review feedback

## Release Process

This project uses automated releases through GitHub Actions:

### JavaScript

- Releases are triggered automatically when changesets are merged to main
- Or manually via workflow dispatch

### Rust

- Releases are triggered automatically when changelog fragments are merged to main
- Version bumping is determined by the bump type in changelog fragments
- Releases include GitHub release creation and (optionally) crates.io publishing

## Getting Help

- Open an issue for bugs or feature requests
- Use discussions for questions and general help
- Check existing issues and PRs before creating new ones

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

Thank you for contributing!
