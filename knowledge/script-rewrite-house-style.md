# Script rewrite — house style (locked standard, not freeform)

Applied to every scene's text before narration/rendering. This is a
repeatable content-quality bar, not "ask an LLM to simplify it."

## The bar

1. **Zero-background-knowledge readable.** Anyone with no prior context on
   the topic understands it on first read — no jargon that needs explaining,
   no term that would send the reader to search something up. If a term is
   unavoidable (a proper noun, a technical figure), define it inline in one
   clause, not a footnote.
2. **Every scene must land one of these framings** (pick per scene based on
   its content — never templated to always use the same one):
   - an everyday-situation analogy anyone recognizes
   - a psychology/behavioral framing ("this is why people do X")
   - a storytelling angle (a mini narrative arc within the scene)
   - a "why this matters to you" insight — the content's downstream effect
     on the reader's life/money/decisions
3. **State the reasoning.** Alongside the rewritten text, the agent writes a
   short line explaining *why* that framing was chosen for that scene (e.g.
   "→ dùng ẩn dụ 'đổ xăng' vì người đọc không cần hiểu lãi suất kỹ thuật vẫn
   thấy ngay tại sao giá tăng lại đau"). This lets the user judge and correct
   a choice, not just accept a black box.

## Output surface (confirmed with user)

Text only, in chat — **no visual Artifact, no blur-reveal UI**. Present as:

```
### Scene N
**Gốc:** [original text]
**Xào lại:** [rewritten text]
**Vì sao:** [one-line reasoning per point 3 above]
```

Then ask once, for the whole batch: "Giữ bản xào lại này, hay bạn muốn sửa
scene nào?" — if the user pastes an edit for one or more scenes, use their
text verbatim for those scenes (no further rewriting on top of a user edit)
and keep the agent's rewrite for the rest.

## What NOT to do

- Don't over-explain or add a `[NOTE: this means...]` gloss — the rewrite
  itself must already be plain; a gloss on top means the rewrite failed
  the bar.
- Don't force the same framing (e.g. always "imagine you're at a coffee
  shop...") across every scene in a video — vary it, or the house style reads
  as a gimmick instead of genuine clarity.
- Don't rewrite a scene the user already edited/pasted — their text is final
  for that scene.
