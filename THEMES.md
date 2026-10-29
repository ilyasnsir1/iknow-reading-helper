# Themes

Choose Original (the existing default design), Midnight (dark blue), Tokyo Neon (dark purple) or Kyoto
Forest (dark green). Original retains each screen's existing colors and gradients. Only the three additional themes override those original palette styles. All four use the same layout, controls and learning data.

There are two independent preferences:

- App theme: choose in the popup under App theme, or in the header of Study,
  Models & voices, Preparation, Setup, Word audio or Diagnostics. This choice
  synchronizes across those pages and the popup.
- Course panel theme: choose in the Reading Helper toolbar on iKnow, or on its
  series preparation panel. This choice applies only to the website's Reading
  Helper UI and is shared across courses and series. Its default is Original.

Changing one does not change the other. Both choices survive reloads. The
existing app preference is retained; the new course-panel preference starts at
Original until it is explicitly changed on iKnow.

Only Reading Helper's UI is themed on iKnow; original website text, Japanese
sentence colors and the pixel fox artwork retain their existing appearance.
The additional themes use cool-to-warm status gradients and a separate warmer
control surface. Small study/language buttons outside those panels stay light
to fit the white native course area. Popup notices and preparation/model-job
cards use the same corresponding status palette.
Theme switching writes one small local preference. It never prepares or
downloads a course/model, rerenders all the sentences, or changes voice settings.

The preferences are independent of learning settings. Invalid/unknown values fall
back to Original. A small local cache on the extension's own pages provides the
initial color; extension storage remains authoritative. No preference is uploaded.

The selector supports keyboard focus and Escape. The Study course menu displays
long titles with even padding and supports arrows, Home/End, typing and Enter.
Focus indicators use the control's own border rather than an outside ring.
