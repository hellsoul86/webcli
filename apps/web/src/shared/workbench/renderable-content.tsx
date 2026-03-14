import { Fragment, lazy, memo, Suspense } from "react";

export type RenderableMarkdownProps = {
  text: string;
  cwd?: string | null;
  compact?: boolean;
  onCodeLinkActivate?: (reference: CodeLinkReference) => void;
  onImageActivate?: (image: ImagePreviewReference) => void;
};

export type CodeLinkReference = {
  path: string;
  line: number | null;
  column: number | null;
  href: string;
  resolvedHref: string;
  label: string | null;
};

export type ImagePreviewReference = {
  src: string;
  alt: string | null;
  label: string | null;
};

type MediaKind = "image" | "audio" | "video";

type MediaDescriptor = {
  kind: MediaKind;
  src: string;
  alt?: string | null;
  label?: string | null;
};

const LazyRichMarkdownRenderer = lazy(() =>
  import("./rich-markdown-renderer").then((module) => ({
    default: module.RichMarkdownRenderer,
  })),
);

const RICH_MARKDOWN_PATTERNS = [
  /(^|\n)#{1,6}\s/m,
  /(^|\n)\s*[-*+]\s/m,
  /(^|\n)\s*\d+\.\s/m,
  /(^|\n)\s*>\s/m,
  /```|~~~/,
  /!\[[^\]]*\]\(([^)]+)\)/,
  /\[[^\]]+\]\(([^)]+)\)/,
  /`[^`\n]+`/,
  /\|.+\|/,
];

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".avif",
]);

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".m4a",
  ".aac",
  ".flac",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
]);

const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".lua",
  ".mjs",
  ".md",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export const RenderableMarkdown = memo(function RenderableMarkdown(props: RenderableMarkdownProps) {
  const normalizedText = props.text.trim();
  if (!normalizedText) {
    return null;
  }

  const useRichMarkdown = shouldUseRichMarkdown(normalizedText, props.cwd);

  return (
    <div className={props.compact ? "stream-markdown stream-markdown--compact" : "stream-markdown"}>
      {useRichMarkdown ? (
        <Suspense fallback={<PlainTextContent text={normalizedText} />}>
          <LazyRichMarkdownRenderer {...props} />
        </Suspense>
      ) : (
        <PlainTextContent text={normalizedText} />
      )}
    </div>
  );
});

