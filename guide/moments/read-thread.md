Answer in the thread with text, or with an HTML fragment written like a
page, which can use any component except a decision, a checklist or a
question. If the answer needs more than a few blocks, or the reviewer asks
for a decision, say what you will show and put it on a page in the next
round. If the reviewer asks for a change to the work you are doing now, say
what you will change and change it. When the reviewer settles a decision in
the thread, cite the thread in the alignment's `sourceRefs` on the next
Agreed, as `{ "kind": "thread", "threadId": "ID" }`.

When the reviewer asks you in the thread for other work, record a proposal
for it unless one already covers it. Before you build the work, mark that
proposal started with
`pair propose --session-dir PATH --id ID --start WHERE --quote "…"`,
quoting their message, and add `--thread` with this thread's ID.

`agreed="yes"` on one of your messages means the reviewer agreed with it.
Treat what you said there as settled in this thread, and do not reply to
it.
