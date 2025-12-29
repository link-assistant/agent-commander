//! start-agent CLI command
//! Start an agent with specified configuration

use agent_commander::{
    agent, AgentOptions, AgentStartOptions,
    parse_start_agent_args, show_start_agent_help, validate_start_agent_options,
};

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

    // Create agent controller
    let agent_options = AgentOptions {
        tool: options.tool.unwrap_or_default(),
        working_directory: options.working_directory.unwrap_or_default(),
        prompt: options.prompt,
        system_prompt: options.system_prompt,
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
