# Design Prompt — DMTC Mart (School Co-op POS)

> Copy everything below the line into Claude Design.

---

Design a complete mobile-first web app UI for **DMTC Mart**, a Thai school cooperative store POS system. All UI text is in Thai. Design every screen listed below as one cohesive system — like a polished consumer mobile app (think Grab, LINE Man, Shopee), not a desktop admin panel shrunk down.

## Design language (mandatory — derive everything from this)

**Colors**
- Primary: `#F12B6B` (hot pink)
- Primary light: `#FF467E` — always paired with primary as a gradient `linear-gradient(to bottom right, #F12B6B, #FF467E)`
- Accent mid: `#FD94B4`
- Border: `#F6C7C7`
- App background: `#FFF5F7` (soft pink tint — never pure white or grey)
- Surfaces: white cards on the pink background
- Text: `#111827` primary, `#9CA3AF` secondary/labels
- Semantic: emerald for success/money-in, amber for warnings/low-stock, red for destructive/cancel, blue for info/pre-order

**Shape**
- Cards, sheets, modals, stat panels: `24px` radius (very round)
- Buttons, inputs, selects, chips: `16px` radius
- Icon containers: `12px` radius squares, never circles (except avatars and the floating action button)
- Avatars: `16px` rounded squares, not circles

**Type**
- One sans-serif family, Thai-capable
- Screen titles: 24px extrabold
- Card titles: 14px bold
- Labels/captions: 11–12px medium, in grey, uppercase with wide letter-spacing for section headers
- Numbers/money: extrabold, larger than surrounding text — money is the hero on every screen that shows it

**Elevation & motion**
- Soft, wide, low-opacity pink-tinted shadows (`0 8px 24px rgba(241,43,107,0.18)`) — never hard grey shadows
- Every tappable element scales to `0.98` on press
- Transitions 150ms

## Structural patterns (repeat these everywhere)

1. **Gradient header block** — every screen opens with a pink gradient band containing an icon-in-frosted-square, the screen title, and 1–2 actions on the right. The band has generous bottom padding so content can overlap it.
2. **Overlapping first card** — the first content card floats upward to straddle the bottom edge of the gradient header (negative top margin). This is the signature move of the whole app; use it on every screen that has a summary or stat row.
3. **Row-card list** — the dominant list pattern is a full-width white card containing: icon square (left) → title + subtitle stacked (middle, flexible) → optional pill badge inline with the title → chevron (right). Never plain text rows, never dense tables on mobile.
4. **Section label** — small grey uppercase caption above each group of cards.
5. **Floating pill nav** — the bottom navigation is a detached white pill floating 12px above the screen edge with a fully-rounded shape, holding 4 icon+label items, with a raised circular gradient FAB breaking out of its top center for the "more" menu.
6. **Bottom sheet** — secondary menus and detail views slide up from the bottom with a rounded top and a gradient header strip.

## Screens to design

**Auth**
- Login (student ID + password, links to forgot password)
- Forgot password / Reset password

**Hub**
- Home — greeting + avatar + role badge in the gradient header, a 3-up stat card straddling the header edge (today's sales / order count / low-stock count), a work-hours + estimated-pay card, then the role-filtered module list. **This screen already exists and is the reference for everything else — match its rhythm exactly.**

**Selling**
- POS — product grid with category filter chips and search, plus a cart panel (side panel on tablet, bottom sheet on mobile) with member lookup, promo code, points redemption, payment method toggle, cash quick-amount buttons, QR display, and checkout
- Pre-order (customer-facing) — product browsing, promo highlights row, cart, slip photo upload, order history
- Receipt — printable receipt view after checkout

**Staff operations**
- Shift — open/close a till shift with cash denomination counting and a location photo
- Order management — tabbed queue (pending / verify slip / rejected / completed) with an order detail sheet full of status-action buttons
- Notifications — feed list, read/unread state

**Management**
- Dashboard — today's sales KPIs, alert card grid, hourly sales chart, per-cashier and per-vendor breakdowns, all in collapsible sections
- Inventory — stock list, low-stock and expiry warnings, receive-stock flow
- Summary — monthly report with export
- Attendance management — clock-in/out records table with photo thumbnails
- Schedules — monthly shift calendar with staff color-coding and holidays
- Settings — a multi-tab control panel (store info, sales history, products, categories, suppliers, staff/roles, promotions, password-reset queue) with add/edit modals
- Vendor sales — consignment earnings view for student sellers
- Backup & restore

## Hard requirements

- **Mobile-first.** Design the 375px view first for every screen, then show how it adapts at tablet/desktop. No screen may rely on a data table to be usable on a phone — give every table a card-list fallback.
- **Every screen needs an empty state** and a loading skeleton, drawn in the same rounded-card language.
- **Every interactive element needs all states** drawn: default, hover, pressed, focused, disabled, loading.
- **Show role variance.** Three roles see different things: MEMBER (shopping only), CASHIER (selling + own shift), ADMIN (everything). Indicate which elements are role-gated.
- **Thai text lengths.** Thai labels run longer than English — design with real Thai strings, not Lorem Ipsum, and make sure nothing truncates awkwardly.
- **Touch targets minimum 44px.** This runs on cheap phones held by students in a hurry.
- **No pure-white backgrounds anywhere** — the soft pink `#FFF5F7` is what makes it feel like this brand and not a generic template.

## What "good" looks like here

The current build is functional but reads as a web admin panel that happens to be responsive. The goal is that a student opening this on their phone can't tell it isn't a native app: generous spacing, big confident numbers, soft depth, one accent color used decisively, and every screen structured with the same header → floating card → row-list rhythm so the whole thing feels like one product rather than seventeen separate pages.
