# Agreements

## The task

The Agreed source has a required `task`: what the plan is building towards,
as the agent currently understands it, in a title and two or three
sentences. Say what will exist when the work is done and why, and what is
deliberately left out when that matters. Other decisions follow it on
Agreed, and open questions belong on pages, so neither goes in it.

State it in round 1 from the conversation, and revise it whenever
feedback changes what is being built. The reviewer can comment on it when
it is wrong. Never ask the reviewer to approve it.

| Field  | Contract                                                                                |
| ------ | --------------------------------------------------------------------------------------- |
| title  | What is being built, in a few words.                                                    |
| html   | Two or three sentences: the outcome, why, and what is left out.                         |
| change | Optional marker for this publication only: `new` or `updated`. Leave it off in round 1. |

## Decisions

| Field       | Contract                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| id          | Unique stable agreement ID, kept when the topic changes.                                                                                  |
| title, html | Concise title and the actual agreement, with exact details as needed.                                                                     |
| state       | `agreed` by default. A `reopened` agreement keeps its earlier wording until it is resolved. A `retired` agreement says why in its `html`. |
| change      | Optional marker for this publication only: `new` or `updated`. Leave it off in round 1, because everything on Agreed is new.              |
| sourceRefs  | References to choices, notes, answers, threads or conversation context that support the agreement.                                        |
| source      | Plain source text when no feedback item can be referenced, or why you made a choice.                                                      |
| href        | Optional http or https URL of a source outside the session, such as an issue or a document. The hub refuses any other scheme.             |

Each agreement needs `sourceRefs` or `source`. When you decide a choice
because the reviewer asked you to, cite their note in `sourceRefs` and say
in `source` that you chose and why. When the reviewer's Everything else
looks good, `everything-else-looks-good="yes"` on the submission, settled a
proposal the page stated, name the round and submission ID in `source`,
state that the reviewer set it, and explain why the comments did not
challenge it.

Each reference has a `kind`:

| kind         | Required fields        | Meaning                                                                                   |
| ------------ | ---------------------- | ----------------------------------------------------------------------------------------- |
| note         | submissionId, noteId   | A saved comment, with its quote and target. noteId is the `id` of its `pair_note`.        |
| choice       | submissionId, choiceId | A saved choice. choiceId is the `id` of its `pair_choice`, such as `page/decision`.       |
| answer       | submissionId, answerId | A saved answer to a question component. answerId is the `id` of its `pair_answer`.        |
| thread       | threadId               | A thread the reviewer started from a note. threadId is the ID `pair read --thread` takes. |
| conversation | text                   | Context from the agent conversation, labeled as such.                                     |

When Agreed publishes, the hub resolves each browser reference against
this session's saved submissions and threads, and rejects a missing
submission, thread or item.
Do not write `sourceRecords` yourself. Remove old `change` markers on the
next publication, and do not recreate settled entries to fill the record.

When the agreement settles something the reviewer saw, such as a look, a
layout, wording or an interface, its `html` names the material that shows
it: the round, the page and the figure, prototype or code block. Reuse
that material in the final plan, updated to match later agreements.

When agreed material changes in a later round, mark the agreement
`change: updated`, rewrite its text, and put the source that settled the new
wording first in `sourceRefs`.

A valid source does not make the summary correct. Read the feedback and the
conversation before writing or changing an agreement. A note on an agreement
has the agreement's ID in its `agreement` attribute, and the agreement changes
only when you rewrite it.

## Keep Agreed short

The reviewer reads Agreed every round to catch a wrong summary, and skims a
list too long to check. Each round, shorten Agreed without losing a
commitment.

Write each agreement as the decision stands now, and leave its history to
its sources.

Merge agreements that settle parts of one thing, so the reviewer reads each
topic once. Keep one part's ID, and give the merged agreement every part's
sources and every exact detail. Retire each other part with a reason that
names the agreement it joined.

When an agreement states only what is built or left out, put that in the
task, which states both, and retire the agreement with a reason that says
so.

Retire an agreement, with a reason, when nothing left to build or decide
depends on it. Keep a retired agreement on Agreed in the round you retire
it, and leave it out after that.

When Agreed has more than about eight agreements, look for ones to merge,
because the reviewer checks each one every round.
