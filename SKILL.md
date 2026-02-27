# code-workflow (cw)

Multi-agent workflow orchestration engine for software development tasks.

## Overview

`cw` orchestrates multiple AI agents through a defined workflow pipeline. It supports three execution backends:
- **OpenClaw**: Gateway API for cloud-hosted agents
- **Cursor**: Local Cursor Agent CLI
- **Manual**: Human approval gates

## Usage

```bash
# Start a workflow
cw run ./workflows/feature-dev "Add user authentication with JWT"

# Check progress
cw status

# Approve a step waiting for human review
cw approve <step-id-prefix>

# Reject a step
cw reject <step-id-prefix> "Needs more detail in the plan"

# List all runs
cw runs

# Resume a failed run
cw resume <run-id>

# Cancel a run
cw stop <run-id>

# View event log
cw logs [run-id]

# View stories
cw stories <run-id>
```

## Workflow Definition

Workflows are defined in YAML (`workflow.yml`):

```yaml
id: my-workflow
name: My Workflow

agents:
  - id: planner
    name: Planner
    executor: openclaw    # openclaw | cursor | manual
    role: Plan the work

steps:
  - id: plan
    agent: planner
    approval: true        # requires human approval
    input: |
      Analyze: {{task}}
```

## Context Propagation

Steps can produce key-value outputs (`KEY: value` lines) that are merged into the run context. Later steps reference them via `{{key}}` templates.

## Loop Steps

A step can loop over stories produced by a previous step:

```yaml
steps:
  - id: develop
    agent: developer
    loop:
      over: stories
      as: story
    input: |
      Implement: {{story}}
```
