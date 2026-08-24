# Expense Tracker — Feature Tickets

> **Project:** Expense Tracker
> **Phase:** 04 — Features
> **Date:** August 15, 2026
> **Build order:** Tier by tier. Complete all tickets in a tier before starting the next.
> **Prerequisites:** Foundation Tasks 00–05 completed (repo boots, auth works, DB has seed data, RabbitMQ wired, tests green).

---

## Domain vocabulary

| Term | Definition |
|------|-----------|
| Transaction | A single financial event — either an Expense or Income. Has: type, amount, currency, category, description, date, source, tags, metadata. |
| Category | One of 8 fixed values: Food & Dining, Transport, Housing, Entertainment, Subscriptions, Healthcare, Shopping, Other. "Other" requires a free-text label. |
| Source | How the transaction was created: Manual, ReceiptScan, EmailImport. |
| Event | An immutable log entry recording an action on a transaction (created, updated, deleted, categorized). Stored in the `events` table. |
| Receipt | An uploaded image (PNG/JPG/PDF, max 10MB) processed by the Receipt Service via Tesseract + LLM. Image is discarded after extraction; only structured data is kept. |
| Intake address | A unique per-user email address (e.g. `jd-a1b2@intake.yourapp.com`) used for email forwarding. |

## Screen reference index

| ID | Screen | Theme |
|----|--------|-------|
| 1a | Dashboard | Light |
| 1b | Dashboard | Dark |
| 1c | Add Expense | Light |
| 1d | Settings | Light |
| 2a | Login / Register | Dark |
| 2b | Expense List / History | Dark |
| 2c | Edit Expense (pre-filled) | Dark |
| 2d | Add Transaction (Expense/Income toggle) | Dark |
| 2e | Receipt Scan Result | Dark |

---

## Tier 1 — No dependencies (start immediately after foundation)

---

### F01: Transaction CRUD API

**Screen reference:** None (backend only — consumed by F06, F07, F08, F11)

**Route:** N/A (API endpoints)

**Implementation logic:**

Core API (.NET Core) endpoints:

```
POST   /api/transactions
  Body: { type, amount, currency?, category, description, date, source?, tags?, metadata? }
  - Validates required fields (type, amount, category, description, date)
  - If category is "Other", requires metadata.custom_category string
  - Defaults: currency = "USD", source = "Manual", tags = []
  - Creates Transaction row + "TransactionCreated" event
  - Returns 201 with created transaction

GET    /api/transactions
  Query: ?page=1&pageSize=10&category=food&search=pizza&startDate=2026-08-01&endDate=2026-08-31&type=expense&sortBy=date&sortOrder=desc
  - Filters by authenticated user (user_id from JWT sub)
  - pageSize accepts 10, 25, or 50 (default 10)
  - search: partial match on description (ILIKE)
  - All filters optional, combinable
  - Returns { data: [...], total, page, pageSize, totalPages }

GET    /api/transactions/{id}
  - Returns single transaction with its events (activity log)
  - 404 if not found or belongs to different user

PUT    /api/transactions/{id}
  Body: { type?, amount?, category?, description?, date?, tags? }
  - Partial update — only provided fields change
  - Creates "TransactionUpdated" event with before/after diff in payload
  - Returns 200 with updated transaction

DELETE /api/transactions/{id}
  - Hard deletes the transaction and all its events
  - Returns 204 No Content

GET    /api/dashboard/summary?month=2026-08
  - Returns { income, expenses, savings, savingsRate, transactionCount }
  - Computed on-the-fly: SUM(amount) grouped by type, filtered by month

GET    /api/dashboard/category-breakdown?month=2026-08
  - Returns [{ category, total, percentage }] for expenses only

GET    /api/dashboard/monthly-trend?months=6
  - Returns [{ month, income, expenses, savings }] for last N months

GET    /api/dashboard/weekly-expenses?month=2026-08
  - Returns [{ week, total }] for 4-5 weeks in the given month
```

**Acceptance criteria:**
1. All endpoints require valid Auth0 JWT — return 401 without token.
2. Users can only access their own transactions — return 404 for other users' data.
3. POST with missing required fields returns 400 with field-level error messages.
4. Category "Other" without `metadata.custom_category` returns 400.
5. Pagination returns correct `total` and `totalPages` values.
6. Search is case-insensitive partial match on description.
7. DELETE removes both transaction and all related events.
8. Dashboard summary returns correct sums verified against manual calculation.

**Tests to add:**
- Integration test (Testcontainers): POST a transaction, GET it back, verify all fields.
- Integration test (Testcontainers): Create 5 transactions, GET with category filter, verify only matching returned.

