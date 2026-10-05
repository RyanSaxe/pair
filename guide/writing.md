# Writing

You write a page to explain code, to put a decision to the reviewer or to
show built work. Put the facts, choices, reasons and consequences on the
page. Remove
commentary about the page itself.

Most context is short: one line of consequence under an option, a caption, a
heading or a row in a checklist. Write each of those lines so the reviewer
understands it on a first reading.

## Write concrete sentences

Name the actor. Use `is`, `has` or `contains` when one of those words states
the fact plainly. Otherwise use a specific verb. Do not make an abstract idea
carry out an action when the system, the agent or the reviewer does it.

| Avoid                                       | Write                                                              |
| ------------------------------------------- | ------------------------------------------------------------------ |
| "The answer travels with feedback."         | "Feedback includes the answer under `groups.answers`."             |
| "A checklist arrives with nothing checked." | "Start each checklist with no checked boxes."                      |
| "The round closes open points."             | "Move the settled choice to Agreed before removing its page."      |
| "The hub wakes you with a submission."      | "The hub sends a wake event when a submission arrives."            |
| "The mock reads as it is."                  | "The component mock renders at its natural width without scaling." |

Use a stronger verb when it names the action: "The frame stores the draft"
is clearer than "The draft is stored" because it names the actor.

Use the real name. Write "`problems()` refuses an option label over 24
characters", not "the build enforces a limit on labels".

Use the words a person would say. Introduce a term from the project once, in
plain words, before you rely on it, and never use a state's name as if the
reader knew what it means. Write "the nightly job that re-sends failed
receipts", not "the replayer", until the page has said what the replayer is.
Put "only" right before the verb it limits: "Only retry a request the server
did not receive", not "Retry a request only when the server did not receive
it".

Give a reason with every judgment. Write "One Redis cache is simpler because
four web processes read one copy" instead of "One Redis cache is simpler".

Put one idea in a sentence. Two half-thoughts joined by a semicolon are two
sentences.

A heading and an option's `data-label` are labels. Make the claim in a
sentence under the label. Write "Retry policy", not "Retries are the risk here".
Use "Body contents" as a heading, not "What the body carries". In prose,
write "The body contains the request payload."
Use a decision heading for the question the reviewer must answer.

Write so a stranger to the project can repeat any sentence back as a fact
about the plan or the code on the page.

Say each thing once. Do not open a section by restating its heading.

## Avoid these

Personification, writing a thing as if it did what only a person does:
"The schema wants a migration before the deploy." Write "the deploy fails
unless the migration runs first." When you write that a file, a page or a
field "holds", "carries", "knows" or "wants" something, the reader has to
work out what actually happens and who does it, so name who acts and what
they do.

A fragment in place of a claim: "One hub, many sessions." Write "one hub
process serves every live session."

Inverted word order or an aphorism: "Anything the plan does not show, they
do not know." Write "they know only what the plan shows."

Metaphor: "The cache is the beating heart of the request path." Write "every
request reads the cache before it reads the database."

Your own care as the subject: "After careful consideration, the retry
belongs in the client." Write "the retry belongs in the client, because the
server cannot tell a dropped response from a dropped request."

A vague word where you have a number: "The endpoint is slow under load."
Write "the endpoint takes 1.9s at 200 requests a second."

A symptom without its cause: "Retries sometimes make the outage worse."
Write "each retry opens a new connection, so a 30-second outage leaves 400
sockets in TIME_WAIT."

Denial: "This is not a rewrite, it is a refactor." Write "the public methods
keep their signatures, and the storage layer changes."

The page describing itself: "The table below compares the three options."
Cut the sentence. The reviewer can see the table.

Fluff: "The trade-off here is real, and it is structural." Delete a sentence
if removing its project names and numbers leaves a generic sentence. Keep it
when its meaning depends on those names and numbers. Check the last sentence
of a section, the first sentence under a heading and each option's
consequence first, because filler is most common there.

Em dashes: use a period or a comma.

## When to break a rule

If you would not say a sentence out loud to the reviewer, do not write it,
whatever these rules say. Keep the names, the numbers and the reasons.
