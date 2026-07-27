# Contract examples

`valid/` contains one or more payloads that must validate against the matching
definition in [`../../docs/contracts/schema-v1.json`](../../docs/contracts/schema-v1.json).
`invalid/` contains deliberately rejected payloads; each filename states the
invariant it violates.

The corpus is dependency-free JSON. A local validation check can use the
already-available Python `jsonschema` package without adding a product
dependency:

```sh
python3 -c '
import json, pathlib
from jsonschema import Draft202012Validator, FormatChecker
root = pathlib.Path("docs/contracts/schema-v1.json")
schema = json.loads(root.read_text())
for group, should_pass in (("valid", True), ("invalid", False)):
    for path in sorted(pathlib.Path("fixtures/contracts", group).glob("*.json")):
        value = json.loads(path.read_text())
        errors = list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(value))
        assert (not errors) == should_pass, (path, [e.message for e in errors])
print("contract examples: ok")
'
```

The fixtures are examples, not an authorization bypass. Runtime code must still
apply workspace policy, hard denies, approval rules, redaction, and bounded
output after structural validation.
