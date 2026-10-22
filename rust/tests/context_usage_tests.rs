//! Tests for context-window usage (issue #57).

use agent_commander::{
    apply_codex_rollout_context_usage, build_normalized_result_metadata,
    claude_request_context_tokens, codex_rollout_context_usage, extract_context_usage,
    BuildMetadataOptions, CodexRolloutOptions, ContextUsage, ResultMetadata,
};
use serde_json::{json, Value};

fn assistant(usage: &Value) -> Value {
    json!({"type": "assistant", "message": {"model": "claude-opus-4-5-20251101", "usage": usage}})
}

fn token_count(total: u64, window: u64) -> Value {
    json!({
        "type": "event_msg",
        "payload": {"type": "token_count", "info": {
            "last_token_usage": {"total_tokens": total},
            "model_context_window": window
        }}
    })
}

#[test]
fn claude_context_usage_folds_the_last_and_peak_main_thread_request() {
    assert_eq!(
        claude_request_context_tokens(&json!({
            "input_tokens": 1,
            "cache_creation_input_tokens": 2,
            "cache_read_input_tokens": 3,
            "output_tokens": 4
        })),
        10
    );
    let mut sub_agent = assistant(&json!({"input_tokens": 150_000, "output_tokens": 1}));
    sub_agent["parent_tool_use_id"] = json!("toolu_1");
    let messages = vec![
        json!({"type": "system", "subtype": "init", "session_id": "s1"}),
        assistant(&json!({
            "input_tokens": 10,
            "cache_creation_input_tokens": 2000,
            "cache_read_input_tokens": 30000,
            "output_tokens": 500
        })),
        // A sub-agent fills its own context.
        sub_agent,
        json!({"type": "system", "subtype": "compact_boundary"}),
        assistant(
            &json!({"input_tokens": 5, "cache_read_input_tokens": 19995, "output_tokens": 0}),
        ),
        json!({
            "type": "result", "subtype": "success", "is_error": false, "result": "ok",
            "modelUsage": {
                "claude-opus-4-5-20251101": {"contextWindow": 200_000},
                "claude-haiku-4-5": {"contextWindow": 100_000}
            }
        }),
    ];
    let expected = ContextUsage {
        used_tokens: 20000,
        peak_tokens: 32510,
        max_tokens: Some(200_000),
        used_percent: Some(10.0),
        model: Some("claude-opus-4-5-20251101".into()),
        compactions: 1,
    };
    assert_eq!(extract_context_usage(&messages), Some(expected));
    assert_eq!(extract_context_usage(&[json!({"type": "result"})]), None);
    let metadata = build_normalized_result_metadata(BuildMetadataOptions {
        tool: "claude",
        exit_code: 0,
        parsed_output: Some(&messages),
        ..Default::default()
    });
    let serialized = serde_json::to_value(&metadata).unwrap();
    assert_eq!(serialized["contextUsage"]["usedTokens"], 20000);
    assert_eq!(serialized["contextUsage"]["maxTokens"], 200_000);
}

#[test]
fn codex_token_count_and_app_server_token_usage_give_used_and_max_tokens() {
    let usage =
        extract_context_usage(&[token_count(90000, 272_000), token_count(68000, 272_000)]).unwrap();
    assert_eq!(
        (usage.used_tokens, usage.peak_tokens, usage.max_tokens),
        (68000, 90000, Some(272_000))
    );
    assert_eq!(usage.used_percent, Some(25.0));
    let app_server = json!({
        "method": "thread/tokenUsage/updated",
        "params": {"tokenUsage": {"last": {"totalTokens": 1000}, "modelContextWindow": 4000}}
    });
    assert_eq!(
        extract_context_usage(&[app_server]).unwrap().used_percent,
        Some(25.0)
    );
    let text = format!("{}\n{}\n", token_count(5, 100), token_count(7, 100));
    assert_eq!(codex_rollout_context_usage(&text).unwrap().used_tokens, 7);
}

#[test]
fn apply_codex_rollout_context_usage_reads_the_thread_rollout() {
    let codex_home = tempfile::tempdir().unwrap();
    let thread = "0199a213-81c0-7800-8aa1-bbab2a035a53";
    let dir = codex_home.path().join("sessions/2026/10/22");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join(format!("rollout-2026-10-22T10-00-00-{thread}.jsonl")),
        format!("{}\n", token_count(1234, 272_000)),
    )
    .unwrap();
    let options = CodexRolloutOptions {
        codex_home: Some(codex_home.path().to_path_buf()),
        ..Default::default()
    };
    let mut metadata = ResultMetadata {
        tool: "codex".into(),
        session_id: Some(thread.into()),
        ..Default::default()
    };
    assert!(apply_codex_rollout_context_usage(&mut metadata, &options));
    let usage = metadata.context_usage.unwrap();
    assert_eq!((usage.used_tokens, usage.max_tokens), (1234, Some(272_000)));
    let mut other = ResultMetadata {
        tool: "claude".into(),
        session_id: Some(thread.into()),
        ..Default::default()
    };
    assert!(!apply_codex_rollout_context_usage(&mut other, &options));
}
