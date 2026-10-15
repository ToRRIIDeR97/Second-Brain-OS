import { type ComponentProps } from "solid-js"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      role="img"
      aria-label="Tenon Workbench"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <text
        x="0"
        y="104"
        textLength="720"
        lengthAdjust="spacingAndGlyphs"
        font-size="104"
        font-weight="600"
        fill="currentColor"
        opacity="0.1"
      >
        Tenon Workbench
      </text>
    </svg>
  )
}
