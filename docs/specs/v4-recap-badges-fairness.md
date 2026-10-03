# Spec: Soccer Sub Manager v4 (Sportsmanship Badges & Visual Fairness Recap)

| | |
|---|---|
| **Status** | Approved 2026-10-03 |
| **Source** | Parent Coach Brainstorming (User Persona: Volunteer Parent Coach) |
| **Output** | `soccer_sub_manager_v4.html` (v3 engine extended, zero breaking changes to v3 core) |
| **Out of scope** | Live video streaming, public cloud sync, multi-team season league standings |

## 1. Goal

Provide parent coaches of little league soccer (ages 5–8) with tools to encourage positive sportsmanship during active play, and deliver a parent-ready, screenshot-friendly Match Recap showing equal playing time and positive player accolades.

Specifically:
- **In-Game Badging:** The coach can award positive sportsmanship badges to any player with a single tap during live play.
- **Visual Fairness Gauge:** The Match Recap screen renders a clear horizontal bar gauge comparing each player's play time against the target equal time share.
- **Screenshot-Optimized Recap:** The recap screen layout is designed specifically for phone screenshots to share in team messaging apps (WhatsApp, SMS, TeamSnap).

## 2. Constraints

1. **Self-contained HTML file.** No CDN, external fonts, external CSS, or network requests. Operates 100% offline in mobile web browsers (iOS Safari, Chrome Android).
2. **Backward Compatibility.** `SSM_V4` state engine automatically normalizes and upgrades `SSM_V3` and `SSM_V2` saves without data loss.
3. **Low Cognitive Load & High Ergonomics.** Taps must be large (≥ 48px), high contrast in direct sunlight, and registered instantly with haptic feedback where supported (`navigator.vibrate`).
4. **Zero Performance Impact on Game Clock.** Badge tracking must not affect clock calculations or main tick rendering performance.

## 3. Key Design Decisions

### D1. Immutable Badge Log per Player

Badges are stored as an array of event objects per player: `badges: [{ id, type, timestampMs }]`.
- Preserves exact chronological order of when badges were awarded.
- Allows 1-step Undo (`undo` snapshot model) and optional deletion of mis-tapped badges.
- Summary counts (e.g. `⚡ Great Hustle x2`) are derived on demand during render.

### D2. Visual Fairness Gauge Math

The equal play time target is calculated dynamically:
$$\text{TargetShareMs} = \frac{\text{TotalFieldSlots} \times \text{ElapsedMatchMs}}{\text{ActiveRosterCount}}$$

- **Target Share:** The exact mathematical equal share of total field time for active players (excluding resting/absent players).
- **Fair Range Window:** $\pm 90 \text{ seconds}$ ($\pm 1.5 \text{ mins}$) relative to `TargetShareMs`.
- **Gauge Bar Width:** Normalized relative to the maximum possible period time or maximum player total time, with a vertical dashed benchmark indicator line for `TargetShareMs`.

### D3. High-Contrast Parent Screenshot Layout

The Match Recap UI is styled with explicit screenshot boundaries:
- **Team Summary Header:** Total match duration, team name/date, and total sportsmanship badges awarded.
- **Fairness Gauge & Accolades Card List:** Clean, high-contrast rows containing player name, play time badge, horizontal progress bar, and earned badge pills.
- **Copyable Text Summary:** A 1-tap "Copy Recap Text" button generates formatted plain text with emoji highlights for easy pasting into parent chat groups.

---

## 4. Preset Badges Taxonomy

5 non-competitive, positive reinforcement badges tailored for U6/U8 players:

| Badge Type | Icon | Title | Context / Meaning |
|---|---|---|---|
| `hustle` | ⚡ | Great Hustle | High effort, relentless running, tracking back |
| `save` | 🛡️ | Big Save | Defensive block, goal line stop, or goalkeeper save |
| `pass` | 🤝 | Great Pass | Teamwork, unselfish play, sharing the ball |
| `kick` | 🚀 | Super Kick | Strong strike, clearance, or goal attempt |
| `teammate` | 🌟 | Star Teammate | Cheering from bench, helping up a teammate, sportsmanship |

---

## 5. State Schema (`localStorage` key `SSM_V4`)

```js
{
  v: 4,
  settings: { fieldSize: 5, periodMinutes: 8, periodCount: 4 },
  roster: [{ id: "p1", name: "Mason" }, { id: "p2", name: "Mia" }],
  starterIds: ["p1"],
  match: {
    period: 1,
    clock: { running: false, startedAt: null, elapsedMs: 0 },
    players: {
      "p1": {
        onField: true,
        stintStartMs: 0,
        periodMs: [480000, 0, 0, 0],
        resting: false,
        badges: [
          { id: "b1", type: "hustle", timestampMs: 120000 }
        ]
      }
    },
    pinnedId: null,
    skipIds: [],
    undo: null
  }
}
```

### Migration & Normalization Rules
When loading legacy `SSM_V3` or `SSM_V2` state:
- If `state.v < 4`, upgrade `v` to `4`.
- For every player entry in `match.players`, initialize `badges: []` if missing or invalid.

---

## 6. Engine API Extensions

All functions strictly follow pure functional state updates: `(state, ...args, now) → newState`.

