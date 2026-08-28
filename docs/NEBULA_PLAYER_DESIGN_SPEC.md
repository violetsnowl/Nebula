# NEBULA PLAYER SYSTEM
## Product & UI Design Specification v1.0

> **Status:** Design Frozen / Ready for implementation
>
> **Current implementation target:** Frosted Glass
>
> **Future material target:** Liquid Glass
>
> **Source of truth:** This document supersedes informal discussion, sketches, and exploratory ideas from the design process. Only explicitly marked future/optional items are deferred requirements.

---

# 0. Document Purpose

This document is the design source of truth for the redesign of Nebula's:

1. **Bottom Player** — the persistent/floating bottom playback control surface.
2. **Listening Space** — the expanded playback environment entered from the Bottom Player.
3. **Spatial Lyrics** — the atmospheric, external lyric presentation.
4. **Inner Lyrics** — the focused, readable lyric presentation inside Listening Space.
5. **Music Orb** — the central music object inside Listening Space.
6. **Atmospheric Field** — the environmental visual system connecting music, light, color, air, and motion.
7. **Frosted Material** — the material system being implemented now.
8. **Liquid Material** — a future material expression that must remain structurally compatible with the shared design.

This document intentionally separates **design structure** from **material expression** and from **implementation maturity**.

---

# 1. Product Intent

Nebula is not intended to be a conventional music player with decorative effects.

Its product identity is:

> **A music-centered visual environment where music changes the space, the space expresses the music, and users can compose their own visual listening experience.**

The player system therefore has two complementary jobs:

- **Bottom Player:** identify the current song and provide high-frequency playback control without competing with the main stage.
- **Listening Space:** provide a second, quieter place in which the user can stay with the current song.

The product intentionally supports very different long-term experiences:

- a minimal, calm listening state;
- an atmospheric wallpaper-driven state;
- a spatial card exploration state;
- a highly visual experimental state.

The system must therefore support **user-controlled complexity**, not impose a single permanent visual density.

---

# 2. Core Design Principles

## 2.1 First Impression vs. Deep Use

The first launch should feel visually novel and technically impressive.

Long-term use should feel configurable, comfortable, and personal.

The goal is not:

> "Always minimalist."

The goal is:

> **"Complexity is controllable by the user."**

---

## 2.2 Music Changes Space

Whenever possible, music should be represented as a state that changes:

- color;
- atmosphere;
- light;
- motion;
- spatial focus;
- lyrical presentation.

Avoid arbitrary decoration that has no semantic relation to the music state.

---

## 2.3 Visual Weight > Geometric Symmetry

Elements should be balanced by **perceived visual weight**, not forced into mathematically equal columns or identical spacing.

The system should feel designed, not mechanically gridded.

---

## 2.4 Progressive Disclosure

High-frequency controls should remain discoverable.

Lower-frequency or space-consuming controls should reveal themselves only when needed.

Examples:

- Volume icon: always visible; slider revealed on hover.
- Queue: persistent entry point; expanded queue only when invoked.
- Song/Artist interaction: plain typography by default; interaction becomes visible on hover.

---

## 2.5 No “18 Arhats” Control Row

Do not render every function as an equal-size button in a uniform horizontal sequence.

Controls have visual tiers:

- **Primary:** playback core.
- **Secondary:** common utility controls.
- **Tertiary:** technical or low-frequency information.

Quality selection is intentionally lower-weight than playback control.

---

## 2.6 Spatial Anchor Stability

A visually dynamic object may have rich internal motion while its spatial anchor remains stable.

Most importantly:

> **The Music Orb may animate internally, but the Orb root must not visibly relocate around the Player Surface.**

Do not create whole-object wandering, drifting, or random positional wobble.

---

## 2.7 Atmosphere Is Environment, Not Decoration

Atmosphere must not become:

- a generic gradient block;
- a permanent glow;
- a particle wallpaper;
- a collection of decorative particles.

Atmosphere is an environmental field produced by:

> **Music → Color → Light → Air → Airflow**

It connects the player, Orb, lyrics, and background.

---

## 2.8 Motion Reveals State

Motion must communicate:

- entering a space;
- changing songs;
- starting playback;
- stopping playback;
- changing lyric presentation;
- interacting with a visual object.

Motion must not exist merely because an element "could look cooler" while moving.

---

## 2.9 Stillness Is a Designed State

Paused does not mean visually dead.

Paused means the environment gradually enters **stillness**:

- active motion decays;
- atmosphere remains;
- material remains alive at a very low level;
- progress stops;
- unnecessary activity settles.

---

## 2.10 High Specificity, Low Noise

Nebula must feel visually specific without becoming visually noisy.

Preferred:

> precise, subtle, layered behavior.

Avoid:

> stronger glow, more particles, larger animation, more gradients.

When in doubt, a visual effect should be made weaker rather than stronger.

---

# 3. Shared Player Architecture

The Player System is composed as one coherent family:

```text
Nebula Player System
│
├── Bottom Player
│    ├── Now Playing Object
│    ├── Playback Core
│    ├── Utility Cluster
│    └── Progress
│
└── Listening Space
     ├── Player Surface
     │    ├── Music Orb
     │    ├── Typography Object
     │    └── Playback Controls
     │
     ├── Atmospheric Field
     │
     └── Lyrics Field
          ├── Spatial Lyrics
          └── Inner Lyrics
```

The system is divided conceptually into:

### Shared Structure

Stable across themes and modes.

### Material Expression

Currently Frosted; Liquid later.

### Presentation State

Spatial Lyrics / Inner Lyrics.

### Motion State

