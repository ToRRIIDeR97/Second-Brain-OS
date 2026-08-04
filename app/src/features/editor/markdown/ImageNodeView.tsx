import { useEffect, useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";

export type LocalImageResolver = (
  source: string,
) => Promise<string | undefined>;

type ImageNodeViewProps = ReactNodeViewProps & {
  resolveLocalImage: LocalImageResolver;
};

function isLocalSource(source: string): boolean {
  return !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source);
}

export function LocalImageNodeView({
  node,
  resolveLocalImage,
}: ImageNodeViewProps) {
  const source = typeof node.attrs.src === "string" ? node.attrs.src : "";
  const [resolved, setResolved] = useState<{
    source: string;
    value?: string;
  }>({ source });
  const resolvedSource =
    resolved.source === source ? (resolved.value ?? source) : source;

  useEffect(() => {
    let active = true;
    if (!source || !isLocalSource(source)) return () => undefined;

    void resolveLocalImage(source)
      .then((resolvedSource) => {
        if (!active) return;
        setResolved(
          resolvedSource === undefined
            ? { source }
            : { source, value: resolvedSource },
        );
      })
      .catch(() => {
        // Keep the relative source visible when the optional resolver fails.
      });

    return () => {
      active = false;
    };
  }, [resolveLocalImage, source]);

  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const title =
    typeof node.attrs.title === "string" ? node.attrs.title : undefined;
  const width =
    typeof node.attrs.width === "number" || typeof node.attrs.width === "string"
      ? node.attrs.width
      : undefined;
  const height =
    typeof node.attrs.height === "number" ||
    typeof node.attrs.height === "string"
      ? node.attrs.height
      : undefined;

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-image-source={source}
    >
      <img
        src={resolvedSource}
        alt={alt}
        {...(title === undefined ? {} : { title })}
        {...(width === undefined ? {} : { width })}
        {...(height === undefined ? {} : { height })}
      />
    </NodeViewWrapper>
  );
}
