# Documentation

Start with the [project README](../README.md) for setup and deployment. Read [AGENTS.md](../AGENTS.md) before changing the repository and follow the [documentation standard](writing-guide.md) when editing documentation.

## Architecture and engineering

| Document | Scope |
| --- | --- |
| [Architecture](architecture-guide.md) | Data flow, module ownership, change entry points and deployment |
| [Module boundaries](module-boundaries.md) | Dependency directions, lazy loading and shared state |
| [Dependencies](dependencies.md) | Version constraints, Bun patches and security updates |
| [Performance](performance.md) | React Compiler, production bundles and measurement tools |
| [CSS verification](css-traps.md) | Emitted CSS and rendered geometry |
| [Documentation standard](writing-guide.md) | Language, ownership, structure, references and verification |

## Design system

| Document | Scope |
| --- | --- |
| [Primitives](design/primitives.md) | Component selection, composition, loading, keyboard and focus |
| [Colour](design/colour.md) | Palettes, tokens, contrast, focus and forced colours |
| [Surfaces](design/surfaces.md) | Shape, elevation, stacking and state layers |
| [Typography and copy](design/typography-and-copy.md) | Type roles, rich text and literal UI copy |
| [Layout](design/layout.md) | Columns, spacing, control heights and icon sizes |

## Motion and navigation

| Document | Scope |
| --- | --- |
| [Motion system](motion-system.md) | Spring roles, tiers, speeds, categories and lifecycle |
| [Component motion](motion.md) | Per-component role assignments |
| [Transitions](transitions.md) | Routes, tabs, container transforms, Back and picture stepping |
| [Hero engine](hero.md) | Shared-element flight, gestures, handoff and recovery |
| [Scrolling](scrolling.md) | Scroll ownership, paging, image delivery and sharpness |
| [Companions](companions.md) | Mascot and desktop pony runtime contracts |

## Data and runtime

| Document | Scope |
| --- | --- |
| [Backend API](backend-api.md) | Rust protocol, sessions, transport and the same-origin proxy |
| [Data requests](data-requests.md) | Resources, caching, SSR, prefetch and settings synchronization |
| [Request lines](request-lines.md) | API/image routing, maintenance, relay and response boundaries |
| [Offline and PWA](offline.md) | Service Worker, offline navigation, installation and updates |
| [Asset provenance](../public/companions/ORIGIN.md) | Companion asset sources and licence boundaries |
