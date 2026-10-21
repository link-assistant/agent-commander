//! Execute commands while continuously draining both process pipes.
use std::{
    io,
    process::{ExitStatus, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    task::JoinHandle,
    time::Instant,
};

/// Time a process group may keep running after `terminate` before `SIGKILL`.
pub const DEFAULT_KILL_AFTER: Duration = Duration::from_secs(5);
/// Time the pipes may stay open after the wrapper shell exited.
///
/// A grandchild that inherited stdout (`(sleep 600 &)`) otherwise holds
/// `wait_for_exit` open forever (hive-mind#3015).
pub const DEFAULT_PIPE_DRAIN: Duration = Duration::from_secs(5);

/// Command execution result.
#[derive(Debug, Clone, Default)]
pub struct ExecutionResult {
    pub exit_code: i32,
    /// Signal that ended the process (`SIGKILL`), also inferred from 128 + N
    pub signal: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub command: String,
}

const SIGNALS: &[(i32, &str)] = &[
    (1, "SIGHUP"),
    (2, "SIGINT"),
    (3, "SIGQUIT"),
    (4, "SIGILL"),
    (5, "SIGTRAP"),
    (6, "SIGABRT"),
    (8, "SIGFPE"),
    (9, "SIGKILL"),
    (11, "SIGSEGV"),
    (13, "SIGPIPE"),
    (14, "SIGALRM"),
    (15, "SIGTERM"),
    #[cfg(target_os = "linux")]
    (7, "SIGBUS"),
    #[cfg(target_os = "linux")]
    (10, "SIGUSR1"),
    #[cfg(target_os = "linux")]
    (12, "SIGUSR2"),
];

/// Name of a signal number (`9` is `SIGKILL`).
pub fn signal_name(number: i32) -> Option<&'static str> {
    SIGNALS
        .iter()
        .find(|(value, _)| *value == number)
        .map(|(_, name)| *name)
}

/// Signal named by a shell exit code of 128 + N (`137` is `SIGKILL`).
pub fn signal_from_exit_code(exit_code: i32) -> Option<&'static str> {
    if exit_code > 128 {
        signal_name(exit_code - 128)
    } else {
        None
    }
}

/// Exit code and signal of a status; a signal becomes 128 + N.
pub fn normalize_exit(status: ExitStatus) -> (i32, Option<&'static str>) {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(number) = status.signal() {
            return (128 + number, signal_name(number));
        }
    }
    let code = status.code().unwrap_or(1);
    (code, signal_from_exit_code(code))
}

type Buffer = Arc<Mutex<Vec<u8>>>;
type Reader = JoinHandle<io::Result<()>>;

/// Join pipe readers until `deadline`; returns whether all finished. A
/// finished reader is taken out, so it is never polled again.
async fn join_readers(
    readers: &mut [Option<Reader>],
    deadline: Option<Instant>,
) -> io::Result<bool> {
    for slot in readers.iter_mut() {
        let Some(reader) = slot.as_mut() else {
            continue;
        };
        let joined = match deadline {
            None => reader.await,
            Some(deadline) => match tokio::time::timeout_at(deadline, reader).await {
                Ok(joined) => joined,
                Err(_) => return Ok(false),
            },
        };
        *slot = None;
        joined.map_err(io::Error::other)??;
    }
    Ok(true)
}

fn read_buffer(buffer: &Buffer) -> String {
    let bytes = buffer.lock().unwrap_or_else(|e| e.into_inner());
    String::from_utf8_lossy(&bytes).into_owned()
}

async fn drain<R: AsyncRead + Unpin>(
    mut pipe: R,
    buffer: Buffer,
    attached: bool,
    stderr: bool,
) -> io::Result<()> {
    let mut chunk = [0; 8192];
    loop {
        let count = pipe.read(&mut chunk).await?;
        if count == 0 {
            break;
        }
        buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .extend_from_slice(&chunk[..count]);
        if attached {
            if stderr {
                tokio::io::stderr().write_all(&chunk[..count]).await?;
            } else {
                tokio::io::stdout().write_all(&chunk[..count]).await?;
            }
        }
    }
    Ok(())
}

/// Run `kill -<signal> -- -<pgid>`; `0` checks whether the group exists.
#[cfg(unix)]
async fn kill_group(pgid: u32, signal: &str) -> io::Result<std::process::Output> {
    // bash's kill builtin is available wherever our executor is supported.
    let signal = signal.trim_start_matches("SIG");
    Command::new("bash")
        .arg("-c")
        .arg(format!("kill -{signal} -- -{pgid}"))
        .stdin(Stdio::null())
        .output()
        .await
}

/// Whether any process in the group led by `pgid` is alive.
///
/// The wrapper shell can exit while the agent it started still runs in the
/// same group (hive-mind#3015). A group the caller may not signal is alive.
pub async fn is_process_group_alive(pgid: u32) -> bool {
    #[cfg(unix)]
    {
        match kill_group(pgid, "0").await {
            Ok(output) if output.status.success() => true,
            Ok(output) => String::from_utf8_lossy(&output.stderr)
                .to_lowercase()
                .contains("not permitted"),
            Err(_) => false,
        }
    }
    #[cfg(not(unix))]
    {
        let _ = pgid;
        false
    }
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
        signal: handle.signal().map(String::from),
        stdout: stdout.into(),
        stderr: stderr.into(),
        command: command.into(),
    })
}

