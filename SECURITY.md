# Security policy

## Supported versions

Only the latest release gets fixes.

## Reporting a vulnerability

Use [private vulnerability reporting](https://github.com/dodoflix/dodobox/security/advisories/new). Please do not open a public issue for a security problem.

Include what you found, how to reproduce it and the version. You will get a reply within a week.

## Scope and expectations

Dodobox is meant for a trusted home network. It has no login: anyone who can reach the port can use it, create profiles and start downloads. Do not expose it to the internet. Set `HOST=127.0.0.1` to allow only the local computer.

Reports about that design (for example "there is no authentication") are known. Reports about path traversal, request forgery, remote code execution, or reaching beyond the data folder are welcome.
