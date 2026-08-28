# NEBULA PLAYER — AGENT IMPLEMENTATION BRIEF

> **Purpose:** concise implementation brief derived from `NEBULA_PLAYER_DESIGN_SPEC.md`.
>
> **Current target:** Frosted Glass only.
>
> **Liquid Glass:** future-compatible architecture; do not implement now.
>
> **Priority:** faithfully implement the frozen design. Do not invent additional visual behavior.

---

# 1. Non-Negotiable Product Intent

Nebula Player is a spatial music experience, not a conventional player UI with decorative glass.

Core principle:

> **Music changes space; space expresses music.**

The user may customize visual density extensively, but the default experience must already be curated and coherent.

---

# 2. Current Scope

Implement now:

- Bottom Player redesign;
- Listening Space;
- Spatial Lyrics;
- Inner Lyrics;
- Music Orb;
- Atmosphere/Airflow baseline;
- Frosted material baseline;
- Bottom → Listening morph;
- Spatial ↔ Inner lyric recomposition;
- Play/Pause stillness;
- basic song transition;
- basic audio-energy response;
- responsive behavior;
- reduced-motion support;
- performance degradation.

Do not implement Liquid Glass yet.

Do not redesign unrelated Nebula modules in this task.

---

# 3. Shared Structural Rules

1. Shared structure must be material-agnostic.
2. Frosted is the current material implementation.
3. Liquid must remain possible without changing component hierarchy.
4. Visual weight takes priority over mathematical symmetry.
5. Do not create equal-size button rows for all utilities.
6. Progressive disclosure is mandatory for space-consuming utilities.
7. Dynamic objects must preserve stable spatial anchors.
8. Atmosphere is environmental, not a decorative overlay.
9. Motion must communicate state.
10. When uncertain, choose the more restrained interpretation.

---

# 4. Bottom Player

## Geometry

- rounded rectangle, not full capsule;
- roughly 55–70vw, mildly responsive;
- medium/slightly thick height;
- floating above bottom edge;
- visible breathing gap from viewport bottom;
- no prominent border;
- weak shadow.

## Layout

```text
Left                     Center                   Right
Now Playing Object       Playback Core            Utility Cluster
```

Balance by visual weight, not equal columns.

## Now Playing Object

- cover: roughly 52–60px class, rounded square;
- Song Name: medium;
- Artist: smaller, lighter, lower opacity;
- Song click → Song Detail;
- Artist click → Artist surface;
- Cover click → Listening Space;
- hover should reveal interaction subtly, not with large button styling.

## Playback Core

```text
◀   ❚❚   ▶
```

- centered horizontally;
- Play/Pause slightly larger than Prev/Next;
- hover gets a very light circular surface;
- no giant play button.

## Utilities

- Playback mode always visible;
- Volume icon always visible;
- Volume slider appears **above** icon on hover; never force horizontal expansion when neighbors are crowded;
- Queue entry always visible; queue opens above/near the player;
- Quality is low visual priority; compact text/badge/selector only;
- do not create a uniform button parade.

## Progress

- always visible;
- very thin and subtle;
- no time labels by default;
- hover reveals time and stronger interaction state.

## Auto-hide

- Settings contains the persistent setting;
- lightweight quick control may also toggle it;
- hidden player recedes downward;
- retain minimal edge presence;
- bottom proximity wakes it progressively;
- no abrupt pop-in.

---

# 5. Listening Space

## Geometry

- horizontal rounded rectangle;
- desktop-oriented;
- medium size, approximately 65–72vw starting target;
- responsive;
- not user-resizable;
- application window should have a minimum size to prevent unusable compression;
- should feel like a floating spatial object, not a generic modal.

## Opening

Bottom Player cover click:

> **continuous morph, not page swap.**

Main Stage retreats into:

- blur;
- dimming;
- reduced saturation;
- lower contrast;
- depth recession.

Do not remove the main stage completely.

Main stage should remain barely perceptible.

---

# 6. Listening Space Internal Composition

```text
Player Surface
├── Music Orb (left primary visual region)
├── Typography (right)
└── restrained playback controls

Lyrics Field = outside Player Surface in Spatial mode
Atmosphere Field = connects all layers
```

The Music Orb occupies roughly 50–60% of the left-side visual region, subject to adaptive composition.

Right-side typography is not a sidebar. It is a typography/interaction object.

Playback controls follow the right typography block's visual center.

---

# 7. Music Orb

## Core

