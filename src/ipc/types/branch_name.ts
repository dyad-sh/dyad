import { z } from "zod";

/**
 * A git branch name accepted at the IPC boundary and handed to native `git`
 * (e.g. `git checkout <ref>`). Beyond rejecting a leading dash (which git would
 * treat as an option), it rejects values that resolve to something other than a
 * branch: a full ref (`refs/tags/v1`), a range/parent/revision expression
 * (`..`, `~`, `^`, `:`), or a reflog expression (`main@{1}`) would detach HEAD
 * or check out the wrong object instead of re-attaching to a branch. It also
 * rejects characters git's check-ref-format forbids in branch names (control
 * characters, space, `\`, `?`, `*`, `[`) as defense-in-depth for a
 * renderer-supplied value. Shared so every branch-name input on the IPC
 * boundary enforces the same guards and they can't drift apart.
 */
export const safeBranchNameSchema = z
  .string()
  .min(1)
  .refine((v) => !v.startsWith("-"), "branch must not start with '-'")
  .refine(
    (v) =>
      !v.startsWith("refs/") &&
      !v.includes("..") &&
      !v.includes("@{") &&
      !/[~^:]/.test(v),
    "branch must be a branch name, not a full ref or revision expression",
  )
  .refine(
    // A bare `.` or a relative-path prefix (`./`, `../`) is not a valid branch
    // name. Because `gitCheckout` runs `git checkout <ref>` with no `--`
    // separator, such a ref is reinterpreted as a pathspec and e.g.
    // `git checkout .` silently discards all unstaged working-tree changes
    // instead of failing — a data-loss vector reachable from renderer-supplied
    // input. (`../` also contains `..`, already rejected above; guarding `./`
    // here closes the remaining relative-path hole.)
    (v) => v !== "." && !v.startsWith("./") && !v.startsWith("../"),
    "branch must not be '.' or a relative path",
  )
  .refine(
    // `[` is written as `\x5b` (not a bare `[`) so the character-class boundary
    // is unambiguous. JS treats a bare `[` inside `[...]` as a literal, but that
    // is JS-specific and easy to misread while editing this security-critical
    // guard; the hex form matches the other escapes here and reads the same in
    // any regex engine. (`\[` would be equivalent but oxlint strips it as a
    // useless escape.)
    // eslint-disable-next-line no-control-regex
    (v) => !/[\x00-\x1f\x7f \\?*\x5b]/.test(v),
    "branch must not contain spaces, control characters, or characters forbidden by git",
  );
