# IHME GBD population context

Optional MCP connector for IHME Global Burden of Disease **population**
estimates. It is not a statement about a person. Wearable summaries and genome
rows never go on the MCP wire.

## Client

GBD is the entry `gbd` in the MCP server registry (`packages/mcp-client/registry.ts`:
transport `http`, locality `remote`, URL from `GBD_MCP_URL`). `packages/gbd-mcp/client.ts`
only binds that entry and the env to the generic JSON-RPC client in
`packages/mcp-client/http-client.ts`. `permitServerForDataMode` refuses a `remote` entry
in `DATA_MODE=personal`; the GBD chat tool is still registered in both modes, because
its questions carry population fields only.

## Status

`GET /api/gbd/status` returns:

- `{ configured: false }` when `GBD_MCP_URL` or `GBD_MCP_TOKEN` is unset
- `{ configured: true, state: "ok", tools: [...] }` — **names only**
- `{ configured: true, state: "error" }` when `tools/list` fails

The Connectors card shows those three states. It never shows schemas, results,
or the token.

## Chat tool

The model sees `gbd_population` with a closed enum input. If the live MCP tool
is free-text `gbd_query`, the host composes a fixed question from those fields.
Every call is audited as `gbd.gbd_query` with structured args and
`subject_ref` null.

Attribution in the explainability panel:

`Population estimate (IHME GBD 2021), not a statement about this person.`

## Live smoke

`RUN_LIVE=1 bun test packages/gbd-mcp/live.test.ts`

Requires `GBD_MCP_URL` and `GBD_MCP_TOKEN` in the local environment. The token
is never logged.
