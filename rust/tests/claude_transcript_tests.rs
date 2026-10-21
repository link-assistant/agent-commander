//! Claude session transcripts: the usage-limit cross-check of a failed run
//! (hive-mind#3570; issue #55).

use agent_commander::{
    apply_claude_transcript_usage_limit, claude_project_slugs, claude_transcript_api_error,
    claude_transcript_candidates, read_claude_transcript_api_error, ClaudeTranscriptOptions,
    ResultMetadata,
};
use serde_json::json;
use std::path::{Path, PathBuf};

const SESSION: &str = "5f0c2a7e-1b3d-4e5f-8a9b-0c1d2e3f4a5b";
const WORKDIR: &str = "/tmp/work.dir/repo";
const LIMIT_TEXT: &str = "You've hit your weekly limit · resets 11am (UTC)";

fn user(text: &str) -> String {
    json!({"type": "user", "message": {"content": text}}).to_string()
}

fn api_error(text: &str) -> String {
    json!({
        "type": "assistant",
        "isApiErrorMessage": true,
        "error": "rate_limit",
        "timestamp": "2026-10-21T00:00:00Z",
        "message": {"model": "<synthetic>", "content": [{"type": "text", "text": text}]}
    })
    .to_string()
}

fn summary() -> String {
    json!({"type": "summary", "summary": "x"}).to_string()
}

fn write_transcript(config_dir: &Path, working_directory: &str, lines: &[String]) -> PathBuf {
    let slug = claude_project_slugs(working_directory).pop().unwrap();
    let dir = config_dir.join("projects").join(slug);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join(format!("{SESSION}.jsonl"));
    std::fs::write(&file, format!("{}\n", lines.join("\n"))).unwrap();
    file
}

fn options(config_dir: &Path, working_directory: &str) -> ClaudeTranscriptOptions {
    ClaudeTranscriptOptions {
        working_directory: Some(PathBuf::from(working_directory)),
        claude_config_dir: Some(config_dir.to_path_buf()),
        home_dir: Some(config_dir.to_path_buf()),
        max_bytes: None,
    }
}

#[test]
fn project_slugs_cover_the_old_and_the_new_slug() {
    assert_eq!(
        claude_project_slugs("/tmp/work.dir/repo"),
        ["-tmp-work.dir-repo", "-tmp-work-dir-repo"]
    );
    assert_eq!(claude_project_slugs("/tmp/repo"), ["-tmp-repo"]);
}

#[test]
fn candidates_search_claude_config_dir_then_home() {
    let options = ClaudeTranscriptOptions {
        working_directory: Some("/w".into()),
        claude_config_dir: Some("/cfg".into()),
        home_dir: Some("/home/u".into()),
        max_bytes: None,
    };
    assert_eq!(
        claude_transcript_candidates(SESSION, &options),
        [
            Path::new("/cfg/projects/-w").join(format!("{SESSION}.jsonl")),
            Path::new("/home/u/.claude/projects/-w").join(format!("{SESSION}.jsonl")),
        ]
    );
    // Ids that are not session-shaped never become paths.
    assert_eq!(
        claude_transcript_candidates("../x", &options),
        Vec::<PathBuf>::new()
    );
}

#[test]
fn api_error_reads_only_the_last_conversation_entry() {
    let found = claude_transcript_api_error(
        &[
            user("hi"),
            api_error(LIMIT_TEXT),
            summary(),
            "not json".into(),
        ]
        .join("\n"),
    )
    .unwrap();
    assert_eq!(found.text, LIMIT_TEXT);
    assert_eq!(found.error, Some(json!("rate_limit")));
    assert_eq!(found.timestamp.as_deref(), Some("2026-10-21T00:00:00Z"));

    let recovered =
        claude_transcript_api_error(&[api_error(LIMIT_TEXT), user("continue")].join("\n"));
    assert!(recovered
        .unwrap_err()
        .contains("last entry is a user message"));
    assert!(claude_transcript_api_error("").is_err());
}

#[test]
fn read_finds_the_transcript_under_the_new_slug() {
    let config = tempfile::tempdir().unwrap();
    let file = write_transcript(config.path(), WORKDIR, &[user("hi"), api_error(LIMIT_TEXT)]);
    let (path, error) =
        read_claude_transcript_api_error(SESSION, &options(config.path(), WORKDIR)).unwrap();
    assert_eq!(path, file);
    assert_eq!(error.text, LIMIT_TEXT);
    assert_eq!(
        read_claude_transcript_api_error(SESSION, &options(config.path(), "/nowhere")),
        Err("transcript not found".to_string())
    );
}

