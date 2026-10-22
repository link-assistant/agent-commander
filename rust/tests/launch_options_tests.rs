//! Tests for the shared launch options (issue #57): reasoning effort, MCP
//! servers, strict MCP configuration, extra workspace directories and file
//! attachments.

use agent_commander::tools::{claude, codex, gemini, opencode, qwen};
use agent_commander::{
    agent, build_agent_command, check_launch_options_supported, codex_mcp_servers_override,
    launch_capabilities, normalize_reasoning_effort, parse_start_agent_args, push_attachments,
    to_toml_value, AgentCommandOptions, AgentOptions, AgentStartOptions, LaunchOptions,
    CLAUDE_REASONING_EFFORTS,
};
use serde_json::json;

const MCP: &str = r#"{"mcpServers":{"upcomputer":{"type":"http","url":"http://127.0.0.1:4100/mcp","headers":{"Authorization":"Bearer t"}},"local fs":{"command":"npx","args":["-y","fs-mcp"]}}}"#;

fn launch() -> LaunchOptions {
    LaunchOptions {
        reasoning_effort: Some("xhigh".to_string()),
        mcp_config: Some(MCP.to_string()),
        strict_mcp_config: true,
        additional_directories: vec!["/a".to_string(), "/b".to_string()],
        attachments: Vec::new(),
    }
}

fn attachments(files: &[&str]) -> LaunchOptions {
    LaunchOptions {
        attachments: files.iter().map(|file| (*file).to_string()).collect(),
        ..Default::default()
    }
}

#[test]
fn codex_attaches_each_image_with_its_own_image_flag() {
    // codex 0.163 takes `--image <FILE>` in `exec` and `exec resume`.
    let args = codex::build_args(&codex::CodexBuildOptions {
        resume: Some("thread-1".to_string()),
        launch: attachments(&["shot.png", "/tmp/b.jpg"]),
        ..Default::default()
    });
    let resume = args.iter().position(|a| a == "resume").unwrap();
    let image = args.iter().position(|a| a == "--image").unwrap();
    assert!(image > resume);
    assert_eq!(
        args[image..image + 4],
        ["--image", "shot.png", "--image", "/tmp/b.jpg"]
    );
    // The variadic flag is always followed by another flag.
    assert!(args[image + 4].starts_with("--"));
}

#[test]
fn opencode_attaches_files_right_after_run() {
    let args = opencode::build_args(&opencode::OpencodeBuildOptions {
        json: true,
        launch: attachments(&["diagram.png"]),
        extra_args: vec!["positional".to_string()],
        ..Default::default()
    });
    assert_eq!(args[..4], ["run", "--file", "diagram.png", "--format"]);
}

#[test]
fn attachments_are_rejected_by_tools_without_a_flag() {
    let error = check_launch_options_supported("claude", &attachments(&["a.png"])).unwrap_err();
    assert!(error.contains("Tool \"claude\" does not support file attachments"));
    assert!(error.contains("Choose one of: codex, opencode;"));
    assert!(check_launch_options_supported("claude", &attachments(&[])).is_ok());
    assert!(
        launch_capabilities("codex").attachments && launch_capabilities("opencode").attachments
    );
    assert!(std::panic::catch_unwind(|| {
        let mut args = Vec::new();
        push_attachments(&mut args, "--image", &[String::new()]);
    })
    .is_err());
}

#[test]
fn claude_maps_every_launch_option_before_model() {
    let args = claude::build_args(&claude::ClaudeBuildOptions {
        model: Some("opus".to_string()),
        launch: launch(),
        ..Default::default()
    });
    let start = args.iter().position(|a| a == "--add-dir").unwrap();
    let model = args.iter().position(|a| a == "--model").unwrap();
    assert_eq!(
        args[start..model],
        [
            "--add-dir",
            "/a",
            "--add-dir",
            "/b",
            "--mcp-config",
            MCP,
            "--strict-mcp-config",
            "--effort",
            "xhigh"
        ]
    );
}

#[test]
fn codex_maps_effort_and_mcp_servers_to_overrides() {
    let args = codex::build_args(&codex::CodexBuildOptions {
        launch: LaunchOptions {
            strict_mcp_config: false,
            additional_directories: vec!["/shared".to_string()],
            ..launch()
        },
        ..Default::default()
    });
    assert!(args.contains(&"model_reasoning_effort=xhigh".to_string()));
    let dir = args.iter().position(|a| a == "--add-dir").unwrap();
    assert_eq!(args[dir + 1], "/shared");
    // serde_json keeps object keys sorted, so servers appear in name order.
    assert!(args.contains(
        &r#"mcp_servers={"local fs" = {args = ["-y", "fs-mcp"], command = "npx"}, upcomputer = {http_headers = {Authorization = "Bearer t"}, url = "http://127.0.0.1:4100/mcp"}}"#
            .to_string()
    ));
}

#[test]
fn codex_keeps_exec_flags_before_resume() {
    // `codex exec resume` rejects --sandbox and --add-dir (codex 0.163).
    let args = codex::build_args(&codex::CodexBuildOptions {
        resume: Some("thread-1".to_string()),
        read_only: true,
        launch: LaunchOptions {
            additional_directories: vec!["/x".to_string()],
            ..Default::default()
        },
        ..Default::default()
    });
    let resume = args.iter().position(|a| a == "resume").unwrap();
    assert!(args.iter().position(|a| a == "--sandbox").unwrap() < resume);
    assert!(args.iter().position(|a| a == "--add-dir").unwrap() < resume);
    assert_eq!(args[resume + 1], "thread-1");
}

