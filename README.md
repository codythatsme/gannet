# Gannet

[![CI](https://github.com/codythatsme/gannet/actions/workflows/ci.yml/badge.svg)](https://github.com/codythatsme/gannet/actions/workflows/ci.yml)

A fast, keyboard-first issue tracker that uses **Jira Cloud as its backend**. It ships as a Chrome extension.

Gannet doesn't reskin Jira. It's its own app, designed in the Linear tradition (dense lists, a command menu, single-key shortcuts, instant edits), and it reads and writes your Jira data through the REST API. Anything Gannet doesn't do, Jira still does; every issue has an "Open in Jira" escape hatch.

## Install

1. Download the latest **gannet-v*.zip** from [Releases](https://github.com/codythatsme/gannet/releases/latest) and unzip it somewhere permanent. Chrome loads the extension from that folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the unzipped folder (the one containing `manifest.json`).
3. Click the Gannet toolbar icon (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>).
4. Enter your site (`acme.atlassian.net`). If you're logged in to Jira in this browser, that's it. Otherwise use an [API token](https://id.atlassian.com/manage-profile/security/api-tokens).
5. Pick the Jira projects you work in. Each one becomes a team.

To update, unzip the new release over the same folder and click reload on Gannet's card in `chrome://extensions`.

To build it yourself instead, run `npm install && npm run build` and load `dist/`.

**No Jira handy?** Choose "Try with demo data" in onboarding, or run `npm run dev` and open the page it prints. Demo mode runs against an in-memory fake Jira (`src/jira/mock`) that goes through the same API paths and mapping code as a real site.

## How Jira maps onto Gannet

| Gannet | Jira |
|---|---|
| Team | Project |
| Issue | Issue (standard and sub-task types) |
| Sub-issue | Sub-task (child of a standard issue) |
| Project | Epic (hierarchy level 1). An epic's children are the project's issues |
| Cycle | Sprint on the project's scrum board |
| Status type: Backlog / Todo / In progress / Done / Canceled | Status category (To Do / In Progress / Done) plus the status name. For example, "Won't Do" counts as Canceled. You can override per status in Settings → Workflow mapping |
| Priority: Urgent / High / Medium / Low | Jira priorities, matched by name (Highest, Blocker, P0…) or by position in the list |
| Estimate | The board's estimation field, otherwise "Story Points" / "Story point estimate" |
| Labels | Labels |
| Status change | Workflow transition. Gannet finds the transition into the target status. Targets the workflow doesn't allow are greyed out |
| Description and comments | Atlassian Document Format. Rendered natively and edited as Markdown (see below) |

On a team, **Active** means "in progress, or to do in the active sprint". **Backlog** means backlog-type statuses plus, for scrum teams, to-do work that isn't in the active sprint.

## Architecture

```
src/
  jira/          REST client (session or token auth, retries), typed endpoints, mock server
  domain/        Gannet's model, Jira → Gannet mapping, JQL builders, pure list logic (filter/group/sort)
  adf/           ADF ↔ Markdown converter (round-trip tested)
  store/         zustand stores: data (normalised, persisted to IndexedDB), sync engine,
                 optimistic mutations, settings, UI state
  components/    list, board, pickers, command palette, create modal, ADF renderer…
  views/         My issues, team issues, cycles, projects, issue detail, settings/onboarding
  app/           shell, hash router, hotkeys, shared actions
  background.ts  service worker: toolbar action, opening tabs, Origin-header rule
  content/       content script on *.atlassian.net: "Open in Gannet" button, optional link redirect
```

**Local-first sync.** On first load, each team syncs every open issue, anything updated in the last 30 days, and all epics. The data is cached in IndexedDB, so later launches render instantly. After that, Gannet pulls deltas every minute and on window focus (`updated >= -Nm`, using relative minutes to dodge JQL's timezone handling), and does a full reconcile every 6 hours to catch deletions. Closed sprints and epic children outside the window load on demand. Text search falls back to Jira's `text ~` when the local cache doesn't have a match.

**Optimistic edits.** Every change applies locally first, goes to Jira, then re-reads the issue. If Jira refuses, the change rolls back and Jira's error message is shown. Issues with an edit in flight are skipped by the sync engine so they don't flicker.

**Auth.** The default "session" mode uses the browser's existing Jira cookies. The extension has host permissions for `*.atlassian.net`, and a `declarativeNetRequest` rule sets the `Origin` header on Gannet's own requests to your site, so Jira's XSRF check passes. Writes also send `X-Atlassian-Token: no-check`. "API token" mode uses Basic auth instead; the token is kept in `chrome.storage.local`.

**Descriptions and comments.** These are edited as Markdown and converted to and from ADF. Mentions round-trip as `[@Name](mention:accountId)` and smart links as `<https://…>`. If a description contains something Markdown can't hold (tables, images, panels, macros), Gannet renders it but sends you to Jira to edit, rather than silently dropping content. Formatting-only losses (like text colour) produce a warning instead.

## Keyboard

Press <kbd>?</kbd> in the app for the full list. The essentials:

| | |
|---|---|
| <kbd>⌘K</kbd> command menu · <kbd>/</kbd> search · <kbd>C</kbd> create | <kbd>G</kbd> <kbd>M</kbd> / <kbd>I</kbd> / <kbd>C</kbd> / <kbd>P</kbd> go to My issues / issues / cycles / projects |
| <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>↵</kbd> open · <kbd>X</kbd> select · <kbd>Esc</kbd> back | <kbd>S</kbd> status · <kbd>P</kbd> priority · <kbd>A</kbd> assign · <kbd>I</kbd> assign to me · <kbd>L</kbd> labels |
| <kbd>F</kbd> filter · <kbd>⌘B</kbd> list/board · <kbd>⇧V</kbd> display options | <kbd>⇧C</kbd> cycle · <kbd>⇧P</kbd> project · <kbd>E</kbd> estimate · <kbd>⇧D</kbd> due date |
| <kbd>⌘.</kbd> copy key · <kbd>⌘⇧.</kbd> copy git branch | <kbd>⇧O</kbd> open in Jira · <kbd>⌘⌫</kbd> delete |

Property shortcuts act on the selected issues, or on the focused one if nothing is selected.

## Development

```sh
npm run dev        # demo mode in a normal tab (real sites need the extension, because of CORS)
npm test           # unit tests, sync engine against the mock, and a jsdom smoke test of every screen
npm run build      # production extension in dist/
npm run package    # zip dist/ into release/gannet-v<version>.zip
npm run icons      # regenerate the PNG icons
```

The content script and service worker are bundled as standalone files and must not import app modules. `scripts/check-build.mjs` fails the build if `content.js` ends up with `import`/`export` statements.

### Releasing

Bump `version` in both `package.json` and `public/manifest.json` (the build fails if they differ), commit, then tag and push:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The [release workflow](.github/workflows/release.yml) tests, builds and zips the extension, and publishes a GitHub release with the zip attached. It refuses to run if the tag doesn't match the manifest version.

## Not done yet

These are in rough priority order:

- **Manual ordering** with drag-and-drop in lists. "Manual" ordering currently reads Jira's rank but can't change it (`PUT /rest/agile/1.0/issue/rank`).
- **Inbox / notifications.** Jira has no public notifications API. The likely approach is watched issues updated since you last looked.
- **Mentions autocomplete** in comments, and **image/attachment** upload and display (needs the media API).
- **Custom fields.** These are hidden for now. Creating an issue fails with Jira's error if a project requires a custom field, and the error is shown.
- **Removing an epic from an issue** sends `parent: null`. This is untested against every project type.
- **Jira Data Center / Server.** Cloud only for now: the API v3 and the enhanced search endpoint are Cloud-specific.
- Saved views backed by Jira filters, issue relations ("blocks", "relates to"), and Firefox support.

## License

MIT
