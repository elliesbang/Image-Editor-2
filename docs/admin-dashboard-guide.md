# Ellie Image Editor Admin Dashboard Guide

## Access requirements
- Set the `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SESSION_SECRET` environment variables before deploying.
- Assign a long, random `SESSION_SECRET` (32+ characters) so admin JWT cookies remain tamper proof.
- Optional rate-limit knobs (`ADMIN_RATE_LIMIT_MAX_ATTEMPTS`, `ADMIN_RATE_LIMIT_WINDOW_SECONDS`, `ADMIN_RATE_LIMIT_COOLDOWN_SECONDS`) slow brute-force attempts.

## Launching the dashboard
1. Click the "관리자 전용" button in the footer to open the secure login modal.
2. Enter the admin email and password that match the configured environment variables.
3. After a successful login the dashboard opens in a new browser tab while the current tab stays on the marketing page.

## Dashboard capabilities
- Upload a Michina participant CSV, optionally providing mission start and end dates.
- Review total participants, completion counts, and pending users at a glance.
- Refresh or export the completion table, and trigger the automated completion check.
- Jump directly to the Michina community using the configured `MICHINA_COMMUNITY_URL`.
- Log out from the dashboard header to revoke the admin session across tabs.
