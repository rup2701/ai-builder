# UX principles

How we design Appnomics (the Builder and Scout) and every site built with the Builder. Follow them in any change to the Builder UI, the chat, the packs, or the sites they produce. The same file is in `appnomics-builder` and `appnomics-runner`; keep the two copies the same.

Read through Don Norman (The Design of Everyday Things): prompt-based design has a wide **gulf of execution** (what can I do, and how do I say it?) and a wide **gulf of evaluation** (what did the system understand, and what state is it in?). An empty chat box or a blank canvas is a void: when affordances are invisible, the interface fails.

## 1. Radical visibility and discoverability (closing the gulf of execution)
Controls and capabilities must be visible, so people never guess or memorise syntax.
- Move away from the empty, blank-slate prompt. Use contextual ghost prompts, interactive micro-suggestions and live modular chips inside the viewport.
- Do not wait for the owner to discover they can say "Change Our story section to take the whole width". Expose live levers: when they hover a block, show the prompt triggers, for example [Click to redesign layout, adjust padding, or swap background].
- Show the grammar of interaction before they type a word.

## 2. Feedback and system state (closing the gulf of evaluation)
People must see at once what the system understood from their prompt and what it is changing. A delayed, mysterious page shift breaks the feedback loop.
- Instant, granular, plain-words feedback. When a prompt runs (like a Scout change on a live site), the page does not just reload silently.
- Show a visible diff, or a note that turns the change into human-readable actions: "Adjusted Our Story grid to 50/50 split, locked 80px vertical padding, and applied alternate background."
- Over time this teaches the owner the AI's mental model.

## 3. Constraints as guides (signifiers)
Good design uses constraints to lead people to valid actions without a manual.
- Use natural mapping and prompt constraints. Rather than letting vague or broken commands end in errors, auto-complete or suggest structural changes as they type (Layout, Typography, Spacing, Color).

## The aim
Prompt-based design stops feeling like a black-box magic trick and starts feeling like direct manipulation, done through natural language instead of a mouse click.

## Where we already apply it
- Scout's What I understood block: shown only when Scout interpreted or decided something, so it is feedback, not an echo (principle 2).
- Change cards with a title, the concrete changes and a before and after preview (principle 2).
