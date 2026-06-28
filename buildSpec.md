# Build Specification: "BUST" Web Application (Satirical Edition)

## 1. Executive Summary & Concept
"BUST" is a high-energy, real-time, satirical social application designed for a private group of friends to track their "gentleman's bust" occurrences. The core loop revolves around pressing a giant button, triggering an over-the-top, physics-heavy milk explosion animation, broadcasting the event to the group, and analyzing long-term trends via extensive data visualizations.

## 2. Authentication & Access Control
*   **Authentication Method:** Minimalist username and password login/signup. Passwords must be hashed prior to database insertion.
*   **Email Handling:** Synthetic emails are generated under the hood and auto-confirmed to eliminate friction; no actual email verification API is required.
*   **Gatekeeping:** Registration includes a mandatory, case-sensitive `invite-code` field. Account creation must only proceed if the user inputs exactly: `Bust4Me`.

## 3. UI/UX Layout & Navigation
*   **Single-Page Architecture:** The application consists of only two actual routes: `/login` and the main `/dashboard`.
*   **Main Dashboard Layout:**
    *   **Center:** The giant, pulsing "BUST" button.
    *   **Top-Left:** User profile chip (avatar, name).
    *   **Top-Right:** Notification bell (with unread badge) and a Trophy icon.
    *   **Bottom:** A persistent handle indicating the sliding analytics drawer.
*   **Typography & Styling:**
    *   **Font Stack:** Modern and professional. Use a **Tahoma (semibold)** stack as the primary typeface.
    *   **Sub-text Details:** Button subtext and smaller labels must be sized around `13–16px` with a `700` font weight for crisp readability.
*   **Full-Bleed Modals:** All major sub-views (Profile, Alerts, Analytics, Trophy) open as full-bleed overlays taking up `99vw/99vh`. 
    *   **Constraint:** Users *cannot* click the background to dismiss these panels. They must manually click a prominent 'X' in the top-right corner.

## 4. The Core "BUST" Interaction Sequence
The primary action is highly choreographed. Upon the user tapping the "BUST" button, the following exact sequence occurs:

1.  **The Buildup / Charge Phase (~1.4 seconds):**
    *   Button color shifts rapidly to a hot orange/red.
    *   The button begins to jitter/shake violently.
    *   The button text changes to: `"HOLD… building pressure"`.
    *   Shockwave rings pulse outward from the button.
    *   A background glow swells.
    *   Haptic feedback (warmup vibrations) ramps up in intensity via device APIs.
2.  **The Explosion Phase (~4.5 seconds):**
    *   A strong, multi-pulse haptic vibration triggers.
    *   The button physically shatters into digital shards (using a physics engine).
    *   A massive milk particle burst originates from the center.
    *   A full-screen animation plays of milk splashing and pouring down the screen, complete with dripping tendrils.
    *   The entire screen shakes.
3.  **The Note Capture Phase:**
    *   Immediately after the explosion animation, a subtle modal pops up.
    *   The user is prompted to optionally add a humorous "Bust Note" to document the occasion before it commits.
4.  **The Cooldown & Lockout Phase (2 Hours):**
    *   The "BUST" button disappears.
    *   In its place, a static 3D/Isometric visual is rendered: a milk-soaked scene showing the "BUST" button toppled on the floor in a glossy puddle, with splatters across the walls.
    *   **Logic:** The 2-hour cooldown is silent (no countdown timer is shown). The visual remains until the puddle "dries" (2 hours expire).
    *   **Enforcement:** Evaluated strictly based on the user's `last_bust_timestamp` stored in the database, ensuring the cooldown survives browser reloads.

## 5. Real-Time Networking & Notifications
*   **WebSocket Integration:** Utilize Supabase Realtime to listen for new database inserts on the `busts` table.
*   **Global Broadcast:** When any user busts, the event is instantly broadcasted to all logged-in users.
*   **Notification Deliverables:**
    1.  The top-right bell icon increments its unread badge.
    2.  An external Browser/System-level alert is fired.
    3.  A persistent in-app Toast Notification appears on screen.
*   **Toast Notification Data:** Tapping a bust record anywhere in the app (Alerts feed, leaderboard, or incoming real-time toast) opens a detailed card containing:
    *   Username and Avatar.
    *   Exact time and "Time-of-day bucket" (e.g., Late Night, Early Morning).
    *   Custom "Bust Note".
    *   Temperature and Barometric Pressure at the time of the event.
    *   Location (City/Neighborhood).
    *   The user's current rank for the day.
    *   *Note: Toast notifications stay on screen until manually closed via an 'X'.*

## 6. Environmental & Contextual Data Logging
*   **Location:** Browser Geolocation API fetches coordinates at the time of the bust. Cache this in `localStorage` to prevent excessive prompting.
*   **Weather:** Pass coordinates to the Open-Meteo API (keyless integration) to fetch:
    *   Current Temperature (Strictly in Fahrenheit).
    *   Barometric Pressure.
*   Store these contextual data points alongside the timestamp and user ID in the database.

## 7. Deep Analytics & Statistics Engine
The Analytics drawer (pulled from the bottom) contains massive amounts of comparative data, featuring:
*   **Hero Stat Strip:** Prominent display of Total Group Busts, Active Player Count, Today's Total, and the Current User's Rank.
*   **Visualizations & Charts (Clean axes, tabular numerals, headers with subtitles):**
    *   **Leaderboard:** Ranked list utilizing avatar tiles and satirical medals/titles (e.g., "The Cream of the Crop", "The Daily Dripper").
    *   **Weekly Bar Charts:** Volume comparisons day-over-day.
    *   **Heatmaps:** 24-hour hour-of-day vs. day-of-week grid to find the most active "bust times".
    *   **Scatter Plots:** Analyzing bust frequency against environmental factors (Temperature vs. Pressure).
*   **Feeds & Records:**
    *   **Today's Feed:** A 2-column grid showing all busts from the current 24-hour period with user avatars.
    *   **All-Time Records:** Stat cards with icons highlighting extremes (e.g., highest average per week, coldest bust, earliest bust).

## 8. Achievement & Trophy System
*   **Client-Side Evaluation:** Whenever a user logs a bust, the client evaluates their history against 11 distinct achievement conditions.
*   **Auto-Unlocking:** If a condition is met, the achievement is unlocked, animated for the user, and persisted to the PostgreSQL database.
*   **Trophy Cabinet:** Accessed via the top-right Trophy icon. It serves as a full-bleed grid displaying locked (silhouetted) and unlocked satirical badges/medals.

## 9. Infrastructure & Database Schema Constraints
*   **Database:** PostgreSQL (hosted via Lovable Cloud / Supabase) to ensure all data safely persists across server restarts.
*   **Required Tables (Minimum):**
    *   `Users`: ID, Username, PasswordHash, CreatedAt.
    *   `Busts`: ID, UserID, Timestamp, Note, TempF, Pressure, Lat, Long, TimeBucket.
    *   `Achievements`: ID, UserID, AchievementType, UnlockedAt.
*   **Animation Libraries:** Utilize robust physics-based animation libraries (e.g., Framer Motion, GSAP, or Three.js/React Three Fiber for the 3D isometric cooldown scene) to handle the complex timing and particle effects.