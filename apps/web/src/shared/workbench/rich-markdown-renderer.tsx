import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  detectCodeLinkReference,
  extractStandaloneMedia,
  flattenReactText,
  isProxyResourceUrl,
  RenderableCodeBlock,
  resolveRenderableResourceUrl,
  type RenderableMarkdownProps,
} from "./renderable-content";

export function RichMarkdownRenderer(props: RenderableMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => resolveRenderableResourceUrl(url, props.cwd)}
      components={{
        h1: ({ children }) => <h1 className="content-heading content-heading--1">{children}</h1>,
        h2: ({ children }) => <h2 className="content-heading content-heading--2">{children}</h2>,
        h3: ({ children }) => <h3 className="content-heading content-heading--3">{children}</h3>,
        h4: ({ children }) => <h4 className="content-heading content-heading--4">{children}</h4>,
        p: ({ node, children }) => {
          const descriptor = extractStandaloneMedia(node, children, props.cwd);
          if (descriptor) {
            return (
              <RenderableMedia
                descriptor={descriptor}
                onImageActivate={props.onImageActivate}
              />
            );
          }

          return <p className="content-paragraph">{children}</p>;
        },
        ul: ({ children }) => <ul className="content-list content-list--unordered">{children}</ul>,
        ol: ({ children }) => <ol className="content-list content-list--ordered">{children}</ol>,
        li: ({ children }) => <li className="content-list__item">{children}</li>,
        blockquote: ({ children }) => <blockquote className="content-quote">{children}</blockquote>,
        img: ({ src, alt }) => {
          const resolved = resolveRenderableResourceUrl(String(src ?? ""), props.cwd);
          if (!resolved) {
            return null;
          }

          if (props.onImageActivate) {
            return (
              <button
                type="button"
                className="renderable-image-trigger"
                onClick={() =>
                  props.onImageActivate?.({
                    src: resolved,
                    alt: alt ?? null,
                    label: alt ?? null,
                  })
                }
              >
                <img
                  className="renderable-inline-image"
                  src={resolved}
                  alt={alt ?? ""}
                  loading="lazy"
                />
              </button>
            );
          }

          return (
            <img className="renderable-inline-image" src={resolved} alt={alt ?? ""} loading="lazy" />
          );
        },
        a: ({ href, children }) => {
          const resolved = resolveRenderableResourceUrl(String(href ?? ""), props.cwd);
          const isLocal = isProxyResourceUrl(resolved);
          const codeLink = detectCodeLinkReference(String(href ?? ""), props.cwd);
          const label = flattenReactText(children).trim();

          return (
            <a
              href={resolved}
              target={isLocal ? "_self" : "_blank"}
              rel="noreferrer"
              onClick={(event) => {
                if (!codeLink || !props.onCodeLinkActivate) {
                  return;
                }

                event.preventDefault();
                props.onCodeLinkActivate({
                  ...codeLink,
                  label: label || codeLink.label,
                });
              }}
            >
              {children}
            </a>
          );
        },
        code: (({ className, children, ...rest }: any) => {
          const inline = !className && !String(children ?? "").includes("\n");
          if (inline) {
            return <code className="code-inline">{children}</code>;
          }

          const language = className?.replace(/^language-/, "") ?? "";
          const value = flattenReactText(children).replace(/\n$/, "");
          return <RenderableCodeBlock value={value} language={language} {...rest} />;
        }) as any,
        pre: ({ children }) => <>{children}</>,
      }}
    >
      {props.text}
    </ReactMarkdown>
  );
}

function RenderableMedia({
  descriptor,
  onImageActivate,
}: {
  descriptor: ReturnType<typeof extractStandaloneMedia>;
  onImageActivate?: RenderableMarkdownProps["onImageActivate"];
}) {
  if (!descriptor) {
    return null;
  }

  const imagePreview = {
    src: descriptor.src,
    alt: descriptor.alt ?? null,
    label: descriptor.label ?? null,
  };

  return (
    <figure className={`renderable-media renderable-media--${descriptor.kind}`}>
      {descriptor.kind === "image" ? (
        onImageActivate ? (
          <button
            type="button"
            className="renderable-image-trigger"
            onClick={() => onImageActivate(imagePreview)}
          >
            <img src={descriptor.src} alt={descriptor.alt ?? ""} loading="lazy" />
          </button>
        ) : (
          <img src={descriptor.src} alt={descriptor.alt ?? ""} loading="lazy" />
        )
      ) : null}
      {descriptor.kind === "audio" ? <audio controls preload="metadata" src={descriptor.src} /> : null}
      {descriptor.kind === "video" ? <video controls preload="metadata" src={descriptor.src} /> : null}
      {descriptor.label && descriptor.label !== descriptor.src ? (
        <figcaption>{descriptor.label}</figcaption>
      ) : null}
    </figure>
  );
}