---

### F02: Dashboard summary cards (styled)

**Screen reference:** 1a (light), 1b (dark) — top 4 cards

**Route:** `/dashboard` (already exists from foundation Task 01, currently shows raw data)

**Implementation logic:**

Replace the raw data display from foundation Task 03 with styled summary cards matching the mockups.

Components to build:
- `SummaryCard` — reusable card component with: label (uppercase, muted), value (28px, bold), trend indicator (arrow + percentage + color)
- 4 instances in a CSS Grid (4 columns on desktop, 2 on tablet, 1 on mobile):
  1. Total Income — green trend arrow, value from `GET /api/dashboard/summary`
  2. Total Expenses — red trend arrow
  3. Net Savings — green value color, shows savings rate as subtitle
  4. Transactions — plain count, "This month" subtitle

Data source: `GET /api/dashboard/summary?month=<currentMonth>` via TanStack Query with key `['dashboard', 'summary', month]`.

Trend calculation: Compare current month to previous month. Show "↑ 12% from last month" or "↓ 5% from last month" with appropriate color (green for income up/expenses down, red for opposite).

The month selector ("This Month" button in the mockup header) should update the query parameter. Default to current month.

**Acceptance criteria:**
1. Four cards render in a row on desktop, matching the layout in screens 1a/1b.
2. Values are formatted as currency ($8,450 not $8450.00).
3. Trend percentages are calculated correctly relative to previous month.
4. Cards show a loading skeleton (shimmer) while data is fetching.
5. "This Month" selector updates all cards when month changes.
6. Theme respects current light/dark setting (colors from 1a vs 1b).

**Test to add:** None beyond existing E2E (Test 6 already verifies summary cards show data).

---

### F03: Dark / light theme toggle

**Screen reference:** 1d (Settings → Preferences → Theme: Light / Dark / Auto)

**Route:** N/A (system-wide, stored in user preferences)

**Implementation logic:**

- Create `ThemeContext` with three modes: `light`, `dark`, `auto` (follows system `prefers-color-scheme`).
- Store preference in `localStorage` for instant load, and sync to backend via `PUT /api/preferences` (new endpoint) for persistence across devices.
- Core API: new `user_preferences` table with `user_id`, `theme`, `currency`, `monthly_budget`, `notifications_enabled`. New endpoints:
  - `GET /api/preferences` — returns user preferences (creates defaults on first call)
  - `PUT /api/preferences` — partial update
- Tailwind: use `class` strategy for dark mode (`darkMode: 'class'` in tailwind.config). Toggle `dark` class on `<html>` element.
- shadcn/ui components auto-adapt to dark mode via CSS variables — no per-component changes needed.
- NavBar and all existing components should respond to theme change without page reload.

**Acceptance criteria:**
1. Default theme is `auto` (follows system setting).
2. Toggling to `dark` immediately applies dark theme to all components.
3. Theme persists across page refreshes (localStorage).
4. Theme persists across devices (backend sync).
5. Components from screens 1a (light) and 1b (dark) are visually accurate in both modes.

**Test to add:** None (visual, not behavioral; too volatile for automated testing at this stage).

---

### F04: Floating Action Button (FAB)

**Screen reference:** 2b, 2c, 2d, 2e — bottom-right on all pages except Dashboard and Settings

**Route:** N/A (global component)

**Implementation logic:**