Playing / Paused / Transitioning / Hover / Focus.

---

# 4. Bottom Player

## 4.1 Product Role

The Bottom Player is a **low-intrusion floating playback surface**.

Its job is not to become a second visual stage.

Default visual priority:

> Main Stage > Bottom Player > individual controls

It should be easy to use, visually integrated, and quiet enough to ignore.

---

## 4.2 Geometry

### Shape

- Rounded rectangle.
- Not a full capsule.
- Not a rigid low-radius rectangle.
- Rounded enough to feel floating, but still recognizably rectangular.

### Width

Target range:

- approximately **55–70% of viewport width**;
- mildly responsive to window size;
- bounded by reasonable minimum and maximum widths.

Avoid a fixed desktop-only width.

### Height

- Medium height.
- Slightly thicker than a conventional playback bar.
- Must not become visually heavy.
- Must not become a large “sausage” dominating the bottom of the screen.

### Position

- Floating above the bottom edge.
- Always clearly a bottom-level control.
- Must preserve a visible breathing gap from the application viewport edge.
- Must not sit flush against the bottom boundary.

### Border

- No prominent persistent border.
- Surface separation comes primarily from material, blur, contrast, and shadow.

### Shadow

- Weak.
- Used for separation, not decoration.

---

## 4.3 Internal Composition

The internal composition has three conceptual zones:

```text
Left                      Center                    Right
Now Playing Object        Playback Core             Utility Cluster
```

The zones must be balanced by **visual weight**, not equal column widths.

### Left: Now Playing Object

Contains:

- small rounded-square cover;
- Song Name;
- Artist Name;
- optional low-weight Quality indicator associated with the song information.

### Center: Playback Core

Contains:

- Previous;
- Play/Pause;
- Next.

Visual size hierarchy:

> Play/Pause slightly larger than Previous/Next.

The difference must remain subtle.

### Right: Utility Cluster

May contain:

- Playback Mode;
- Volume;
- Queue;
- other future utilities;
- Quality where appropriate, but quality is deliberately lower-weight than primary playback controls.

Do not force all utility functions into identical buttons.

---

## 4.4 Now Playing Object

### Cover

- Small rounded-square artwork.
- Target visual size approximately **52–60 px class**, subject to responsive constraints.
- Click opens Listening Space.
- Hover may create a subtle interaction response.

### Song Name

- Medium size.
- More prominent than Artist.
- Clickable to open Song Detail.
- Default appearance should remain typography rather than button styling.

### Artist

- Smaller than Song.
- Lower opacity.
- Lighter weight.
- Clickable to open the Artist surface.
- Default appearance remains plain typography.

### Hover interaction

Song and Artist must be:

> **Discoverable but not noisy.**

Hover may change:

- very subtle tint;
- very subtle luminance;
- very subtle material response.

Avoid obvious button boxes and persistent underlines.

---

## 4.5 Playback Core

Position:

> centered around the Player's horizontal geometric center.

Controls:

```text
◀   ❚❚   ▶
```

Hierarchy:

```text
Play/Pause > Previous/Next
```

but only slightly.

Hover:

- light circular interaction surface;
- subtle material/light response;
- no large button expansion.

---

## 4.6 Playback Mode

Always visible.

Only the icon is shown.

Each click cycles:

1. sequential;
2. shuffle;
3. repeat.

Do not give it excessive visual weight.

---

## 4.7 Volume

Volume icon remains permanently visible.

On hover:

- reveal a thin horizontal volume control above the icon;
- the slider disappears when the pointer leaves the interaction region.

Important spatial rule:

> **The slider is always above the volume trigger.**

It does **not** expand sideways if neighboring icons would be crowded.

Support:

- pointer clicking;
- mouse wheel adjustment.

This rule intentionally prioritizes local spatial stability over one fixed generic expansion behavior.

---

## 4.8 Queue

Queue is a permanent entry point in the Bottom Player only.

Clicking it opens a queue surface near the Bottom Player.

Queue does not become part of the Listening Space UI.

Queue height is responsive to available viewport space.

V1 should cover:

- current playback item;
- upcoming items;
- basic scroll;
- basic removal/management as supported by existing playback logic.

Detailed advanced queue visuals are deferred.

---

## 4.9 Quality

Quality/source selection is permanently discoverable but intentionally lower visual priority.

Possible forms:

- compact text;
- compact badge;
- small secondary selector.

It may sit near the song name or within another low-weight utility location.

Do **not** render it as a full-size peer of Play/Pause/Next.

Click opens a compact selection surface based on available audio sources/qualities.

---

## 4.10 Progress

Progress must be visible without interaction.

Default:

- extremely thin;
- minimal visual weight;
- no visible time labels.

Hover:

- progress interaction becomes more explicit;
- current/total time becomes visible.

Avoid a conventional thick media-player progress bar.

---

## 4.11 Auto-hide

Auto-hide is an interface behavior, not primarily a playback feature.

Default configuration should exist in Settings.

A quick toggle should also be available through a lightweight utility surface.

When enabled:

- Bottom Player gradually settles downward;
- only a minimal edge presence remains;
- proximity to the bottom interaction zone can wake it;
- appearance is progressive and lightly magnetic, not an abrupt pop-in.

The player must remain recoverable.

The goal is:

> **recede into the environment, not disappear as if deleted.**

---

# 5. Listening Space

## 5.1 Product Role

Listening Space is the user's **second listening environment**.

The intended psychological transition is:

> Discovery / visual exploration → quieter focused listening.

It should feel like entering another part of the same Nebula, not opening an unrelated modal dialog.

---

## 5.2 Opening

Entry trigger:

