# Maintainer Notes

This file is for package maintainers. End-user docs stay in `README.md`.

## Publish workflow

GitHub Actions workflow: `.github/workflows/publish.yml`

### Required secret

- `NPM_TOKEN` (npm Automation token)

### Release steps

1. Bump version:

```bash
npm version patch
```

2. Push commit + tag:

```bash
git push
git push --tags
```

3. Workflow runs:
- `npm ci`
- `npm run typecheck`
- verifies tag matches package version
- `npm publish --access public --provenance`

## Local one-off publish

```bash
npm publish --access public
```
