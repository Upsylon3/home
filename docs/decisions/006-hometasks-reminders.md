# 006: Personal HomeTasks reminders

Status: accepted for the first reminders release.

HomeTasks owns one optional UTC reminder instant per task occurrence. The editor
accepts the browser's local date/time and stores an explicit instant. Existing
task edits save reminder and metadata atomically through PATCH; creation itself
does not schedule a reminder. Date-only due dates keep their calendar semantics. Reminders are opt-in, at most
366 days ahead, and appear in Home's existing Core notification bell. Email,
web push, assignment and automatic reminder inheritance for repeated tasks are
outside this release. Completing a task clears its reminder; reopening does not
rearm it. Each next repeat starts without a reminder.

A Tasks worker checks persisted due, open tasks every 30 seconds, sends at most
20 per tick, and retries failures after one minute (quota failures after one
hour), including after restart, without retaining browser session tokens. A dedicated external 32-byte reminder key is mounted read-only
only in Tasks and Core through an optional Compose override. Without it Tasks
still works and new reminders are unavailable. This key is not accepted by
Core's general internal APIs. Core exposes a separate fixed-purpose endpoint:
only HomeTasks info notifications, only an enabled target user, a fixed title,
task title body (200 characters), and an integer task link. Tasks asserts the
owner from its own row, never from client-supplied user IDs. Core does not read
Tasks' database or depend on Tasks availability.

Core atomically records a delivery UUID and creates its notification. Replays
for the same owner/task return success without another notification, including
response loss and concurrent workers. The first accepted title wins; a key
cannot be rebound to another owner/task. Receipts persist in Core. New delivery
requires HomeTasks to be enabled; disabled/deleted users or a disabled app are
suppressed. Per-UTC-day limits are 100 deliveries per owner and 1000 globally;
quota failures stay pending for retry. The dedicated key can only produce
bounded HomeTasks notices, not read notifications, authenticate users, or act as
another application. Compromise can still spam those bounded notices: keep the
key outside repo/data/backups and restart both services after changing it.

Editing/removing/completing cancels locally pending generations. A request
already in flight can still reach Core; accepted notifications are not
retracted. A changed time gets a new UUID and the worker acknowledges only its
original generation. Late reminders are sent once after service downtime;
there is no exact-time, browser-push or cross-service-restore exactly-once
promise. Restoring Core without matching Tasks state can lose receipt history.

Acceptance: real Core/Tasks tests for ownership, UTC validation, cancellation,
repeat/reopen semantics, restart, concurrent delivery, lost responses, disabled
users, key boundaries and quota; additive migration proof; accessible desktop
and mobile editor plus bell/task links; standard CI and disposable Docker proof.