- `FAB` component: fixed position bottom-right (28px from edges), indigo background (#4f46e5), "+" icon + "Add Transaction" text, rounded (14px radius), box shadow.
- Clicking navigates to `/transactions/new`.
- Visible on: `/expenses`, `/transactions/:id/edit`, `/transactions/new` (but disabled on the add page itself).
- Hidden on: `/dashboard`, `/settings`.
- Use React Router's `useLocation()` to conditionally render.

**Acceptance criteria:**
1. FAB appears on the expense list and edit pages, matching screen 2b position and style.
2. FAB is hidden on dashboard and settings pages.
3. Clicking FAB navigates to the add transaction page.
4. FAB has hover and active states (shadow deepens on hover).

**Test to add:** None (UI-only, covered by E2E navigation tests).

---

### F05: Toast notification system

**Screen reference:** None in mockups (implied by save/delete/error actions)

**Route:** N/A (global system)

**Implementation logic:**

- Use shadcn/ui `Toast` component (built on Radix Toast primitive).
- Create `useToast()` hook that any component can call: `toast({ title, description, variant })`.
- Variants: `success` (green), `error` (red), `info` (blue).
- Position: top-right, auto-dismiss after 4 seconds, dismissable on click.
- Toast provider wraps the app at the root level.
- All future CRUD operations will use this: "Expense saved" (success), "Failed to delete" (error), "Receipt scan complete" (info).

**Acceptance criteria:**
1. `toast({ title: "Expense saved", variant: "success" })` renders a green toast in top-right.
2. Toast auto-dismisses after 4 seconds.
3. Multiple toasts stack vertically.
4. Toast is accessible (announces to screen readers via `role="status"`).

**Test to add:** None (infrastructure component, tested implicitly through feature tests).

---

## Tier 2 — Depends on CRUD API (F01)

---

### F06: Add transaction page

**Screen reference:** 1c (light), 2d (dark)

**Route:** `/transactions/new`

**Implementation logic:**

Components:
- Page layout: two-column (form left, receipt upload right) matching screen 2d.
- `TransactionForm` component (reused by F11 Edit):
  - Type toggle: Expense / Income (pill toggle, default Expense)
  - Amount input: currency prefix ($), numeric input, required
  - Category: 8 chip buttons (single select), "Other" shows a text input when selected
  - Description: text input, required, placeholder "e.g. Lunch at Chipotle"
  - Date: date picker, defaults to today
  - Tags: tag input with add/remove, optional
  - Save button: "Save Expense" or "Save Income" based on type toggle
  - Cancel button: navigates back to `/expenses`
- Right column: Receipt upload zone (placeholder for F12 — show the dashed upload area but with a "Coming soon" overlay until F12 is built)

Data flow:
1. User fills form → clicks Save
2. Frontend validates (amount > 0, category selected, description non-empty)
3. `POST /api/transactions` via TanStack `useMutation`
4. On success: toast "Expense saved successfully", invalidate `['transactions']` and `['dashboard']` queries, navigate to `/expenses`
5. On error: toast with error message, stay on page

Form validation rules:
- Amount: required, must be > 0, max 2 decimal places
- Category: required
- Description: required, max 200 characters
- Date: required, cannot be in the future

**Acceptance criteria:**
1. Form renders matching screen 2d layout (two columns, all fields present).
2. Type toggle switches between "Expense" and "Income" — button labels update.
3. Selecting "Other" category reveals a free-text input for custom category name.
4. Form validation prevents submission with empty required fields — inline error messages shown.
5. Successful save navigates to `/expenses` with the new transaction visible and briefly highlighted (yellow flash or similar).
6. Cancel navigates to `/expenses` without saving.
7. Date defaults to today.
8. Receipt upload zone shows "Coming soon" state (enabled in F12).

**Test to add:**
- Playwright E2E: (already exists as Test 7 — AddExpenseAppearsInList). Extend to verify: fill all fields, save, verify redirect to /expenses, verify new row exists.

---

### F07: Transaction list page

**Screen reference:** 2b

**Route:** `/expenses`

**Implementation logic:**

Replace the raw table from foundation Task 03 with the full styled list matching screen 2b.

Components:
- Page header: "Expenses" title, transaction count subtitle, search bar, filter button, export button
- `SearchBar`: debounced text input (300ms), triggers refetch with `search` param
- `CategoryFilterChips`: horizontal chip row (All, Food & Dining, Transport, ...), single select, "All" selected by default
- `TransactionTable`: data table with columns: Description (icon + name + source badge), Category (colored pill), Date, Amount (red for expense, green for income), Actions (edit + delete icon buttons)
- `Pagination`: page numbers with prev/next arrows, page size selector (10/25/50), "Showing X–Y of Z transactions" text
- Source badges: "Receipt scanned", "Manual entry", "Email imported", "Recurring" — shown as subtitle under description

Data source: `GET /api/transactions` via TanStack Query with key `['transactions', { page, pageSize, category, search, sortBy, sortOrder }]`.

Sorting: Clickable column headers for Date and Amount. Default: date descending (newest first).

Row highlighting: When navigating from the Add page (F06), the newly created transaction's row has a brief highlight animation (CSS `@keyframes` with `background-color` transition lasting 2 seconds).

**Acceptance criteria:**
1. Table renders all columns matching screen 2b layout.
2. Search filters transactions by description as user types (debounced 300ms).
3. Category chips filter the list — selecting "Food & Dining" shows only food transactions.
4. "All" chip clears the category filter.
5. Pagination shows correct page numbers, disables prev on page 1, disables next on last page.
6. Page size selector (10/25/50) works and persists during the session.
7. "Showing 1–10 of 47 transactions" text updates correctly.
8. Clicking edit icon navigates to `/transactions/:id/edit`.
9. Clicking delete icon opens delete confirmation (F08).
10. Empty state: when no transactions match filters, show "No transactions found" message.
11. Newly added transactions are highlighted for 2 seconds.

**Test to add:**
- Frontend (Vitest): Extend existing TransactionList test to verify pagination controls render and category filter chips render.

---

### F08: Delete transaction

**Screen reference:** 2b (delete icon in actions column), 2c (Delete Expense button)

**Route:** N/A (modal overlay on `/expenses` or `/transactions/:id/edit`)

**Implementation logic:**

- `DeleteConfirmationModal` component using shadcn/ui `AlertDialog`:
  - Title: "Delete transaction"
  - Body: "Are you sure you want to delete '[description]'? This action cannot be undone."
  - Buttons: "Cancel" (secondary) and "Delete" (destructive red)
- Triggered from: edit icon in transaction list (F07), "Delete Expense" button on edit page (F11)
- On confirm: `DELETE /api/transactions/:id` via TanStack `useMutation`
- On success: toast "Transaction deleted", invalidate queries, close modal
- On error: toast "Failed to delete transaction", keep modal open

**Acceptance criteria:**
1. Clicking the trash icon on a transaction row opens the confirmation modal.
2. Modal shows the transaction description in the confirmation message.
3. "Cancel" closes the modal without deleting.
4. "Delete" sends DELETE request, removes the row from the list, shows success toast.
5. If deletion fails (network error), shows error toast and modal stays open.
6. After deletion, dashboard summary numbers update on next navigation.

**Test to add:** None (covered by existing E2E tests — can add a specific delete E2E later when the test suite grows).

---

### F09: Dashboard charts (4 charts)

**Screen reference:** 1a (light), 1b (dark) — middle section

**Route:** `/dashboard` (extends existing page from F02)

**Implementation logic:**

Uses Recharts library. Four charts in a 2×2 CSS Grid below the summary cards:

1. **Spending by Category (donut chart):**
   - Data source: `GET /api/dashboard/category-breakdown?month=<current>`
   - Recharts `PieChart` with `Pie` (inner/outer radius for donut), center text showing total
   - Legend to the right listing each category with amount
   - Colors match mockup: Housing=#4f46e5, Food=#22c55e, Transport=#f59e0b, Entertainment=#ef4444, Subscriptions=#8b5cf6, Other=#d4d4d4

2. **Income vs Expenses (grouped bar chart):**
   - Data source: `GET /api/dashboard/monthly-trend?months=6`
   - Recharts `BarChart` with two `Bar` components (income=indigo, expenses=red)
   - X-axis: month abbreviations (Mar, Apr, May...)
   - Legend below: Income / Expenses color keys

3. **Expenses Over Time (line chart):**
   - Data source: `GET /api/dashboard/weekly-expenses?month=<current>`
   - Recharts `AreaChart` with gradient fill under the line
   - X-axis: Week 1, Week 2, Week 3, Week 4
   - Data points as circles on the line

4. **Spending by Month (bar chart):**
   - Data source: reuses `GET /api/dashboard/monthly-trend?months=6` (expenses only)
   - Recharts `BarChart` with single bar, current month highlighted in indigo, others in light purple
   - X-axis: month abbreviations

All charts:
- Show loading skeletons while data fetches
- Show "No data" state if there are zero transactions
- Respond to theme (light/dark) — Recharts text and grid colors from CSS variables
- Respond to month selector — re-fetch when month changes

**Acceptance criteria:**
1. All 4 charts render in a 2×2 grid matching the layout in screens 1a/1b.
2. Donut chart center shows total expenses as formatted currency.
3. Bar chart correctly groups income and expenses per month.
4. Line chart shows weekly expense progression with gradient fill.
5. Current month bar is visually highlighted in the spending-by-month chart.
6. Charts animate on initial render (Recharts `isAnimationActive`).
7. Charts update when month selector changes.
8. Charts look correct in both light and dark themes.

**Test to add:** None (visual output — Playwright screenshot comparison is premature while design is evolving; verify manually).

---

### F10: Dashboard recent transactions

**Screen reference:** 1a (light), 1b (dark) — bottom section

**Route:** `/dashboard` (extends existing page)

**Implementation logic:**

- Component: `RecentTransactions` — shows last 4 transactions with icon, description, category + date subtitle, and amount.
- Data source: `GET /api/transactions?page=1&pageSize=4&sortBy=date&sortOrder=desc`
- "View All →" link navigates to `/expenses`
- Each row shows: category emoji icon in a colored circle, transaction description (bold), "Category · Date" subtitle (muted), amount (red for expense, green for income)
- Reuses data formatting logic from F07 (TransactionTable)

**Acceptance criteria:**
1. Shows the 4 most recent transactions matching screen 1a/1b bottom section.
2. Each row displays emoji icon, description, category/date, and formatted amount.
3. Expense amounts are red with "-" prefix; income amounts are green with "+" prefix.
4. "View All →" link navigates to `/expenses`.
5. Empty state shows "No transactions yet" with a link to add one.

**Test to add:** None (covered by E2E Test 6 which already checks dashboard data).

---

## Tier 3 — Depends on Tier 2

---

### F11: Edit transaction page

**Screen reference:** 2c

**Route:** `/transactions/:id/edit`

**Implementation logic:**

- Reuses `TransactionForm` from F06, but pre-filled with existing data.
- Data source: `GET /api/transactions/:id` — returns transaction + events array.
- Page layout: two-column. Left: form. Right: Activity log.
- Activity log section (right column):
  - Title: "Activity"
  - Lists events from the transaction's `events` array, most recent first
  - Each event: colored dot (indigo for creation, gray for updates), event description, timestamp
  - Examples: "Created via receipt scan — Aug 15, 2026 · 12:34 PM", "AI categorized as Food & Dining — Aug 15, 2026 · 12:34 PM"
- Back arrow (←) at top-left navigates to `/expenses`.
- "Save Changes" button: `PUT /api/transactions/:id` with changed fields only.
- "Cancel" button: navigates back to `/expenses` without saving.
- "Delete Expense" button (red, right-aligned): opens F08 delete confirmation modal.
- On successful save: toast "Changes saved", navigate to `/expenses`.

**Acceptance criteria:**
1. Form is pre-filled with all existing transaction data matching screen 2c.
2. Type toggle shows the correct type (Expense or Income).
3. Category chip is pre-selected.
4. Tags are displayed with × remove buttons.
5. Activity log displays all events for this transaction.
6. "Save Changes" only sends modified fields.
7. Saving creates a "TransactionUpdated" event (visible in activity log on reload).
8. "Delete Expense" button opens confirmation modal (F08).
9. Back arrow navigates to `/expenses`.
10. If transaction ID doesn't exist, show 404 page.

**Test to add:**
- Playwright E2E: Navigate to edit page, change description, save, verify updated description on expenses list.

---

### F12: Receipt upload + AI processing

**Screen reference:** 2d (right column — upload zone), 2e (scan result)

**Route:** `/transactions/new` (extends existing add page from F06)

**Implementation logic:**

Frontend:
- Replace the "Coming soon" overlay on the receipt upload zone (F06) with a functional drop zone.
- `ReceiptUploadZone` component: drag-and-drop area with dashed border, accepts PNG/JPG/PDF up to 10MB.
- "Or take a photo" button: opens device camera (uses `<input type="file" accept="image/*" capture="environment">`).
- On file selected/dropped:
  1. Validate file type and size client-side
  2. Upload to `POST /api/receipts/upload` (multipart/form-data)
  3. Show a processing state: spinner + "Scanning receipt..." message
  4. Listen for result via SSE or poll `GET /api/receipts/:id/status` every 2 seconds
  5. If result received within 60 seconds → navigate to receipt review page (F14)
  6. If 60-second timeout → show error toast "Receipt scan timed out, please try again"

Core API:
- `POST /api/receipts/upload`:
  - Accepts multipart file upload
  - Validates file type (PNG, JPG, PDF) and size (max 10MB)
  - Saves file temporarily (in-memory or temp disk — NOT permanent storage per ADR-005)
  - Publishes message to RabbitMQ `receipt-processing` queue: `{ receiptId, imageBase64, userId, timestamp }`
  - Returns 202 Accepted with `{ receiptId, status: "processing" }`
  - Starts 60-second timeout timer
- `GET /api/receipts/:id/status`:
  - Returns `{ status: "processing" }` or `{ status: "complete", data: { merchant, amount, date, category, items, confidence } }` or `{ status: "failed", error: "..." }`

Receipt Service (Python):
- Consumes from `receipt-processing` queue
- Decodes base64 image
- Runs Tesseract OCR → raw text
- Feeds raw text to LLM with prompt: "Extract merchant name, total amount, date, suggested category, and line items from this receipt text. Return JSON."
- Publishes result to `receipt-results` queue: `{ receiptId, merchant, amount, date, category, items, confidence }`
- Core API consumes from `receipt-results` and stores the result, keyed by receiptId

**Acceptance criteria:**
1. Drag-and-drop file into the upload zone triggers upload.
2. Clicking the upload zone opens a file browser.
3. Files larger than 10MB are rejected with inline error message.
4. Non-image/non-PDF files are rejected.
5. Processing state shows spinner + "Scanning receipt..." text.
6. Timeout after 60 seconds shows error toast.
7. Successful scan navigates to receipt review page (F14).
8. "Open Camera" button works on mobile devices.

**Tests to add:**
- Receipt Service (pytest): Existing Test 3 (ParseRawOcrText) already covers the parsing logic.
- Integration: Add a test that publishes a message to RabbitMQ and verifies the Receipt Service consumes and produces a result.

---

### F13: Export transactions

**Screen reference:** 2b (Export button in header)

**Route:** N/A (downloads from `/expenses` page)

**Implementation logic:**

- Export button on the transaction list page (F07) opens a dropdown menu with: "Export as CSV", "Export as PDF".
- Export respects current filters: if user has "Food & Dining" category filter active, only food transactions are exported.

Core API:
- `GET /api/transactions/export?format=csv&category=food&search=...` — returns file download
  - CSV: standard comma-separated, headers: Date, Description, Category, Type, Amount, Tags
  - PDF: formatted table with title "Expense Report — [Month Year]", date range, totals row at bottom
- Response headers: `Content-Disposition: attachment; filename="expenses-aug-2026.csv"` (or `.pdf`)

Frontend:
- Call the export endpoint, receive blob, trigger browser download.
- Show a loading state on the Export button during download.

**Acceptance criteria:**
1. "Export as CSV" downloads a CSV file with correct headers and data.
2. "Export as PDF" downloads a formatted PDF with title and totals.
3. Export respects active filters (category, search, date range).
4. Filename includes the current month/year.
5. Export button shows loading spinner during download.

**Test to add:** None (file download — verify manually).

---

## Tier 4 — Depends on Tier 3

---

### F14: Receipt scan review page

**Screen reference:** 2e

**Route:** `/receipts/:id/review`

**Implementation logic:**

- Page layout: two-column. Left: receipt placeholder (since we don't store images — show a generic "Receipt processed" card with the filename and scan timestamp). Right: extracted data fields.
- Extracted data fields (matching screen 2e):
  - Merchant (with confidence badge: HIGH/MED/LOW)
  - Amount (with confidence badge)
  - Date (with confidence badge)
  - Category — AI suggested (with confidence badge, editable — user can change)
  - Items Detected (list of line items)
- Confidence color coding: HIGH = green, MED = yellow, LOW = red
- Confidence thresholds: ≥90% = HIGH, 60-89% = MED, <60% = LOW
- Three action buttons:
  - "Confirm & Save" — creates a transaction via `POST /api/transactions` with source=ReceiptScan, navigates to `/expenses`
  - "Edit Before Saving" — navigates to `/transactions/new` with form pre-filled from extracted data
  - "Scan Again" — navigates back to `/transactions/new` with the upload zone active
- "Scan complete — 95% confidence" indicator at the bottom of the left column

**Acceptance criteria:**
1. All extracted fields are displayed matching screen 2e layout.
2. Confidence badges show correct color (green/yellow/red) based on thresholds.
3. Category field is editable (user can override AI suggestion).
4. "Confirm & Save" creates a transaction with source=ReceiptScan and appropriate events.
5. "Edit Before Saving" pre-fills the add transaction form with extracted data.
6. "Scan Again" returns to the add page with upload zone ready.
7. Success toast shown after confirming and saving.

**Test to add:** None (UI flow — covered by manual testing for now).

---

### F15: Email ingestion pipeline

**Screen reference:** None (backend — transactions appear with "Email imported" source badge in screen 2b)

**Route:** N/A (background service)

**Implementation logic:**

Ingestion Service (.NET Core):
- On startup, connects to the app's email inbox via IMAP (e.g., intake@yourapp.com on a configured mail server).
- Polls every 60 seconds for new emails.
- For each new email:
  1. Extract the recipient address → map to user (e.g., `jd-a1b2@intake.yourapp.com` → user JD)
  2. Parse the email body:
     - First attempt: regex patterns for known formats (Amazon order confirmations, bank alerts, PayPal receipts)
     - Fallback: send email body to LLM with prompt: "Extract merchant, amount, date, and category from this email. Return JSON."
  3. Call Core API: `POST /api/transactions` with `source: "EmailImport"`, using a service-to-service auth token
  4. Mark email as read
- If parsing fails (no amount extractable), log the failure and skip (don't create a garbage transaction).

Core API additions:
- `POST /api/intake-address` — generates a unique intake email address for the authenticated user, stores in `user_preferences`
- `GET /api/intake-address` — returns the user's intake address (or null if not set up)
- Service-to-service auth: a shared secret or machine-to-machine JWT that the Ingestion Service uses to create transactions on behalf of users.

**Acceptance criteria:**
1. Forwarded Amazon order email → transaction created with merchant "Amazon", correct amount, category "Shopping", source "EmailImport".
2. Forwarded bank alert email → transaction created with correct amount and "Other" category.
3. Unparseable email → logged as error, no transaction created.
4. Duplicate emails (same message-id) are not processed twice.
5. Transactions created by ingestion appear with "Email imported" badge on the expense list.
6. Each user gets a unique intake address.

**Tests to add:**
- Ingestion Service (xUnit): Existing Test 4 (ParseAmazonOrderEmail) already covers parsing. Add a second parser test for bank alert format.

---

## Tier 5 — Depends on Tier 4

---

### F16: SSE live dashboard updates

**Screen reference:** None (behavioral — dashboard updates without refresh)

**Route:** `/api/events/stream` (SSE endpoint on Core API)

**Implementation logic:**

Core API:
- New SSE endpoint: `GET /api/events/stream`
  - Requires Auth0 JWT (passed as query param for SSE: `?token=<jwt>`)
  - Keeps connection open, sends events as they occur
  - Event types: `transaction:created`, `transaction:updated`, `transaction:deleted`
  - Payload: `{ type: "transaction:created", data: { id, description, amount, category, source } }`
- When the Ingestion Service creates a transaction, or when a receipt scan completes, the Core API publishes an SSE event to all connected clients for that user.

Frontend:
- `useSSE()` custom hook:
  - Connects to `/api/events/stream` on mount
  - On `transaction:created` event: invalidate TanStack Query caches for `['transactions']` and `['dashboard']`
  - This triggers automatic refetch — dashboard numbers and charts update live
  - On connection lost: auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
- Active on all pages (wrap in root layout), so the dashboard is always fresh.

**Acceptance criteria:**
1. When an email-imported transaction is created while the user is on the dashboard, the summary cards update within 3 seconds without page refresh.
2. When a receipt scan completes while the user is on another page, the next visit to the dashboard shows the new data.
3. SSE connection reconnects automatically after network interruption.
4. SSE endpoint rejects requests without a valid JWT.
5. Events are scoped to the authenticated user only.

**Test to add:** None (real-time behavior — verify manually by forwarding a test email while watching the dashboard).

---

### F17: Settings — profile section

**Screen reference:** 1d (top card)

**Route:** `/settings`

**Implementation logic:**

- Settings page layout: single column, max-width 720px, stacked cards.
- Profile card:
  - User avatar (initials circle, 56px), full name, email — from Auth0 user profile (`useAuth0()` hook)
  - "Edit Profile" button: opens Auth0's Universal Login profile management page (external redirect)
  - "Change Password" button: triggers Auth0's password reset email flow via Auth0 Management API or redirects to Auth0's change password URL

**Acceptance criteria:**
1. Settings page renders at `/settings` with profile card matching screen 1d.
2. User name and email are displayed from Auth0 profile.
3. "Edit Profile" opens Auth0's profile management.
4. "Change Password" triggers Auth0's password reset flow.

**Test to add:** None (thin wrapper around Auth0 — tested by Auth0).

---

### F18: Settings — email integration section

**Screen reference:** 1d (second card)

**Route:** `/settings` (extends existing page)

**Implementation logic:**

- Email Integration card:
  - Gmail row: shows "Connected" badge with the user's intake address, "Disconnect" button (deletes intake address via `DELETE /api/intake-address`)
  - If not set up: "Connect" button calls `POST /api/intake-address` to generate a unique intake address, then shows setup instructions (how to create a forwarding rule in Gmail/Outlook)
  - SMS row: "Connect" button — disabled with tooltip "Coming soon" (SMS deferred per ADR-006)
- Setup instructions modal: step-by-step guide for setting up auto-forwarding in Gmail and Outlook, with the user's unique intake address pre-filled for copy-paste.

**Acceptance criteria:**
1. Card shows "Connected" with intake address if already set up, matching screen 1d layout.
2. "Connect" generates a unique intake address and displays setup instructions.
3. Setup instructions include the user's intake address with a copy button.
4. "Disconnect" removes the intake address after confirmation.
5. SMS row shows "Coming soon" state.

**Test to add:** None (settings UI — verify manually).

---

### F19: Settings — preferences section

**Screen reference:** 1d (third card)

**Route:** `/settings` (extends existing page)

**Implementation logic:**

- Preferences card with 4 settings:
  1. **Currency**: dropdown/select showing "USD ($)" — stored in `user_preferences`. Options: USD, EUR, GBP, BDT (add common currencies). This is the display currency — all amounts are displayed in this currency.
  2. **Theme**: three-option toggle (Light / Dark / Auto) — wired to F03 `ThemeContext`.
  3. **Notifications**: toggle switch — when enabled, browser push notifications fire when an email-imported expense is auto-added. Stored in `user_preferences`.
  4. **Monthly Budget**: editable amount field ($6,000). Stored in `user_preferences`. When expenses for the current month reach 80% of budget, a warning banner appears on the dashboard. At 100%, the banner turns red.
- All changes auto-save on change (no Save button) — `PUT /api/preferences` with debounce.

Dashboard budget indicator (extends F02):
- If monthly budget is set and expenses ≥ 80%: yellow warning banner "You've spent 80% of your $6,000 monthly budget"
- If expenses ≥ 100%: red banner "You've exceeded your $6,000 monthly budget"

**Acceptance criteria:**
1. All 4 preference rows render matching screen 1d.
2. Currency change updates the display currency across the app.
3. Theme toggle changes theme immediately (wired to F03).
4. Notifications toggle stores preference.
5. Monthly budget field accepts numeric input, auto-saves.
6. Dashboard shows warning banner when expenses ≥ 80% of budget.
7. Dashboard shows red banner when expenses ≥ 100% of budget.
8. Changes persist across sessions (stored in backend).

**Test to add:** None (settings UI — verify manually).

---

### F20: Settings — danger zone

**Screen reference:** 1d (bottom card, red border)

**Route:** `/settings` (extends existing page)

**Implementation logic:**

- Danger Zone card: red border (#fecaca), "Danger Zone" title in red.
- "Delete Account" button: opens a multi-step confirmation modal:
  1. First modal: "Are you sure? This will permanently delete your account and all your data."
  2. User must type their email address to confirm.
  3. On confirm: `DELETE /api/account` — deletes all transactions, events, preferences, and Auth0 user account.
  4. On success: log out, redirect to login page.

Core API:
- `DELETE /api/account`: deletes all user data (transactions, events, preferences) within a database transaction. Calls Auth0 Management API to delete the Auth0 user. Returns 204.

**Acceptance criteria:**
1. Danger zone card has red border matching screen 1d.
2. "Delete Account" opens confirmation modal.
3. User must type their email to confirm deletion.
4. Mismatched email disables the delete button.
5. Successful deletion removes all data, deletes Auth0 account, redirects to login.
6. If deletion fails, shows error toast and does not log out.

**Test to add:** None (destructive action — verify manually with a test account).

---

## Dependency graph summary

```
Foundation Tasks 00-05 (complete)
    │
    ├── F01: CRUD API ─────────────────────┐
    ├── F02: Dashboard cards (styled)       │
    ├── F03: Dark/light theme               │
    ├── F04: FAB component                  │
    └── F05: Toast system                   │
                                            │
    ┌───────────────────────────────────────┘
    │
    ├── F06: Add transaction ──────────── F12: Receipt upload ──── F14: Receipt review
    ├── F07: Transaction list ─────────── F11: Edit transaction
    │                          └───────── F13: Export (CSV+PDF)
    ├── F08: Delete transaction
    ├── F09: Dashboard charts
    └── F10: Recent transactions
                                            │
    ┌───────────────────────────────────────┘
    │
    ├── F15: Email ingestion ─────────── F16: SSE live updates
    │                         └───────── F18: Settings email
    ├── F17: Settings profile
    ├── F19: Settings preferences
    └── F20: Settings danger zone
```

## Test additions summary

| Ticket | New tests | Type |
|--------|-----------|------|
| F01 | 2 integration tests (Testcontainers) | POST+GET, filtered GET |
| F06 | Extend existing Playwright E2E Test 7 | E2E |
| F07 | Extend existing Vitest component test | Frontend |
| F11 | 1 new Playwright E2E test | E2E (edit flow) |
| F12 | 1 integration test (RabbitMQ publish/consume) | Integration |
| F15 | 1 xUnit test (bank alert parser) | Unit |

**Total test count after all features:** 7 (foundation) + 6 (features) = **13 tests**.
