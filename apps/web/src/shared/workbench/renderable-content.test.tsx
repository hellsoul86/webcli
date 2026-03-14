import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  detectCodeLinkReference,
  inferCodeLanguage,
  RenderableCodeBlock,
  RenderableMarkdown,
  detectRenderableMedia,
  resolveRenderableResourceUrl,
} from "./renderable-content";

describe("renderable content", () => {
  it("renders markdown structure", async () => {
    render(<RenderableMarkdown text={"**Bold**\n\n- one\n- two"} />);

    await waitFor(() => {
      expect(screen.getByText("Bold").tagName).toBe("STRONG");
      expect(screen.getByText("one").tagName).toBe("LI");
      expect(screen.getByText("two").tagName).toBe("LI");
    });
  });

  it("rewrites local file paths through the resource proxy", () => {
    expect(resolveRenderableResourceUrl("./diagram.png", "/Users/roy/Developments/webcli")).toBe(
      "/api/resource?path=%2FUsers%2Froy%2FDevelopments%2Fwebcli%2Fdiagram.png",
    );
  });

  it("renders standalone local images and remote audio resources", async () => {
    const { container } = render(
      <div>
        <RenderableMarkdown
          text={"![](/Users/roy/Pictures/demo.png)\n\nhttps://example.com/sample.mp3"}
          cwd="/Users/roy/Developments/webcli"
        />
      </div>,
    );

    await waitFor(() => {
      const image = container.querySelector("img");
      expect(image).not.toBeNull();
      expect(image).toHaveAttribute(
        "src",
        "/api/resource?path=%2FUsers%2Froy%2FPictures%2Fdemo.png",
      );

      const audio = container.querySelector("audio");
      expect(audio).not.toBeNull();
      expect(audio).toHaveAttribute("src", "https://example.com/sample.mp3");
    });
  });

  it("activates image preview when clicking a rendered image", async () => {
    const onImageActivate = vi.fn();
    const { container } = render(
      <RenderableMarkdown
        text={"![](/Users/roy/Pictures/demo.png)"}
        onImageActivate={onImageActivate}
      />,
    );

    const image = await waitFor(() => {
      const current = container.querySelector("img");
      expect(current).not.toBeNull();
      return current as HTMLImageElement;
    });
    fireEvent.click(image);
    expect(onImageActivate).toHaveBeenCalledWith({
      src: "/api/resource?path=%2FUsers%2Froy%2FPictures%2Fdemo.png",
      alt: null,
      label: null,
    });
  });

  it("detects renderable media kinds", () => {
    expect(detectRenderableMedia("https://example.com/image.webp")?.kind).toBe("image");
    expect(detectRenderableMedia("https://example.com/voice.wav")?.kind).toBe("audio");
  });

  it("detects local code links and preserves line anchors", () => {
    expect(detectCodeLinkReference("/Users/roy/Developments/webcli/apps/web/src/App.tsx#L12")).toEqual({
      path: "/Users/roy/Developments/webcli/apps/web/src/App.tsx",
      line: 12,
      column: null,
      href: "/Users/roy/Developments/webcli/apps/web/src/App.tsx#L12",
      resolvedHref:
        "/api/resource?path=%2FUsers%2Froy%2FDevelopments%2Fwebcli%2Fapps%2Fweb%2Fsrc%2FApp.tsx#L12",
      label: null,
    });
  });

  it("infers syntax languages from code file paths", () => {
    expect(inferCodeLanguage("/Users/roy/Developments/webcli/apps/web/src/App.tsx")).toBe(
      "typescript",
    );
    expect(inferCodeLanguage("/Users/roy/Developments/webcli/package.json")).toBe("json");
    expect(inferCodeLanguage("/Users/roy/Developments/webcli/Dockerfile")).toBe("dockerfile");
  });

  it("renders diff blocks with insert and delete line colors", () => {
    const { container } = render(
      <RenderableCodeBlock value={"diff --git a/a b/a\n+added line\n-deleted line"} language="diff" />,
    );

    expect(container.querySelector(".renderable-codeblock__line--meta")).not.toBeNull();
    expect(container.querySelector(".renderable-codeblock__line--insert")).not.toBeNull();
    expect(container.querySelector(".renderable-codeblock__line--delete")).not.toBeNull();
  });
});
