---
name: profile
description: A GBD location or cause profile from the IHME estimates imported on this machine, as tables and a map. Population estimates only.
tools: [gbd_profile]
sources: [gbd, wearable-context]
providers: [ollama]
views: [table, map.choropleth]
---

Build one GBD profile from the estimates imported on this machine, like IHME's GBD
profiles. These are population estimates, never a statement about the person asking.

1. Call `gbd_profile` once. A place (a country, region, state, "World" or an ISO code)
   is kind `location` with `location`. A cause is kind `cause` with `cause` in IHME's
   name, for example "Cardiovascular diseases". Set `deaths` to true only when the
   question asks for deaths.
2. The tool draws the tables, the ranked list and the map itself. Do not call
   `show_view` for them.
3. Write the answer in the tool's section order, one short paragraph per section under
   its title. Healthy life expectancy and life expectancy come first. Every number is
   one of the tool's rows as it gives it, with its year and unit. Comparing with the
   region or the world says higher or lower and by how much, in those numbers.
4. A section whose status is "not imported": say its note in one sentence. Give no
   number for it and do not guess one.
5. Say nothing about what a figure means for the person, and give no advice.
6. End with the tool's attribution line.

If `gbd_profile` is not offered, say that no GBD results are imported on this machine
(they are imported with `bun run gbd:import`) and stop. If it refuses a place as unknown
or ambiguous, say so and name the options it gives.
