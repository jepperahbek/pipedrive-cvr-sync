# Security Policy

## Supported versions

Security fixes are applied on the default branch of this repository.

## Reporting a vulnerability

Please report security issues privately (do not open a public GitHub issue):

- Email the maintainer listed on the GitHub profile / website contact page
- Include steps to reproduce, impact, and any proof-of-concept you have

We aim to acknowledge reports within a few business days.

## Deployment notes

- Never commit `.env` files or API tokens
- Set `PIPEDRIVE_WEBHOOK_USER` and `PIPEDRIVE_WEBHOOK_PASSWORD` in production —
  the webhook route is not mounted without them
- Set `PIPEDRIVE_COMPANY_ID` so iframe JWTs from other companies are rejected
- Keep `DATAFORDELER_API_KEY` private; the public CVR lookup endpoint is
  rate-limited, but your key can still be exhausted if the deploy is abused
- Rotate Pipedrive personal API tokens and Datafordeler keys if they leak
