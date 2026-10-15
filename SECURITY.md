# Security policy

This repository contains browser extensions for OviPets; it is public and is **not** an appropriate destination for account credentials or full game databases.

## Reporting

For security-sensitive problems, use GitHub's private vulnerability reporting if enabled in the repository's Security tab. If private reporting is not available, do not post exploit details, access tokens or account data in a public issue; contact the repository owner through an established private channel first.

For non-sensitive reliability bugs, use a GitHub issue with version, browser, reproduction steps, redacted logs and expected vs actual results.

## Credentials and data

- Never commit GitHub personal access tokens, browser session cookies, OviPets credentials, identifiable game screenshots or user datasets.
- A GitHub token for the optional shared Species Gist should have only the minimum Gist capability required. Reading public shared data does not require a token.
- A token provided to the extension is a credential: do not include it in diagnostic exports or GitHub issue attachments.
- Rotate/revoke any token suspected of exposure.

## Safety expectations

- Extension-created tabs may be closed automatically only when owned by that extension.
- Permanent operations such as Discard must require a reviewed plan and validate against current OviPets state.
- Updates must be sourced from reviewed code and should not interrupt a running operation without an explicit user action.
- Code review and CI reduce risk but do not prove that a workflow is safe on a live account.
