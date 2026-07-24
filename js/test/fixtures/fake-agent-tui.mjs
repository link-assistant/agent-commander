const clear = '\u001b[2J\u001b[H';
const tool = process.argv[2];
const initialDimensions = `${process.stdout.columns}x${process.stdout.rows}`;
let state = `ready:${tool}:${initialDimensions}`;

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdout.write(`${clear}${state}`);

let input = '';
process.stdin.on('data', (chunk) => {
  for (const character of chunk.toString()) {
    if (character === '\r') {
      state = [
        `user:${input}`,
        'tool_call:read README.md',
        `waiting-resize:${process.stdout.columns}x${process.stdout.rows}`,
      ].join('\n');
      process.stdout.write(`${clear}${state}`);
      input = '';
    } else {
      input += character;
    }
  }
});

const resizeWatcher = setInterval(() => {
  const dimensions = `${process.stdout.columns}x${process.stdout.rows}`;
  if (dimensions !== initialDimensions) {
    clearInterval(resizeWatcher);
    state = [
      state,
      `assistant:${tool} completed`,
      `resized:${dimensions}`,
    ].join('\n');
    process.stdout.write(`${clear}${state}`);
    setTimeout(() => process.exit(0), 20);
  }
}, 5);
