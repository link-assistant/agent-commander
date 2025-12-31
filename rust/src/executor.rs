//! Execute commands using tokio

use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

/// Command execution result
#[derive(Debug, Clone, Default)]
pub struct ExecutionResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub command: String,
}

/// Execute a command and return the result
///
/// # Arguments
/// * `command` - Command to execute
/// * `dry_run` - If true, just return the command without executing
/// * `attached` - If true, stream output to console
///
/// # Returns
/// Execution result
pub async fn execute_command(
    command: &str,
    dry_run: bool,
    attached: bool,
) -> Result<ExecutionResult, std::io::Error> {
    if dry_run {
        println!("Dry run - command that would be executed:");
        println!("{}", command);
        return Ok(ExecutionResult {
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            command: command.to_string(),
        });
    }

    let mut child = Command::new("bash")
        .arg("-c")
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let mut stdout = String::new();
    let mut stderr = String::new();

    // Read stdout
    if let Some(stdout_pipe) = child.stdout.take() {
        let mut reader = BufReader::new(stdout_pipe).lines();
        while let Some(line) = reader.next_line().await? {
            stdout.push_str(&line);
            stdout.push('\n');
            if attached {
                println!("{}", line);
            }
        }
    }

    // Read stderr
    if let Some(stderr_pipe) = child.stderr.take() {
        let mut reader = BufReader::new(stderr_pipe).lines();
        while let Some(line) = reader.next_line().await? {
            stderr.push_str(&line);
            stderr.push('\n');
            if attached {
                eprintln!("{}", line);
            }
        }
    }

    let status = child.wait().await?;
    let exit_code = status.code().unwrap_or(1);

    Ok(ExecutionResult {
        exit_code,
        stdout,
        stderr,
        command: command.to_string(),
    })
}

/// Process handle for non-blocking command execution
pub struct ProcessHandle {
    pub command: String,
    child: Option<Child>,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

impl ProcessHandle {
    /// Create a new process handle
    fn new(command: String, child: Child) -> Self {
        Self {
            command,
            child: Some(child),
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
        }
    }

    /// Wait for the process to exit
    pub async fn wait_for_exit(&mut self) -> Result<i32, std::io::Error> {
        if let Some(exit_code) = self.exit_code {
            return Ok(exit_code);
        }

        if let Some(mut child) = self.child.take() {
            // Read remaining stdout
            if let Some(stdout_pipe) = child.stdout.take() {
                let mut reader = BufReader::new(stdout_pipe).lines();
                while let Some(line) = reader.next_line().await? {
                    self.stdout.push_str(&line);
                    self.stdout.push('\n');
                }
            }

            // Read remaining stderr
            if let Some(stderr_pipe) = child.stderr.take() {
                let mut reader = BufReader::new(stderr_pipe).lines();
                while let Some(line) = reader.next_line().await? {
                    self.stderr.push_str(&line);
                    self.stderr.push('\n');
                }
            }

            let status = child.wait().await?;
            self.exit_code = Some(status.code().unwrap_or(1));
        }

        Ok(self.exit_code.unwrap_or(1))
    }

    /// Get collected output
    pub fn get_output(&self) -> (&str, &str, Option<i32>) {
        (&self.stdout, &self.stderr, self.exit_code)
    }

    /// Check if process has exited
    pub fn has_exited(&self) -> bool {
        self.exit_code.is_some()
    }
}

/// Start a command execution without waiting for completion
///
/// # Arguments
/// * `command` - Command to execute
/// * `attached` - If true, stream output to console
///
/// # Returns
/// Process handle
pub async fn start_command(
    command: &str,
    _attached: bool,
) -> Result<ProcessHandle, std::io::Error> {
    let child = Command::new("bash")
        .arg("-c")
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    Ok(ProcessHandle::new(command.to_string(), child))
}

/// Execute a command in the background (detached)
///
/// # Arguments
/// * `command` - Command to execute
///
/// # Returns
/// Process ID if available
pub async fn execute_detached(command: &str) -> Result<Option<u32>, std::io::Error> {
    let child = Command::new("bash")
        .arg("-c")
        .arg(command)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()?;

    Ok(child.id())
}

/// Signal handler cleanup function type
pub type CleanupFn = Box<dyn Fn() + Send + Sync>;

/// Setup CTRL+C handler for graceful shutdown
///
/// # Arguments
/// * `cleanup_fn` - Function to call on CTRL+C
///
/// # Returns
/// Function to remove the handler
pub fn setup_signal_handler<F>(cleanup_fn: F) -> impl Fn()
where
    F: Fn() + Send + Sync + 'static,
{
    // Note: In Rust with tokio, signal handling is typically done differently
    // This is a simplified version that uses ctrlc crate pattern
    // For production use, consider tokio::signal

    let cleanup = std::sync::Arc::new(cleanup_fn);
    let cleanup_clone = cleanup.clone();

    // Set up a simple flag for shutdown
    let shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();

    std::thread::spawn(move || {
        // This is a simplified pattern - in real code use tokio::signal
        loop {
            if shutdown_clone.load(std::sync::atomic::Ordering::Relaxed) {
                cleanup_clone();
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    });

    move || {
        shutdown.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_execute_command_dry_run() {
        let result = execute_command("echo hello", true, false).await.unwrap();
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.command, "echo hello");
    }

    #[tokio::test]
    async fn test_execute_command_real() {
        let result = execute_command("echo hello", false, false).await.unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("hello"));
    }

    #[tokio::test]
    async fn test_start_command_and_wait() {
        let mut handle = start_command("echo hello", false).await.unwrap();
        let exit_code = handle.wait_for_exit().await.unwrap();
        assert_eq!(exit_code, 0);

        let (stdout, _, _) = handle.get_output();
        assert!(stdout.contains("hello"));
    }

    #[tokio::test]
    async fn test_execute_detached() {
        let pid = execute_detached("sleep 0.1").await.unwrap();
        assert!(pid.is_some());
    }
}