#[test]
fn apply_only_fills_failed_unsignalled_claude_runs() {
    let config = tempfile::tempdir().unwrap();
    write_transcript(config.path(), WORKDIR, &[user("hi"), api_error(LIMIT_TEXT)]);
    let options = options(config.path(), WORKDIR);
    let base = ResultMetadata {
        tool: "claude".into(),
        exit_code: 1,
        session_id: Some(SESSION.into()),
        ..Default::default()
    };
    let mut filled = base.clone();
    assert!(apply_claude_transcript_usage_limit(&mut filled, &options));
    assert!(filled.limit_reached);
    assert!(!filled.success);
    assert_eq!(filled.limit_source.as_deref(), Some("claude-transcript"));
    assert_eq!(filled.limit_reset_time.as_deref(), Some("11:00 AM"));
    assert_eq!(filled.limit_timezone.as_deref(), Some("UTC"));

    let skipped = [
        ResultMetadata {
            signal: Some("SIGTERM".into()),
            ..base.clone()
        },
        ResultMetadata {
            exit_code: 0,
            success: true,
            ..base.clone()
        },
        ResultMetadata {
            tool: "codex".into(),
            ..base.clone()
        },
        ResultMetadata {
            session_id: None,
            ..base.clone()
        },
    ];
    for mut metadata in skipped {
        assert!(!apply_claude_transcript_usage_limit(
            &mut metadata,
            &options
        ));
        assert!(!metadata.limit_reached, "{metadata:?}");
        assert_eq!(metadata.limit_source, None);
    }

    // An API error that is not a usage limit is left to the output.
    write_transcript(
        config.path(),
        WORKDIR,
        &[user("hi"), api_error("API Error: 500 overloaded")],
    );
    let mut other = base;
    assert!(!apply_claude_transcript_usage_limit(&mut other, &options));
    assert!(!other.limit_reached);
}

#[test]
fn run_env_claude_config_dir_wins_and_an_unset_one_means_the_default() {
    let passed = ClaudeTranscriptOptions::for_run_env(
        "/w",
        &[
            ("CLAUDE_CONFIG_DIR".into(), "/tmp/first".into()),
            ("CLAUDE_CONFIG_DIR".into(), "/tmp/claude config".into()),
        ],
        &[],
    );
    assert_eq!(
        passed.claude_config_dir,
        Some(PathBuf::from("/tmp/claude config"))
    );
    assert_eq!(passed.working_directory, Some(PathBuf::from("/w")));
    let unset = ClaudeTranscriptOptions::for_run_env("/w", &[], &["CLAUDE_CONFIG_DIR".into()]);
    assert!(unset.claude_config_dir.unwrap().ends_with(".claude"));
    let default = ClaudeTranscriptOptions::for_run_env("", &[], &[]);
    assert_eq!(default.claude_config_dir, None);
    assert_eq!(default.working_directory, None);
}

#[cfg(unix)]
#[tokio::test]
async fn stop_reports_a_usage_limit_found_only_in_the_claude_transcript() {
    use agent_commander::{agent, AgentOptions, AgentStartOptions, AgentStopOptions};
    use std::os::unix::fs::PermissionsExt;

    let config = tempfile::tempdir().unwrap();
    let work = tempfile::tempdir().unwrap();
    let working_directory = work.path().display().to_string();
    write_transcript(
        config.path(),
        &working_directory,
        &[user("hi"), api_error(LIMIT_TEXT)],
    );
    let bin = tempfile::tempdir().unwrap();
    let script = bin.path().join("claude");
    let init = json!({"type": "system", "subtype": "init", "session_id": SESSION});
    std::fs::write(
        &script,
        format!("#!/usr/bin/env bash\necho '{init}'\necho 'Claude command failed' >&2\nexit 1\n"),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let previous_path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{previous_path}", bin.path().display()));

    let mut controller = agent(AgentOptions {
        tool: "claude".into(),
        working_directory,
        prompt: Some("hi".into()),
        json: true,
        isolation: "none".into(),
        extra_env: vec![(
            "CLAUDE_CONFIG_DIR".into(),
            config.path().display().to_string(),
        )],
        ..Default::default()
    })
    .unwrap();
    let outcome = async {
        controller
            .start(AgentStartOptions {
                attached: false,
                ..Default::default()
            })
            .await?;
        controller.stop(AgentStopOptions::default()).await
    }
    .await;
    std::env::set_var("PATH", previous_path);

    let metadata = outcome.unwrap().metadata;
    assert_eq!(metadata.session_id.as_deref(), Some(SESSION));
    assert!(!metadata.success);
    assert!(metadata.limit_reached, "{metadata:?}");
    assert_eq!(metadata.limit_source.as_deref(), Some("claude-transcript"));
}
