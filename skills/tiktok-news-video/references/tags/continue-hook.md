# `continue_hook` — hold the hook over this screen

`continue_hook` is the author's way of saying **"this screen is one continuous
opening with the hook — do not cut away."** Present, the screen renders exactly
like the hook scene; absent, it is an ordinary captioned screen.

## It is a SCREEN-level flag, not an asset tag

Every other key in `README.md` sits on an **asset** line and fills a motion
slot for that one image. `continue_hook` is different: it marks the **whole
screen**, so it is written on the `Screen N:` header line, once, after the
narration text:

```
HOOK: "Sắp tới, bạn có thể kiếm lãi từ crypto giống đầu tư truyền thống."
 ảnh: anh_1.jpg

Screen 1: Điều đáng chú ý là Grayscale... | continue_hook
 ảnh 1: anh_2.jpg
```

Mechanically the bare tag is the same thing as marking that screen
`isHook: true` with the **same `hookHeadline` as scene 0** — the extension path
`hook-and-brand.md` already describes. `build-spec.mjs` supports several hook
screens in a row with no change; the skill just has to set the flag and copy
the headline.

## Two looks: bare, or `: split`

The tag takes an **optional value**. Bare means the default full look:

| Written | Look | Maps to |
|---|---|---|
| `continue_hook` | image **covers** edge-to-edge under the card | `isHook: true` |
| `continue_hook: split` | image boxed in the **top half**, card pinned below | `heldHook: true` |

Both carry the **same `hookHeadline` as scene 0**, both suppress karaoke, both
follow the same contiguity rule. `split` is only for when the author wants the
picture framed in a top box rather than filling behind the card; the full
`hook-and-brand.md` covers its geometry.

## What the bare tag does

The screen renders in **full hook style**:

- Its image(s) **cover** edge-to-edge (no blur border) — `isHook` forces
  `fit: cover`, so you never tag `fill_full_screen` here.
- The **branded hook card** stays pinned below, identical to the hook scene.
- **No karaoke** on this screen (its index goes into `spec.captionSkipScreens`
  automatically, like the hook).

The card is static and identical across the hook → screen boundary, so only the
**image behind it changes**. Hook and screen read as one shot.

## The card keeps the HOOK's headline

During a `continue_hook` screen the voice speaks that screen's OWN narration,
but the card still shows the **hook's** headline — the same ALL-CAPS line from
scene 0, unchanged. The screen's own words are **not** put on screen (no
caption, no new headline). That is the point of "one continuous opening": the
text stays put, the picture moves. If the author wants the screen to show its
own words, they want an ordinary cut — they would leave `continue_hook` off.

## Explicit only — no guessing

The pipeline does **not** infer this from the wording. Two lines that "read as
one thought" are still cut apart unless the author writes `continue_hook`.
Present = merge; absent = cut. The author is in full control. (An earlier
version had the skill decide the merge by reading the script; that was replaced
by this explicit flag on 2026-07-23.)

## Where it may go — contiguity

A `continue_hook` screen must sit **immediately after the hook**, or after
another `continue_hook` screen — one unbroken run starting at the hook. Holding
the hook over a screen that has ordinary captioned screens in front of it is
meaningless, so if the flag lands out of that run, **stop and ask** at Step 1;
do not guess which screens the author meant to merge. (Same reasoning as an
unknown tag: something that changes the finished video is not a Step 6
footnote.)

`continue_hook` needs a brand kit, exactly as the hook does — that precondition
is already checked at Step 1.
