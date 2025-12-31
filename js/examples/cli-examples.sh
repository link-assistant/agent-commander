#!/bin/bash

# CLI usage examples for agent-commander

echo "=== CLI Usage Examples ==="
echo ""

echo "1. Basic usage (no isolation):"
echo "start-agent --tool claude --working-directory \"/tmp/dir\" --prompt \"Solve the issue\""
echo ""

echo "2. With system prompt:"
echo "start-agent --tool claude --working-directory \"/tmp/dir\" \\"
echo "  --prompt \"Solve the issue\" \\"
echo "  --system-prompt \"You are a helpful assistant\""
echo ""

echo "3. Screen isolation (detached):"
echo "start-agent --tool claude --working-directory \"/tmp/dir\" \\"
echo "  --prompt \"Solve the issue\" \\"
echo "  --isolation screen --screen-name my-agent --detached"
echo ""

echo "4. Docker isolation (attached):"
echo "start-agent --tool claude --working-directory \"/tmp/dir\" \\"
echo "  --prompt \"Solve the issue\" \\"
echo "  --isolation docker --container-name my-agent"
echo ""

echo "5. Dry run mode:"
echo "start-agent --tool claude --working-directory \"/tmp/dir\" \\"
echo "  --prompt \"Test\" --dry-run"
echo ""

echo "6. Stop screen session:"
echo "stop-agent --isolation screen --screen-name my-agent"
echo ""

echo "7. Stop docker container:"
echo "stop-agent --isolation docker --container-name my-agent"
echo ""

echo "=== Run with --dry-run to see generated commands ==="