function PlainTextContent(props: { text: string }) {
  const blocks = props.text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <>
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n");
        return (
          <p key={`${blockIndex}-${block}`} className="content-paragraph">
            {lines.map((line, lineIndex) => (
              <Fragment key={`${lineIndex}-${line}`}>
                {lineIndex > 0 ? <br /> : null}
                {line}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

type RenderableCodeBlockProps = {
  value: string;
  language?: string | null;
};

export function RenderableCodeBlock(props: RenderableCodeBlockProps) {
  const value = props.value.replace(/\r\n/g, "\n");
  const language = props.language?.trim().toLowerCase() ?? "";
  const diffLike = isDiffLanguage(language) || looksLikeDiff(value);

  if (diffLike) {
    return (
      <pre
        className="renderable-codeblock renderable-codeblock--diff code-block"
        data-language={language || "diff"}
      >
        {value.split("\n").map((line, index) => (
          <span
            key={`${index}-${line}`}
            className={`renderable-codeblock__line ${classifyDiffLine(line)}`}
          >
            {line || " "}
          </span>
        ))}
      </pre>
    );
  }

  return (
    <pre className="renderable-codeblock code-block" data-language={language || undefined}>
      <code className="code-block__content">{value}</code>
    </pre>
  );
}

export function resolveRenderableResourceUrl(value: string, cwd?: string | null): string {
  const trimmed = value.trim().replace(/^<|>$/g, "");
  if (!trimmed) {
    return "";
  }

  if (isWebUrl(trimmed) || trimmed.startsWith("#")) {
    return trimmed;
  }

  if (trimmed.startsWith("/api/resource?")) {
    return trimmed;
  }

  const reference = resolveLocalReference(trimmed, cwd);
  if (reference) {
    return buildProxyResourceUrl(reference.path, reference.line, reference.column);
  }

  return trimmed;
}

export function detectCodeLinkReference(value: string, cwd?: string | null): CodeLinkReference | null {
  const reference = resolveLocalReference(value, cwd);
  if (!reference || !looksLikeCodePath(reference.path)) {
    return null;
  }

  return {
    path: reference.path,
    line: reference.line,
    column: reference.column,
    href: value,
    resolvedHref: buildProxyResourceUrl(reference.path, reference.line, reference.column),
    label: null,
  };
}

export function inferCodeLanguage(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop()?.toLowerCase() ?? "";
  const extension = normalized.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";

  if (fileName === "dockerfile") {
    return "dockerfile";
  }
  if (fileName === "makefile") {
    return "makefile";
  }
  if (fileName.endsWith(".test.ts") || fileName.endsWith(".spec.ts") || extension === ".ts") {
    return "typescript";
  }
  if (fileName.endsWith(".test.tsx") || fileName.endsWith(".spec.tsx") || extension === ".tsx") {
    return "typescript";
  }
  if (extension === ".js" || extension === ".mjs" || extension === ".jsx") {
    return "javascript";
  }
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".md") {
    return "markdown";
  }
  if (extension === ".py") {
    return "python";
  }
  if (extension === ".rs") {
    return "rust";
  }
  if (extension === ".go") {
    return "go";
  }
  if (extension === ".java") {
    return "java";
  }
  if (extension === ".css" || extension === ".scss") {
    return "css";
  }
  if (extension === ".html") {
    return "html";
  }
  if (extension === ".xml") {
    return "xml";
  }
  if (extension === ".yml" || extension === ".yaml") {
    return "yaml";
  }
  if (extension === ".sh") {
    return "shell";
  }
  if (extension === ".sql") {
    return "sql";
  }
  if (extension === ".toml") {
    return "ini";
  }
  if (extension === ".php") {
    return "php";
  }
  if (extension === ".rb") {
    return "ruby";
  }
  if (extension === ".swift") {
    return "swift";
  }
  if (extension === ".kt" || extension === ".kts") {
    return "kotlin";
  }
  if (extension === ".cpp" || extension === ".cc" || extension === ".hpp" || extension === ".h") {
    return "cpp";
  }
  if (extension === ".c") {
    return "c";
  }
  if (extension === ".lua") {
    return "lua";
  }

  return "plaintext";
}

export function detectRenderableMedia(value: string, cwd?: string | null): MediaDescriptor | null {
  const resolved = resolveRenderableResourceUrl(value, cwd);
  if (!resolved) {
    return null;
  }

  const kind = detectMediaKind(value) ?? detectMediaKind(resolved);
  if (!kind) {
    return null;
  }

  return {
    kind,
    src: resolved,
    label: value.trim(),
  };
}

export function extractStandaloneMedia(
  node: any,
  children: unknown,
  cwd?: string | null,
): MediaDescriptor | null {
  const nodeChildren = Array.isArray(node?.children)
    ? node.children.filter((child: any) => !(child?.type === "text" && !String(child.value ?? "").trim()))
    : [];

  if (nodeChildren.length === 1) {
    const child = nodeChildren[0];

    if (child?.type === "text") {
      return detectRenderableMedia(String(child.value ?? ""), cwd);
    }

    if (child?.type === "element" && child.tagName === "img") {
      const src = resolveRenderableResourceUrl(readNodeProperty(child, "src"), cwd);
      return src
        ? {
            kind: "image",
            src,
            alt: readNodeProperty(child, "alt") || null,
            label: readNodeProperty(child, "alt") || null,
          }
        : null;
    }

    if (child?.type === "element" && child.tagName === "a") {
      const href = resolveRenderableResourceUrl(readNodeProperty(child, "href"), cwd);
      const descriptor = detectRenderableMedia(href, cwd);
      if (!descriptor) {
        return null;
      }

      const label = flattenNodeText(child).trim();
      if (label && label !== href && label !== descriptor.src) {
        return null;
      }

      return {
        ...descriptor,
        label: label || href,
      };
    }
  }

  const text = flattenReactText(children).trim();
  return text ? detectRenderableMedia(text, cwd) : null;
}

export function flattenReactText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => flattenReactText(entry)).join("");
  }

  if (value && typeof value === "object" && "props" in value) {
    return flattenReactText((value as { props?: { children?: unknown } }).props?.children);
  }

  return "";
}

function flattenNodeText(node: any): string {
  const children = Array.isArray(node?.children) ? node.children : [];
  return children
    .map((child: any) => {
      if (child?.type === "text") {
        return String(child.value ?? "");
      }
      if (child?.type === "element") {
        return flattenNodeText(child);
      }
      return "";
    })
    .join("");
}

function readNodeProperty(node: any, key: string): string {
  const value = node?.properties?.[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.join(" ");
  }
  return "";
}

function isWebUrl(value: string): boolean {
  return /^(https?:|data:|blob:|mailto:|tel:)/i.test(value);
}

export function isProxyResourceUrl(value: string): boolean {
  return value.startsWith("/api/resource?");
}

function shouldUseRichMarkdown(text: string, cwd?: string | null): boolean {
  if (RICH_MARKDOWN_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (/(https?:\/\/|data:image\/|data:audio\/|data:video\/|mailto:|tel:)/i.test(text)) {
    return true;
  }

  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .some((block) => Boolean(detectRenderableMedia(block, cwd)));
}

function buildProxyResourceUrl(path: string, line?: number | null, column?: number | null): string {
  const hash =
    typeof line === "number" && Number.isFinite(line)
      ? `#L${line}${typeof column === "number" && Number.isFinite(column) ? `C${column}` : ""}`
      : "";
  return `/api/resource?path=${encodeURIComponent(path)}${hash}`;
}

function looksLikeCodePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop()?.toLowerCase() ?? "";
  const extension = normalized.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
  return fileName === "dockerfile" || fileName === "makefile" || CODE_EXTENSIONS.has(extension);
}

function resolveLocalReference(
  value: string,
  cwd?: string | null,
): { path: string; line: number | null; column: number | null } | null {
  const trimmed = value.trim().replace(/^<|>$/g, "");
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/api/resource?")) {
    const parsed = parseProxyResourceUrl(trimmed);
    if (!parsed) {
      return null;
    }

    return {
      path: parsed.path,
      line: parsed.line,
      column: parsed.column,
    };
  }

  const hashIndex = trimmed.indexOf("#");
  const rawBase = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const rawHash = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : "";
  const suffix = parseInlineLineSuffix(rawBase);
  const localPath = resolveLocalResourcePath(suffix.path, cwd);
  if (!localPath) {
    return null;
  }

  const hashPosition = parseHashPosition(rawHash);
  return {
    path: localPath,
    line: suffix.line ?? hashPosition.line,
    column: suffix.column ?? hashPosition.column,
  };
}

