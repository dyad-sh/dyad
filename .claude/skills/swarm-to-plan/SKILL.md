---
name: coney:swarm-to-plan
description: Swarm planning session with PM, UX, and Engineering agents who debate an idea, ask clarifying questions, and produce a detailed spec written to plans/$plan-name.md.
---

# Swarm to Plan

This skill uses a team of specialized agents (Product Manager, UX Designer, Engineering Lead) to collaboratively debate an idea, identify ambiguities, clarify scope with the human, and produce a comprehensive plan.

## Arguments

- `$ARGUMENTS`: The idea or feature to plan (e.g., "add collaborative editing", "redesign the settings page")

## Overview

1. Create a planning team with PM, UX, and Eng agents
2. Each agent analyzes the idea from their perspective
3. Agents debate and challenge each other's assumptions
4. Team lead synthesizes open questions and asks the human for clarification
5. After clarification, agents refine their analysis
6. Team lead compiles a final plan and writes it to `plans/$plan-name.md`

## Workflow

### Step 1: Set Up Context

Read the idea from `$ARGUMENTS`. Explore the codebase briefly to understand:

- The current tech stack and architecture (check package.json, key config files)
- Existing patterns relevant to the idea
- Files and modules that may be affected

**IMPORTANT**: Read `rules/product-principles.md` and include the product design principles in the context summary shared with the team. All agents should use these principles to guide decisions autonomously — only flag a tension or trade-off to the user if it is genuinely unresolvable within the principles.

Prepare a brief context summary to share with the team.

### Step 2: Create the Planning Team

Use `TeamCreate` to create the team:

```
TeamCreate:
  team_name: "plan-<slugified-idea-name>"
  description: "Planning session for: <idea>"
```

### Step 3: Create Tasks

Create 4 tasks:

1. **"Analyze idea from product perspective"** - Assigned to `pm`
2. **"Analyze idea from UX perspective"** - Assigned to `ux`
3. **"Analyze idea from engineering perspective"** - Assigned to `eng`
4. **"Debate and refine the plan"** - Blocked by tasks 1-3, no owner

### Step 4: Spawn Teammates

Spawn all 3 teammates in parallel using the `Task` tool with `team_name` set to the team name. Each teammate should be a `general-purpose` subagent.

**IMPORTANT**: Each teammate's prompt must include:

1. Their role description (from the corresponding file in `references/`)
2. The full idea description
3. The codebase context summary you gathered in Step 1
4. Instructions to send their analysis back via SendMessage

#### Teammate Prompt Template

For each teammate, the prompt should follow this structure:

```
You are the [ROLE NAME] on a product planning team. Read your role description carefully:

<role>
[Contents of references/<role>.md]
</role>

You are planning this idea: "<IDEA DESCRIPTION>"

<codebase_context>
[Brief summary of tech stack, relevant architecture, and existing patterns]
</codebase_context>

## Instructions

1. Read your role description carefully and analyze the idea from your expert perspective.
2. Produce a thorough analysis following the output format described in your role description.
3. Identify 2-5 **open questions** — things that are ambiguous, underspecified, or could go multiple ways. For each question, explain WHY the answer matters (what changes depending on the answer).
4. Send your analysis to the team lead using SendMessage.

After sending your initial analysis, wait for the team lead to share the other team members' analyses. When you receive them:

- **AGREE** with points you think are correct
- **CHALLENGE** points you disagree with, giving specific reasoning
- **BUILD ON** ideas from other roles that intersect with your expertise
- **FLAG** any new concerns that emerged from reading others' analyses

Focus on genuine trade-offs and real disagreements, not superficial consensus.
```

### Step 5: Collect Initial Analyses

Wait for all 3 teammates to send their initial analyses.

### Step 6: Facilitate Cross-Role Debate

Once all initial analyses are in:

1. Send each teammate a message with ALL analyses from all three roles
2. Ask them to debate: agree, challenge, build on, or flag new concerns
3. Wait for debate responses

The message to each teammate should look like:

