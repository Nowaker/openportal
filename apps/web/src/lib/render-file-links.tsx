import { useFileBrowserPanelStore } from "@/stores/file-browser-panel-store";
import useMediaQuery from "@/hooks/use-media-query";
import { linkifySessionIds } from "@/lib/linkify-session-ids";

const PATH_REGEX = /(^|[\s'"\[\]{}()=:])((?:\/(?:[\w.-]+\/)+|~\/(?:[\w.-]+\/)*)[\w.-]*[\w])(?=$|[\s'"\[\]{}().,:;?!])/g;

export function FileLinks({ text }: { text: string }) {
  const { isMobile } = useMediaQuery();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  PATH_REGEX.lastIndex = 0;
  while ((match = PATH_REGEX.exec(text)) !== null) {
    const path = match[2];
    if (path.startsWith("/api/")) continue;

    const matchStart = match.index + match[1].length;
    const matchEnd = matchStart + path.length;

    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart));
    }

    parts.push(
      <a
        key={matchStart}
        href={`file://${path}`}
        className="text-primary hover:underline"
        onClick={(e) => {
          e.preventDefault();
          if (isMobile) {
            window.open(
              `/files?path=${encodeURIComponent(path)}`,
              "_blank",
              "noopener,noreferrer",
            );
          } else {
            useFileBrowserPanelStore.getState().open(path);
          }
        }}
      >
        {path}
      </a>
    );

    lastIndex = matchEnd;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  const linkizeFallback = () => null;
  const withSessionLinks = parts.map((part, i) => {
    if (typeof part !== "string") return part;
    return (
      <span key={`txt-${i}`}>
        {linkifySessionIds(part, { resolveSessionId: linkizeFallback })}
      </span>
    );
  });

  return <>{withSessionLinks.length > 0 ? withSessionLinks : text}</>;
}
