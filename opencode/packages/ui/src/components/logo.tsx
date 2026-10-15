import { type ComponentProps } from "solid-js"

// Tenon Workbench mark: two interlocking halves on a rounded tile, drawn on a 120-unit grid.
const MarkShapes = () => (
  <>
    <rect width="120" height="120" rx="32" fill="var(--v2-background-bg-accent, #3b5cf6)" />
    <path d="M58 28H44a18 18 0 0 0-18 18v24a18 18 0 0 0 18 18h14z" fill="#ffffff" />
    <path d="M64 34h12a18 18 0 0 1 18 18v22a18 18 0 0 1-18 18H64z" fill="#ffffff" opacity=".6" />
    <path
      d="M58 49H45M58 67H40M64 63h15"
      stroke="var(--v2-background-bg-accent, #3b5cf6)"
      stroke-width="5"
      stroke-linecap="round"
    />
  </>
)

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <MarkShapes />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <MarkShapes />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      role="img"
      aria-label="Tenon Workbench"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <text
        x="0"
        y="32"
        textLength="234"
        lengthAdjust="spacingAndGlyphs"
        font-size="30"
        font-weight="600"
        fill="var(--icon-strong-base)"
      >
        Tenon Workbench
      </text>
    </svg>
  )
}