> clicking the Bottom Player cover.

The Bottom Player morphs into the Listening Space.

Do not implement:

> fade out old player → fade in unrelated new window.

The user's perception must be:

> **the same object expanded and transformed.**

---

## 5.3 Geometry

### Shape

- horizontal rounded rectangle;
- clearly rectangular;
- not square;
- not portrait;
- not a full-screen panel.

### Size

Target visual region:

- approximately **65–72% of viewport scale** as a starting composition target;
- responsive sizing;
- no fixed absolute desktop size as the sole rule.

### User resizing

The Listening Space itself is **not draggable/resizable by the user**.

Responsive size changes are determined by application/window viewport dimensions.

### Minimum application window

Nebula should have a system-level minimum application size that prevents the Listening Space from entering an unusable compressed state.

This is an application/window rule, not merely a CSS rule.

---

## 5.4 Surface Character

Listening Space is:

> **a visual object that also functions as a surface.**

Far view:

> floating surface.

Close view:

> spatial object with depth and material presence.

It must not read as a generic modal.

---

# 6. Main Stage Retreat

When Listening Space opens:

The existing Nebula main stage remains perceptible at extremely low visual weight.

Apply a combination of:

- blur;
- dimming;
- saturation reduction;
- depth recession;
- low contrast.

The main stage is **not removed**.

It becomes environmental context.

Target perception:

> "I am still inside Nebula, but I have entered a quieter space."

The main stage must not compete with Listening Space.

---

# 7. Listening Space Layer Model

Conceptual hierarchy:

```text
L0  Background Context
    Existing Nebula Main Stage

L1  Atmospheric Field
    Color / Light / Air / Airflow

L2  Listening Object
    Player Surface

L3  Primary Visual
    Music Orb

L3  Primary Emotional
    Lyrics Field

L4  Secondary Information
    Song / Artist

L5  Interaction
    Playback Controls
```

The two main attention anchors are:

- Music Orb;
- Current lyric.

Atmosphere is connective tissue, not a third loud protagonist.

---

# 8. Player Surface Internal Composition

The Player Surface uses **asymmetric balance**.

Conceptually:

```text
[ Music Orb / left visual field ]   [ Typography + Controls / right field ]
```

### Orb proportion

The Orb should occupy approximately **50–60% of the left-side primary visual region**, subject to the actual available dimensions.

This is not a fixed global width ratio.

The final result is judged by visual weight.

### Typography

The right-side area is not a traditional sidebar.

It is a:

> **Typography + Interaction object.**

---

# 9. Music Orb

## 9.1 Concept

The Music Orb is a:

> **Music Celestial Object**

It is not simply a circular album cover or spinning CD.

It is the main apparatus through which:

- artwork;
- progress;
- atmosphere;
- depth;
- motion;
- playback state

are visually connected.

---

## 9.2 Artwork Core

- circular artwork treatment;
- subtle material thickness/depth;
- slight diffusion at the edge;
- visually related to a floating object;
- not a flat CSS circle.

The circle is an artwork container with material and environmental context.

---

## 9.3 Spatial Anchor

The Orb's overall center and major position remain stable within the Player Surface.

The following may animate:

- artwork internal movement;
- orientation;
- edge light;
- progress orbit;
- halo;
- airflow interaction;
- material response.

The Orb root must **not visibly translate around the Player** as an idle effect.

---

## 9.4 Motion

Idle motion is intentionally extremely subtle.

Target perception:

> A first glance can mistake the Orb for being static.
>
> A longer observation reveals that it is alive.

Motion sources may include:

- very slow artwork rotation;
- subtle orientation/tilt;
- material movement;
- progress movement;
- atmosphere drift.

Different motions must use different frequencies and amplitudes.

Do not synchronize all motion into one obvious effect.

---

## 9.5 Progress Orbit

The Orb uses a circular/orbital progress concept.

Baseline:

- the full orbit is extremely subtle;
- the current progress location has a more visible active segment/light point;
- the visual should read as an orbital track, not a traditional loading ring.

A very subtle non-perfect/fluid deformation may be added later.

### V1

Implement:

- subtle orbital progress;
- real playback synchronization.

### Future

Refine:

- more organic orbital deformation;
- more advanced material interaction.

---

## 9.6 Atmosphere Halo

When playing:

- the Orb has a subtle surrounding environmental halo.

Halo intensity is influenced by normalized music energy.

When paused:

- halo gradually decays;
- it does not disappear abruptly.

The halo must never become a large obvious glow cloud.

---

## 9.7 Depth

The Orb should look slightly detached from the Player Surface while remaining anchored to it.

Concept:

> **Visual floating, geometric anchoring.**

Depth cues can come from:

- weak contact shadow;
- ambient shadow;
- edge light;
- tiny parallax/orientation response;
- material interaction.

Do not create multiple nested glass layers merely to fake depth.

---

# 10. Orb State: Playing / Paused / Resume

## Playing

Normal Orb motion is active, but subtle.

## Paused: Stillness

On pause:

- progress stops;
- artwork rotation/active motion decays;
- airflow decays;
- atmosphere remains;
- tiny material breathing may remain.

The transition is gradual.

## Resume: Wake-up

On play:

1. environmental light wakes;
2. halo wakes;
3. airflow resumes;
4. Orb motion resumes;
5. normal state settles.

The wake-up is subtle and layered.

---

# 11. Song Transition / Spectral Change

Song changes must feel like the same Music Orb entering a new musical state.

Conceptual sequence:

```text
Old artwork
    ↓
Crossfade / transition
    ↓
Palette interpolation
    ↓
Atmosphere reconfiguration
    ↓
Progress transition/reset
    ↓
New artwork settles
```

