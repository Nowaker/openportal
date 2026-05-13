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

// Renders absolute paths under the server's runtime home directory
// as plain `~/...` - the server is the source of truth for "who am
// I", and a bare ~ is the universal shell convention for "the current
// user's home" regardless of which OS layout the home directory
// actually lives at (/home/x on Linux, /Users/x on macOS).
export function toTildeDisplay(absPath: string, home: string): string {
  if (!home || !absPath.startsWith("/")) return absPath;
  if (absPath === home) return `~`;
  if (absPath.startsWith(home + "/")) {
    return `~${absPath.slice(home.length)}`;
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
  // Accept legacy ~user form too so paths saved before the bare-tilde
  // rewrite still resolve correctly.
  if (user && displayPath === `~${user}`) return home;
  if (user && displayPath.startsWith(`~${user}/`)) {
    return home + displayPath.slice(user.length + 1);
  }
  return displayPath;
}
