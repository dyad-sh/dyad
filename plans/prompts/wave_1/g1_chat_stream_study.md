# G1 — Chat-stream/main feasibility study (design doc, no production code)

Produce the design gate G1 study required by plans/cleanup-state-machines.md
("Design gate G1 — Chat-stream/main feasibility study"). Read that section
for the ten questions and five required artifacts (serializability
inventory, target state/read-model schemas, acceptance transaction,
migration sequence, deletion budget).

Inputs to read: the G1a DECIDED section (status/error are settled — do
not relitigate); recorded product decisions 1–5 and the Remote intent
policy; the actor lifecycle matrix row for chat_stream;
plans/distrbuted-machines.md ("Chat-stream feasibility study" section and
the durable protocol actor pattern); plans/claude-cleanup-machines.md
recipes for chatMessagesByIdAtom, the queue pair, and planStateAtom
(reader inventories and invariants to preserve — recipes to evaluate,
not preapproved); src/chat_stream/ and src/user_input/follow_up_handoff.ts
as they exist today (the memory-only handoff design and its documented
structural-safety argument are inputs to the durable-acceptance
question).

Deliverable: plans/g1-chat-stream-study.md — decision-forcing: each
question gets a recommendation, the alternatives, and rejection reasons;
ends with (a) a go/no-go recommendation for the C3 host move, (b) the
A6b subset that is safe to build renderer-side regardless of the host
outcome, and (c) the updated chat_stream row of the actor lifecycle
matrix. Where a recommendation depends on unmeasured performance (chunk
fan-out, snapshot frequency), name the measurement and its threshold
instead of guessing.
