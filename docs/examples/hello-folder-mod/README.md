# Hello Folder Mod

This is the complete v1 external package shape. It compiles only against the
public `@kernlang/agon-mod-api`; no kernel or support-package imports are used.

Build it, then copy this directory under `$AGON_HOME/mods/hello-folder-mod`.
The checked-in `dist/` output makes this example immediately runnable; rebuild
it after changing `src/`.

```bash
# 1. Static inspection: this does not import or execute the mod.
agon mod list
agon mod inspect example.hello-folder-mod

# 2. Preview trust. Review the exact identity, hashes, publisher, warning,
#    and permission decisions. Run the emitted `agon mod approve ...` command.
agon mod trust example.hello-folder-mod --allow state.read --reason "reviewed locally"

# 3. Preview activation only after trust is complete. Review and run the
#    emitted second `agon mod enable ... --approve ...` command.
agon mod enable example.hello-folder-mod --reason "enabled locally"

# 4. Start a new Agon process, then invoke the contribution.
agon hello-folder

# Later, revocation is also previewed and hash-approved:
agon mod untrust example.hello-folder-mod --reason "no longer trusted"
# For a granted capability, use:
agon mod revoke example.hello-folder-mod --capability state.read --resources example.greeting
```

Agon performs static inspection before any import, displays the exact source,
content hash, full-code trust warning, and requested permissions, and requires two distinct hash-bound approvals: authority first, activation second. Editing any declared byte
invalidates exact-artifact trust. Disabling the mod removes its contributions
without deleting its files or history. Kernel-only safe mode never imports it.

Tier 2 folder mods execute in the Agon process with full code trust. Capability
wrappers improve auditability and prevent accidental use; they are not an OS
sandbox. Do not approve code you would not run directly.
