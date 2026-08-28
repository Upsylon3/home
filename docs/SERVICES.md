# Services

## Home

Dashboard and application launcher. No dedicated backend.

## HomeCloud

Main file service:

- accounts and authentication
- admin/user roles
- folders and file management
- upload/download
- search and sorting
- trash and restore
- share links
- batch ZIP downloads
- storage quotas
- activity history
- TOTP 2FA
- PWA support

HomeCore currently runs with its backend.

## HomeMedia

Photo/video library built on HomeCloud. Provides gallery/timeline views,
search, favorites, albums, media viewing, EXIF metadata and thumbnails.

It stores application metadata, not the original media files.

## HomeSync

The backend handles device registration, backup checks, upload planning and
backup history. Files are stored by HomeCloud.

The Android client is partially implemented and is not yet a complete release.

## HomeNotes

A frontend and backend are present in the repository. It is less mature than
the main services.

## Planned

HomeVault, HomeTasks, HomeMonitor, HomeAI and HomeBridge are not complete
applications yet.
