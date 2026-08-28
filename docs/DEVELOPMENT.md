# Development

## Rules

- Keep application code inside its application.
- Do not access another application's database directly.
- Use public APIs for cross-app dependencies.
- Keep authorization server-side.
- Prefer small, testable changes.
- Do not commit secrets, local databases or build output.

## Node workspaces

From the repository root:

```bash
npm install
npm test
```

Each service has its own `package.json` and may be developed independently.

## Adding an app

Decide what data it owns, which HomeCore APIs it needs, whether another app is
a hard dependency, which gateway path it uses, and how it is tested.

Optional sibling applications should never be required for the core operation
of an app.

## Before submitting changes

Run:

```bash
npm test
```

For Docker or gateway changes, rebuild the affected containers and verify the
relevant routes.
