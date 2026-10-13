---
"uptide": minor
---

A candidate migration pack for Recharts 2 → 3, scored against shadcn-ui/ui and hyperdxio/hyperdx at the
commit before their own upgrade. It is a candidate, not verified: the engine reports every
diagnostic line of a shared cause (a custom tooltip or legend typed from the old props) while the
ground truth records the cause once, so breaking precision is low, and the compile signal is
skipped for hyperdxio/hyperdx's `packages/app`. Rules: `CategoricalChartState` and the mouse
handler fields `chartX`, `chartY`, `activePayload`, custom `Tooltip` content typed with
`TooltipProps`, the `Legend` `payload` prop, `activeIndex`, the removed internal props, `Pie`
`blendStroke`, and the deprecated `Cell` and `Pie` `activeShape`; `alwaysShow` (to
`ifOverflow="extendDomain"`) and the no-op `isFront` and `animateNewValues` are rewritten. Behavior
notes list what compiles and renders differently (`accessibilityLayer` on by default, stacking by
JSX order, legend order, axis lines, `connectNulls`, `CartesianGrid` axis ids). Until it is
verified, `check`, `list` and `fix` treat recharts as generic.
