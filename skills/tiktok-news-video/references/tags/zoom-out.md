# `zoom_out` — pull back by a stated amount, across the whole shot

```
anh_1.jpg | zoom_out: 50%
anh_1.jpg | zoom_out
```

`zoom_in.md` reversed, and everything in that file applies here unchanged —
the ceiling, the easing, the tag interactions, the parsing, the effect on the
push/pull rotation. **Read `zoom-in.md` first**; this file is only the delta.

## The delta

The shot **starts** zoomed in by the stated amount and settles back to the
natural framing by the end. `zoom_out: 50%` starts at 1.5× and ends at 1.0×.

| Value | Starts at | Ends at |
|---|---|---|
| `zoom_out: 50%` | 1.5× | 1.0× |
| `zoom_out` (bare) | 1.2× | 1.0× |

So the percentage means the same thing in both tags — **how far from natural
framing the zoomed end of the move is**. It is not a direction-dependent
reading, and an author who writes `zoom_out: 50%` after `zoom_in: 50%` gets a
symmetrical pair.

## When to reach for it rather than `zoom_in`

A pull-back **reveals context**: it opens from a detail to the scene around it.
Use it when the narration widens out — naming a place after naming a person,
or moving from one person to the crowd they are standing in. A push does the
opposite; it narrows attention onto something just named.

Two pushes back to back flatten out, which is exactly why the automatic
classifier alternates them. If several consecutive shots are tagged, alternate
them by hand for the same reason.

## `target` runs backwards

`zoom_out: 40%, target b trong anh_1_des.jpg` **starts** close on the marker and
pulls back off it — the exact mirror of `zoom_in`'s aimed push. This is the
strongest way to say "this, and here is where it sits": the viewer reads the
detail first, then the context it belongs to.

Only meaningful for a single target. Reversing a multi-target tour would just
be the same tour in the other order, which the author can already write.

## What ships

```json
{ "effect": "zoom", "zoomVariant": "out", "zoomTo": 1.5, ... }
```

`zoomTo` is the **zoomed** end of the move in both variants — the renderer
reads `zoomVariant` to know which end of the shot it belongs to. Keeping one
field mean one thing regardless of direction is what makes the symmetry above
fall out of the code rather than being a coincidence.
