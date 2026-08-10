import {
  NodeViewContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
} from "@tiptap/react";

const NOTION_CODE_LANGUAGES = [
  ["plain text", "Plain text"],
  ["abap", "ABAP"],
  ["arduino", "Arduino"],
  ["bash", "Bash"],
  ["basic", "BASIC"],
  ["c", "C"],
  ["clojure", "Clojure"],
  ["coffeescript", "CoffeeScript"],
  ["c++", "C++"],
  ["c#", "C#"],
  ["css", "CSS"],
  ["dart", "Dart"],
  ["diff", "Diff"],
  ["docker", "Docker"],
  ["elixir", "Elixir"],
  ["elm", "Elm"],
  ["erlang", "Erlang"],
  ["flow", "Flow"],
  ["fortran", "Fortran"],
  ["f#", "F#"],
  ["gherkin", "Gherkin"],
  ["glsl", "GLSL"],
  ["go", "Go"],
  ["graphql", "GraphQL"],
  ["groovy", "Groovy"],
  ["haskell", "Haskell"],
  ["html", "HTML"],
  ["java", "Java"],
  ["javascript", "JavaScript"],
  ["json", "JSON"],
  ["julia", "Julia"],
  ["kotlin", "Kotlin"],
  ["latex", "LaTeX"],
  ["less", "Less"],
  ["lisp", "Lisp"],
  ["livescript", "LiveScript"],
  ["lua", "Lua"],
  ["makefile", "Makefile"],
  ["markdown", "Markdown"],
  ["markup", "Markup"],
  ["matlab", "MATLAB"],
  ["mermaid", "Mermaid"],
  ["nix", "Nix"],
  ["objective-c", "Objective-C"],
  ["ocaml", "OCaml"],
  ["pascal", "Pascal"],
  ["perl", "Perl"],
  ["php", "PHP"],
  ["powershell", "PowerShell"],
  ["prolog", "Prolog"],
  ["protobuf", "Protocol Buffers"],
  ["python", "Python"],
  ["r", "R"],
  ["reason", "Reason"],
  ["ruby", "Ruby"],
  ["rust", "Rust"],
  ["sass", "Sass"],
  ["scala", "Scala"],
  ["scheme", "Scheme"],
  ["scss", "SCSS"],
  ["shell", "Shell"],
  ["sql", "SQL"],
  ["swift", "Swift"],
  ["typescript", "TypeScript"],
  ["vb.net", "VB.NET"],
  ["verilog", "Verilog"],
  ["vhdl", "VHDL"],
  ["visual basic", "Visual Basic"],
  ["webassembly", "WebAssembly"],
  ["xml", "XML"],
  ["yaml", "YAML"],
  ["java/c/c++/c#", "Java/C/C++/C#"],
] as const;

export function CodeBlockNodeView({
  node,
  updateAttributes,
}: ReactNodeViewProps) {
  const language = String(node.attrs.language ?? "") || "plain text";
  const known = NOTION_CODE_LANGUAGES.some(([value]) => value === language);

  return (
    <NodeViewWrapper className="notion-code-block">
      <div className="notion-code-block-toolbar" contentEditable={false}>
        <select
          aria-label="Code block language"
          value={language}
          onChange={(event) => {
            updateAttributes({ language: event.currentTarget.value });
          }}
        >
          {!known ? <option value={language}>{language}</option> : null}
          {NOTION_CODE_LANGUAGES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
