//! Execute commands while continuously draining both process pipes.
use std::{io, process::Stdio};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    task::JoinHandle,
};

/// Command execution result.
#[derive(Debug, Clone, Default)]
pub struct ExecutionResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub command: String,
}

async fn drain<R: AsyncRead + Unpin>(
    mut pipe: R,
    attached: bool,
    stderr: bool,
) -> io::Result<String> {
    let mut bytes = Vec::new();
    let mut chunk = [0; 8192];
    loop {
        let count = pipe.read(&mut chunk).await?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..count]);
        if attached {
            if stderr {
                tokio::io::stderr().write_all(&chunk[..count]).await?;
            } else {
                tokio::io::stdout().write_all(&chunk[..count]).await?;
            }
        }
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Execute a command, or return the command without spawning in dry-run mode.
pub async fn execute_command(
    command: &str,
    dry_run: bool,
    attached: bool,
) -> io::Result<ExecutionResult> {
    if dry_run {
        println!("Dry run - command that would be executed:\n{}", command);
        return Ok(ExecutionResult {
            command: command.into(),
            ..Default::default()
        });
    }
    let mut handle = start_command(command, attached).await?;
    let exit_code = handle.wait_for_exit().await?;
    let (stdout, stderr, _) = handle.get_output();
    Ok(ExecutionResult {
        exit_code,
        stdout: stdout.into(),
        stderr: stderr.into(),
        command: command.into(),
    })
}

/// Non-blocking process handle. Pipe readers run immediately after spawning.
pub struct ProcessHandle {
    pub command: String,
    child: Child,
    readers: Option<(
        JoinHandle<io::Result<String>>,
        JoinHandle<io::Result<String>>,
    )>,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}
impl ProcessHandle {
    /// Wait for process completion and all output, preserving exact bytes as UTF-8.
    pub async fn wait_for_exit(&mut self) -> io::Result<i32> {
        if let Some(code) = self.exit_code {
            return Ok(code);
        }
        let status = self.child.wait().await?;
        if let Some((stdout, stderr)) = self.readers.take() {
            let (out, err) = tokio::join!(stdout, stderr);
            self.stdout = out.map_err(io::Error::other)??;
            self.stderr = err.map_err(io::Error::other)??;
        }
        let code = status.code().unwrap_or(1);
        self.exit_code = Some(code);
        Ok(code)
    }
    /// Terminate the running command and its Unix process group.
    pub async fn terminate(&mut self) -> io::Result<()> {
        if self.exit_code.is_some() || self.child.try_wait()?.is_some() {
            return Ok(());
        }
        #[cfg(unix)]
        if let Some(id) = self.child.id() {
            // bash's kill builtin is available wherever our executor is supported.
            let output = Command::new("bash")
                .arg("-c")
                .arg(format!("kill -TERM -- -{}", id))
                .output()
                .await?;
            if std::env::var_os("AGENT_COMMANDER_DEBUG").is_some() {
                eprintln!(
                    "Cancel process group {id}: {} {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            if !output.status.success() && self.child.try_wait()?.is_none() {
                return Err(io::Error::other(
                    String::from_utf8_lossy(&output.stderr).into_owned(),
                ));
            }
        }
        #[cfg(not(unix))]
        self.child.start_kill()?;
        Ok(())
    }

    /// Get collected output after waiting for completion.
    pub fn get_output(&self) -> (&str, &str, Option<i32>) {
        (&self.stdout, &self.stderr, self.exit_code)
    }
    /// Check whether completion has been collected.
    pub fn has_exited(&self) -> bool {
        self.exit_code.is_some()
    }
}

/// Start a command and drain stdout/stderr concurrently, with optional console output.
pub async fn start_command(command: &str, attached: bool) -> io::Result<ProcessHandle> {
    let mut command_builder = Command::new("bash");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command_builder.as_std_mut().process_group(0);
    }
    let mut child = command_builder
        .arg("-c")
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    Ok(ProcessHandle {
        command: command.into(),
        child,
        readers: Some((
            tokio::spawn(drain(stdout, attached, false)),
            tokio::spawn(drain(stderr, attached, true)),
        )),
        stdout: String::new(),
        stderr: String::new(),
        exit_code: None,
    })
}

/// Start a detached command with all standard streams disconnected.
pub async fn execute_detached(command: &str) -> io::Result<Option<u32>> {
    let child = Command::new("bash")
        .arg("-c")
        .arg(command)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()?;
    Ok(child.id())
}
/// Signal cleanup callback.
pub type CleanupFn = Box<dyn Fn() + Send + Sync>;

/// Register a Ctrl+C cleanup callback in the current Tokio runtime.
/// Calling the returned function unregisters it without running cleanup.
pub fn setup_signal_handler<F>(cleanup_fn: F) -> impl Fn()
where
    F: Fn() + Send + Sync + 'static,
{
    let task = tokio::runtime::Handle::try_current().ok().map(|runtime| {
        runtime.spawn(async move {
            if tokio::signal::ctrl_c().await.is_ok() {
                cleanup_fn();
            }
        })
    });
    move || {
        if let Some(task) = &task {
            task.abort();
        }
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
    #[cfg(not(target_os = "windows"))]
    async fn test_execute_command_real() {
        let result = execute_command("echo hello", false, false).await.unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("hello"));
    }

    #[tokio::test]
    #[cfg(not(target_os = "windows"))]
    async fn test_start_command_and_wait() {
        let mut handle = start_command("echo hello", false).await.unwrap();
        let exit_code = handle.wait_for_exit().await.unwrap();
        assert_eq!(exit_code, 0);

        let (stdout, _, _) = handle.get_output();
        assert!(stdout.contains("hello"));
    }

    #[tokio::test]
    #[cfg(not(target_os = "windows"))]
    async fn test_execute_detached() {
        let pid = execute_detached("sleep 0.1").await.unwrap();
        assert!(pid.is_some());
    }
}