### V1

Implement:

- artwork crossfade;
- palette interpolation;
- atmosphere transition;
- progress transition/reset;
- Song/Artist re-focus.

### Future

May add:

- deeper spectral morphing;
- optical distortion;
- more sophisticated atmosphere transformation.

### Hard constraints

Do not:

- fly old Orb away;
- fly new Orb in;
- dramatically spin the Orb;
- flash the screen;
- explode particles;
- relocate the Orb anchor.

The concept is:

> **one celestial object undergoing a spectral change.**

---

# 12. Atmosphere Field

## 12.1 Purpose

Atmosphere exists to connect:

- Music Orb;
- Player Surface;
- Lyrics Field;
- surrounding Nebula environment.

It should be felt before it is consciously identified.

---

## 12.2 Inputs

Primary conceptual inputs:

- current song artwork palette;
- current Nebula atmosphere;
- normalized audio energy;
- playback state;
- interaction state;
- material theme.

---

## 12.3 Layered Airflow

Use three conceptual depth layers:

### Near Field

Around the Music Orb.

Slightly more perceptible.

### Mid Field

Around the Player Surface.

Large-scale environmental motion.

### Far Field

At the outer Listening Space region.

Extremely slow and subtle.

The layers share a general directional tendency but contain natural irregularity.

---

## 12.4 Airflow

Airflow is an **independent environmental movement system**.

Do not define:

```text
Airflow = Energy
```

Instead:

```text
Energy → selected visual responses
Airflow → independent environmental movement
```

Airflow should be:

- slow;
- light;
- organic;
- multi-frequency;
- slightly irregular;
- directionally coherent.

---

## 12.5 Energy

Audio energy is a normalized visual input, not a global animation master.

Conceptually:

```text
Audio signal
   ↓
Normalized energy
   ↓
Per-layer response mapping
```

Different layers may have different sensitivity.

Suggested hierarchy:

- Orb halo: medium sensitivity.
- Typography: very low sensitivity.
- Material response: low sensitivity.
- Airflow: independent.

### V1

Simple real-time audio energy analysis is sufficient.

Possible starting implementation:

- current audio amplitude / smoothed energy from the Web Audio pipeline.

### Future

Upgrade toward:

- beat/onset analysis;
- BPM awareness;
- longer-term energy curves;
- section/high-energy estimation;
- hybrid pre-analysis + live analysis.

Do not make a complex music-analysis engine a prerequisite for V1.

---

## 12.6 Atmospheric Events

The environment may occasionally exhibit low-frequency, non-periodic events:

- subtle light wave;
- slow luminance migration;
- slight atmospheric density shift;
- other extremely restrained environmental changes.

These must not look like scheduled animations.

Avoid simple fixed intervals such as:

```text
setInterval(..., 15000)
```

Prefer stateful, randomized, cooldown-controlled variation.

### V1

May implement a simplified, low-frequency environmental event system.

### Future

Increase organic variation and richer environmental interaction.

---

## 12.7 Atmosphere and Player Material

Airflow may influence the Player Surface slightly.

The influence must be subtle:

### Frosted

- diffuse color/light response;
- gentle haze response.

### Liquid

- future optical response;
- subtle refraction/edge response.

---

# 13. Typography

## 13.1 Song / Artist in Listening Space

Song and Artist remain minimal.

### Song

- medium size;
- primary information;
- mild ambient/material response.

### Artist

- smaller;
- lighter;
- lower opacity;
- lower visual weight.

The hierarchy comes from:

> size + weight + opacity

not merely size.

---

## 13.2 Typography Environment Response

Typography may receive:

- extremely subtle tint;
- extremely subtle luminance variation;
- environmental light response.

Core rule:

> **Light should appear to pass across the text; the text should not behave like a self-glowing object.**

Avoid:

- pulsing type;
- constant shimmer;
- obvious glow.

---

# 14. Spatial Lyrics

Spatial Lyrics are the default highly artistic presentation.

They are **outside the Player Surface**, not inside it.

Concept:

```text
        ↑ lyric
        ↑ lyric
        ↑ CURRENT

    ┌──────────────────────┐
    │     PLAYER SURFACE   │
    └──────────────────────┘

        ↑ CURRENT
        ↑ lyric
        ↑ lyric
```

Both upper and lower currents show the **same current lyric line**.

All lyric motion is vertically upward.

---

## 14.1 Spatial Alignment

- Upper and lower current lines share the same vertical center axis.
- The axis is stable.
- Do not horizontally drift the current lyric according to lyric length.

---

## 14.2 Spatial Visibility

Target:

- current line: strongest;
- approximately 3–4 surrounding lines meaningfully visible;
- farther lines increasingly transparent and blurred;
- lower/future content can be slightly more visually present than upper/past content;
- upper and lower current lines remain nearly equal, with the lower presentation only very slightly stronger.

---

## 14.3 Spatial Typography

- medium-to-large size;
- enough horizontal room for a normal lyric phrase;
- long lines should remain single-line whenever feasible;
- automatic wrapping is a fallback only when the line becomes excessively wide.

Do not force lyrics into narrow subtitle boxes.

---

## 14.4 Spatial Gap

The current lyric-to-Player breathing gap is approximately:

> **0.5–0.8 × lyric line-height**

Use atmospheric/blur transition to avoid hard text-to-surface contact.

---

# 15. Inner Lyrics

Inner Lyrics are the focused reading presentation.

Core conceptual transformation:

> **External strong art / weak readability → Internal weaker art / strong readability**

