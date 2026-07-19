---
name: codebase-design
description: >-
  Design deep modules with small interfaces at clean seams. Use when adding a
  module, drawing a boundary between systems, or judging whether an interface
  leaks complexity. Favor deep modules (a simple interface over a powerful
  implementation) and place seams where change is most likely.
---

# Codebase Design — deep modules, small interfaces

The goal is to hide complexity, not spread it. A module should be far more
capable than its interface is wide.

## Depth over shallowness

- A **deep** module offers a simple interface over a substantial implementation — it *pays for itself* by hiding real work. Prefer these.
- A **shallow** module's interface is nearly as complex as its body (thin wrappers, pass-through classes, getters/setters over a struct). It adds surface without hiding anything. Avoid or inline them.
- Ask of every new abstraction: *does the caller now have less to think about?* If not, it isn't earning its keep.

## Interfaces

- Design the interface for the common case; push special cases and configuration inside. Callers should get correct behavior with no options in the 90% path.
- Hide information. A leaked implementation detail (a data format, a lock, an ordering requirement) becomes everyone's problem and can't be changed later.
- A general-purpose interface that happens to cover today's need beats one shaped to a single caller — but don't invent generality you can't yet name (see the ponytail ladder).

## Seams

- Put boundaries where change is likely and where two concerns genuinely differ (rendering vs simulation, input vs state, transport vs logic). A good seam lets one side change without touching the other.
- Keep related complexity together. Two modules that must change in lockstep are one module wearing a disguise — that's information leakage; merge them.

Design the seam first, then fill the modules. The boundary is the expensive part to get wrong.