- circular artwork;
- subtle material thickness/diffusion;
- floating visual impression;
- stable spatial anchor.

## Absolute constraint

> **The Orb root must not wander around the Player.**

Do not use random whole-object translateX/translateY idle movement.

Animate internals instead:

- artwork;
- orientation;
- progress orbit;
- halo;
- airflow interaction;
- material/light response.

## Idle

Target:

> looks almost static at first glance; subtle life appears during longer observation.

Use multiple frequencies and very small random offsets.

## Progress

- subtle orbital track;
- active point/segment more visible;
- not a conventional thick progress ring.

## Pause

Transition into Stillness:

- stop progress;
- decay artwork motion;
- decay airflow;
- retain subtle atmosphere/material life.

## Resume

Layered wake-up:

1. light;
2. halo;
3. airflow;
4. Orb motion;
5. settle.

## Song change

V1:

- artwork crossfade;
- palette interpolation;
- atmosphere transition;
- progress transition/reset;
- Song/Artist re-focus.

Never fly the old/new Orb around. Keep the same anchor.

---

# 8. Atmosphere / Airflow

## Principles

Atmosphere =:

> music + color + light + air + airflow

Do not implement it as:

- particle wallpaper;
- generic glow blob;
- giant color gradient.

## Airflow

Use conceptual:

- near field;
- mid field;
- far field.

Overall direction can be coherent, but motion must be organically irregular.

Airflow moves independently from audio energy.

Do not code:

```text
Airflow = AudioEnergy
```

## Audio energy

V1 uses simple smoothed real-time energy.

Energy may influence:

- Orb halo;
- mild material response;
- very mild typography response.

Airflow remains independently animated.

Future advanced audio analysis is out of current scope.

## Atmospheric events

Low-frequency, randomized, subtle.

Do not use a simplistic fixed repeating timer as the only mechanism.

---

# 9. Typography

## Song

- medium;
- primary;
- subtle environment response.

## Artist

- smaller;
- lighter;
- more transparent;
- secondary.

Core interaction rule:

> **Light passes across text; text does not self-glow.**

---

# 10. Spatial Lyrics

Spatial lyrics are **outside** the Player Surface.

Structure:

```text
↑ lyric
↑ lyric
↑ CURRENT

[ Player Surface ]

↓ CURRENT
↓ lyric
↓ lyric
```

Rules:

- upper/lower current are the same current line;
- both move upward;
- shared stable vertical axis;
- current line strongest;
- about 3–4 nearby lines meaningfully visible;
- surrounding text fades/blur progressively;
- lower future lines may be slightly stronger than upper past lines;
- no horizontal drift of current line;
- lyric-to-Player gap ≈ 0.5–0.8 × lyric line-height;
- long lines stay single-line when reasonably possible; wrapping is fallback.

---

# 11. Inner Lyrics

Inner mode is:

> **weaker decorative interference + stronger readability.**

When switching Spatial → Inner:

- Listening Space outer geometry does not move;
- Player Surface outer boundary does not move;
- Orb slightly shrinks/repositions;
- Song/Artist move above lyric field as small metadata;
- outer lyrics retreat;
- inner lyrics emerge.

## Typography behavior

- left aligned;
- 5–7 lines under normal conditions;
- current line slightly above center;
- progressive blur/opacity depth;
- current line sharpest and strongest.

## Current line

Old current:

- 1.0 → ~0.25 opacity;
- blur → ~1.5px;
- translateY +4–6px;
- ~300ms.

New current:

- ~0.4 → 1.0 opacity;
- blur → 0;
- scale ~0.98 → 1.02;
- ~300–400ms.

## Scroll

- whole stack scrolls by lyric-line height;
- spring-like motion;
- starting target stiffness ≈170, damping ≈26.

## Word timing

- already-sung text gets theme color/highlight;
- unsung text remains semi-transparent neutral;
- smooth 100–150ms transition target.

Long held word:

- optional left-to-right wipe tied to pronunciation duration.

## Interaction

- mouse wheel scroll only;
- no pointer drag scrolling;
- click lyric → seek to that lyric start time;
- manual scroll pauses auto-follow;
- show subtle return-to-current affordance.

---

# 12. Frosted Material

Current material only:

> **Balanced Frost**

Rules:

- background color/light should remain perceptible;
- background details should be diffused;
- low environmental tint;
- no obvious colored glass look;
- no persistent visible border;
- weak environment-driven edge response;
- weak internal reflection;
- weak contact + ambient shadow;
- tiny material thickness;
- avoid nested glass layers.

