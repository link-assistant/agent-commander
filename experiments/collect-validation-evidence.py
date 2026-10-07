"""Preserve the explicitly named issue-50 logs and index their provenance.

Run after the commands in docs/case-studies/issue-50/validation.md finish.
This collects existing logs; it does not execute or claim to execute checks.
"""

import gzip
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = root / "docs/case-studies/issue-50/data"
logs = data / "validation"
logs.mkdir(parents=True, exist_ok=True)

names = [
    "js-before", "rust-before", "js-audit-before", "js-resume-before",
    "js-last-audit-before", "js-after", "rust-after", "js-quality", "js-full",
    "bun", "deno", "rust-format", "rust-size", "rust-clippy", "rust-full",
    "rust-doc", "rust-package",
]
for name in names:
    source = Path(f"/tmp/issue-50-{name}.log")
    raw = source.read_bytes()
    if name.endswith("before") or name.endswith("after") or name == "js-quality":
        (logs / f"{name}.log.txt").write_bytes(raw)
    else:
        (logs / f"{name}.log.gz").write_bytes(gzip.compress(raw, mtime=0))

failures = []
for name in ["javascript-37616272375", "rust-37616254353"]:
    source = root / f"ci-logs/{name}.log"
    raw = source.read_bytes()
    (logs / f"{name}.log.gz").write_bytes(gzip.compress(raw, mtime=0))
    for line_number, line in enumerate(raw.decode().splitlines(), 1):
        plain = re.sub(r"\x1b\[[0-9;]*m", "", line)
        if "error:" in plain or "timed out" in plain or "-->" in plain:
            failures.append(f"{source.name}:{line_number}: {plain}")
(logs / "baseline-ci-errors.txt").write_text("\n".join(failures) + "\n")

sources = [
    ("https://developers.openai.com/codex/noninteractive",
     "Codex exec/resume, JSONL turn lifecycle, cached-input usage."),
    ("https://code.claude.com/docs/en/headless",
     "Claude print mode, verbose stream JSON, resume and final result fields."),
    ("https://geminicli.com/docs/cli/headless/",
     "Gemini single JSON and JSONL, result statistics, errors and exit status."),
    ("https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/",
     "Qwen stdin, JSON outputs, resume; JSON input described as under construction."),
    ("https://opencode.ai/v2/docs/cli/commands/",
     "OpenCode run JSON and continuation; --session mapping also verified in pinned Hive Mind source."),
    ("https://nodejs.org/api/child_process.html",
     "Stdio close, null signal exit status, shell descendants and termination."),
    ("https://docs.rs/tokio/latest/tokio/process/",
     "Asynchronous process I/O and kill_on_drop cancellation behavior."),
]
files = []
for path in sorted(data.rglob("*")):
    if path.is_file() and path.name != "evidence-index.json":
        raw = path.read_bytes()
        files.append({"path": str(path.relative_to(data)), "bytes": len(raw),
                      "sha256": hashlib.sha256(raw).hexdigest()})
index = {
    "collectedAt": datetime.now(timezone.utc).isoformat(),
    "issue": "https://github.com/link-assistant/agent-commander/issues/50",
    "pullRequest": "https://github.com/link-assistant/agent-commander/pull/51",
    "agentCommanderBaseline": "c03d6f87f6bb37b1e827c6ec2b6c9cd5f6a49f49",
    "preparedBranchBaseline": "71cef7a837f92c834883ad3f65ad48afa20fd9d6",
    "hiveMindCommit": "56b651c9ddec153b5b6fdb052fd063cd8f2343a1",
    "sources": [{"url": url, "observation": observation} for url, observation in sources],
    "relatedPullRequests": [1044, 553, 1991, 2291, 2302, 2527],
    "baselineCiRuns": [
        {"id": 37616272375, "createdAt": "2026-10-07T11:45:40Z", "workflow": "JavaScript", "conclusion": "failure"},
        {"id": 37616254353, "createdAt": "2026-10-07T11:45:31Z", "workflow": "Rust", "conclusion": "failure"},
    ],
    "logInterpretation": "Before logs precede the corresponding fix; audit stages follow earlier fixes. Full/after logs describe the implementation workspace. Final commit CI is linked from the PR.",
    "files": files,
}
(data / "evidence-index.json").write_text(json.dumps(index, indent=2) + "\n")
