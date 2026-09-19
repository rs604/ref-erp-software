# The material report, rebuilt in the order he asks the question

**Date:** 19 Sep 2026 · **Status:** live on main · No migration — a screen fault

It was built backwards. It asked for a date and a months-before figure at the
top, and put the item search at the bottom.

> I open this report with a question: "Avon wants another slat conveyor — what
> should I charge?" The first thing I need is the item, then who bought it,
> then what it cost me at the time. Asking for a date first assumes I already
> know which sale I am looking at. I do not — that is what I came here to find.

That is the whole fault, and it is not a layout problem. A settings-first
screen is a screen built around what the query needs rather than what the
person knows when they arrive.

---

## Three steps, in this order

**1 · Search an item.** The first and only thing on the screen. Nothing else is
asked until it is answered. Every typed word has to appear in the name, in any
order, so `slat conveyor` finds `INCLINED SLAT CONVEYOR`. One clear match opens
itself rather than making him pick from a list of one.

**2 · Every sale of that item.** Customer · description · qty · rate · amount ·
date, newest first. Who bought it and what they paid. Table at a desk, cards on
a phone, and a row says it is tappable before it is tapped.

**3 · Pick a sale — and only then the comparison,** for that one sale:

```
Sold to GURSEWAK SINGH NIJJAR, 14 May 2026, ₹12,00,000
INCLINED SLAT CONVEYOR

Months before the sale  [2]   Steel priced for Mar 2026

Material   Then    Now    Change    Simple average of the rate
Angle       ₹49    ₹55    +12.1%    ₹50 → ₹56 · +11%
Channel     ₹92    ₹92      0%      ₹81 → ₹81 · 0%      no buys since Mar 2026
Pipe        ₹55    ₹65    +18.9%    ₹88 → ₹214 · +141.8%
Sheet       ₹72    ₹85    +17.9%    ₹146 → ₹85 · −41.9%

Steel up about 12.2% — spent divided by bought
At the same margin: ₹12,87,840   (material share 60%, editable)
What you charged before: ₹5,20,000 in 2019 · ₹6,10,000 in 2022 ·
                        ₹6,80,000 in 2024 · ₹12,00,000 in 2026 ← this one
Check another item at that time: [          ]
```

**The months-before setting lives on this panel**, beside the thing it changes,
not at the top of the screen. Typed, default 2, and changing it redraws the
comparison at once. The other-item search lives here too — a bearing, a gear
box, anything else bought for that job.

**The date is never asked for.** It comes from the sale he picked. Verified
against the live function: a sale on 12 Mar 2024 with 2 months before resolves
to Jan 2024, and with 6 to Sep 2023.

---

## What the screen still refuses to do quietly

- **No month is ever substituted in silence.** "No Channel purchases in Jul
  2026 — nearest is Mar 2026."
- **A stale material says so.** Channel's own latest month is older than the
  others, so `0%` carries "no buys since Mar 2026" rather than reading as a
  price that has not moved.
- **Both averages are on the screen, named.** The headline is spent divided by
  bought; the plain average of the rate is printed beside it every time,
  because the gap is the point: over the same two months the plain average says
  pipe is up 142% and sheet is **down** 42%.

---

## An old loose end closed

In docs/35 I reported that his "Pipe ₹102 now" did not reproduce under any
measure. It does — it is the **simple average**, and it is sitting in the data:
January 2024's simple average for pipe is **₹102.11**. The weighted figure for
the same month is ₹62.03. He was reading the plain average; the screen now
shows both, side by side, labelled.

---

## On a phone

Search full width · sales as cards · tap a card for the panel. The material
cards lead with **Change**, not with the muted simple average — `twoWay` now
takes a `noteCol` so a table says which column belongs beside the card's title.
Left at the default, the aside got the prominent corner and the number he came
for sat at the bottom.

---

## What the tests hold

```
the material report asks for the ITEM first, and nothing else
searching an item shows its sales, and still asks for no settings
picking a sale shows the comparison for THAT sale
and the months-before setting lives on that panel, beside what it changes
```

The order itself is under test. Proved by putting a months-before box back at
the top — the first assertion named it, and the file was restored byte-exact.

The sweep now walks all three steps at both widths and photographs each. Opening
the tab and photographing it proves only that step one drew.

```
admin-permissions 28/28   busy 221/221   cold-open 108/108
nav 46/46   phone 130/130   sweep 47/47   check-live: main matches the repo
```
