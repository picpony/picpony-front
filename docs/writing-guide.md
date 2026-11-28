# Documentation standard

This standard applies to technical documentation and documentation references in source comments. The project README and its artwork retain their existing language and presentation.

## Language and terminology

Write technical headings, prose, captions, diagram labels and examples in English. Chinese is reserved for PicPony-specific names and exact literals in the [UI copy contract](design/typography-and-copy.md#copy). Describe ordinary controls, states and operations in English.

- Keep identifiers, protocol fields and filenames exactly as implemented.
- Put literal UI strings in code spans; do not use them as explanatory prose.
- Product screenshots retain the site's actual interface language.
- Use one term for one concept. Name the component, resource or setting instead of inventing a synonym.
- Use must/must not for requirements, should for defaults and may for options.
- Distinguish Material 3 requirements from explicit PicPony refinements.

## Ownership

| Location | Responsibility |
| --- | --- |
| [Project README](../README.md) | Product overview, setup, configuration and deployment |
| [AGENTS.md](../AGENTS.md) | Global constraints, required checks and topic routing |
| [CLAUDE.md](../CLAUDE.md) | Import AGENTS.md without duplicating its rules |
| [Documentation index](README.md) | Current topic navigation |
| Topic document | Its contracts, interfaces, procedures and verification |
| [Asset provenance](../public/companions/ORIGIN.md) | Sources, modifications, attribution and licence boundaries |

Define each rule fully in one owning document. Elsewhere, link to it with only the context the reader needs. Update the index when adding a topic and AGENTS.md when it changes required reading.

## Content

- State the rule or action first. Add a reason only when it prevents a likely mistake.
- Document current behaviour and supported inputs. Remove obsolete APIs, investigation diaries, redundant warnings and superseded measurements.
- Keep compatibility behaviour that the implementation still supports; explain its contract without recounting its history.
- Preserve material exceptions, security boundaries and known limitations.
- Keep a measurement only when it supports a decision. Include its build, environment, sampling method and reproduction command.
- Mark unverified claims clearly. Documentation cleanup must not invent product requirements.

## Structure and formatting

Use one level-one title per standalone document. Open with its scope in one or two sentences. Use short descriptive headings at levels two and three without skipping levels.

```markdown
# Topic

Scope and links to related topics.

## Contract

Required behaviour, interfaces and exceptions.

## Procedure

Ordered steps and executable commands.

## Verification

Prerequisites, checks and expected results.
```

Use only the sections the topic needs. Use bullets for independent rules, numbers for sequences and tables for comparisons. Keep paragraphs focused and table cells short.

Do not use bold paragraphs as substitute headings, duplicate local tables of contents, or append empty checklists. README may use product images and minimal presentation HTML. Import-only files, generated blocks and licence notices keep their required formats.

## References and examples

- Markdown links are relative to the containing document and target existing files and headings.
- Source comments use repository-relative document paths with the current section anchor.
- Rename a section and update every incoming reference in the same change. Remove obsolete indexes and aliases; do not add compatibility anchors or section-name crosswalks.
- Keep machine paths, temporary logs and unowned repository paths out of documentation.
- Run examples from the repository root unless another directory is stated. Use `bun run <script>` and verify the script in `package.json`.
- Label fenced code blocks. Keep executable examples free of placeholder commands and omitted steps.
- Name the shell for environment-variable syntax.
- Use ISO dates and explicit units. Do not invent missing date precision.
- Read the installed framework documentation before making a version-dependent claim. Keep Next.js managed instructions synchronized through its installed generator.

## Verification

1. Check changed paths, fields, commands and behaviour against source or tests.
2. Update the owning document, index and source references.
3. Check English prose, links, anchors, heading levels, tables and code fences.
4. Run `bun run format:check` and `git diff --check`; include new files in whitespace checks.
5. Verify diagrams after changing their text.
6. Run `bun run check` before a commit. Documentation-only changes do not require an application build or browser regression.

Use UTF-8 without a BOM, respect Git's line-ending rules, remove trailing spaces and keep one final newline. Report only checks that actually ran.