Inner Lyrics must still be beautiful; “weaker art” means reduced decorative interference, not a plain or ugly UI.

---

## 15.1 Recomposition

When switching Spatial → Inner:

- Listening Space outer geometry does not move;
- Player Surface outer boundary does not move;
- Orb slightly shrinks;
- Orb slightly repositions;
- Song/Artist move to a small metadata position above the lyric field;
- external lyrics retreat;
- internal lyric field emerges.

The intended perception is:

> **the room does not move; the content reorganizes inside it.**

---

## 15.2 Inner Layout

Conceptual structure:

```text
┌────────────────────────────────────────────────────┐
│                                                    │
│   smaller Orb            Song Name                 │
│                          Artist                    │
│                                                    │
│                          previous                 │
│                          CURRENT                  │
│                          next                     │
│                          next                     │
│                                                    │
│                          ◀ ❚❚ ▶                  │
│                                                    │
└────────────────────────────────────────────────────┘
```

The actual final layout is adaptive, but it must preserve:

- Orb identity;
- readable lyric area;
- restrained metadata;
- simple controls.

---

## 15.3 Inner Lyrics Positioning

- left aligned;
- vertical scrolling;
- approximately 5–7 lyric lines visible under normal conditions;
- current line slightly above the visual center;
- top visible past line may be partially obscured by edge blur.

Long lyric blocks may wrap, but each wrapped phrase remains one logical lyric block.

---

## 15.4 Inner Lyrics Visual Depth

Target gradient:

| Relative position | Target opacity | Target blur | Role |
|---|---:|---:|---|
| Current | ~1.0 | 0px | Primary focus |
| Immediately adjacent | ~0.55 | 0px | Readable context |
| Near | ~0.4 | ~0.5–1px | Secondary context |
| Far | ~0.25–0.3 | ~1.5–2px | Depth |
| Very far | ~0.15 | ~2–3px | Near environment |

These are target ranges, not immutable pixel-perfect values.

The blur should be progressive, not a hard class switch.

Past lines may be slightly colder/darker than future lines, but the effect must remain subtle.

---

## 15.5 Current Line Animation

When a new line becomes current:

### Old current

Target behavior:

- opacity 1.0 → ~0.25;
- blur ~0 → ~1.5px;
- translateY downward by approximately 4–6px;
- transition around 300ms.

### New current

Target behavior:

- opacity ~0.4 → 1.0;
- blur → 0;
- very slight scale rise from approximately 0.98 to 1.02;
- transition around 300–400ms.

The effect should feel like:

> **focus / defocus**

rather than a theatrical text animation.

---

## 15.6 Whole-Line Scroll

The lyric stack should move as a whole.

Scroll distance:

> approximately one logical line height per lyric transition.

Motion:

> smooth spring-like physics, not linear timing.

Baseline reference target:

- stiffness ≈ 170;
- damping ≈ 26.

These are starting parameters and may be adjusted during visual QA.

---

## 15.7 Word-Level Highlight

Current line may use word/character timing data.

Concept:

- already-sung words: theme-colored or otherwise highlighted;
- unsung words: semi-transparent neutral text;
- transition is smooth, not a hard switch.

Approximate highlight transition:

> 100–150ms for short word/character transitions.

---

## 15.8 Long-Note Wipe

For a long-held sung word/character:

- the highlight may progress from left to right;
- progression should correspond to the pronunciation duration.

This is semantic musical highlighting, not a generic shimmer.

Do not apply wipe effects to arbitrary lyrics simply to make them flashy.

---

## 15.9 Manual Scrolling

Supported:

- mouse wheel vertical scrolling only.

Not supported:

- pointer drag scrolling of the lyric field.

Clicking a visible lyric line:

> seeks playback to that lyric's start time.

After manual scrolling:

- automatic following pauses;
- a subtle “return to current” affordance appears;
- it must visually belong to the lyric field and must not look like a generic large button.

---

# 16. Spatial ↔ Inner Lyrics Transition

The transition must preserve the Listening Space outer geometry.

## Spatial → Inner

1. Outer lyrics begin to recede.
2. Player Surface remains spatially fixed.
3. Orb subtly shrinks/repositions.
4. Song/Artist recompose into small metadata above the internal lyric field.
5. Lyrics enter the Player Surface.
6. Inner lyric typography settles.

## Inner → Spatial

Reverse the same conceptual choreography.

Avoid:

- resizing the Listening Space;
- visibly moving the whole window;
- snapping content to new positions;
- abrupt component replacement.

---

# 17. Listening Space Controls

Listening Space uses a restrained control set.

Default minimum:

- Previous;
- Play/Pause;
- Next.

Volume/progress/source/more detailed utilities should not automatically turn the Listening Space into a larger Bottom Player.

The Listening Space is for listening and immersion first.

---

# 18. Atmosphere During Inner Mode

When entering Inner Lyrics:

- airflow decreases;
- halo decreases;
- visual environmental motion decreases;
- material remains alive but quieter;
- lyric readability receives greater contrast and spatial protection.

This is a focus-state change, not a complete environment shutdown.

---

# 19. Frosted Material System — Current Implementation

## 19.1 Material Personality

Primary baseline:

> **Balanced Frost**

Not extremely transparent.

Not extremely dense.

The user should perceive:

> color + light

through the surface, while specific background objects/details remain sufficiently diffused.

---

## 19.2 Material Hierarchy

Frosted should behave as a material hierarchy rather than one fixed blur value.

Conceptually:

```text
Primary Listening Surface   → Balanced Frost
Secondary surfaces          → Light/Balanced Frost
Focused temporary surfaces  → Balanced/Dense as needed
```

