# Agreed

## The task

Agreed's source needs a `task`, which says what the session is working
towards as you understand it now, in a title and two or three sentences.
Say what will exist when the work is finished and why, and what you are
leaving out when that matters. The alignments have their own list and open
decisions go on pages, so leave both out of the task.

Write the task in round 1 from the conversation, and revise it whenever
feedback changes what you are building. Never ask the reviewer to approve
it.

| Field  | Contract                                                                                |
| ------ | --------------------------------------------------------------------------------------- |
| title  | What is being built, in a few words.                                                    |
| html   | Two or three sentences: the outcome, why, and what is left out.                         |
| change | Optional marker for this publication only: `new` or `updated`. Leave it off in round 1. |

## Alignments

An alignment is a decision the reviewer settled. Each one is an entry in
the source's `agreements` list.

| Field       | Contract                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| id          | Unique stable alignment ID, kept when the topic changes.                                                                                  |
| title, html | Concise title and the actual alignment, with exact details as needed.                                                                     |
| state       | `agreed` by default. A `reopened` alignment keeps its earlier wording until it is resolved. A `retired` alignment says why in its `html`. |
| change      | Optional marker for this publication only: `new` or `updated`. Leave it off in round 1, because everything on Agreed is new.              |
| sourceRefs  | References to choices, notes, answers, threads or conversation context that support the alignment.                                        |
| source      | Plain source text when no feedback item can be referenced, or why you made a choice.                                                      |
| href        | Optional http or https URL of a source outside the session, such as an issue or a document. The hub refuses any other scheme.             |

Give each alignment `sourceRefs`, `source` or both. When the reviewer
asked you to make a choice, cite their note in `sourceRefs`, and say in
`source` that you chose and why. When the reviewer agreed with a
recommendation on your pages by sending `everything-else-looks-good="yes"`
with no note against it, name the round and the submission ID in `source`,
and say that no note challenged the recommendation.

Each reference has a `kind`:

| kind         | Required fields        | Meaning                                                                                   |
| ------------ | ---------------------- | ----------------------------------------------------------------------------------------- |
| note         | submissionId, noteId   | A saved comment, with its quote and target. noteId is the `id` of its `pair_note`.        |
| choice       | submissionId, choiceId | A saved choice. choiceId is the `id` of its `pair_choice`, such as `page/decision`.       |
| answer       | submissionId, answerId | A saved answer to a question component. answerId is the `id` of its `pair_answer`.        |
| thread       | threadId               | A thread the reviewer started from a note. threadId is the ID `pair read --thread` takes. |
| conversation | text                   | Context from the agent conversation, labeled as such.                                     |

When you publish Agreed, the hub looks up each reference in this
session's saved submissions and threads, and refuses the page when a
submission, thread or item is missing. The hub writes `sourceRecords`, so
do not write them yourself. Remove the previous round's `change` markers
when you publish the next Agreed.

When an alignment is about something the reviewer saw, such as a look, a
layout, wording or an interface, say in its `html` where they saw it: the
round, the page and the figure, prototype or code block.

When the reviewer changes an alignment in a later round, rewrite it, mark
it `change: updated`, and put the source of the change first in
`sourceRefs`.

Before you write or change an alignment, read the feedback and the
conversation it comes from. When the reviewer comments on an alignment,
the `<pair_note>` of their note has the alignment's ID in its `agreement`
attribute. The alignment stays as it is until you rewrite it.

## Keep Agreed current

Write each alignment as it stands now, and keep Agreed short enough to
read. When you update Agreed, merge alignments that have become parts of
one decision, and retire each alignment that no longer holds, with the
reason.

When you merge alignments, keep one part's ID, and give the merged
alignment every part's sources and every exact detail. Retire each other
part with a reason that names the alignment it joined. Keep a retired
alignment on Agreed in the round you retire it, and leave it out after that.
