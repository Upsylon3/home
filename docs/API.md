# API

The gateway exposes the main API under `/api/`.

Most routes require:

```http
Authorization: Bearer <jwt>
```

Admin routes additionally require the `admin` role.

## Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Authenticate |
| POST | `/api/auth/2fa/verify` | Complete 2FA login |
| GET | `/api/auth/me` | Current user/status |
| POST | `/api/auth/change-password` | Change password |
| POST | `/api/auth/logout-everywhere` | Revoke sessions |
| POST | `/api/auth/2fa/setup` | Start 2FA |
| POST | `/api/auth/2fa/confirm` | Confirm 2FA |
| POST | `/api/auth/2fa/disable` | Disable 2FA |
| POST | `/api/auth/2fa/recovery-codes` | Recovery codes |

## Files and folders

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/files` | List files |
| GET | `/api/files/trash` | List trash |
| GET | `/api/files/shares` | List shares |
| GET | `/api/files/all` | Cross-folder media listing |
| POST | `/api/files/upload` | Upload |
| POST | `/api/files/download-batch` | ZIP download |
| GET | `/api/files/:id/download` | Download |
| GET | `/api/files/:id/thumbnail` | Thumbnail |
| POST | `/api/files/:id/share` | Create share |
| POST | `/api/files/:id/move` | Move |
| DELETE | `/api/files/:id` | Trash |
| DELETE | `/api/files/:id/permanent` | Permanent delete |
| POST | `/api/files/:id/restore` | Restore |
| GET/POST/PATCH/DELETE | `/api/folders/...` | Folder operations |

## Other

`/api/admin/...` handles administration, `/api/activity` handles activity,
and `/api/core/...`, `/api/homemedia/...`, `/api/homesync/...` and
`/api/homenotes/...` belong to their respective services.

This is an overview, not a generated OpenAPI specification. For exact request
and response shapes, use the route/controller code.
