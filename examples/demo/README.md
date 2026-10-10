# Local interactive demo

This demo runs the real `tools/handoff.mjs` CLI against a deterministic, synthetic agent session.

## Run

From the repository root:

```powershell
node examples/demo/server.mjs
```

Open the localhost URL printed by the server. Stop the server with Ctrl+C.

## What it proves

- Select one of the harness formats supported by the demo.
- Generate a synthetic conversation with assistant messages, tool calls, long tool output, a controlled tool error, and recovery.
- Execute the real local capture CLI.
- Execute the real verification command.
- Read the generated timeline, manifest, full tool log, Markdown handoff, summary payload, and full JSON payload back from temporary storage.
- Inspect and export the resulting synthetic artifacts.
- Switch harnesses and repeat the run.

The demo uses no model API, API key, external service, or internet connection. Browser requests stay on localhost, and the server binds only to `127.0.0.1`. It never reads your own conversations. Each synthetic transcript and handoff store is created under a temporary directory and deleted after the response is prepared.

The DeepSeek Harness option uses the documented canonical JSONL export shape. It does not claim to read a native compressed database directly. The generic adapter is one supported harness ID with two separately selectable input-format scenarios: generic JSONL and plain text.

## Test your own active harness session locally

If your current supported harness exposes its own transcript as a local file, run this from the repository root and pass the exact file that belongs to the session you want to test:

```powershell
node examples/demo/self-test.mjs --source "<your-local-transcript-file>" --harness codex
```

Replace `codex` with the matching supported harness ID. The self-test reads only the path you supply, runs capture and verification in a temporary store, prints only pass/fail and event counts, does not print the source path or transcript text, does not upload anything, does not delete the source file, and deletes its temporary capture store after the report is prepared. Do not point it at another person's session. A ChatGPT web chat is not automatically available as a local harness transcript, so this command does not export this chat.

## Boundaries

This is a local executable demo, not a static GitHub Pages application. A browser-only page cannot execute a local CLI safely. The public documentation can link to these instructions, but the real capture proof happens in the local server process.

The interface deliberately does not display a product version number.
