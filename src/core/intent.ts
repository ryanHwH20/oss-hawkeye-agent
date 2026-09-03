/** A package coordinate as requested by, and resolved for, an action. */
export interface PackageCoordinate {
  system: string;
  name: string;
  requestedVersion?: string;
  resolvedVersion?: string;
}

/** V1 starts with the shell-command surface protected by current enforcement. */
export interface ShellCommandIntent {
  kind: 'shell_command';
  command: string;
  cwd?: string;
}

export type ActionIntent = ShellCommandIntent;