function parseProxyResourceUrl(
  value: string,
): { path: string; line: number | null; column: number | null } | null {
  try {
    const url = new URL(value, "http://localhost");
    const path = url.searchParams.get("path");
    if (!path) {
      return null;
    }

    const position = parseHashPosition(url.hash.replace(/^#/, ""));
    return {
      path,
      line: position.line,
      column: position.column,
    };
  } catch {
    return null;
  }
}

function parseInlineLineSuffix(
  value: string,
): { path: string; line: number | null; column: number | null } {
  const match = value.match(/^(.*\.[A-Za-z0-9_-]+):(\d+)(?::(\d+))?$/);
  if (!match) {
    return {
      path: value,
      line: null,
      column: null,
    };
  }

  return {
    path: match[1] ?? value,
    line: Number.parseInt(match[2] ?? "", 10) || null,
    column: match[3] ? Number.parseInt(match[3], 10) || null : null,
  };
}

function parseHashPosition(hash: string): { line: number | null; column: number | null } {
  const match = hash.match(/^L(\d+)(?:C(\d+))?/i);
  return {
    line: match?.[1] ? Number.parseInt(match[1], 10) || null : null,
    column: match?.[2] ? Number.parseInt(match[2], 10) || null : null,
  };
}

function isDiffLanguage(value: string): boolean {
  return value === "diff" || value === "patch";
}

function looksLikeDiff(value: string): boolean {
  const lines = value.split("\n");
  return lines.some((line) =>
    line.startsWith("diff --git ") ||
    line.startsWith("@@") ||
    line.startsWith("+++ ") ||
    line.startsWith("--- "),
  );
}

function classifyDiffLine(value: string): string {
  if (value.startsWith("+++ ") || value.startsWith("--- ") || value.startsWith("@@") || value.startsWith("diff --git ")) {
    return "renderable-codeblock__line--meta";
  }
  if (value.startsWith("+")) {
    return "renderable-codeblock__line--insert";
  }
  if (value.startsWith("-")) {
    return "renderable-codeblock__line--delete";
  }
  return "renderable-codeblock__line--plain";
}

function resolveLocalResourcePath(value: string, cwd?: string | null): string | null {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("~/")) {
    return normalized;
  }

  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/Users/") || normalized.startsWith("/home/")) {
    return normalized;
  }

  if ((normalized.startsWith("./") || normalized.startsWith("../")) && cwd) {
    return joinPosixPath(cwd, normalized);
  }

  if (
    cwd &&
    !normalized.startsWith("/") &&
    !normalized.startsWith("#") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(normalized)
  ) {
    return joinPosixPath(cwd, normalized);
  }

  return null;
}

function detectMediaKind(value: string): MediaKind | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^data:image\//i.test(trimmed)) {
    return "image";
  }
  if (/^data:audio\//i.test(trimmed)) {
    return "audio";
  }
  if (/^data:video\//i.test(trimmed)) {
    return "video";
  }

  const pathname = trimmed.replace(/^\/api\/resource\?path=/, "").split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  const extension = pathname.match(/\.[a-z0-9]+$/)?.[0] ?? "";

  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  return null;
}

function joinPosixPath(base: string, relative: string): string {
  const stack = base.replace(/\\/g, "/").split("/");
  const parts = relative.replace(/\\/g, "/").split("/");

  if (stack[stack.length - 1] === "") {
    stack.pop();
  }

  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }
    stack.push(part);
  }

  return stack.join("/") || "/";
}