V1 may use manually defined material tiers.

Future versions may investigate background-complexity-aware adaptation.

---

## 19.3 Background Transmission

Primary transmitted information:

- color;
- light;
- broad atmosphere.

Background shape/detail should not remain fully legible through the primary Player Surface.

Principle:

> **Let the environment come through as atmosphere, not as competing information.**

---

## 19.4 Tint

Current-song Atmosphere may lightly tint the surface.

Hard rule:

> The tint must remain below the threshold where the user consciously perceives “this is a colored glass panel.”

The surface should feel environmentally affected, not painted.

---

## 19.5 Brightness

Baseline:

> neutral.

Allow subtle state-based modulation through environment/focus/interaction.

Do not create obvious pulsing brightness.

---

## 19.6 Edge

No persistent visible border.

Use:

> environment-driven edge response.

The edge should become slightly perceptible when environmental light passes through/around it.

Do not fake material with a permanent white outline.

---

## 19.7 Internal Reflection

Use extremely weak internal reflection/highlight.

Purpose:

> suggest material thickness.

Avoid showroom-glass appearance.

---

## 19.8 Shadow

V1:

- weak contact shadow;
- broad weak ambient shadow.

Future:

- optional directional environmental shadow.

---

## 19.9 Thickness

Subtle material thickness is allowed.

It should help the surface read as an object rather than a flat CSS rectangle.

Keep it restrained.

---

## 19.10 Interactive Surfaces

Default:

> no extra nested glass surfaces unless needed.

Only create local material surfaces when interaction demands them:

- queue;
- expanded volume control;
- quality selector;
- focus interaction;
- similar temporary surfaces.

Avoid “glass inside glass inside glass.”

---

## 19.11 Hover

Hover responses are object-specific.

Examples:

- Song: very subtle tint/luminance.
- Play button: light circular surface.
- Orb: light + tilt + atmosphere/material response.
- Queue: localized surface reveal.

Never apply the same generic glow animation to every element.

---

# 20. Global Light Coordination

Nebula may have several light-like systems:

- global atmosphere;
- surface response;
- Orb halo;
- interaction lighting.

These systems must be coordinated, not stacked blindly.

Hard rule:

> **The same visual region must not accumulate multiple strong glows simply because each component can glow independently.**

If an environmental light is already strong, the local component response should be reduced.

---

# 21. Liquid Material — Future Only

Liquid Glass is **not part of the current implementation scope**.

The structure must nevertheless remain compatible with it.

## Target personality

Default:

> subtle optical material.

Interaction/focus may temporarily become more noticeable.

Potential capabilities:

- refraction;
- specular response;
- directional edge light;
- optical depth;
- local distortion;
- transparency variation;
- interaction-driven optical changes.

## Liquid must not change

- component hierarchy;
- interaction semantics;
- Player geometry;
- Orb spatial anchor;
- Lyrics architecture;
- main information relationships.

## Liquid may change

- optical expression;
- edge behavior;
- light transport appearance;
- transparency behavior;
- refraction/distortion;
- material response curves.

The principle is:

> **One structure, two material expressions.**

---

# 22. Design States

The Player System should support at least these meaningful states:

```text
Bottom Player — visible
Bottom Player — auto-hidden
Bottom Player — hover/interactive

Listening Space — Spatial Lyrics / Playing
Listening Space — Spatial Lyrics / Paused
Listening Space — Inner Lyrics / Playing
Listening Space — Inner Lyrics / Paused

Song Transition
Spatial ↔ Inner transition
Bottom → Listening transition
```

Each state should be treated as a designed state, not merely a collection of CSS toggles.

---

# 23. Responsive Rules

## 23.1 Bottom Player

- width mildly follows viewport;
- retain min/max bounds;
- utility grouping may adapt according to available space;
- never allow the control row to become an equal-width button parade.

## 23.2 Listening Space

- system-selected responsive size;
- user cannot resize it directly;
- application window has a minimum size;
- horizontal rectangular composition is preserved.

## 23.3 Orb

- size responds to available width and height;
- remain within the defined visual proportion range;
- do not grow indefinitely on very wide screens.

## 23.4 Spatial Lyrics

When vertical space is reduced:

1. reduce visible line count;
2. reduce typography size;
3. reduce vertical breathing distance.

Do not destroy current-line prominence.

## 23.5 Inner Lyrics

When space is reduced:

1. increase relative lyric allocation;
2. shrink Orb moderately;
3. preserve readability.

---

# 24. Accessibility & Reduced Motion

Respect `prefers-reduced-motion`.

Reduced motion should:

- strongly reduce/disable idle Orb motion;
- reduce airflow;
- disable or minimize atmospheric events;
- reduce continuous material motion;
- avoid elaborate tilt.

Still retain essential state communication:

- play/pause transition;
- seek;
- essential morph/state change;
- readable crossfade.

Primary reduced-motion baseline:

> **structure remains; decorative continuous motion is reduced.**

---

# 25. Performance Rules

High-cost candidates include:

- large backdrop blurs;
- animated blur on many lyric lines;
- multiple atmospheric layers;
- continuous material effects;
- real-time audio analysis;
- simultaneous animation of many elements.

Do not trade usability for visual effects.

The system should have a degradation path.

Conceptual levels:

```text
High / full visual fidelity
Balanced
Low / performance-oriented
```

The user need not necessarily see technical performance labels.

---

# 26. Performance Degradation Strategy

Potential fallback order:

1. reduce large-scale blur;
2. reduce background atmospheric layers;
3. reduce lyric blur depth;
4. reduce continuous Orb motion;
5. reduce atmospheric events;
6. reduce high-cost material responses.

