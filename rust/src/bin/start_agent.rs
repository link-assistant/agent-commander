//! start-agent CLI command
//! Start an agent with specified configuration

use agent_commander::{
    agent, parse_start_agent_args, show_start_agent_help, validate_start_agent_options,
    AgentOptions, AgentStartOptions,
};

fn parse_tool_env(entries: Vec<String>) -> Result<Vec<(String, String)>, String> {
    entries
        .into_iter()
        .map(|entry| {
            entry
                .split_once('=')
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .ok_or_else(|| format!("Invalid --tool-env value \"{}\". Use KEY=VALUE.", entry))
        })
        .collect()
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let options = parse_start_agent_args(&args);

    // Show help if requested
    if options.help {
        show_start_agent_help();
        std::process::exit(0);
    }

    // Validate options
    let validation = validate_start_agent_options(&options);
    if !validation.valid {
        eprintln!("Error: Invalid options\n");
        for error in &validation.errors {
            eprintln!("  - {}", error);
        }
        eprintln!("\nRun \"start-agent --help\" for usage information.");
        std::process::exit(1);
    }

    let extra_env = match parse_tool_env(options.tool_env) {
        Ok(extra_env) => extra_env,
        Err(error) => {
            eprintln!("Error: {}", error);
            std::process::exit(1);
        }
    };

    // Create agent controller
    let agent_options = AgentOptions {
        tool: options.tool.unwrap_or_default(),
        working_directory: options.working_directory.unwrap_or_default(),
        prompt: options.prompt,
        prompt_file: options.prompt_file,
        system_prompt: options.system_prompt,
        append_system_prompt: options.append_system_prompt,
        model: options.model,
        fallback_model: options.fallback_model,
        resume: options.resume,
        verbose: options.verbose,
        replay_user_messages: options.replay_user_messages,
        session_id: options.session_id,
        fork_session: options.fork_session,
        read_only: options.read_only,
        plan_only: options.plan_only,
        executable: options.tool_executable,
        extra_args: options.tool_args,
        extra_env,
        skip_default_safety_flags: options.skip_default_safety_flags,
        isolation: options.isolation,
        screen_name: options.screen_name,
        container_name: options.container_name,
        ..Default::default()
    };

    let mut controller = match agent(agent_options) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    };

    // Start the agent
    let start_options = AgentStartOptions {
        dry_run: options.dry_run,
        detached: options.detached,
        attached: options.attached,
    };

    if let Err(e) = controller.start(start_options).await {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }

    // If not detached, wait for completion
    if !options.detached && !options.dry_run {
        match controller.stop(Default::default()).await {
            Ok(result) => {
                std::process::exit(result.exit_code);
            }
            Err(e) => {
                eprintln!("Error: {}", e);
                std::process::exit(1);
            }
        }
    }
}