```
All initial analyses are in. Here are the perspectives from all three roles:

## Product Manager Analysis:
[PM's full analysis]

## UX Designer Analysis:
[UX's full analysis]

## Engineering Lead Analysis:
[Eng's full analysis]

Please review the other team members' analyses from YOUR expert perspective:

- AGREE with points that are well-reasoned (say "AGREE: <point> — <why>")
- CHALLENGE points you disagree with (say "CHALLENGE: <point> — <your counter-argument>")
- BUILD ON ideas that intersect with your expertise (say "BUILD: <point> — <your addition>")
- FLAG new concerns that emerged (say "FLAG: <concern> — <why this matters>")

Focus on genuine disagreements and real trade-offs. Don't agree with everything just to be nice.
```

### Step 7: Synthesize Questions for the Human

After the debate, compile all open questions and unresolved disagreements. Group them into themes and prioritize by impact.

Use `AskUserQuestion` to ask the human clarifying questions. Structure the questions to resolve the highest-impact ambiguities. You can ask up to 4 questions at a time using the multi-question format. Key things to ask about:

- Scope decisions (MVP vs. full feature)
- UX trade-offs where the team disagreed
- Technical approach choices with meaningful trade-offs
- Priority and constraints (timeline, performance requirements, etc.)

If there are more than 4 questions, ask the most critical ones first, then follow up with additional rounds if needed.

### Step 8: Share Clarifications and Gather Final Input

Send the human's answers back to all teammates and ask each to provide their **final refined take** given the clarifications. This should be brief — just adjustments to their original analysis based on the new information.

### Step 9: Compile the Final Plan

After receiving final input from all teammates, compile a comprehensive plan document. The plan should synthesize all three perspectives into a coherent spec.

### Step 10: Write the Plan

Create the `plans/` directory if it doesn't exist, then write the plan to `plans/<plan-name>.md`:

```bash
mkdir -p plans
```

The plan file should follow this format:

```markdown
# <Plan Title>

> Generated by swarm planning session on <date>

## Summary

<2-3 sentence overview of what we're building and why>

## Problem Statement

<Clear articulation of the user problem, from PM>

## Scope

### In Scope (MVP)

- <feature 1>
- <feature 2>

### Out of Scope (Follow-up)

- <deferred feature 1>
- <deferred feature 2>

## User Stories

- As a <user>, I want <goal> so that <reason>
- ...

## UX Design

### User Flow

<Step-by-step walkthrough of the primary interaction>

### Key States

- **Default**: <description>
- **Loading**: <description>
- **Empty**: <description>
- **Error**: <description>

### Interaction Details

<Specific interactions, gestures, feedback mechanisms>

### Accessibility

<Keyboard nav, screen readers, contrast, motion considerations>

## Technical Design

### Architecture

<How this fits into the existing system>

### Components Affected

- `path/to/file.ts` — <what changes>
- ...

### Data Model Changes

<New or modified schemas, storage, state>

### API Changes

<New or modified interfaces>

## Implementation Plan

### Phase 1: <name>

- [ ] <Task 1>
- [ ] <Task 2>

### Phase 2: <name>

- [ ] <Task 3>
- [ ] <Task 4>

## Testing Strategy

- [ ] <What to test and how>

## Risks & Mitigations

| Risk   | Likelihood | Impact  | Mitigation |
| ------ | ---------- | ------- | ---------- |
| <risk> | <H/M/L>    | <H/M/L> | <strategy> |

## Open Questions

<Any remaining questions that should be resolved during implementation>

## Decision Log

<Key decisions made during planning and the reasoning behind them>

---

_Generated by coney:swarm-to-plan_
```

### Step 11: Shutdown Team

After writing the plan:

1. Send shutdown requests to all teammates
2. Wait for shutdown confirmations
3. Delete the team with TeamDelete
4. Tell the user the plan location: `plans/<plan-name>.md`

## Error Handling

- If a teammate fails to respond, proceed with the other agents' input
- If the human declines to answer questions, proceed with the team's best assumptions and note them in the plan
- Always write the plan file, even if some perspectives are incomplete
- Always shut down the team when done, even if there were errors

## File Structure

```
references/
  pm.md   - Role description for the Product Manager
  ux.md   - Role description for the UX Designer
  eng.md  - Role description for the Engineering Lead
```