The highest-priority information should remain:

- current song identity;
- playback status;
- current lyric readability;
- core interactions.

---

# 27. Settings / DIY Model

Nebula must support both beginner-friendly and advanced customization.

## Basic Settings

Expose clear high-level choices such as:

- material theme;
- lyric presentation;
- background/atmosphere choice;
- major visibility toggles;
- broad visual density.

## Advanced Settings

Expose deeper customization such as:

- lyric typography;
- lyric motion;
- visibility of individual visual layers;
- atmosphere strength;
- detailed visual responses;
- optional motion details.

Do not expose every variable immediately.

---

## 27.1 Restore Default

DIY settings must include a prominent, easy-to-understand:

> **Restore Default**

action near the top of the customization area.

Its purpose is to return the user to the curated Nebula starting state.

This is important because freeform experimentation can produce awkward compositions.

---

# 28. Curated Default

Nebula's default configuration must itself be a deliberate, polished composition.

The default state acts as the onboarding visual anchor.

It should demonstrate the product's visual capabilities without requiring immediate user customization.

DIY is an extension of a strong starting point, not a substitute for one.

---

# 29. Queue Visual Scope

Queue is deliberately not part of Listening Space.

### V1

- open from Bottom Player;
- readable queue;
- current item clearly identifiable;
- scrolling;
- basic item management supported by current playback architecture.

### Future

Potential refinements:

- stronger spatial relationship to Bottom Player;
- richer queue micro-interactions;
- advanced reorder visuals.

Do not let Queue evolve into a second main stage.

---

# 30. Error / Loading States

Errors and loading states must remain inside Nebula's visual language.

Avoid visually unrelated:

- browser alerts;
- raw error text blocks;
- generic default dialogs.

Examples of states needing designed treatment:

- lyrics unavailable;
- artwork loading/failing;
- audio source resolving;
- source fallback;
- empty queue.

Error severity must remain understandable; artistic treatment must never obscure meaning.

---

# 31. DO NOT IMPLEMENT

The following patterns are explicitly disallowed unless a future design revision reopens them:

### 31.1 No generic “AI glass”

Do not equate premium glass with:

```text
blur + white translucent background + white border + glow
```

### 31.2 No persistent glowing borders

### 31.3 No large generic neon glows

### 31.4 No decorative particle-field pseudo-stars

Nebula's atmosphere should come from music, color, light, air, and airflow.

### 31.5 No Orb root wandering

The Orb may not randomly translate around the Player.

### 31.6 No excessive synchronous animation

Do not make every visual system react simultaneously to the same audio signal.

### 31.7 No giant play button

### 31.8 No equal-size utility-button parade

### 31.9 No conventional modal swap for Bottom → Listening

### 31.10 No abrupt hide/show for Spatial ↔ Inner lyrics

### 31.11 No marquee as the default response to long song titles

### 31.12 No drag-to-scroll lyrics

Wheel scrolling only; clicking a lyric seeks.

### 31.13 No “Liquid = transparent + glow”

### 31.14 No “Frosted = huge blur”

### 31.15 No continuous typography glow/pulse

### 31.16 No full-screen flash or explosive song-change transition

### 31.17 No fixed 15-second pseudo-random atmospheric timer as the sole source of “life”

### 31.18 No new visual subsystem solely for the purpose of making the UI “look cooler” without semantic value

---

# 32. V1 vs Future Enhancement Register

This section exists specifically so deferred ideas are not forgotten after V1.

## V1 — Must Implement

- Bottom Player core structure and controls.
- Floating geometry and responsive width.
- Song/Artist interactions.
- Playback core hierarchy.
- Basic Utility Cluster.
- Visible minimal progress.
- Hover time display.
- Volume hover slider above trigger.
- Queue surface.
- Quality selector baseline.
- Auto-hide behavior baseline.
- Bottom → Listening morph.
- Listening Space responsive geometry with minimum application window constraint.
- Main Stage visual retreat.
- Music Orb circular artwork.
- Stable Orb anchor.
- Subtle Orb idle motion.
- Orb progress orbit baseline.
- Pause → Stillness.
- Resume → Wake-up.
- Simple song crossfade/palette transition.
- Basic Atmosphere Field.
- Slow independent Airflow.
- Simple real-time audio energy input.
- Spatial Lyrics.
- Inner Lyrics.
- Spatial ↔ Inner transition.
- Word-level lyric highlighting where source timing supports it.
- Long-note wipe where source timing supports it.
- Wheel lyric scrolling.
- Click lyric → seek.
- Return-to-current affordance.
- Frosted Balanced baseline.
- Reduced-motion behavior.
- Basic performance fallback.
- Restore Default for DIY.

## V1-Lite — Implement the Semantic Idea, Not the Final Masterpiece

These are intentionally simplified first versions:

### Song Transition

V1-Lite:

- artwork crossfade;
- palette interpolation;
- atmosphere interpolation;
- progress transition.

Future:

- richer spectral/optical morph.

### Audio Reactivity

V1-Lite:

- simple smoothed real-time energy.

Future:

- onset/beat/BPM/section-aware analysis;
- hybrid pre-analysis + live analysis.

### Atmospheric Events

V1-Lite:

- extremely small set of randomized low-frequency events.

Future:

- richer stateful environmental behavior.

### Orb Material Interaction

V1-Lite:

- basic depth, light, halo, progress.

Future:

- more advanced optical/material behavior.

### Fluid Shape Transition

V1-Lite:

- ordinary square-to-circle radius interpolation.

Future:

- fluid shape deformation during morph.

### Spatial Progress Orbit

