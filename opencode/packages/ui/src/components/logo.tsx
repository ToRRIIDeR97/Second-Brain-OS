import { type ComponentProps } from "solid-js"

// Tenon Workbench mark on a 120-unit grid: the right half's two tabs sit in matching slots in the left half.
const MarkShapes = () => (
  <>
    <rect width="120" height="120" rx="32" fill="var(--v2-background-bg-accent, #3b5cf6)" />
    <path
      d="M58 28H44a18 18 0 0 0-18 18v24a18 18 0 0 0 18 18h14V79.5H47a8.5 8.5 0 0 1 0-17H58V53.5H51a8.5 8.5 0 0 1 0-17H58z"
      fill="#ffffff"
    />
    <path
      d="M64 34h12a18 18 0 0 1 18 18v22a18 18 0 0 1-18 18H64V75H47a4 4 0 0 1 0-8H64V49H51a4 4 0 0 1 0-8H64z"
      fill="#ffffff"
      opacity=".6"
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
