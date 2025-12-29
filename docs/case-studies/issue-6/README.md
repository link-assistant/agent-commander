# Case Study: JavaScript to Rust Translation

**Issue:** [#6 - Add Rust code translation](https://github.com/link-assistant/agent-commander/issues/6)

This document captures lessons learned from translating the agent-commander library from JavaScript/ESM to Rust.

## Overview

The translation involved converting approximately 15 JavaScript modules into idiomatic Rust code while maintaining API parity. The resulting Rust crate provides the same functionality: controlling CLI agents (claude, codex, opencode, agent) with isolation options (none, screen, docker).

## Key Translation Patterns

### 1. Optional Parameters

**JavaScript:**
```javascript
function parseNdjsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // ...
}
```

**Rust:**
```rust
pub fn parse_ndjson_line(line: &str) -> Option<Value> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    // ...
}
```

**Lesson:** JavaScript's `null` maps naturally to Rust's `Option<T>`. This provides better type safety and forces callers to handle the absent case.

### 2. Object Destructuring to Structs

**JavaScript:**
```javascript
const options = {
  tool: 'claude',
  working_directory: '/tmp',
  isolation: 'none',
  // ...
};
```

**Rust:**
```rust
#[derive(Debug, Clone, Default)]
pub struct AgentOptions {
    pub tool: String,
    pub working_directory: String,
    pub isolation: String,
    // ...
}
```

**Lesson:** Use `#[derive(Default)]` to enable struct construction with partial fields using `..Default::default()`.

### 3. Callbacks and Closures

**JavaScript:**
```javascript
class JsonOutputStream {
  constructor(options = {}) {
    this.onMessage = options.onMessage || (() => {});
    this.onError = options.onError || (() => {});
  }
}
```

**Rust:**
```rust
pub struct JsonOutputStream {
    on_message: Option<Box<dyn Fn(&Value) + Send + Sync>>,
    on_error: Option<Box<dyn Fn(&ParseError) + Send + Sync>>,
    // ...
}
```

**Lesson:** Rust closures with `Box<dyn Fn>` require explicit trait bounds (`Send + Sync`) for thread safety. Also, structs containing closures cannot derive `Debug` automatically - a manual implementation is needed.

### 4. Async/Await Translation

**JavaScript:**
```javascript
async function executeCommand(command, dryRun, attached) {
  // ...
}
```

**Rust:**
```rust
pub async fn execute_command(
    command: &str,
    dry_run: bool,
    attached: bool,
) -> Result<ExecutionResult, std::io::Error> {
    // ...
}
```

**Lesson:** Tokio provides excellent async runtime support. The translation is mostly straightforward, but requires adding proper error handling with `Result` types.

### 5. Dynamic Maps

**JavaScript:**
```javascript
const MODEL_MAP = {
  'opus': 'claude-opus-4-20250514',
  'sonnet': 'claude-sonnet-4-20250514',
  // ...
};
```

**Rust:**
```rust
use std::collections::HashMap;
use std::sync::LazyLock;

static MODEL_MAP: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert("opus", "claude-opus-4-20250514");
    m.insert("sonnet", "claude-sonnet-4-20250514");
    // ...
    m
});
```

**Lesson:** `LazyLock` (stable since Rust 1.80) is perfect for static hashmaps. It initializes lazily on first access and is thread-safe.

### 6. String Ownership Patterns

**JavaScript:** Strings are always passed by reference (implicitly).

**Rust:**
```rust
// Take ownership when storing
pub fn new(options: AgentOptions) -> Self { ... }

// Borrow when only reading
pub fn get(&self, name: &str) -> Option<...> { ... }
```

**Lesson:** Understanding when to take `String` (ownership) vs `&str` (borrow) is crucial. Use `&str` for function parameters when you don't need to store the string.

## Challenges Encountered

### 1. Temporary Value Borrow Errors

**Problem:** Complex format expressions create temporaries that don't live long enough.

```rust
// Error: temporary value dropped while borrowed
let output = format!("{}{}", stdout, if stderr.is_empty() { "" } else { &format!("\n{}", stderr) });
```

**Solution:** Use explicit if-else blocks:
```rust
let plain_output = if stderr.is_empty() {
    stdout.to_string()
} else {
    format!("{}\n{}", stdout, stderr)
};
```

### 2. Debug Trait for Closure-Containing Structs

**Problem:** `#[derive(Debug)]` fails for structs with closure fields.

**Solution:** Implement Debug manually:
```rust
impl std::fmt::Debug for JsonOutputStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JsonOutputStream")
            .field("messages", &self.messages.len())
            .field("on_message", &"<callback>")
            .finish()
    }
}
```

### 3. Mutable Borrows During Iteration

**Problem:** Processing strings while iterating over buffer content.

```rust
// Error: cannot borrow self as mutable while iterating
for line in self.buffer.split('\n') {
    self.process_line(line);
}
```

**Solution:** Collect into owned strings first:
```rust
let lines: Vec<String> = self.buffer.split('\n')
    .map(|s| s.to_string())
    .collect();
for line in lines {
    self.process_line(&line);
}
```

### 4. Trait Object Return Types

**Problem:** Return types with `dyn Trait` need explicit bounds for thread safety.

```rust
// Error: type mismatch
fn get(&self, name: &str) -> Option<&dyn Tool> { ... }
```

**Solution:** Include Send + Sync bounds:
```rust
fn get(&self, name: &str) -> Option<&(dyn Tool + Send + Sync)> { ... }
```

## Code Quality Observations

### What Works Well in Rust

1. **Pattern Matching:** Much cleaner than JavaScript's switch/if-else chains
2. **Result Types:** Explicit error handling prevents silent failures
3. **Lifetimes:** Force thinking about data ownership upfront
4. **Module System:** Clear separation with `mod.rs` aggregation
5. **Test Organization:** In-file `#[cfg(test)] mod tests` is convenient

### What Requires More Code in Rust

1. **Option Chaining:** More verbose than JavaScript's `?.`
2. **String Operations:** More explicit about ownership
3. **Dynamic Typing Patterns:** Require enums or trait objects

## Test Statistics

| Language   | Tests | Status |
|------------|-------|--------|
| JavaScript | 79    | Pass   |
| Rust       | 83    | Pass   |

The Rust version has slightly more tests due to additional edge case coverage.

## File Mapping

| JavaScript | Rust |
|------------|------|
| js/src/streaming/ndjson.mjs | rust/src/streaming/ndjson.rs |
| js/src/streaming/input-stream.mjs | rust/src/streaming/input_stream.rs |
| js/src/streaming/output-stream.mjs | rust/src/streaming/output_stream.rs |
| js/src/streaming/index.mjs | rust/src/streaming/mod.rs |
| js/src/cli-parser.mjs | rust/src/cli_parser.rs |
| js/src/command-builder.mjs | rust/src/command_builder.rs |
| js/src/executor.mjs | rust/src/executor.rs |
| js/src/tools/claude.mjs | rust/src/tools/claude.rs |
| js/src/tools/codex.mjs | rust/src/tools/codex.rs |
| js/src/tools/opencode.mjs | rust/src/tools/opencode.rs |
| js/src/tools/agent.mjs | rust/src/tools/agent.rs |
| js/src/tools/index.mjs | rust/src/tools/mod.rs |
| js/src/index.mjs | rust/src/lib.rs |
| js/bin/start-agent.mjs | rust/src/bin/start_agent.rs |
| js/bin/stop-agent.mjs | rust/src/bin/stop_agent.rs |

## Conclusion

The translation was successful with full feature parity. Key insights:

1. **Start with data structures** - Define structs first, then implement methods
2. **Embrace Result/Option** - They're not overhead, they're guarantees
3. **Test early and often** - Rust's test infrastructure is excellent
4. **Read compiler errors carefully** - They usually tell you exactly what to fix

The Rust version provides additional benefits:
- Memory safety without garbage collection
- True parallelism for async operations
- Smaller binary footprint
- No runtime dependencies for distribution
