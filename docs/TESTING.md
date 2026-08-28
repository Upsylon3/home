# Testing

Run all available workspace tests from the repository root:

```bash
npm test
```

The main backend suites cover authentication, files, folders, administration,
share links, rate limiting and HomeCore. HomeMedia and HomeSync also have
service-level integration tests.

Tests must use isolated test data and must not depend on a real Home
installation.

For changes:

1. Test the affected service.
2. Run `npm test`.
3. Rebuild Docker services when their configuration changes.
4. Verify gateway routes when routing changes.

Security-sensitive behavior should be tested at the server boundary.
