import type { Activity } from "../state/shell";

export type Permission = "read" | "write" | "execute" | "admin";
export type CommandContext = {
  activity: Activity;
  hasWorkspace: boolean;
  hasSelection: boolean;
};
export type AppCommand = {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  permission: Permission;
  when?: (context: CommandContext) => boolean;
  run: () => void | Promise<void>;
};

export class CommandRegistry {
  private readonly commands = new Map<string, AppCommand>();

  register(command: AppCommand) {
    this.commands.set(command.id, command);
    return () => this.commands.delete(command.id);
  }

  list(context: CommandContext) {
    return [...this.commands.values()].filter(
      (command) => command.when?.(context) ?? true,
    );
  }

  get(id: string) {
    return this.commands.get(id);
  }

  async execute(id: string, context: CommandContext) {
    const command = this.get(id);
    if (!command || !(command.when?.(context) ?? true)) return false;
    await command.run();
    return true;
  }
}

export function createDefaultCommands(actions: {
  openPalette: () => void;
  toggleInspector: () => void;
  toggleDrawer: () => void;
  setActivity: (activity: Activity) => void;
}) {
  const registry = new CommandRegistry();
  registry.register({
    id: "shell.command-palette",
    title: "Shell: Open Command Palette",
    category: "Shell",
    shortcut: "⌘K / Ctrl K",
    permission: "read",
    run: actions.openPalette,
  });
  registry.register({
    id: "shell.toggle-inspector",
    title: "Shell: Toggle Inspector",
    category: "Shell",
    shortcut: "⌘J / Ctrl J",
    permission: "read",
    run: actions.toggleInspector,
  });
  registry.register({
    id: "shell.toggle-drawer",
    title: "Shell: Toggle Bottom Drawer",
    category: "Shell",
    permission: "read",
    run: actions.toggleDrawer,
  });
  for (const activity of [
    "search",
    "planner",
    "agents",
    "terminal",
    "settings",
  ] as const) {
    const label = `${activity.slice(0, 1).toUpperCase()}${activity.slice(1)}`;
    registry.register({
      id: `activity.${activity}`,
      title: `Open ${label}`,
      category: "Activity",
      permission: "read",
      run: () => {
        actions.setActivity(activity);
      },
    });
  }
  return registry;
}
