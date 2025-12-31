//! stop-agent CLI command
//! Stop a detached agent

use agent_commander::{
    agent, parse_stop_agent_args, show_stop_agent_help, validate_stop_agent_options, AgentOptions,
    AgentStopOptions,
};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let options = parse_stop_agent_args(&args);

    // Show help if requested
    if options.help {
        show_stop_agent_help();
        std::process::exit(0);
    }

    // Validate options
    let validation = validate_stop_agent_options(&options);
    if !validation.valid {
        eprintln!("Error: Invalid options\n");
        for error in &validation.errors {
            eprintln!("  - {}", error);
        }
        eprintln!("\nRun \"stop-agent --help\" for usage information.");
        std::process::exit(1);
    }

    // Create agent controller (minimal config needed for stop)
    let agent_options = AgentOptions {
        tool: "dummy".to_string(),             // Not used for stop
        working_directory: "/tmp".to_string(), // Not used for stop
        isolation: options.isolation.unwrap_or_default(),
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

    // Stop the agent
    let stop_options = AgentStopOptions {
        dry_run: options.dry_run,
    };

    match controller.stop(stop_options).await {
        Ok(result) => {
            println!("Agent stopped successfully");
            std::process::exit(result.exit_code);
        }
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    }
}
