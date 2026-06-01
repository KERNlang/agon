# CI access to the private `kern_engines` submodule

`kern_engines/` is a git submodule pointing at the **private** repo
[`KERNlang/kern-engines`](https://github.com/KERNlang/kern-engines). GitHub
Actions' default `GITHUB_TOKEN` is scoped to *this* repo only, so it cannot
fetch a different private repo. Without credentials, `actions/checkout` leaves
`kern_engines/` empty and `tsc -b` fails with:

```
error TS5083: Cannot read file '.../kern_engines/tsconfig.json'.
```

The CI workflow (`.github/workflows/ci.yml`) authenticates the submodule fetch
with a read-only **SSH deploy key** stored in the `KERN_ENGINES_DEPLOY_KEY`
secret. Provision it once:

## One-time setup

```bash
# 1. Generate a dedicated read-only keypair (no passphrase)
ssh-keygen -t ed25519 -C "agon-ci@kern-engines" -f /tmp/kern_engines_ci -N ""

# 2. Add the PUBLIC key as a read-only Deploy Key on the SUBMODULE repo:
#    GitHub → KERNlang/kern-engines → Settings → Deploy keys → Add deploy key
#    Title: "agon CI (read-only)"  ·  leave "Allow write access" UNCHECKED
cat /tmp/kern_engines_ci.pub      # paste this

# 3. Add the PRIVATE key as an Actions secret on the CONSUMER repo:
#    GitHub → KERNlang/agon → Settings → Secrets and variables → Actions
#    → New repository secret  ·  Name: KERN_ENGINES_DEPLOY_KEY
cat /tmp/kern_engines_ci          # paste this (including BEGIN/END lines)

# 4. Delete the local copies
rm /tmp/kern_engines_ci /tmp/kern_engines_ci.pub
```

(With `gh` + the `admin:public_key`/repo scopes you can script steps 2–3:
`gh repo deploy-key add /tmp/kern_engines_ci.pub -R KERNlang/kern-engines -t "agon CI"`
and `gh secret set KERN_ENGINES_DEPLOY_KEY -R KERNlang/agon < /tmp/kern_engines_ci`.)

The `.gitmodules` URL stays SSH (`git@github.com:…`), which matches the
deploy-key auth — no change needed there.

## Local clones

```bash
git clone --recurse-submodules git@github.com:KERNlang/agon.git
# or, in an existing checkout:
git submodule update --init --recursive
```

## Scaling to more consumers

Each consumer repo (e.g. `kern-sight`) needs its own `KERN_ENGINES_DEPLOY_KEY`
secret + a deploy key on `kern-engines`. If the number of consumers grows, a
single org-level **GitHub App** installation token (via
`actions/create-github-app-token`) with read access to `kern-engines` scales
better than one deploy key per repo.
