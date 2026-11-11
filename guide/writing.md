# Writing

Every page and thread reply helps the reviewer understand something or
decide something. Write the facts, choices, reasons and consequences, and
leave out commentary about the page or the reply itself.

## Write for the reviewer

Write from what the reviewer knows: what they have said in the chat and in
threads, and what earlier pages explained. Where a term they have not seen
first appears, explain it in plain words, whether it comes from the project
or from its field. Write "the nightly job that re-sends failed receipts",
not "the replayer", until the page has said what the replayer is.

When an everyday word has a narrower meaning in the field, write the
narrower meaning out. Write "the client chooses a replica in proportion to
its free capacity", not "the client chooses a random replica", which a
reader takes to mean that the client chooses every replica equally often.

Make each label over a number say whether the number is a setting or a
result. "Retries per order" could be a limit someone sets or a count a test
measured, so write "Retry limit" or "Measured retries per order".

Show with a figure what a figure can show, and write prose only for what it
cannot. Cut each paragraph, table and block that does not change what the
reviewer understands or decides.

Before you publish a page or post a reply, read every line of it, captions
and option lines too, with only what the reviewer knows. Rewrite each
sentence they would need to read twice, each label they could take for
something else, and each term they have not seen.

## Write concrete sentences

Name the actor. Use `is`, `has` or `contains` when one of those words states
the fact plainly. Otherwise use a specific verb. Do not make an abstract idea
carry out an action when the system, the agent or the reviewer does it.

| Avoid                                  | Write                                                              |
| -------------------------------------- | ------------------------------------------------------------------ |
| "The answer travels with feedback."    | "Feedback includes the answer under `groups.answers`."             |
| "The round closes open points."        | "Move the settled choice to Agreed before removing its page."      |
| "The hub wakes you with a submission." | "The hub sends a wake event when a submission arrives."            |
| "The mock reads as it is."             | "The component mock renders at its natural width without scaling." |

Use the real name. Write "`problems()` refuses an option label over 24
characters", not "the build enforces a limit on labels".

Give a reason with every judgment. Write "One Redis cache is simpler because
four web processes read one copy" instead of "One Redis cache is simpler".

A heading and an option's `data-label` are labels. Make the claim in a
sentence under the label. Write "Retry policy", not "Retries are the risk here".
Use "Body contents" as a heading, not "What the body carries". In prose,
write "The body contains the request payload."
Use a decision heading for the question the reviewer must answer.

Say each thing once. Do not open a section by restating its heading.

## Build plain sentences

Write sentences the way you would say them to the reviewer.

- Use the usual order: who acts, the action, then what it acts on.
- Put each limiting or qualifying word, such as "only", "never", "also" or
  "not", next to what it changes, and put a limit at the start of an
  instruction.
- Use a verb for an action, not a noun made from one. Write "the hub retries
  the charge", not "the hub performs a retry of the charge".
- Keep a sentence to one idea and about twenty words.
- Use one word for one thing on a page, and keep it.
- Put a condition before the action it controls.
- Keep the small words, such as "the", "a", "is" and "that", that make a
  sentence read as spoken.

## Avoid these

Personification, writing a thing as if it did what only a person does:
"The schema wants a migration before the deploy." Write "the deploy fails
unless the migration runs first." When a file, a page or a field "holds",
"carries", "knows" or "wants" something in your draft, name who acts and
what they do.

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