/// Non-blocking process handle. Pipe readers run immediately after spawning.
pub struct ProcessHandle {
    pub command: String,
    child: Child,
    pid: Option<u32>,
    readers: Option<(Reader, Reader)>,
    stdout_buffer: Buffer,
    stderr_buffer: Buffer,
    pipe_drain: Option<Duration>,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    signal: Option<&'static str>,
}
impl ProcessHandle {
    /// Bound the wait for open pipes after the wrapper exits; `None` waits
    /// until every holder closes them.
    #[must_use]
    pub const fn with_pipe_drain(mut self, pipe_drain: Option<Duration>) -> Self {
        self.pipe_drain = pipe_drain;
        self
    }

    /// Process id of the wrapper shell, which also leads the process group.
    pub const fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// Wait for process completion and all output, preserving exact bytes as UTF-8.
    pub async fn wait_for_exit(&mut self) -> io::Result<i32> {
        if let Some(code) = self.exit_code {
            return Ok(code);
        }
        let status = self.child.wait().await?;
        if let Some((stdout, stderr)) = self.readers.take() {
            let mut readers = [Some(stdout), Some(stderr)];
            let deadline = self.pipe_drain.map(|limit| Instant::now() + limit);
            if !join_readers(&mut readers, deadline).await? {
                // A grandchild still holds the pipes: stop the group, then
                // keep what was read.
                #[cfg(unix)]
                if let Some(pid) = self.pid {
                    if is_process_group_alive(pid).await {
                        let _ = kill_group(pid, "KILL").await;
                    }
                }
                let grace = Some(Instant::now() + Duration::from_millis(500));
                if !join_readers(&mut readers, grace).await? {
                    for reader in readers.iter().flatten() {
                        reader.abort();
                    }
                }
            }
        }
        self.stdout = read_buffer(&self.stdout_buffer);
        self.stderr = read_buffer(&self.stderr_buffer);
        let (code, signal) = normalize_exit(status);
        self.exit_code = Some(code);
        self.signal = signal;
        Ok(code)
    }

    /// Terminate the command and its Unix process group with `SIGTERM`,
    /// escalating to `SIGKILL` after [`DEFAULT_KILL_AFTER`].
    pub async fn terminate(&mut self) -> io::Result<()> {
        self.terminate_with("SIGTERM", Some(DEFAULT_KILL_AFTER))
            .await
            .map(|_| ())
    }

    /// Send `signal` to the process group while any member is alive, even
    /// after the wrapper shell exited. Unless the signal is `SIGKILL`,
    /// `kill_after` sends `SIGKILL` to a group that is still alive then.
    ///
    /// Returns whether a signal was sent.
    pub async fn terminate_with(
        &mut self,
        signal: &str,
        kill_after: Option<Duration>,
    ) -> io::Result<bool> {
        #[cfg(unix)]
        {
            let Some(pid) = self.pid else {
                return Ok(false);
            };
            if !is_process_group_alive(pid).await {
                return Ok(false);
            }
            let output = kill_group(pid, signal).await?;
            if std::env::var_os("AGENT_COMMANDER_DEBUG").is_some() {
                eprintln!(
                    "Cancel process group {pid}: {} {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            if !output.status.success() && is_process_group_alive(pid).await {
                return Err(io::Error::other(
                    String::from_utf8_lossy(&output.stderr).into_owned(),
                ));
            }
            let is_kill = matches!(signal.trim_start_matches("SIG"), "KILL" | "9");
            if let (Some(delay), false) = (kill_after, is_kill) {
                tokio::spawn(async move {
                    tokio::time::sleep(delay).await;
                    if is_process_group_alive(pid).await {
                        let _ = kill_group(pid, "KILL").await;
                    }
                });
            }
            Ok(true)
        }
        #[cfg(not(unix))]
        {
            let _ = (signal, kill_after);
            if self.exit_code.is_some() || self.child.try_wait()?.is_some() {
                return Ok(false);
            }
            self.child.start_kill()?;
            Ok(true)
        }
    }

    /// Get collected output after waiting for completion.
    pub fn get_output(&self) -> (&str, &str, Option<i32>) {
        (&self.stdout, &self.stderr, self.exit_code)
    }
    /// Stdout read so far, also while the process runs.
    pub fn peek_stdout(&self) -> String {
        read_buffer(&self.stdout_buffer)
    }
    /// Signal that ended the process, after waiting for completion.
    pub const fn signal(&self) -> Option<&'static str> {
        self.signal
    }
    /// Check whether completion has been collected.
    pub const fn has_exited(&self) -> bool {
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
    let stdout_buffer = Buffer::default();
    let stderr_buffer = Buffer::default();
    Ok(ProcessHandle {
        command: command.into(),
        pid: child.id(),
        child,
        readers: Some((
            tokio::spawn(drain(stdout, Arc::clone(&stdout_buffer), attached, false)),
            tokio::spawn(drain(stderr, Arc::clone(&stderr_buffer), attached, true)),
        )),
        stdout_buffer,
        stderr_buffer,
        pipe_drain: Some(DEFAULT_PIPE_DRAIN),
        stdout: String::new(),
        stderr: String::new(),
        exit_code: None,
        signal: None,
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
