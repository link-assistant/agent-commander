# Issue Details: #20

Source: https://github.com/link-assistant/agent-commander/issues/20

Title: Add hard read-only / no-shell tool mode for planning tasks

State at investigation time: open

Created by: konard

Related upstream workflow: https://github.com/link-assistant/hive-mind/issues/501

## Issue Body

Hive Mind issue link-assistant/hive-mind#501 needs to split a GitHub issue into smaller issues by asking an agent only for a plan/JSON structure. The surrounding application should perform all GitHub mutations deterministically.

Current `start-agent` supports tool/model/isolation/prompt/system-prompt, but there was no hard mode that prevents the selected agent from using shell/bash/file-writing tools. Prompt instructions are not enough for this workflow: it needs an enforceable read-only or planning mode passed through `start-agent` for tools such as claude, codex, opencode, and agent.

Desired behavior:

- `start-agent` flag such as `--read-only`, `--plan-only`, or `--disable-tools shell,bash,write`.
- Tool-specific command builders should map that mode to the safest available native options.
- If a selected tool cannot enforce the requested restrictions, `start-agent` should fail clearly instead of silently running with broader permissions.
- The mode should still work with `--isolation screen`.

This blocks Hive Mind from fully guaranteeing the `/task` and `/split` issue-splitting flow has no bash/file mutation access inside the model run.

## Issue Comment

konard requested a deep case study under `docs/case-studies/issue-20`, including downloaded logs/data, timeline reconstruction, requirement enumeration, root-cause analysis, online research, solution plans, and debug output when root cause is not clear.

