# Panel control placement

The reorder grip is attached directly to its panel, keeping the same top/left
anchor in folded and expanded preparation layouts instead of centering it in
the compact right-hand controls. Saved scene headers and ordinary cards retain
clearance for their content. The theme picker is a separate toolbar item with
automatic right alignment; the select controls can wrap on narrow screens.

`tests/test-panel-controls-layout.cjs` exercises the production content script,
panel controller and preparation renderer in isolated Brave. Metadata/jobs are
fixtures; no registered native host or user profile is used. It checks Ready,
Partly saved, Preparing, Paused and Saved, both expanded and collapsed, across
four themes and 1100/390-pixel widths (80 grip placements). The moved theme
control stays within the toolbar without label overlap, right-aligns on desktop,
and still changes themes. Keyboard Home/End reordering is also checked.
Screenshots of the actual controls were visually reviewed.

The existing theme regression checks also cover independent app/panel settings,
reload persistence, palette styling, menus, keyboard control and mobile layout.

The user explicitly requested adoption through the popup for this release.
Development and publication therefore leave the registered 1.40.2 installation
and the Desktop sharing copy unchanged. The reviewed 1.40.3 package is built in
a separate release folder, signed and checked against its managed-file baseline.
An isolated earlier installation verifies the upgrade without touching personal
models, saved courses or native registration.