#[test]
#[should_panic(expected = "not a file path")]
fn codex_rejects_mcp_config_path() {
    codex::build_args(&codex::CodexBuildOptions {
        launch: LaunchOptions {
            mcp_config: Some("./mcp.json".to_string()),
            ..Default::default()
        },
        ..Default::default()
    });
}

#[test]
fn opencode_gemini_and_qwen_map_their_native_flags() {
    let effort = LaunchOptions {
        reasoning_effort: Some("max".to_string()),
        ..Default::default()
    };
    let args = opencode::build_args(&opencode::OpencodeBuildOptions {
        launch: effort,
        ..Default::default()
    });
    assert_eq!(args[args.len() - 2..], ["--variant", "max"]);

    let dirs = LaunchOptions {
        additional_directories: vec!["/d".to_string()],
        ..Default::default()
    };
    let args = gemini::build_args(&gemini::GeminiBuildOptions {
        launch: dirs.clone(),
        ..gemini::GeminiBuildOptions::new()
    });
    let at = args
        .iter()
        .position(|a| a == "--include-directories")
        .unwrap();
    assert_eq!(args[at + 1], "/d");

    let args = qwen::build_args(&qwen::QwenBuildOptions {
        include_directories: vec!["/a".to_string()],
        launch: LaunchOptions {
            mcp_config: Some("./mcp.json".to_string()),
            ..dirs
        },
        ..qwen::QwenBuildOptions::new()
    });
    let at = args
        .iter()
        .position(|a| a == "--include-directories")
        .unwrap();
    assert_eq!(
        args[at..],
        [
            "--include-directories",
            "/a",
            "--include-directories",
            "/d",
            "--mcp-config",
            "./mcp.json"
        ]
    );
}

#[test]
fn unsupported_options_name_the_supporting_tools() {
    let error = check_launch_options_supported(
        "agent",
        &LaunchOptions {
            reasoning_effort: Some("low".to_string()),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(error.contains("Tool \"agent\" does not support reasoning effort"));
    assert!(error.contains("claude, codex, opencode;"));

    let error = check_launch_options_supported(
        "codex",
        &LaunchOptions {
            strict_mcp_config: true,
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(error.contains("Choose one of: claude;"));
    assert!(check_launch_options_supported("agent", &LaunchOptions::default()).is_ok());
}

#[test]
#[should_panic(expected = "does not support additional directories")]
fn build_agent_command_rejects_unsupported_options() {
    build_agent_command(&AgentCommandOptions {
        tool: "opencode".to_string(),
        working_directory: "/tmp".to_string(),
        launch: LaunchOptions {
            additional_directories: vec!["/x".to_string()],
            ..Default::default()
        },
        ..Default::default()
    });
}

#[tokio::test]
async fn agent_start_returns_error_for_unsupported_options() {
    let mut controller = agent(AgentOptions {
        tool: "agent".to_string(),
        working_directory: "/tmp".to_string(),
        prompt: Some("hi".to_string()),
        isolation: "none".to_string(),
        launch: LaunchOptions {
            mcp_config: Some("./mcp.json".to_string()),
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap();
    let error = controller
        .start(AgentStartOptions {
            dry_run: true,
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert!(error.contains("MCP server configuration"));
}

#[test]
fn capabilities_cover_every_tool() {
    let claude = launch_capabilities("claude");
    assert!(claude.reasoning_effort && claude.mcp_config && claude.strict_mcp_config);
    assert_eq!(claude.reasoning_efforts, Some(CLAUDE_REASONING_EFFORTS));
    assert!(!launch_capabilities("codex").strict_mcp_config);
    assert_eq!(launch_capabilities("opencode").reasoning_efforts, None);
    let agent = launch_capabilities("agent");
    assert!(!(agent.reasoning_effort || agent.mcp_config || agent.additional_directories));
}

#[test]
fn helpers_validate_and_encode() {
    assert_eq!(normalize_reasoning_effort("high"), "high");
    assert!(std::panic::catch_unwind(|| normalize_reasoning_effort("high; rm")).is_err());
    assert_eq!(to_toml_value(&json!("a\"b\n")).unwrap(), r#""a\"b\n""#);
    assert_eq!(
        to_toml_value(&json!({"a.b": [1, true]})).unwrap(),
        r#"{"a.b" = [1, true]}"#
    );
    assert!(to_toml_value(&json!(null)).is_err());
    assert!(codex_mcp_servers_override(r#"{"mcpServers":{"a":"x"}}"#)
        .unwrap_err()
        .contains("must be an object"));
    assert_eq!(
        codex_mcp_servers_override(r#"{"mcpServers":{"a":{"command":"x"}}}"#).unwrap(),
        r#"mcp_servers={a = {command = "x"}}"#
    );
}

#[test]
fn start_agent_parses_launch_option_flags() {
    let args: Vec<String> = [
        "--tool",
        "claude",
        "--reasoning-effort",
        "high",
        "--mcp-config",
        "./mcp.json",
        "--strict-mcp-config",
        "--add-dir",
        "/a",
        "--add-dir",
        "/b",
        "--attach",
        "shot.png",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let parsed = parse_start_agent_args(&args);
    assert_eq!(parsed.reasoning_effort.as_deref(), Some("high"));
    assert_eq!(parsed.mcp_config.as_deref(), Some("./mcp.json"));
    assert!(parsed.strict_mcp_config);
    assert_eq!(parsed.additional_directories, ["/a", "/b"]);
    assert_eq!(parsed.attachments, ["shot.png"]);
}
