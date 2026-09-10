---
name: consult-with-claude
description: >-
  Iterate, critique, and refine technical plans, architectures, or implementations
  back and forth with Claude Code on the CLI. Use when the user asks to consult Claude,
  review plans with Claude, bounce ideas off Claude, or run multi-agent plan iteration.
---

# Consult with Claude

This skill enables the agent to collaborate, stress-test, and iterate back-and-forth on architectures, plans, and code with **Claude Code** (`claude` CLI) directly in the terminal.

## Prerequisites & Verification

Check that the Claude CLI is available and authenticated:

```bash
which claude && claude --version
```

When executing non-interactive prompts, always redirect stdin from `/dev/null` (or pipe input) so Claude does not block waiting for stdin:

```bash
claude -p "Your prompt here" < /dev/null
```

Or when passing a file or artifact:

```bash
claude -p "Review and critique this plan:" < path/to/plan.md
```

## The Multi-Turn Plan Iteration Protocol

When iterating on a plan back and forth with Claude:

### Step 1: Formulate the Consultation Frame
Clearly state the role and objective to Claude. Do not just ask "what do you think?". Use a specific lens:
- **Red-teaming / Steelmanning**: "Attack this plan. Identify the top 3 silent failure modes, UX traps, and API limitations. Propose concrete mitigations."
- **Alternative Architecture**: "What simpler or more robust architecture would you recommend for this specific requirement?"
- **Trade-off Analysis**: "Compare Option A vs Option B under constraint X."

### Step 2: Send Artifact to Claude
Execute the query via `run_command`:

```bash
cat <artifact_path> | claude -p "You are an expert systems architect. Review this plan with a critical eye: 1) What edge cases or API traps are missing? 2) What would make this more resilient? 3) Propose concrete improvements."
```

### Step 3: Digest and Counter-Propose (Back-and-Forth Turn)
Analyze Claude's response:
- Identify strong recommendations to adopt immediately.
- Identify points of disagreement, trade-offs, or constraints Claude may have missed.
- Formulate a targeted counter-inquiry back to Claude to resolve tensions:

```bash
claude -p "Regarding your suggestion on [X]: in our context, [Constraint Y] applies. How would you adjust your recommendation to account for this?" < /dev/null
```

### Step 4: Synthesize & Update Plan Artifact
Update the target plan artifact (e.g. `implementation_plan.md`) with the consensus, highlighting:
- Points refined through consultation with Claude.
- Retained architectural decisions with explicit rationale.

### Step 5: Report to User
Provide a transparent summary of the debate:
- Claude's primary critique / suggestions.
- Our synthesis and counterpoints.
- The resulting unified, hardened plan.
