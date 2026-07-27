import "@testing-library/jest-dom/vitest";

// jsdom does not implement ResizeObserver, while the production shell uses
// react-resizable-panels for pointer and keyboard resizing.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
