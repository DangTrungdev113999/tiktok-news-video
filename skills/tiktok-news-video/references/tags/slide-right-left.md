# `slide_right_left` — travel across the picture, right to left

```
anh_1.jpg | slide_right_left
anh_1.jpg | slide_right_left: 20% 20%
anh_1.jpg | slide_right_left: 20% 20%, top 20%
```

The mirror of `slide_left_right`. **Read `slide-left-right.md` first** — the
value grammar, the vertical anchor and its zoom, the blur-band rule, the
easing, the tag conflicts and the parsing are all identical. This file is only
the delta.

## The delta

The travel runs right to left, and the two insets follow it:

| Written | Travels from | to |
|---|---|---|
| `slide_right_left` | 100% | 0% |
| `slide_right_left: 20% 20%` | 80% | 20% |
| `slide_right_left: 10% 30%` | 90% | 30% |

The first number is always the inset from the edge the move **starts** at, the
second from the edge it **ends** at. That holds in both slide tags, so the two
are true mirrors: the same value produces the same framing traversed the other
way.

In `spec.json` this shows up as nothing more than `from > to`:

```json
"slide": { "from": 0.8, "to": 0.2 }
```

There is no separate direction field to keep in sync — see
`slide-left-right.md` for why the endpoints alone carry it.

## When to choose this direction

Rarely arbitrary. Two things decide it:

- **Follow what is in the picture.** If a subject faces or moves left, travel
  left; the frame moving with them reads as motivated, moving against them
  reads as fighting the composition.
- **Alternate on consecutive slides.** Two shots sliding the same way in a row
  read as one long uninterrupted drift and the cut between them goes unnoticed.
  Reversing the second is the cheapest way to make the cut land.
