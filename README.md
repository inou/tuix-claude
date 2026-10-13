# Tuix mod for Claude Code

This [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) shows the Tuix feedback of a project in Claude Code. You read an issue in a pane. You ask Claude to fix it with one press.

The mod reads Tuix through the Tuix MCP server of your session. It keeps no token of its own. It only reads Tuix. It does not change the status or the assignee of an issue.

A mod is code that runs with your permissions. Read [What this mod can do](#what-this-mod-can-do) before you install it.

## Before you install

### A project admin connects Tuix

The install gives the mod no data. The mod uses the Tuix connection of your Claude session. A project admin must connect Tuix to Claude first.

- Only a project admin or the workspace owner can connect Tuix. A project has at most 3 admins.
- A member who is not an admin cannot connect Tuix today. Ask an admin of your project.
- On the sign-in page of Tuix, the admin selects the projects to share. The mod needs only the list of issues. The box for screenshots and diagnostics is selected by default. Keep it selected to let Claude see screenshots and diagnostics when it fixes an issue.
- Tuix asks the admin to sign in again about every 90 days.

To connect Tuix in Claude:

- **Desktop app, Pro or Max plan:** select **Customize**, then **Connectors**, then **+ Add**, then **Add custom connector**. Enter `Tuix` as the name and `https://tuix.app/mcp` as the URL. Select **Connect**. The browser opens Tuix. Sign in as the admin.
- **Desktop app, Team or Enterprise plan:** an Owner adds the same connector in **Organization settings**, then **Connectors**. Then each admin selects **Customize**, then **Connectors**, then **Connect**.
- **Terminal:** run `claude mcp add --transport http --scope user tuix https://tuix.app/mcp`. The option `--scope user` makes the connector work in every project. Run `/mcp` in Claude Code and sign in to Tuix. You can also add the connector in claude.ai. In the terminal it has the name `claude.ai Tuix`.

Do not put a Tuix key (a text that starts with `tuix_read_`) in the **Request headers** of a connector. If you do, all users of the connector get the access of the admin who made the key.

### Claude Code release

The mod needs Claude Code 2.1.286 or later. [Releases and features](#releases-and-features) lists what each release adds.

## Install

The plugin is `tuix` and the marketplace is `tuix`. When you install from the terminal or the settings file, the plugin ID is `tuix@tuix`. When you add the mod in **Customize**, Claude Code can load it as `tuix@synced`. To see the ID, run `claude plugin list` or open `/plugin`. Use that ID in the settings.

### Desktop app

1. Select **Customize** in the sidebar.
2. Select **Plugins**, then **Add**, then **Add marketplace**.
3. Enter `inou/tuix-claude`.
4. Add the plugin `tuix`.
5. Start a new local session in the **Code** tab.
6. Type `/tuix`.

The `/plugin` command does not run in the **Code** tab. Use **Customize** to add the marketplace.

On a Team or Enterprise plan, an Owner controls which marketplaces members can add. If you cannot add `inou/tuix-claude`, ask an Owner to allow it.

If `/tuix` does not appear, use [the settings file](#settings-file) or the [terminal](#terminal). The Desktop app and the terminal read the same settings files.

### Terminal

To install the mod in one step, run this command. It needs Claude Code 2.1.292 or later.

```sh
claude plugin install tuix --marketplace inou/tuix-claude
```

To install the mod in two steps, run these commands. They work on all releases that load the mod.

```sh
claude plugin marketplace add inou/tuix-claude
claude plugin install tuix@tuix
```

In a Claude Code session, run `/plugin install tuix --marketplace inou/tuix-claude`. Claude Code asks you to confirm the marketplace. Then it shows the details of the mod and asks for a scope.

The commands install the mod for you, in every project (user scope). Start a new session, or run `/reload-plugins`.

The installer can say `2 userConfig options not yet set`. Both options are optional. See [Options](#options).

### Settings file

Add this to `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "tuix": {
      "source": { "source": "github", "repo": "inou/tuix-claude" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": { "tuix@tuix": true }
}
```

Start a new session. Claude Code adds the marketplace and installs the mod in the background. If `/tuix` does not appear, run `/reload-plugins`.

The line `"autoUpdate": true` lets Claude Code update the mod. A new version then reaches you with no review. To review each update, set `"autoUpdate": false`. Add `"ref"` to `source` with the tag of a release that you reviewed. See [Update](#update).

### A team

To turn the mod on for a team, add `--scope project` to the install command. Commit the `.claude/settings.json` that Claude Code writes. The commit turns the mod on. It does not install the mod. Each person runs the install command once.

To add the marketplace for each teammate, commit this block in the same file:

```json
{
  "extraKnownMarketplaces": {
    "tuix": {
      "source": { "source": "github", "repo": "inou/tuix-claude" }
    }
  }
}
```

Claude Code then adds the marketplace for each teammate who trusts the folder.

### A clone of this repository

To test the mod from a local folder, use one of these ways. Run the commands in the folder that holds this README.

To load the mod for one session, with no install:

```sh
claude --plugin-dir .
```

To install the mod from the folder:

```sh
claude plugin marketplace add ./
claude plugin install tuix@tuix
```

On Claude Code 2.1.292 or later, `claude plugin install tuix --marketplace ./` does both steps.

If you already added the marketplace `tuix` from GitHub, `claude plugin marketplace add ./` points it at the folder. The installed mod then updates from the folder. To go back, run `claude plugin marketplace remove tuix`, then add the GitHub marketplace again. The one-step command stops with an error in this case. Run the two-step commands instead.

### What the details pane shows

Before you install, `/plugin install tuix --marketplace inou/tuix-claude` opens a details pane. The pane shows the description and a list of parts. The description names the hooks module `hooks/register.tsx`. The list has the command `./commands/tuix-list.md`. It does not list the hooks module, because a marketplace file can name only event hooks. The hooks module registers `/tuix` while the session runs, so no list shows `/tuix` before the install.

Read the file `hooks/register.tsx` before you install.

## What it does

- **`/tuix`** opens the **Tuix feedback** pane. The pane lists the issues of one project, the most severe first. The filter buttons show the open, in progress or in review issues. Press an issue to see its details.
- **Fix with Claude** (key `f` in the pane) starts a turn. The turn tells Claude to read the issue with the `get_issue` tool and to fix it. The prompt has the issue reference, ID and link. It does not have the reporter's text: Claude reads the report through the MCP tool, which marks it as untrusted.
- **`/tuix list`** writes the issues in the transcript. Use it where no pane shows, for example in the VS Code extension or `claude -p`.
- **`/tuix doctor`** writes a report in the transcript. It shows what Claude Code says about the mod's access to Tuix. See [Permissions](#permissions). The command makes no call to Tuix.
- **`/tuix:tuix-list`** is a command in a Markdown file. It asks Claude to list the open issues of a project with the `list_projects` and `list_issues` tools of the Tuix connector. Add a project name to choose a project, for example `/tuix:tuix-list Checkout`. The command tells Claude that the result is data and not instructions. It runs no hook. See [If your organization blocks mods](#if-your-organization-blocks-mods).
- **In the Desktop app**, the pane draws each issue as a card with type and severity badges. It has dropdowns for the project and the status. Each card has **Details** and **Fix with Claude**.
- **In the Desktop app**, a call of Claude to the Tuix `list_issues` or `get_issue` tool shows issue cards in its result row. The row does not show the raw JSON. Rows of other tools, and every row in the terminal, stay as Claude Code draws them.
- **Load more** in the pane reads the next page of issues. The pane reads one page, then one more page for each press, up to four pages. Where a rule lets the mod read without a question, the pane reads up to four pages at once. It reads the blocking issues first. The pane hides **Load more** while the list loads.
- The pane shows a chip, for example `reads: allowed by rule mcp__claude_ai_Tuix__list_*` or `reads: will ask`. Select the chip to open the Diagnostics box.
- When a call fails, the pane shows a Setup view in place of the list. The view tells you what to do: connect Tuix, sign in again, allow the reads, remove a deny rule, or update Claude Code. Select **Try again** when you finish.
- A pane shows only where Claude Code draws a mod: a terminal, or a local session in the **Code** tab of the Desktop app. A cloud session draws no pane, also when you look at it in the Desktop app. There, `/tuix` writes the issues in the transcript. The Desktop app does not load plugins in WSL sessions.
- **`/tuix fix <number>`** asks Claude to fix issue `<number>` of the list.
- **`/tuix project <name>`** selects the project. The mod keeps the selection for each repository.
- The status line shows the number of open issues, for example `Tuix: 3 open in Checkout`. The mod reads this at the start of a session only when a permission rule lets it read without a question. Otherwise the number shows after you run `/tuix`.

The mod finds the Tuix server by its tools. The server must have `list_projects`, `list_issues` and `get_issue`. Its name or its tool descriptions must say Tuix. A connector with any name works. The mod also tries the usual connector names `Tuix`, `claude.ai Tuix` and `tuix`. If your server has a different name, set the `server` option. When no server answers, `/tuix` names each server it tried and why it failed. Connectors can connect after the session starts. A rule can let the mod read without a question. Then the mod tries again 5, 20 and 60 seconds after the session starts. A server that you start with the Tuix stdio adapter (`packages/mcp` in the Tuix repository) works too.

## What this mod can do

Run `claude plugin validate .claude-plugin/plugin.json` in the folder that holds this README. Claude Code reads the code of the mod and prints the lists that this section explains. The lists are the same as the code, so you can check them.

### Calls

| Call | What the mod does with it |
| --- | --- |
| `$.mcp.call` | Reads `list_projects` and `list_issues` from the Tuix server. It calls no other tool. |
| `$.tool.list` | Lists the tools of the session to find the Tuix server. |
| `$.tool.check` | Asks Claude Code if a read tool needs a question. It cannot approve a call. |
| `$.prompt.submit` | Asks Claude to fix an issue. It runs only when you press **Fix with Claude** or run `/tuix fix`. |
| `$.command.register` | Registers the `/tuix` command. |
| `$.ui.open` | Opens the pane. |
| `$.ui.resolve` | Draws the pane and the issue cards. |
| `$.ui.copy` | Copies a link or a permission rule when you press **Copy**. |
| `$.ui.status` | Sets the status line, for example `Tuix: 3 open in Checkout`. |
| `$.ui.toast` | Shows a short message, for example after you press **Fix with Claude**. |
| `$.state.get`, `$.state.set` | Keep the state of the pane while the session runs. |
| `$.store.get`, `$.store.set` | Keep the project that you chose, for each repository. |
| `$.session.root` | Reads the folder of the repository, to name the stored project. |
| `$.session.surfaces` | Asks where Claude Code draws the pane: the terminal or the Desktop app. |
| `$.session.version` | Reads the Claude Code release, to turn off the features that the release does not have. |
| `$.clock.now`, `$.clock.after` | Read the time, for the age of an issue. Wait before a retry or a prompt. |

The list has no `$.fs`, `$.http`, `$.env` or `$.process` call. The mod never writes your settings.

### Events

| Event | What the mod does with it |
| --- | --- |
| `session.start` | Registers `/tuix`. Reads the Claude Code release. Reads Tuix when a rule lets the mod read without a question. |
| `tool.describe` | Learns the exact name of the Tuix server. It changes no description. |
| `classic.PreToolUse` | Notes where the Tuix server comes from, for the calls of this mod only. It changes no call. |
| `command.run` for `tuix` | Answers `/tuix`. |
| `ui.render` | Draws the pane in the terminal and in the Desktop app. Draws the issue cards in the transcript of the Desktop app. |

The mod has no `tool.check` hook. It cannot approve a call for you.

## Releases and features

| Feature | Claude Code release |
| --- | --- |
| The mod loads: `/tuix`, the panes, `/tuix doctor`, the Setup view | 2.1.286 |
| Issue cards in the transcript of the Desktop app. Below this release the transcript shows the raw result. | 2.1.289 |
| Actions that change an issue. The mod has none yet. | 2.1.292 |
| One-step install with `claude plugin install tuix --marketplace` | 2.1.292 |

The mod reads the release while the session starts, and turns off the features that the release does not have. The command `/tuix:tuix-list` is a Markdown file. It does not need support for mods.

To see your release, run `claude --version` in a terminal. In any session, run `/tuix doctor`.

## Permissions

Claude Code checks each call that the mod makes to Tuix, as it checks each call that Claude makes. If no rule allows a call, Claude Code asks you. The mod never changes your rules. It never answers a question for you.

The mod makes no call to Tuix until you run `/tuix` or press a button. There is one exception. At the start of a session, the mod reads Tuix when a rule already allows `list_projects` and `list_issues`.

### Allow the reads

To stop the questions, add two rules to `permissions.allow` in your settings:

```json
{
  "permissions": {
    "allow": ["mcp__<server>__list_*", "mcp__<server>__get_*"]
  }
}
```

`<server>` is the name of the Tuix server as Claude Code spells it in tool names. The name is different on each surface. The table assumes that the connector has the name Tuix:

| Where Claude Code runs | `<server>` |
| --- | --- |
| Terminal and VS Code, connector added in Claude | `claude_ai_Tuix` |
| Terminal and VS Code, server added with `claude mcp add` | The name that you gave, for example `tuix` |
| Desktop app | The identifier of the connector. It can be a long code. |
| Cloud session | `Tuix` |

Do not copy a name from this table. Run `/tuix doctor`. It prints the two rules for your session.

Put the rules in one of these places:

- `~/.claude/settings.json` for all your projects. The Desktop app reads this file.
- `.claude/settings.json` in a project, to share the rules with your team. Do not share a rule that has a connector code. The code is different for each person.
- The managed settings of your organization.

These rules also let Claude read Tuix without asking. Claude can then read the reports of the connected projects. The text of a report comes from the people who use your app. Claude treats this text as data, not as instructions.

The two rules do not allow the tools that change an issue. Do not use a rule that names the whole server, for example `mcp__claude_ai_Tuix`. That rule allows those tools.

### What the pane shows

- The chip shows what Claude Code says when the mod asks about the read tools. In auto mode and in plan mode, the chip can say `reads: will ask` while the reads run without a question.
- The chip never stops a call. If the chip says `reads: will ask`, the pane still reads. Claude Code asks you.
- Select the chip to open the Diagnostics box. The box shows the same report as `/tuix doctor`, with a **Copy** button for each rule.
- If a copy does not work, select the rule in the box and copy it by hand.
- If a deny rule refuses the reads, the Setup view names the rule. An allow rule does not help: a deny rule wins. Remove or change the deny rule.
- If your settings have custom auto-mode rules (`autoMode.soft_deny` or `autoMode.hard_deny`), calls of a mod can fail with the text `auto mode classifier gave no verdict`. The two rules fix this.

### /tuix doctor

The report shows:

- the version of the mod and the release of Claude Code;
- the surfaces that draw this session;
- the Tuix server, the tools it lists, and where Claude Code took its definition from (`source`);
- the answer of Claude Code for each read tool, with the rule that decides;
- the two rules for your server;
- the last error.

Release 2.1.296 does not tell the mod where a server comes from. The report then shows `source: not seen`. The mod reads the source only from its own calls. It never reads the source from a call of Claude or of another mod, because such a call can carry any text. When the source is a project or a plugin, the report and the pane show a warning. A Tuix connector is not a project or a plugin. Check `/mcp` before you trust that server.

## If your organization blocks mods

An administrator can set `allowManagedModsOnly`. Claude Code then refuses the hooks module of this mod, and `/tuix` does not exist. The command `/tuix:tuix-list` is a Markdown file, not a hook. It does not depend on the hooks module.

The command gives Claude no permission. Claude Code asks you before Claude calls a Tuix tool, unless a rule allows the call. The [permission rules](#allow-the-reads) apply to this command in the same way.

## Options

| Option | Default | Use |
| --- | --- | --- |
| `server` | empty: find it | The Tuix MCP server name, as `/mcp` shows it |
| `project` | empty: pick in the pane | The project ID or name to show first |

Both options are optional. Set them in `~/.claude/settings.json`, under `pluginConfigs`, or run `/plugin configure tuix@tuix` in Claude Code. Use the ID that `claude plugin list` shows (usually `tuix@tuix`). The example uses `tuix@tuix`:

```json
{
  "pluginConfigs": {
    "tuix@tuix": {
      "options": { "server": "Tuix", "project": "Checkout" }
    }
  }
}
```

You can also set them when you install, for example `--config project=Checkout`. Claude Code reads `pluginConfigs` only from user settings and managed settings.

## Update

These steps are for the terminal and the settings file. A mod that you add in **Customize** updates from your claude.ai account.

A marketplace that you add yourself does not update by default. Use one of these ways to update the mod:

- **Auto-update:** set `"autoUpdate": true` in the `extraKnownMarketplaces` entry, as in the [settings file](#settings-file). Claude Code then updates the mod in the background, up to 10 minutes after you send the first message of a session. The new version loads in the next session, or when you run `/reload-plugins`.
- **By hand:** run `claude plugin marketplace update tuix`, then `claude plugin update tuix@tuix`. Restart Claude Code.
- **In a session:** run `/plugin`, select **Marketplaces**, and turn on **Enable auto-update** for `tuix`.

`/tuix doctor` shows the version of the mod that runs.

## Check and test

Run these commands in the folder that holds this README:

```sh
claude plugin validate --strict .
claude plugin validate --strict .claude-plugin/plugin.json
claude plugin test .
```

The first command checks the marketplace file. On Claude Code 2.1.289 and later, it also checks the plugin. The second command checks the plugin on every release. The third command runs the tests.

The tests use a fake Tuix server. They need no network and no credentials. CI runs the commands on Claude Code 2.1.286, 2.1.292 and the latest release.

## Files

| Path | Content |
| --- | --- |
| `.claude-plugin/marketplace.json` | The marketplace file: one plugin, `tuix` |
| `.claude-plugin/plugin.json` | The manifest, the version and the options |
| `commands/tuix-list.md` | The `/tuix:tuix-list` command |
| `hooks/hooks.json` | Names the hooks module, `register.tsx` |
| `hooks/register.tsx` | The hooks: the `/tuix` command and the pane |
| `hooks/tuix.ts` | Functions with no engine calls: parse the MCP results, make the fix prompt |
| `types/index.d.ts` | The types of the values the pane keeps in `$.state` |
| `tests/tuix.test.ts` | The tests |

The version of the mod is in `.claude-plugin/plugin.json` only. A test holds `VERSION` in `hooks/tuix.ts` equal to it.

When the engine loads the mod from a folder that it watches, it writes the API types to `.claude-plugin/types/`. Git ignores that folder.