V1-Lite:

- subtle circular progress track/active point.

Future:

- more organic orbital deformation.

---

## Future — Do Not Block V1

### Liquid Glass

Comprehensive future material theme.

### Advanced audio analysis engine

Possible future capabilities:

- beat/onset detection;
- BPM;
- energy curve;
- section boundaries;
- chorus/high-energy estimation;
- pre-analysis cache.

### Advanced Spectral Song Transition

### Advanced Environmental Optics

### Directional/physical environmental shadow

### Background-complexity-aware blur/material adaptation

### Richer Queue presentation

---

# 33. Acceptance Criteria

The feature set is not considered visually successful merely because every component exists.

## 33.1 Bottom Player

Pass when:

- it is immediately usable;
- it does not compete with the main stage;
- controls have clear hierarchy;
- it does not look like a generic control console;
- quality and utility controls do not overpower playback;
- auto-hide feels like spatial recession, not deletion.

## 33.2 Listening Space

Pass when:

- it feels like entering another listening environment;
- the Player Surface reads as an object, not a generic modal;
- background remains recognizably Nebula but is clearly secondary;
- Music Orb remains the spatial anchor;
- lyrics and atmosphere coexist without fighting for attention;
- the room feels calm enough for extended listening.

## 33.3 Music Orb

Pass when:

- it feels alive but not restless;
- a screenshot appears almost static;
- longer observation reveals subtle motion;
- its center position remains stable;
- the progress orbit reads as part of the object rather than a generic progress ring.

## 33.4 Atmosphere

Pass when:

- the user feels environmental depth before noticing the mechanics;
- color and light feel music-derived;
- airflow feels organic;
- no particle wallpaper is required to make the environment feel alive;
- atmosphere never becomes the loudest visual element.

## 33.5 Spatial Lyrics

Pass when:

- the lyrics feel like part of the environment;
- current lines are readable;
- surrounding lines create depth;
- the two current-line positions remain visually aligned;
- text does not look like a standard subtitle box.

## 33.6 Inner Lyrics

Pass when:

- it is genuinely comfortable to read for a long time;
- current-line focus is clear;
- scrolling feels physically smooth;
- word-level timing feels musical rather than gimmicky;
- manual browsing is not interrupted by auto-follow;
- the UI remains unmistakably Nebula.

## 33.7 Material

Pass when:

- Frosted feels like material, not merely blur;
- no persistent border is needed to explain the surface;
- color tint remains restrained;
- Liquid remains a future-compatible extension rather than a forced V1 imitation.

---

# 34. Implementation Order

Do not ask an agent to implement the entire system in one uncontrolled pass.

Recommended implementation sequence:

```text
Phase 1 — Bottom Player structure
    ↓
Visual QA
    ↓
Phase 2 — Listening Space shell / morph target
    ↓
Visual QA
    ↓
Phase 3 — Music Orb
    ↓
Visual QA
    ↓
Phase 4 — Spatial Lyrics
    ↓
Visual QA
    ↓
Phase 5 — Inner Lyrics
    ↓
Visual QA
    ↓
Phase 6 — State transitions / morph choreography
    ↓
Visual QA
    ↓
Phase 7 — Atmosphere + energy + airflow
    ↓
Visual QA
    ↓
Phase 8 — Frosted polish / performance
    ↓
Final Design QA
```

Each phase should be validated against this specification before the next phase accumulates more visual complexity.

---

# 35. Design QA Philosophy

Implementation must be judged against the design system, not against whether the code “works.”

A technically functioning UI can still fail this specification.

Primary QA questions:

1. **What is the focal point?**
2. **Is the visual hierarchy still correct?**
3. **Does motion communicate state rather than decorate?**
4. **Is the material behaving like a material?**
5. **Did the agent add anything that was not requested?**
6. **Does the composition still work when several optional systems are enabled together?**
7. **Does the UI still look like Nebula if decorative effects are reduced?**

When a visual detail is uncertain:

> **Prefer the more restrained interpretation first.**

It is safer to add intensity during visual QA than to recover a composition that has been over-animated.

---

# 36. Final Design Philosophy

The goal of this redesign is not to prove how many effects Nebula can render.

The goal is to create a player system in which:

> **Music becomes an environment.**

> **The environment feels alive without performing for the user.**

> **The UI is visually distinctive without becoming noisy.**

> **The user can choose how much of the system to reveal.**

> **The same spatial language can support both Frosted and future Liquid materials.**

> **The object can move internally without losing its spatial identity.**

> **Stillness is treated as deliberately as motion.**

The desired final feeling is not:

> “Look at all these effects.”

It is:

> **“I want to stay here and listen.”**

---

# 37. Status Summary

| System | Status |
|---|---|
| Product direction | 🔒 Frozen |
| Bottom Player structure | 🔒 Frozen |
| Listening Space structure | 🔒 Frozen |
| Spatial Lyrics | 🔒 Frozen |
| Inner Lyrics | 🔒 Frozen |
| Music Orb | 🔒 Frozen |
| Atmosphere model | 🔒 Frozen |
| Motion grammar | 🔒 Frozen |
| Geometry principles | 🔒 Frozen |
| Typography hierarchy | 🔒 Frozen |
| Frosted material direction | 🔒 Frozen for V1 |
| Liquid material | 🟡 Future |
| Advanced audio analysis | 🟡 Future |
| Advanced spectral transition | 🟡 Future |
| Detailed queue visuals | 🟡 Deferred |
| Pixel-level final values | 🟡 Visual QA / implementation stage |

---

**End of `NEBULA_PLAYER_DESIGN_SPEC.md`**
