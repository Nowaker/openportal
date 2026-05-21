import Markdown from "react-markdown";
import { MermaidBlock } from "@/components/mermaid-block";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkGithubBlockquoteAlert from "remark-github-blockquote-alert";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";
import useMediaQuery from "@/hooks/use-media-query";
import { useFileBrowserPanelStore } from "@/stores/file-browser-panel-store";
import { useChatLinkStore } from "@/stores/chat-link-store";

// Two-mode markdown renderer.
//
//   default  = react-markdown + remark-gfm + remark-breaks. The original
//              behaviour shipped across the chat renderer and most other
//              markdown sites in the app. Safe against HTML injection
//              because react-markdown escapes html-in-markdown by
//              default.
//   extended = layer on (a) rehype-raw to pass HTML through unmodified,
//              (b) remark-github-blockquote-alert for the
//              "> [!TIP]/[!NOTE]/[!WARNING]/[!CAUTION]/[!IMPORTANT]"
//              callouts you see in modern README files, (c) optional
//              rewriting of relative image/link URLs into absolute URLs
//              against the source repository (so .github/assets/foo.png
//              actually loads inside the modal).
//
// SECURITY: extended mode renders raw HTML from the markdown source. Use
// it only for content you trust at least as much as the source code that
// pulled it in (npm package READMEs are the motivating case - if a
// malicious README ships, the user is already running its plugin code,
// so HTML execution is not a meaningful additional escalation).

export type MarkdownMode = "default" | "extended";

export interface MarkdownRendererProps {
  source: string;
  mode?: MarkdownMode;
  // Used in extended mode to rewrite relative URLs (./foo.png,
  // /assets/x.svg, .github/assets/y.jpg) into absolute URLs hitting the
  // raw content host. Pass the package.json repository.url verbatim;
  // the renderer parses it and computes the right base URL. Falls back
  // to leaving relative URLs as-is when the repo URL is not parseable.
  repositoryUrl?: string;
  className?: string;
  components?: Components;
}

interface RepoBase {
  rawBase: string;
  webBase: string;
}

function parseRepoBase(repositoryUrl: string | undefined): RepoBase | null {
  if (!repositoryUrl) return null;
  let url = repositoryUrl.trim();
  url = url.replace(/^git\+/, "").replace(/\.git$/, "");
  // Convert SSH form (git@github.com:owner/repo) to https URL form
  // before parsing. host:owner/repo -> https://host/owner/repo
  const sshMatch = url.match(/^[^@]+@([^:]+):(.+)$/);
  if (sshMatch) url = `https://${sshMatch[1]}/${sshMatch[2]}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname;
  const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
  if (!path) return null;
  if (host === "github.com" || host === "www.github.com") {
    return {
      rawBase: `https://github.com/${path}/raw/HEAD/`,
      webBase: `https://github.com/${path}/blob/HEAD/`,
    };
  }
  if (host === "gitlab.com" || host === "www.gitlab.com") {
    return {
      rawBase: `https://gitlab.com/${path}/-/raw/HEAD/`,
      webBase: `https://gitlab.com/${path}/-/blob/HEAD/`,
    };
  }
  if (host === "bitbucket.org") {
    return {
      rawBase: `https://bitbucket.org/${path}/raw/HEAD/`,
      webBase: `https://bitbucket.org/${path}/src/HEAD/`,
    };
  }
  return null;
}

function rewriteRelative(
  raw: string | undefined,
  repoBase: RepoBase | null,
  preferRaw: boolean,
): string | undefined {
  if (!raw) return raw;
  if (!repoBase) return raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (raw.startsWith("//")) return raw;
  if (raw.startsWith("#")) return raw;
  if (raw.startsWith("mailto:")) return raw;
  const stripped = raw.replace(/^\.?\/+/, "");
  return (preferRaw ? repoBase.rawBase : repoBase.webBase) + stripped;
}

export function MarkdownRenderer({
  source,
  mode = "default",
  repositoryUrl,
  className,
  components,
}: MarkdownRendererProps) {
  const { isMobile } = useMediaQuery();
  const linkBehavior = useChatLinkStore((s) => s.behavior);
  const remarkPlugins =
    mode === "extended"
      ? [remarkGfm, remarkBreaks, remarkGithubBlockquoteAlert]
      : [remarkGfm, remarkBreaks];
  const rehypePlugins = mode === "extended" ? [rehypeRaw] : undefined;

  const repoBase =
    mode === "extended" ? parseRepoBase(repositoryUrl) : null;

  const componentsOverride: Components = {
    ...(components ?? {}),
    code: (props) => {
      const { className, children, ...rest } = props as {
        className?: string;
        children?: React.ReactNode;
      } & Record<string, unknown>;
      if (className === "language-mermaid" || className === "lang-mermaid") {
        const source = typeof children === "string"
          ? children
          : Array.isArray(children)
            ? children.join("")
            : String(children ?? "");
        return <MermaidBlock source={source} />;
      }
      return <code className={className} {...rest}>{children}</code>;
    },
    a: (props) => {
      const { href, children, ...rest } = props as {
        href?: string;
        children?: React.ReactNode;
      } & Record<string, unknown>;
      const finalHref = rewriteRelative(href, repoBase, false);
      if (finalHref?.startsWith("file://")) {
        return (
          <a
            {...rest}
            href={finalHref}
            onClick={(e) => {
              e.preventDefault();
              let path: string | null = null;
              let hash = "";
              try {
                const u = new URL(finalHref);
                path = decodeURIComponent(u.pathname);
                hash = u.hash;
              } catch {
                path = null;
              }
              if (!path) return;
              if (isMobile) {
                const target = `/files?path=${encodeURIComponent(path)}${hash}`;
                window.open(target, "_blank", "noopener,noreferrer");
              } else {
                useFileBrowserPanelStore.getState().open(path);
              }
            }}
          >
            {children}
          </a>
        );
      }
      const isAnchor = finalHref?.startsWith("#") ?? false;
      const isMailto = finalHref?.startsWith("mailto:") ?? false;
      const externalLink = !!finalHref && !isAnchor && !isMailto;
      if (externalLink && linkBehavior === "none") {
        return <span {...rest}>{children}</span>;
      }
      if (externalLink && linkBehavior === "new-window") {
        return (
          <a
            {...rest}
            href={finalHref}
            onClick={(e) => {
              e.preventDefault();
              window.open(
                finalHref,
                "_blank",
                "noopener,noreferrer,popup=yes",
              );
            }}
          >
            {children}
          </a>
        );
      }
      const target =
        externalLink && linkBehavior === "new-tab" ? "_blank" : undefined;
      const rel =
        externalLink && linkBehavior === "new-tab"
          ? "noreferrer noopener"
          : undefined;
      return (
        <a {...rest} href={finalHref} target={target} rel={rel}>
          {children}
        </a>
      );
    },
    img: (props) => {
      const { src, alt, ...rest } = props as {
        src?: string;
        alt?: string;
      } & Record<string, unknown>;
      const finalSrc = rewriteRelative(src, repoBase, true);
      return <img {...rest} src={finalSrc} alt={alt} loading="lazy" />;
    },
  };

  return (
    <div className={className}>
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={componentsOverride}
      >
        {source}
      </Markdown>
    </div>
  );
}