Hierarchy:

> **Depth > Material hierarchy > Light > Blur > Transparency**

Do not equate premium appearance with stronger blur.

Global glow and local surface response must be coordinated, not stacked.

---

# 13. Liquid Future Boundary

Do not implement now.

Architect for future capabilities such as:

- refraction;
- specular response;
- optical depth;
- subtle distortion;
- directional edge light.

Liquid must not change:

- component hierarchy;
- layout;
- interactions;
- Orb anchor;
- lyric architecture.

---

# 14. Responsive Rules

Bottom Player:

- 55–70vw target;
- bounded min/max;
- visual-weight balance;
- utilities adapt without becoming equal buttons.

Listening Space:

- responsive but not user-resizable;
- application-level minimum size;
- preserve horizontal rectangular composition.

Orb:

- responsive to available width/height;
- remain within intended left-region proportion;
- do not grow indefinitely.

Spatial Lyrics:

- less height → fewer lines + smaller type + smaller vertical gaps.

Inner Lyrics:

- less width → prioritize lyric area + moderately reduce Orb.

---

# 15. Reduced Motion

When `prefers-reduced-motion` is active:

Reduce or disable:

- Orb idle motion;
- airflow;
- atmospheric events;
- continuous material motion;
- elaborate tilt.

Keep essential state communication:

- play/pause;
- seek;
- core state change;
- essential morph/crossfade.

---

# 16. Performance

Potential high-cost operations:

- large backdrop blur;
- many blurred lyric lines;
- multiple atmospheric layers;
- continuous material effects;
- audio analysis;
- simultaneous animations.

Provide degradation paths.

Reduce in this order when necessary:

1. large blur;
2. background atmosphere layers;
3. lyric blur complexity;
4. continuous Orb motion;
5. atmospheric events;
6. high-cost material responses.

Preserve core information and interaction first.

---

# 17. DIY / Settings

Provide:

- Basic settings for major visual choices;
- Advanced settings for detailed customization;
- clear layer visibility controls;
- a prominent **Restore Default** option near the top of DIY controls.

Default settings are curated and must already look good.

---

# 18. Explicit Anti-Patterns

Do NOT add:

- giant glow;
- persistent glowing border;
- decorative particle stars;
- generic neon gradient fields;
- giant play button;
- equal-size button parade;
- marquee by default for long titles;
- raw modal swap;
- giant flash on song change;
- explosive particles;
- Orb wandering;
- continuous text pulse/glow;
- drag-to-scroll lyrics;
- Liquid implemented as simple transparency + glow;
- Frosted implemented as maximum blur;
- new visual effects solely to “make it cooler.”

---

# 19. V1 / Future Tracking

## V1

The implementation must include the core structural and semantic behavior defined above.

## V1-Lite

Accept simplified implementations for:

- song spectral transition;
- audio energy analysis;
- atmospheric events;
- advanced Orb material interaction;
- fluid shape morph.

The V1 goal is to establish correct semantics, not final optical perfection.

## Future

Do not forget:

- Liquid Glass;
- advanced audio analysis;
- richer spectral transitions;
- richer airflow/environmental optics;
- more sophisticated queue visuals;
- background-aware material adaptation.

---

# 20. Implementation Method

Do not implement everything in one uncontrolled pass.

Use this order:

1. Bottom Player structure.
2. Visual QA.
3. Listening Space shell.
4. Visual QA.
5. Music Orb.
6. Visual QA.
7. Spatial Lyrics.
8. Visual QA.
9. Inner Lyrics.
10. Visual QA.
11. Morph/state transitions.
12. Visual QA.
13. Atmosphere/energy/airflow.
14. Visual QA.
15. Frosted polish + performance.
16. Final Design QA.

After every stage, compare the result against `NEBULA_PLAYER_DESIGN_SPEC.md`.

---

# 21. Agent Decision Rule

When the implementation encounters ambiguity:

1. Prefer the frozen structural rules in `NEBULA_PLAYER_DESIGN_SPEC.md`.
2. Prefer the more restrained interpretation when visual intensity is unclear.
3. Do not invent new visual systems without explicit approval.
4. Do not silently change frozen geometry or interaction semantics.
5. Do not interpret words such as “premium”, “cinematic”, “atmospheric”, or “Apple-like” as implementation instructions. Translate them through the explicit rules in the specification.

> **The agent is implementing a design system, not co-designing a new one during the implementation task.**

---

**End of `PLAYER_AGENT_BRIEF.md`**
