// Path utilities shared by the file browser (/files) and the
// Open-directory picker. Both surfaces show absolute filesystem paths
// and let the user edit them with tab completion; the rules for
// splitting at the last slash and substituting ~user for $HOME are
// identical, so they live here.

export function splitInput(input: string): { dir: string; prefix: string } {
  const lastSlash = input.lastIndexOf("/");
  if (lastSlash < 0) return { dir: "", prefix: input };
  return {
    dir: input.slice(0, lastSlash + 1),
    prefix: input.slice(lastSlash + 1),
  };
}

// home -> username works because the runtime homedir() is always the
// last segment of the home path: /home/<user> on Linux, /Users/<user>
// on macOS. No need to look at /etc/passwd; we trust what the
// userland already chose.
function usernameFromHome(home: string): string {
  return home.split("/").filter(Boolean).pop() ?? "";
}

// Renders an absolute path as ~user/... when it's inside the runtime
// user's home, falls back to the absolute form otherwise. The ~user
// prefix (not just ~) is deliberate: it matches sh/zsh syntax (~root,
// ~postgres) so a savvy user can later extend this to arbitrary users
// without rewriting the renderer.
export function toTildeDisplay(absPath: string, home: string): string {
  if (!home || !absPath.startsWith("/")) return absPath;
  const user = usernameFromHome(home);
  if (!user) return absPath;
  if (absPath === home) return `~${user}`;
  if (absPath.startsWith(home + "/")) {
    return `~${user}${absPath.slice(home.length)}`;
  }
  return absPath;
}

// Inverse of toTildeDisplay. Accepts the user-typed forms:
//   ~user, ~user/..., ~, ~/...   (last two are bash shorthand for $HOME)
// Anything else passes through unchanged so an absolute path still
// works, and ~someotheruser stays as-is for the server to reject.
export function fromTildeDisplay(displayPath: string, home: string): string {
  if (!home || !displayPath.startsWith("~")) return displayPath;
  const user = usernameFromHome(home);
  if (displayPath === "~" || displayPath === "~/") return home;
  if (displayPath.startsWith("~/")) return home + displayPath.slice(1);
  if (user && displayPath === `~${user}`) return home;
  if (user && displayPath.startsWith(`~${user}/`)) {
    return home + displayPath.slice(user.length + 1);
  }
  return displayPath;
}