| Function Signature | Description |
|---|---|
| `awardBadge(state, playerId, badgeType, now)` | Appends `{ id: randomId(), type: badgeType, timestampMs: clockMs }` to player's badge list. Pushes a 1-step undo snapshot with label `"Awarded {BadgeTitle} to {PlayerName}"`. |
| `removeBadge(state, playerId, badgeId, now)` | Removes specified badge by ID. Pushes an undo snapshot. |
| `recapMetrics(state, now)` | Returns computed metrics object: `{ targetMs, totalBadges, maxPlayerMs, players: [...] }`. |

### `recapMetrics` Computed Structure
```js
{
  targetMs: 960000, // 16:00 mins equal share
  totalBadges: 8,
  players: [
    {
      id: "p1",
      name: "Mia",
      totalMs: 990000,
      targetDeltaMs: +30000,
      fairnessStatus: "equal", // "equal" | "under" | "over"
      badgeCounts: { hustle: 2, pass: 1, save: 0, kick: 0, teammate: 1 }
    }
  ]
}
```

---

## 7. UI & UX Specifications

### 7.1 In-Game Badge Awarding
- **Player Card Button:** Each player card on Field and Bench displays a discrete `+ 🌟` badge action button.
- **Quick Action Drawer / Modal:** Tapping `+ 🌟` opens an inline 1-tap popup strip showing the 5 badge icons.
- **Visual Feedback:** 
  - Instant micro-animation (badge icon pops into player card).
  - Short haptic feedback (`vibrate(40)`).
  - Temporary toast banner: *"Awarded Great Hustle to Mason ⚡ (Undo)"*.
- **Card Badge Indicators:** Player cards display small icon badges representing earned accolades during the match (e.g., `⚡2` `🤝1`).

### 7.2 Match Recap Screen & Visual Fairness Gauge
- **Header Section:**
  - Team Match Summary (e.g. *"Tigers U8 Match Recap • 4 Periods • 32:00 Total Time"*).
  - Team Accolade Count: *"12 Sportsmanship Badges Awarded! 🎉"*.
- **Visual Fairness Gauge Chart:**
  - Ranked by roster order or play time.
  - Horizontal bar graph showing player's total play time.
  - Distinct vertical benchmark line for `TargetShareMs` (Equal Share).
  - High-contrast color coding:
    - 🟩 **Green Bar:** Equal play time (within $\pm 90\text{s}$ of target).
    - 🟦 **Blue Bar:** Extended play time ($> 90\text{s}$ over target).
    - 🟧 **Amber Bar:** Lower play time ($> 90\text{s}$ under target).
- **Player Accolades Strip:**
  - Next to/under each player's bar, earned badges are displayed as stylized pill tags: `⚡ Great Hustle x2`, `🛡️ Big Save x1`.
- **Parent WhatsApp/SMS Copy Generator Button:**
  - **Button:** *"📋 Copy Parent Summary Text"*
  - **Output String format:**
    ```text
    Great soccer match today Tigers! 🐅
    Everyone got equal play time (~16 mins each).
    
    🌟 Sportsmanship Badges Earned Today:
    • Mason: ⚡ Great Hustle x2, 🤝 Great Pass
    • Mia: 🛡️ Big Save, 🚀 Super Kick
    • Leo: 🌟 Star Teammate x2
    
    Thanks coaches & parents for a great game! ⚽
    ```

---

## 8. Reliability & State Protection

1. **Storage Robustness:** `SSM_V4` state persists automatically after every badge award/removal.
2. **Undo Support:** Awarding or removing a badge creates a full snapshot state. Tapping "Undo" restores the match state prior to the badge change without affecting clock integrity.
3. **Print / Screenshot Optimization:** CSS `@media print` and high-contrast screenshot styles ensure text and bar graphics render cleanly without navigation bars or edit buttons cropping.

---

## 9. Acceptance Criteria & Test Plan

### Engine Unit Tests (`node:test`)
1. **Badge Award:** `awardBadge` adds correct badge entry with valid timestamp and creates undo snapshot.
2. **Badge Removal:** `removeBadge` correctly removes target badge by ID.
3. **Undo Integration:** Undoing a badge award restores pre-award player badges state.
4. **`recapMetrics` Calculation:**
   - Target share correctly calculated for $N$ players and field size $M$.
   - Fairness status (`equal`, `under`, `over`) correctly categorized based on $\pm 90\text{s}$ tolerance.
   - Badge counts aggregated correctly per player.
5. **Normalize & Upgrade:** `normalize()` upgrades `v3` data to `v4` with empty badge arrays without modifying roster/clock/stint data.

### Manual Verification (`browser-testing-with-devtools`)
- Tap `+ 🌟` on a field player card; verify quick drawer appears and badge awards in 1 tap.
- Verify haptic vibration triggers on badge award.
- Navigate to Match Recap screen; confirm visual fairness gauge bar and target line render clearly.
- Click "Copy Parent Summary Text"; verify clipboard receives properly formatted string with emojis.
- Take screenshot of Match Recap; verify text contrast and layout readability.

---

## 10. Implementation Slices

1. **Slice 1: Engine Badging & Recap Math (`v4` schema, `awardBadge`, `removeBadge`, `recapMetrics`, tests).**
2. **Slice 2: In-Game Badging UI (Quick action drawer, card badge counts, undo integration).**
3. **Slice 3: Screenshot-Ready Match Recap UI (Visual fairness gauge bar graph, player badge pills, parent SMS text copy tool).**
