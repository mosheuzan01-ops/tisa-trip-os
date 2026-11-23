---
name: "handoff-and-learning-loop"
description: "Use at the end of a long session, when a chat gets long, or when the user says what worked or failed. Packs decisions into a handoff prompt and proposes updates to standing instructions."
---

# Handoff + Learning Loop

Purpose: continue in a fresh chat without losing decisions, and improve the working instructions over time instead of starting from zero.

Reply in the user's language (Hebrew by default).

## Part A: Handoff
Produce one block the user can paste into a new chat, and also save a copy in the relevant Claude Project when reachable (for example `tisa/HANDOFF_STAGE_N.md`), not only in the code repository, so the next chat can read it directly. In a cloud session without access to the Claude Project, save it in the repository and say so:
1. **Project and goal**: two lines.
2. **Decisions made**: only what the user actually decided, with the reason when it matters.
3. **Files and outputs created**: names and what each is for, with paths exactly as they are in the repository. Say separately what lives only in the Claude Project folder.
4. **Open problems**: what is unresolved or unverified.
5. **Next task**: one clear next step. The user's request mixes a small fix with a new feature mapped to a later stage, so ask once where it goes before building. Tell the next chat to check what is already merged on the main branch before raising open questions from this handoff, so it does not ask about something already done.
6. **Rules to keep**: tone, language, constraints the user set.
Leave out chat history, drafts that were discarded and anything the user did not confirm.

## Part B: Learning loop
At the end of a task, ask three short questions (or infer from what the user said, and confirm):
- What worked and should repeat?
- What failed or needed fixing?
- What should change in the standing instructions or a skill?
Then propose specific edits to the relevant skill or instruction text as a small before/after. Apply nothing without the user's approval. If a rule keeps being corrected, suggest making it a permanent rule.

## Rules
- A handoff is a summary of confirmed state, not a new plan.
- Do not store sensitive personal details in the handoff unless the user asks.
- Keep the handoff short enough to read in under a minute.

## Pass/Fail check
- [ ] A new chat could continue from the block with no other context.
- [ ] Only user-confirmed decisions are listed as decisions.
- [ ] Open problems and the next task are explicit.
- [ ] Proposed skill edits are specific and awaiting approval.