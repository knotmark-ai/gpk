# Claude Code harness mapping

Status: packaging and read-only foundation only; workflow execution is not implemented.

The canonical plugin is the Claude Code package. Active Skills use relative links
to shared resources within this package; files outside the package are not runtime
dependencies.

The [Agent Harness contract](../../../contracts/adapters.md#5-agent-harness-adapter)
defines the intended interface. Current packaging exposes only the read-only GPK
Skill; reserved workflow definitions are not discoverable Skills.

At invocation, use only tools and authorized context actually available in the
current session. Do not infer backend access from installed plugin names or from
a different client's connection. Conversation readers, timed execution, and
runtime context assembly remain unimplemented; do not claim these capabilities
from packaging support alone. Domain facts belong in the Knowledge Backend and
user configuration belongs in the selected User Control store, not this adapter.
