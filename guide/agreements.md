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
in `source` that you chose and why. When the reviewer agreed to a proposal
the pages stated by sending `everything-else-looks-good="yes"`, and no note
challenged it, name the round and the submission ID in `source` and say
that no note challenged the proposal.

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
conversation before writing or changing an agreement. The `<pair_note>` of
a note on an agreement has the agreement's ID in its `agreement` attribute,
and the agreement changes only when you rewrite it.

## Keep Agreed current

Agreed should state each decision as it stands now and stay readable. When
you update Agreed, merge agreements that have become parts of one decision,
and retire, with a reason, each agreement that no longer stands.

When you merge agreements, keep one part's ID, and give the merged
agreement every part's sources and every exact detail. Retire each other
part with a reason that names the agreement it joined. Keep a retired
agreement on Agreed in the round you retire it, and leave it out after that.
